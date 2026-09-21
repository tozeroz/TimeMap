#!/usr/bin/env bash
# WO#5 Phase 1 Gate：A4 的 7 条负向断言（审核记录 35 §八）
#
# ⚠ 本脚本第一版的教训（已修，写在这里防止退回）：
#   第一版用**自己拼的假 WebM** 当 fixture，头长度编码写错（0x88 应为 0x84），
#   于是服务端把它判成"不认识的文件类型"，A4.1 拿到的错误码是 not_an_image
#   而**不是** missing_duration_ms —— 断言**因错误的原因通过**。
#   同时 A4.5 的 $AUD_ID 为空，得到的是 bad_media_id，**也没测到 kind↔mime 错配**。
#   → 修法：① fixture 用**真机录出的真 WebM**（最真实）；
#           ② 加"fixture 必须能被正常上传"的前置断言，fixture 不合法就**直接失败**，
#              不允许后续断言在 fixture 无效的情况下"通过"。
set -u
THREAD='66666666-cccc-4ccc-8ccc-000000000003'
PHONE='+8613800000002'
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
API='http://127.0.0.1:3001'
UP=/srv/campus/uploads

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
die() { echo "  FATAL $1"; echo; echo "VOICE_NEGATIVE_ASSERTIONS: FAIL（前置失败，后续断言未执行）"; exit 2; }

echo "=== 0) 取会话 token（真实登录接口 + dev sink）==="
curl -s -X POST "$API/api/auth/request-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"${PHONE#+86}\"}" >/dev/null
sleep 1
CODE=$(python3 - <<'PY'
import json
try:
    with open('/run/campus/login-codes/latest.json') as f:
        print(json.load(f)['code'])
except Exception:
    print('')
PY
)
[ -n "$CODE" ] || die "取不到验证码"
TOKEN=$(curl -s -X POST "$API/api/auth/verify-code" -H 'content-type: application/json' \
  -d "{\"phone\":\"${PHONE#+86}\",\"code\":\"$CODE\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
[ -n "$TOKEN" ] || die "登录未拿到 token"
AUTH="authorization: Bearer $TOKEN"
echo "  token ok"

echo
echo "=== 1) 准备 fixture ==="
# 图片：程序生成一张合法 2x2 PNG
python3 - <<'PY' > /tmp/probe.png
import struct, zlib, sys
def chunk(t,d):
    c=t+d
    return struct.pack('>I',len(d))+c+struct.pack('>I',zlib.crc32(c)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'
png+=chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,2,0,0,0))
raw=b'\x00'+b'\xff\x00\x00'*2+b'\x00'+b'\x00\xff\x00'*2
png+=chunk(b'IDAT',zlib.compress(raw))
png+=chunk(b'IEND',b'')
sys.stdout.buffer.write(png)
PY
# 音频：优先用**真机录出的真 WebM**（从 uploads 里找一条 audio/webm）；
#       找不到才退回到"手工构造但长度编码正确"的最小 WebM 头。
REAL=$(PSQL "select storage_key from media where mime='audio/webm' order by created_at desc limit 1")
if [ -n "$REAL" ]; then
  SRC=$(PSQL "select scope from media where storage_key='$REAL' limit 1")
  cp "$UP/$SRC/$REAL" /tmp/probe.webm && echo "  fixture webm: 用真机录制文件（$SRC/$REAL，$(stat -c%s /tmp/probe.webm) 字节）"
else
  python3 - <<'PY' > /tmp/probe.webm
import sys
# EBML magic + DocType(0x4282) 长度=4(0x84) + "webm" + 一些载荷
b = bytes([0x1a,0x45,0xdf,0xa3]) + bytes([0x42,0x82,0x84]) + b'webm' + bytes(range(64))
sys.stdout.buffer.write(b)
PY
  echo "  fixture webm: 手工构造（$(stat -c%s /tmp/probe.webm) 字节）⚠ 非真机文件"
fi

MEDIA0=$(PSQL "select count(*) from media")
MSG0=$(PSQL "select count(*) from messages")
echo "  基线: media=$MEDIA0 messages=$MSG0"

echo
echo "=== 1.5) ★ fixture 前置断言：两者都必须能**正常上传成功** ==="
IMG_ID=$(curl -s -X POST "$API/api/media" -H "$AUTH" \
  -F "file=@/tmp/probe.png;type=image/png" -F 'purpose=chat' -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("id",""))' 2>/dev/null)
[ -n "$IMG_ID" ] || die "图片 fixture 无法上传（后续 A4.4 会拿空 id 假通过）"
ok "图片 fixture 上传成功 id=${IMG_ID:0:8}…"

AUD_ID=$(curl -s -X POST "$API/api/media" -H "$AUTH" \
  -F "file=@/tmp/probe.webm;type=audio/webm" -F 'purpose=chat' -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" -F 'durationMs=2222' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("id",""))' 2>/dev/null)
[ -n "$AUD_ID" ] || die "音频 fixture 无法上传（说明 webm 探测/时长校验有问题；后续 A4.5 会拿空 id 假通过）"
ok "音频 fixture 上传成功 id=${AUD_ID:0:8}…"
MEDIA1=$(PSQL "select count(*) from media")
MSG1=$(PSQL "select count(*) from messages")

echo
echo "=== A4.1 audio/webm **不带** durationMs → 400 missing_duration_ms 且无 media 行 ==="
R1=$(curl -s -o /tmp/r1.txt -w '%{http_code}' -X POST "$API/api/media" -H "$AUTH" \
  -F "file=@/tmp/probe.webm;type=audio/webm" -F 'purpose=chat' -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')")
M=$(PSQL "select count(*) from media")
if [ "$R1" = "400" ] && [ "$M" = "$MEDIA1" ] && grep -q 'missing_duration_ms' /tmp/r1.txt; then
  ok "A4.1 HTTP 400 + missing_duration_ms + media 未增"
else
  bad "A4.1 HTTP=$R1 media $MEDIA1->$M body=$(cat /tmp/r1.txt | head -c 120)"
fi

echo
echo "=== A4.2 image/png **带** durationMs → 400 unexpected_duration_ms 且无 media 行 ==="
R2=$(curl -s -o /tmp/r2.txt -w '%{http_code}' -X POST "$API/api/media" -H "$AUTH" \
  -F "file=@/tmp/probe.png;type=image/png" -F 'purpose=chat' -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" -F 'durationMs=12000')
M=$(PSQL "select count(*) from media")
if [ "$R2" = "400" ] && [ "$M" = "$MEDIA1" ] && grep -q 'unexpected_duration_ms' /tmp/r2.txt; then
  ok "A4.2 HTTP 400 + unexpected_duration_ms + media 未增"
else
  bad "A4.2 HTTP=$R2 media $MEDIA1->$M body=$(cat /tmp/r2.txt | head -c 120)"
fi

echo
echo "=== A4.3 伪造二进制声明 audio/webm（无 EBML 头）→ sniff 拒绝 且无 media 行 ==="
python3 - <<'PY' > /tmp/fake.webm
import sys
sys.stdout.buffer.write(b'this is definitely not a webm container' * 8)
PY
R3=$(curl -s -o /tmp/r3.txt -w '%{http_code}' -X POST "$API/api/media" -H "$AUTH" \
  -F "file=@/tmp/fake.webm;type=audio/webm" -F 'purpose=chat' -F "uploadRequestId=$(python3 -c 'import uuid;print(uuid.uuid4())')" -F 'durationMs=1000')
M=$(PSQL "select count(*) from media")
# 要求：400 **且** 是"类型判定为音频探测失败"（audioReason 出现），而不是别的原因
if [ "$R3" = "400" ] && [ "$M" = "$MEDIA1" ] && grep -q 'audioReason' /tmp/r3.txt; then
  ok "A4.3 HTTP 400 + audioReason（sniff 拒绝）+ media 未增"
else
  bad "A4.3 HTTP=$R3 media $MEDIA1->$M body=$(cat /tmp/r3.txt | head -c 140)"
fi

echo
echo "=== A4.4 kind='voice' + **图片** media → 400 media_kind_mismatch / 零消息变更 ==="
R4=$(curl -s -o /tmp/r4.txt -w '%{http_code}' -X POST "$API/api/threads/$THREAD/messages" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"body\":\"[语音]\",\"kind\":\"voice\",\"mediaId\":\"$IMG_ID\"}")
M=$(PSQL "select count(*) from messages")
if [ "${R4:0:1}" = "4" ] && [ "$M" = "$MSG1" ] && grep -q 'media_kind_mismatch' /tmp/r4.txt; then
  ok "A4.4 HTTP $R4 + media_kind_mismatch + messages 未变"
else
  bad "A4.4 HTTP=$R4 messages $MSG1->$M body=$(cat /tmp/r4.txt | head -c 120)"
fi

echo
echo "=== A4.5 kind='image' + **音频** media → 400 media_kind_mismatch / 零消息变更 ==="
R5=$(curl -s -o /tmp/r5.txt -w '%{http_code}' -X POST "$API/api/threads/$THREAD/messages" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"body\":\"[图片]\",\"kind\":\"image\",\"mediaId\":\"$AUD_ID\"}")
M=$(PSQL "select count(*) from messages")
if [ "${R5:0:1}" = "4" ] && [ "$M" = "$MSG1" ] && grep -q 'media_kind_mismatch' /tmp/r5.txt; then
  ok "A4.5 HTTP $R5 + media_kind_mismatch + messages 未变"
else
  bad "A4.5 HTTP=$R5 messages $MSG1->$M body=$(cat /tmp/r5.txt | head -c 120)"
fi

echo
echo "=== A4.6 text + mediaId → 保持 400（WO#2 回归）==="
R6=$(curl -s -o /tmp/r6.txt -w '%{http_code}' -X POST "$API/api/threads/$THREAD/messages" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"body\":\"hi\",\"kind\":\"text\",\"mediaId\":\"$IMG_ID\"}")
M=$(PSQL "select count(*) from messages")
if [ "$R6" = "400" ] && [ "$M" = "$MSG1" ]; then ok "A4.6 HTTP 400 + messages 未变（$(cat /tmp/r6.txt | head -c 90)）"; else bad "A4.6 HTTP=$R6 messages $MSG1->$M"; fi

echo
echo "=== A4.7 mediaIds[]（复数）→ 保持 400（WO#2 回归，A7 键）==="
R7=$(curl -s -o /tmp/r7.txt -w '%{http_code}' -X POST "$API/api/threads/$THREAD/messages" -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"body\":\"hi\",\"kind\":\"image\",\"mediaIds\":[\"$IMG_ID\"]}")
if [ "$R7" = "400" ] && grep -q 'array_not_supported_use_singular_mediaId' /tmp/r7.txt; then
  ok "A4.7 HTTP 400 + array_not_supported_use_singular_mediaId"
else
  bad "A4.7 HTTP=$R7 body=$(cat /tmp/r7.txt | head -c 120)"
fi

echo
echo "=== 清理：只删本次 fixture 建的两条 media（按 id 精确删）==="
FILES=$(PSQL "select scope || '/' || storage_key from media where id in ('$IMG_ID','$AUD_ID')")
PSQL "delete from media where id in ('$IMG_ID','$AUD_ID')" >/dev/null && echo "  ok media 行已删"
printf '%s\n' "$FILES" | while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  if [ -f "$UP/$rel" ]; then /bin/rm -f "$UP/$rel"; echo "  已删文件: $rel"; fi
done

echo
echo "=== 收尾计数（media 应回到基线 $MEDIA1 之前的 $MEDIA0）==="
echo "  media: $(PSQL "select count(*) from media")"
echo "  messages: $(PSQL "select count(*) from messages")"
echo "  message_media: $(PSQL "select count(*) from message_media")"
echo -n "  盘库一致: "; cd /srv/campus/server && UPLOAD_ROOT=$UP DATABASE_URL="postgres://campus:$PW@127.0.0.1/campus" node dist/cleanup.mjs --json 2>&1 | head -c 300
echo
echo
echo "VOICE_NEGATIVE_ASSERTIONS_RESULT: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ] && echo "VOICE_NEGATIVE_ASSERTIONS: PASS" || echo "VOICE_NEGATIVE_ASSERTIONS: FAIL"
