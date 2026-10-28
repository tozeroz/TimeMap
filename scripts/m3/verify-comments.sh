#!/usr/bin/env bash
# M3 Slice 1 验证：帖子详情 / 评论 / 回复（含 comments.parent_id 的层级语义）
#
# 1:1 依据（原版实测，docs/archive/legacy-development/m3/MODEL-VALIDATION.md §2.7）：
#   - 评论区是「顶层评论 + 嵌套回复」（EXPANDED），回复行带「回复 <目标>」
#   - 「评论 N」的计数**把回复也算进去**
#   - 回复可以再被回复 → parent_id 可指向任意一条评论
#
# 全部经 Nginx（http://127.0.0.1/api/...）。取会话用**手机号 + dev sink 取码**（M3 语义）。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1/api
SINK=/run/campus/login-codes
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1"; }
jget() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }
jnum() { printf '%s' "$1" | sed -n "s/.*\"$2\":\([0-9]*\).*/\1/p" | head -1; }

# seed 里的帖子与评论（固定 UUID）
POST=aaaaaaaa-0001-4001-8001-000000000001
TOP=dddddddd-0001-4001-8001-000000000001
REPLY=dddddddd-0002-4001-8001-000000000002

# 取会话（seed 用户 anmoss 的手机号）
TEST_PHONE=13800000001
rm -f "$SINK/8613800000001.json" 2>/dev/null || true
REQ="$(curl -s -m 10 -X POST "$BASE/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\"}")"
SINK_PATH="$(jget "$REQ" sink)"
CODE=""
if [ -n "$SINK_PATH" ] && [ -f "$SINK_PATH" ]; then
  CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK_PATH")"
fi
rm -f "$SINK/8613800000001.json" 2>/dev/null || true
VER=""
if [ -n "$CODE" ]; then
  VER="$(curl -s -m 10 -X POST "$BASE/auth/verify-code" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"$CODE\"}")"
fi
TOKEN="$(jget "$VER" token)"
AUTH=()
[ -n "$TOKEN" ] && AUTH=(-H "Authorization: Bearer $TOKEN")

echo "=== A. 帖子详情 ==="
DET="$(curl -s -m 10 "$BASE/posts/$POST")"
echo "  响应: $(printf '%s' "$DET" | head -c 220)"
CC="$(jnum "$DET" commentCount)"
LC="$(jnum "$DET" likeCount)"
[ -n "$(jget "$DET" body)" ] && ok "详情返回了帖子正文" || bad "详情缺少正文"
# 关键语义：「评论 N」把回复也算进去 → 计数 = 1 顶层 + 1 回复 = 2
if [ "$CC" = "2" ]; then ok "commentCount=2（顶层评论 1 + 回复 1：**计数含回复**）"
else bad "commentCount 期望 2（含回复），实际 '$CC'"; fi
[ -n "$LC" ] && ok "likeCount 存在（=$LC）" || bad "缺少 likeCount"

echo
echo "=== B. 不存在的帖子 → 404 ==="
NF="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/posts/00000000-0000-4000-8000-000000000000")"
[ "$NF" = "404" ] && ok "不存在帖子 → 404" || bad "期望 404，实际 $NF"
BADID="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/posts/not-a-uuid")"
[ "$BADID" = "400" ] && ok "非法 id → 400" || bad "期望 400，实际 $BADID"

echo
echo "=== C. 评论树：嵌套结构 + replyTo（PRESENTATION EXPANDED）==="
TREE="$(curl -s -m 10 "$BASE/posts/$POST/comments")"
echo "  响应: $(printf '%s' "$TREE" | head -c 320)"
printf '%s' "$TREE" | grep -q '"replies"' && ok "顶层评论带 replies 字段（有独立的一层嵌套）" || bad "顶层评论没有 replies 字段"
printf '%s' "$TREE" | grep -q '"total":2' && ok "total=2（含回复）" || bad "total 不是 2"
# replyTo 必须来自 parent_id 指向的那条评论的作者（seed: 顶层由 lemy 发 → replyTo 应为 Lemy）
printf '%s' "$TREE" | grep -q '"replyTo":"Lemy"' && ok "回复行带 replyTo=\\"Lemy\\"（目标来自 parent_id 的作者，不是正文里的 @）" \
  || { bad "回复行缺少正确的 replyTo"; printf '%s' "$TREE" | head -c 400; }

echo
echo "=== D. 发评论需要会话（无 session 夹具：这里故意不带 Authorization）==="
NOAUTH="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/posts/$POST/comments" \
  -H 'Content-Type: application/json' -d '{"body":"未授权"}')"
[ "$NOAUTH" = "401" ] && ok "未登录发评论 → 401" || bad "期望 401，实际 $NOAUTH"

echo
echo "=== E. author 只能来自会话（strict schema）==="
EXTRA="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts/$POST/comments" \
  -H 'Content-Type: application/json' -d '{"body":"x","author":"我伪装的"}')"
[ "$EXTRA" = "400" ] && ok "带 author 字段 → 400（作者由会话决定）" || bad "期望 400，实际 $EXTRA"
EMPTY="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts/$POST/comments" \
  -H 'Content-Type: application/json' -d '{"body":"   "}')"
[ "$EMPTY" = "400" ] && ok "空正文 → 400" || bad "期望 400，实际 $EMPTY"

echo
echo "=== F. 发一条顶层评论 ==="
R1="$(curl -s -m 10 -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts/$POST/comments" \
  -H 'Content-Type: application/json' -d '{"body":"M3-SLICE1-顶层"}')"
C1="$(printf '%s' "$R1" | tail -1)"; B1="$(printf '%s' "$R1" | head -n -1)"
[ "$C1" = "201" ] && ok "发顶层评论 → 201" || bad "期望 201，实际 $C1（$(printf '%s' "$B1" | head -c 120)）"
NEW1="$(jget "$B1" id)"
AUTHOR1="$(PSQL "select coalesce(u.display_name,'-') from comments c left join users u on u.id=c.author_id where c.id='$NEW1'")"
[ "$AUTHOR1" = "anmoss" ] && ok "库中作者 = 会话用户（anmoss），不是客户端传的" || bad "库中作者为 '$AUTHOR1'"
PARENT1="$(PSQL "select coalesce(parent_id::text,'(top)') from comments c where c.id='$NEW1'")"
[ "$PARENT1" = "(top)" ] && ok "顶层评论的 parent_id 为空" || bad "parent_id 期望空，实际 $PARENT1"

echo
echo "=== G. 回复某条顶层评论 ==="
R2="$(curl -s -m 10 -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts/$POST/comments" \
  -H 'Content-Type: application/json' -d "{\"body\":\"M3-SLICE1-回复\",\"parentId\":\"$TOP\"}")"
C2="$(printf '%s' "$R2" | tail -1)"; B2="$(printf '%s' "$R2" | head -n -1)"
[ "$C2" = "201" ] && ok "回复顶层评论 → 201" || bad "期望 201，实际 $C2"
NEW2="$(jget "$B2" id)"
PARENT2="$(PSQL "select coalesce(parent_id::text,'') from comments c where c.id='$NEW2'")"
[ "$PARENT2" = "$TOP" ] && ok "回复的 parent_id 指向被回复的评论（关系被保存）" || bad "parent_id 期望 $TOP，实际 $PARENT2"

echo
echo "=== H. 回复的回复（parent_id 指向任意一条评论）==="
R3="$(curl -s -m 10 -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts/$POST/comments" \
  -H 'Content-Type: application/json' -d "{\"body\":\"M3-SLICE1-回复的回复\",\"parentId\":\"$NEW2\"}")"
C3="$(printf '%s' "$R3" | tail -1)"
[ "$C3" = "201" ] && ok "回复一条回复 → 201（parent_id 不被限制在顶层）" || bad "期望 201，实际 $C3"
# 但它必须归到**同一个顶层评论**下渲染（原版是平面嵌套，不是无限树）
TREE2="$(curl -s -m 10 "$BASE/posts/$POST/comments")"
TOTAL2="$(jnum "$TREE2" total)"
# 期望：原 seed 2 条 + 顶层 1 + 回复 1 + 回复的回复 1 = 5
[ "$TOTAL2" = "5" ] && ok "total=5（新增 3 条后计数正确）" || bad "total 期望 5，实际 $TOTAL2"
ROOT_COUNT="$(printf '%s' "$TREE2" | grep -o '"replies"' | wc -l)"
[ "$ROOT_COUNT" = "2" ] && ok "顶层评论仍是 2 个（新回复归到已有顶层下，没有变成新的顶层）" || bad "顶层评论数为 $ROOT_COUNT（期望 2）"

echo
echo "=== I. parentId 必须属于同一篇帖子 ==="
OTHER_POST="$(PSQL "select id from posts where id <> '$POST' limit 1")"
if [ -n "$OTHER_POST" ]; then
  CROSS="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts/$OTHER_POST/comments" \
    -H 'Content-Type: application/json' -d "{\"body\":\"跨帖挂载\",\"parentId\":\"$TOP\"}")"
  [ "$CROSS" = "400" ] && ok "parentId 属于别的帖子 → 400（不能跨帖挂载）" || bad "期望 400，实际 $CROSS"
else
  bad "找不到另一篇帖子，无法验证跨帖用例"
fi

echo
echo "=== J. 清理本次测试评论 ==="
PSQL "delete from comments where id in ('$NEW1','$NEW2') or body like 'M3-SLICE1-%'" >/dev/null
LEFT="$(PSQL "select count(*) from comments where body like 'M3-SLICE1-%'")"
[ "$LEFT" = "0" ] && ok "测试评论已清理（保留 seed 的 2 条）" || bad "仍有 $LEFT 条测试评论"
FINAL="$(PSQL "select count(*) from comments")"
[ "$FINAL" = "2" ] && ok "评论表回到 seed 状态（2 条）" || bad "评论数期望 2，实际 $FINAL"

echo
if [ "$FAILED" -eq 0 ]; then echo "COMMENTS_RESULT PASS"; else echo "COMMENTS_RESULT FAIL"; fi
exit "$FAILED"
