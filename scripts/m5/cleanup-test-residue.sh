#!/usr/bin/env bash
# 把共享 demo 库恢复到"种子基线"：清掉各子代理验证留下的测试账号及其级联数据。
#
# ⚠️ 本版列名与删除顺序**按真实 schema 修正过**（见 scripts/m5/describe-for-cleanup.sh 的输出）。
#    上一版凭假设写了 `user_id`，dry-run 当场暴露 four 张表根本没这列 ——
#    若直接 --apply，会一部分表删成功、一部分报错，留下**不一致状态**。
#    → 这就是"先 dry-run"的价值：**在真删之前暴露假设错误**。
#
# 真实列名（已核实）：
#   sessions.user_id / login_challenges.phone_e164 / messages.sender_id
#   media.owner_user_id / board_notes.{from,to}_user_id
#   message_media.{message_id,media_id} / thread_members.user_id
#
# 外键（决定删除顺序）：
#   board_notes.{from,to}_user_id -> users.id
#   media.owner_user_id           -> users.id
#   message_media.media_id        -> media.id ；message_media.message_id -> messages.id
#   messages.sender_id            -> users.id ；messages.thread_id -> message_threads.id
#   sessions.user_id              -> users.id
#   thread_members.user_id        -> users.id
#
# ⚠️ 运行前提：
#   1) **确认没有正在运行的设备/接口验证**（否则删账号会破坏它的会话，
#      且它的失败会看起来像产品缺陷）
#   2) 本脚本默认 **dry-run**；确认无误后加 --apply
#
# ⚠️ 刻意**不删 message_threads**：那些线程可能同时被种子用户引用
#     （App 的会话列表会读它们），删了会改变 App 的可见行为 —— 超出"清残留"的范围。
#     本脚本只删**测试账号及其隶属数据**，不整线程删。
#
# 用法：
#   bash cleanup-test-residue.sh            # dry-run
#   bash cleanup-test-residue.sh --apply    # 真删
set -u
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
UP=/srv/campus/uploads

SEED="'+8613800000001','+8613800000002','+8613800000003'"
CAND="select id from users where created_at >= '2026-09-21' and phone_e164 not in ($SEED)"
CAND_PHONES="select phone_e164 from users where id in ($CAND)"

echo "=== 0) 模式：$([ $APPLY -eq 1 ] && echo 'APPLY（真删）' || echo 'DRY-RUN（只打印）') ==="
echo
echo "=== 1) 将影响的测试账号 ==="
PSQL "select phone_e164 || ' | ' || coalesce(display_name,'-') || ' | ' || to_char(created_at,'MM-DD HH24:MI') from users where id in ($CAND) order by created_at" | sed 's/^/    /'
echo "    合计: $(PSQL "select count(*) from users where id in ($CAND)") 个"

echo
echo "=== 2) 种子账号（绝不动）==="
PSQL "select phone_e164 || ' | ' || coalesce(display_name,'-') from users where phone_e164 in ($SEED)" | sed 's/^/    /'

echo
echo "=== 3) 将被连带清理的行数（列名已核实）==="
echo "    sessions            : $(PSQL "select count(*) from sessions where user_id in ($CAND)")"
echo "    login_challenges    : $(PSQL "select count(*) from login_challenges where phone_e164 in ($CAND_PHONES)")"
echo "    messages(sender_id) : $(PSQL "select count(*) from messages where sender_id in ($CAND)")"
echo "    media(owner)        : $(PSQL "select count(*) from media where owner_user_id in ($CAND)")"
echo "    board_notes(from)   : $(PSQL "select count(*) from board_notes where from_user_id in ($CAND)")"
echo "    board_notes(to)     : $(PSQL "select count(*) from board_notes where to_user_id in ($CAND)")"
echo "    thread_members      : $(PSQL "select count(*) from thread_members where user_id in ($CAND)")"
echo "    message_media(将被消息/媒体带走): $(PSQL "select count(*) from message_media where message_id in (select id from messages where sender_id in ($CAND)) or media_id in (select id from media where owner_user_id in ($CAND))")"

echo
echo "=== 4) 待删的盘上文件（必须先取，否则删行后成 orphan）==="
FILES=$(PSQL "select scope || '/' || storage_key from media where owner_user_id in ($CAND)")
if [ -n "$FILES" ]; then printf '%s\n' "$FILES" | sed 's/^/    /'; else echo "    （无）"; fi

if [ $APPLY -eq 0 ]; then
  echo
  echo "DRY-RUN 结束（未改动任何数据）。确认无误后：bash $0 --apply"
  exit 0
fi

echo
echo "=== 5) 执行清理（顺序尊重外键）==="
PSQL "delete from message_media where message_id in (select id from messages where sender_id in ($CAND)) or media_id in (select id from media where owner_user_id in ($CAND))" >/dev/null && echo "    ok message_media"
PSQL "delete from messages       where sender_id in ($CAND)"        >/dev/null && echo "    ok messages"
PSQL "delete from sessions       where user_id in ($CAND)"          >/dev/null && echo "    ok sessions"
PSQL "delete from thread_members where user_id in ($CAND)"          >/dev/null && echo "    ok thread_members"
PSQL "delete from login_challenges where phone_e164 in ($CAND_PHONES)" >/dev/null && echo "    ok login_challenges"
PSQL "delete from board_notes    where from_user_id in ($CAND) or to_user_id in ($CAND)" >/dev/null && echo "    ok board_notes"
PSQL "delete from media          where owner_user_id in ($CAND)"    >/dev/null && echo "    ok media"
PSQL "delete from users          where id in ($CAND)"               >/dev/null && echo "    ok users"

while IFS= read -r REL; do
  [ -n "$REL" ] || continue
  P="$UP/$REL"
  if [ -f "$P" ]; then /bin/rm -f "$P"; echo "    已删文件: $P"; fi
done <<< "$FILES"

echo
echo "=== 6) 校验 ==="
echo "    users 总数: $(PSQL 'select count(*) from users')（应为 3）"
echo "    种子仍在  : $(PSQL "select count(*) from users where phone_e164 in ($SEED)")（应为 3）"
echo "    sessions  : $(PSQL 'select count(*) from sessions')"
echo "    login_challenges: $(PSQL 'select count(*) from login_challenges')"
echo "    messages  : $(PSQL 'select count(*) from messages')"
echo "    media     : $(PSQL 'select count(*) from media')"
echo "    board_notes: $(PSQL 'select count(*) from board_notes')（应为 2 = 种子基线）"
cd /srv/campus/server || exit 1
echo -n "    盘库一致性: "
UPLOAD_ROOT=$UP DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" \
  node dist/cleanup.mjs --json 2>&1 | head -c 320
echo
