#!/usr/bin/env bash
# M4 存储契约验证（DB 层）—— 审核记录 13 的 7 条 + 审核记录 15 的 4 条
#
# 本脚本只验证**数据库层**能机械证明的部分（跨 scope 结构不可能、幂等键、
# can_read_message/can_read_media 的一致性）。文件系统与 HTTP 层的断言在后续脚本里。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
# psql -Atc 执行带 RETURNING 的 INSERT 时，输出里除了返回行还会带上命令标签（如 "INSERT 0 1"）。
# 只取**首行**作为返回值，否则 "$R1" = "$PUB" 这种比较永远失败
# （第一版就是这么误报"插入 media 失败"的，其实插入是成功的）。
PSQL1() { PSQL "$1" | head -1; }
# 需要区分"成功/失败"的语句：返回 0=成功，非 0=失败
PSQLQ() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -q -c "$1" >/dev/null 2>&1; echo $?; }

U1='11111111-1111-4111-8111-111111111111'   # seed 用户 anmoss
U2='22222222-2222-4222-8222-222222222222'   # seed 用户 lemy
U3='33333333-3333-4333-8333-333333333333'   # seed 用户 azur（非会话成员）

PUB="11111111-aaaa-4aaa-8aaa-000000000001"
PRV="11111111-bbbb-4bbb-8bbb-000000000002"
THREAD="11111111-cccc-4ccc-8ccc-000000000003"
MSG="11111111-dddd-4ddd-8ddd-000000000004"
MSG2="11111111-eeee-4eee-8eee-000000000005"   # 用于"撤回"用例
IDEM_KEY="11111111-ffff-4fff-8fff-000000000006"

echo "=== A. 迁移 006 的 schema 就位 ==="
for t in media post_media message_media; do
  N="$(PSQL "select count(*) from information_schema.tables where table_name='$t'")"
  [ "$N" = "1" ] && ok "表 $t 存在" || bad "表 $t 缺失"
done
N="$(PSQL "select count(*) from pg_proc where proname in ('can_read_message','can_read_media')")"
[ "$N" = "2" ] && ok "can_read_message / can_read_media 两个判定函数存在" || bad "判定函数缺失（$N）"
N="$(PSQL "select count(*) from information_schema.columns where table_name='messages' and column_name in ('kind','deleted_at')")"
[ "$N" = "2" ] && ok "messages 已有 kind 与 deleted_at" || bad "messages 缺 kind/deleted_at"

echo
echo "=== B. 准备测试数据（public media + private media + 会话）==="
PSQL "delete from message_media where media_id in ('$PUB','$PRV')" >/dev/null
PSQL "delete from post_media where media_id in ('$PUB','$PRV')" >/dev/null
PSQL "delete from media where id in ('$PUB','$PRV')" >/dev/null
PSQL "delete from messages where id in ('$MSG','$MSG2')" >/dev/null
PSQL "delete from message_threads where id = '$THREAD'" >/dev/null
R1="$(PSQL1 "insert into media (id, owner_user_id, scope, storage_key, mime, bytes, sha256, upload_request_id) values ('$PUB','$U1','public','2026/09/test-public.webp','image/webp',1024,'$(printf 'c3%.0s' {1..32})','$IDEM_KEY') returning id")"
[ "$R1" = "$PUB" ] && ok "插入 public media 成功" || bad "插入 public media 失败：$R1"


# 用另一个 key 正常插入 private media
R2="$(PSQL1 "insert into media (id, owner_user_id, scope, storage_key, mime, bytes, sha256, upload_request_id) values ('$PRV','$U1','private','2026/09/test-private.webp','image/webp',1024,'$(printf 'd4%.0s' {1..32})','11111111-9999-4999-8999-000000000009') returning id")"
[ "$R2" = "$PRV" ] && ok "插入 private media 成功" || bad "插入 private media 失败：$R2"
# 幂等键：用**同一个合法 uuid** 再插一条 → 必须以"唯一约束冲突"失败。
# 关键：断言**错误信息里是 duplicate key**，而不是只看"失败了"——
# 第一版那次失败其实是 text→uuid 的类型错误，根本不是唯一约束，
# 差一点把"没验证到"当成"验证通过"（假阳性）。
IDEM_OUT="$(PSQL "insert into media (id, owner_user_id, scope, storage_key, mime, bytes, sha256, upload_request_id) values ('11111111-7a7a-4a7a-8a7a-000000000007','$U1','private','2026/09/idem-test.webp','image/webp',1024,'$(printf 'e5%.0s' {1..32})','$IDEM_KEY') returning id" 2>&1)"
case "$IDEM_OUT" in
  *"duplicate key"*|*"唯一"*|*"media_upload_idem_uniq"*) ok "同一 (owner, upload_request_id) 重复插入 → **唯一约束冲突**（幂等键生效）" ;;
  *) bad "幂等键用例没有拿到唯一约束冲突：$IDEM_OUT" ;;
esac

PSQL "insert into message_threads (id, kind, title) values ('$THREAD','direct','测试会话')" >/dev/null
PSQL "insert into thread_members (id, thread_id, user_id) values (gen_random_uuid(),'$THREAD','$U1')" >/dev/null
PSQL "insert into thread_members (id, thread_id, user_id) values (gen_random_uuid(),'$THREAD','$U2')" >/dev/null
ok "建了一个 U1+U2 的会话（U3 不是成员）"

echo
echo "=== C. P0-B：跨 scope 引用必须**在数据库层**被拒 ==="
# C1: post_media 指向 private media → 必须失败
RC="$(PSQLQ "insert into post_media (post_id, media_id, media_scope) values ('aaaaaaaa-0001-4001-8001-000000000001','$PRV','public')")"
[ "$RC" != "0" ] && ok "post_media 引用 private media → **数据库拒绝**（复合外键生效）" || bad "post_media 竟能引用 private media —— DB 级防线失效"

# C2: message_media 指向 public media → 必须失败
RC="$(PSQLQ "insert into message_media (message_id, media_id, media_scope) values ('$MSG','$PUB','private')")"
[ "$RC" != "0" ] && ok "message_media 引用 public media → **数据库拒绝**" || bad "message_media 竟能引用 public media"

# C3: 显式塞错 scope 值（绕过 DEFAULT）也必须被 CHECK 拦住
RC="$(PSQLQ "insert into post_media (post_id, media_id, media_scope) values ('aaaaaaaa-0001-4001-8001-000000000001','$PUB','private')")"
[ "$RC" != "0" ] && ok "post_media 显式写 media_scope='private' 被 CHECK 拒绝" || bad "post_media 能写入非 public scope"

# C4: 合法引用必须成功（证明防线不是"全都拒"）
RC="$(PSQLQ "insert into post_media (post_id, media_id, media_scope, position) values ('aaaaaaaa-0001-4001-8001-000000000001','$PUB','public',7)")"
[ "$RC" = "0" ] && ok "post_media 合法引用 public media 成功（防线不是一律拒绝）" || bad "合法引用被误拒"

echo
echo "=== D. P0-A：媒体授权**复用**消息可见性（防权限漂移）==="
PSQL "insert into messages (id, thread_id, sender_id, body, kind) values ('$MSG','$THREAD','$U1','一条带私有图的消息','image')" >/dev/null
RC="$(PSQLQ "insert into message_media (message_id, media_id, media_scope, position) values ('$MSG','$PRV','private',0)")"
[ "$RC" = "0" ] && ok "message_media 合法引用 private media 成功" || bad "合法私有引用被误拒"

C1="$(PSQL "select can_read_message('$U1','$MSG')")"
C2="$(PSQL "select can_read_message('$U2','$MSG')")"
C3="$(PSQL "select can_read_message('$U3','$MSG')")"
[ "$C1" = "t" ] && ok "can_read_message：发送者 U1 → true" || bad "U1 应为 true，实际 $C1"
[ "$C2" = "t" ] && ok "can_read_message：会话成员 U2 → true" || bad "U2 应为 true，实际 $C2"
[ "$C3" = "f" ] && ok "can_read_message：非成员 U3 → false" || bad "U3 应为 false，实际 $C3"

M1="$(PSQL "select can_read_media('$U1','$PRV')")"
M2="$(PSQL "select can_read_media('$U2','$PRV')")"
M3="$(PSQL "select can_read_media('$U3','$PRV')")"
[ "$M1" = "t" ] && ok "can_read_media：发送者能读私有图" || bad "U1 读私有图应为 true，实际 $M1"
[ "$M2" = "t" ] && ok "can_read_media：会话成员能读私有图" || bad "U2 读私有图应为 true，实际 $M2"
[ "$M3" = "f" ] && ok "can_read_media：**非成员不能读**（知道 media id 也读不到）" || bad "U3 竟能读私有图 —— 授权失效"

echo "  --- 防漂移：同一 (user, message) 两个接口的结论必须一致 ---"
for u in "$U1" "$U2" "$U3"; do
  cm="$(PSQL "select can_read_message('$u','$MSG')")"
  # 媒体侧：该 media 只有这一条引用消息 → 结论应与消息侧一致
  cmed="$(PSQL "select can_read_media('$u','$PRV')")"
  [ "$cm" = "$cmed" ] && ok "用户 ${u:0:8}… 消息与媒体结论一致（$cm）" || bad "权限漂移！消息=$cm 媒体=$cmed"
done

echo
echo "=== E. 撤回后私有媒体必须不可读（deleted_at 参与判定）==="
PSQL "insert into messages (id, thread_id, sender_id, body, kind) values ('$MSG2','$THREAD','$U1','待撤回的消息','image')" >/dev/null
RC="$(PSQLQ "insert into message_media (message_id, media_id, media_scope, position) values ('$MSG2','$PRV','private',1)")"
[ "$RC" = "0" ] && ok "第二条消息也引用了同一 private media" || bad "第二条引用失败（同一 media 只允许一条引用吗？检查媒体侧判定）"
R="$(PSQL "select can_read_media('$U1','$PRV')")"
[ "$R" = "t" ] && ok "撤回前：发送者可读" || bad "撤回前应为 true，实际 $R"
PSQL "update messages set deleted_at = now() where id = '$MSG'" >/dev/null
R1="$(PSQL "select can_read_message('$U1','$MSG')")"
R2="$(PSQL "select can_read_message('$U1','$MSG2')")"
[ "$R1" = "f" ] && ok "撤回的消息 → can_read_message=false" || bad "撤回后仍为 true"
[ "$R2" = "t" ] && ok "另一条未撤回的引用仍可读（撤回只影响那一条）" || bad "撤回影响了无关消息"
PSQL "update messages set deleted_at = now() where id = '$MSG2'" >/dev/null
R="$(PSQL "select can_read_media('$U1','$PRV')")"
[ "$R" = "f" ] && ok "**全部引用消息都撤回 → 私有媒体不可读**" || bad "所有引用都撤回后仍可读（$R）"

echo
echo "=== F. public media 的访问模型独立验证（不与私聊图复用授权）==="
P1="$(PSQL "select can_read_media('$U3','$PUB')")"
[ "$P1" = "t" ] && ok "public media：**任何已登录用户**可读（U3 也 true）" || bad "public media 应为公开可读"
echo "  （public 走 Nginx 静态下发，授权链与 private 完全不同 —— 这是设计要求）"

echo
echo "=== G. 清理 ==="
PSQL "delete from post_media where media_id in ('$PUB','$PRV')" >/dev/null
PSQL "delete from message_media where media_id in ('$PUB','$PRV')" >/dev/null
PSQL "delete from media where id in ('$PUB','$PRV')" >/dev/null
PSQL "delete from messages where id in ('$MSG','$MSG2')" >/dev/null
PSQL "delete from thread_members where thread_id = '$THREAD'" >/dev/null
PSQL "delete from message_threads where id = '$THREAD'" >/dev/null
LEFT="$(PSQL "select count(*) from media where id in ('$PUB','$PRV')")"
[ "$LEFT" = "0" ] && ok "测试数据已清理" || bad "仍有残留"

echo
if [ "$FAILED" -eq 0 ]; then echo "MEDIA_SCHEMA_RESULT PASS"; else echo "MEDIA_SCHEMA_RESULT FAIL"; fi
exit "$FAILED"
