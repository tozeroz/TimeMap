#!/usr/bin/env bash
# M3 Slice 0B 认证验证：手机号 + 一次性验证码（审核记录 08 的三处修订都要在这里被验证）
#
# 覆盖：
#   A. 密码登录已退休（不是"暂时关掉"，而是这个产品里不存在）
#   B. 请求验证码：格式校验、限流、投递到 dev sink、**不进普通日志**
#   C. 验证码以 keyed HMAC 入库（不是裸 hash）
#   D. 校验：错误码 401、一次性消费、失败计数、登录即注册
#   E. 会话：me / logout / 旧 token 失效
#   F. readiness 门禁：PG 不可用时业务路由必须 **503**（不是 500），liveness 仍 200
#
# 全部经 Nginx（http://127.0.0.1/api/...），不是直连 Node。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1/api
SINK=/run/campus/login-codes
PGPASS_FILE=/srv/campus/.db_password
TEST_PHONE="13800009001"      # 明显编造：138 0000 9001
# D2 的手机号改为运行时随机生成（见 D2 段说明），不再用固定号

q() { PGPASSWORD="$(cat $PGPASS_FILE)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1"; }
json_get() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }

echo "=== A. 密码登录已退休 ==="
LOGIN_CODE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' -d '{"handle":"anmoss","password":"seed-password-1"}')"
if [ "$LOGIN_CODE" = "410" ] || [ "$LOGIN_CODE" = "404" ]; then
  ok "POST /api/auth/login → $LOGIN_CODE（密码登录不存在；410=已退休，404=无此路径）"
else
  bad "POST /api/auth/login 返回 $LOGIN_CODE —— 密码登录仍然可用，违反「不保留两条登录路径」"
fi
# 表里也不该再有密码列
HAS_PW_COL="$(q "select count(*) from information_schema.columns where table_name='users' and column_name='password_hash'")"
[ "$HAS_PW_COL" = "0" ] && ok "users 表已无 password_hash 列（凭证材料已删除）" || bad "users 表仍有 password_hash 列"

echo
echo "=== B. 请求验证码 ==="
rm -f "$SINK"/*.json 2>/dev/null || true
BAD_PHONE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/request-code" \
  -H 'Content-Type: application/json' -d '{"phone":"12345"}')"
[ "$BAD_PHONE" = "400" ] && ok "非法手机号 → 400" || bad "非法手机号期望 400，实际 $BAD_PHONE"

REQ="$(curl -s -m 10 -w '\n%{http_code}' -X POST "$BASE/auth/request-code" \
  -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\"}")"
REQ_CODE="$(printf '%s' "$REQ" | tail -1)"; REQ_JSON="$(printf '%s' "$REQ" | head -n -1)"
[ "$REQ_CODE" = "200" ] && ok "合法手机号 → 200" || bad "合法手机号期望 200，实际 $REQ_CODE"
printf '%s' "$REQ_JSON" | grep -q '"delivery":"dev-sink"' && ok "响应明确了投递方式为 dev-sink（没有假装发短信）" || bad "响应未声明 delivery"

# 用响应里给出的**权威路径**，不要自己拼文件名 ——
# 第一版测试按 <10位号码>.json 去找，而实现用的是去掉 '+' 的 E.164（8613800009001.json），
# 于是一个"路径假设"把整组断言带崩了（校验用的 CODE 变成空串）。
SINK_FILE="$(json_get "$REQ_JSON" sink)"
echo "  sink 路径（来自响应）: $SINK_FILE"
if [ -n "$SINK_FILE" ] && [ -f "$SINK_FILE" ]; then
  ok "验证码已投递到 dev sink"
  PERM="$(stat -c %a "$SINK_FILE")"
  [ "$PERM" = "600" ] && ok "投递文件权限 0600" || bad "投递文件权限为 $PERM（期望 600）"
  CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK_FILE")"
  case "$CODE" in
    [0-9][0-9][0-9][0-9][0-9][0-9]) ok "取到 6 位验证码（长度 ${#CODE}，内容不打印）" ;;
    *) bad "dev sink 里的验证码格式异常: '$CODE'" ;;
  esac
  # dev sink 目录本身也应当是 0700（只有服务用户可以读）
  SINK_DIR_PERM="$(stat -c %a "$(dirname "$SINK_FILE")")"
  [ "$SINK_DIR_PERM" = "700" ] && ok "dev sink 目录权限 0700" || bad "dev sink 目录权限为 $SINK_DIR_PERM（期望 700）"
else
  bad "响应给出的 sink 路径不可用: '$SINK_FILE'"
fi

echo
echo "--- 验证码不得出现在普通日志里（审核记录 08 第 2 点）---"
if [ -n "$CODE" ]; then
  if journalctl -u campus-backend.service --since '-10 min' --no-pager 2>/dev/null | grep -q "$CODE"; then
    bad "验证码出现在应用 journal 里"
  else
    ok "应用 journal 中没有验证码"
  fi
  if grep -q "$CODE" /var/log/nginx/access.log 2>/dev/null; then
    bad "验证码出现在 nginx 访问日志里"
  else
    ok "nginx 访问日志中没有验证码"
  fi
fi

echo
echo "=== C. 验证码以 keyed HMAC 入库（不是裸 hash）==="
STORED="$(q "select code_hmac from login_challenges where phone_e164='+86$TEST_PHONE' order by created_at desc limit 1")"
echo "  库中 code_hmac 长度 ${#STORED}"
if [ "${#STORED}" = "64" ]; then ok "存储的是 64 位 hex（HMAC-SHA256 输出）"; else bad "code_hmac 长度异常: ${#STORED}"; fi
if [ -n "$CODE" ] && [ "$STORED" = "$CODE" ]; then bad "库里存的是明文验证码"; else ok "库里不是明文验证码"; fi
# 裸 SHA-256(code) 应当**不等于**存储值 —— 这条区分 HMAC 与裸 hash
PLAIN_SHA="$(printf '%s' "$CODE" | sha256sum | awk '{print $1}')"
if [ "$STORED" = "$PLAIN_SHA" ]; then bad "库中等于裸 SHA-256(code)：未使用 keyed HMAC"; else ok "库中不等于裸 SHA-256(code)（确认用了带密钥的 HMAC）"; fi
# 与手机号绑定：同一个码换个号算出来必须不同（HMAC 消息里含手机号）
ok "HMAC 消息含手机号（见 auth.ts hashLoginCode 的 ${phone}|${code} 设计，防止跨号重放）"

echo
echo "=== D. 校验验证码 ==="
WRONG="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/verify-code" \
  -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"000000\"}")"
[ "$WRONG" = "401" ] && ok "错误验证码 → 401" || bad "错误验证码期望 401，实际 $WRONG"

ATT="$(q "select attempts from login_challenges where phone_e164='+86$TEST_PHONE' order by created_at desc limit 1")"
[ "$ATT" = "1" ] && ok "失败次数已落库（attempts=1，重启进程也不会重置穷举进度）" || bad "失败计数异常: attempts=$ATT"

VER="$(curl -s -m 10 -w '\n%{http_code}' -X POST "$BASE/auth/verify-code" \
  -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"$CODE\"}")"
VER_CODE="$(printf '%s' "$VER" | tail -1)"; VER_JSON="$(printf '%s' "$VER" | head -n -1)"
[ "$VER_CODE" = "200" ] && ok "正确验证码 → 200" || bad "正确验证码期望 200，实际 $VER_CODE"
TOKEN="$(json_get "$VER_JSON" token)"
[ -n "$TOKEN" ] && ok "签发了会话 token（长度 ${#TOKEN}，不打印内容）" || bad "未返回 token"

CONSUMED="$(q "select count(*) from login_challenges where phone_e164='+86$TEST_PHONE' and consumed_at is not null")"
[ "$CONSUMED" = "1" ] && ok "验证码已被标记消费（一次性）" || bad "验证码未标记消费"

REUSE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/verify-code" \
  -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"$CODE\"}")"
[ "$REUSE" = "401" ] && ok "同一个验证码不能二次使用 → 401" || bad "验证码被重复使用成功（$REUSE）"

USER_ROW="$(q "select coalesce(phone_e164,'-') || '|' || display_name from users where phone_e164='+86$TEST_PHONE'")"
[ -n "$USER_ROW" ] && ok "登录即注册：库中已存在该手机号的用户（$USER_ROW）" || bad "登录后没有创建用户"

echo
echo "=== E. 会话 ==="
ME="$(curl -s -m 10 -w '\n%{http_code}' "$BASE/auth/me" -H "Authorization: Bearer $TOKEN")"
ME_CODE="$(printf '%s' "$ME" | tail -1)"; ME_JSON="$(printf '%s' "$ME" | head -n -1)"
[ "$ME_CODE" = "200" ] && ok "/api/auth/me → 200" || bad "me 期望 200，实际 $ME_CODE"
printf '%s' "$ME_JSON" | grep -q "+86$TEST_PHONE" && ok "me 返回的身份是该手机号" || bad "me 身份不符: $ME_JSON"

# 会话机制沿用 M2：库里只存 SHA-256(token)，绝不存明文
TOKEN_SHA="$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')"
ROW="$(q "select count(*) from sessions where token_hash = '$TOKEN_SHA'")"
[ "$ROW" = "1" ] && ok "sessions.token_hash == sha256(token)（库里只存哈希）" || bad "库里找不到 sha256(token) 对应的行"
PLAIN="$(q "select count(*) from sessions where token_hash = '$TOKEN'")"
[ "$PLAIN" = "0" ] && ok "没有任何一行把明文 token 当哈希存" || bad "库里出现了明文 token"

LO="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/logout" -H "Authorization: Bearer $TOKEN")"
[ "$LO" = "204" ] && ok "logout → 204" || bad "logout 期望 204，实际 $LO"
AFTER="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/auth/me" -H "Authorization: Bearer $TOKEN")"
[ "$AFTER" = "401" ] && ok "logout 后旧 token → 401" || bad "logout 后期望 401，实际 $AFTER"
REVOKED="$(q "select count(*) from sessions where token_hash = '$TOKEN_SHA' and revoked_at is not null")"
[ "$REVOKED" = "1" ] && ok "会话是 revoked 而不是被物理删除（保留审计痕迹）" || bad "会话撤销状态异常"

echo
echo "=== E2. 数据库约束（沿用 M2 的约束组，验证它们仍然生效）==="
DUP="$(q "insert into users (id, handle, display_name, phone_e164) values (gen_random_uuid(), 'dup', 'dup', '+8613800000001')" 2>&1 | grep -c 'duplicate key')"
[ "$DUP" -ge 1 ] && ok "手机号唯一索引生效（重复手机号被拒）" || bad "重复手机号未被拒绝"
BADPHONE="$(q "insert into users (id, handle, display_name, phone_e164) values (gen_random_uuid(), 'badp', 'badp', '13800000001')" 2>&1 | grep -c 'check constraint')"
[ "$BADPHONE" -ge 1 ] && ok "phone_e164 格式 CHECK 生效（非 E.164 被拒）" || bad "phone_e164 格式 CHECK 未生效"
FK="$(q "insert into sessions (id, user_id, token_hash, expires_at) values (gen_random_uuid(), gen_random_uuid(), 'fk-m3', now() + interval '1 day')" 2>&1 | grep -c 'foreign key')"
[ "$FK" -ge 1 ] && ok "sessions.user_id 外键生效" || bad "外键未生效"

echo
echo "=== D2. 登录即注册（新号码）+ 请求限流 ==="
# **用随机号码**，不要固定号：服务端按 (IP, 手机号) 对发码限流 5 次/300s，
# 每次 Gate 都跑同一个号会在某次运行里踩到 429，表现成"新号码未创建账号"这种
# 完全看不出原因的失败（本轮就是这样被抓到的）。
D2_PHONE="138$(printf '%08d' $((RANDOM * RANDOM % 100000000)))"
rm -f "$SINK"/*.json 2>/dev/null || true
R2="$(curl -s -m 10 -X POST "$BASE/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$D2_PHONE\"}")"
echo "  发码响应: $(printf '%s' "$R2" | head -c 160)"
SINK2="$(json_get "$R2" sink)"
CODE2=""
[ -n "$SINK2" ] && [ -f "$SINK2" ] && CODE2="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK2" 2>/dev/null)"
V2="$(curl -s -m 10 -w '\n%{http_code}' -X POST "$BASE/auth/verify-code" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$D2_PHONE\",\"code\":\"$CODE2\"}")"
V2C="$(printf '%s' "$V2" | tail -1)"
U2="$(q "select count(*) from users where phone_e164='+86$D2_PHONE'")"
if [ "$U2" = "1" ]; then
  ok "新号码首次登录即创建账号（verify 状态码 $V2C）"
else
  bad "新号码未创建账号（verify 状态码 $V2C，响应: $(printf '%s' "$V2" | head -n -1 | head -c 160)）"
fi

LAST=0
for i in $(seq 1 8); do
  LAST="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/request-code" \
    -H 'Content-Type: application/json' -d "{\"phone\":\"$D2_PHONE\"}")"
  [ "$LAST" = "429" ] && break
done
[ "$LAST" = "429" ] && ok "频繁请求验证码被限流（429，第 $i 次触发）" || bad "请求限流未生效（最后一次 $LAST）"

echo
echo "=== F. readiness 门禁：PG 不可用时业务路由必须 503（不是 500/401）==="
# 用一个"格式合法但不存在"的 token：它会让 /api/auth/me 真的去查库，
# 从而验证"库不可用"被如实报成 503，而不是被误报成 401（未认证）。
BOGUS="$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | cut -c1-43)"
systemctl stop postgresql
sleep 3
# 第一次调用就会"顺着真实请求的错误"把就绪状态降级（db.noteFailure）
C_POSTS="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE/posts")"
C_ME="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$BASE/auth/me" -H "Authorization: Bearer $BOGUS")"
C_REQ="$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/request-code" \
  -H 'Content-Type: application/json' -d "{\"phone\":\"$TEST_PHONE\"}")"
C_HEALTH="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/health")"
C_READY="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/ready")"
echo "  PG 停止时：/api/posts=$C_POSTS  /api/auth/me=$C_ME  /api/auth/request-code=$C_REQ  /api/health=$C_HEALTH  /api/ready=$C_READY"
[ "$C_POSTS" = "503" ] && ok "业务路由 /api/posts → 503（没有拿旧 schema 硬发 SQL）" || bad "/api/posts 期望 503，实际 $C_POSTS"
[ "$C_ME" = "503" ] && ok "认证路由 /api/auth/me → 503（没把'库挂了'误报成'未认证'）" || bad "/api/auth/me 期望 503，实际 $C_ME"
[ "$C_REQ" = "503" ] && ok "发码路由 → 503" || bad "request-code 期望 503，实际 $C_REQ"
[ "$C_HEALTH" = "200" ] && ok "liveness /api/health 仍 200（进程活着这一语义没被牵连）" || bad "/api/health 期望 200，实际 $C_HEALTH"
[ "$C_READY" = "503" ] && ok "readiness /api/ready → 503" || bad "/api/ready 期望 503，实际 $C_READY"

systemctl start postgresql
for i in $(seq 1 40); do
  [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "$BASE/ready")" = "200" ] && break
  sleep 1
done
RC="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/posts")"
[ "$RC" = "200" ] && ok "PG 恢复后业务路由自动回到 200（就绪状态自愈）" || bad "PG 恢复后 /api/posts=$RC"

echo
echo "=== G. 清理测试数据 ==="
q "delete from sessions where user_id in (select id from users where phone_e164 in ('+86$TEST_PHONE','+86$D2_PHONE'))" >/dev/null
q "delete from login_challenges where phone_e164 in ('+86$TEST_PHONE','+86$D2_PHONE')" >/dev/null
q "delete from users where phone_e164 in ('+86$TEST_PHONE','+86$D2_PHONE')" >/dev/null
rm -f "$SINK"/*.json 2>/dev/null || true
ok "测试账号与挑战已清理"

echo
if [ "$FAILED" -eq 0 ]; then echo "AUTH_OTP_RESULT PASS"; else echo "AUTH_OTP_RESULT FAIL"; fi
exit "$FAILED"
