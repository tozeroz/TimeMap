#!/usr/bin/env bash
# 只读核验：/api/threads 现在是否返回 peerName（WO#8 后端改动）
#
# 为什么必须单独核这一步：前端"会话列表显示对方昵称"完全依赖这个字段。
# 如果它没生效，前端会显示"未命名会话" —— 那是一种**看起来正常但信息缺失**的失败，
# 只靠前端截图很难立刻发现。所以直接打 API 看原始 JSON。
#
# 需要一个有效会话 token。取得方式（本项目既有做法）：
#   走「手机号 + 一次性验证码」登录，验证码从 dev sink 读（/run/campus/login-codes/latest.json）。
# 这只在**我们自己的 demo 后端**上执行，不涉及第三方。
set -u
PHONE="${1:-+8613800000002}"
BASE="http://127.0.0.1:3001"

echo "=== 1) 请求验证码（我们自己的 demo 后端，dev sink）==="
curl -s -X POST "$BASE/api/auth/request-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\"}" -o /tmp/rc.json -w "  HTTP %{http_code}\n"
cat /tmp/rc.json | head -c 300; echo

echo
echo "=== 2) 从 dev sink 读验证码 ==="
sleep 1
CODE="$(python3 -c "
import json,sys
try:
    d=json.load(open('/run/campus/login-codes/latest.json'))
    print(d.get('code') or d.get('otp') or '')
except Exception as e:
    print('')
")"
if [ -z "$CODE" ]; then
  echo "  读不到验证码，dev sink 内容："
  cat /run/campus/login-codes/latest.json 2>/dev/null | head -c 400; echo
  exit 1
fi
echo "  code=${CODE:0:2}**（已取到）"

echo
echo "=== 3) 用验证码换 token ==="
curl -s -X POST "$BASE/api/auth/verify-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" -o /tmp/vc.json -w "  HTTP %{http_code}\n"
TOKEN="$(python3 -c "
import json
try:
    d=json.load(open('/tmp/vc.json'))
    print(d.get('token') or '')
except Exception:
    print('')
")"
if [ -z "$TOKEN" ]; then
  echo "  换 token 失败："; head -c 300 /tmp/vc.json; echo; exit 1
fi
echo "  token 已取到（长度 ${#TOKEN}）"

echo
echo "=== 4) GET /api/threads —— 看原始 JSON 里有没有 peerName ==="
curl -s "$BASE/api/threads" -H "authorization: Bearer $TOKEN" -o /tmp/th.json -w "  HTTP %{http_code}\n"
python3 - <<'PY'
import json
d = json.load(open('/tmp/th.json'))
items = d.get('items', [])
print(f"  会话数 = {len(items)}")
for t in items:
    print(f"    id={t['id']}")
    print(f"      kind={t['kind']}  title={t.get('title')!r}  memberCount={t.get('memberCount')}")
    print(f"      **peerName={t.get('peerName')!r}**")
    lm = t.get('lastMessage')
    print(f"      lastMessage={ (lm or {}).get('body') !r} kind={(lm or {}).get('kind')!r}")
has = all('peerName' in t for t in items)
print()
print(f"  PEERNAME_FIELD_PRESENT: {has}")
print(f"  DIRECT_WITH_NAME: {sum(1 for t in items if t['kind']!='group' and (t.get('peerName') or t.get('title')))}/{sum(1 for t in items if t['kind']!='group')}")
PY
