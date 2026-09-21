#!/usr/bin/env bash
# M3 Slice 4 验证（后端部分）：地点详情接口 + 发帖时地点归属落库
#
# 一致性依据是**只读取得**的证据（supplements/poi-detail.json），未被政策排除，
# 因此 poi-detail 这一页可以做真实的（conformance）判定。
#
# 关键点：原版 poi-detail 是「按地点聚合动态」→ 只能靠 posts.place_id；
# 只存文本 place 是查不出来的。所以这里机械验证 place_id 真的落了。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1/api
SINK=/run/campus/login-codes
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1"; }
jget() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }
jnum() { printf '%s' "$1" | sed -n "s/.*\"$2\":\([0-9]*\).*/\1/p" | head -1; }

PLACE=cccccccc-0001-4001-8001-000000000001   # seed: 北京交通大学

echo "=== A. 取会话（手机号 + dev sink 取码）==="
PHONE="138$(printf '%08d' $((RANDOM * RANDOM % 100000000)))"
rm -f "$SINK/"*.json 2>/dev/null || true
REQ="$(curl -s -m 10 -X POST "$BASE/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}")"
SINK_PATH="$(jget "$REQ" sink)"
CODE=""
[ -n "$SINK_PATH" ] && [ -f "$SINK_PATH" ] && CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK_PATH")"
VER="$(curl -s -m 10 -X POST "$BASE/auth/verify-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}")"
TOKEN="$(jget "$VER" token)"
AUTH=()
if [ -n "$TOKEN" ]; then AUTH=(-H "Authorization: Bearer $TOKEN"); ok "已取得会话"; else bad "登录失败：$VER"; exit 1; fi
ME_ID="$(jget "$(curl -s -m 10 "$BASE/auth/me" "${AUTH[@]}")" id)"

echo
echo "=== B. 地点详情接口（地点本体 + 经纬度 + 地址 + 动态数）==="
DET="$(curl -s -m 10 "$BASE/places/$PLACE")"
echo "  响应: $(printf '%s' "$DET" | head -c 260)"
[ "$(jget "$DET" name)" = "北京交通大学" ] && ok "返回地点名" || bad "地点名不符"
[ -n "$(jget "$DET" address)" ] && ok "返回地址" || bad "缺少地址"
printf '%s' "$DET" | grep -q '"latitude":' && ok "返回经纬度（用于「距我N公里」）" || bad "缺少经纬度"
printf '%s' "$DET" | grep -q '"posts"' && ok "返回该地点的动态列表" || bad "缺少 posts"
SEED_POSTS="$(printf '%s' "$DET" | grep -o '"id"' | wc -l)"
[ "$SEED_POSTS" -ge 2 ] && ok "至少有 seed 的两条动态（id 计数 $SEED_POSTS）" || bad "动态数异常"

echo
echo "=== C. 边界：404 / 400 ==="
NF="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/places/00000000-0000-4000-8000-000000000000")"
[ "$NF" = "404" ] && ok "不存在的地点 → 404" || bad "期望 404，实际 $NF"
BADID="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/places/not-a-uuid")"
[ "$BADID" = "400" ] && ok "非法 id → 400" || bad "期望 400，实际 $BADID"

echo
echo "=== D. 发帖带「已知地点名」→ place_id 必须落库（这是聚合的前提）==="
MARK="M3-SLICE4-$RANDOM$RANDOM"
R1="$(curl -s -m 10 -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts" \
  -H 'Content-Type: application/json' -d "{\"body\":\"$MARK 地点聚合\",\"place\":\"北京交通大学\"}")"
C1="$(printf '%s' "$R1" | tail -1)"; B1="$(printf '%s' "$R1" | head -n -1)"
[ "$C1" = "201" ] && ok "发帖 → 201" || bad "期望 201，实际 $C1"
NEW_ID="$(jget "$B1" id)"
DB_PLACE_ID="$(PSQL "select coalesce(place_id::text,'(null)') from posts where id = '$NEW_ID'")"
[ "$DB_PLACE_ID" = "$PLACE" ] && ok "库中 place_id == 匹配到的地点（聚合可用）" || bad "place_id 期望 $PLACE，实际 $DB_PLACE_ID"

echo
echo "=== E. 该帖必须出现在地点详情里（端到端聚合）==="
DET2="$(curl -s -m 10 "$BASE/places/$PLACE")"
printf '%s' "$DET2" | grep -q "$NEW_ID" && ok "新帖出现在该地点的动态列表里" || bad "新帖没出现在地点详情里"

echo
echo "=== F. 未知地点名 → place_id 保持 NULL（不伪造归属）==="
R2="$(curl -s -m 10 -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts" \
  -H 'Content-Type: application/json' -d "{\"body\":\"$MARK 未知地点\",\"place\":\"一个不存在的地点XYZ\"}")"
C2="$(printf '%s' "$R2" | tail -1)"; B2="$(printf '%s' "$R2" | head -n -1)"
[ "$C2" = "201" ] && ok "未知地点也能发帖（place 存文本）" || bad "期望 201，实际 $C2"
UNK_ID="$(jget "$B2" id)"
UNK_PLACE_ID="$(PSQL "select coalesce(place_id::text,'(null)') from posts where id = '$UNK_ID'")"
[ "$UNK_PLACE_ID" = "(null)" ] && ok "未知地点的 place_id 为 NULL（不伪造归属）" || bad "期望 NULL，实际 $UNK_PLACE_ID"
UNK_TEXT="$(PSQL "select coalesce(place,'(null)') from posts where id = '$UNK_ID'")"
[ "$UNK_TEXT" = "一个不存在的地点XYZ" ] && ok "未知地点的文本仍保留（不丢信息）" || bad "place 文本丢失：$UNK_TEXT"

echo
echo "=== G. 清理 ==="
PSQL "delete from posts where body like 'M3-SLICE4-%'" >/dev/null
LEFT="$(PSQL "select count(*) from posts where body like 'M3-SLICE4-%'")"
[ "$LEFT" = "0" ] && ok "测试帖子已清理" || bad "仍有 $LEFT 条"
PSQL "delete from sessions where user_id = '$ME_ID'" >/dev/null
PSQL "delete from login_challenges where phone_e164 = '+86$PHONE'" >/dev/null
PSQL "delete from users where id = '$ME_ID'" >/dev/null
ULEFT="$(PSQL "select count(*) from users where id = '$ME_ID'")"
[ "$ULEFT" = "0" ] && ok "测试账号已清理" || bad "测试账号仍存在"
rm -f "$SINK/"*.json 2>/dev/null || true

echo
if [ "$FAILED" -eq 0 ]; then echo "PLACES_RESULT PASS"; else echo "PLACES_RESULT FAIL"; fi
exit "$FAILED"
