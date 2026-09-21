#!/usr/bin/env bash
# WO#13 服务端验证：PATCH /api/users/me（审核记录 54 冻结的契约）
#
# 覆盖：
#   · 仅登录用户（未登录 → 401）
#   · body 严格只接受 displayName；其它字段 → **400 且点名**（**不得静默忽略**）
#   · user id 来自会话（body 里提交 id/userId → 400）
#   · 成功 → 200 { id, displayName }，且 displayName 是**库里刚写入的值**
#   · **写后读三方一致**：PATCH 返回的 displayName == /api/auth/me == /api/users/:selfId
#   · 失败 → 明确 4xx/5xx **且零写入**（DB 里的值不变）
#   · 空/超长 → 400
#   · ⭐ 测完**精确恢复原昵称**（避免污染 canonical seed）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
BASE=http://127.0.0.1
FAIL=0
ok()  { echo "  PASS $1"; }
bad() { echo "  FAIL $1"; FAIL=1; }

PHONE='+8613800000001'
login() {
  curl -s -X POST "$BASE/api/auth/request-code" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" >/dev/null 2>&1
  sleep 0.8
  local sink="/run/campus/login-codes/$(printf '%s' "$PHONE" | tr -d '+').json"
  local code; code="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$sink" 2>/dev/null)"
  [ -z "$code" ] && { echo ""; return; }
  curl -s -X POST "$BASE/api/auth/verify-code" -H 'content-type: application/json' \
    -d "{\"phone\":\"$PHONE\",\"code\":\"$code\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

TOK="$(login)"
[ -z "$TOK" ] && { echo "FATAL 登录失败"; exit 2; }
AUTH=(-H "Authorization: Bearer $TOK" -H 'Content-Type: application/json')

UID_="$(PSQL "select id from users where phone_e164='$PHONE'")"
ORIG="$(PSQL "select display_name from users where id='$UID_'")"
echo "  测试账号 $PHONE  (id=${UID_:0:8}…)  原昵称=「$ORIG」"

echo
echo "=== 0) 未登录 → 401 ==="
C="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/users/me" -H 'Content-Type: application/json' -d '{"displayName":"x"}')"
[ "$C" = "401" ] && ok "未登录 → 401" || bad "未登录 → HTTP $C（期望 401）"

echo
echo "=== 0b) ⭐ CORS 预检（设备上保存失败的真因就在这里）==="
# ⚠️ 为什么必须单独测：
#   PATCH 带 content-type/authorization 头时，浏览器/WebView 会先发 OPTIONS 预检。
#   如果 access-control-allow-methods 里没有 PATCH，预检失败 → fetch 报 "Failed to fetch"，
#   而 **curl 不带 CORS 语义、根本不发预检** —— 所以本脚本前面的断言全 PASS，
#   设备上却 100% 保存失败。这条断言就是为补上这个盲区。
PRE="$(curl -s -i -X OPTIONS "$BASE/api/users/me" \
  -H 'Origin: https://localhost' \
  -H 'Access-Control-Request-Method: PATCH' \
  -H 'Access-Control-Request-Headers: content-type,authorization' 2>&1)"
PC="$(printf '%s' "$PRE" | head -1 | grep -o '[0-9][0-9][0-9]' | head -1)"
AM="$(printf '%s' "$PRE" | tr -d '\r' | grep -i '^access-control-allow-methods:' | head -1)"
AO="$(printf '%s' "$PRE" | tr -d '\r' | grep -i '^access-control-allow-origin:' | head -1)"
echo "  预检 HTTP $PC"
echo "  $AM"
echo "  $AO"
if [ "$PC" = "204" ] || [ "$PC" = "200" ]; then ok "预检返回 $PC"; else bad "预检 HTTP $PC（期望 204/200）"; fi
if printf '%s' "$AM" | grep -q 'PATCH'; then
  ok "allow-methods 里**含 PATCH**（设备上 PATCH 才可能成功）"
else
  bad "allow-methods **不含 PATCH** → 设备上会报 Failed to fetch（$AM）"
fi
if printf '%s' "$AO" | grep -q 'https://localhost'; then
  ok "allow-origin 回显白名单来源（Capacitor WebView）"
else
  bad "allow-origin 未回显 https://localhost（$AO）"
fi

echo
echo "=== 1) ⭐ 严格拒绝未知字段（不得静默忽略）==="
for f in 'bio' 'gender' 'tags' 'school' 'id' 'userId'; do
  BODY="{\"displayName\":\"WO13_TMP\",\"$f\":\"x\"}"
  R="$(curl -s -w '\n%{http_code}' -X PATCH "$BASE/api/users/me" "${AUTH[@]}" -d "$BODY")"
  C="$(printf '%s' "$R" | tail -1)"
  ERRD="$(printf '%s' "$R" | head -1)"
  if [ "$C" = "400" ] && printf '%s' "$ERRD" | grep -q "$f"; then
    ok "字段 $f → 400 且**点名**该字段"
  else
    bad "字段 $f → HTTP $C，响应=$ERRD（期望 400 且点名）"
  fi
done

echo
echo "=== 2) 空 / 超长 → 400 ==="
for b in '{"displayName":""}' '{"displayName":"   "}'; do
  C="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/users/me" "${AUTH[@]}" -d "$b")"
  [ "$C" = "400" ] && ok "空值 $b → 400" || bad "空值 $b → HTTP $C"
done
LONG="$(python3 -c "print('长'*41)")"
C="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/users/me" "${AUTH[@]}" -d "{\"displayName\":\"$LONG\"}")"
[ "$C" = "400" ] && ok "41 字（上限 40）→ 400" || bad "41 字 → HTTP $C"

echo
echo "=== 3) ⭐ 失败时**零写入**（上面所有 400 之后，DB 值必须仍是原值）==="
NOW="$(PSQL "select display_name from users where id='$UID_'")"
[ "$NOW" = "$ORIG" ] && ok "4xx 之后 DB 仍是「$ORIG」（零写入）" || bad "DB 变成「$NOW」（4xx 竟然写了）"

echo
echo "=== 4) ⭐ 成功路径 + 写后读三方一致 ==="
NEW="WO13验证$(date +%H%M%S)"
R="$(curl -s -w '\n%{http_code}' -X PATCH "$BASE/api/users/me" "${AUTH[@]}" -d "{\"displayName\":\"$NEW\"}")"
C="$(printf '%s' "$R" | tail -1)"
BODY="$(printf '%s' "$R" | head -1)"
PATCHED="$(printf '%s' "$BODY" | sed -n 's/.*"displayName":"\([^"]*\)".*/\1/p')"
echo "  PATCH → HTTP $C  displayName=「$PATCHED」"
[ "$C" = "200" ] && ok "成功 → 200" || bad "成功路径 HTTP $C"
[ "$PATCHED" = "$NEW" ] && ok "响应 displayName == 请求值" || bad "响应 displayName=「$PATCHED」≠ 请求「$NEW」"

DBV="$(PSQL "select display_name from users where id='$UID_'")"
[ "$DBV" = "$NEW" ] && ok "DB 里确实是新值（真实持久化）" || bad "DB=「$DBV」≠「$NEW」"

ME="$(curl -s "$BASE/api/auth/me" "${AUTH[@]}" | sed -n 's/.*"displayName":"\([^"]*\)".*/\1/p')"
PUB="$(curl -s "$BASE/api/users/$UID_" | sed -n 's/.*"displayName":"\([^"]*\)".*/\1/p')"
echo "  /api/auth/me → 「$ME」   /api/users/:id → 「$PUB」"
if [ "$PATCHED" = "$NEW" ] && [ "$DBV" = "$NEW" ] && [ "$ME" = "$NEW" ] && [ "$PUB" = "$NEW" ]; then
  ok "**四方一致**：PATCH 响应 == DB == /api/auth/me == /api/users/:id"
else
  bad "四方不一致（PATCH=$PATCHED DB=$DBV me=$ME pub=$PUB）"
fi

echo
echo "=== 5) 重读再确认（reload 语义）==="
ME2="$(curl -s "$BASE/api/auth/me" "${AUTH[@]}" | sed -n 's/.*"displayName":"\([^"]*\)".*/\1/p')"
[ "$ME2" = "$NEW" ] && ok "重新读取仍是新值（不是只在内存里改）" || bad "重读得到「$ME2」"

echo
echo "=== 6) ⭐ 精确恢复原昵称（避免污染 canonical seed）==="
RR="$(curl -s -w '\n%{http_code}' -X PATCH "$BASE/api/users/me" "${AUTH[@]}" -d "{\"displayName\":\"$ORIG\"}")"
RC="$(printf '%s' "$RR" | tail -1)"
BACK="$(PSQL "select display_name from users where id='$UID_'")"
[ "$RC" = "200" ] && [ "$BACK" = "$ORIG" ] && ok "已恢复为「$ORIG」" || bad "恢复失败（HTTP $RC，DB=「$BACK」）"

echo
if [ "$FAIL" -eq 0 ]; then echo "WO13_SERVER_PATCH: PASS"; else echo "WO13_SERVER_PATCH: FAIL"; fi
exit "$FAIL"
