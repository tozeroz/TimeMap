#!/usr/bin/env bash
# 清理所有 Gate 产生的测试消息（按 body 前缀精确匹配，不用范围删除）
#
# 为什么要有它：多个 Gate（WO#7 / WO#9A / WO#9B 层 A、层 B）都会往库里写测试消息，
#   跑完必须清干净，否则基线漂移、后续 Gate 的"残留为 0"断言会误报。
#   把这些清理集中到一个脚本里，避免每次在命令行里手写 SQL（那种写法已被
#   嵌套引号坑过多次，且容易漏掉 message_media / message_mentions 两张关联表）。
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 清理前列出所有 WO* 前缀测试消息 ==="
PSQL "select id || ' | ' || left(body,40) from messages where body ~ '^WO[0-9A-Z]*-' order by created_at"
N="$(PSQL "select count(*) from messages where body ~ '^WO[0-9A-Z]*-'")"
echo "  待删条数: $N"

if [ "$N" != "0" ]; then
  # 关联表先删（message_media / message_mentions 都有 FK ON DELETE CASCADE，
  # 但显式删一遍更稳，且能顺带发现"本该为空却不为空"的异常）
  PSQL "delete from message_media where message_id in (select id from messages where body ~ '^WO[0-9A-Z]*-')" >/dev/null
  PSQL "delete from message_mentions where message_id in (select id from messages where body ~ '^WO[0-9A-Z]*-')" >/dev/null
  PSQL "delete from messages where body ~ '^WO[0-9A-Z]*-'" >/dev/null
  echo "  已删除"
fi

echo
echo "=== 清理后基线（应与种子口径一致）==="
PSQL "select 'users=' || (select count(*) from users)
      || ' threads=' || (select count(*) from message_threads)
      || ' members=' || (select count(*) from thread_members)
      || ' messages=' || (select count(*) from messages)
      || ' media=' || (select count(*) from media)
      || ' message_media=' || (select count(*) from message_media)
      || ' message_mentions=' || (select count(*) from message_mentions)
      || ' board_notes=' || (select count(*) from board_notes)"
echo "  期望：users=3 threads=3 members=5 messages=5 media=3 message_media=1 message_mentions=0 board_notes=1"
REM="$(PSQL "select count(*) from messages where body ~ '^WO[0-9A-Z]*-'")"
echo "  剩余 WO* 残留: $REM"
