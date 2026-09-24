#!/usr/bin/env bash
# 诊断：为什么"mentionsAll + mentions 混用"会得到 400 —— 具体错误码是什么？
#
# 为什么要查：层 B 的 MIXED_ALL_AND_INDIVIDUAL_REJECT 断言**改前就 PASS**（HTTP 400），
# 但那时服务端**还不知道** mentionsAll 这个字段 —— 说明它拒的是**别的原因**。
# 这正是本项目纪律禁止的"只断 4xx"：断言必须**指明具体错误码**，
# 否则"因为错误原因通过"会被当成不变量成立。
set -uo pipefail
BASE=http://127.0.0.1:3001
GROUP='aaaaaaaa-0001-4001-8001-00000000000a'
PW_DB="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW_DB" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

login() {
  local phone="$1"
  curl -s -X POST "$BASE/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$phone\"}" >/dev/null 2>&1
  sleep 0.8
  local sink="/run/campus/login-codes/$(printf '%s' "$phone" | tr -d '+').json"
  local code
  code="$(python3 -c "
import json
try:
    d=json.load(open('$sink')); print(d.get('code') or d.get('otp') or '')
except Exception: print('')
")"
  [ -z "$code" ] && { echo ""; return; }
  curl -s -X POST "$BASE/api/auth/verify-code" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('token') or '')
except Exception: print('')
"
}

TOK="$(login '+8613800000001')"
echo "=== 逐种情况看**具体响应体**（错误码/原因）==="
echo
echo "--- A) mentionsAll=true + mentions=[成员] ---"
curl -s -X POST "$BASE/api/threads/$GROUP/messages" \
  -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"body":"WO9B-DIAG-MIX","kind":"text","mentionsAll":true,"mentions":["11111111-1111-4111-8111-111111111111"]}' \
  -w '\n  [HTTP %{http_code}]\n'
echo
echo "--- B) 只带 mentions=[成员]（不带 mentionsAll）—— 对照 ---"
curl -s -X POST "$BASE/api/threads/$GROUP/messages" \
  -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"body":"WO9B-DIAG-ONLY","kind":"text","mentions":["11111111-1111-4111-8111-111111111111"]}' \
  -w '\n  [HTTP %{http_code}]\n'
echo
echo "--- C) 只带 mentionsAll=true ---"
curl -s -X POST "$BASE/api/threads/$GROUP/messages" \
  -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"body":"WO9B-DIAG-ALLONLY","kind":"text","mentionsAll":true}' \
  -w '\n  [HTTP %{http_code}]\n'

echo
echo "=== 清理诊断消息 ==="
PSQL "delete from message_mentions where message_id in (select id from messages where body like 'WO9B-DIAG-%')" >/dev/null
PSQL "delete from messages where body like 'WO9B-DIAG-%'" >/dev/null
PSQL "select '群内消息数 = ' || count(*)::text from messages where thread_id='$GROUP'"
