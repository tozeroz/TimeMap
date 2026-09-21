#!/usr/bin/env bash
# M4 Slice A（消息消费端）后端契约验证
#
# 依据：审核记录 16 的 A2/A5 —— 后端支持 private media 但**用户侧没有消费路径**；
#       以及 A 的 Gate 必须证明的授权断言（此处覆盖后端可证的部分）
#
# 断言：
#  T1 成员 GET /api/threads → 能看到自己参与的会话（且只列自己的）
#  T2 成员 GET /api/threads/:id/messages → 200，图片消息带 media 引用
#  T3 **非成员** GET messages → 404（不是 403：不泄漏会话是否存在）
#  T4 **未登录** GET messages → 404
#  T5 未登录 GET /api/threads → 401（列表接口与消息接口的差异是刻意的：
#     列表"必须登录"，消息"存在性也要藏起来"）
#  T6 消息撤回后：接口仍返回该行（界面要显示"已撤回"）但 **media 为空**
#     —— 服务端强制执行，不靠前端隐藏
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
SINK=/run/campus/login-codes
UP=/srv/campus/uploads

U1='11111111-1111-4111-8111-111111111111'
U2='22222222-2222-4222-8222-222222222222'
THREAD='55555555-cccc-4ccc-8ccc-000000000003'
MSG='55555555-dddd-4ddd-8ddd-000000000004'
PRV='55555555-bbbb-4bbb-8bbb-00000000000b'
FKEY='2026/09/sliceA-prv.png'

echo "=== 0. 准备：一个 U1↔U2 的会话 + 一条图片消息 ==="
PSQL "delete from message_media where media_id='$PRV'" >/dev/null
PSQL "delete from media where id='$PRV'" >/dev/null
PSQL "delete from messages where id='$MSG'" >/dev/null
PSQL "delete from message_threads where id='$THREAD'" >/dev/null
PSQL "insert into media (id,owner_user_id,scope,storage_key,mime,bytes,sha256,upload_request_id) values ('$PRV','$U1','private','$FKEY','image/png',8,'$(printf 'a7%.0s' {1..32})','55555555-1111-4111-8111-000000000011')" >/dev/null
PSQL "insert into message_threads (id,kind,title) values ('$THREAD','direct','Slice A 测试会话')" >/dev/null
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$U1')" >/dev/null
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$U2')" >/dev/null
PSQL "insert into messages (id,thread_id,sender_id,body,kind) values ('$MSG','$THREAD','$U1','[图片]','image')" >/dev/null
PSQL "insert into message_media (message_id,media_id,media_scope,position) values ('$MSG','$PRV','private',0)" >/dev/null
install -d -o campus -g campus -m 0750 "$UP/private/2026/09"
printf 'SLICEA01' > "$UP/private/$FKEY"
chown campus:campus "$UP/private/$FKEY"; chmod 0640 "$UP/private/$FKEY"
ok "会话与图片消息就绪（U1↔U2，非成员用临时账号）"

login_as() {
  local phone="$1" req sink code
  req="$(curl -s -m 10 -X POST "$BASE/api/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$phone\"}")"
  sink="$(printf '%s' "$req" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
  [ -n "$sink" ] && [ -f "$sink" ] && code="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$sink")"
  curl -s -m 10 -X POST "$BASE/api/auth/verify-code" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}
rm -f "$SINK"/*.json 2>/dev/null || true
P_IN="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
T_IN="$(login_as "$P_IN")"
ID_IN="$(PSQL "select id from users where phone_e164='+86$P_IN'")"
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$ID_IN')" >/dev/null
P_OUT="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
T_OUT="$(login_as "$P_OUT")"
ID_OUT="$(PSQL "select id from users where phone_e164='+86$P_OUT'")"
[ -n "$T_IN" ] && [ -n "$T_OUT" ] && ok "成员与非成员账号都登录成功" || bad "登录失败"

echo
echo "=== T1 成员 GET /api/threads 能看到自己的会话 ==="
R="$(curl -s -m 10 "$BASE/api/threads" -H "Authorization: Bearer $T_IN")"
printf '%s' "$R" | grep -q "$THREAD" && ok "成员列表里出现了该会话" || bad "成员列表里没有该会话：$(printf '%s' "$R" | head -c 200)"
printf '%s' "$R" | grep -q '"lastMessage":{' && ok "会话带最后一条消息预览" || bad "缺少 lastMessage"

echo
echo "=== T2 成员 GET messages → 200 且图片消息带 media ==="
R="$(curl -s -m 10 -w '\n%{http_code}' "$BASE/api/threads/$THREAD/messages" -H "Authorization: Bearer $T_IN")"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "200" ] && ok "成员 → 200" || bad "成员期望 200，实际 $C"
printf '%s' "$B" | grep -q "\"id\":\"$PRV\"" && ok "图片消息带 media 引用（含 media id）" || bad "media 引用缺失：$(printf '%s' "$B" | head -c 200)"
printf '%s' "$B" | grep -q '"kind":"image"' && ok "消息 kind 正确（image）" || bad "kind 不是 image"
printf '%s' "$B" | grep -q '"revoked":false' && ok "未撤回消息 revoked=false" || bad "revoked 标记异常"

echo
echo "=== T3 非成员 → 404 ==="
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/threads/$THREAD/messages" -H "Authorization: Bearer $T_OUT")"
[ "$C" = "404" ] && ok "**非成员 → 404**（与不存在不可区分，不泄漏会话存在性）" || bad "非成员期望 404，实际 $C"

echo
echo "=== T4 未登录 GET messages → 404；GET threads → 401 ==="
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/threads/$THREAD/messages")"
[ "$C" = "404" ] && ok "未登录读消息 → 404" || bad "期望 404，实际 $C"
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/threads")"
[ "$C" = "401" ] && ok "未登录列会话 → 401（列表必须登录，消息连存在性都藏起来）" || bad "期望 401，实际 $C"

echo
echo "=== T6 撤回后：行仍在（界面显示已撤回）但 media 为空 ==="
PSQL "update messages set deleted_at = now() where id='$MSG'" >/dev/null
R="$(curl -s -m 10 "$BASE/api/threads/$THREAD/messages" -H "Authorization: Bearer $T_IN")"
printf '%s' "$R" | grep -q "\"id\":\"$MSG\"" && ok "撤回的消息**仍返回该行**（界面需要显示「已撤回」）" || bad "撤回后行消失了"
printf '%s' "$R" | grep -q '"revoked":true' && ok "revoked=true" || bad "revoked 标记不对"
printf '%s' "$R" | grep -q "\"id\":\"$PRV\"" && bad "撤回后仍返回了 media 引用" || ok "**撤回后 media 为空**（服务端强制，不靠前端隐藏）"
# 媒体接口也必须同步不可读
C="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/media/$PRV" -H "Authorization: Bearer $T_IN")"
[ "$C" = "404" ] && ok "撤回后 **/api/media/:id 也 404**（与消息接口一致，不漂移）" || bad "撤回后媒体仍可读（$C）"

echo
echo "=== 清理 ==="
rm -f "$UP/private/$FKEY"
PSQL "delete from message_media where media_id='$PRV'" >/dev/null
PSQL "delete from media where id='$PRV'" >/dev/null
PSQL "delete from messages where id='$MSG'" >/dev/null
PSQL "delete from thread_members where thread_id='$THREAD'" >/dev/null
PSQL "delete from message_threads where id='$THREAD'" >/dev/null
PSQL "delete from sessions where user_id in ('$ID_IN','$ID_OUT')" >/dev/null
PSQL "delete from login_challenges where phone_e164 in ('+86$P_IN','+86$P_OUT')" >/dev/null
PSQL "delete from users where id in ('$ID_IN','$ID_OUT')" >/dev/null
rm -f "$SINK"/*.json 2>/dev/null || true
LEFT="$(PSQL "select count(*) from messages where thread_id='$THREAD'")"
[ "$LEFT" = "0" ] && ok "测试数据已清理" || bad "仍有残留"

echo
if [ "$FAILED" -eq 0 ]; then echo "MESSAGING_API_RESULT PASS"; else echo "MESSAGING_API_RESULT FAIL"; fi
exit "$FAILED"
