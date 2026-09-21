#!/usr/bin/env bash
# M4 上传契约验证 —— 审核记录 13 第 1/2/3/4/7 条 + 记录 15 的幂等键
#
# 关键契约：
#   ① 伪造 .jpg（非图片内容）必须拒绝
#   ② 路径穿越：客户端 filename 带 ../ 不得影响实际存储路径
#   ③ 合法 PNG → 201 + 文件落盘 + DB 行（含真实尺寸与 sha256）
#   ④ scope 由服务端按 purpose 决定（post→public / chat→private）
#   ⑤ 幂等键：同一 upload_request_id 重试 → 返回同一条 media，**不新增文件**
#   ⑥ 缺 upload_request_id / 非法 purpose → 400
#   ⑦ 未登录 → 401
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
SINK=/run/campus/login-codes
UPLOADS=/srv/campus/uploads

# 生成一个**真正合法的 PNG**（手写最小结构：签名 + IHDR + IDAT + IEND）
make_png() {
  python3 - "$1" <<'PY'
import struct, sys, zlib
w, h = 40, 30
sig = b'\x89PNG\r\n\x1a\n'
ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
raw = b''.join(b'\x00' + b'\xff\x00\x00\xff' * w for _ in range(h))
idat = zlib.compress(raw, 9)
open(sys.argv[1], 'wb').write(sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b''))
PY
}

echo "=== 0. 登录（真实手机号 + dev sink）==="
rm -f "$SINK"/*.json 2>/dev/null || true
PHONE="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
REQ="$(curl -s -X POST "$BASE/api/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}")"
SINKF="$(printf '%s' "$REQ" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINKF" 2>/dev/null)"
TOK="$(curl -s -X POST "$BASE/api/auth/verify-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
MEMBER_ID="$(PSQL "select id from users where phone_e164='+86$PHONE'")"
[ -n "$TOK" ] && ok "登录成功（id=${MEMBER_ID:0:8}…）" || { bad "登录失败"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOK")

WORK="$(mktemp -d)"
make_png "$WORK/real.png"
printf 'this is definitely not an image, just text pretending to be a jpg' > "$WORK/fake.jpg"
head -c 6000000 /dev/urandom > "$WORK/huge.jpg"   # 6MB > 5MB 上限

echo
echo "=== A. 未登录上传 → 401 ==="
C="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/media" -F "file=@$WORK/real.png" -F "purpose=post" -F "uploadRequestId=$(cat /proc/sys/kernel/random/uuid)")"
[ "$C" = "401" ] && ok "未登录 → 401" || bad "期望 401，实际 $C"

echo
echo "=== B. 伪造 .jpg（内容是文本）→ 必须拒绝 ==="
R="$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/media" -F "file=@$WORK/fake.jpg;type=image/jpeg" -F "purpose=post" -F "uploadRequestId=$(cat /proc/sys/kernel/random/uuid)")"
C="$(printf '%s' "$R" | tail -1)"
[ "$C" = "400" ] && ok "**文本伪装成 image/jpeg → 400**（按内容判类型，不信 Content-Type）" || bad "期望 400，实际 $C（$(printf '%s' "$R" | head -1 | head -c 120)）"
printf '%s' "$R" | grep -q 'not_an_image' && ok "响应明确标注 not_an_image（可诊断）" || bad "响应缺少 not_an_image"

echo
echo "=== C. 超限文件（6MB > 5MB）→ 必须拒绝 ==="
C="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/media" -F "file=@$WORK/huge.jpg;type=image/jpeg" -F "purpose=post" -F "uploadRequestId=$(cat /proc/sys/kernel/random/uuid)")"
case "$C" in
  413|400) ok "6MB 文件 → $C（受控拒绝）" ;;
  *) bad "期望 413/400，实际 $C" ;;
esac

echo
echo "=== D. 缺 upload_request_id / 非法 purpose → 400 ==="
C="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/media" -F "file=@$WORK/real.png" -F "purpose=post")"
[ "$C" = "400" ] && ok "缺 upload_request_id → 400（不允许无幂等键上传）" || bad "期望 400，实际 $C"
C="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/media" -F "file=@$WORK/real.png" -F "purpose=evil" -F "uploadRequestId=$(cat /proc/sys/kernel/random/uuid)")"
[ "$C" = "400" ] && ok "非法 purpose → 400（scope 由服务端决定）" || bad "期望 400，实际 $C"

echo
echo "=== E. 合法 PNG 上传（public）→ 201 + 文件 + DB 行 ==="
REQID="$(cat /proc/sys/kernel/random/uuid)"
BEFORE="$(find "$UPLOADS" -type f | wc -l)"
R="$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/media" \
  -F "file=@$WORK/real.png" -F "purpose=post" -F "uploadRequestId=$REQID")"
C="$(printf '%s' "$R" | tail -1)"; BODY="$(printf '%s' "$R" | head -1)"
[ "$C" = "201" ] && ok "合法 PNG → 201" || bad "期望 201，实际 $C（$BODY）"
MID="$(printf '%s' "$BODY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
KEY="$(printf '%s' "$BODY" | sed -n 's/.*"storageKey":"\([^"]*\)".*/\1/p')"
[ "$(printf '%s' "$BODY" | grep -c '"scope":"public"')" = "1" ] && ok "purpose=post → scope=public（服务端映射）" || bad "scope 不是 public：$BODY"
W="$(printf '%s' "$BODY" | sed -n 's/.*"width":\([0-9]*\).*/\1/p')"
H="$(printf '%s' "$BODY" | sed -n 's/.*"height":\([0-9]*\).*/\1/p')"
[ "$W" = "40" ] && [ "$H" = "30" ] && ok "解出真实尺寸 ${W}x${H}（与生成的一致）" || bad "尺寸不符：${W}x${H}（期望 40x30）"
case "$KEY" in
  2*/*/*.png) ok "storage_key 形态正确（$KEY）" ;;
  *) bad "storage_key 形态异常：$KEY" ;;
esac
[ -f "$UPLOADS/public/$KEY" ] && ok "文件落在 public/ 命名空间下" || bad "文件不在 public/$KEY"
[ -f "$UPLOADS/private/$KEY" ] && bad "同名文件竟然也出现在 private/（命名空间混了）" || ok "private/ 下没有同名文件（命名空间分开）"
DBROW="$(PSQL "select scope || '|' || mime || '|' || bytes || '|' || width || 'x' || height || '|' || length(sha256) from media where id='$MID'")"
case "$DBROW" in
  public\|image/png\|*) ok "DB 行正确（$DBROW）" ;;
  *) bad "DB 行异常：$DBROW" ;;
esac
# 落盘文件的 sha256 必须与 DB 记录一致（不是"写了个别的文件"）
FILE_SHA="$(sha256sum "$UPLOADS/public/$KEY" | cut -d' ' -f1)"
DB_SHA="$(PSQL "select sha256 from media where id='$MID'")"
[ "$FILE_SHA" = "$DB_SHA" ] && ok "**盘上文件 sha256 == DB 记录**（内容与登记一致）" || bad "sha256 不一致：盘上 $FILE_SHA / DB $DB_SHA"
# 经公共静态路径应该能取到，且类型正确
CT="$(curl -s -o /dev/null -D - "$BASE/media/$KEY" | grep -i '^Content-Type:' | tr -d '\r' | sed 's/^[Cc]ontent-[Tt]ype: *//')"
[ "$CT" = "image/png" ] && ok "公共静态直出 Content-Type: image/png" || bad "公共静态类型异常：$CT"

echo
echo "=== F. 幂等键：同一 uploadRequestId 重试 → 同一条 media 且**不新增文件** ==="
R2="$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/media" \
  -F "file=@$WORK/real.png" -F "purpose=post" -F "uploadRequestId=$REQID")"
C2="$(printf '%s' "$R2" | tail -1)"; B2="$(printf '%s' "$R2" | head -1)"
MID2="$(printf '%s' "$B2" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
AFTER="$(find "$UPLOADS" -type f | wc -l)"
[ "$MID2" = "$MID" ] && ok "重试返回**同一条** media（id 一致）" || bad "重试返回了不同的 id：$MID2 vs $MID"
printf '%s' "$B2" | grep -q '"idempotentReplay":true' && ok "响应标记 idempotentReplay=true" || bad "响应没有标记幂等重放"
[ "$BEFORE" = "$((AFTER - 1))" ] && ok "**文件数只增加了 1**（重试没有新建文件：$BEFORE → $AFTER）" || bad "文件数异常：$BEFORE → $AFTER（重试可能写了第二个文件）"
CNT="$(PSQL "select count(*) from media where upload_request_id='$REQID'")"
[ "$CNT" = "1" ] && ok "DB 里该幂等键只有 1 行" || bad "该幂等键有 $CNT 行"

echo
echo "=== G. 路径穿越：客户端 filename 带 ../ 不影响存储路径 ==="
TRAV="$(cat /proc/sys/kernel/random/uuid)"
R3="$(curl -s -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/api/media" \
  -F "file=@$WORK/real.png;filename=../../../../tmp/pwned.png" -F "purpose=post" -F "uploadRequestId=$TRAV")"
C3="$(printf '%s' "$R3" | tail -1)"; B3="$(printf '%s' "$R3" | head -1)"
KEY3="$(printf '%s' "$B3" | sed -n 's/.*"storageKey":"\([^"]*\)".*/\1/p')"
[ "$C3" = "201" ] && ok "带 ../ 的 filename 上传仍然成功（服务端改名）" || bad "期望 201，实际 $C3"
case "$KEY3" in
  *..*) bad "storage_key 里竟然出现了 ..：$KEY3" ;;
  *) ok "storage_key 不含 ..（服务端生成，客户端名字被完全忽略）" ;;
esac
[ -f /tmp/pwned.png ] && bad "**/tmp/pwned.png 被创建了 —— 路径穿越成功！**" || ok "/tmp/pwned.png 不存在（没有穿越到 UPLOAD_ROOT 之外）"
[ -f "$UPLOADS/public/$KEY3" ] && ok "文件仍在 uploads/public 下（$KEY3）" || bad "文件不在预期位置"
# 客户端原始 filename 不应出现在任何路径里
find "$UPLOADS" -name '*pwned*' | grep -q . && bad "uploads 下出现了客户端 filename 的痕迹" || ok "uploads 下没有客户端 filename 的痕迹"

echo
echo "=== H. chat 用途 → private 命名空间 ==="
REQ4="$(cat /proc/sys/kernel/random/uuid)"
B4="$(curl -s "${AUTH[@]}" -X POST "$BASE/api/media" -F "file=@$WORK/real.png" -F "purpose=chat" -F "uploadRequestId=$REQ4")"
MID4="$(printf '%s' "$B4" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
KEY4="$(printf '%s' "$B4" | sed -n 's/.*"storageKey":"\([^"]*\)".*/\1/p')"
[ "$(printf '%s' "$B4" | grep -c '"scope":"private"')" = "1" ] && ok "purpose=chat → scope=private" || bad "scope 不是 private：$B4"
[ -f "$UPLOADS/private/$KEY4" ] && ok "文件落在 private/ 命名空间下" || bad "文件不在 private/$KEY4"
# private 媒体未挂到任何消息上 → 任何人都读不到（can_read_media 要求存在可读引用消息）
C404="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/media/$MID4" "${AUTH[@]}")"
[ "$C404" = "404" ] && ok "**未挂到消息的 private 媒体 → 404**（没有被'上传即可读'这个错误授权放行）" || bad "期望 404，实际 $C404"

echo
echo "=== I. 清理 ==="
for mid in "$MID" "$MID4"; do
  [ -n "$mid" ] || continue
  K="$(PSQL "select scope || '/' || storage_key from media where id='$mid'")"
  [ -n "$K" ] && rm -f "$UPLOADS/$K"
  PSQL "delete from media where id='$mid'" >/dev/null
done
PSQL "delete from sessions where user_id='$MEMBER_ID'" >/dev/null
PSQL "delete from login_challenges where phone_e164='+86$PHONE'" >/dev/null
PSQL "delete from users where id='$MEMBER_ID'" >/dev/null
rm -rf "$WORK"
LEFT="$(PSQL "select count(*) from media where owner_user_id='$MEMBER_ID'")"
[ "$LEFT" = "0" ] && ok "测试数据已清理" || bad "仍有残留"

echo
if [ "$FAILED" -eq 0 ]; then echo "MEDIA_UPLOAD_RESULT PASS"; else echo "MEDIA_UPLOAD_RESULT FAIL"; fi
exit "$FAILED"
