#!/usr/bin/env bash
# WO#11 收尾 · 运维缺口修复：为 auth hygiene / 通用 cleanup 安装 systemd timer
#
# ## 为什么需要（真实发现）
#   M5 server gate 的 PERSISTENT 断言 `M5_AUTH_STALE_REVOKED_SESSIONS` 要求
#   "不存在撤销超过 24h 的会话行"。它调用 `cleanup-auth`（**dry-run**，不改数据，这是对的 ——
#   Gate 不该变更被检对象），然后断言结果。
#   但在本次运行中它 FAIL 了（5 条 age=24.25~24.34h，**刚刚**跨过阈值）。
#   根因：**没有任何定时任务在跑 cleanup**（无 systemd timer、无 cron），
#   所以陈旧行只会累积，直到有人手动执行 —— 不变量**无法长期成立**。
#
# ## 本脚本做什么
#   ① 提供 handoff 说明：cleanup 工具需要以 campus 用户 + server.env 运行
#   ② 安装两个 systemd timer（auth hygiene 每 6h；通用清理每 6h，错开 30min）
#   ③ 立即各跑一次 --apply，把当前积压清掉
#   ④ 打印状态供核对
#
# ⚠️ 只装 timer + 跑一次清理，不改任何应用代码。
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
NODE=/opt/node-v24.21.0-linux-x64/bin/node
ENVFILE=/srv/campus/server.env

RUN_AS() {
  # 以 campus 身份、带 server.env 的环境变量运行一个 dist 下的 mjs
  #
  # ⚠️ 我第一版写的是 `env "$(grep -v '^#' "$ENVFILE" | xargs)" "$NODE" ...` —— **错的**：
  #    命令替换的结果被当成**一个参数**，于是 DATABASE_URL 之类被拼进别的变量里，
  #    报出 "database \"campus LOGIN_CODE_HMAC_KEY=…\" does not exist"。
  #    → 正确做法（与 run-seed-on-server.sh 一致）：`set -a; . "$ENV_FILE"; set +a`
  #      把变量导入当前 shell，再用 `env 变量="$变量"` 显式传递。
  local script="$1"; shift
  (
    set -a
    # shellcheck disable=SC1090
    . "$ENVFILE"
    set +a
    exec setpriv --reuid=campus --regid=campus --init-groups \
      env DATABASE_URL="$DATABASE_URL" UPLOAD_ROOT="${UPLOAD_ROOT:-/srv/campus/uploads}" \
      "$NODE" "/srv/campus/server/dist/$script" "$@"
  )
}

echo "=== 1) 现状（清理前）==="
PSQL "select '撤销>24h 的会话 = ' || count(*)::text
        from sessions where revoked_at is not null and revoked_at < now() - interval '24 hours'"
PSQL "select '过期>24h 的会话 = ' || count(*)::text
        from sessions where expires_at < now() - interval '24 hours'"

echo
echo "=== 2) 立即各跑一次 --apply（清掉当前积压）==="
echo "  --- cleanup-auth --apply ---"
RUN_AS cleanup-auth.mjs --apply 2>&1 | sed 's/^/    /'
echo "  --- cleanup --apply（通用：孤儿 media 等）---"
RUN_AS cleanup.mjs --apply 2>&1 | sed 's/^/    /'

echo
echo "=== 3) 清理后 ==="
PSQL "select '撤销>24h 的会话 = ' || count(*)::text
        from sessions where revoked_at is not null and revoked_at < now() - interval '24 hours'"

echo
echo "=== 4) 安装 systemd service + timer（auth hygiene，每 6 小时）==="
cat > /etc/systemd/system/campus-cleanup-auth.service <<'UNIT'
[Unit]
Description=Campus auth hygiene cleanup (sessions/challenges retention)
After=network.target postgresql.service

[Service]
Type=oneshot
User=campus
Group=campus
EnvironmentFile=/srv/campus/server.env
ExecStart=/opt/node-v24.21.0-linux-x64/bin/node /srv/campus/server/dist/cleanup-auth.mjs --apply
# 清理是幂等的：重复跑不会误删（工具自身只删"超过 retention grace"的行）
UNIT

cat > /etc/systemd/system/campus-cleanup-auth.timer <<'UNIT'
[Unit]
Description=Run campus auth hygiene cleanup every 6 hours

[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
UNIT

echo "=== 5) 安装 systemd service + timer（通用清理，每 6 小时，错开 30 分钟）==="
cat > /etc/systemd/system/campus-cleanup.service <<'UNIT'
[Unit]
Description=Campus generic cleanup (orphan media / unattached tmp TTL)
After=network.target postgresql.service

[Service]
Type=oneshot
User=campus
Group=campus
EnvironmentFile=/srv/campus/server.env
ExecStart=/opt/node-v24.21.0-linux-x64/bin/node /srv/campus/server/dist/cleanup.mjs --apply
UNIT

cat > /etc/systemd/system/campus-cleanup.timer <<'UNIT'
[Unit]
Description=Run campus generic cleanup every 6 hours (offset from auth cleanup)

[Timer]
OnBootSec=40min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now campus-cleanup-auth.timer campus-cleanup.timer 2>&1 | sed 's/^/  /'

echo
echo "=== 6) timer 状态核对 ==="
systemctl list-timers --all 2>/dev/null | grep -E 'campus-cleanup|NEXT' | sed 's/^/  /'
echo "  --- 最近一次 service 执行结果 ---"
systemctl is-active campus-cleanup-auth.timer | sed 's/^/  auth.timer active: /'
systemctl is-active campus-cleanup.timer | sed 's/^/  cleanup.timer active: /'

echo
echo "=== 7) 结论 ==="
N="$(PSQL "select count(*) from sessions where revoked_at is not null and revoked_at < now() - interval '24 hours'")"
if [ "$N" = "0" ]; then
  echo "  PASS 陈旧行已清零，且已安装 timer 使其**长期**成立（不再依赖手动执行）"
else
  echo "  FAIL 仍有 $N 条陈旧行"
fi
