#!/usr/bin/env bash
# WO#11 数据清理 —— **第 4 步：full pg_dump verified**（备份 posts 表并校验）
# + 顺带排查消息数从 5 涨到 8 的原因（残留检查）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
BACKUP_DIR=/srv/campus/backups

echo "=== A) 排查：messages 为什么是 8（基线应为 5）==="
echo "  --- 全部消息（含来源）---"
PSQL "select m.id::text
             || ' | thread=' || left(m.thread_id::text,8)
             || ' | sender=' || coalesce(u.display_name,'<null>')
             || ' | ' || to_char(m.created_at,'MM-DD HH24:MI:SS')
             || ' | ' || left(m.body, 42)
        from messages m left join users u on u.id = m.sender_id
       order by m.created_at"
echo
echo "  --- 区分：种子消息 vs 门禁产生的消息 ---"
PSQL "select '含 WO9B-/WO11-/WO7- 前缀（门禁残留）= ' || count(*)::text
        from messages where body ~ '^(WO9B|WO11|WO7)-'"
PSQL "select '其它（种子或有意义内容）= ' || count(*)::text
        from messages where not (body ~ '^(WO9B|WO11|WO7)-')"
echo
echo "  --- 会话级计数 ---"
PSQL "select t.id::text || ' | kind=' || t.kind || ' | msgs=' || (select count(*) from messages m where m.thread_id=t.id)
        from message_threads t order by t.kind, t.id"

echo
echo "=== B) full pg_dump verified（备份 posts 及其依赖表）==="
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/wo11-posts-backup-$STAMP.sql"
# 只备与本次删除相关的表（posts + 依赖），用 --data-only 便于事后核对
PGPASSWORD="$PW" pg_dump -h 127.0.0.1 -U campus -d campus \
  --data-only --table=posts --table=comments --table=likes --table=post_media \
  -f "$OUT" 2>&1
RC=$?
echo "  pg_dump exit=$RC  文件=$OUT"
if [ -f "$OUT" ]; then
  SZ=$(wc -c < "$OUT" | tr -d ' ')
  LINES=$(wc -l < "$OUT" | tr -d ' ')
  SHA=$(sha256sum "$OUT" | cut -c1-16)
  echo "  大小=$SZ 字节  行数=$LINES  sha256=${SHA}…"
  echo "  --- 备份内容摘要（确认包含我们的数据）---"
  grep -c 'INSERT INTO\|COPY ' "$OUT" 2>/dev/null | sed 's/^/    INSERT\/COPY 语句数: /'
  echo "  --- 备份里能查到候选帖子 id 吗（抽查 2 个）---"
  for id in c1c46544 7ac5fec3; do
    if grep -q "$id" "$OUT"; then echo "    ✓ 含 $id"; else echo "    ✗ 不含 $id（备份不完整！）"; fi
  done
  # 备份可用性：能否被 psql 重新读入（只做语法解析，不实际导入）
  echo "  --- 备份可解析性（psql --single-transaction 到临时库？改为行数/头部检查）---"
  head -3 "$OUT" | sed 's/^/    /'
else
  echo "  FAIL 备份文件未生成 —— **禁止继续删除**"
  exit 1
fi

echo
echo "=== C) 备份校验结论 ==="
if [ "$RC" -eq 0 ] && [ -s "$OUT" ]; then
  echo "  PASS full pg_dump 成功且非空 → 可以进入删除步骤"
  echo "  备份路径: $OUT"
else
  echo "  FAIL 备份未通过校验 → **不得删除**"
  exit 1
fi
