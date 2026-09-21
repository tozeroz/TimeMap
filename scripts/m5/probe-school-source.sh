#!/usr/bin/env bash
# WO#10 inventory 续：school_campus_id 指向什么？现有接口暴露了什么？（只读）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) users.school_campus_id 的外键指向哪张表 ==="
PSQL "select conname || ' → ' || pg_get_constraintdef(oid) from pg_constraint
        where conrelid='users'::regclass and contype='f'"

echo
echo "=== 2) 被引用的表里有什么（学校/校区）==="
for t in campuses schools campus; do
  EXISTS="$(PSQL "select count(*) from information_schema.tables where table_schema='public' and table_name='$t'")"
  if [ "$EXISTS" = "1" ]; then
    echo "  --- 表 $t 的列 ---"
    PSQL "select column_name || ' | ' || data_type from information_schema.columns where table_name='$t' order by ordinal_position"
    echo "  --- 表 $t 的数据 ---"
    PSQL "select * from $t limit 10"
  fi
done

echo
echo "=== 3) 三个种子用户的 school_campus_id 实际值 ==="
PSQL "select display_name || ' → ' || coalesce(school_campus_id::text,'<NULL>') from users order by phone_e164"

echo
echo "=== 4) 全部 public 表清单（找可能的资料/推荐来源）==="
PSQL "select table_name from information_schema.tables where table_schema='public' order by table_name"
