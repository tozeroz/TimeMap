#!/usr/bin/env bash
# 诊断：为什么群消息接口对成员返回 200 但 0 条（库里确有 3 条）
#
# 两种可能：
#   (a) 种子 bug：消息的某些字段让接口的过滤条件把它们排除了（例如 created_at 在未来）
#   (b) 接口 bug：查询/过滤逻辑对某些会话返回空
# 判据：拿一个**已知有消息**的会话（ffffffff-…-001，2 条）做对照。
set -uo pipefail
BASE="http://127.0.0.1:3001"
PW_DB="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW_DB" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

login() {
  local phone="$1"
  curl -s -X POST "$BASE/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$phone\"}" >/dev/null 2>&1
  sleep 0.6
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

echo "=== 1) DB 里群消息的完整字段（含时间）==="
PSQL "select m.id || ' | kind=' || m.kind || ' | sender=' || coalesce(u.display_name,'?') || ' | deleted_at=' || coalesce(m.deleted_at::text,'NULL') || ' | created_at=' || m.created_at::text || ' | now()=' || now()::text
        from messages m left join users u on u.id=m.sender_id
       where m.thread_id='aaaaaaaa-0001-4001-8001-00000000000a' order by m.created_at, m.id"

echo
echo "=== 2) 对照：direct 会话（ffffffff-…-001）的消息字段 ==="
PSQL "select m.id || ' | kind=' || m.kind || ' | deleted_at=' || coalesce(m.deleted_at::text,'NULL') || ' | created_at=' || m.created_at::text
        from messages m where m.thread_id='ffffffff-0001-4001-8001-000000000001' order by m.created_at"

TOK="$(login '+8613800000002')"
echo
echo "=== 3) API：群消息（成员 Lemy）原始 JSON ==="
curl -s -o /tmp/g.json -w "  HTTP %{http_code}\n" "$BASE/api/threads/aaaaaaaa-0001-4001-8001-00000000000a/messages" -H "authorization: Bearer $TOK"
head -c 600 /tmp/g.json; echo

echo
echo "=== 4) 对照：direct 会话消息（同一 token）原始 JSON ==="
curl -s -o /tmp/d.json -w "  HTTP %{http_code}\n" "$BASE/api/threads/ffffffff-0001-4001-8001-000000000001/messages" -H "authorization: Bearer $TOK"
head -c 600 /tmp/d.json; echo

echo
echo "=== 5) 服务端 messages 接口的查询语句（源码）==="
grep -n -A 22 "app.get('/api/threads/:id/messages'" /srv/campus/server/dist/index.mjs 2>/dev/null | head -30 \
  || echo "  （dist 是打包产物，改看仓库源码）"
