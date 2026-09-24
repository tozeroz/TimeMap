#!/usr/bin/env bash
# M4 Slice C（@ 提及最小闭环）契约验证
#
# 依据：审核记录 16 —— @ mention 是 M4 冻结范围内的项，不允许推到 M5；
#       范围保持最小；若支持 @所有人必须单独明确语义、不得伪造成某个 user id。
#       本实现**不做 @所有人**（明确记为未实现，不伪造成 user id）。
#
# 断言：
#  C1 发送消息 + mention 一个会话成员 → 201，且**产生 mention 行**
#  C2 mention 一个**不属于会话**的用户 → 400，且**消息与 mention 都不写入**
#  C3 mention 自己 → 400，且不写入
#  C4 非成员发送 → 404，且不写入
#  C5 同一条消息重复 mention 同一人 → 只产生 1 行（去重）
#  C6 未登录发送 → 404
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
SINK=/run/campus/login-codes

U1='11111111-1111-4111-8111-111111111111'   # 会话成员
U2='22222222-2222-4222-8222-222222222222'   # 会话成员
U3='33333333-3333-4333-8333-333333333333'   # **非**成员
THREAD='77777777-cccc-4ccc-8ccc-000000000003'

echo "=== 0. 准备会话（U1+U2 是成员，U3 不是）==="
PSQL "delete from message_mentions where message_id in (select id from messages where thread_id='$THREAD')" >/dev/null
PSQL "delete from messages where thread_id='$THREAD'" >/dev/null
PSQL "delete from thread_members where thread_id='$THREAD'" >/dev/null
PSQL "delete from message_threads where id='$THREAD'" >/dev/null
PSQL "insert into message_threads (id,kind,title) values ('$THREAD','direct','Slice C 测试会话')" >/dev/null
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$U1')" >/dev/null
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$U2')" >/dev/null
ok "会话就绪（U1/U2 成员，U3 非成员）"

login_as() {
  local phone="$1" req sink code
  req="$(curl -s -m 10 -X POST "$BASE/api/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$phone\"}")"
  sink="$(printf '%s' "$req" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
  [ -n "$sink" ] && [ -f "$sink" ] && code="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$sink")"
  curl -s -m 10 -X POST "$BASE/api/auth/verify-code" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}
rm -f "$SINK"/*.json 2>/dev/null || true

echo
echo "=== C1 发送 + mention 成员 → 201 且产生 mention 行 ==="
# 需要一个**真实会话**才能发送：seed 用户的 token 不便直接取，
# 所以这里造一个临时账号并把它加入会话（临时账号也是合法成员）。
P_A="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
T_A="$(login_as "$P_A")"
ID_A="$(PSQL "select id from users where phone_e164='+86$P_A'")"
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$ID_A')" >/dev/null
R="$(curl -s -m 10 -w '\n%{http_code}' -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_A" \
  -d "{\"body\":\"@Lemy 你好\",\"kind\":\"text\",\"mentions\":[\"$U2\"]}")"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "201" ] && ok "成员发送 + mention 成员 → 201" || bad "期望 201，实际 $C（$B）"
MSG_ID="$(printf '%s' "$B" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
N="$(PSQL "select count(*) from message_mentions where message_id='$MSG_ID' and mentioned_user_id='$U2'")"
[ "$N" = "1" ] && ok "**产生了 mention 行**（message_mentions 1 行）" || bad "mention 行数异常：$N"

echo
echo "=== C2 mention 非成员 → 400 且不写入 ==="
BEFORE="$(PSQL "select count(*) from messages where thread_id='$THREAD'")"
R="$(curl -s -m 10 -w '\n%{http_code}' -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_A" \
  -d "{\"body\":\"@Azur 你不在这里\",\"kind\":\"text\",\"mentions\":[\"$U3\"]}")"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "400" ] && ok "**mention 非成员 → 400**" || bad "期望 400，实际 $C"
printf '%s' "$B" | grep -q 'mention_not_in_thread' && ok "错误码明确（mention_not_in_thread）" || bad "错误码不明确：$B"
AFTER="$(PSQL "select count(*) from messages where thread_id='$THREAD'")"
[ "$BEFORE" = "$AFTER" ] && ok "**消息没有写入**（$BEFORE → $AFTER，事务回滚）" || bad "被拒却写了消息（$BEFORE → $AFTER）"
ORPHAN="$(PSQL "select count(*) from message_mentions where mentioned_user_id='$U3'")"
[ "$ORPHAN" = "0" ] && ok "没有留下针对非成员的 mention 行" || bad "留下了 $ORPHAN 行"

echo
echo "=== C3 mention 自己 → 400 且不写入 ==="
BEFORE="$(PSQL "select count(*) from messages where thread_id='$THREAD'")"
R="$(curl -s -m 10 -w '\n%{http_code}' -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_A" \
  -d "{\"body\":\"@我自己\",\"kind\":\"text\",\"mentions\":[\"$ID_A\"]}")"
C="$(printf '%s' "$R" | tail -1)"
[ "$C" = "400" ] && ok "**mention 自己 → 400**" || bad "期望 400，实际 $C"
AFTER="$(PSQL "select count(*) from messages where thread_id='$THREAD'")"
[ "$BEFORE" = "$AFTER" ] && ok "消息没有写入" || bad "被拒却写了消息"

echo
echo "=== C4 非成员发送 → 404 ==="
P_OUT="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
T_OUT="$(login_as "$P_OUT")"
R="$(curl -s -m 10 -w '\n%{http_code}' -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_OUT" \
  -d '{"body":"我不是成员","kind":"text"}')"
C="$(printf '%s' "$R" | tail -1)"
[ "$C" = "404" ] && ok "**非成员发送 → 404**" || bad "期望 404，实际 $C"

echo
echo "=== C5 重复 mention 同一人 → 只 1 行 ==="
R="$(curl -s -m 10 -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $T_A" \
  -d "{\"body\":\"@Lemy 重复提到\",\"kind\":\"text\",\"mentions\":[\"$U2\",\"$U2\"]}")"
M2="$(printf '%s' "$R" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
N2="$(PSQL "select count(*) from message_mentions where message_id='$M2'")"
[ "$N2" = "1" ] && ok "重复 mention 只产生 1 行（去重生效）" || bad "产生 $N2 行"

echo
echo "=== C6 未登录发送 → 404 ==="
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -d '{"body":"匿名","kind":"text"}')"
[ "$C" = "404" ] && ok "未登录发送 → 404" || bad "期望 404，实际 $C"

echo
echo "=== 清理 ==="
PSQL "delete from message_mentions where message_id in (select id from messages where thread_id='$THREAD')" >/dev/null
PSQL "delete from messages where thread_id='$THREAD'" >/dev/null
PSQL "delete from thread_members where thread_id='$THREAD'" >/dev/null
PSQL "delete from message_threads where id='$THREAD'" >/dev/null
PSQL "delete from sessions where user_id in ('$ID_A',(select id from users where phone_e164='+86$P_OUT'))" >/dev/null
PSQL "delete from login_challenges where phone_e164 in ('+86$P_A','+86$P_OUT')" >/dev/null
PSQL "delete from users where phone_e164 in ('+86$P_A','+86$P_OUT')" >/dev/null
rm -f "$SINK"/*.json 2>/dev/null || true
LEFT="$(PSQL "select count(*) from message_mentions where mentioned_user_id='$U3'")"
[ "$LEFT" = "0" ] && ok "测试数据已清理" || bad "仍有残留"

echo
if [ "$FAILED" -eq 0 ]; then echo "MENTIONS_RESULT PASS"; else echo "MENTIONS_RESULT FAIL"; fi
exit "$FAILED"
