#!/usr/bin/env bash
# 清理 WO#7 门禁产生的测试消息（按 body 前缀精确匹配，不用范围删除）
set -u
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 清理前：列出 WO7-% 消息 ==="
PSQL "select id || ' | ' || left(body,40) from messages where body like 'WO7-%'"
N="$(PSQL "select count(*) from messages where body like 'WO7-%'")"
echo "  待删条数: $N"

if [ "$N" != "0" ]; then
  # 同时清掉可能挂上的 message_media（本应没有，但保险）
  PSQL "delete from message_media where message_id in (select id from messages where body like 'WO7-%')" >/dev/null
  PSQL "delete from messages where body like 'WO7-%'" >/dev/null
  echo "  已删除"
fi

echo
echo "=== 清理后基线 ==="
PSQL "select 'messages=' || (select count(*) from messages) || ' media=' || (select count(*) from media) || ' message_media=' || (select count(*) from message_media) || ' board_notes=' || (select count(*) from board_notes) || ' users=' || (select count(*) from users)"
# ⚠️ 期望值必须随**种子口径**更新，否则这条 INFO 会长期误导：
#   WO#9A 起种子新增了群会话（1 个群 + 2 名成员 + 3 条消息 + 1 个私聊 media + 1 条 message_media），
#   因此当前口径是 messages=5 media=3 message_media=1 board_notes=1 users=3。
#   （更早的口径 messages=2 media=2 message_media=0 已过期 —— 本条注释即为更正记录。）
echo "  （当前种子口径期望：messages=5 media=3 message_media=1 board_notes=1 users=3）"
