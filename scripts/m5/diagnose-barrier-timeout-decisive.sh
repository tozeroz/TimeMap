#!/usr/bin/env bash
# 决定性判别：备份屏障的 lock_timeout(5s) 到底有没有在对上传路径生效
#
# 判别设计：
#   持排他锁 **30 秒**（远大于 lock_timeout=5s）
#   → 若上传在 ~5s 返回 503 → 屏障**正确工作**（此前 7997ms 那次另有原因）
#   → 若上传等到 ~30s 才 201 → **屏障的超时没生效**（= 产品缺陷）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
KEY=1295270465
API=http://127.0.0.1
FIX=/tmp/voice-sample.webm
PSQLQ() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 0) 直接确认 bundle 里有 backup_in_progress（放宽 grep）==="
grep -c 'backup_in_progress' /srv/campus/server/dist/index.mjs 2>/dev/null | sed 's/^/  出现次数: /'
grep -o 'backup_in_progress' /srv/campus/server/dist/index.mjs 2>/dev/null | head -2 | sed 's/^/  /'

echo
echo "=== 1) 取 token ==="
PHONE='+8613800000001'
curl -s -X POST "$API/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" >/dev/null
sleep 0.8
SINK="/run/campus/login-codes/$(printf '%s' "$PHONE" | tr -d '+').json"
CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK")"
TOK="$(curl -s -X POST "$API/api/auth/verify-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
echo "  token: $( [ -n "$TOK" ] && echo ok || echo FAIL )"
[ ! -f "$FIX" ] && { echo "  FATAL 缺 fixture $FIX"; exit 1; }

echo
echo "=== 2) 持排他锁 **30 秒** ==="
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At \
  -c "select pg_advisory_lock($KEY)" -c "select pg_sleep(30)" -c "select pg_advisory_unlock($KEY)" \
  >/dev/null 2>&1 &
HOLDER=$!
sleep 1.5
echo "  --- 确认锁已被持有 ---"
PSQLQ "select 'mode=' || mode || ' granted=' || granted::text from pg_locks where locktype='advisory' and objid=$KEY"
echo "  服务端连接池当前是否有等待该锁的会话："
PSQLQ "select 'waiting sessions = ' || count(*)::text from pg_locks where locktype='advisory' and not granted"

echo
echo "=== 3) 窗口内上传（最多等 40s；观察它什么时候返回、返回什么）==="
T0=$(date +%s%N)
R="$(curl -s -m 40 -w '\n%{http_code}' -X POST "$API/api/media" -H "Authorization: Bearer $TOK" \
  -F "file=@$FIX;type=audio/webm" -F 'purpose=chat' \
  -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" -F 'durationMs=2500' 2>&1)"
T1=$(date +%s%N)
MS=$(( (T1-T0)/1000000 ))
CODE_C="$(printf '%s' "$R" | tail -1)"
BODY_C="$(printf '%s' "$R" | head -1)"
echo "  HTTP=$CODE_C  耗时=${MS}ms"
echo "  body=$(printf '%s' "$BODY_C" | head -c 220)"

echo
echo "=== 4) 期间观察：是否有等待 advisory 锁的会话（另一窗口看不到；改查 pg_stat_activity）==="
PSQLQ "select 'waiter: ' || pid::text || ' wait=' || coalesce(wait_event_type,'-') || '/' || coalesce(wait_event,'-')
        from pg_stat_activity where datname='campus' and wait_event_type='Lock'" | head -5

kill $HOLDER 2>/dev/null || true
wait $HOLDER 2>/dev/null || true

echo
echo "=== 5) 判别结论 ==="
if [ "$CODE_C" = "503" ] && [ "$MS" -lt 12000 ]; then
  echo "  ✓ 屏障**正确**：持锁 30s 时，上传在 ${MS}ms（≈lock_timeout 5s）返回 503"
  echo "    → 此前 7997ms/201 那次必有别的原因（见下）"
elif [ "$CODE_C" = "201" ] && [ "$MS" -gt 20000 ]; then
  echo "  ✗ **屏障超时未生效**：上传一直等到锁释放（${MS}ms）才成功 201"
  echo "    → 这是**产品缺陷**（lock_timeout 没作用到该路径），不是测试抖动"
elif [ "$CODE_C" = "201" ]; then
  echo "  ? 上传 ${MS}ms 后 201 —— 既非快速 503 也非等到 30s，需进一步看时序"
else
  echo "  ? 未预期：HTTP=$CODE_C 耗时=${MS}ms"
fi
