#!/usr/bin/env bash
# 只读：列出清理所需的真实列名与级联关系（避免再凭假设写 SQL）
set -u
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

for T in sessions login_challenges messages media board_notes message_media message_threads thread_members; do
  echo "=== $T ==="
  PSQL "select column_name || ' : ' || data_type from information_schema.columns where table_name='$T' order by ordinal_position" | sed 's/^/  /'
  echo
done

echo "=== 外键（谁引用谁）==="
PSQL "select tc.table_name || '.' || kcu.column_name || ' -> ' || ccu.table_name || '.' || ccu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type='FOREIGN KEY'
      and tc.table_name in ('sessions','login_challenges','messages','media','board_notes','message_media','thread_members')
      order by 1" | sed 's/^/  /'
