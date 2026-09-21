#!/usr/bin/env bash
# M5 工作单 #2 —— 后端：发消息携带**单数** mediaId（审核记录 21 修订 1）
#
# 依据：docs/m5/WORKORDER-2.md（修订 1：单数 mediaId，不接受数组）
#
# 本脚本覆盖的断言（与 WORKORDER-2 §三 的 Gate 清单对应）：
#   A1 带 mediaId 发图片消息 → 201；message_media 有行且 media_scope='private'
#   A2 GET /api/threads/:id/messages 能读到该 media 引用（id/width/height）
#   A3 **挂别人的私有 media → 400 media_not_owned，且一行都不写**（越权，最容易漏的一条）
#   A4 挂 scope='public' 的 media → 400 media_not_private（跨 scope）
#   A5 挂不存在的 media id → 400 media_not_found
#   A6 带了 mediaId 但 kind≠image → 400 media_requires_image_kind
#   A7 传数组 mediaIds[] / 非字符串 mediaId → 400 bad_media_id（**不接受数组**）
#   A8 非法 uuid 字符串 → 400 bad_media_id
#   A9 **同事务**：让 media 校验失败 → 断言 messages 表里没有多出任何行
#      （如果实现是"先写消息、后校验媒体"，这里会多出一行 → FAIL）
#   T1 不带 mediaId 发纯文本消息仍然 201（未破坏既有行为）
#
# 前提：脚本在**服务器**上执行（与 scripts/m4/verify-media-upload.sh 同环境）：
#   - 服务监听 127.0.0.1:80，且已部署含本改动的 dist/index.mjs
#   - 有 psql / curl，/srv/campus/.db_password 可读（root）
# 用法：bash scripts/m5/verify-message-media.sh
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
SINK=/run/campus/login-codes
UP=/srv/campus/uploads

# 固定 id：便于失败后手工复查（都在测试会话/测试用户命名空间内）
THREAD='55555555-cccc-4ccc-8ccc-0000000000a1'
UUID() { cat /proc/sys/kernel/random/uuid; }

# 生成一个**真正合法的 PNG**（最小结构：签名 + IHDR + IDAT + IEND）
make_png() {
  python3 - "$1" <<'PY'
import struct, sys, zlib
w, h = 24, 16
sig = b'\x89PNG\r\n\x1a\n'
ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
raw = b''.join(b'\x00' + b'\x11\x77\xee\xff' * w for _ in range(h))
idat = zlib.compress(raw, 9)
open(sys.argv[1], 'wb').write(sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b''))
PY
}

# 手机号 OTP 登录（复用既有脚本的做法：从 dev sink 取码）
login() {
  local phone="$1" req sink code
  req="$(curl -s -m 10 -X POST "$BASE/api/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$phone\"}")"
  sink="$(printf '%s' "$req" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
  [ -n "$sink" ] && [ -f "$sink" ] && code="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$sink")"
  curl -s -m 10 -X POST "$BASE/api/auth/verify-code" -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

json_field() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p"; }

echo "=== 0. 准备：两个账号（A=发送者，B=图的所有者），A、B 同属一个会话 ==="
rm -f "$SINK"/*.json 2>/dev/null || true
PA="139$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
PB="137$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
TA="$(login "$PA")"; TB="$(login "$PB")"
IDA="$(PSQL "select id from users where phone_e164='+86$PA'")"
IDB="$(PSQL "select id from users where phone_e164='+86$PB'")"
[ -n "$TA" ] && [ -n "$TB" ] && [ -n "$IDA" ] && [ -n "$IDB" ] && ok "两个账号登录成功（A=${IDA:0:8}… B=${IDB:0:8}…）" \
  || { bad "登录失败"; exit 1; }
AUTH_A=(-H "Authorization: Bearer $TA")
AUTH_B=(-H "Authorization: Bearer $TB")

PSQL "delete from message_threads where id='$THREAD'" >/dev/null
PSQL "insert into message_threads (id,kind,title) values ('$THREAD','direct','WO2 媒体消息测试会话')" >/dev/null
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$IDA')" >/dev/null
PSQL "insert into thread_members (id,thread_id,user_id) values (gen_random_uuid(),'$THREAD','$IDB')" >/dev/null
MSGS0="$(PSQL "select count(*) from messages where thread_id='$THREAD'")"
[ "$MSGS0" = "0" ] && ok "测试会话就绪（messages 基线 0 行）" || bad "会话基线不是 0：$MSGS0"

echo
echo "=== A0. A 上传一张 private 图（purpose=chat）==="
WORK="$(mktemp -d)"; make_png "$WORK/p.png"
RA="$(curl -s -m 20 "${AUTH_A[@]}" -X POST "$BASE/api/media" -F "file=@$WORK/p.png" -F "purpose=chat" -F "uploadRequestId=$(UUID)")"
MA="$(json_field "$RA" id)"; KA="$(json_field "$RA" storageKey)"
[ -n "$MA" ] && [ -n "$KA" ] && ok "上传成功 media=$MA key=$KA" || { bad "上传失败：$RA"; }
[ "$(PSQL "select scope from media where id='$MA'")" = "private" ] && ok "该 media scope=private" || bad "scope 不是 private"

echo
echo "=== A1. 带 mediaId 发图片消息 → 201 + message_media(scope=private) ==="
R="$(curl -s -m 20 -w '\n%{http_code}' "${AUTH_A[@]}" -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' \
  -d "{\"body\":\"WO2 图片消息\",\"kind\":\"image\",\"mediaId\":\"$MA\"}")"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "201" ] && ok "→ 201" || bad "期望 201，实际 $C（$B）"
MSG="$(json_field "$B" id)"
[ "$(printf '%s' "$B" | grep -c "\"mediaId\":\"$MA\"")" = "1" ] && ok "响应回显 mediaId（客户端可确认挂上了）" || bad "响应没有回显 mediaId：$B"
MM="$(PSQL "select media_id || '|' || media_scope || '|' || position from message_media where message_id='$MSG'")"
[ "$MM" = "$MA|private|0" ] && ok "message_media 行正确（$MM）" || bad "message_media 行异常：$MM"

echo
echo "=== A2. GET messages 读到该引用（id/width/height）==="
R="$(curl -s -m 10 "${AUTH_A[@]}" "$BASE/api/threads/$THREAD/messages")"
printf '%s' "$R" | grep -q "\"id\":\"$MA\"" && ok "消息列表里出现该 media 引用" || bad "消息列表里没有该 media：$(printf '%s' "$R" | head -c 300)"
printf '%s' "$R" | grep -q '"width":24' && ok "带 width=24（与上传解出的尺寸一致）" || bad "缺少正确宽度"
printf '%s' "$R" | grep -q '"revoked":false' && ok "消息未撤回（media 引用对成员可读）" || bad "revoked 状态异常"

echo
echo "=== A3. **挂别人的私有 media** → 400 media_not_owned，且一行都不写（越权）==="
RB="$(curl -s -m 20 "${AUTH_B[@]}" -X POST "$BASE/api/media" -F "file=@$WORK/p.png" -F "purpose=chat" -F "uploadRequestId=$(UUID)")"
MB="$(json_field "$RB" id)"; KB="$(json_field "$RB" storageKey)"
[ -n "$MB" ] && ok "B 上传了自己的私有图 media=$MB" || bad "B 上传失败：$RB"
R="$(curl -s -m 20 -w '\n%{http_code}' "${AUTH_A[@]}" -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"偷挂别人的图\",\"kind\":\"image\",\"mediaId\":\"$MB\"}")"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "400" ] && ok "A 挂 B 的图 → 400" || bad "期望 400，实际 $C（$B）"
printf '%s' "$B" | grep -q 'media_not_owned' && ok "错误码明确 media_not_owned" || bad "错误码不是 media_not_owned：$B"
[ "$(PSQL "select count(*) from message_media where media_id='$MB'")" = "0" ] && ok "**别人的图没有被挂上**（message_media 无行）" || bad "别人的图竟然被挂上了"

echo
echo "=== A4. 挂 scope='public' 的 media → 400 media_not_private（跨 scope 服务层先拒）==="
RP="$(curl -s -m 20 "${AUTH_A[@]}" -X POST "$BASE/api/media" -F "file=@$WORK/p.png" -F "purpose=post" -F "uploadRequestId=$(UUID)")"
MP="$(json_field "$RP" id)"; KP="$(json_field "$RP" storageKey)"
[ -n "$MP" ] && ok "A 上传了一张 public 图 media=$MP" || bad "public 上传失败：$RP"
R="$(curl -s -m 20 -w '\n%{http_code}' "${AUTH_A[@]}" -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"动态图挂进私聊\",\"kind\":\"image\",\"mediaId\":\"$MP\"}")"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "400" ] && ok "public media → 400" || bad "期望 400，实际 $C（$B）"
printf '%s' "$B" | grep -q 'media_not_private' && ok "错误码明确 media_not_private" || bad "错误码不是 media_not_private：$B"
# DB 层的复合外键仍然在兜底：直接绕过服务层塞一条跨 scope 行必须失败
DBATTEMPT="$(PSQL "insert into message_media (message_id,media_id,media_scope,position) values ('$MSG','$MP','private',1)")"
printf '%s' "$DBATTEMPT" | grep -qi 'foreign key\|violates' && ok "DB 层复核：绕过服务层直接插跨 scope 行被外键拒绝（防线仍在兜底）" \
  || bad "绕过服务层竟然插进了跨 scope 引用：$DBATTEMPT"

echo
echo "=== A5. 挂不存在的 media id → 400 media_not_found ==="
R="$(curl -s -m 20 -w '\n%{http_code}' "${AUTH_A[@]}" -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"幽灵图\",\"kind\":\"image\",\"mediaId\":\"$(UUID)\"}")"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "400" ] && ok "不存在的 media → 400" || bad "期望 400，实际 $C（$B）"
printf '%s' "$B" | grep -q 'media_not_found' && ok "错误码明确 media_not_found" || bad "错误码不是 media_not_found：$B"

echo
echo "=== A6. 带 mediaId 但 kind=text → 400 media_requires_image_kind ==="
R="$(curl -s -m 20 -w '\n%{http_code}' "${AUTH_A[@]}" -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -d "{\"body\":\"自称文本\",\"kind\":\"text\",\"mediaId\":\"$MA\"}")"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "400" ] && ok "kind=text + mediaId → 400" || bad "期望 400，实际 $C（$B）"
printf '%s' "$B" | grep -q 'media_requires_image_kind' && ok "错误码明确 media_requires_image_kind" || bad "错误码不符：$B"

echo
echo "=== A7. **传数组 mediaIds[] / 非字符串 mediaId → 400 bad_media_id**（修订 1 的核心）==="
for PAYLOAD in "{\"body\":\"数组\",\"kind\":\"image\",\"mediaIds\":[\"$MA\"]}" \
               "{\"body\":\"数组\",\"kind\":\"image\",\"mediaId\":[\"$MA\"]}" \
               "{\"body\":\"数字\",\"kind\":\"image\",\"mediaId\":123}"; do
  R="$(curl -s -m 20 -w '\n%{http_code}' "${AUTH_A[@]}" -X POST "$BASE/api/threads/$THREAD/messages" \
    -H 'Content-Type: application/json' -d "$PAYLOAD")"
  C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
  case "$PAYLOAD" in
    *mediaIds*) # 复数字段**:必须明确 400**
      # 只"不认识就忽略"是不行的：客户端会收到 201，消息发出去了而图没挂上 ——
      # 用户以为图发了，服务端与客户端都不报错（静默丢数据）。
      if [ "$C" = "201" ]; then
        bad "mediaIds[] 被**静默忽略**并发出了消息（$B）—— 不允许：客户端以为发了图"
      else
        [ "$C" = "400" ] && ok "mediaIds[] → 400 明确拒绝（不接受数组，不静默忽略）" || bad "期望 400，实际 $C（$B）"
        printf '%s' "$B" | grep -q 'bad_media_id' && ok "错误码明确 bad_media_id（含 reason=array_not_supported…）" || bad "错误码不符：$B"
      fi ;;
    *)
      [ "$C" = "400" ] && ok "mediaId 非字符串 → 400" || bad "期望 400，实际 $C（$B）"
      printf '%s' "$B" | grep -q 'bad_media_id' && ok "错误码明确 bad_media_id" || bad "错误码不符：$B" ;;
  esac
done

echo
echo "=== A8. 非法 uuid 字符串 → 400 bad_media_id ==="
R="$(curl -s -m 20 -w '\n%{http_code}' "${AUTH_A[@]}" -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -d '{"body":"坏id","kind":"image","mediaId":"not-a-uuid"}')"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "400" ] && ok "非法 uuid → 400" || bad "期望 400，实际 $C（$B）"
printf '%s' "$B" | grep -q 'bad_media_id' && ok "错误码明确 bad_media_id" || bad "错误码不符：$B"

echo
echo "=== T1. 不带 mediaId 的纯文本消息仍然 201（既有行为未被破坏）==="
R="$(curl -s -m 20 -w '\n%{http_code}' "${AUTH_A[@]}" -X POST "$BASE/api/threads/$THREAD/messages" \
  -H 'Content-Type: application/json' -d '{"body":"WO2 纯文本","kind":"text"}')"
C="$(printf '%s' "$R" | tail -1)"; B="$(printf '%s' "$R" | head -1)"
[ "$C" = "201" ] && ok "纯文本 → 201" || bad "期望 201，实际 $C（$B）"
printf '%s' "$B" | grep -q '"mediaId":null' && ok "响应里 mediaId 为 null（没有媒体）" || bad "响应的 mediaId 字段异常：$B"

echo
echo "=== A9. **同事务**：上面所有失败的请求都不该留下消息行 ==="
# 成功的只有 A1 一条图片消息 + T1 一条文本消息 = 2
MSGS1="$(PSQL "select count(*) from messages where thread_id='$THREAD'")"
[ "$MSGS1" = "2" ] && ok "会话内恰好 2 条消息（全部媒体校验失败都没写入）" \
  || bad "期望 2 条，实际 $MSGS1 条 —— 存在「校验失败却写了消息」的路径"
# 更严的版本：消息 id 集合必须**恰好**是 A1 与 T1 那两条（不是"数量凑巧对"）
IDS="$(PSQL "select string_agg(id::text, ',' order by id) from messages where thread_id='$THREAD'")"
WANT="$(printf '%s\n%s\n' "$MSG" "$MSG2" | sort | paste -sd, -)"
[ "$IDS" = "$WANT" ] && ok "消息 id 集合恰好是 A1/T1 两条（无第三条来自失败请求）" \
  || bad "消息 id 集合不符：实际 $IDS / 期望 $WANT"
MM1="$(PSQL "select count(*) from message_media where message_id in (select id from messages where thread_id='$THREAD')")"
[ "$MM1" = "1" ] && ok "message_media 恰好 1 行（只有 A1 那次挂上）" || bad "message_media 行数异常：$MM1"

echo
echo "=== Z. 清理（按 owner 清理 media 行 + 逐个删盘上文件，避免留下未登记文件）==="
for K in $(PSQL "select scope || '/' || storage_key from media where owner_user_id in ('$IDA','$IDB')"); do
  [ -n "$K" ] && rm -f "$UP/$K"
done
PSQL "delete from message_threads where id='$THREAD'" >/dev/null   # 级联删 messages / message_media / thread_members
PSQL "delete from media where owner_user_id in ('$IDA','$IDB')" >/dev/null
PSQL "delete from sessions where user_id in ('$IDA','$IDB')" >/dev/null
PSQL "delete from login_challenges where phone_e164 in ('+86$PA','+86$PB')" >/dev/null
PSQL "delete from users where id in ('$IDA','$IDB')" >/dev/null
rm -rf "$WORK"
LEFT="$(PSQL "select count(*) from media where owner_user_id in ('$IDA','$IDB')")"
LEAK="$(find "$UP" \( -name "$MA*" -o -name "$MB*" -o -name "$MP*" \) 2>/dev/null | wc -l)"
[ "$LEFT" = "0" ] && [ "$LEAK" = "0" ] && ok "测试数据与盘上文件都已清理（DB 0 行、盘上 0 个残留）" \
  || bad "仍有残留：DB $LEFT 行 / 盘上 $LEAK 个"

echo
if [ "$FAILED" -eq 0 ]; then echo "MESSAGE_MEDIA_RESULT PASS"; else echo "MESSAGE_MEDIA_RESULT FAIL"; fi
exit "$FAILED"
