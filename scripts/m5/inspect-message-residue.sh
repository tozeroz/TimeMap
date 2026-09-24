#!/usr/bin/env bash
# 只读：查看当前消息测试残留的形态与来源（不删除）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
P() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== messages 总数与残留 ==="
P "select 'messages_total=' || count(*)::text from messages"
P "select 'WO_prefix_residue=' || count(*)::text from messages where body ~ '^WO[0-9A-Z]*-'"

echo
echo "=== 残留逐条（时间 / 会话 / 正文前 40 字）==="
P "select to_char(created_at,'HH24:MI:SS') || ' | thread=' || left(thread_id::text,8)
   || ' | ' || left(coalesce(body,'<null>'),40)
   from messages where body ~ '^WO[0-9A-Z]*-' order by created_at"

echo
echo "=== 全部消息（对照用）==="
P "select to_char(created_at,'HH24:MI:SS') || ' | ' || left(coalesce(body,'<null>'),45)
   from messages order by created_at"

echo
echo "=== 是否有 media 关联到这些残留消息 ==="
P "select 'residue_with_media=' || count(*)::text
   from message_media mm join messages m on m.id = mm.message_id
   where m.body ~ '^WO[0-9A-Z]*-'"
