#!/usr/bin/env bash
# WO#9B 层 A **blocker ①** 的契约核验：GET /api/threads/:id 返回权威 members[]
#
# 审核记录 49 冻结的边界（逐条断言）：
#   · member → 200，返回 { id, kind, title, memberCount, members:[{id, displayName}] }
#   · non-member → 404
#   · members[] **只含最小身份字段** —— **不得**出现 phone 等无关数据
#   · **memberCount === members.length**
#   · 成员集合必须与 DB 的 thread_members 一致（权威性）
set -uo pipefail
BASE="http://127.0.0.1:3001"
GROUP='aaaaaaaa-0001-4001-8001-00000000000a'
PW_DB="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW_DB" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

FAIL=0
ok()   { echo "  PASS $1"; }
bad()  { echo "  FAIL $1"; FAIL=1; }
info() { echo "  info $1"; }

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

echo "=== WO#9B blocker ① 契约核验：GET /api/threads/:id 的 members[] ==="
TOK_M="$(login '+8613800000002')"   # Lemy = 群成员
TOK_N="$(login '+8613800000003')"   # Azur冰弦 = **非成员**
[ -z "$TOK_M" ] && bad "成员登录取不到 token"
[ -z "$TOK_N" ] && bad "非成员登录取不到 token"

echo
echo "--- 1) 成员：200 + 结构 ---"
CODE="$(curl -s -o /tmp/wo9bA_m.json -w '%{http_code}' "$BASE/api/threads/$GROUP" -H "authorization: Bearer $TOK_M")"
info "HTTP $CODE"
if [ "$CODE" = "200" ]; then ok "成员读会话详情 200"; else bad "成员读会话详情 HTTP $CODE（期望 200）"; fi

python3 - <<'PY'
import json, subprocess, sys
try:
    d = json.load(open('/tmp/wo9bA_m.json'))
except Exception as e:
    print(f"  FAIL 响应无法解析: {e}"); sys.exit(0)

fail = False
def ok(m):
    print(f"  PASS {m}")
def bad(m):
    global fail
    fail = True
    print(f"  FAIL {m}")

# 结构
for k in ('id','kind','title','memberCount','members'):
    ok(f"含字段 {k}") if k in d else bad(f"缺字段 {k}")

mem = d.get('members')
if isinstance(mem, list):
    ok(f"members 是数组（{len(mem)} 项）")
else:
    bad("members 不是数组")
    mem = []

# 最小身份字段：只允许 id / displayName
allowed = {'id','displayName'}
for m in mem:
    extra = set(m.keys()) - allowed
    if extra:
        bad(f"成员对象含**多余字段** {sorted(extra)}（审核 49：只返回最小身份字段，不得暴露 phone 等）")
    else:
        ok(f"成员 {m.get('displayName')!r} 只含 {sorted(m.keys())}")

# phone 泄漏（显式反向断言，含子串匹配）
raw = json.dumps(d, ensure_ascii=False)
if 'phone' in raw.lower() or '+8613' in raw:
    bad("响应里出现 phone / 手机号字样（**越界暴露**）")
else:
    ok("响应里**没有** phone / 手机号（符合最小暴露）")

# memberCount == members.length
if d.get('memberCount') == len(mem):
    ok(f"memberCount({d.get('memberCount')}) == members.length({len(mem)})")
else:
    bad(f"memberCount({d.get('memberCount')}) != members.length({len(mem)})")

# 与 DB 的 thread_members 对比（权威性）
db_ids = subprocess.run(
    ['psql','-h','127.0.0.1','-U','campus','-d','campus','-Atc',
     "select user_id::text from thread_members where thread_id='aaaaaaaa-0001-4001-8001-00000000000a' order by user_id"],
    capture_output=True, text=True, env={'PGPASSWORD': open('/srv/campus/.db_password').read().strip(), 'PATH':'/usr/bin:/bin'}
).stdout.split()
api_ids = sorted(m.get('id') for m in mem)
if sorted(db_ids) == api_ids:
    ok(f"members 集合 == DB thread_members（{len(api_ids)} 项）")
else:
    bad(f"members 集合 != DB：api={api_ids} db={sorted(db_ids)}")

print("  MEMBER_SOURCE_CONTRACT: " + ("FAIL" if fail else "PASS"))
PY

echo
echo "--- 2) 非成员：必须 404 ---"
NCODE="$(curl -s -o /tmp/wo9bA_n.json -w '%{http_code}' "$BASE/api/threads/$GROUP" -H "authorization: Bearer $TOK_N")"
info "非成员 HTTP $NCODE  body=$(head -c 120 /tmp/wo9bA_n.json)"
if [ "$NCODE" = "404" ]; then ok "非成员读会话详情 404"; else bad "非成员 HTTP $NCODE（期望 404）"; fi
if grep -q '+8613\|phone' /tmp/wo9bA_n.json 2>/dev/null; then bad "非成员响应里出现手机号字样"; else ok "非成员响应无手机号字样"; fi

echo
if [ "$FAIL" -eq 0 ]; then echo "MEMBER_SOURCE_CONTRACT: PASS"; else echo "MEMBER_SOURCE_CONTRACT: FAIL"; fi
