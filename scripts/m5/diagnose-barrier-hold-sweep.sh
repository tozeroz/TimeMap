#!/usr/bin/env bash
# 有界实验：备份屏障在不同**持锁时长**下的行为扫描
#
# 已知两个互相矛盾的观测：
#   持锁 8s（gate C1 的时长）→ 上传 **201**，耗时 7997ms（屏障未拦）
#   持锁 30s                 → 上传 **503**（backup_in_progress），耗时 6885ms（屏障生效）
# 目的：找出"何时拦、何时不拦"，据此判断
#   ① 是产品缺陷（超时条件有边界 bug）
#   ② 还是测试设计太紧（8s 持锁 vs 5s lock_timeout 只差 3s，落在临界区）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
KEY=1295270465
API=http://127.0.0.1
FIX=/tmp/voice-sample.webm
PSQLQ() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

PHONE='+8613800000001'
curl -s -X POST "$API/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" >/dev/null
sleep 0.8
SINK="/run/campus/login-codes/$(printf '%s' "$PHONE" | tr -d '+').json"
CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK")"
TOK="$(curl -s -X POST "$API/api/auth/verify-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
echo "token: $( [ -n "$TOK" ] && echo ok || echo FAIL )"
[ -z "$TOK" ] && exit 1

printf '\n  %-10s %-8s %-10s %s\n' "持锁(s)" "HTTP" "耗时(ms)" "判定"
printf '  %s\n' "-----------------------------------------------------------"

for HOLD in 6 8 10 12 20; do
  # 起 holder
  PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At \
    -c "select pg_advisory_lock($KEY)" -c "select pg_sleep($HOLD)" -c "select pg_advisory_unlock($KEY)" \
    >/dev/null 2>&1 &
  H=$!
  sleep 1.5
  LOCKED="$(PSQLQ "select count(*) from pg_locks where locktype='advisory' and objid=$KEY and granted")"
  T0=$(date +%s%N)
  R="$(curl -s -m 60 -w '\n%{http_code}' -X POST "$API/api/media" -H "Authorization: Bearer $TOK" \
    -F "file=@$FIX;type=audio/webm" -F 'purpose=chat' \
    -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" -F 'durationMs=2500' 2>&1)"
  T1=$(date +%s%N)
  MS=$(( (T1-T0)/1000000 ))
  C="$(printf '%s' "$R" | tail -1)"
  B="$(printf '%s' "$R" | head -1)"
  if printf '%s' "$B" | grep -q 'backup_in_progress'; then VERDICT="✓ 被拦（503 屏障生效）"; else VERDICT="✗ 未被拦（$C）"; fi
  [ "$LOCKED" != "1" ] && VERDICT="$VERDICT ⚠️(锁未确认持有)"
  printf '  %-10s %-8s %-10s %s\n' "$HOLD" "$C" "$MS" "$VERDICT"
  wait $H 2>/dev/null || true
  sleep 0.5
done

echo
echo "=== 结论判读 ==="
echo "  若只有 6/8s 不拦、10s+ 拦 → 屏障的等待窗口与 hold 时长的关系存在边界效应，"
echo "     需查 pg 的 lock_timeout 是否被连接池预热延迟抵消（8s 时上传实际开始得太晚）"
echo "  若全部拦 → 之前 8s/201 是偶发（例如那次 holder 没真正拿到锁）"
