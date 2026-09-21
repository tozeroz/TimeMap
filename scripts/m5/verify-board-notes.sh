#!/usr/bin/env bash
# M5 Slice 1（留言板 board_notes）契约验证
#
# 一致性依据（可采信只读证据 supplements/message-board.json）：
#   仅双方可见 / 空态「可以给同学留言噢」/ 按钮「留言」/ 表情行 7 个
# 模型结论 SUPPORTED：用户对用户的私密留言。
#
# 断言：
#  B1 甲给乙留言 → 201，且**双方都能读到**
#  B2 **第三方读不到**（返回空列表，且不是 403 —— 不泄漏"这两人之间有没有留言"）
#  B3 给自己留言 → 400
#  B4 空正文 / 超长正文 → 400
#  B5 不存在的用户 → 404
#  B6 未登录 → 401
#  B7 接口返回原版口径字段（visibleTo=two_parties_only、emptyText=可以给同学留言噢）
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
SINK=/run/campus/login-codes

U1='11111111-1111-4111-8111-111111111111'
U2='22222222-2222-4222-8222-222222222222'

login_as() {
  local phone="$1" req sink code
  req="$(curl -s -m 10 -X POST "$BASE/api/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$phone\"}")"
  sink="$(printf '%s' "$req" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
  [ -n "$sink" ] && [ -f "$sink" ] && code="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$sink")"
  curl -s -m 10 -X POST "$BASE/api/auth/verify-code" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}
rm -f "$SINK"/*.json 2>/dev/null || true

echo "=== 0. 三个真实账号（甲、乙、丙）==="
P_A="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
P_B="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
P_C="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
T_A="$(login_as "$P_A")"; ID_A="$(PSQL "select id from users where phone_e164='+86$P_A'")"
T_B="$(login_as "$P_B")"; ID_B="$(PSQL "select id from users where phone_e164='+86$P_B'")"
T_C="$(login_as "$P_C")"; ID_C="$(PSQL "select id from users where phone_e164='+86$P_C'")"
[ -n "$T_A" ] && [ -n "$T_B" ] && [ -n "$T_C" ] && ok "三个账号就绪（甲/乙/丙）" || { bad "登录失败"; exit 1; }

echo
echo "=== B1 甲给乙留言 → 双方都能读到 ==="
R="$(curl -s -m 10 -w '\n%{http_code}' -X POST "$BASE/api/board-notes/$ID_B" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_A" -d '{"body":"M5 留言测试：你好呀"}')"
C="$(printf '%s' "$R" | tail -1)"
[ "$C" = "201" ] && ok "甲留言 → 201" || bad "期望 201，实际 $C（$(printf '%s' "$R" | head -1 | head -c 120)）"
RA="$(curl -s -m 10 "$BASE/api/board-notes/$ID_B" -H "Authorization: Bearer $T_A")"
RB="$(curl -s -m 10 "$BASE/api/board-notes/$ID_A" -H "Authorization: Bearer $T_B")"
printf '%s' "$RA" | grep -q 'M5 留言测试' && ok "**甲（发送方）能读到**" || bad "甲方读不到：$(printf '%s' "$RA" | head -c 120)"
printf '%s' "$RB" | grep -q 'M5 留言测试' && ok "**乙（接收方）能读到**（仅双方可见的正面）" || bad "乙方读不到：$(printf '%s' "$RB" | head -c 120)"
printf '%s' "$RA" | grep -q '"mine":true' && ok "甲的视角 mine=true" || bad "mine 标记不对"
printf '%s' "$RB" | grep -q '"mine":false' && ok "乙的视角 mine=false（同一条留言，双方视角不同）" || bad "乙的 mine 标记不对"

echo
echo "=== B2 第三方读不到（且不是 403）==="
RC="$(curl -s -m 10 -w '\n%{http_code}' "$BASE/api/board-notes/$ID_B" -H "Authorization: Bearer $T_C")"
CC="$(printf '%s' "$RC" | tail -1)"; BC="$(printf '%s' "$RC" | head -1)"
[ "$CC" = "200" ] && ok "第三方 → 200（而不是 403：不泄漏两人之间有没有留言）" || bad "期望 200，实际 $CC"
printf '%s' "$BC" | grep -q 'M5 留言测试' && bad "**第三方竟然读到了他人留言！**" || ok "**第三方读不到内容**（列表里没有那条留言）"
# 补充：第三方与乙之间确实没有留言，所以这是"空列表"而不是"被拒"
printf '%s' "$BC" | grep -q '"items":\[\]' && ok "第三方看到的是空列表（空态文案：$(printf '%s' "$BC" | sed -n 's/.*"emptyText":"\([^"]*\)".*/\1/p')）" || bad "第三方响应形态异常"

echo
echo "=== B3 给自己留言 → 400 ==="
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/board-notes/$ID_A" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_A" -d '{"body":"给自己"}')"
[ "$C" = "400" ] && ok "**给自己留言 → 400**（与 DB 层 CHECK(from<>to) 双重保险）" || bad "期望 400，实际 $C"

echo
echo "=== B4 空正文 / 超长 → 400 ==="
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/board-notes/$ID_B" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_A" -d '{"body":"   "}')"
[ "$C" = "400" ] && ok "空正文 → 400" || bad "期望 400，实际 $C"
LONG="$(python3 -c "print('x'*201)")"
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/board-notes/$ID_B" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_A" -d "{\"body\":\"$LONG\"}")"
[ "$C" = "400" ] && ok "超长正文（201 字）→ 400" || bad "期望 400，实际 $C"

echo
echo "=== B5 不存在的用户 → 404 ==="
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/board-notes/00000000-0000-4000-8000-000000000000" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_A" -d '{"body":"给不存在的人"}')"
[ "$C" = "404" ] && ok "给不存在的用户留言 → 404" || bad "期望 404，实际 $C"

echo
echo "=== B6 未登录 → 401 ==="
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/board-notes/$ID_B")"
[ "$C" = "401" ] && ok "未登录读留言 → 401" || bad "期望 401，实际 $C"

echo
echo "=== B7 原版口径字段 ==="
printf '%s' "$RA" | grep -q '"visibleTo":"two_parties_only"' && ok "返回 visibleTo=two_parties_only（对应原版「仅双方可见」）" || bad "缺少 visibleTo 口径"
printf '%s' "$RA" | grep -q '"emptyText":"可以给同学留言噢"' && ok "返回 emptyText「可以给同学留言噢」（原版空态文案）" || bad "缺少空态文案口径"

echo
echo "=== 清理 ==="
PSQL "delete from board_notes where from_user_id in ('$ID_A','$ID_B','$ID_C') or to_user_id in ('$ID_A','$ID_B','$ID_C')" >/dev/null
PSQL "delete from sessions where user_id in ('$ID_A','$ID_B','$ID_C')" >/dev/null
PSQL "delete from login_challenges where phone_e164 in ('+86$P_A','+86$P_B','+86$P_C')" >/dev/null
PSQL "delete from users where id in ('$ID_A','$ID_B','$ID_C')" >/dev/null
LEFT="$(PSQL "select count(*) from board_notes where from_user_id in ('$ID_A','$ID_B','$ID_C')")"
[ "$LEFT" = "0" ] && ok "测试数据已清理" || bad "仍有残留"
rm -f "$SINK"/*.json 2>/dev/null || true

echo
if [ "$FAILED" -eq 0 ]; then echo "BOARD_NOTES_RESULT PASS"; else echo "BOARD_NOTES_RESULT FAIL"; fi
exit "$FAILED"
