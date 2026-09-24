#!/usr/bin/env bash
# ⭐ 门禁：HTTPS 证书健康（Let's Encrypt **IP 证书**，约 6 天有效期）
#
# ════════════════════════════════════════════════════════════════════════════
# 与 ops/tls/check-cert-health.sh 的关系（一份实现，两个消费者）
# ════════════════════════════════════════════════════════════════════════════
#   · `ops/tls/check-cert-health.sh` 跑在**服务器上**，由 systemd timer **每小时**执行
#     —— 那是**真正的保护**（没人看的时候也能发现并自愈）。
#   · 本门禁通过 ssh 调用同一份实现，把结论接进审计 ——
#     "跑全量回归"时会顺带验到证书状态。
#
#   ⚠️ 为什么不能只做门禁：门禁只在我跑审计时执行，而证书 6 天就过期，
#      问题可能出现在两次审计之间。**"只在有人看时才检查"等于没有监控。**
#
# ════════════════════════════════════════════════════════════════════════════
# ⚠️ 实现上的一处修正（值得记）：判定放在**服务器上**做，不在本地做
# ════════════════════════════════════════════════════════════════════════════
#   第一版让本地 `python3` 解析 JSON —— 结果一直 INCONCLUSIVE。
#   根因：本机 Git-Bash 里的 `python3` 指向
#   `%LOCALAPPDATA%\Microsoft\WindowsApps\python3`，那是 **Windows Store 的占位桩**，
#   管道输入时什么都不做（rc=49、无输出）⇒ 本地解析根本不可能成功。
#   而我第一版还加了 `2>/dev/null`，把真实错误也一起吞掉，只剩我自己编的
#   "python3 解析失败" 兜底话术 —— **掩盖了整整一轮排查**。
#   ⇒ 改为：**JSON 在哪、就在哪解析**（服务器上有真 python3 3.14），
#     门禁只负责取结论。这同时消除了对本地解释器的依赖。
#
# ════════════════════════════════════════════════════════════════════════════
# 判定口径
# ════════════════════════════════════════════════════════════════════════════
#   PASS          —— 服务器健康检查通过（healthy=true 且 problems 为空）
#   FAIL          —— 明确不健康（过期/剩余不足/deploy-hook 失效/公共信任失败/STAGING 证书）
#   INCONCLUSIVE  —— **无法判定**：ssh 不通、脚本缺失、状态文件读不到或不是合法 JSON
#                    ⚠️ 这类**绝不**因为"没查到错"就报 PASS（"没发现 ≠ 不存在"）。
set -uo pipefail

SSH_KEY="${SSH_KEY:-G:\\demo map\\TimeMap.pem}"
SSH_HOST="${SSH_HOST:-root@8.148.156.146}"
SSH_BIN="$(command -v ssh || echo /usr/bin/ssh)"

echo "=== 1) 连通性 ==="
if ! "$SSH_BIN" -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" 'echo ok' >/dev/null 2>&1; then
  echo "TLS_CERT_HEALTH: INCONCLUSIVE（ssh 连不上 $SSH_HOST，无法判定）"
  exit 0
fi
echo "  ✓ ssh 可达"

echo
echo "=== 2) 在**服务器上**触发检查并计算结论（JSON 在哪就在哪解析）==="
# ⚠️ 故意**先跑一次**再判定：这样即使 timer 还没到点，验的也是**当下**状态。
# 服务器端 python 片段：
PY_ON_SERVER='import json,sys
try:
    d=json.load(open("/run/campus/tls-health.json",encoding="utf-8"))
except Exception as e:
    print("INCONCLUSIVE|状态文件读不到或不是合法 JSON: "+str(e)); sys.exit(0)
p=d.get("problems")
if not isinstance(p,list):
    print("INCONCLUSIVE|problems 字段不是数组"); sys.exit(0)
days=d.get("daysRemaining"); thr=d.get("thresholdDays"); issuer=(d.get("issuer") or "")
if "STAGING" in issuer.upper():
    print("FAIL|签发者是 STAGING（浏览器不信任）"); sys.exit(0)
if d.get("healthy") is True and not p:
    print("PASS|剩余 "+str(days)+" 天（阈值 "+str(thr)+"）")
else:
    print("FAIL|"+("; ".join(p) if p else "healthy=false 但 problems 为空（状态自相矛盾）"))'

OUT=$("$SSH_BIN" -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=25 "$SSH_HOST" \
  "/opt/campus/check-cert-health.sh >/tmp/tls-check.out 2>&1; echo \"CHECK_EXIT=\$?\"; \
   cat /run/campus/tls-health.json; echo '---VERDICT---'; \
   python3 -c '$PY_ON_SERVER'" 2>&1) || true

# 把输出切成三段：检查退出码 / JSON / 结论
CHECK_EXIT=$(printf '%s' "$OUT" | grep -m1 '^CHECK_EXIT=' | cut -d= -f2)
JSON_PART=$(printf '%s' "$OUT" | sed -n '/^{/,/^}/p')
VERDICT=$(printf '%s' "$OUT" | sed -n '/^---VERDICT---$/,$p' | tail -n +2 | head -1)

echo "  服务器检查退出码：${CHECK_EXIT:-未知}"
echo "  状态文件："
printf '%s\n' "$JSON_PART" | sed 's/^/    /'

if [ -z "$VERDICT" ]; then
  echo
  echo "  ⚠️ 服务器未返回结论 —— 原始输出如下（不再吞错误信息）："
  printf '%s\n' "$OUT" | tail -20 | sed 's/^/    /'
  echo
  echo "TLS_CERT_HEALTH: INCONCLUSIVE（未取得结论，无法判定）"
  exit 0
fi

echo
echo "=== 3) 判定 ==="
KIND="${VERDICT%%|*}"
DETAIL="${VERDICT#*|}"
echo "  $KIND —— $DETAIL"
echo
echo "TLS_CERT_HEALTH: $KIND"

case "$KIND" in
  PASS) exit 0 ;;
  FAIL) exit 1 ;;
  *)    exit 0 ;;   # INCONCLUSIVE 不阻塞回归，但已如实登记
esac
