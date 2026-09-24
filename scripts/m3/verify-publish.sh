#!/usr/bin/env bash
# M3 Slice 3 验证：登录后发帖 + 作者归属只能来自会话（含攻击用例）
#
# 审核记录 10 的硬要求：
#   "并建议再机械验证一个攻击用例：客户端手工给 POST 塞入 author / authorId，
#    必须 strict 400，数据库也不能产生任何行。"
#
# 本脚本验证的是**自建系统**的发帖语义；原版侧的发布行为属写操作，
# 禁止取证 → BLOCKED_BY_POLICY（不声称与原版 1:1 一致）。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1/api
SINK=/run/campus/login-codes
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1"; }
jget() { printf '%s' "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }

# 随机手机号：服务端按 (IP, 手机号) 对发码限流 5 次/300s，重复号码会被 429
PHONE="138$(printf '%08d' $((RANDOM * RANDOM % 100000000)))"

echo "=== 0. 用真实手机号 + 验证码登录（无 session 夹具）==="
rm -f "$SINK/"*.json 2>/dev/null || true
REQ="$(curl -s -m 10 -X POST "$BASE/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$PHONE\"}")"
SINK_PATH="$(jget "$REQ" sink)"
CODE=""
[ -n "$SINK_PATH" ] && [ -f "$SINK_PATH" ] && CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINK_PATH")"
if [ -z "$CODE" ]; then bad "没能从 dev sink 取到验证码：$REQ"; exit 1; fi
VER="$(curl -s -m 10 -X POST "$BASE/auth/verify-code" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}")"
TOKEN="$(jget "$VER" token)"
if [ -n "$TOKEN" ]; then ok "登录成功（token 长度 ${#TOKEN}，不打印内容）"; else bad "登录失败：$VER"; exit 1; fi
AUTH=(-H "Authorization: Bearer $TOKEN")
ME="$(curl -s -m 10 "$BASE/auth/me" "${AUTH[@]}")"
ME_ID="$(jget "$ME" id)"
ME_NAME="$(jget "$ME" displayName)"
ok "会话身份：id=${ME_ID:0:8}… name=$ME_NAME"

MARK="M3-SLICE3-$(date +%s)"

echo
echo "=== 1. 攻击用例：客户端手工塞 author / authorId → 必须 strict 400 且**不产生任何行** ==="
for field in author authorId author_id user_id; do
  BEFORE="$(PSQL 'select count(*) from posts')"
  RESP="$(curl -s -m 10 -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts" \
    -H 'Content-Type: application/json' \
    -d "{\"body\":\"$MARK 注入$field\",\"place\":\"测试地点\",\"$field\":\"我是伪造的作者\"}")"
  C="$(printf '%s' "$RESP" | tail -1)"; B="$(printf '%s' "$RESP" | head -n -1)"
  AFTER="$(PSQL 'select count(*) from posts')"
  if [ "$C" = "400" ]; then ok "带 $field → 400（strict schema 拒绝）"; else bad "带 $field 期望 400，实际 $C（$B）"; fi
  if [ "$BEFORE" = "$AFTER" ]; then ok "带 $field 被拒后**数据库行数未变**（$BEFORE → $AFTER）"; else bad "带 $field 被拒却写了行（$BEFORE → $AFTER）"; fi
  # 更严格：库里不能出现任何带这个伪造作者名的行
  FAKE="$(PSQL "select count(*) from posts where author_name = '我是伪造的作者'")"
  if [ "$FAKE" = "0" ]; then ok "库中不存在伪造作者名的行"; else bad "库中出现了 $FAKE 行伪造作者"; fi
done

echo
echo "=== 2. 未登录发帖 → 401 且不产生行 ==="
BEFORE="$(PSQL 'select count(*) from posts')"
C401="$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST "$BASE/posts" \
  -H 'Content-Type: application/json' -d "{\"body\":\"$MARK 未登录\",\"place\":\"测试地点\"}")"
AFTER="$(PSQL 'select count(*) from posts')"
[ "$C401" = "401" ] && ok "未登录发帖 → 401" || bad "期望 401，实际 $C401"
[ "$BEFORE" = "$AFTER" ] && ok "未登录发帖未产生行（$BEFORE → $AFTER）" || bad "未登录发帖却写了行"

echo
echo "=== 3. 正常发帖：作者由**服务端从会话**决定 ==="
POST="$(curl -s -m 10 -w '\n%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts" \
  -H 'Content-Type: application/json' -d "{\"body\":\"$MARK 正常发帖\",\"place\":\"北京交通大学\"}")"
C="$(printf '%s' "$POST" | tail -1)"; B="$(printf '%s' "$POST" | head -n -1)"
[ "$C" = "201" ] && ok "正常发帖 → 201" || bad "期望 201，实际 $C（$B）"
NEW_ID="$(jget "$B" id)"
[ -n "$NEW_ID" ] && ok "返回了新帖 id" || bad "响应里没有 id"
# 库里的 author_id / author_name 必须等于会话身份
DB_AUTHOR_ID="$(PSQL "select coalesce(author_id::text,'(null)') from posts where id = '$NEW_ID'")"
DB_AUTHOR_NAME="$(PSQL "select author_name from posts where id = '$NEW_ID'")"
[ "$DB_AUTHOR_ID" = "$ME_ID" ] && ok "库中 author_id == 会话用户 id" || bad "author_id 不符：库里 $DB_AUTHOR_ID，会话 $ME_ID"
[ "$DB_AUTHOR_NAME" = "$ME_NAME" ] && ok "库中 author_name == 会话展示名（$ME_NAME）" || bad "author_name 不符：库里 $DB_AUTHOR_NAME"

echo
echo "=== 4. 详情与列表里的归属一致（且重启进程后仍存在）==="
DET="$(curl -s -m 10 "$BASE/posts/$NEW_ID")"
[ "$(jget "$DET" author)" = "$ME_NAME" ] && ok "详情 author == 会话展示名" || bad "详情 author 不符：$(jget "$DET" author)"
[ "$(jget "$DET" authorId)" = "$ME_ID" ] && ok "详情 authorId == 会话用户 id" || bad "详情 authorId 不符"
LIST="$(curl -s -m 10 "$BASE/posts")"
printf '%s' "$LIST" | grep -q "$NEW_ID" && ok "列表里能查到这条新帖" || bad "列表里查不到新帖"
printf '%s' "$LIST" | grep -q "$ME_NAME" && ok "列表里作者名与会话身份一致" || bad "列表里作者名不符"

echo
echo "=== 5. 服务端重启后仍在（持久化）==="
systemctl restart campus-backend.service
for _ in $(seq 1 40); do
  [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "$BASE/ready")" = "200" ] && break
  sleep 1
done
DET2="$(curl -s -m 10 "$BASE/posts/$NEW_ID")"
[ "$(jget "$DET2" id)" = "$NEW_ID" ] && ok "重启后端后详情仍可读到（持久化到 PG）" || bad "重启后读不到新帖"
[ "$(jget "$DET2" authorId)" = "$ME_ID" ] && ok "重启后归属仍一致" || bad "重启后归属不符"

echo
echo "=== 6. 内容校验 ==="
EMPTY="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts" \
  -H 'Content-Type: application/json' -d '{"body":"   "}')"
[ "$EMPTY" = "400" ] && ok "空正文 → 400" || bad "期望 400，实际 $EMPTY"
LONG="$(python3 -c "print('x'*501)")"
TOOLONG="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X POST "$BASE/posts" \
  -H 'Content-Type: application/json' -d "{\"body\":\"$LONG\"}")"
[ "$TOOLONG" = "400" ] && ok "超长正文（501 字）→ 400" || bad "期望 400，实际 $TOOLONG"

echo
echo "=== 7. 清理 ==="
PSQL "delete from posts where body like 'M3-SLICE3-%'" >/dev/null
LEFTPOST="$(PSQL "select count(*) from posts where body like 'M3-SLICE3-%'")"
[ "$LEFTPOST" = "0" ] && ok "测试帖子已清理" || bad "仍有 $LEFTPOST 条测试帖子"
PSQL "delete from sessions where user_id = '$ME_ID'" >/dev/null
PSQL "delete from login_challenges where phone_e164 = '+86$PHONE'" >/dev/null
PSQL "delete from users where id = '$ME_ID'" >/dev/null
LEFTUSER="$(PSQL "select count(*) from users where id = '$ME_ID'")"
[ "$LEFTUSER" = "0" ] && ok "测试账号及其会话/挑战已清理" || bad "测试账号仍存在"
rm -f "$SINK/"*.json 2>/dev/null || true

echo
if [ "$FAILED" -eq 0 ]; then echo "PUBLISH_RESULT PASS"; else echo "PUBLISH_RESULT FAIL"; fi
exit "$FAILED"
