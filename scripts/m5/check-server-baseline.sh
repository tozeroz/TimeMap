#!/usr/bin/env bash
# 核对服务器 DB 当前基线（只读）
# 用途：每次跑完 Gate 后确认"测试残留已清、种子口径未漂移"
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 种子口径（WO#9A 起）==="
PSQL "select 'users=' || (select count(*) from users)
      || ' message_threads=' || (select count(*) from message_threads)
      || ' thread_members=' || (select count(*) from thread_members)
      || ' messages=' || (select count(*) from messages)
      || ' media=' || (select count(*) from media)
      || ' message_media=' || (select count(*) from message_media)
      || ' message_mentions=' || (select count(*) from message_mentions)
      || ' board_notes=' || (select count(*) from board_notes)"
echo "  期望：users=3 message_threads=3 thread_members=5 messages=5 media=3 message_media=1 message_mentions=0 board_notes=1"

echo
echo "=== WO#9B 新增列 / 标记分布 ==="
PSQL "select 'mentions_all=true 的消息数 = ' || count(*)::text from messages where mentions_all"
PSQL "select '列是否存在 = ' || count(*)::text from information_schema.columns where table_name='messages' and column_name='mentions_all'"

echo
echo "=== 测试残留检查（任何 WO*- 前缀都应为 0）==="
PSQL "select 'WO%- 残留消息 = ' || count(*)::text from messages where body ~ '^WO[0-9A-Z]*-'"

echo
echo "=== 迁移状态 ==="
PSQL "select '已应用迁移 = ' || count(*)::text || ' ／ 最新 = ' || max(version) from schema_migrations"
