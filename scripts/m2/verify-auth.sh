#!/usr/bin/env bash
# M2 认证契约 + 归属信任验证（对应 docs/archive/legacy-development/m2/SPEC.md 第八节 AUTH_CONTRACT / AUTHOR_TRUST / CONSTRAINTS）
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

# 只打印长度，连前缀都不打 —— 审核记录 05 要求 bearer 绝不进入 Gate 证据，
# 而"前 8 位"虽然不足以还原 token，仍属于不必要的暴露。长度足够用于排查。
redact() { printf 'len=%s' "${#1}"; }

json_get() { # json_get <json> <key>
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1
}

echo "=== 0. 重置进程内限流状态（保证本次判定可复现）==="
# 限流计数在**进程内存**里，反复跑 Gate 会把计数越攒越高，
# 于是同一份代码时而过、时而"样本不足"——这种不可复现的 Gate 等于没有 Gate。
# 重启一次服务是最简单且可验证的重置方式（同时也顺带验证了服务能正常重启）。
systemctl restart campus-backend.service
READY_S=0
for i in $(seq 1 60); do
  if curl -sf -m 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then READY_S=$i; break; fi
  sleep 1
done
if curl -sf -m 5 "$BASE/health" >/dev/null 2>&1; then
  ok "后端已重启并就绪（${READY_S}s），限流计数归零"
else
  bad "后端重启后经 Nginx 不可用"
fi

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
echo "=== C. [DUMMY_SCRYPT_EXECUTION] 用户不存在的分支也必须真的跑一次同参数 scrypt ==="
# 命名说明（审核记录 06）：这条断言的名字必须诚实 ——
# 它证明的是「用户不存在时也执行了主要 KDF 成本」，**不是**"认证是常量时间的"。
# 所以叫 DUMMY_SCRYPT_EXECUTION，不叫 TIMING_ATTACK_SAFE。
#
# 这条断言是**粗粒度**的，不是"常量时间证明"：它只区分"跑了一次 scrypt"与"根本没跑"。
# 实测物理信号很干净：没跑 scrypt ≈ 2ms；跑了一次 ≈ 60~75ms（约 30 倍差距）。
#
# 阈值取 0.3 而不是 0.5：这台机器只有 2 vCPU，紧接着后端压测段跑时噪声可达 2 倍以上，
# 0.5 的阈值会假失败（实测在 Gate 里失败、单独跑却通过）。
# 0.3 仍然能干净地抓住"没跑 scrypt"（那会是 0.03 量级），但对噪声不再敏感。
#
# 另外两个坑（都踩过）：
#  1) 探测用的 handle **必须每次都不同**：固定名字在多次运行后累计失败会触发限流，
#     限流在 scrypt 之前就返回 429（约 2ms），样本直接失真。
#  2) 因此要**校验状态码确实是 401**，把 429/网络异常剔除，并断言拿到至少 3 个有效样本 ——
#     否则一条"样本不足"的断言会被误读成"通过了"。
t_wrong=99; t_missing=99; n_wrong=0; n_missing=0
PROBE_MISSING="no-such-handle-$$-$RANDOM$RANDOM"
for _ in 1 2 3 4 5 6 7 8; do
  read -r code d < <(curl -s -o /dev/null -m 15 -w '%{http_code} %{time_total}' -X POST "$BASE/auth/login" \
    -H 'Content-Type: application/json' -d "{\"handle\":\"$SEED_USER\",\"password\":\"$WRONG_PASS\"}")
  if [ "$code" = "401" ]; then
    n_wrong=$((n_wrong + 1))
    t_wrong=$(awk -v a="$t_wrong" -v b="$d" 'BEGIN{print (b<a)?b:a}')
  fi
  read -r code d < <(curl -s -o /dev/null -m 15 -w '%{http_code} %{time_total}' -X POST "$BASE/auth/login" \
    -H 'Content-Type: application/json' -d "{\"handle\":\"$PROBE_MISSING\",\"password\":\"whatever-pass\"}")
  if [ "$code" = "401" ]; then
    n_missing=$((n_missing + 1))
    t_missing=$(awk -v a="$t_missing" -v b="$d" 'BEGIN{print (b<a)?b:a}')
  fi
  [ "$n_wrong" -ge 3 ] && [ "$n_missing" -ge 3 ] && break
done
echo "  密码错最短耗时     : ${t_wrong}s  (有效样本 $n_wrong)"
echo "  用户不存在最短耗时 : ${t_missing}s  (有效样本 $n_missing)"
if [ "$n_wrong" -lt 3 ] || [ "$n_missing" -lt 3 ]; then
  bad "计时样本不足（401 样本 密码错=$n_wrong 不存在=$n_missing），无法判定"
else
  awk -v w="$t_wrong" -v m="$t_missing" 'BEGIN{ exit !(m >= 0.3*w) }' \
    && ok "不存在分支耗时 ≥ 密码错分支的 30%（dummy scrypt 生效；实测比值 $(awk -v w="$t_wrong" -v m="$t_missing" 'BEGIN{printf "%.2f", m/w}')）" \
    || bad "不存在分支明显更快（比值 $(awk -v w="$t_wrong" -v m="$t_missing" 'BEGIN{printf "%.2f", m/w}')），说明没有跑 dummy scrypt（可枚举用户）"
fi

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
echo "=== L. 业务 API 里不得存在注册/改密类接口（审核记录 06）==="
# 曾经有个默认关闭的 POST /api/auth/dev-register。审核指出：即使是默认关闭，
# 也意味着生产二进制里永久带着一个"条件开启的注册能力"，配错环境变量就可能暴露。
# 现在造账号走运维 CLI（dist/admin.mjs create-user），业务 API 只保留 login/logout/me。
for path in /api/auth/dev-register /api/auth/register /api/auth/signup /api/auth/password \
            /api/auth/refresh /api/auth/reset-password; do
  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1$path" \
    -H 'Content-Type: application/json' -d '{"handle":"x","password":"yyyyyyyy"}')"
  if [ "$code" = "404" ]; then
    ok "POST $path → 404（该接口不存在）"
  else
    bad "POST $path 返回 $code，期望 404 —— 业务 API 里出现了不该有的能力"
  fi
done

echo
unset PGPASSWORD
if [ "$FAILED" -eq 0 ]; then echo "AUTH_RESULT PASS"; else echo "AUTH_RESULT FAIL"; fi
exit "$FAILED"
