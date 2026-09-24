#!/usr/bin/env bash
# ⭐⭐ WO#21 closeout（审核 68 的 P0 销项）：**audio typed persistence / readback**
#
# ═══════════════════════════════════════════════════════════════════════
# 审核 68 原话（我引入的真实缺陷）
# ═══════════════════════════════════════════════════════════════════════
#   > "当时唯一的 P0 是：audio upload → post_media → GET post →
#   >  **audio still represented as audio** → **audio NOT in images**"
#   > "上一版 API 的 read model 是 images: [{ id, width, height }]，
#   >  所以在没有看到新证据之前，我不能假定这个问题已经自己消失。"
#
#   我的自查确认了缺陷：POST 把**所有** mediaId 一律写进 post_media，
#   而 GET 的读模型把 post_media 里**所有**行都放进 images
#   ⇒ **一条语音帖会把 audio 也报成 image**（width/height 为 null）。
#
# ═══════════════════════════════════════════════════════════════════════
# 本门禁就是审核要求的那份证据（逐条对应）
# ═══════════════════════════════════════════════════════════════════════
#   上传 audio → media id = X
#   → POST 含 X
#   → post_media row exists
#   → GET post
#   → **X appears under audio**
#   → **X absent from images**
#   + 同时验证"图片仍然只出现在 images、不出现在 audio"（对称性）
#   + 响应里的 schema（键集合）也一并打印，便于核对
#
# ⚠️ 只创建并删除**自己的**测试帖与测试媒体；结束前清理。
# ⚠️ 用固定测试号 anmoss(+8613800000001)。
set -uo pipefail

PW="$(cat /srv/campus/.db_password)"
API=http://127.0.0.1
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
jq1() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get(sys.argv[1]) if d.get(sys.argv[1]) is not None else "")' "$1" 2>/dev/null; }
jqlen() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(len(d.get(sys.argv[1]) or []))' "$1" 2>/dev/null; }
jqkeys() { python3 -c 'import sys,json;d=json.load(sys.stdin);
import sys as s
v=d.get(s.argv[1]) or []
print(",".join(sorted(v[0].keys())) if v else "(空)")' "$1" 2>/dev/null; }

pass=0; fail=0
ck() { if [ "$2" = PASS ]; then pass=$((pass+1)); else fail=$((fail+1)); fi; printf '  %-40s %s %s\n' "$1" "$2" "${3:-}"; }

# ── 取 token ────────────────────────────────────────────────────────────
PHONE='+8613800000001'
curl -s -X POST "$API/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" >/dev/null
sleep 0.8
SINK="/run/campus/login-codes/$(printf '%s' "$PHONE" | tr -d '+').json"
CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK")"
TOK="$(curl -s -X POST "$API/api/auth/verify-code" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" | jq1 token)"
echo "  token=$([ -n "$TOK" ] && echo yes || echo NO)"
[ -n "$TOK" ] || { echo "  **FATAL** 取不到 token"; exit 2; }

# ── fixture ─────────────────────────────────────────────────────────────
AUD=/tmp/wo21-audio.webm
[ -f "$AUD" ] || cp -f /tmp/m5-voice-fixture.webm "$AUD"
IMG=/tmp/wo21-img.png
[ -f "$IMG" ] || printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' | base64 -d > "$IMG"
echo "  audio bytes=$(wc -c < "$AUD") ／ img bytes=$(wc -c < "$IMG")"

# ── 上传：一个 audio（purpose=post）+ 一个 image（purpose=post）──────────
UP_A="$(curl -s -X POST "$API/api/media" -H "Authorization: Bearer $TOK" \
  -F "file=@$AUD;type=audio/webm" -F 'purpose=post' -F "durationMs=2500" \
  -F "uploadRequestId=$(cat /proc/sys/kernel/random/uuid)")"
AUD_ID="$(printf '%s' "$UP_A" | jq1 id)"
UP_I="$(curl -s -X POST "$API/api/media" -H "Authorization: Bearer $TOK" \
  -F "file=@$IMG;type=image/png" -F 'purpose=post' \
  -F "uploadRequestId=$(cat /proc/sys/kernel/random/uuid)")"
IMG_ID="$(printf '%s' "$UP_I" | jq1 id)"
echo "  media audio=$AUD_ID  image=$IMG_ID  (audio scope/mime: $(printf '%s' "$UP_A" | jq1 scope)/$(printf '%s' "$UP_A" | jq1 mime))"
[ -n "$AUD_ID" ] && [ -n "$IMG_ID" ] || { echo "  **FATAL** 媒体上传失败"; echo "  audio resp: $UP_A"; exit 2; }

# ── 发帖，带两个 mediaId ────────────────────────────────────────────────
CODE_POST="$(curl -s -o /tmp/wo21-post.json -w '%{http_code}' -X POST "$API/api/posts" \
  -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"body\":\"wo21-audio-roundtrip\",\"place\":\"\",\"mediaIds\":[\"$AUD_ID\",\"$IMG_ID\"]}")"
PID="$(jq1 id < /tmp/wo21-post.json)"
echo "  POST code=$CODE_POST  postId=$PID"

# ── ① POST 响应里的分流 ────────────────────────────────────────────────
echo
echo "=== ① POST 响应 ==="
P_AUD_N="$(jqlen audio < /tmp/wo21-post.json)"
P_IMG_N="$(jqlen images < /tmp/wo21-post.json)"
P_AUD_KEYS="$(jqkeys audio < /tmp/wo21-post.json)"
P_IMG_KEYS="$(jqkeys images < /tmp/wo21-post.json)"
echo "  images: n=$P_IMG_N keys=[$P_IMG_KEYS]"
echo "  audio : n=$P_AUD_N keys=[$P_AUD_KEYS]"
P_AUD_HAS="$(python3 -c 'import json,sys;d=json.load(open("/tmp/wo21-post.json"));print("1" if any(x["id"]==sys.argv[1] for x in (d.get("audio") or [])) else "0")' "$AUD_ID")"
P_IMG_HAS_AUD="$(python3 -c 'import json,sys;d=json.load(open("/tmp/wo21-post.json"));print("1" if any(x["id"]==sys.argv[1] for x in (d.get("images") or [])) else "0")' "$AUD_ID")"
P_AUD_HAS_IMG="$(python3 -c 'import json,sys;d=json.load(open("/tmp/wo21-post.json"));print("1" if any(x["id"]==sys.argv[1] for x in (d.get("audio") or [])) else "0")' "$IMG_ID")"
P_IMG_HAS_IMG="$(python3 -c 'import json,sys;d=json.load(open("/tmp/wo21-post.json"));print("1" if any(x["id"]==sys.argv[1] for x in (d.get("images") or [])) else "0")' "$IMG_ID")"
[ "$P_AUD_HAS" = 1 ] && ck POST_AUDIO_IN_AUDIO PASS || ck POST_AUDIO_IN_AUDIO FAIL
[ "$P_IMG_HAS_AUD" = 0 ] && ck POST_AUDIO_NOT_IN_IMAGES PASS || ck POST_AUDIO_NOT_IN_IMAGES FAIL "audio 出现在 images 里"
[ "$P_IMG_HAS_IMG" = 1 ] && ck POST_IMAGE_IN_IMAGES PASS || ck POST_IMAGE_IN_IMAGES FAIL
[ "$P_AUD_HAS_IMG" = 0 ] && ck POST_IMAGE_NOT_IN_AUDIO PASS || ck POST_IMAGE_NOT_IN_AUDIO FAIL

# ── ② post_media row 确实存在 ───────────────────────────────────────────
echo
echo "=== ② post_media ==="
PM="$(PSQL "select count(*) from post_media where post_id = '$PID'")"
PM_AUD="$(PSQL "select count(*) from post_media pm join media m on m.id = pm.media_id where pm.post_id = '$PID' and m.mime = 'audio/webm'")"
echo "  post_media 行数=$PM（其中 audio=$PM_AUD）"
[ "$PM" = 2 ] && [ "$PM_AUD" = 1 ] && ck POST_MEDIA_ROWS_EXIST PASS "2 行，其中 1 条 audio" || ck POST_MEDIA_ROWS_EXIST FAIL "rows=$PM aud=$PM_AUD"

# ── ③ GET 详情：同一分流 ────────────────────────────────────────────────
echo
echo "=== ③ GET /api/posts/:id ==="
curl -s "$API/api/posts/$PID" -o /tmp/wo21-get.json
G_AUD_N="$(jqlen audio < /tmp/wo21-get.json)"
G_IMG_N="$(jqlen images < /tmp/wo21-get.json)"
G_AUD_KEYS="$(jqkeys audio < /tmp/wo21-get.json)"
G_IMG_KEYS="$(jqkeys images < /tmp/wo21-get.json)"
echo "  images: n=$G_IMG_N keys=[$G_IMG_KEYS]"
echo "  audio : n=$G_AUD_N keys=[$G_AUD_KEYS]"
G_AUD_HAS="$(python3 -c 'import json,sys;d=json.load(open("/tmp/wo21-get.json"));print("1" if any(x["id"]==sys.argv[1] for x in (d.get("audio") or [])) else "0")' "$AUD_ID")"
G_IMG_HAS_AUD="$(python3 -c 'import json,sys;d=json.load(open("/tmp/wo21-get.json"));print("1" if any(x["id"]==sys.argv[1] for x in (d.get("images") or [])) else "0")' "$AUD_ID")"
G_IMG_HAS_IMG="$(python3 -c 'import json,sys;d=json.load(open("/tmp/wo21-get.json"));print("1" if any(x["id"]==sys.argv[1] for x in (d.get("images") or [])) else "0")' "$IMG_ID")"
G_DUR="$(python3 -c 'import json;d=json.load(open("/tmp/wo21-get.json"));a=d.get("audio") or [{}];print(a[0].get("durationMs"))' 2>/dev/null)"
echo "  audio durationMs=$G_DUR（期望 2500）"
[ "$G_AUD_HAS" = 1 ] && ck GET_AUDIO_IN_AUDIO PASS || ck GET_AUDIO_IN_AUDIO FAIL
[ "$G_IMG_HAS_AUD" = 0 ] && ck GET_AUDIO_NOT_IN_IMAGES PASS "⭐ 审核 68 的 P0 判据" || ck GET_AUDIO_NOT_IN_IMAGES FAIL "**audio 仍出现在 images 里**"
[ "$G_IMG_HAS_IMG" = 1 ] && ck GET_IMAGE_IN_IMAGES PASS || ck GET_IMAGE_IN_IMAGES FAIL
[ "$G_DUR" = 2500 ] && ck GET_AUDIO_DURATION_TYPED PASS "2500" || ck GET_AUDIO_DURATION_TYPED FAIL "got=$G_DUR"

# ── ④ 列表端点同样分流 ─────────────────────────────────────────────────
echo
echo "=== ④ GET /api/posts（列表）==="
curl -s "$API/api/posts" -o /tmp/wo21-list.json
L=."$(python3 -c 'import json;d=json.load(open("/tmp/wo21-list.json"));items=d.get("items") or [];print([i for i in items if i.get("id")])
' 2>/dev/null || true)"
python3 - <<'PY' > /tmp/wo21-listcheck.txt
import json
d = json.load(open('/tmp/wo21-list.json'))
items = d.get('items') or []
for it in items:
    if it.get('body') == 'wo21-audio-roundtrip':
        aud = [x['id'] for x in (it.get('audio') or [])]
        img = [x['id'] for x in (it.get('images') or [])]
        print('LIST_AUD=%s' % ','.join(aud))
        print('LIST_IMG=%s' % ','.join(img))
        break
else:
    print('LIST_AUD=')
    print('LIST_IMG=')
PY
L_AUD="$(sed -n 's/^LIST_AUD=//p' /tmp/wo21-listcheck.txt)"
L_IMG="$(sed -n 's/^LIST_IMG=//p' /tmp/wo21-listcheck.txt)"
echo "  list audio=[$L_AUD]  images=[$L_IMG]"
if printf '%s' "$L_AUD" | grep -q "$AUD_ID" && ! printf '%s' "$L_IMG" | grep -q "$AUD_ID"; then
  ck LIST_ENDPOINT_SPLITS PASS "audio 在 audio 里、不在 images 里"
else
  ck LIST_ENDPOINT_SPLITS FAIL "audio=[$L_AUD] images=[$L_IMG]"
fi
if printf '%s' "$L_IMG" | grep -q "$IMG_ID"; then ck LIST_IMAGE_IN_IMAGES PASS; else ck LIST_IMAGE_IN_IMAGES FAIL; fi

# ── 清理 ────────────────────────────────────────────────────────────────
echo
echo "=== 清理 ==="
[ -n "$PID" ] && PSQL "delete from posts where id = '$PID'" >/dev/null
PSQL "delete from media where id in ('$AUD_ID','$IMG_ID')" >/dev/null
LEFT="$(PSQL "select count(*) from posts where body = 'wo21-audio-roundtrip'")"
echo "  剩余测试帖=$LEFT（应 0）"

echo
echo "══ 汇总 ══"
echo "  PASS=$pass FAIL=$fail"
if [ "$fail" -eq 0 ]; then echo "WO21_AUDIO_ROUNDTRIP: PASS"; exit 0; else echo "WO21_AUDIO_ROUNDTRIP: FAIL"; exit 1; fi
