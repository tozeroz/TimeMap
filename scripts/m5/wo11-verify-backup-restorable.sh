#!/usr/bin/env bash
# WO#11 第 4 步补强：用 postgres 超级用户**实际还原**验证备份（最强的 "verified"）
# 只读原库；在临时库里还原，验证后立刻删除临时库。
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
LATEST="$(ls -1t /srv/campus/backups/wo11-full-*.dump 2>/dev/null | head -1)"
if [ -z "$LATEST" ]; then echo "FATAL 找不到全量备份"; exit 1; fi
echo "  使用备份: $LATEST"
echo "  sha256: $(sha256sum "$LATEST" | cut -d' ' -f1)"
echo ""

TMPDB="wo11_restore_verify"
echo "=== 1) 用 postgres 超级用户建临时库 ==="
sudo -u postgres psql -Atc "drop database if exists $TMPDB" >/dev/null 2>&1
sudo -u postgres psql -Atc "create database $TMPDB owner campus" 2>&1 | sed 's/^/  /'
echo "  已建库 $TMPDB（owner=campus）"

echo
echo "=== 2) 在该库里实际还原备份 ==="
PGPASSWORD="$PW" pg_restore -h 127.0.0.1 -U campus -d "$TMPDB" "$LATEST" > /tmp/wo11-restore-verify.txt 2>&1
RC=$?
echo "  pg_restore exit=$RC"
if [ "$RC" -ne 0 ]; then
  echo "  --- 还原输出（前 15 行）---"
  head -15 /tmp/wo11-restore-verify.txt | sed 's/^/    /'
fi

echo
echo "=== 3) 在还原库里核对数据（与云端原库逐一对照）==="
Q() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc "$1" 2>&1; }
QO() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
for tbl in posts comments likes post_media users message_threads thread_members messages media board_notes; do
  A="$(Q "select count(*) from $tbl")"
  B="$(QO "select count(*) from $tbl")"
  if [ "$A" = "$B" ]; then
    echo "    ✓ $tbl: 还原库=$A 原库=$B"
  else
    echo "    ✗ $tbl: 还原库=$A ≠ 原库=$B  ← **备份与原库不一致**"
  fi
done

echo
echo "=== 4) 候选帖子 id 是否都能在还原库里查到（逐个 20 个）==="
MISS=0
for id in $(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc \
  "select id::text from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%'"); do
  H="$(Q "select count(*) from posts where id='$id'")"
  if [ "$H" != "1" ]; then echo "    ✗ 缺 $id"; MISS=$((MISS+1)); fi
done
if [ "$MISS" -eq 0 ]; then echo "    ✓ 20 个候选**全部**可从备份还原（可逐条回滚）"; else echo "    ✗ 有 $MISS 个不在备份里"; fi

echo
echo "=== 5) 清理临时库 ==="
sudo -u postgres psql -Atc "drop database $TMPDB" 2>&1 | sed 's/^/  /'
sudo -u postgres psql -Atc "select datname from pg_database where datname='$TMPDB'" | sed 's/^/  剩余同名库: /'
echo ""
echo "  （原库未被本脚本改动——本脚本只读原库、只写临时库）"
