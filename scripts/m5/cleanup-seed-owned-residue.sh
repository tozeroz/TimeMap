#!/usr/bin/env bash
# 清理 B 类残留：**种子用户 Lemy 名下、但由我们测试产生的**消息与 media。
#
# 为什么单独一个脚本、且必须用**白名单**：
#   A 类（测试账号拥有）可以按"created_at >= 09-21 且手机号非种子"过滤；
#   但 B 类的拥有者是**种子用户 Lemy**，按 owner 过滤会**连种子图一起删**
#   （bbbbbbbb-0001/0002 是 09-01 的真实基线数据）。
#   → 因此这里按**精确 id 白名单**删，不用任何基于 owner/时间的过滤。
#
# 白名单来自只读盘点（scripts/m5/list-nonseed-residue.sh，2026-09-21 19:28）：
#   消息 66666666-dddd-4ddd-8ddd-000000000004  kind=image  sender=Lemy  09-21 15:23  [图片]
#   消息 eb4476f4-de27-47d0-bad3-32ae43738b84  kind=image  sender=Lemy  09-21 18:38  [图片]
#   媒体 f31bfcfb-82b7-403d-b835-399db1babb68  private     owner=Lemy   09-21 18:38  96x64 930B
#   引用 eb4476f4… → f31bfcfb…
#
# ⚠️ 注意：66666666-dddd…0004 这条是 **kind=image 但没有任何 media 引用** 的消息
#    （本轮只作为现象记录，不下"它由哪条缺陷路径产生"的结论）。
#    删它属于"清测试残留"，不是"修缺陷"。
#
# 用法：
#   bash cleanup-seed-owned-residue.sh            # dry-run
#   bash cleanup-seed-owned-residue.sh --apply    # 真删
set -u
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
UP=/srv/campus/uploads

MSG_IDS="'66666666-dddd-4ddd-8ddd-000000000004','eb4476f4-de27-47d0-bad3-32ae43738b84'"
MEDIA_IDS="'f31bfcfb-82b7-403d-b835-399db1babb68'"

# 安全阀：白名单里必须**恰好**是预期的条数，否则说明盘点已过期，停止
N_MSG=$(PSQL "select count(*) from messages where id in ($MSG_IDS)")
N_MEDIA=$(PSQL "select count(*) from media where id in ($MEDIA_IDS)")

echo "=== 模式：$([ $APPLY -eq 1 ] && echo 'APPLY（真删）' || echo 'DRY-RUN（只打印）') ==="
echo "  白名单命中：messages=$N_MSG（预期 2）  media=$N_MEDIA（预期 1）"
if [ "$N_MSG" != "2" ] || [ "$N_MEDIA" != "1" ]; then
  echo "  ⚠ 白名单命中数与预期不符 —— 盘点可能已过期（例如已被清过），停止以免误删。"
  exit 2
fi

echo
echo "=== 将要删除的对象（打印明细供人工确认）==="
PSQL "select m.id || ' | kind=' || m.kind || ' | ' || to_char(m.created_at,'MM-DD HH24:MI') || ' | ' || left(coalesce(m.body,''),10) from messages m where m.id in ($MSG_IDS)" | sed 's/^/    msg: /'
PSQL "select md.id || ' | ' || md.scope || ' | ' || md.width || 'x' || md.height || ' | ' || md.storage_key from media md where md.id in ($MEDIA_IDS)" | sed 's/^/  media: /'
echo -n "   引用行: "; PSQL "select count(*) from message_media where message_id in ($MSG_IDS) or media_id in ($MEDIA_IDS)"
FILES=$(PSQL "select scope || '/' || storage_key from media where id in ($MEDIA_IDS)")
echo "   盘上文件:"; [ -n "$FILES" ] && printf '%s\n' "$FILES" | sed 's/^/      /' || echo "      （无）"

echo
echo "=== 保护性断言：种子数据必须仍在（防误删）==="
SEED_MSG=$(PSQL "select count(*) from messages where id in ('ffffffff-0005-4005-8005-000000000005','ffffffff-0004-4004-8004-000000000004')")
SEED_MEDIA=$(PSQL "select count(*) from media where id in ('bbbbbbbb-0002-4002-8002-000000000002','bbbbbbbb-0001-4001-8001-000000000001')")
SEED_USERS=$(PSQL "select count(*) from users where phone_e164 in ('+8613800000001','+8613800000002','+8613800000003')")
echo "  种子消息=$SEED_MSG（应 2） 种子图=$SEED_MEDIA（应 2） 种子用户=$SEED_USERS（应 3）"
if [ "$SEED_MSG" != "2" ] || [ "$SEED_MEDIA" != "2" ] || [ "$SEED_USERS" != "3" ]; then
  echo "  ⚠ 种子数据不完整 —— 停止，先查清库状态。"; exit 3
fi

if [ $APPLY -eq 0 ]; then
  echo
  echo "DRY-RUN 结束（未改动任何数据）。确认无误后：bash $0 --apply"
  exit 0
fi

echo
echo "=== 执行清理（顺序：引用 → 消息 → media 行 → 盘上文件）==="
PSQL "delete from message_media where message_id in ($MSG_IDS) or media_id in ($MEDIA_IDS)" >/dev/null && echo "  ok message_media"
PSQL "delete from messages where id in ($MSG_IDS)" >/dev/null && echo "  ok messages"
PSQL "delete from media where id in ($MEDIA_IDS)" >/dev/null && echo "  ok media"
while IFS= read -r REL; do
  [ -n "$REL" ] || continue
  P="$UP/$REL"
  if [ -f "$P" ]; then /bin/rm -f "$P"; echo "  已删文件: $P"; fi
done <<< "$FILES"

echo
echo "=== 校验（应回到纯种子基线）==="
echo "  users=$(PSQL 'select count(*) from users')（应 3）"
echo "  messages=$(PSQL 'select count(*) from messages')（应 2）"
echo "  media=$(PSQL 'select count(*) from media')（应 2）"
echo "  board_notes=$(PSQL 'select count(*) from board_notes')（应 1）"
echo "  message_media=$(PSQL 'select count(*) from message_media')（应 0）"
cd /srv/campus/server || exit 1
echo -n "  盘库一致性: "
UPLOAD_ROOT=$UP DATABASE_URL="postgres://campus:$(cat /srv/campus/.db_password)@127.0.0.1/campus" \
  node dist/cleanup.mjs --json 2>&1 | head -c 320
echo
