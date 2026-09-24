#!/usr/bin/env bash
# M4 诊断：私有媒体 X-Accel-Redirect 为什么没有生效
#
# 上一轮的矛盾现象：
#   响应字节数 == 盘上文件大小（8 字节）  ← 看起来 Nginx 下发了文件
#   但 Content-Type 是 application/json    ← 看起来又是 Node 的响应
# 两者不应同时出现，必须打印**完整原始响应头**才能判断。
#
# 本脚本只做诊断、只读为主；测试数据在结尾清理。
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
SINK=/run/campus/login-codes
BASE=http://127.0.0.1

U1='11111111-1111-4111-8111-111111111111'   # seed 用户 anmoss
TH="44444444-cccc-4ccc-8ccc-000000000003"
MS="44444444-dddd-4ddd-8ddd-000000000004"
PRV="44444444-bbbb-4bbb-8bbb-00000000000b"
FKEY="2026/09/diag-prv.webp"

echo "=== 0. 准备测试数据 ==="
PSQL "delete from message_media where media_id='$PRV'" >/dev/null
PSQL "delete from media where id='$PRV'" >/dev/null
PSQL "delete from messages where id='$MS'" >/dev/null
PSQL "delete from message_threads where id='$TH'" >/dev/null
PSQL "insert into media (id,owner_user_id,scope,storage_key,mime,bytes,sha256,upload_request_id) values ('$PRV','$U1','private','$FKEY','image/webp',8,'$(printf 'f0%.0s' {1..32})','44444444-1111-4111-8111-000000000011')"
PSQL "insert into message_threads (id,kind,title) values ('$TH','direct','diag')"
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$TH','$U1')"
PSQL "insert into messages (id,thread_id,sender_id,body,kind) values ('$MS','$TH','$U1','diag','image')"
PSQL "insert into message_media (message_id,media_id,media_scope,position) values ('$MS','$PRV','private',0)"
install -d -o campus -g campus -m 0750 /srv/campus/uploads/private/2026/09
printf 'REALBYT8' > /srv/campus/uploads/private/2026/09/diag-prv.webp
chown campus:campus /srv/campus/uploads/private/2026/09/diag-prv.webp
chmod 0640 /srv/campus/uploads/private/2026/09/diag-prv.webp
echo "盘上文件：$(stat -c '%s 字节 %U:%G %a' /srv/campus/uploads/private/2026/09/diag-prv.webp)"
echo "内容对照（供比对）：REALBYT8"

echo
echo "=== 1. 造一个成员账号并登录 ==="
rm -f "$SINK"/*.json 2>/dev/null
P="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
REQ="$(curl -s -X POST "$BASE/api/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$P\"}")"
SINKF="$(printf '%s' "$REQ" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINKF" 2>/dev/null)"
TOK="$(curl -s -X POST "$BASE/api/auth/verify-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$P\",\"code\":\"$CODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
MEMBER_ID="$(PSQL "select id from users where phone_e164='+86$P'")"
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$TH','$MEMBER_ID')" >/dev/null
echo "成员账号 id=${MEMBER_ID:0:8}… token 长度=${#TOK}"

echo
echo "=== 2. 直接问后端（绕过 Nginx）：Node 到底返回什么 ==="
echo "--- 直连 127.0.0.1:3001 ---"
curl -s -D - -o /tmp/d1.bin "$BASE:3001/api/media/$PRV" -H "Authorization: Bearer $TOK" | head -20
echo "  直连响应体字节数: $(stat -c %s /tmp/d1.bin)"
echo "  直连响应体内容: [$(cat /tmp/d1.bin)]"

echo
echo "=== 3. 经过 Nginx（80）：完整原始响应头 ==="
curl -s -D /tmp/d2.h -o /tmp/d2.bin "$BASE/api/media/$PRV" -H "Authorization: Bearer $TOK"
cat /tmp/d2.h
echo "  经 Nginx 响应体字节数: $(stat -c %s /tmp/d2.bin)"
echo "  经 Nginx 响应体内容: [$(cat /tmp/d2.bin)]"

echo
echo "=== 4. 直接请求 internal 路径（证明 internal 生效）==="
curl -s -o /dev/null -w '  /_private_media/... → %{http_code}\n' "$BASE/_private_media/$FKEY"

echo
echo "=== 5. Nginx 侧线索 ==="
echo "--- 后端实际发出的 X-Accel-Redirect（看 Node 是否真的设置了这个头）---"
grep -c 'X-Accel-Redirect' /tmp/d1.h 2>/dev/null | sed 's/^/  直连响应里 X-Accel-Redirect 出现次数: /'
echo "--- nginx 错误日志最近 5 行 ---"
tail -5 /var/log/nginx/error.log

echo
echo "=== 6. 清理 ==="
rm -f /tmp/d1.bin /tmp/d2.h /tmp/d2.bin
rm -f /srv/campus/uploads/private/2026/09/diag-prv.webp
PSQL "delete from message_media where media_id='$PRV'" >/dev/null
PSQL "delete from media where id='$PRV'" >/dev/null
PSQL "delete from messages where id='$MS'" >/dev/null
PSQL "delete from thread_members where thread_id='$TH'" >/dev/null
PSQL "delete from message_threads where id='$TH'" >/dev/null
PSQL "delete from sessions where user_id='$MEMBER_ID'" >/dev/null
PSQL "delete from login_challenges where phone_e164='+86$P'" >/dev/null
PSQL "delete from users where id='$MEMBER_ID'" >/dev/null
echo "已清理"
