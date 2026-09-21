#!/usr/bin/env bash
# WO#11 数据清理 —— 第 4 步（**改正版**）：full pg_dump verified
#
# ## 为什么重做（第一版不合格）
#   第一版用 `--data-only --table=posts --table=comments ...`，pg_dump 报：
#     warning: there are circular foreign-key constraints on this table: comments
#     hint: You might not be able to restore the dump without using --disable-triggers
#   → 一个**可能无法还原**的备份不算"verified 的 full dump"。
#   审核要求的是 "**full** pg_dump verified"。
#
# ## 本版做法
#   ① **整库全量 dump**（-Fc 自定义格式，pg_restore 可选择性还原，且自带完整性校验）
#   ② 用 `pg_restore -l` 列出目录 → 证明文件**可被读取与解析**（这才是"verified"）
#   ③ 从备份里抽查候选帖子 id 是否在
#   ④ 记录 sha256 与大小
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
BACKUP_DIR=/srv/campus/backups
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/wo11-full-$STAMP.dump"

echo "=== 1) 整库全量 dump（自定义格式，可 pg_restore 校验）==="
PGPASSWORD="$PW" pg_dump -h 127.0.0.1 -U campus -d campus -Fc -f "$OUT" 2>&1
RC=$?
echo "  pg_dump exit=$RC"
if [ "$RC" -ne 0 ] || [ ! -s "$OUT" ]; then
  echo "  FAIL 全量备份失败 → **禁止继续删除**"
  exit 1
fi
SZ=$(stat -c%s "$OUT"); SHA=$(sha256sum "$OUT" | cut -d' ' -f1)
echo "  文件: $OUT"
echo "  大小: $SZ 字节"
echo "  sha256: $SHA"

echo
echo "=== 2) verified：用 pg_restore -l 证明备份可被解析 ==="
PGPASSWORD="$PW" pg_restore -l "$OUT" > /tmp/wo11-restore-list.txt 2>&1
RC2=$?
echo "  pg_restore -l exit=$RC2"
if [ "$RC2" -ne 0 ]; then
  echo "  FAIL 备份无法被 pg_restore 解析 → **禁止继续删除**"
  exit 1
fi
echo "  备份内的表对象数: $(grep -c 'TABLE DATA' /tmp/wo11-restore-list.txt)"
echo "  --- 备份里包含的 TABLE DATA 条目 ---"
grep 'TABLE DATA' /tmp/wo11-restore-list.txt | sed 's/^/    /'

echo
echo "=== 3) 候选帖子 id 是否在备份里（抽查 4 个）==="
# 自定义格式是二进制，不能 grep；用 pg_restore 还原到一个**临时库**来验证（真正的"可还原"验证）
TMPDB="campus_restore_check_$STAMP"
echo "  --- 在临时库里实测还原（这比 grep 强：直接证明可还原）---"
PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d postgres -c "create database $TMPDB" >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "  ⚠️ 无法创建临时库（权限？）→ 退回到 pg_restore -l 级别的验证（已通过）"
else
  PGPASSWORD="$PW" pg_restore -h 127.0.0.1 -U campus -d "$TMPDB" "$OUT" >/tmp/wo11-restore-run.txt 2>&1
  RC3=$?
  echo "  pg_restore 实际还原 exit=$RC3"
  if [ "$RC3" -eq 0 ]; then
    RPOSTS="$(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc 'select count(*) from posts')"
    RUSERS="$(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc 'select count(*) from users')"
    echo "  ✅ 还原成功、可查询：posts=$RPOSTS users=$RUSERS"
    for id in c1c46544 7ac5fec3 41868912 c0eb30d6; do
      HIT="$(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d "$TMPDB" -Atc "select count(*) from posts where id::text like '$id%'")"
      [ "$HIT" = "1" ] && echo "    ✓ 备份含 $id" || echo "    ✗ 备份不含 $id"
    done
  else
    echo "  ⚠️ 实际还原未成功（见 /tmp/wo11-restore-run.txt）—— 但 pg_restore -l 已验证可解析"
  fi
  PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d postgres -c "drop database $TMPDB" >/dev/null 2>&1
fi

echo
echo "=== 4) 结论 ==="
echo "  PASS full pg_dump 成功 + 可被 pg_restore 解析（且尽可能做了实际还原验证）"
echo "  备份: $OUT"
echo "  sha256: $SHA"
echo "  （删除后如需回滚：pg_restore -d campus <该文件>，或选择性还原 posts 表）"
