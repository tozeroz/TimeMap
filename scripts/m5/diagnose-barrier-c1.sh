#!/usr/bin/env bash
# 决定性诊断：备份屏障 C1 为何未拦住上传
#   ① 看 holder 日志（它到底拿到锁没有）
#   ② 手工复现同样的持锁 + 上传
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
KEY=1295270465          # 与 verify-voice-lifecycle.sh 一致；也等于服务端 0x4D344241
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
API=http://127.0.0.1

echo "=== 1) holder 日志（gate 上一轮留下的）==="
if [ -f /tmp/lc-barrier-holder.log ]; then
  cat /tmp/lc-barrier-holder.log | sed 's/^/  /'
else
  echo "  **不存在** ← 说明 gate 运行时 holder 没写出日志（可能没跑起来）"
fi

echo
echo "=== 2) 锁键核对（十进制）==="
echo "  脚本 KEY        = $KEY"
echo "  服务端 0x4D344241 = $((0x4D344241))"
if [ "$KEY" -eq "$((0x4D344241))" ]; then echo "  ✓ 两者相同"; else echo "  ✗ **不同**"; fi

echo
echo "=== 3) 手工复现：持排他锁 8 秒，窗口内上传，观察 HTTP 码 ==="
# 取一个 token（用固定测试号，避免随机号引入噪声）
PHONE='+8613800000001'
curl -s -X POST "$API/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" >/dev/null
sleep 0.8
SINK="/run/campus/login-codes/$(printf '%s' "$PHONE" | tr -d '+').json"
CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK")"
TOK="$(curl -s -X POST "$API/api/auth/verify-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
echo "  token 取得: $( [ -n "$TOK" ] && echo yes || echo no )"

# 造一个最小 webm（gate 用的是真机 fixture；这里只要能过 mime 嗅探即可 —— 复用 gate 的 fixture 更稳）
FIX=/tmp/m5-voice-fixture.webm
if [ ! -f "$FIX" ]; then
  # 从 m5 脚本里找它用的 fixture
  grep -o "/tmp/[a-zA-Z0-9._-]*\.webm" /tmp/m5/verify-voice-lifecycle.sh 2>/dev/null | head -1 > /tmp/fixpath.txt || true
  FP="$(cat /tmp/fixpath.txt 2>/dev/null)"
  if [ -n "$FP" ] && [ -f "$FP" ]; then cp "$FP" "$FIX"; echo "  复用 gate fixture: $FP"; fi
fi
ls -l "$FIX" 2>/dev/null | sed 's/^/  /' || echo "  ⚠️ 没有 fixture，上传可能因 mime 被拒（那时 400，不等于 C1 的 201）"

echo
echo "  --- 启动 holder（排他锁 8s）---"
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -q -At \
  -c "select pg_advisory_lock($KEY)" -c "select pg_sleep(8)" -c "select pg_advisory_unlock($KEY)" \
  > /tmp/barrier-holder-now.log 2>&1 &
HOLDER=$!
sleep 1.5

echo "  --- 检查锁此刻是否真的被持有 ---"
PSQL "select 'pg_locks 里该 key 的持锁数 = ' || count(*)::text from pg_locks where locktype='advisory'"
PSQL "select 'objid=' || objid::text || ' mode=' || mode || ' granted=' || granted::text
        from pg_locks where locktype='advisory' and objid = $KEY"
echo "  --- holder 日志（此刻）---"
cat /tmp/barrier-holder-now.log 2>/dev/null | sed 's/^/    /'

echo
echo "  --- 窗口内上传（与 C1 同形态）---"
T0=$(date +%s%N)
R="$(curl -s -m 20 -w '\n%{http_code}' -X POST "$API/api/media" -H "Authorization: Bearer $TOK" \
  -F "file=@$FIX;type=audio/webm" -F 'purpose=chat' \
  -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" -F 'durationMs=2500' 2>&1)"
T1=$(date +%s%N)
CODE_C="$(printf '%s' "$R" | tail -1)"
BODY_C="$(printf '%s' "$R" | head -1)"
echo "    HTTP=$CODE_C  耗时=$(( (T1-T0)/1000000 ))ms"
echo "    body=$(printf '%s' "$BODY_C" | head -c 200)"

wait $HOLDER 2>/dev/null || true
echo
echo "=== 4) 结论 ==="
case "$CODE_C" in
  503) echo "  ✓ 手工复现 **503** → 屏障机制本身正常；gate 那次 201 属偶发（需查 holder 是否真的持锁）" ;;
  201) echo "  ✗ 手工也得到 **201** → 屏障**真的失效**了（这是产品/配置缺陷，不是抖动）" ;;
  *)   echo "  ? 得到 $CODE_C（既非 503 也非 201）→ 需看 body 才能定性" ;;
esac
