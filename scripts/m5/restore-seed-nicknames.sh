#!/usr/bin/env bash
# 恢复 Lemy 的昵称（门禁 WO13_MUTATE=1 跑过之后会把昵称改成 WO13设备*）
#
# ⚠️ 为什么用 PATCH 而不是 psql 直改：
#   审核 54 要求"测试后把原昵称精确恢复"。走**真实接口**恢复有三个好处：
#     ① 顺带再验证一次 PATCH 在恢复方向上也工作
#     ② 走的是会话鉴权路径，与真实客户端一致
#     ③ 不会绕过应用层（psql 直改是管理面操作，本项目一贯区分）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

PHONE='+8613800000002'
CANON='Lemy'

echo "=== 恢复前 ==="
PSQL "select display_name from users where phone_e164 = '$PHONE'"

echo
echo "=== 取 token ==="
curl -s -X POST http://127.0.0.1/api/auth/request-code -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\"}" >/dev/null 2>&1
sleep 1
SINK="/run/campus/login-codes/$(printf '%s' "$PHONE" | tr -d '+').json"
CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK" 2>/dev/null)"
TOK="$(curl -s -X POST http://127.0.0.1/api/auth/verify-code -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
echo "  token: $([ -n "$TOK" ] && echo ok || echo FAIL)"
if [ -z "$TOK" ]; then echo "FATAL 取不到 token"; exit 2; fi

echo
echo "=== PATCH 恢复为「$CANON」 ==="
curl -s -X PATCH http://127.0.0.1/api/users/me \
  -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d "{\"displayName\":\"$CANON\"}"
echo

echo
echo "=== 恢复后（三方核对）==="
DBV="$(PSQL "select display_name from users where phone_e164 = '$PHONE'")"
MEV="$(curl -s http://127.0.0.1/api/auth/me -H "Authorization: Bearer $TOK" | sed -n 's/.*"displayName":"\([^"]*\)".*/\1/p')"
echo "  DB        : $DBV"
echo "  /api/auth/me: $MEV"
if [ "$DBV" = "$CANON" ] && [ "$MEV" = "$CANON" ]; then
  echo "  PASS 已精确恢复为「$CANON」"
else
  echo "  FAIL 未恢复（DB=$DBV me=$MEV）"
fi

echo
echo "=== 三个账号的当前昵称（应与 canonical seed 一致）==="
PSQL "select phone_e164 || ' = ' || display_name from users order by created_at limit 5"
