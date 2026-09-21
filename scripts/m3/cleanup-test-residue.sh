#!/usr/bin/env bash
# M3 Final Gate 前置：**定向**清理测试残留（审核记录 12 批准）
#
# 原则（审核要求："定向清理明确的测试残留"）：
#   - 只删**能明确指认**的东西：按已知测试标记匹配的帖子、以及非种子用户
#   - **不**做无差别的 truncate / delete-all
#   - 删完必须证明："只剩种子数据"且 canonical 哈希未变
#     （种子的 canonical 只覆盖种子行，所以清理不该改变它 —— 这是最强的自检）
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1"; }
SINK=/run/campus/login-codes
CANON_FILE=/srv/campus/seed-canonical.txt

echo "=== A. 清理前盘点（按明确标记）==="
PSQL "
select case
  when id in ('aaaaaaaa-0001-4001-8001-000000000001','aaaaaaaa-0002-4002-8002-000000000002',
              'aaaaaaaa-0003-4003-8003-000000000003','aaaaaaaa-0004-4004-8004-000000000004') then 'SEED(保留)'
  when body like 'M1-E2E-%'        then 'M1-E2E'
  when body like 'M1-前端联调%'     then 'M1-前端联调'
  when body like 'M1-真机%'         then 'M1-真机'
  when body like '%TLS 日志泄漏检查%' then 'TLS'
  when body like 'M2-GATE-%'       then 'M2-GATE'
  when body like 'M2-AUTH-%'       then 'M2-AUTH'
  when body like 'M3-SLICE%'       then 'M3-SLICE'
  when body like 'M3SLICE3UIDEV%'  then 'M3UIDEV'
  else 'UNCLASSIFIED' end as kind, count(*)
from posts group by 1 order by 1"
UNCLASSIFIED="$(PSQL "select count(*) from posts where id not in ('aaaaaaaa-0001-4001-8001-000000000001','aaaaaaaa-0002-4002-8002-000000000002','aaaaaaaa-0003-4003-8003-000000000003','aaaaaaaa-0004-4004-8004-000000000004') and body not like 'M1-E2E-%' and body not like 'M1-前端联调%' and body not like 'M1-真机%' and body not like '%TLS 日志泄漏检查%' and body not like 'M2-GATE-%' and body not like 'M2-AUTH-%' and body not like 'M3-SLICE%' and body not like 'M3SLICE3UIDEV%'")"
if [ "$UNCLASSIFIED" = "0" ]; then
  ok "所有非种子帖子都能被已知标记指认（没有无法归类的残留）"
else
  bad "存在 $UNCLASSIFIED 条无法归类的帖子 —— 不做清理（避免误删）"
  exit 1
fi

SEED_USERS="'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'"
echo "  非种子用户数: $(PSQL "select count(*) from users where id not in ($SEED_USERS)")"

BEFORE_POSTS="$(PSQL 'select count(*) from posts')"
echo "  清理前 posts 总数: $BEFORE_POSTS"

echo
echo "=== B. 执行定向删除 ==="
# 1) 测试帖子（只按明确标记）
PSQL "delete from posts where id not in ('aaaaaaaa-0001-4001-8001-000000000001','aaaaaaaa-0002-4002-8002-000000000002','aaaaaaaa-0003-4003-8003-000000000003','aaaaaaaa-0004-4004-8004-000000000004')
      and (body like 'M1-E2E-%' or body like 'M1-前端联调%' or body like 'M1-真机%'
           or body like '%TLS 日志泄漏检查%' or body like 'M2-GATE-%' or body like 'M2-AUTH-%'
           or body like 'M3-SLICE%' or body like 'M3SLICE3UIDEV%')" >/dev/null
ok "已删除带明确标记的测试帖子（评论/点赞随外键级联）"

# 2) 非种子用户（测试登录创建）+ 其会话与验证码
PSQL "delete from sessions where user_id not in ($SEED_USERS)" >/dev/null
PSQL "delete from login_challenges where phone_e164 not in (select coalesce(phone_e164,'') from users)" >/dev/null
PSQL "delete from users where id not in ($SEED_USERS)" >/dev/null
ok "已删除非种子用户及其会话/验证码"

# 3) dev sink 清空
rm -f "$SINK"/*.json 2>/dev/null || true
ok "dev sink 已清空"

echo
echo "=== C. 清理后的断言 ==="
AFTER_POSTS="$(PSQL 'select count(*) from posts')"
[ "$AFTER_POSTS" = "4" ] && ok "posts 只剩种子 4 条（$BEFORE_POSTS → $AFTER_POSTS）" || bad "posts 期望 4，实际 $AFTER_POSTS"

AFTER_USERS="$(PSQL 'select count(*) from users')"
[ "$AFTER_USERS" = "3" ] && ok "users 只剩种子 3 个" || bad "users 期望 3，实际 $AFTER_USERS"

# 种子帖子必须都还在
for pid in aaaaaaaa-0001-4001-8001-000000000001 aaaaaaaa-0002-4002-8002-000000000002 aaaaaaaa-0003-4003-8003-000000000003 aaaaaaaa-0004-4004-8004-000000000004; do
  N="$(PSQL "select count(*) from posts where id = '$pid'")"
  [ "$N" = "1" ] || bad "种子帖 $pid 不见了"
done
ok "4 条种子帖全部保留"

# 评论/点赞回到种子数量
C="$(PSQL 'select count(*) from comments')"
[ "$C" = "2" ] && ok "comments 回到种子 2 条" || bad "comments 期望 2，实际 $C"
L="$(PSQL 'select count(*) from likes')"
[ "$L" = "2" ] && ok "likes 回到种子 2 条" || bad "likes 期望 2，实际 $L"

echo
echo "=== D. canonical 必须**未变**（清理不该改变种子逻辑内容）==="
HASH="$(sudo -u campus bash -c "set -a; . /srv/campus/server.env; set +a; /opt/node-v24.21.0-linux-x64/bin/node /srv/campus/server/dist/seed.mjs" 2>&1 | sed -n 's/^SEED_HASH //p' | head -1)"
EXPECTED="$(cat "$CANON_FILE" | tr -d '[:space:]')"
echo "  实测: $HASH"
echo "  期望: $EXPECTED"
[ "$HASH" = "$EXPECTED" ] && ok "清理后 canonical 哈希未变（种子逻辑内容完好）" || bad "canonical 哈希变了 —— 清理动到了种子数据"

echo
if [ "$FAILED" -eq 0 ]; then echo "CLEANUP_RESULT PASS"; else echo "CLEANUP_RESULT FAIL"; fi
exit "$FAILED"
