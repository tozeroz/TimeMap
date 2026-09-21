#!/usr/bin/env bash
# WO#9A 的**授权矩阵 Gate**（审核记录 45 称为本切片最重要的 Gate）
#
# ## 为什么它比"能打开群聊"更重要
#   会话接口的成员判定是**唯一**保护群内消息的东西。只看"成员能读"不够：
#   必须证明**非成员读不到**，而且 —— 审核 45 特别指出 ——
#   "非成员读取 404 只证明 confidentiality 的**一半**；**写也必须被拒绝且零 mutation**"。
#
# ## 矩阵（种子：群成员 = {anmoss, Lemy}，非成员 = Azur冰弦）
#   member A / B : 群在 GET /api/threads 可见；GET messages 200；POST 文本 201
#   non-member C : 群**不在** GET /api/threads；GET messages **404**；
#                  POST messages **404**；且 **DB message delta = 0**
#
# ## 登录方式
#   走本 demo 自己的「手机号 + 一次性验证码」，验证码从服务器上的 dev sink 读。
#   三个账号都是**我们自己的种子用户**，与第三方 App 无关。
set -uo pipefail

BASE="http://127.0.0.1:3001"
GROUP='aaaaaaaa-0001-4001-8001-00000000000a'
PW_DB="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW_DB" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

FAIL=0
ok()   { echo "  PASS $1"; }
bad()  { echo "  FAIL $1"; FAIL=1; }
info() { echo "  info $1"; }

# 登录一个手机号，回显 token（验证码从 dev sink 读）
login() {
  local phone="$1"
  curl -s -X POST "$BASE/api/auth/request-code" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\"}" >/dev/null 2>&1
  sleep 0.6
  local sink="/run/campus/login-codes/$(printf '%s' "$phone" | tr -d '+').json"
  local code
  code="$(python3 -c "
import json,sys
try:
    d=json.load(open('$sink'))
    print(d.get('code') or d.get('otp') or '')
except Exception:
    print('')
")"
  if [ -z "$code" ]; then echo ""; return; fi
  curl -s -X POST "$BASE/api/auth/verify-code" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" \
  | python3 -c "
import json,sys
try:
    print(json.load(sys.stdin).get('token') or '')
except Exception:
    print('')
"
}

echo "=== WO#9A 授权矩阵 Gate ==="
echo "  群: $GROUP（种子成员 = anmoss + Lemy；非成员 = Azur冰弦）"
echo

TOK_A="$(login '+8613800000001')"   # anmoss = 成员
TOK_B="$(login '+8613800000002')"   # Lemy   = 成员（也是设备上登录的账号）
TOK_C="$(login '+8613800000003')"   # Azur冰弦 = **非成员**

for pair in "成员A(anmoss):$TOK_A" "成员B(Lemy):$TOK_B" "非成员C(Azur冰弦):$TOK_C"; do
  name="${pair%%:*}"; tok="${pair#*:}"
  if [ -z "$tok" ]; then bad "$name 登录失败（拿不到 token）—— 后续该项无法评估"; fi
done

# ---------------------------------------------------------------------------
echo "--- 1) 群是否出现在各自的 GET /api/threads 里 ---"
check_visible() { # $1=label $2=token $3=expect(present|absent)
  local label="$1" tok="$2" expect="$3"
  local body
  body="$(curl -s "$BASE/api/threads" -H "authorization: Bearer $tok")"
  local present
  present="$(printf '%s' "$body" | python3 -c "
import json,sys
try:
    items=json.load(sys.stdin).get('items',[])
    print('yes' if any(t.get('id')=='$GROUP' for t in items) else 'no')
except Exception:
    print('err')
")"
  if [ "$expect" = "present" ]; then
    [ "$present" = "yes" ] && ok "$label 列表**可见**该群" || bad "$label 列表**看不到**该群（actual=$present）"
  else
    [ "$present" = "no" ] && ok "$label 列表**看不到**该群（符合预期）" || bad "$label 列表**看到了**该群（越权！actual=$present）"
  fi
}
check_visible "成员A(anmoss)" "$TOK_A" present
check_visible "成员B(Lemy)" "$TOK_B" present
check_visible "非成员C(Azur冰弦)" "$TOK_C" absent

# ---------------------------------------------------------------------------
echo
echo "--- 2) GET /api/threads/<group>/messages ---"
# ⚠️ 每个角色写**各自的文件**。
#    第一版这里所有角色共用一个 /tmp/wo9a_read.json，而"成员A 读到的消息"是在
#    **非成员那次 404 覆盖之后**才打印的 —— 于是打出来的是非成员的响应（空 items），
#    标签却写着"成员A"，让我一度以为接口返回 200 但 0 条（其实接口完全正常）。
#    这类"读了已被后续调用覆盖的产物"在本项目出现过多次，故每个断言各自留证。
LAST_BODY=''
check_read() { # $1=label $2=token $3=expect(200|404) $4=outfile
  local label="$1" tok="$2" expect="$3" out="$4"
  local code
  code="$(curl -s -o "$out" -w '%{http_code}' \
    "$BASE/api/threads/$GROUP/messages" -H "authorization: Bearer $tok")"
  if [ "$code" = "$expect" ]; then
    ok "$label 读消息 HTTP $code   （原始响应: $out）"
  else
    bad "$label 读消息 HTTP $code（期望 $expect）body=$(head -c 120 "$out")"
  fi
  if [ "$expect" = "200" ]; then LAST_BODY="$out"; fi
}
check_read "成员A(anmoss)" "$TOK_A" 200 /tmp/wo9a_read_a.json
check_read "成员B(Lemy)" "$TOK_B" 200 /tmp/wo9a_read_b.json
check_read "非成员C(Azur冰弦)" "$TOK_C" 404 /tmp/wo9a_read_c.json

echo
echo "  成员A 读到的消息（独立文件 /tmp/wo9a_read_a.json，与被覆盖无关）:"
READ_COUNT="$(python3 - <<PY
import json
try:
    d = json.load(open('$LAST_BODY'))
except Exception as e:
    print('ERR'); raise SystemExit
items = d.get('items', [])
for m in items:
    print(f"    {m.get('kind'):5} | sender={m.get('sender')!r} | {str(m.get('body'))[:24]!r}")
print(f"    共 {len(items)} 条")
print(len(items))
PY
)"
# 最后一行是纯数字（供断言用），前面是给人看的明细
echo "$READ_COUNT" | sed '$d'
N_READ="$(echo "$READ_COUNT" | tail -1)"
SEED_MSGS="$(PSQL "select count(*) from messages where thread_id='$GROUP'")"
if [ "$N_READ" = "$SEED_MSGS" ] && [ "$N_READ" != "0" ]; then
  ok "成员A 读到的消息数 = DB 里的群消息数（$N_READ）"
else
  bad "成员A 读到的消息数 = $N_READ，但 DB 里是 $SEED_MSGS —— 成员读不到全部消息（或读到 0）"
fi

# ---------------------------------------------------------------------------
echo
echo "--- 3) POST /api/threads/<group>/messages（写路径授权）---"
BEFORE="$(PSQL "select count(*) from messages where thread_id='$GROUP'")"

post_text() { # $1=label $2=token $3=expect(201|404) $4=marker
  local label="$1" tok="$2" expect="$3" marker="$4"
  local code
  code="$(curl -s -o /tmp/wo9a_post.json -w '%{http_code}' -X POST \
    "$BASE/api/threads/$GROUP/messages" \
    -H "authorization: Bearer $tok" -H 'content-type: application/json' \
    -d "{\"body\":\"$marker\",\"kind\":\"text\"}")"
  if [ "$code" = "$expect" ]; then
    ok "$label 发文本 HTTP $code"
  else
    bad "$label 发文本 HTTP $code（期望 $expect）body=$(head -c 160 /tmp/wo9a_post.json)"
  fi
}
post_text "成员A(anmoss)" "$TOK_A" 201 "WO9A-MEMBERA-$(date +%s)"
post_text "成员B(Lemy)"   "$TOK_B" 201 "WO9A-MEMBERB-$(date +%s)"
post_text "非成员C(Azur冰弦)" "$TOK_C" 404 "WO9A-NONMEMBER-SHOULD-NOT-EXIST"

AFTER="$(PSQL "select count(*) from messages where thread_id='$GROUP'")"
echo
info "群内消息数 写前=$BEFORE 写后=$AFTER（期望 +2：两个成员各 1 条；非成员 0 条）"
if [ "$((AFTER - BEFORE))" = "2" ]; then
  ok "DB delta = +2（两个成员的写入都落库）"
else
  bad "DB delta = $((AFTER - BEFORE))（期望 +2）"
fi

echo
echo "--- 4) 非成员写入是否**零 mutation**（最关键的一条）---"
NONMEMBER_ROWS="$(PSQL "select count(*) from messages where thread_id='$GROUP' and body like 'WO9A-NONMEMBER-%'")"
if [ "$NONMEMBER_ROWS" = "0" ]; then
  ok "非成员写入零 mutation（DB 里 0 条 WO9A-NONMEMBER-* ）"
else
  bad "非成员写入产生了 $NONMEMBER_ROWS 条文（越权写！）"
fi

echo
echo "--- 5) 成员写入的形态（kind/sender/media 关联）---"
PSQL "select m.kind || ' | ' || coalesce(u.display_name,'?') || ' | ' || left(m.body,26) || ' | media_rows=' || (select count(*) from message_media mm where mm.message_id=m.id)::text
        from messages m left join users u on u.id=m.sender_id
       where m.thread_id='$GROUP' and m.body like 'WO9A-MEMBER%' order by m.created_at"

echo
echo "--- 6) 群内图片消息的**私聊媒体**是否对成员可读、对非成员拒绝 ---"
MEDIA_ID='bbbbbbbb-0003-4003-8003-000000000003'
read_media() { # $1=label $2=token $3=expect
  local label="$1" tok="$2" expect="$3"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/media/$MEDIA_ID" -H "authorization: Bearer $tok")"
  if [ "$code" = "$expect" ]; then ok "$label 读群内图片 HTTP $code"; else bad "$label 读群内图片 HTTP $code（期望 $expect）"; fi
}
read_media "成员A(anmoss)" "$TOK_A" 200
read_media "非成员C(Azur冰弦)" "$TOK_C" 404

echo
echo "=== 清理本轮写入的测试消息 ==="
PSQL "delete from message_media where message_id in (select id from messages where body like 'WO9A-MEMBER%' or body like 'WO9A-NONMEMBER%')" >/dev/null
PSQL "delete from messages where body like 'WO9A-MEMBER%' or body like 'WO9A-NONMEMBER%'" >/dev/null
PSQL "select '清理后群内消息数 = ' || count(*)::text from messages where thread_id='$GROUP'"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "GROUP_AUTHORIZATION_MATRIX: PASS"
  exit 0
else
  echo "GROUP_AUTHORIZATION_MATRIX: FAIL"
  exit 1
fi
