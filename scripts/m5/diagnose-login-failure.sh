#!/usr/bin/env bash
# 诊断：server gate 的"登录失败"（M5_MEDIA_MESSAGE_API / M5_MEDIAID_STRICT_REJECT 连带 FAIL）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
BASE=http://127.0.0.1:3001

echo "=== 1) gate 报告里的全部 FAIL 行 ==="
grep -a -n 'FAIL' /tmp/gate-wo11b.txt | grep -v 'FAIL=0' | head -20 | sed 's/^/  /'

echo
echo "=== 2) 服务是否在跑 ==="
systemctl is-active campus-backend.service | sed 's/^/  active: /'
curl -s -o /dev/null -w "  /api/health HTTP %{http_code}\n" "$BASE/api/health"

echo
echo "=== 3) OTP dev sink 目录状态（gate 的登录依赖它）==="
ls -la /run/campus/login-codes/ 2>&1 | head -10 | sed 's/^/  /'

echo
echo "=== 4) 手动走一次完整登录（request-code → 读 code → verify-code）==="
PHONE='+8613800000099'
echo "  --- request-code ---"
curl -s -X POST "$BASE/api/auth/request-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\"}" -w "\n  HTTP %{http_code}\n" | sed 's/^/    /'
sleep 1
SINK="/run/campus/login-codes/$(printf '%s' "$PHONE" | tr -d '+').json"
echo "  --- sink 文件: $SINK ---"
if [ -f "$SINK" ]; then
  cat "$SINK" | sed 's/^/    /'
else
  echo "    **文件不存在** ← gate 登录失败的直接原因"
fi

echo
echo "=== 5) 直接看服务日志里的登录相关记录（最近 30 行）==="
journalctl -u campus-backend.service --no-pager -n 30 2>/dev/null | grep -i -E 'code|otp|login|auth|error' | tail -12 | sed 's/^/  /'

echo
echo "=== 6) sessions / login_challenges 现状 ==="
PSQL "select 'sessions=' || count(*)::text from sessions"
PSQL "select 'login_challenges=' || count(*)::text from login_challenges"
PSQL "select 'challenges 最近 3 条: ' || string_agg(left(id::text,8) || '@' || to_char(created_at,'HH24:MI:SS'), ', ' order by created_at desc)
        from (select id, created_at from login_challenges order by created_at desc limit 3) t"

echo
echo "=== 7) 该 sink 目录的属主/权限（服务以 campus 运行）==="
stat -c '%A %U:%G %n' /run/campus /run/campus/login-codes 2>&1 | sed 's/^/  /'
