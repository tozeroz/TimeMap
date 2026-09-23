#!/usr/bin/env bash
# ⭐ HTTPS 证书健康检查 + 自动补救（本项目用 Let's Encrypt **IP 证书**，有效期仅约 6 天）
#
# ════════════════════════════════════════════════════════════════════════════
# 为什么必须有它（而不是只靠 certbot renew 的 timer）
# ════════════════════════════════════════════════════════════════════════════
# 证书只有 ~6 天有效期 ⇒ **续期链路上任何一环坏掉，几天后就是全站证书错误**。
# 而 certbot 的 timer 只做"申请"，**不检查结果**。以下这些失败它都不会告诉你：
#   · 续期成功但 **deploy-hook 没生效** ⇒ nginx 还在下发旧证书（文件新、服务旧）
#   · 续期失败（HTTP-01 抓不到、LE 限流、网络问题）⇒ 静默等到过期
#   · 误把 **staging 证书**留在配置里（我实测踩过：staging→production 同 cert-name
#     会被 certbot 跳过，输出一句 "not yet due for renewal" 极易被忽略）
# ⇒ 所以要有独立的健康检查，且它检查的是**最终状态**（实际下发的证书 / 公共信任），
#    而不是"某个动作是否执行过"。
#
# ════════════════════════════════════════════════════════════════════════════
# ⚠️⚠️ 实现上刻意避开的 bash 陷阱（我第一版就写错了，值得记）
# ════════════════════════════════════════════════════════════════════════════#   第一版把"追加问题"和"返回值"写在同一个函数里，调用处用 `days=$(f)` ——
#   **`$(...)` 会开子 shell，函数里对全局数组 `problems` 的追加全部丢失**，
#   于是"证书过期"这种最严重的问题**永远不会被记录**，脚本照样报健康。
#   ⇒ "监控自己坏了却报健康"是最危险的失效模式，比没有监控更糟。
#   ⇒ 本版规则：**检查函数不返回值，只往全局数组里追加**；需要数值时用独立的全局变量。
#
# ⚠️ 告警渠道的诚实说明：本项目**没有**邮件/短信告警通道
#    （短信走阿里云「短信认证」，其赠送模板全是验证码模板，发不了任意告警文本）。
#    ⇒ 告警落地为：journald CRITICAL + 机器可读状态文件 +（可选）`TLS_ALERT_WEBHOOK`。
#    设置该变量即把告警 POST 过去（企业微信/钉钉/Server酱等机器人均可）。
#    **未配置 webhook 时告警只留在服务器上 —— 已知缺口，已在 docs 登记。**
#
# 退出码：0 = 健康；1 = 不健康（补救后仍失败）；2 = 环境问题导致无法判定
set -uo pipefail

CERT_NAME="${TLS_CERT_NAME:-8.148.156.146}"
CERT_DIR="/etc/letsencrypt/live/$CERT_NAME"
FULLCHAIN="$CERT_DIR/fullchain.pem"
THRESHOLD_DAYS="${TLS_THRESHOLD_DAYS:-3}"
STATUS_FILE="${TLS_STATUS_FILE:-/run/campus/tls-health.json}"
CERTBOT="${CERTBOT_BIN:-/opt/certbot/bin/certbot}"
IP="$CERT_NAME"

# 全局状态（不用子 shell 传递）
PROBLEMS=()
DAYS_LEFT=-1

add_problem() { PROBLEMS+=("$1"); }

# ── 检查项：只追加 PROBLEMS / 设置 DAYS_LEFT，**不 echo 返回值** ──────────
collect_all() {
  PROBLEMS=()
  DAYS_LEFT=-1

  if [ ! -f "$FULLCHAIN" ]; then
    add_problem "证书文件不存在: $FULLCHAIN"
    return
  fi

  # ① 过期与剩余天数
  local end_epoch now_epoch
  end_epoch=$(date -d "$(openssl x509 -in "$FULLCHAIN" -noout -enddate 2>/dev/null | cut -d= -f2)" +%s 2>/dev/null || echo 0)
  now_epoch=$(date +%s)
  if [ "$end_epoch" -le "$now_epoch" ]; then
    add_problem "证书**已过期**"
    DAYS_LEFT=0
  else
    DAYS_LEFT=$(( (end_epoch - now_epoch) / 86400 ))
    if [ "$DAYS_LEFT" -lt "$THRESHOLD_DAYS" ]; then
      add_problem "剩余有效期仅 ${DAYS_LEFT} 天（阈值 ${THRESHOLD_DAYS} 天）"
    fi
  fi

  # ② 签发者不是 staging（实测踩过的坑：staging 证书浏览器不信任，但其他检查都"正常"）
  if openssl x509 -in "$FULLCHAIN" -noout -issuer 2>/dev/null | grep -qi 'STAGING'; then
    add_problem "**证书是 Let's Encrypt STAGING 的**（浏览器不信任；staging→production 曾被 certbot 跳过）"
  fi

  # ③ SAN 含本机 IP
  if ! openssl x509 -in "$FULLCHAIN" -noout -ext subjectAltName 2>/dev/null | grep -q "IP Address:$IP"; then
    add_problem "SAN 里没有 IP Address:$IP"
  fi

  # ④ ⭐ nginx 实际下发的证书 == 文件（抓 deploy-hook/reload 失效）
  local file_fp served_fp
  file_fp=$(openssl x509 -in "$FULLCHAIN" -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')
  served_fp=$(echo | timeout 10 openssl s_client -connect "127.0.0.1:443" -servername "$IP" 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')
  if [ -z "$served_fp" ]; then
    add_problem "无法从 127.0.0.1:443 取到 nginx 下发的证书"
  elif [ "$file_fp" != "$served_fp" ]; then
    add_problem "**nginx 下发的证书与文件不一致** ⇒ deploy-hook 或 reload 失效"
  fi

  # ⑤ ⭐ 公共信任链（必须**不带** -k，带 -k 等于放弃校验）
  local code
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$IP/health" 2>/dev/null)
  if [ "$code" != "200" ]; then
    add_problem "公共信任校验未通过（https://$IP/health 返回 '$code'）"
  fi
}

# ── 自动补救 ────────────────────────────────────────────────────────────
REMEDIATIONS=()
remediate() {
  echo "  → 尝试自动补救"
  if [ -x "$CERTBOT" ]; then
    echo "     certbot renew（普通）"
    "$CERTBOT" renew --quiet --cert-name "$CERT_NAME" 2>&1 | sed 's/^/       /' || true
    REMEDIATIONS+=("certbot renew")

    # 复看剩余天数，仍不足则强制续（⚠️ 消耗 LE 速率额度，故只在必要时）
    if [ -f "$FULLCHAIN" ]; then
      local end_epoch now_epoch d
      end_epoch=$(date -d "$(openssl x509 -in "$FULLCHAIN" -noout -enddate | cut -d= -f2)" +%s 2>/dev/null || echo 0)
      now_epoch=$(date +%s)
      d=$(( (end_epoch - now_epoch) / 86400 ))
      if [ "$d" -lt "$THRESHOLD_DAYS" ]; then
        echo "     certbot renew --force-renewal（剩余 ${d} 天，不足阈值）"
        "$CERTBOT" renew --quiet --cert-name "$CERT_NAME" --force-renewal 2>&1 | sed 's/^/       /' || true
        REMEDIATIONS+=("certbot renew --force-renewal")
      fi
    fi
  else
    echo "     ⚠️ certbot 不存在于 $CERTBOT，无法自动续期"
    REMEDIATIONS+=("SKIPPED: certbot 缺失")
  fi

  echo "     systemctl reload nginx"
  systemctl reload nginx 2>&1 | sed 's/^/       /' || true
  REMEDIATIONS+=("systemctl reload nginx")
  sleep 2
}

# ── 告警 ────────────────────────────────────────────────────────────────
alert() {
  local msg="$1"
  logger -t campus-tls -p crit "CERT_HEALTH_FAIL: $msg" 2>/dev/null || true
  echo "  ⚠️ CRITICAL: $msg" >&2
  if [ -n "${TLS_ALERT_WEBHOOK:-}" ]; then
    if curl -s -m 10 -X POST -H 'content-type: application/json' \
      -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[campus] TLS 证书异常：$msg\"}}" \
      "$TLS_ALERT_WEBHOOK" >/dev/null 2>&1; then
      echo "  （已推送 webhook）" >&2
    else
      echo "  ⚠️ webhook 推送失败" >&2
    fi
  fi
}

json_array() {
  # ⚠️ 这里修过一处**真 bug**：第一版只把元素逐个转义后用逗号连接，
  #    **漏了外层方括号** ⇒ 生成的 `"problems": "xxx"` 是**非法 JSON**，
  #    下游（门禁/告警）根本无法解析 —— "机器可读的文件读不了"是硬伤。
  #    另外健康时 `"${ARR[@]:-}"` 会展开成一个空串，也会产出 `""` 而不是 `[]`。
  #    ⇒ 本版：先过滤空元素，空则输出 `[]`，否则输出 `["a","b"]`。
  local items=()
  local a
  for a in "$@"; do
    [ -n "$a" ] && items+=("$a")
  done
  if [ "${#items[@]}" -eq 0 ]; then
    echo '[]'
    return
  fi
  printf '%s\n' "${items[@]}" \
    | sed 's/\\/\\\\/g; s/"/\\"/g; s/.*/"&"/' \
    | paste -sd, - \
    | sed 's/^/[/; s/$/]/'
}

write_status() {
  local healthy="$1"
  mkdir -p "$(dirname "$STATUS_FILE")" 2>/dev/null || true
  cat > "$STATUS_FILE" <<JSON
{
  "checkedAt": "$(date -Iseconds)",
  "host": "$(hostname)",
  "certName": "$CERT_NAME",
  "healthy": $healthy,
  "daysRemaining": $DAYS_LEFT,
  "thresholdDays": $THRESHOLD_DAYS,
  "problems": $(json_array "${PROBLEMS[@]:-}"),
  "remediationsTried": $(json_array "${REMEDIATIONS[@]:-}"),
  "issuer": "$(openssl x509 -in "$FULLCHAIN" -noout -issuer 2>/dev/null | sed 's/issuer=//')",
  "notAfter": "$(openssl x509 -in "$FULLCHAIN" -noout -enddate 2>/dev/null | cut -d= -f2)",
  "alertWebhookConfigured": $([ -n "${TLS_ALERT_WEBHOOK:-}" ] && echo true || echo false)
}
JSON
}

# ── 主流程 ──────────────────────────────────────────────────────────────
echo "=== TLS 证书健康检查 $(date -Iseconds) ==="
echo "  证书=$CERT_NAME  阈值=${THRESHOLD_DAYS}天  状态文件=$STATUS_FILE"

collect_all

if [ "${#PROBLEMS[@]}" -eq 0 ]; then
  echo "  ✓ 健康（剩余 ${DAYS_LEFT} 天）"
  write_status true
  exit 0
fi

echo "  ✗ 发现 ${#PROBLEMS[@]} 个问题："
for p in "${PROBLEMS[@]}"; do echo "    · $p"; done

remediate

# ⭐ 复检：**必须重新收集一套全新的问题**（第一版在这里犯过错：把旧问题带过来了，
#    于是"补救后仍报同样的问题"，掩盖了真实进展）
collect_all

if [ "${#PROBLEMS[@]}" -eq 0 ]; then
  echo "  ✓ 补救后恢复健康（剩余 ${DAYS_LEFT} 天）"
  write_status true
  exit 0
fi

echo "  ✗ 补救后仍不健康（${#PROBLEMS[@]} 个问题）："
for p in "${PROBLEMS[@]}"; do echo "    · $p"; done
alert "$(printf '%s; ' "${PROBLEMS[@]}")剩余 ${DAYS_LEFT} 天"
write_status false
exit 1
