#!/usr/bin/env bash
# M2 认证契约 + 归属信任验证（对应 docs/m2/SPEC.md 第八节 AUTH_CONTRACT / AUTHOR_TRUST / CONSTRAINTS）
#
# 全部经 Nginx（http://127.0.0.1/api/...），不是直连 Node。
#
# 两条纪律（审核记录 05 要求）：
#   1. token 必须 redact —— 打印/存证一律只给前缀，绝不把完整 bearer 写进证据
#   2. 失败继续、最后汇总，任一失败退出码非 0
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1/api
SEED_USER=anmoss
SEED_PASS=seed-password-1
WRONG_PASS=definitely-wrong-password

# 只保留前 8 位用于日志定位；完整 token 只存在变量里
redact() { local t="$1"; printf '%s…(len=%s)' "${t:0:8}" "${#t}"; }

json_get() { # json_get <json> <key>
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1
}

echo "=== A. 登录成功 ==="
LOGIN_BODY="{\"handle\":\"$SEED_USER\",\"password\":\"$SEED_PASS\"}"
LOGIN_RESP="$(curl -s -m 15 -w '\n%{http_code}' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d "$LOGIN_BODY")"
LOGIN_CODE="$(printf '%s' "$LOGIN_RESP" | tail -1)"
LOGIN_JSON="$(printf '%s' "$LOGIN_RESP" | head -n -1)"
TOKEN="$(json_get "$LOGIN_JSON" token)"
[ "$LOGIN_CODE" = "200" ] && ok "login 成功 → 200" || bad "login 期望 200，实际 $LOGIN_CODE"
[ -n "$TOKEN" ] && ok "login 返回 token（$(redact "$TOKEN")）" || bad "login 未返回 token"
printf '%s' "$LOGIN_JSON" | grep -q '"expiresAt"' && ok "login 返回 expiresAt" || bad "login 未返回 expiresAt"
TOKEN_HASH="$(printf '%s' "$TOKEN" | sha256sum | awk '{print $1}')"

echo
echo "=== B. 失败语义：用户不存在与密码错必须不可区分 ==="
RESP1="$(curl -s -m 15 -w '\n%{http_code}' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"handle\":\"$SEED_USER\",\"password\":\"$WRONG_PASS\"}")"
CODE1="$(printf '%s' "$RESP1" | tail -1)"; BODY1="$(printf '%s' "$RESP1" | head -n -1)"
RESP2="$(curl -s -m 15 -w '\n%{http_code}' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"handle":"no-such-handle-zzz","password":"whatever-pass"}')"
CODE2="$(printf '%s' "$RESP2" | tail -1)"; BODY2="$(printf '%s' "$RESP2" | head -n -1)"
echo "  密码错      : $CODE1 $BODY1"
echo "  用户不存在  : $CODE2 $BODY2"
[ "$CODE1" = "401" ] && ok "密码错 → 401" || bad "密码错期望 401，实际 $CODE1"
[ "$CODE2" = "401" ] && ok "用户不存在 → 401" || bad "用户不存在期望 401，实际 $CODE2"
[ "$BODY1" = "$BODY2" ] && ok "两种失败的响应体完全一致（不可区分）" || bad "两种失败响应体不一致，可用于枚举用户"

echo
echo "=== C. 计时：用户不存在也必须跑一次同参数 scrypt（dummy verify）==="
# 如果只在"密码错"分支做 scrypt，那么"用户不存在"会快一个数量级 —— 依然能枚举用户。
# 取 3 次最小值（min 比平均值更稳，不受偶发抖动影响）
t_wrong=99; t_missing=99
for _ in 1 2 3; do
  d=$(curl -s -o /dev/null -m 15 -w '%{time_total}' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"handle\":\"$SEED_USER\",\"password\":\"$WRONG_PASS\"}")
  t_wrong=$(awk -v a="$t_wrong" -v b="$d" 'BEGIN{print (b<a)?b:a}')
  d=$(curl -s -o /dev/null -m 15 -w '%{time_total}' -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d '{"handle":"no-such-handle-zzz","password":"whatever-pass"}')
  t_missing=$(awk -v a="$t_missing" -v b="$d" 'BEGIN{print (b<a)?b:a}')
done
echo "  密码错最短耗时     : ${t_wrong}s"
echo "  用户不存在最短耗时 : ${t_missing}s"
awk -v w="$t_wrong" -v m="$t_missing" 'BEGIN{ exit !(m >= 0.5*w) }' \
  && ok "不存在分支耗时 ≥ 密码错分支的 50%（dummy scrypt 生效）" \
  || bad "不存在分支明显更快，说明没有跑 dummy scrypt（可枚举用户）"

echo
echo "=== D. /api/auth/me 与会话状态 ==="
ME_CODE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/auth/me")"
[ "$ME_CODE" = "401" ] && ok "me 无 token → 401" || bad "me 无 token 期望 401，实际 $ME_CODE"
ME_MAL="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/auth/me" -H 'Authorization: Basic abc')"
[ "$ME_MAL" = "401" ] && ok "me 的 Authorization 格式错误 → 401" || bad "格式错误期望 401，实际 $ME_MAL"
ME_SHORT="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/auth/me" -H 'Authorization: Bearer short')"
[ "$ME_SHORT" = "401" ] && ok "me 的 token 过短 → 401" || bad "短 token 期望 401，实际 $ME_SHORT"
ME_OK="$(curl -s -m 10 -w '\n%{http_code}' "$BASE/auth/me" -H "Authorization: Bearer $TOKEN")"
ME_CODE2="$(printf '%s' "$ME_OK" | tail -1)"; ME_JSON="$(printf '%s' "$ME_OK" | head -n -1)"
[ "$ME_CODE2" = "200" ] && ok "me 带有效 token → 200" || bad "me 期望 200，实际 $ME_CODE2"
printf '%s' "$ME_JSON" | grep -q "\"handle\":\"$SEED_USER\"" \
  && ok "me 返回服务端解析出的身份（$SEED_USER）" || bad "me 返回身份不符: $ME_JSON"

echo
echo "=== E. 过期 token 必须 401 ==="
# 这里刻意**不用**改真实会话的方式测过期：
# 直接把 expires_at 改成 now()-1min 会撞上我们自己的 CHECK（expires_at > created_at），
# 刚创建的会话被拒后过期根本没生效，测试会假失败（第一版就是这么错的 —— 约束本身是对的）。
# 改成插两条**专用**会话行：一条已过期、一条仍有效，两者只差 expires_at，
# 这样 401 与 200 的对比就精确地归因到"过期判定"。
DB_PASS="$(cat /srv/campus/.db_password)"
export PGPASSWORD="$DB_PASS"
USER_ID="$(psql -h 127.0.0.1 -U campus -d campus -Atc "select id from users where handle = '$SEED_USER'")"
STAMP="$(date +%s)"
TOK_EXPIRED="expired-probe-$STAMP-aaaaaaaaaaaaaaaaaaaa"
TOK_VALID="valid-probe-$STAMP-bbbbbbbbbbbbbbbbbbbb"
HASH_EXPIRED="$(printf '%s' "$TOK_EXPIRED" | sha256sum | awk '{print $1}')"
HASH_VALID="$(printf '%s' "$TOK_VALID" | sha256sum | awk '{print $1}')"
psql -h 127.0.0.1 -U campus -d campus -q -c \
  "insert into sessions (id, user_id, token_hash, created_at, expires_at)
   values (gen_random_uuid(), '$USER_ID', '$HASH_EXPIRED', now() - interval '2 hours', now() - interval '1 hour')"
psql -h 127.0.0.1 -U campus -d campus -q -c \
  "insert into sessions (id, user_id, token_hash, created_at, expires_at)
   values (gen_random_uuid(), '$USER_ID', '$HASH_VALID', now() - interval '1 hour', now() + interval '1 hour')"
EXP_CODE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/auth/me" -H "Authorization: Bearer $TOK_EXPIRED")"
VAL_CODE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/auth/me" -H "Authorization: Bearer $TOK_VALID")"
echo "  已过期会话: $EXP_CODE ；仅 created/expires 不同的有效会话: $VAL_CODE"
[ "$EXP_CODE" = "401" ] && ok "过期 token → 401" || bad "过期 token 期望 401，实际 $EXP_CODE"
[ "$VAL_CODE" = "200" ] && ok "同形态的有效 token → 200（证明 401 归因于过期而非格式）" || bad "有效 token 期望 200，实际 $VAL_CODE"
psql -h 127.0.0.1 -U campus -d campus -q -c \
  "delete from sessions where token_hash in ('$HASH_EXPIRED','$HASH_VALID')" >/dev/null
echo "  （探针会话已清理）"

echo
echo "=== F. 库里不得出现明文 token ==="
ROW="$(psql -h 127.0.0.1 -U campus -d campus -Atc \
  "select token_hash from sessions where token_hash = '$TOKEN_HASH'")"
[ -n "$ROW" ] && ok "sessions.token_hash == sha256(token)（库里只存哈希）" || bad "库里找不到 sha256(token) 对应的行"
PLAIN="$(psql -h 127.0.0.1 -U campus -d campus -Atc "select count(*) from sessions where token_hash = '$TOKEN'")"
[ "$PLAIN" = "0" ] && ok "没有任何一行把明文 token 当哈希存（明文=0）" || bad "库里出现了明文 token"

echo
echo "=== G. AUTHOR_TRUST：客户端不能选择帖子归属 ==="
NOAUTH="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/posts" -H 'Content-Type: application/json' -d '{"body":"no token"}')"
[ "$NOAUTH" = "401" ] && ok "无 token 发帖 → 401" || bad "无 token 期望 401，实际 $NOAUTH"

FORGE1="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/posts" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"body":"forge","author":"管理员"}')"
[ "$FORGE1" = "400" ] && ok "body 里带 author → 400（strict reject）" || bad "带 author 期望 400，实际 $FORGE1"

FORGE2="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/posts" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"body\":\"forge\",\"authorId\":\"11111111-1111-4111-8111-111111111111\"}")"
[ "$FORGE2" = "400" ] && ok "body 里带 authorId → 400" || bad "带 authorId 期望 400，实际 $FORGE2"

FORGE3="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/posts" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"body":"forge","user_id":"x"}')"
[ "$FORGE3" = "400" ] && ok "body 里带任意未知字段 → 400（strict schema）" || bad "未知字段期望 400，实际 $FORGE3"

MARK="M2-AUTH-$(date +%s)"
POST_RESP="$(curl -s -m 15 -w '\n%{http_code}' -X POST "$BASE/posts" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"body\":\"$MARK 由已认证会话发布\",\"place\":\"北京交通大学\"}")"
POST_CODE="$(printf '%s' "$POST_RESP" | tail -1)"; POST_JSON="$(printf '%s' "$POST_RESP" | head -n -1)"
[ "$POST_CODE" = "201" ] && ok "带 token 发帖 → 201" || bad "发帖期望 201，实际 $POST_CODE"
POST_ID="$(json_get "$POST_JSON" id)"
POST_AUTHOR_ID="$(json_get "$POST_JSON" authorId)"
USER_ID="$(psql -h 127.0.0.1 -U campus -d campus -Atc "select id from users where handle = '$SEED_USER'")"
[ "$POST_AUTHOR_ID" = "$USER_ID" ] && ok "返回的 authorId == 会话用户 id" || bad "authorId=$POST_AUTHOR_ID 与用户 $USER_ID 不符"

ROW2="$(psql -h 127.0.0.1 -U campus -d campus -Atc \
  "select coalesce(author_id::text,'NULL') || '|' || author_name from posts where id = '$POST_ID'")"
echo "  库中该行: $ROW2"
[ "${ROW2%%|*}" = "$USER_ID" ] && ok "库中 author_id 来自服务端会话（不是客户端提交）" || bad "库中 author_id 不正确"

echo
echo "=== H. logout 后原 token 必须失效 ==="
LO_CODE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/logout" -H "Authorization: Bearer $TOKEN")"
[ "$LO_CODE" = "204" ] && ok "logout → 204" || bad "logout 期望 204，实际 $LO_CODE"
AFTER="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE/auth/me" -H "Authorization: Bearer $TOKEN")"
[ "$AFTER" = "401" ] && ok "logout 后原 token → 401" || bad "logout 后期望 401，实际 $AFTER"
REVOKED="$(psql -h 127.0.0.1 -U campus -d campus -Atc \
  "select count(*) from sessions where token_hash = '$TOKEN_HASH' and revoked_at is not null")"
[ "$REVOKED" = "1" ] && ok "会话是 revoked 而不是被物理删除（保留审计痕迹）" || bad "会话撤销状态异常"

echo
echo "=== I. 登录限流 ==="
LIMIT_HANDLE="rate-limit-probe-$$"
LAST_CODE=0
for i in $(seq 1 12); do
  LAST_CODE="$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" \
    -H 'Content-Type: application/json' -d "{\"handle\":\"$LIMIT_HANDLE\",\"password\":\"bad\"}")"
  [ "$LAST_CODE" = "429" ] && break
done
[ "$LAST_CODE" = "429" ] && ok "连续失败后 login 被限流（429，第 $i 次触发）" || bad "限流未生效（最后一次 $LAST_CODE）"
RETRY="$(curl -s -m 10 -D - -o /dev/null -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"handle\":\"$LIMIT_HANDLE\",\"password\":\"bad\"}" | tr -d '\r' | awk -F': ' '/[Rr]etry-[Aa]fter/ {print $2}')"
[ -n "$RETRY" ] && ok "429 带 Retry-After: $RETRY" || bad "429 未带 Retry-After"
# 限流是按 (ip,handle) 的，不能把正常用户一起锁死
OTHER="$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' -d "{\"handle\":\"$SEED_USER\",\"password\":\"$SEED_PASS\"}")"
[ "$OTHER" = "200" ] && ok "限流不影响其它 handle（正常账号仍可登录）" || bad "限流把正常账号也锁了：$OTHER"

echo
echo "=== J. [CONSTRAINTS] 002 迁移的约束真的会拒绝非法数据 ==="
DUP_CODE="$(psql -h 127.0.0.1 -U campus -d campus -q -c \
  "insert into users (id, handle, display_name, password_hash) values (gen_random_uuid(), 'ANMOSS', 'dup', 'x')" 2>&1 | grep -c 'duplicate key')"
[ "$DUP_CODE" -ge 1 ] && ok "handle 大小写不敏感唯一索引生效（ANMOSS 与 anmoss 冲突）" || bad "重复 handle 未被拒绝"

FK_CODE="$(psql -h 127.0.0.1 -U campus -d campus -q -c \
  "insert into sessions (id, user_id, token_hash, expires_at) values (gen_random_uuid(), gen_random_uuid(), 'fk-test', now() + interval '1 day')" 2>&1 | grep -c 'foreign key')"
[ "$FK_CODE" -ge 1 ] && ok "sessions.user_id 外键生效（不存在的用户被拒）" || bad "外键未生效"

CHK_CODE="$(psql -h 127.0.0.1 -U campus -d campus -q -c \
  "insert into sessions (id, user_id, token_hash, created_at, expires_at) values (gen_random_uuid(), '$USER_ID', 'chk-test', now(), now() - interval '1 day')" 2>&1 | grep -c 'check constraint')"
[ "$CHK_CODE" -ge 1 ] && ok "expires_at 必须晚于 created_at（CHECK 生效）" || bad "expires_at CHECK 未生效"

REV_CODE="$(psql -h 127.0.0.1 -U campus -d campus -q -c \
  "insert into sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) values (gen_random_uuid(), '$USER_ID', 'rev-test', now(), now() + interval '1 day', now() - interval '1 day')" 2>&1 | grep -c 'check constraint')"
[ "$REV_CODE" -ge 1 ] && ok "revoked_at 不能早于 created_at（CHECK 生效）" || bad "revoked_at CHECK 未生效"

echo
echo "=== K. M1 历史帖子保持 author_id IS NULL（不伪造归属）==="
LEGACY="$(psql -h 127.0.0.1 -U campus -d campus -Atc \
  "select count(*) from posts where author_id is null and body like 'M1-%'")"
NEWLY="$(psql -h 127.0.0.1 -U campus -d campus -Atc \
  "select count(*) from posts where author_id is not null and body like 'M2-AUTH-%'")"
echo "  M1 遗留 author_id IS NULL: $LEGACY 行；M2 已认证帖: $NEWLY 行"
[ "$LEGACY" -ge 1 ] && ok "M1 历史帖子 author_id 仍为 NULL（保留了'未知身份'语义）" || bad "M1 历史帖子被赋予了伪造归属"
[ "$NEWLY" -ge 1 ] && ok "M2 已认证帖 author_id 非空" || bad "M2 帖子归属缺失"

echo
unset PGPASSWORD
if [ "$FAILED" -eq 0 ]; then echo "AUTH_RESULT PASS"; else echo "AUTH_RESULT FAIL"; fi
exit "$FAILED"
