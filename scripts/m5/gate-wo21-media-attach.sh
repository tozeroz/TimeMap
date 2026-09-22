#!/usr/bin/env bash
# ⭐ WO#21 服务器侧门禁：发帖媒体附件（mediaIds）—— v2
#
# ⚠️ v1 的两个失败都是**脚本自身**的缺陷，已修（如实记录）：
#    ① 用 `sed 's/.*"id":"\([^"]*\)".*/\1/p'` 提取 postId 是**贪婪匹配** ——
#       响应里出现 `images:[{id:...}]` 之后，它匹配到的是**最后一个** id（mediaId），
#       于是我拿 mediaId 去 delete posts ⇒ 帖子没删掉（gates 自己留下残留）。
#    ② 同一原因导致从 GET 响应里取 images 也失败 ⇒ 误报 POST_IMAGES_SHAPE_MATCHES_GET FAIL。
#    ⇒ 改为**用 python3 解析 JSON**（sed 抓 JSON 本来就脆）。
#
# 断言（8 键）：
#   POST_NO_MEDIA_KEYS_STILL_WORKS   不传 mediaIds ⇒ 行为与旧版一致（向后兼容）
#   POST_WITH_MEDIA_ATTACHES         带自己的 public mediaId ⇒ 帖子 images 含它
#   POST_IMAGES_SHAPE_MATCHES_GET    响应里的 images 与 GET /api/posts/:id 一致
#   POST_REJECTS_UNKNOWN_MEDIA       不存在的 mediaId ⇒ 4xx
#   POST_REJECTS_OTHERS_MEDIA        别人的 mediaId ⇒ **403**（归属校验，OUR_DESIGN_CHOICE）
#   POST_REJECTS_PRIVATE_MEDIA       聊天(private)媒体 ⇒ 4xx
#   POST_REJECTS_BAD_SHAPE           非数组/重复/超量 ⇒ 400
#   POST_ATOMIC_ON_BAD_MEDIA         带非法 mediaId 时**不留下半条帖子**（事务原子性）
#
# ⚠️ 本脚本创建并删除**自己的**测试帖与测试媒体；结束前清理（含 post_media 级联）。
# ⚠️ 用固定测试号 anmoss(+8613800000001) / Lemy(+8613800000002)。
set -uo pipefail

PW="$(cat /srv/campus/.db_password)"
API=http://127.0.0.1
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
# ⭐ 用 python3 解析 JSON，而不是 sed
jq1() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get(sys.argv[1]) or "")' "$1" 2>/dev/null; }

pass=0; fail=0
ck() { if [ "$2" = PASS ]; then pass=$((pass+1)); else fail=$((fail+1)); fi; printf '  %-34s %s %s\n' "$1" "$2" "${3:-}"; }

login() {
  local phone="$1"
  curl -s -X POST "$API/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$phone\"}" >/dev/null
  sleep 0.8
  local sink="/run/campus/login-codes/$(printf '%s' "$phone" | tr -d '+').json"
  local code; code="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$sink")"
  curl -s -X POST "$API/api/auth/verify-code" -H 'content-type: application/json' \
    -d "{\"phone\":\"$phone\",\"code\":\"$code\"}" | jq1 token
}
TOK_A="$(login '+8613800000001')"; TOK_B="$(login '+8613800000002')"
echo "  token A=$([ -n "$TOK_A" ] && echo yes || echo NO)  token B=$([ -n "$TOK_B" ] && echo yes || echo NO)"
[ -n "$TOK_A" ] && [ -n "$TOK_B" ] || { echo "  **FATAL** 取不到 token"; exit 2; }

PNG=/tmp/wo21-1x1.png
[ -f "$PNG" ] || printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' | base64 -d > "$PNG"

up_media() {
  curl -s -X POST "$API/api/media" -H "Authorization: Bearer $1" \
    -F "file=@$PNG;type=image/png" -F "purpose=$2" -F "uploadRequestId=$(cat /proc/sys/kernel/random/uuid)" | jq1 id
}
MINE="$(up_media "$TOK_A" post)"; THEIRS="$(up_media "$TOK_B" post)"; CHAT="$(up_media "$TOK_A" chat)"
echo "  media mine=$MINE theirs=$THEIRS chat=$CHAT"
[ -n "$MINE" ] && [ -n "$THEIRS" ] && [ -n "$CHAT" ] || { echo "  **FATAL** 媒体上传失败"; exit 2; }

# 返回：<body>\n<code>；另把 body 存到 /tmp/wo21-body.json 供解析
post() {
  curl -s -m 20 -o /tmp/wo21-body.json -w '%{http_code}' -X POST "$API/api/posts" \
    -H "Authorization: Bearer $1" -H 'content-type: application/json' -d "$2"
}

CREATED_POSTS=()

echo
echo "=== ① 不传 mediaIds（向后兼容）==="
C="$(post "$TOK_A" '{"body":"wo21-gate no-media","place":""}')"
PID0="$(jq1 id < /tmp/wo21-body.json)"
NIMG="$(python3 -c 'import json;print(len(json.load(open("/tmp/wo21-body.json")).get("images") or []))' 2>/dev/null)"
[ -n "$PID0" ] && CREATED_POSTS+=("$PID0")
if [ "$C" = 201 ] && [ "$NIMG" = 0 ]; then ck POST_NO_MEDIA_KEYS_STILL_WORKS PASS "201 + images=[]"; else ck POST_NO_MEDIA_KEYS_STILL_WORKS FAIL "code=$C nimg=$NIMG"; fi

echo
echo "=== ② 带自己的 public media（应挂上）==="
C="$(post "$TOK_A" "{\"body\":\"wo21-gate with-media\",\"place\":\"\",\"mediaIds\":[\"$MINE\"]}")"
PID1="$(jq1 id < /tmp/wo21-body.json)"
NIMG1="$(python3 -c 'import json;d=json.load(open("/tmp/wo21-body.json"));print(len(d.get("images") or []))' 2>/dev/null)"
RESIMG="$(python3 -c 'import json;d=json.load(open("/tmp/wo21-body.json"));print(",".join(x["id"] for x in (d.get("images") or [])))' 2>/dev/null)"
[ -n "$PID1" ] && CREATED_POSTS+=("$PID1")
if [ "$C" = 201 ] && [ "$NIMG1" = 1 ] && [ "$RESIMG" = "$MINE" ]; then
  ck POST_WITH_MEDIA_ATTACHES PASS "201 且 images=[$RESIMG]"
else
  ck POST_WITH_MEDIA_ATTACHES FAIL "code=$C nimg=$NIMG1 images=$RESIMG"
fi

echo
echo "=== ③ 响应形状与 GET 一致 ==="
if [ -n "$PID1" ]; then
  curl -s "$API/api/posts/$PID1" -o /tmp/wo21-get.json
  GIMG="$(python3 -c 'import json;d=json.load(open("/tmp/wo21-get.json"));print(",".join(x["id"] for x in (d.get("images") or [])))' 2>/dev/null)"
  GKEYS="$(python3 -c 'import json;d=json.load(open("/tmp/wo21-get.json"));i=(d.get("images") or [{}])[0];print(",".join(sorted(i.keys())))' 2>/dev/null)"
  if [ "$GIMG" = "$MINE" ] && [ "$GKEYS" = "height,id,width" ]; then ck POST_IMAGES_SHAPE_MATCHES_GET PASS "GET images=[$GIMG] keys=$GKEYS"; else ck POST_IMAGES_SHAPE_MATCHES_GET FAIL "GET images=[$GIMG] keys=$GKEYS"; fi
else
  ck POST_IMAGES_SHAPE_MATCHES_GET FAIL "没拿到 postId"
fi

echo
echo "=== ④ 负数用例 ==="
C="$(post "$TOK_A" '{"body":"wo21-gate x","place":"","mediaIds":["deadbeef-0000-4000-8000-000000000000"]}')"
[ "$C" -ge 400 ] && [ "$C" -lt 500 ] && ck POST_REJECTS_UNKNOWN_MEDIA PASS "code=$C" || ck POST_REJECTS_UNKNOWN_MEDIA FAIL "code=$C"

C="$(post "$TOK_A" "{\"body\":\"wo21-gate x\",\"place\":\"\",\"mediaIds\":[\"$THEIRS\"]}")"
[ "$C" = 403 ] && ck POST_REJECTS_OTHERS_MEDIA PASS "403" || ck POST_REJECTS_OTHERS_MEDIA FAIL "code=$C（期望 403）"

C="$(post "$TOK_A" "{\"body\":\"wo21-gate x\",\"place\":\"\",\"mediaIds\":[\"$CHAT\"]}")"
[ "$C" -ge 400 ] && [ "$C" -lt 500 ] && ck POST_REJECTS_PRIVATE_MEDIA PASS "code=$C" || ck POST_REJECTS_PRIVATE_MEDIA FAIL "code=$C"

BADC=0
for J in '{"body":"x","place":"","mediaIds":"nope"}' \
         "{\"body\":\"x\",\"place\":\"\",\"mediaIds\":[\"$MINE\",\"$MINE\"]}" \
         '{"body":"x","place":"","mediaIds":["a","b","c","d","e","f","g","h","i","j"]}'; do
  Cc="$(post "$TOK_A" "$J")"; [ "$Cc" = 400 ] || BADC=$((BADC+1))
done
[ "$BADC" -eq 0 ] && ck POST_REJECTS_BAD_SHAPE PASS "三种非法载荷均 400" || ck POST_REJECTS_BAD_SHAPE FAIL "$BADC/3 未被 400 拒"

BEFORE="$(PSQL "select count(*) from posts where body = 'wo21-gate atomic'")"
post "$TOK_A" '{"body":"wo21-gate atomic","place":"","mediaIds":["deadbeef-0000-4000-8000-000000000000"]}' >/dev/null
AFTER="$(PSQL "select count(*) from posts where body = 'wo21-gate atomic'")"
[ "$BEFORE" = 0 ] && [ "$AFTER" = 0 ] && ck POST_ATOMIC_ON_BAD_MEDIA PASS "非法媒体时未落帖" || ck POST_ATOMIC_ON_BAD_MEDIA FAIL "before=$BEFORE after=$AFTER"

echo
echo "=== 清理（先删 media，让 post_media 级联；再按 id 删帖）==="
PSQL "delete from media where id in ('$MINE','$THEIRS','$CHAT')" >/dev/null
for p in "${CREATED_POSTS[@]:-}"; do [ -n "$p" ] && PSQL "delete from posts where id = '$p'" >/dev/null; done
# 兜底：更早版本留下的残留（按 body 前缀删）
PSQL "delete from posts where body like 'wo21-gate%'" >/dev/null
LEFT="$(PSQL "select count(*) from posts where body like 'wo21-gate%'")"
LEFTPM="$(PSQL "select count(*) from post_media pm join posts p on p.id=pm.post_id where p.body like 'wo21-gate%'")"
echo "  剩余 wo21-gate* 帖子=$LEFT（应 0）  其 post_media=$LEFTPM（应 0）"

echo
echo "══ 汇总 ══"
echo "  PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ] && { echo "WO21_MEDIA_ATTACH_GATE: PASS"; exit 0; } || { echo "WO21_MEDIA_ATTACH_GATE: FAIL"; exit 1; }
