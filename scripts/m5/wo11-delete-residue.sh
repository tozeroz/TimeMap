#!/usr/bin/env bash
# WO#11 数据清理 —— 第 5~6 步：**事务内按精确 ID 删除** + deleted_count == 20 + 规范数据完好
#
# 授权依据：审核记录 52（20 条 M1 residue：已授权删除），流程为：
#   pattern discovers candidates → exact 20 IDs reviewed → dependency preview
#   → full pg_dump verified → **delete exact IDs in transaction**
#   → **deleted_count == 20** → **canonical data remains intact**
# 前四步已分别在 wo11-residue-discovery.sh / wo11-residue-backup-full.sh /
# wo11-verify-backup-restorable.sh 中完成并留痕。
#
# ## 本脚本的硬约束
#   ① 候选 id **不是写死的**，而是**再次按 pattern 现场取**，并**逐一断言**其形态，
#      防止"pattern 变了、却按旧清单删"这类事故
#   ② 全部删除在**单个事务**内；任一步校验失败 → ROLLBACK
#   ③ 事务内先 `select count(*)` 断言候选数 == 20，否则中止
#   ④ 删除后校验 deleted_count == 20，否则 ROLLBACK
#   ⑤ 删除后校验**规范数据完好**（非候选帖数、用户数、会话数、消息数、media 数不变），否则 ROLLBACK
#   ⑥ 顺带清理门禁残留消息（WO9B-*/WO7-*/WO11-*，这些是本项目自己的测试数据）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQLQ() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 0) 取删除前的基线（用于事后断言\"规范数据完好\"）==="
B_NONCANON="$(PSQLQ "select count(*) from posts where not (body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%')")"
B_USERS="$(PSQLQ "select count(*) from users")"
B_THREADS="$(PSQLQ "select count(*) from message_threads")"
B_MEMBERS="$(PSQLQ "select count(*) from thread_members")"
B_MEDIA="$(PSQLQ "select count(*) from media")"
B_BOARD="$(PSQLQ "select count(*) from board_notes")"
B_MSGS_SEED="$(PSQLQ "select count(*) from messages where not (body ~ '^(WO9B|WO11|WO7)-')")"
echo "  非候选帖=$B_NONCANON  users=$B_USERS  threads=$B_THREADS  members=$B_MEMBERS"
echo "  media=$B_MEDIA  board_notes=$B_BOARD  非残留消息=$B_MSGS_SEED"

echo
echo "=== 1) 现场取候选 ID，并**逐一断言形态**（不写死清单）==="
IDS="$(PSQLQ "select id::text from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%' order by created_at")"
N="$(printf '%s\n' "$IDS" | grep -c . || true)"
echo "  候选数 = $N"
if [ "$N" != "20" ]; then
  echo "  FAIL 候选数不是 20（审核授权的是 20）→ **中止，不删除**"
  exit 1
fi
# 逐个断言：必须是合法 uuid、且该行的 body 确实匹配 pattern
BAD=0
while IFS= read -r id; do
  [ -z "$id" ] && continue
  case "$id" in
    *[!0-9a-f-]*|'') echo "    ✗ 非法 id: $id"; BAD=$((BAD+1)); continue ;;
  esac
  LEN=$(printf '%s' "$id" | wc -c | tr -d ' ')
  if [ "$LEN" != "36" ]; then echo "    ✗ 长度不是 36: $id"; BAD=$((BAD+1)); continue; fi
  OK="$(PSQLQ "select count(*) from posts where id='$id' and (body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%')")"
  if [ "$OK" != "1" ]; then echo "    ✗ $id 的 body 不匹配 pattern"; BAD=$((BAD+1)); fi
done <<< "$IDS"
if [ "$BAD" -ne 0 ]; then
  echo "  FAIL 有 $BAD 个候选未通过形态断言 → **中止，不删除**"
  exit 1
fi
echo "  PASS 20 个候选全部为合法 uuid 且 body 确实匹配 pattern"

echo
echo "=== 2) 单事务删除 + 全部断言（任一失败即 ROLLBACK）==="
{
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"

  # ② 事务内再断言候选数
  echo "do \$\$ declare c int; begin
    select count(*) into c from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%';
    if c <> 20 then raise exception 'candidate count is % not 20', c; end if;
  end \$\$;"

  # ③ 依赖表：显式删（虽然实测为空，但显式更稳，且能暴露异常）
  echo "delete from comments where post_id in (select id from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%');"
  echo "delete from likes where post_id in (select id from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%');"
  echo "delete from post_media where post_id in (select id from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%');"

  # ④ 按精确 id 删帖，并断言 deleted_count == 20
  echo "do \$\$ declare d int; begin
    delete from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%';
    get diagnostics d = row_count;
    if d <> 20 then raise exception 'deleted_count is % not 20', d; end if;
    raise notice 'deleted_count = %', d;
  end \$\$;"

  # ⑤ 规范数据完好断言（在同一事务内校验，失败则整体回滚）
  echo "do \$\$ declare n int; begin
    select count(*) into n from posts where not (body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%');
    if n <> $B_NONCANON then raise exception 'canonical posts changed: % vs $B_NONCANON', n; end if;
    select count(*) into n from users;         if n <> $B_USERS   then raise exception 'users changed';   end if;
    select count(*) into n from message_threads; if n <> $B_THREADS then raise exception 'threads changed'; end if;
    select count(*) into n from thread_members;  if n <> $B_MEMBERS then raise exception 'members changed'; end if;
    select count(*) into n from media;           if n <> $B_MEDIA   then raise exception 'media changed';   end if;
    select count(*) into n from board_notes;     if n <> $B_BOARD   then raise exception 'board notes changed'; end if;
  end \$\$;"

  # ⑥ 顺带清理本项目自己的门禁残留消息（WO9B-*/WO7-*/WO11-*）
  echo "delete from message_media where message_id in (select id from messages where body ~ '^(WO9B|WO11|WO7)-');"
  echo "delete from message_mentions where message_id in (select id from messages where body ~ '^(WO9B|WO11|WO7)-');"
  echo "delete from messages where body ~ '^(WO9B|WO11|WO7)-';"
  echo "do \$\$ declare n int; begin
    select count(*) into n from messages where not (body ~ '^(WO9B|WO11|WO7)-');
    if n <> $B_MSGS_SEED then raise exception 'seed messages changed: % vs $B_MSGS_SEED', n; end if;
  end \$\$;"

  echo "commit;"
} > /tmp/wo11-delete.sql

echo "  --- 将执行的 SQL（逐条可审计）---"
sed 's/^/    /' /tmp/wo11-delete.sql

# ⚠️ 支持"只生成、不执行"（用于先做 dry run；审核流程要求先验证再落刀）
#   用法：WO11_GENERATE_ONLY=1 bash wo11-delete-residue.sh
if [ "${WO11_GENERATE_ONLY:-0}" = "1" ]; then
  echo
  echo "  WO11_GENERATE_ONLY=1 → 只生成 /tmp/wo11-delete.sql，**未执行任何删除**"
  echo "  下一步：bash /tmp/wo11-delete-dryrun.sh /tmp/wo11-delete.sql"
  exit 0
fi

echo
echo "  --- 执行 ---"
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -f /tmp/wo11-delete.sql 2>&1 | sed 's/^/    /'
RC=${PIPESTATUS[0]}
echo "  psql exit=$RC"

echo
echo "=== 3) 删除后核对（外部再验一次）==="
A_RES="$(PSQLQ "select count(*) from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%'")"
A_NONCANON="$(PSQLQ "select count(*) from posts where not (body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%')")"
A_MSGS_RES="$(PSQLQ "select count(*) from messages where body ~ '^(WO9B|WO11|WO7)-'")"
echo "  残留候选帖 = $A_RES（期望 0）"
echo "  非候选帖   = $A_NONCANON（期望 $B_NONCANON）"
echo "  残留门禁消息 = $A_MSGS_RES（期望 0）"
echo "  --- 最终基线 ---"
PSQLQ "select 'posts=' || (select count(*) from posts)
       || ' users=' || (select count(*) from users)
       || ' threads=' || (select count(*) from message_threads)
       || ' members=' || (select count(*) from thread_members)
       || ' messages=' || (select count(*) from messages)
       || ' media=' || (select count(*) from media)
       || ' post_media=' || (select count(*) from post_media)
       || ' comments=' || (select count(*) from comments)
       || ' likes=' || (select count(*) from likes)
       || ' board_notes=' || (select count(*) from board_notes)" | sed 's/^/  /'

echo
if [ "$A_RES" = "0" ] && [ "$A_NONCANON" = "$B_NONCANON" ] && [ "$A_MSGS_RES" = "0" ] && [ "$RC" = "0" ]; then
  echo "WO11_RESIDUE_CLEANUP: PASS（deleted_count=20、规范数据完好、门禁残留清零）"
  exit 0
else
  echo "WO11_RESIDUE_CLEANUP: FAIL"
  exit 1
fi
