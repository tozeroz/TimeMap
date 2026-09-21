#!/usr/bin/env bash
# WO#7 的 **DB oracle**：核验刚发出的那条文字消息在数据库里的真实形态
# （审核记录 42：身份 oracle 用 /api/auth/me + DB，**不要用 CSS/class 自证**）
#
# 核验点：
#   · 该 message 存在且 kind = 'text'
#   · body **逐字等于**设备侧发的内容
#   · sender_id = 该会话的当前登录用户（用 phone 反查，再与会话里的 sender 比对）
#   · **message_media 无对应行**（纯文本消息不该挂媒体）
#   · 该消息属于目标 thread
set -u
MSG_ID="${1:?用法: verify-wo7-db-oracle.sh <messageId> <expectedBody>}"
EXPECT_BODY="${2:?缺少 expectedBody}"
THREAD='66666666-cccc-4ccc-8ccc-000000000003'

PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== WO#7 DB oracle ==="
echo "  目标 messageId: $MSG_ID"
echo "  期望 body     : ${EXPECT_BODY:0:60}…"
echo

echo "--- 1) 行存在且 kind / body / thread 正确 ---"
PSQL "select 'kind=' || kind || ' | thread_ok=' || (thread_id = '$THREAD')::text || ' | body_match=' || (body = '$EXPECT_BODY')::text || ' | revoked=' || (deleted_at is not null)::text
        from messages where id = '$MSG_ID'"
echo

echo "--- 2) sender 身份（应与会话内的当前用户一致，且不是 NULL）---"
PSQL "select 'sender_id=' || coalesce(m.sender_id::text,'NULL') || ' | sender_phone=' || coalesce(u.phone_e164,'?') || ' | sender_name=' || coalesce(u.display_name,'?')
        from messages m left join users u on u.id = m.sender_id
       where m.id = '$MSG_ID'"
echo

echo "--- 3) message_media **必须无行**（纯文本不挂媒体）---"
N="$(PSQL "select count(*) from message_media where message_id = '$MSG_ID'")"
if [ "$N" = "0" ]; then echo "  PASS message_media 行数 = 0"; else echo "  FAIL message_media 行数 = $N（不该有）"; fi
echo

echo "--- 4) 该文本在**读模型**里的形态（媒体引用应为空数组）---"
PSQL "select 'media_json=' || coalesce((
          select json_agg(json_build_object('id',md.id,'mime',md.mime,'durationMs',md.duration_ms))
            from message_media mm join media md on md.id = mm.media_id where mm.message_id = '$MSG_ID'
        )::text, '[]')
        from messages where id = '$MSG_ID'"
echo

echo "--- 5) 基线未被打乱（应仍为 messages=2 种子 + 本轮测试消息）---"
PSQL "select 'messages=' || (select count(*) from messages) || ' media=' || (select count(*) from media) || ' board_notes=' || (select count(*) from board_notes) || ' users=' || (select count(*) from users)"
echo

echo "--- 6) 列出本轮新增的 text 消息（便于清理）---"
PSQL "select id || ' | ' || kind || ' | ' || left(body,40) || ' | ' || to_char(created_at,'HH24:MI:SS') from messages where body like 'WO7-%' order by created_at"
