#!/usr/bin/env bash
# WO#9B **层 B** Gate：mentions_all 持久化与消息语义（服务器侧）
#
# ## 为什么层 B 单独一个脚本（审核记录 47 要求）
#   层 A（AT 面板 UI）由设备侧 gate-wo9b-at-panel-layerA.mjs 断言；
#   层 B（数据模型/接口语义/权限/持久化）在这里断言 ——
#   **两层状态键互不掩盖**：UI 层通过**不等于**权限或语义是 conformance。
#
# ## 本脚本要保护的 invariant
#   ① @所有人 = messages.mentions_all 为**显式布尔**，且**不写任何 message_mentions 行**
#      （禁止伪造 user id —— AUDIT 既有纪律）
#   ② 非 group thread 必须**拒绝**（4xx，不是忽略）+ **DB delta = 0**
#   ③ 非成员必须拒绝（404，沿用既有语义）+ **零 mutation**
#   ④ 读模型返回该字段，且与 DB 一致
#   ⑤ reload/重读后仍保留（它是消息的**持久属性**）
#
# ## 已知未取证（不在此判定，见计划 §三/§四）
#   AT_ALL_PERMISSION_MODEL: NOT_EVALUATED
#     —— 原版是否限制"谁能 @所有人"**无证据**（thread_members 无角色列；
#        要观察需触发原版的 @all，那是写操作 → BLOCKED_BY_POLICY）。
#        本脚本只验证"**是群成员即可用**"这一**我方最小选择**在实现上自洽，
#        **不**声称它等于原版权限模型。
set -uo pipefail

BASE="http://127.0.0.1:3001"
GROUP='aaaaaaaa-0001-4001-8001-00000000000a'
DIRECT='ffffffff-0001-4001-8001-000000000001'
PW_DB="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW_DB" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

FAIL=0
ok()   { echo "  PASS $1"; }
bad()  { echo "  FAIL $1"; FAIL=1; }
info() { echo "  info $1"; }

login() {
  local phone="$1"
  curl -s -X POST "$BASE/api/auth/request-code" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\"}" >/dev/null 2>&1
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

echo "=== WO#9B 层 B Gate：mentions_all 语义 ==="
echo "  群: $GROUP ／ direct: $DIRECT"
echo

TOK_A="$(login '+8613800000001')"   # anmoss = 群成员
TOK_C="$(login '+8613800000003')"   # Azur冰弦 = **非成员**
[ -z "$TOK_A" ] && bad "成员A 登录取不到 token"
[ -z "$TOK_C" ] && bad "非成员C 登录取不到 token"

# ---------------------------------------------------------------------------
echo "--- 1) 列是否存在（改前应为 NOT exists）---"
COL="$(PSQL "select count(*) from information_schema.columns where table_name='messages' and column_name='mentions_all'")"
if [ "$COL" = "1" ]; then ok "messages.mentions_all 列存在"; else bad "messages.mentions_all 列**不存在**（COL=$COL）"; fi

# ---------------------------------------------------------------------------
echo
echo "--- 2) 群成员发 mentionsAll=true → 应 201 且 DB 落库 ---"
BEFORE_MSG="$(PSQL "select count(*) from messages where thread_id='$GROUP'")"
BEFORE_MM="$(PSQL "select count(*) from message_media")"
MARK="WO9B-ALL-$(date +%s)"
CODE="$(curl -s -o /tmp/wo9b_post.json -w '%{http_code}' -X POST \
  "$BASE/api/threads/$GROUP/messages" \
  -H "authorization: Bearer $TOK_A" -H 'content-type: application/json' \
  -d "{\"body\":\"$MARK\",\"kind\":\"text\",\"mentionsAll\":true}")"
info "POST HTTP $CODE  body=$(head -c 200 /tmp/wo9b_post.json)"
if [ "$CODE" = "201" ]; then ok "群成员带 mentionsAll 发送 201"; else bad "群成员带 mentionsAll 发送 HTTP $CODE（期望 201）"; fi

AFTER_MSG="$(PSQL "select count(*) from messages where thread_id='$GROUP'")"
if [ "$((AFTER_MSG - BEFORE_MSG))" = "1" ]; then ok "DB delta = +1"; else bad "DB delta = $((AFTER_MSG - BEFORE_MSG))（期望 +1）"; fi

NEW_ID="$(PSQL "select id from messages where body='$MARK' limit 1")"
if [ -n "$NEW_ID" ]; then
  MA="$(PSQL "select coalesce(mentions_all::text,'<no-col>') from messages where id='$NEW_ID'")"
  if [ "$MA" = "t" ]; then ok "DB: mentions_all = true"; else bad "DB: mentions_all = $MA（期望 t）"; fi
  MM="$(PSQL "select count(*) from message_mentions where message_id='$NEW_ID'")"
  if [ "$MM" = "0" ]; then ok "**message_mentions = 0 行**（未伪造逐人提及）"; else bad "message_mentions = $MM 行（期望 0）"; fi
  FAKE="$(PSQL "select count(*) from message_mentions mm left join users u on u.id=mm.mentioned_user_id where mm.message_id='$NEW_ID' and u.id is null")"
  if [ "$FAKE" = "0" ]; then ok "反向断言：无伪造 user id"; else bad "发现伪造 user id 行：$FAKE"; fi
else
  bad "没能在 DB 里找到刚发出的消息（无法继续判定 DB 语义）"
fi

# ---------------------------------------------------------------------------
echo
echo "--- 3) 读模型是否返回该字段且与 DB 一致 ---"
curl -s "$BASE/api/threads/$GROUP/messages" -H "authorization: Bearer $TOK_A" -o /tmp/wo9b_read.json -w "  读消息 HTTP %{http_code}\n"
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/wo9b_read.json'))
except Exception as e:
    print(f"  FAIL 读模型响应无法解析: {e}"); raise SystemExit
items = d.get('items', [])
hit = [m for m in items if str(m.get('body','')).startswith('WO9B-ALL-')]
if not hit:
    print("  FAIL 读模型里找不到刚发的 mentions_all 消息")
else:
    m = hit[-1]
    has_field = 'mentionsAll' in m
    print(f"  {'PASS' if has_field else 'FAIL'} 读模型{'含' if has_field else '**不含**'} mentionsAll 字段（值={m.get('mentionsAll')!r}）")
    print(f"  {'PASS' if m.get('mentionsAll') is True else 'FAIL'} 读模型值 == true")
PY

# ---------------------------------------------------------------------------
echo
echo "--- 4) direct 会话必须**拒绝** mentionsAll（4xx）且 DB delta = 0 ---"
D_BEFORE="$(PSQL "select count(*) from messages where thread_id='$DIRECT'")"
D_CODE="$(curl -s -o /tmp/wo9b_direct.json -w '%{http_code}' -X POST \
  "$BASE/api/threads/$DIRECT/messages" \
  -H "authorization: Bearer $TOK_A" -H 'content-type: application/json' \
  -d '{"body":"WO9B-DIRECT-SHOULD-NOT-EXIST","kind":"text","mentionsAll":true}')"
D_AFTER="$(PSQL "select count(*) from messages where thread_id='$DIRECT'")"
info "direct POST HTTP $D_CODE  body=$(head -c 160 /tmp/wo9b_direct.json)"
case "$D_CODE" in
  4*) ok "direct 上 mentionsAll 被拒绝（HTTP $D_CODE）" ;;
  *)  bad "direct 上 mentionsAll **未被拒绝**（HTTP $D_CODE）—— '全体'在两人会话里语义不可能" ;;
esac
if [ "$((D_AFTER - D_BEFORE))" = "0" ]; then ok "direct DB delta = 0（零 mutation）"; else bad "direct DB delta = $((D_AFTER - D_BEFORE))（期望 0）"; fi

# ---------------------------------------------------------------------------
echo
echo "--- 5) 非成员带 mentionsAll → 404 且**零 mutation** ---"
N_BEFORE="$(PSQL "select count(*) from messages where thread_id='$GROUP'")"
N_CODE="$(curl -s -o /tmp/wo9b_nonmember.json -w '%{http_code}' -X POST \
  "$BASE/api/threads/$GROUP/messages" \
  -H "authorization: Bearer $TOK_C" -H 'content-type: application/json' \
  -d '{"body":"WO9B-NONMEMBER-SHOULD-NOT-EXIST","kind":"text","mentionsAll":true}')"
N_AFTER="$(PSQL "select count(*) from messages where thread_id='$GROUP'")"
info "非成员 POST HTTP $N_CODE"
if [ "$N_CODE" = "404" ]; then ok "非成员被拒 404"; else bad "非成员 POST HTTP $N_CODE（期望 404）"; fi
if [ "$((N_AFTER - N_BEFORE))" = "0" ]; then ok "非成员 DB delta = 0（零 mutation）"; else bad "非成员 DB delta = $((N_AFTER - N_BEFORE))（期望 0）"; fi
# 分别断言两条**不同性质**的越权/错误写入 —— 我第一版把它们合成了一条，
# 结果消息里写"越权写入残留"，但实际命中的是 direct 那条（direct 在改前是**被接受**的）。
# 合并计数会把"非成员越权"与"direct 不该被接受"混成一个信号，定位时就会误导。
NL="$(PSQL "select count(*) from messages where body like 'WO9B-NONMEMBER-%'")"
if [ "$NL" = "0" ]; then ok "非成员越权写入零残留（DB 里 0 条 WO9B-NONMEMBER-*）"; else bad "非成员越权写入残留 $NL 条"; fi
DL="$(PSQL "select count(*) from messages where body like 'WO9B-DIRECT-%'")"
if [ "$DL" = "0" ]; then ok "direct 上的 mentionsAll 写入零残留（DB 里 0 条 WO9B-DIRECT-*）"; else bad "direct 上被接受了 $DL 条写入（应被 4xx 拒绝，不该落库）"; fi

# ---------------------------------------------------------------------------
echo
echo "--- 6) 持久性：重新读取（模拟 reload 后的读路径）仍带该标记 ---"
curl -s "$BASE/api/threads/$GROUP/messages" -H "authorization: Bearer $TOK_A" -o /tmp/wo9b_read2.json
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/wo9b_read2.json'))
except Exception:
    print("  FAIL 第二次读无法解析"); raise SystemExit
hit = [m for m in d.get('items', []) if str(m.get('body','')).startswith('WO9B-ALL-')]
if hit and hit[-1].get('mentionsAll') is True:
    print("  PASS 第二次读取仍为 mentionsAll=true（持久）")
else:
    print("  FAIL 第二次读取未保留 mentionsAll")
PY

# ---------------------------------------------------------------------------
echo
echo "=== 清理本轮写入的测试消息 ==="
PSQL "delete from message_media where message_id in (select id from messages where body like 'WO9B-%')" >/dev/null
PSQL "delete from message_mentions where message_id in (select id from messages where body like 'WO9B-%')" >/dev/null
PSQL "delete from messages where body like 'WO9B-%'" >/dev/null
PSQL "select '清理后群内消息数 = ' || count(*)::text from messages where thread_id='$GROUP'"
info "message_media 总数 = $(PSQL "select count(*) from message_media")（应为 1，即种子里那一条）"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "MENTIONS_ALL_SEMANTICS: PASS"
  exit 0
else
  echo "MENTIONS_ALL_SEMANTICS: FAIL"
  exit 1
fi
