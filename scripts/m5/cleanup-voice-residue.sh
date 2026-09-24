#!/usr/bin/env bash
# 清理 WO#5 语音 E2E 的测试残留：删掉本会话里所有 kind='voice' 的消息 + 其 media + 盘上文件
# 默认 dry-run；加 --apply 真删。
# ⚠ 只针对**我们自己的 demo**（服务器是我们的）；不涉及原版 app。
set -u
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
THREAD='66666666-cccc-4ccc-8ccc-000000000003'

PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
UP=/srv/campus/uploads

echo "=== 模式：$([ $APPLY -eq 1 ] && echo 'APPLY（真删）' || echo 'DRY-RUN（只打印）') ==="
echo
echo "--- 待删消息（本会话 kind='voice'）---"
PSQL "select id || ' | ' || kind || ' | ' || to_char(created_at,'HH24:MI:SS') || ' | ' || left(body,10) from messages where thread_id='$THREAD' and kind='voice' order by created_at"
NMSG=$(PSQL "select count(*) from messages where thread_id='$THREAD' and kind='voice'")
echo "  消息数: $NMSG"

echo
echo "--- 关联的 media（只删**不被其它消息引用**的，避免误伤）---"
PSQL "select md.id || ' | ' || md.mime || ' | ' || coalesce(md.duration_ms::text,'null') || 'ms | ' || md.storage_key
        from media md
       where md.id in (select mm.media_id from message_media mm
                        join messages m on m.id = mm.message_id
                       where m.thread_id='$THREAD' and m.kind='voice')
         and not exists (select 1 from message_media mm2
                          join messages m2 on m2.id = mm2.message_id
                         where mm2.media_id = md.id and m2.kind <> 'voice')"
NMEDIA=$(PSQL "select count(*) from media md
       where md.id in (select mm.media_id from message_media mm
                        join messages m on m.id = mm.message_id
                       where m.thread_id='$THREAD' and m.kind='voice')
         and not exists (select 1 from message_media mm2
                          join messages m2 on m2.id = mm2.message_id
                         where mm2.media_id = md.id and m2.kind <> 'voice')")
echo "  media 数: $NMEDIA"

echo
echo "--- 盘上文件 ---"
PSQL "select md.scope || '/' || md.storage_key from media md
       where md.id in (select mm.media_id from message_media mm
                        join messages m on m.id = mm.message_id
                       where m.thread_id='$THREAD' and m.kind='voice')" | while IFS= read -r rel; do
  [ -n "$rel" ] && echo "  $UP/$rel $([ -f "$UP/$rel" ] && echo '(存在)' || echo '(缺失)')"
done

echo
echo "--- 保护性断言：种子数据与其它消息必须不受影响 ---"
echo -n "  种子用户数(应3): "; PSQL "select count(*) from users where phone_e164 in ('+8613800000001','+8613800000002','+8613800000003')"
echo -n "  该会话非 voice 消息数(应保持): "; PSQL "select count(*) from messages where thread_id='$THREAD' and kind<>'voice'"
echo -n "  全库 messages 总数: "; PSQL "select count(*) from messages"

if [ $APPLY -eq 0 ]; then
  echo
  echo "DRY-RUN 结束（未改动）。确认无误后：bash $0 --apply"
  exit 0
fi

echo
echo "=== 执行清理 ==="
# 先取文件路径（删行之后就查不到了）
FILES=$(PSQL "select md.scope || '/' || md.storage_key from media md
       where md.id in (select mm.media_id from message_media mm
                        join messages m on m.id = mm.message_id
                       where m.thread_id='$THREAD' and m.kind='voice')")

PSQL "delete from message_media where message_id in (select id from messages where thread_id='$THREAD' and kind='voice')" >/dev/null && echo "  ok message_media"
PSQL "delete from messages where thread_id='$THREAD' and kind='voice'" >/dev/null && echo "  ok messages"
PSQL "delete from media md
       where md.id not in (select media_id from message_media)
         and md.mime = 'audio/webm'" >/dev/null && echo "  ok media（仅 audio/webm 且已无引用）"

printf '%s\n' "$FILES" | while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  if [ -f "$UP/$rel" ]; then /bin/rm -f "$UP/$rel"; echo "  已删文件: $UP/$rel"; fi
done

echo
echo "=== 清理后校验 ==="
echo -n "  users: "; PSQL "select count(*) from users"
echo -n "  messages: "; PSQL "select count(*) from messages"
echo -n "  media: "; PSQL "select count(*) from media"
echo -n "  message_media: "; PSQL "select count(*) from message_media"
echo -n "  board_notes: "; PSQL "select count(*) from board_notes"
echo -n "  该会话消息数: "; PSQL "select count(*) from messages where thread_id='$THREAD'"
cd /srv/campus/server && UPLOAD_ROOT=$UP DATABASE_URL="postgres://campus:$PW@127.0.0.1/campus" node dist/cleanup.mjs --json 2>&1 | head -c 320
echo
