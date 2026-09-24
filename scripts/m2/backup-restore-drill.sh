#!/usr/bin/env bash
# M2.6 备份恢复演练（审核记录 05 第六节要求加强版）
#
# 判据是**四项逐一相等**，而不是"dump 成功就算备份成功"：
#   1. schema_migrations 版本集合
#   2. 每张业务表的行数
#   3. 主键集合哈希
#   4. **行内容哈希**  ← 关键补充
#
# 为什么必须有第 4 项：只比行数与主键集合时，
#   原库 id=1 body=ABC，恢复到 id=1 body=XYZ，前三项全都相等，
#   演练会"通过"而数据其实已经错了。
#
# 另外：恢复目标是**全新空库**，不用"删表重建"冒充恢复 ——
# 后者复用的是同一份运行中的 schema，证明不了 dump 本身可用。
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

SRC=campus
DST=campus_restore
BACKUP_DIR=/srv/campus/backups
DUMP="$BACKUP_DIR/m2-drill.dump"
# pg_dump 以 postgres 身份运行，写不进 campus 拥有的 /srv/campus/backups
# （第一版就是这么失败的：Permission denied）。
# 所以先 dump 到 postgres 可写的临时路径，再 install 成 campus 所有、0640。
TMPDUMP="/tmp/m2-drill-$$.dump"
DB_PASS="$(cat /srv/campus/.db_password)"

mkdir -p "$BACKUP_DIR"
chown campus:campus "$BACKUP_DIR" 2>/dev/null || true

echo "=== A. pg_dump（custom format，archive 就是设计来重建数据库的）==="
sudo -u postgres pg_dump -Fc -d "$SRC" -f "$TMPDUMP"
if [ -s "$TMPDUMP" ]; then
  install -o campus -g campus -m 0640 "$TMPDUMP" "$DUMP"
  rm -f "$TMPDUMP"
  ok "dump 生成成功（$(stat -c %s "$DUMP") 字节，归 campus 所有）"
else
  bad "dump 未生成或为空"
  exit 1
fi
echo "  pg_restore --list 前 5 行："
# 以 root 运行：dump 文件是 campus:campus 0640，postgres 读不到（第一版这里输出是空的）
pg_restore --list "$DUMP" 2>/dev/null | head -5 | sed 's/^/    /'

echo
echo "=== B. 恢复到全新空库 $DST ==="
sudo -u postgres psql -q -Atc "drop database if exists $DST" >/dev/null 2>&1
if sudo -u postgres psql -q -Atc "create database $DST owner campus" >/dev/null 2>&1; then
  ok "全新空库 $DST 已创建"
else
  bad "空库创建失败"; exit 1
fi
# --no-owner：让对象归当前角色（campus）所有，与源库一致
if PGPASSWORD="$DB_PASS" pg_restore -h 127.0.0.1 -U campus -d "$DST" --no-owner --no-acl "$DUMP" 2>/tmp/restore.err; then
  ok "pg_restore 完成，无错误"
else
  rc=$?
  # pg_restore 对"已存在对象"等会返回非 0 但实际可用；这里如实报告并继续对比
  echo "  pg_restore 返回 $rc，stderr 前 5 行："
  head -5 /tmp/restore.err | sed 's/^/    /'
  bad "pg_restore 返回非 0（见上）"
fi

echo
echo "=== C. 四项逐一对比 ==="
# 时区必须固定，否则 row_to_json 里的时间戳表示会变、哈希跟着变。
# 用 PGOPTIONS 而不是在 SQL 里拼 `set time zone 'UTC'; select ...`：
# 后者会让 psql 多输出一行 "SET"，那行会被拼进表名列表里，
# 于是循环里冒出一个叫 SET 的假表并刷一堆 ERROR（第一版就是这么错的）。
export PGOPTIONS="-c timezone=UTC"
psql_src() { PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$SRC" -Atc "$1"; }
psql_dst() { PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U campus -d "$DST" -Atc "$1"; }

# 1) schema_migrations
V_SRC="$(psql_src "select string_agg(version, ',' order by version) from schema_migrations")"
V_DST="$(psql_dst "select string_agg(version, ',' order by version) from schema_migrations")"
echo "  源库迁移版本 : $V_SRC"
echo "  恢复库迁移版本: $V_DST"
[ "$V_SRC" = "$V_DST" ] && ok "1) schema_migrations 版本集合一致" || bad "1) 版本集合不一致"

# 表集合
T_SRC="$(psql_src "select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname='public'")"
T_DST="$(psql_dst "select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname='public'")"
[ "$T_SRC" = "$T_DST" ] && ok "表集合一致（$(printf '%s' "$T_SRC" | tr ',' '\n' | wc -l) 张）" || bad "表集合不一致：源[$T_SRC] 恢复[$T_DST]"

# 只有 schema_migrations 用 version 作主键，单独处理；其余表都有 id
TABLES="$(printf '%s' "$T_SRC" | tr ',' '\n' | grep -v '^schema_migrations$' | grep -v '^$')"

echo
printf '  %-18s %8s %8s  %s\n' '表' '源行数' '恢复行' '内容哈希'
for t in $TABLES; do
  N_SRC="$(psql_src "select count(*) from $t")"
  N_DST="$(psql_dst "select count(*) from $t")"
  PK_SRC="$(psql_src "select coalesce(md5(string_agg(id::text, ',' order by id)),'empty') from $t")"
  PK_DST="$(psql_dst "select coalesce(md5(string_agg(id::text, ',' order by id)),'empty') from $t")"
  # row_to_json 按表定义的列顺序序列化整行 → 改一个字都会改变哈希
  C_SRC="$(psql_src "select coalesce(md5(string_agg(row_to_json(x)::text, E'\n' order by id)),'empty') from $t x")"
  C_DST="$(psql_dst "select coalesce(md5(string_agg(row_to_json(x)::text, E'\n' order by id)),'empty') from $t x")"

  marker="ok"
  [ "$N_SRC" = "$N_DST" ] || marker="行数不同"
  [ "$PK_SRC" = "$PK_DST" ] || marker="主键集合不同"
  [ "$C_SRC" = "$C_DST" ] || marker="行内容不同"
  printf '  %-18s %8s %8s  %s\n' "$t" "$N_SRC" "$N_DST" "${C_SRC:0:12}… ($marker)"

  [ "$N_SRC" = "$N_DST" ] || bad "2) $t 行数不一致（$N_SRC vs $N_DST）"
  [ "$PK_SRC" = "$PK_DST" ] || bad "3) $t 主键集合哈希不一致"
  if [ "$C_SRC" = "$C_DST" ]; then
    : # 内容一致
  else
    bad "4) $t 行内容哈希不一致（行数与主键相同但内容不同 —— 这正是只比行数会漏掉的情况）"
  fi
done
ok "2/3/4) 各表行数、主键集合哈希、行内容哈希全部一致"

echo
echo "=== D. 反向验证：故意改一行，行内容哈希必须变化 ==="
# 这一条是给"哈希比较"本身做的有效性验证 ——
# 如果 row_to_json 的构造有问题（比如漏了列），改数据也可能不改变哈希，
# 那前面的"一致"就毫无意义。
PA_TABLE=posts
BEFORE="$(psql_dst "select md5(string_agg(row_to_json(x)::text, E'\n' order by id)) from $PA_TABLE x")"
psql_dst "update $PA_TABLE set body = body || ' [篡改探针]' where id = (select id from $PA_TABLE order by id limit 1)" >/dev/null
AFTER="$(psql_dst "select md5(string_agg(row_to_json(x)::text, E'\n' order by id)) from $PA_TABLE x")"
if [ "$BEFORE" != "$AFTER" ]; then
  ok "改一行后行内容哈希确实变化（说明该断言是有效的，不是恒等）"
else
  bad "改一行后哈希没变 —— 行内容哈希无法发现问题，这条判据无效"
fi

echo
echo "=== E. 清理 ==="
sudo -u postgres psql -q -Atc "drop database if exists $DST" >/dev/null 2>&1 && ok "已删除恢复库 $DST" || bad "恢复库删除失败"
rm -f /tmp/restore.err
echo "  备份文件保留在 $DUMP（$(stat -c %s "$DUMP") 字节）作为本次演练证据"

echo
if [ "$FAILED" -eq 0 ]; then echo "BACKUP_DRILL_RESULT PASS"; else echo "BACKUP_DRILL_RESULT FAIL"; fi
exit "$FAILED"
