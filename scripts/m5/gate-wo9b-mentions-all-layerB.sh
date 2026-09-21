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
  # ⚠️ 期望值是 **true/false**，不是 **t/f** —— 我第一版写成 t/f 而误判 FAIL：
  #   PostgreSQL 里 `boolean::text` 得到 'true'/'false'；
  #   只有**不经 cast** 直接输出 boolean 时 psql 才显示 't'/'f'。
  #   这里做了归一化，两种写法都能接受，避免将来因为渲染形式再误判一次。
  MA_NORM="$(printf '%s' "$MA" | tr 'A-Z' 'a-z')"
  if [ "$MA_NORM" = "true" ] || [ "$MA_NORM" = "t" ]; then ok "DB: mentions_all = true"; else bad "DB: mentions_all = $MA（期望 true／t）"; fi
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
  *)  bad "direct 上 mentionsAll **未被拒绝**（HTTP $D_CODE）" ;;
esac
# 口径（审核 48 强制要求修正）：
#   ~~"全体在两人会话里语义不可能"~~ ← 这个说法**已被否决**：
#     direct chat 里 @所有人 **并非逻辑上不可能**，只是**我方产品选择**不提供该语义。
#   冻结口径：
#     MENTIONS_ALL_DIRECT_POLICY: REJECT
#     PROVENANCE:                 OUR_DESIGN_CHOICE
#     ORIGINAL_BEHAVIOR:          NOT_EVALUATED
info "口径：MENTIONS_ALL_DIRECT_POLICY=REJECT ／ PROVENANCE=OUR_DESIGN_CHOICE ／ ORIGINAL_BEHAVIOR=NOT_EVALUATED"
if [ "$((D_AFTER - D_BEFORE))" = "0" ]; then ok "direct DB delta = 0（零 mutation）"; else bad "direct DB delta = $((D_AFTER - D_BEFORE))（期望 0）"; fi

# ---------------------------------------------------------------------------
echo
echo "--- 4b) 敏感度：**自然对照变量对**（比突变构建更省且更强）---"
#
# 本项目既有纪律：优先用**自然对照变量对**证明断言有判别力。
# 这里用它替代"改代码→重构建→部署→跑→回滚"的突变流程，成本低一个数量级：
#   对照 A（已由第 7 步覆盖）：
#       群 + mentionsAll=true  → DB true
#       群 + 不带 mentionsAll   → DB **false**   ⇒ MENTIONS_ALL_DB 能区分真假（不是恒真）
#   对照 B（本步）：
#       direct + mentionsAll=true  → 400
#       direct + **不带** mentionsAll → 应当 **201**  ⇒ 那个 400 是由 mentionsAll 引起的，
#                                                     而**不是**"direct 一律被拒"
D_CTRL_MARK="WO9B-DIRECT-CTRL-$(date +%s)"
D_CTRL_BEFORE="$(PSQL "select count(*) from messages where thread_id='$DIRECT'")"
D_CTRL_CODE="$(curl -s -o /tmp/wo9b_direct_ctrl.json -w '%{http_code}' -X POST \
  "$BASE/api/threads/$DIRECT/messages" \
  -H "authorization: Bearer $TOK_A" -H 'content-type: application/json' \
  -d "{\"body\":\"$D_CTRL_MARK\",\"kind\":\"text\"}")"
D_CTRL_AFTER="$(PSQL "select count(*) from messages where thread_id='$DIRECT'")"
info "direct 对照组（不带 mentionsAll）HTTP $D_CTRL_CODE  delta=$((D_CTRL_AFTER - D_CTRL_BEFORE))"
if [ "$D_CTRL_CODE" = "201" ] && [ "$((D_CTRL_AFTER - D_CTRL_BEFORE))" = "1" ]; then
  ok "敏感度对照 B：direct 不带 mentionsAll → 201 且落库（证明上面的 400 确由 mentionsAll 引起）"
else
  bad "敏感度对照 B 不成立：direct 不带 mentionsAll 得到 HTTP $D_CTRL_CODE、delta=$((D_CTRL_AFTER - D_CTRL_BEFORE))（期望 201/+1）—— 那样上面那条 400 就无法归因于 mentionsAll"
fi
PSQL "delete from messages where body='$D_CTRL_MARK'" >/dev/null

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

# ---------------------------------------------------------------------------
echo
echo "--- 5b) **校验顺序**（审核 49 冻结）：非成员同时带 mentionsAll+mentions 必须 **404**（不是 400）---"
#
# 为什么单独立一条：审核 49 明确把校验顺序写死，理由是"错误优先级会影响 Gate 是否真的覆盖目标分支"。
#   冻结顺序：1 authenticate → 2 **non-member 404** → 3 kind policy → 4 互斥 → 5 逐人提及目标
#   因此非成员 + 两个字段同时出现时：
#     正确 → **404**（第 2 步先拦）
#     错误 → 400（例如先判了 kind 或互斥）—— 那既违反冻结顺序，
#            也把"你不在这个会话里"这条先决条件暴露成了另一类错误。
PREC_CODE="$(curl -s -o /tmp/wo9b_prec.json -w '%{http_code}' -X POST \
  "$BASE/api/threads/$GROUP/messages" \
  -H "authorization: Bearer $TOK_C" -H 'content-type: application/json' \
  -d '{"body":"WO9B-PREC-SHOULD-NOT-EXIST","kind":"text","mentionsAll":true,"mentions":["22222222-2222-4222-8222-222222222222"]}')"
info "非成员 + 双字段 HTTP $PREC_CODE  body=$(head -c 140 /tmp/wo9b_prec.json)"
if [ "$PREC_CODE" = "404" ]; then
  ok "校验顺序正确：非成员拿到 404（第 2 步先于第 4 步）"
else
  bad "校验顺序**错误**：非成员拿到 HTTP $PREC_CODE（期望 404）—— 说明 kind/互斥检查排在了成员判定之前"
fi
PREC_LEAK="$(PSQL "select count(*) from messages where body like 'WO9B-PREC-%'")"
if [ "$PREC_LEAK" = "0" ]; then ok "顺序用例零残留"; else bad "顺序用例残留 $PREC_LEAK 条"; fi
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
echo "--- 7) NORMAL_GROUP_MESSAGE_MENTIONS_ALL_FALSE：普通群消息必须为 false（不得默认 true）---"
NORM_MARK="WO9B-NORM-$(date +%s)"
NC="$(curl -s -o /tmp/wo9b_norm.json -w '%{http_code}' -X POST \
  "$BASE/api/threads/$GROUP/messages" \
  -H "authorization: Bearer $TOK_A" -H 'content-type: application/json' \
  -d "{\"body\":\"$NORM_MARK\",\"kind\":\"text\"}")"
if [ "$NC" = "201" ]; then ok "普通群消息发送 201"; else bad "普通群消息发送 HTTP $NC（期望 201）"; fi
NROW="$(PSQL "select id from messages where body='$NORM_MARK' limit 1")"
if [ -n "$NROW" ]; then
  NVAL="$(PSQL "select coalesce(mentions_all::text,'<no-col>') from messages where id='$NROW'")"
  # 同上的归一化：`boolean::text` 给 'false'，不 cast 才给 'f'
  NVAL_NORM="$(printf '%s' "$NVAL" | tr 'A-Z' 'a-z')"
  if [ "$NVAL_NORM" = "false" ] || [ "$NVAL_NORM" = "f" ]; then ok "普通群消息 mentions_all = false（未默认 true）"; else bad "普通群消息 mentions_all = $NVAL（期望 false／f）"; fi
else
  bad "普通群消息未落库（无法判定 mentions_all 默认值）"
fi

# ---------------------------------------------------------------------------
echo
echo "--- 8) MIXED_ALL_AND_INDIVIDUAL_REJECT：mentionsAll=true 且逐人 mentions 非空 → 4xx 且零 mutation ---"
#
# ⚠️⚠️ 这条断言我第一版**因为错误原因通过**（改前就 PASS），必须记下来：
#   第一版用 anmoss 的 id 当提及目标，而登录身份**也是 anmoss** → 服务端返回
#     400 {"error":"cannot_mention_self"}
#   那是"不能提及自己"，**与"mentionsAll 与逐人提及互斥"毫无关系**。
#   而改前服务端**根本不知道 mentionsAll**，所以那种 400 完全不能证明本不变量成立。
#   → 这正是本项目纪律禁止的"只断 4xx"：**断言必须指明具体错误码**。
#   → 修正：① 提及目标改为**另一位成员**（Lemy，避免 cannot_mention_self 干扰）
#            ② 要求响应里的 error **必须是"互斥冲突"那一类**，而不是任意 4xx
#   诊断脚本：scripts/m5/diagnose-mixed-mentions-code.sh（实测上述 400 的具体原因）
MIX_TARGET='22222222-2222-4222-8222-222222222222'   # Lemy（**不是**当前登录的 anmoss）
MIX_MARK="WO9B-MIX-$(date +%s)"
M_BEFORE="$(PSQL "select count(*) from messages where thread_id='$GROUP'")"
MC="$(curl -s -o /tmp/wo9b_mix.json -w '%{http_code}' -X POST \
  "$BASE/api/threads/$GROUP/messages" \
  -H "authorization: Bearer $TOK_A" -H 'content-type: application/json' \
  -d "{\"body\":\"$MIX_MARK\",\"kind\":\"text\",\"mentionsAll\":true,\"mentions\":[\"$MIX_TARGET\"]}")"
M_AFTER="$(PSQL "select count(*) from messages where thread_id='$GROUP'")"
MIX_ERR="$(python3 -c "
import json
try:
    print(json.load(open('/tmp/wo9b_mix.json')).get('error') or '')
except Exception:
    print('')
" 2>/dev/null)"
info "混合提交 HTTP $MC  error=$MIX_ERR  body=$(head -c 160 /tmp/wo9b_mix.json)"
case "$MC" in
  4*)
    # 必须是"互斥冲突"这一类错误码，而不是任意 4xx（例如 cannot_mention_self）
    case "$MIX_ERR" in
      *conflict*|*mutually*|*exclusive*|*mentions_all*)
        ok "混用被拒绝且错误码指明冲突（HTTP $MC error=$MIX_ERR）" ;;
      cannot_mention_self)
        bad "HTTP $MC 但 error=cannot_mention_self（**与互斥不变量无关** —— 断言又变成了'因为错误原因通过'）" ;;
      '')
        bad "HTTP $MC 但响应里没有 error 字段，无法证明是互斥冲突所致" ;;
      *)
        bad "HTTP $MC 但 error=$MIX_ERR（未指明'mentionsAll 与逐人提及互斥'，不足以支撑本不变量）" ;;
    esac ;;
  *) bad "混用未被拒绝（HTTP $MC error=$MIX_ERR）—— 两者必须**互斥**" ;;
esac
if [ "$((M_AFTER - M_BEFORE))" = "0" ]; then ok "混合提交 DB delta = 0（零 mutation）"; else bad "混合提交 DB delta = $((M_AFTER - M_BEFORE))（期望 0）"; fi
MROWS="$(PSQL "select count(*) from messages where body='$MIX_MARK'")"
if [ "$MROWS" = "0" ]; then ok "混合提交未落库（DB 里 0 条）"; else bad "混合提交落了 $MROWS 条"; fi
MRM="$(PSQL "select count(*) from message_mentions mm join messages m on m.id=mm.message_id where m.body='$MIX_MARK'")"
if [ "$MRM" = "0" ]; then ok "混合提交零 mention 残留"; else bad "混合提交留下 $MRM 条 mention 行"; fi

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
