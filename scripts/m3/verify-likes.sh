#!/usr/bin/env bash
# M3 Slice 2 验证：点赞 / 取消点赞（含幂等、鉴权、跨用户隔离）
#
# 1:1 依据说明（重要）：
#   原版**只读**观察得到：点赞区是整块热区、计数是纯数字无单位、0 赞时计数控件不存在。
#   但**切换行为**与**已点赞态样式**属写操作，禁止在原版取证（BLOCKED_BY_POLICY）——
#   所以本脚本验证的是**我们自建系统**的切换语义，不声称与原版 1:1 一致。
#
# 经 Nginx；会话用手机号 + dev sink 取码（M3 语义）。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1/api
SINK=/run/campus/login-codes
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1"; }
jget() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }
jnum() { printf '%s' "$1" | sed -n "s/.*\"$2\":\([0-9]*\).*/\1/p" | head -1; }
jbool() { printf '%s' "$1" | sed -n "s/.*\"$2\":\(true\|false\).*/\1/p" | head -1; }

POST=aaaaaaaa-0001-4001-8001-000000000001
POST2=aaaaaaaa-0002-4002-8002-000000000002

# ---- 取会话（seed 用户 anmoss = +8613800000001）----
TEST_PHONE=13800000001
rm -f "$SINK/8613800000001.json" 2>/dev/null || true
REQ="$(curl -s -m 10 -X POST "$BASE/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\"}")"
SINK_PATH="$(jget "$REQ" sink)"
CODE=""
[ -n "$SINK_PATH" ] && [ -f "$SINK_PATH" ] && CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK_PATH")"
rm -f "$SINK/8613800000001.json" 2>/dev/null || true
TOKEN=""
if [ -n "$CODE" ]; then
  VER="$(curl -s -m 10 -X POST "$BASE/auth/verify-code" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"$CODE\"}")"
  TOKEN="$(jget "$VER" token)"
fi
AUTH=()
[ -n "$TOKEN" ] && AUTH=(-H "Authorization: Bearer $TOKEN")
ME_ID="$(jget "$(curl -s -m 10 "$BASE/auth/me" "${AUTH[@]}")" id)"
[ -n "$ME_ID" ] && ok "已取得会话（作者身份 = anmoss）" || bad "未能取得会话，后续断言不可信"

SEED_LIKES="$(PSQL "select count(*) from likes where post_id='$POST'")"
echo "  seed 下 $POST 的赞数 = $SEED_LIKES（seed 里是 lemy 点的）"

echo
echo "=== A. 未登录时的读取 ==="
D0="$(curl -s -m 10 "$BASE/posts/$POST")"
[ "$(jbool "$D0" likedByMe)" = "false" ] && ok "未登录读详情：likedByMe=false" || bad "未登录 likedByMe 应为 false（$D0）"
[ "$(jnum "$D0" likeCount)" = "$SEED_LIKES" ] && ok "未登录读详情：likeCount=$SEED_LIKES（来自 DB）" || bad "likeCount 不符：$(jnum "$D0" likeCount)"
L0="$(curl -s -m 10 "$BASE/posts")"
printf '%s' "$L0" | grep -q '"likedByMe":false' && ok "列表带 likedByMe 字段（未登录恒 false）" || bad "列表缺少 likedByMe"
printf '%s' "$L0" | grep -q '"likeCount"' && ok "列表带 likeCount 字段" || bad "列表缺少 likeCount"
printf '%s' "$L0" | grep -q '"commentCount"' && ok "列表带 commentCount 字段" || bad "列表缺少 commentCount"

echo
echo "=== B. 跨用户隔离：seed 里别人（lemy）点过赞，不能算成我的 ==="
DA="$(curl -s -m 10 "$BASE/posts/$POST" "${AUTH[@]}")"
# anmoss 此时还没点过赞 → 即使 likeCount>0，likedByMe 也必须是 false
if [ "$(jbool "$DA" likedByMe)" = "false" ]; then
  ok "likeCount=$(jnum "$DA" likeCount) 但 likedByMe=false（别人的赞不算我的）"
else
  bad "likedByMe 应为 false（把别人的赞算成了我的）: $DA"
fi

echo
echo "=== C. 鉴权：未登录不能点赞/取消 ==="
NP="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/posts/$POST/like")"
[ "$NP" = "401" ] && ok "未登录点赞 → 401" || bad "期望 401，实际 $NP"
ND="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X DELETE "$BASE/posts/$POST/like")"
[ "$ND" = "401" ] && ok "未登录取消点赞 → 401" || bad "期望 401，实际 $ND"

echo
echo "=== D. 点赞 → 计数 +1、likedByMe 变 true、DB 有行 ==="
R1="$(curl -s -m 10 -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts/$POST/like")"
C1="$(printf '%s' "$R1" | tail -1)"; B1="$(printf '%s' "$R1" | head -n -1)"
[ "$C1" = "200" ] && ok "点赞 → 200" || bad "期望 200，实际 $C1"
[ "$(jbool "$B1" liked)" = "true" ] && ok "响应 liked=true" || bad "响应 liked 应为 true"
EXP=$((SEED_LIKES + 1))
[ "$(jnum "$B1" likeCount)" = "$EXP" ] && ok "likeCount 变为 $EXP" || bad "likeCount 期望 $EXP，实际 $(jnum "$B1" likeCount)"
DBROW="$(PSQL "select count(*) from likes where post_id='$POST' and user_id='$ME_ID'")"
[ "$DBROW" = "1" ] && ok "DB 中存在我的点赞行" || bad "DB 中没有我的点赞行（$DBROW）"
DA2="$(curl -s -m 10 "$BASE/posts/$POST" "${AUTH[@]}")"
[ "$(jbool "$DA2" likedByMe)" = "true" ] && ok "带会话读详情：likedByMe=true" || bad "likedByMe 应为 true"

echo
echo "=== E. 重复点赞幂等（计数不重复增加）==="
R2="$(curl -s -m 10 "${AUTH[@]}" -X POST "$BASE/posts/$POST/like")"
[ "$(jnum "$R2" likeCount)" = "$EXP" ] && ok "重复点赞后 likeCount 仍为 $EXP（幂等）" || bad "重复点赞把计数搞成了 $(jnum "$R2" likeCount)"
CNT="$(PSQL "select count(*) from likes where post_id='$POST' and user_id='$ME_ID'")"
[ "$CNT" = "1" ] && ok "DB 中我的点赞行仍只有 1 行" || bad "DB 中我的点赞行有 $CNT 行"

echo
echo "=== F. 取消点赞 → 计数 -1、likedByMe 变 false、DB 行消失 ==="
R3="$(curl -s -m 10 "${AUTH[@]}" -X DELETE "$BASE/posts/$POST/like")"
[ "$(jbool "$R3" liked)" = "false" ] && ok "响应 liked=false" || bad "响应 liked 应为 false"
[ "$(jnum "$R3" likeCount)" = "$SEED_LIKES" ] && ok "likeCount 回到 $SEED_LIKES" || bad "likeCount 期望 $SEED_LIKES，实际 $(jnum "$R3" likeCount)"
DBROW2="$(PSQL "select count(*) from likes where post_id='$POST' and user_id='$ME_ID'")"
[ "$DBROW2" = "0" ] && ok "DB 中我的点赞行已删除" || bad "DB 中仍有我的点赞行"
DA3="$(curl -s -m 10 "$BASE/posts/$POST" "${AUTH[@]}")"
[ "$(jbool "$DA3" likedByMe)" = "false" ] && ok "带会话读详情：likedByMe 回到 false" || bad "likedByMe 应为 false"

echo
echo "=== G. 重复取消幂等 ==="
R4="$(curl -s -m 10 "${AUTH[@]}" -X DELETE "$BASE/posts/$POST/like")"
[ "$(jnum "$R4" likeCount)" = "$SEED_LIKES" ] && ok "重复取消后 likeCount 仍为 $SEED_LIKES（幂等）" || bad "重复取消改变了计数：$(jnum "$R4" likeCount)"

echo
echo "=== H. 错误输入 ==="
BADID="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts/not-a-uuid/like")"
[ "$BADID" = "400" ] && ok "非法 id → 400" || bad "期望 400，实际 $BADID"
NF="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts/00000000-0000-4000-8000-000000000000/like")"
[ "$NF" = "404" ] && ok "不存在的帖子 → 404" || bad "期望 404，实际 $NF"

echo
echo "=== I. 另一篇帖子不受影响（隔离）==="
P2="$(curl -s -m 10 "$BASE/posts/$POST2" "${AUTH[@]}")"
[ "$(jbool "$P2" likedByMe)" = "false" ] && ok "另一篇帖子的 likedByMe=false（点赞不会串帖）" || bad "另一篇帖子 likedByMe 异常"
P2CNT="$(PSQL "select count(*) from likes where post_id='$POST2'")"
[ "$(jnum "$P2" likeCount)" = "$P2CNT" ] && ok "另一篇帖子的 likeCount 与 DB 一致（$P2CNT）" || bad "另一篇帖子 likeCount 不一致"

echo
echo "=== J. 清理并回到 seed 状态 ==="
PSQL "delete from likes where user_id='$ME_ID'" >/dev/null
FINAL="$(PSQL "select count(*) from likes where post_id='$POST'")"
[ "$FINAL" = "$SEED_LIKES" ] && ok "点赞表回到 seed 状态（$SEED_LIKES 条）" || bad "点赞数期望 $SEED_LIKES，实际 $FINAL"
MYLIKES="$(PSQL "select count(*) from likes where user_id='$ME_ID'")"
[ "$MYLIKES" = "0" ] && ok "测试账号的点赞已清理" || bad "测试账号仍有 $MYLIKES 条点赞"

echo
if [ "$FAILED" -eq 0 ]; then echo "LIKES_RESULT PASS"; else echo "LIKES_RESULT FAIL"; fi
exit "$FAILED"
