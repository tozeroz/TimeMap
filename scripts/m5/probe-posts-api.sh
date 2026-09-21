#!/usr/bin/env bash
# FeedList（WO#11 前置）：posts 接口的形状与真实数据（只读）
set -uo pipefail
BASE="http://127.0.0.1:3001"
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

login() {
  local phone="$1"
  curl -s -X POST "$BASE/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$phone\"}" >/dev/null 2>&1
  sleep 0.7
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

echo "=== 1) DB: posts 表的列 ==="
PSQL "select column_name || ' | ' || data_type || ' | nullable=' || is_nullable
        from information_schema.columns where table_name='posts' order by ordinal_position"

echo
echo "=== 2) DB: posts 的行数与内容 ==="
PSQL "select count(*) || ' 行动态' from posts"
PSQL "select left(id::text,8) || ' | ' || coalesce(left(body,30),'<null>') || ' | author=' || left(author_id::text,8) from posts order by created_at"

echo
echo "=== 3) DB: 关联表 ==="
PSQL "select 'comments=' || (select count(*) from comments) || ' likes=' || (select count(*) from likes) || ' post_media=' || (select count(*) from post_media)"

echo
echo "=== 4) GET /api/posts 的真实响应（需要登录）==="
TOK="$(login '+8613800000001')"
if [ -z "$TOK" ]; then
  echo "  取不到 token"
else
  curl -s "$BASE/api/posts" -H "authorization: Bearer $TOK" -o /tmp/feed-probe.json -w "  HTTP %{http_code}  content-type=%{content_type}\n"
  echo "  --- 响应的字段结构（第一条 item 的键）---"
  python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/feed-probe.json'))
except Exception as e:
    print(f"  无法解析: {e}"); raise SystemExit
if isinstance(d, dict):
    print(f"  顶层键: {sorted(d.keys())}")
    items = d.get('items')
    if isinstance(items, list):
        print(f"  items 数: {len(items)}")
        if items:
            print(f"  单条字段: {sorted(items[0].keys())}")
            print(f"  单条样例: {json.dumps(items[0], ensure_ascii=False)[:400]}")
    else:
        print(f"  没有 items 数组；响应片段: {json.dumps(d, ensure_ascii=False)[:300]}")
else:
    print(f"  顶层不是对象: {type(d)}")
PY
fi

echo
echo "=== 5) 未登录访问 /api/posts（权限口径）==="
curl -s -o /tmp/feed-anon.json -w "  匿名 HTTP %{http_code}\n" "$BASE/api/posts"
head -c 160 /tmp/feed-anon.json; echo
