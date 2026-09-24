#!/usr/bin/env bash
# WO#12 服务端三处只读扩展的验证（含审核 53 要求的机械验证）
#   ① GET /api/users/:id          —— 最小字段 {id, displayName}；unknown → 404；非法形状 → 404
#   ② GET /api/posts?authorId=    —— 服务端过滤；非法 authorId → 400；无帖作者 → 200 空
#   ③ GET /api/threads → peerId   —— direct 才有；**机械验证 peerId == 另一成员 id**；group → null
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
BASE=http://127.0.0.1
FAIL=0
ok()  { echo "  PASS $1"; }
bad() { echo "  FAIL $1"; FAIL=1; }

login() {
  local phone="$1"
  curl -s -X POST "$BASE/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$phone\"}" >/dev/null 2>&1
  sleep 0.8
  local sink="/run/campus/login-codes/$(printf '%s' "$phone" | tr -d '+').json"
  local code
  code="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$sink" 2>/dev/null)"
  [ -z "$code" ] && { echo ""; return; }
  curl -s -X POST "$BASE/api/auth/verify-code" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

echo "=== 准备：登录取 token ==="
TOK="$(login '+8613800000001')"    # anmoss
echo "  token: $( [ -n "$TOK" ] && echo ok || echo FAIL )"
[ -z "$TOK" ] && exit 1
ANMOSS="$(PSQL "select id from users where phone_e164='+8613800000001'")"
LEMY="$(PSQL "select id from users where phone_e164='+8613800000002'")"
AZUR="$(PSQL "select id from users where phone_e164='+8613800000003'")"
echo "  anmoss=$ANMOSS  lemy=$LEMY  azur=$AZUR"

echo
echo "############ ① GET /api/users/:id ############"
echo "--- 1.1 已知用户 → 200 + 恰好两个字段 ---"
curl -s "$BASE/api/users/$LEMY" -o /tmp/u1.json -w "  HTTP %{http_code}\n"
python3 - <<'PY'
import json
try: d = json.load(open('/tmp/u1.json'))
except Exception as e: print(f"  FAIL 解析失败 {e}"); raise SystemExit
keys = sorted(d.keys())
print(f"  {'PASS' if keys == ['displayName','id'] else 'FAIL'} 字段恰好为 ['displayName','id']（实际 {keys}）")
print(f"  {'PASS' if d.get('id') else 'FAIL'} id 非空 = {d.get('id')}")
print(f"  {'PASS' if d.get('displayName') else 'FAIL'} displayName = {d.get('displayName')!r}")
# 明确断言**不**含敏感字段
forbidden = ['phone','campus','college','grade','major','mbti','zodiac','avatar','schoolCampusId']
present = [k for k in forbidden if k in d]
print(f"  {'PASS' if not present else 'FAIL'} 不含被禁字段（命中 {present}）")
PY

echo "--- 1.2 未知 uuid → 404 ---"
UU="$(cat /proc/sys/kernel/random/uuid)"
C="$(curl -s -o /tmp/u2.json -w '%{http_code}' "$BASE/api/users/$UU")"
[ "$C" = "404" ] && ok "未知 uuid → 404" || bad "未知 uuid → HTTP $C（期望 404）"

echo "--- 1.3 非法形状 → 404（不做格式/存在性区分）---"
for bad_id in "u:11111111-1111-4111-8111-111111111111" "not-a-uuid" "u1"; do
  C="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/users/$bad_id")"
  [ "$C" = "404" ] && ok "非法形状 '$bad_id' → 404" || bad "非法形状 '$bad_id' → HTTP $C（期望 404）"
done

echo
echo "############ ② GET /api/posts?authorId= ############"
echo "--- 2.1 已知作者 → 只返回该作者的帖子，且与 DB 计数一致 ---"
curl -s "$BASE/api/posts?authorId=$ANMOSS" -H "authorization: Bearer $TOK" -o /tmp/p1.json -w "  HTTP %{http_code}\n"
DB_CNT="$(PSQL "select count(*) from posts where author_id='$ANMOSS'")"
python3 - "$DB_CNT" <<'PY'
import json, sys
db_cnt = int(sys.argv[1])
d = json.load(open('/tmp/p1.json'))
items = d.get('items', [])
print(f"  API 返回 {len(items)} 条 / DB 该作者 {db_cnt} 条")
print(f"  {'PASS' if len(items) == db_cnt else 'FAIL'} 数量一致")
ids = {x.get('authorId') for x in items}
print(f"  {'PASS' if len(ids) <= 1 else 'FAIL'} 返回项的作者 id 唯一（实际 {ids}）")
PY

echo "--- 2.2 非法 authorId → 400（显式拒绝，不静默返回全部）---"
for bad_a in "not-a-uuid" "u1" "12345"; do
  C="$(curl -s -o /tmp/p2.json -w '%{http_code}' "$BASE/api/posts?authorId=$bad_a")"
  ERR="$(sed -n 's/.*"error":"\([^"]*\)".*/\1/p' /tmp/p2.json)"
  [ "$C" = "400" ] && ok "非法 authorId '$bad_a' → 400（error=$ERR）" || bad "非法 authorId '$bad_a' → HTTP $C（期望 400）"
done

echo "--- 2.3 有帖作者（Azur冰弦）→ 200 + 只含其帖子 ---"
C="$(curl -s -o /tmp/p3.json -w '%{http_code}' "$BASE/api/posts?authorId=$AZUR")"
N="$(python3 -c "
import json
try: print(len(json.load(open('/tmp/p3.json')).get('items', [])))
except Exception: print('ERR')")"
DB_AZUR="$(PSQL "select count(*) from posts where author_id='$AZUR'")"
[ "$C" = "200" ] && ok "有帖作者 → 200（items=$N，DB=$DB_AZUR）" || bad "有帖作者 → HTTP $C（期望 200）"
[ "$N" = "$DB_AZUR" ] && ok "有帖作者数量与 DB 一致" || bad "有帖作者数量 $N != DB $DB_AZUR"

echo "--- 2.3b 合法 uuid 但**不存在**的 id → 200 + 空（不是 404：语义是'该作者的帖子'，无人则空）---"
GHOST="$(cat /proc/sys/kernel/random/uuid)"
CG="$(curl -s -o /tmp/p3b.json -w '%{http_code}' "$BASE/api/posts?authorId=$GHOST")"
NG="$(python3 -c "
import json
try: print(len(json.load(open('/tmp/p3b.json')).get('items', [])))
except Exception: print('ERR')")"
[ "$CG" = "200" ] && [ "$NG" = "0" ] && ok "不存在的作者 → 200 + items=[]（诚实的空结果）" || bad "不存在的作者 → HTTP $CG items=$NG（期望 200/0）"

echo "--- 2.4 不带 authorId 时行为不变（回归）---"
C="$(curl -s -o /tmp/p4.json -w '%{http_code}' "$BASE/api/posts" -H "authorization: Bearer $TOK")"
N="$(python3 -c "
import json
try: print(len(json.load(open('/tmp/p4.json')).get('items', [])))
except Exception: print('ERR')")"
[ "$C" = "200" ] && ok "不带 authorId → 200（items=$N，应为全部 $(( $(PSQL "select count(*) from posts") ))）" || bad "不带 authorId → HTTP $C"

echo
echo "############ ③ GET /api/threads → peerId ############"
curl -s "$BASE/api/threads" -H "authorization: Bearer $TOK" -o /tmp/t1.json -w "  HTTP %{http_code}\n"
python3 - <<'PY'
import json
d = json.load(open('/tmp/t1.json'))
items = d.get('items', [])
print(f"  会话数 = {len(items)}")
for it in items:
    k = it.get('kind')
    pid = it.get('peerId')
    pname = it.get('peerName')
    print(f"    kind={k:7} peerId={pid}  peerName={pname!r}")
# 断言：group 的 peerId 必须是 null
groups = [x for x in items if x.get('kind') == 'group']
print(f"  {'PASS' if all(x.get('peerId') is None for x in groups) else 'FAIL'} 所有 group 的 peerId 为 null（{len(groups)} 个 group）")
# 断言：direct 的 peerId 非空
directs = [x for x in items if x.get('kind') == 'direct']
print(f"  {'PASS' if all(x.get('peerId') for x in directs) else 'FAIL'} 所有 direct 的 peerId 非空（{len(directs)} 个 direct）")
PY

echo "--- 3.1 ⭐机械验证：direct.peerId == thread_members 中除我之外的另一成员 id ---"
python3 - "$ANMOSS" <<'PY' > /tmp/peercheck.txt 2>&1
import json, subprocess, sys, os
me = sys.argv[1]
d = json.load(open('/tmp/t1.json'))
env = dict(os.environ); env['PGPASSWORD'] = open('/srv/campus/.db_password').read().strip()
def psql(sql):
    out = subprocess.run(['psql','-h','127.0.0.1','-U','campus','-d','campus','-Atc',sql],
                         capture_output=True, text=True, env=env)
    return [x for x in out.stdout.strip().split('\n') if x]
bad = 0
for it in d.get('items', []):
    if it.get('kind') != 'direct':
        continue
    tid = it['id']; pid = it.get('peerId'); pname = it.get('peerName')
    others = psql(f"select user_id::text from thread_members where thread_id='{tid}' and user_id <> '{me}'")
    # 名字对应的人
    named = psql(f"select tm.user_id::text from thread_members tm join users u on u.id=tm.user_id "
                 f"where tm.thread_id='{tid}' and tm.user_id <> '{me}' order by u.display_name limit 1")
    match = (len(others) == 1 and others[0] == pid)
    name_match = (len(named) == 1 and named[0] == pid)
    print(f"  thread={tid[:8]}  peerId={pid}  DB另一成员={others}  {'✓一致' if match else '✗不一致'}")
    print(f"      peerName={pname!r} 名字对应的人={named}  {'✓同名同 id' if name_match else '✗名字与 id 不是同一人'}")
    if not match or not name_match:
        bad += 1
print(f"  {'PASS' if bad == 0 else 'FAIL'} 全部 direct 的 peerId 与 DB 另一成员一致，且与 peerName 指向同一人")
PY
cat /tmp/peercheck.txt | sed 's/^/    /'
grep -q 'FAIL' /tmp/peercheck.txt && FAIL=1

echo
if [ "$FAIL" -eq 0 ]; then
  echo "WO12_SERVER_EXTENSIONS: PASS（三个只读扩展全部符合审核 53 的边界）"
else
  echo "WO12_SERVER_EXTENSIONS: FAIL"
fi
