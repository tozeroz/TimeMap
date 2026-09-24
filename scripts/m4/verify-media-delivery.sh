#!/usr/bin/env bash
# M4：媒体下发契约验证（HTTP + Nginx 层）
#
# 依据：审核记录 13 第 6 条（公共/私有访问控制不能同构，审核标注"最重要"）
#       + 审核记录 15（X-Accel-Redirect；404 而非 403；响应头）
#
# 本脚本证明的核心命题：
#   **私有媒体即使知道 URL，未授权者也拿不到字节。**
#   而且存在两条独立的证据：
#     ① 应用层：非成员/匿名 → 404
#     ② 网关层：直接打 /_private_media/... → 失败（internal 生效）
#   ② 很关键 —— 它证明"私有目录没有被静态暴露"，
#   否则应用层的 404 只是"多了一道门"，而门本身是开着的。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1"; }
SINK=/run/campus/login-codes

U1='11111111-1111-4111-8111-111111111111'   # seed 用户 anmoss（会话成员）
U2='22222222-2222-4222-8222-222222222222'   # seed 用户 lemy（会话成员）
U3='33333333-3333-4333-8333-333333333333'   # seed 用户 azur（**非**成员）

THREAD="22222222-cccc-4ccc-8ccc-000000000003"
MSG="22222222-dddd-4ddd-8ddd-000000000004"
PRV="22222222-bbbb-4bbb-8bbb-000000000002"
PUB="22222222-aaaa-4aaa-8aaa-000000000001"

echo "=== A. 准备：一个私有媒体（挂在会话消息上）+ 一个公共媒体 ==="
PSQL "delete from message_media where media_id in ('$PRV','$PUB')" >/dev/null
PSQL "delete from post_media where media_id in ('$PRV','$PUB')" >/dev/null
PSQL "delete from media where id in ('$PRV','$PUB')" >/dev/null
PSQL "delete from messages where id = '$MSG'" >/dev/null
PSQL "delete from message_threads where id = '$THREAD'" >/dev/null

PSQL "insert into media (id, owner_user_id, scope, storage_key, mime, bytes, sha256, upload_request_id) values ('$PUB','$U1','public','2026/09/m4-pub.webp','image/webp',2048,'$(printf 'a1%.0s' {1..32})','22222222-1111-4111-8111-000000000011')" >/dev/null
PSQL "insert into media (id, owner_user_id, scope, storage_key, mime, bytes, sha256, upload_request_id) values ('$PRV','$U1','private','2026/09/m4-prv.webp','image/webp',2048,'$(printf 'b2%.0s' {1..32})','22222222-2222-4222-8222-000000000022')" >/dev/null
PSQL "insert into message_threads (id, kind, title) values ('$THREAD','direct','M4 测试会话')" >/dev/null
PSQL "insert into thread_members (id, thread_id, user_id) values (gen_random_uuid(),'$THREAD','$U1')" >/dev/null
PSQL "insert into thread_members (id, thread_id, user_id) values (gen_random_uuid(),'$THREAD','$U2')" >/dev/null
PSQL "insert into messages (id, thread_id, sender_id, body, kind) values ('$MSG','$THREAD','$U1','M4 私有图','image')" >/dev/null
PSQL "insert into message_media (message_id, media_id, media_scope, position) values ('$MSG','$PRV','private',0)" >/dev/null
ok "测试数据就绪（私有媒体挂在 U1↔U2 的会话上，U3 不是成员）"

# 落盘真实文件（Nginx 要能读到才谈得上"取字节"）
install -d -o campus -g campus -m 0755 /srv/campus/uploads/public/2026/09
install -d -o campus -g campus -m 0750 /srv/campus/uploads/private/2026/09
# 写一个最小合法 PNG 当占位内容（真实字节，便于观察 Content-Type 与长度）
printf '\x89PNG\r\n\x1a\n' > /srv/campus/uploads/private/2026/09/m4-prv.webp
printf '\x89PNG\r\n\x1a\n' > /srv/campus/uploads/public/2026/09/m4-pub.webp
chown campus:campus /srv/campus/uploads/private/2026/09/m4-prv.webp /srv/campus/uploads/public/2026/09/m4-pub.webp
ok "两个媒体的物理文件已落盘"

echo
echo "=== B. 取两个用户的会话（真实手机号 + dev sink，不注入夹具）==="
login_as() {
  local phone="$1"
  local req sink code
  req="$(curl -s -m 10 -X POST "$BASE/api/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$phone\"}")"
  sink="$(printf '%s' "$req" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
  [ -n "$sink" ] && [ -f "$sink" ] && code="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$sink")"
  curl -s -m 10 -X POST "$BASE/api/auth/verify-code" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}
# 用两个临时账号：一个会被加进会话（成员），一个不加（非成员）
P_MEM="138$(printf '%08d' $((RANDOM * RANDOM % 100000000)))"
P_OUT="138$(printf '%08d' $((RANDOM * RANDOM % 100000000)))"
rm -f "$SINK"/*.json 2>/dev/null || true
T_MEM="$(login_as "$P_MEM")"
T_OUT="$(login_as "$P_OUT")"
[ -n "$T_MEM" ] && ok "成员账号登录成功" || bad "成员账号登录失败"
[ -n "$T_OUT" ] && ok "非成员账号登录成功" || bad "非成员账号登录失败"
ID_MEM="$(PSQL "select id from users where phone_e164 = '+86$P_MEM'")"
# 把成员账号加进会话
PSQL "insert into thread_members (id, thread_id, user_id) values (gen_random_uuid(),'$THREAD','$ID_MEM')" >/dev/null

echo
echo "=== C. 私有媒体：**授权**（应用层）==="
C_OUT="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/media/$PRV" -H "Authorization: Bearer $T_OUT")"
[ "$C_OUT" = "404" ] && ok "**非成员** 请求私有媒体 → 404（不泄漏 id 是否存在）" || bad "非成员应为 404，实际 $C_OUT"
C_ANON="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/media/$PRV")"
[ "$C_ANON" = "404" ] && ok "**匿名** 请求私有媒体 → 404" || bad "匿名应为 404，实际 $C_ANON"

HDR="$(curl -s -m 10 -D - -o /dev/null "$BASE/api/media/$PRV" -H "Authorization: Bearer $T_MEM")"
C_MEM="$(printf '%s' "$HDR" | head -1 | sed -n 's/.* \([0-9][0-9][0-9]\).*/\1/p')"
[ "$C_MEM" = "200" ] && ok "**会话成员** 请求私有媒体 → 200" || bad "成员应为 200，实际 $C_MEM"
# **正确的断言**：X-Accel-Redirect 是给 Nginx 的内部指令，会被 Nginx **消费**掉，
# 客户端本来就看不到它（第一版断言"必须看到这个头"，测的是错的东西）。
# 真正要证明的是：成员拿到 200 **且响应体就是文件字节**（说明 Nginx 确实做了内部重定向，
# 而且字节是 Nginx 搬的、不是 Node 搬的）。
# **严格断言**（第一版写得太松：模糊匹配 + catch-all 分支，
# 结果在"其实没拿到字节"的情况下也 PASS 了 —— 典型假阳性，必须修掉）：
#   必须同时满足 ① 响应字节数 == 盘上文件字节数 ② Content-Type 是图片类型。
#   出现 application/json 就说明 Nginx **没有**做内部重定向，返回的是 Node 的空响应体。
EXPECT_BYTES="$(stat -c %s /srv/campus/uploads/private/2026/09/m4-prv.webp)"
HB="$(mktemp)"; BB="$(mktemp)"
curl -s -m 10 -D "$HB" -o "$BB" "$BASE/api/media/$PRV" -H "Authorization: Bearer $T_MEM" >/dev/null
GOT_BYTES="$(stat -c %s "$BB")"
CTYPE="$(grep -i '^Content-Type:' "$HB" | tr -d '\r' | sed 's/^[Cc]ontent-[Tt]ype: *//')"
if [ "$GOT_BYTES" = "$EXPECT_BYTES" ] && [ "$GOT_BYTES" != "0" ]; then
  ok "成员拿到 **文件的实际字节**（响应 $GOT_BYTES 字节 == 盘上文件大小）"
else
  bad "字节数不符：盘上 $EXPECT_BYTES，响应 $GOT_BYTES（0 = Nginx 没有内部重定向）"
fi
case "$CTYPE" in
  image/*) ok "私有响应 Content-Type 为图片类型（$CTYPE）" ;;
  *) bad "私有响应 Content-Type 是「$CTYPE」—— 返回的是 Node 响应而不是 Nginx 下发的文件" ;;
esac
printf '%s' "$HDR" | grep -qi 'Cache-Control: private, no-store' \
  && ok "私有响应带 Cache-Control: private, no-store" || bad "缺少 Cache-Control: private, no-store"
printf '%s' "$HDR" | grep -qi 'X-Content-Type-Options: nosniff' \
  && ok "私有响应带 X-Content-Type-Options: nosniff" || bad "缺少 nosniff"

echo
echo "=== D. 私有媒体：**网关层**（这条才是"URL 不是凭证"的真正证明）==="
C_GW="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/_private_media/2026/09/m4-prv.webp")"
case "$C_GW" in
  403|404) ok "直接打 /_private_media/... → $C_GW（internal 生效，私有目录**没有**被静态暴露）" ;;
  *) bad "直接打 /_private_media/... 竟然返回 $C_GW —— 私有目录被暴露了！" ;;
esac
C_GWM="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/_private_media/2026/09/m4-prv.webp" -H "Authorization: Bearer $T_MEM")"
case "$C_GWM" in
  403|404) ok "**带成员会话**直接打 internal 路径也失败（$C_GWM）—— 必须是后端 X-Accel 内部重定向才生效" ;;
  *) bad "带会话竟能直接访问 internal 路径（$C_GWM）" ;;
esac

echo
echo "=== E. 公共媒体：访问模型**独立**验证（不与私有复用同一授权）==="
C_PUB="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/media/$PUB")"
[ "$C_PUB" = "302" ] && ok "public 走 /api/media/:id → 302 到静态路径" || bad "public 期望 302，实际 $C_PUB"
c_pub_loc="$(curl -s -m 10 -D - -o /dev/null "$BASE/api/media/$PUB" | sed -n 's/^[Ll]ocation: *//p' | tr -d '\r')"
[ "$c_pub_loc" = "/media/2026/09/m4-pub.webp" ] && ok "Location 指向 /media/<key>（Nginx 静态）" || bad "Location 异常：$c_pub_loc"
C_STATIC="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/media/2026/09/m4-pub.webp")"
[ "$C_STATIC" = "200" ] && ok "**公共媒体经 Nginx 静态直出 → 200**（不经 Node）" || bad "公共静态路径期望 200，实际 $C_STATIC"
HDRP="$(curl -s -m 10 -D - -o /dev/null "$BASE/media/2026/09/m4-pub.webp")"
printf '%s' "$HDRP" | grep -qi 'Cache-Control: public' && ok "公共媒体可被缓存（Cache-Control: public）" || bad "公共媒体缺少可缓存头"
# 对照：私有 key 走公共静态路径必须失败（证明两个命名空间确实分开）
C_MIX="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/media/2026/09/m4-prv.webp")"
case "$C_MIX" in
  403|404) ok "把**私有** key 拼到公共静态路径 → $C_MIX（两个命名空间确实分开）" ;;
  *) bad "私有文件竟能从公共静态路径读到（$C_MIX）！！" ;;
esac

echo
echo "=== F. 不存在的 id 与非法 id ==="
C_NF="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/media/00000000-0000-4000-8000-000000000000")"
[ "$C_NF" = "404" ] && ok "不存在的媒体 → 404" || bad "期望 404，实际 $C_NF"
C_BAD="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/media/not-a-uuid")"
[ "$C_BAD" = "404" ] && ok "非法 id → 404（不报 400：避免区分「格式错」与「不存在」）" || bad "期望 404，实际 $C_BAD"

echo
echo "=== G. 撤回消息后，私有媒体经应用层必须不可读 ==="
PSQL "update messages set deleted_at = now() where id = '$MSG'" >/dev/null
C_REV="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/api/media/$PRV" -H "Authorization: Bearer $T_MEM")"
[ "$C_REV" = "404" ] && ok "**消息撤回 → 成员也拿不到私有媒体（404）**" || bad "撤回后仍可读（$C_REV）"
PSQL "update messages set deleted_at = null where id = '$MSG'" >/dev/null

echo
echo "=== H. 清理 ==="
rm -f /srv/campus/uploads/private/2026/09/m4-prv.webp
rm -f /srv/campus/uploads/public/2026/09/m4-pub.webp
PSQL "delete from message_media where media_id in ('$PRV','$PUB')" >/dev/null
PSQL "delete from media where id in ('$PRV','$PUB')" >/dev/null
PSQL "delete from messages where id = '$MSG'" >/dev/null
PSQL "delete from thread_members where thread_id = '$THREAD'" >/dev/null
PSQL "delete from message_threads where id = '$THREAD'" >/dev/null
PSQL "delete from sessions where user_id in (select id from users where phone_e164 in ('+86$P_MEM','+86$P_OUT'))" >/dev/null
PSQL "delete from login_challenges where phone_e164 in ('+86$P_MEM','+86$P_OUT')" >/dev/null
PSQL "delete from users where phone_e164 in ('+86$P_MEM','+86$P_OUT')" >/dev/null
rm -f "$SINK"/*.json 2>/dev/null || true
LEFT="$(PSQL "select count(*) from media where id in ('$PRV','$PUB')")"
[ "$LEFT" = "0" ] && ok "测试数据已清理" || bad "仍有残留"

echo
if [ "$FAILED" -eq 0 ]; then echo "MEDIA_DELIVERY_RESULT PASS"; else echo "MEDIA_DELIVERY_RESULT FAIL"; fi
exit "$FAILED"
