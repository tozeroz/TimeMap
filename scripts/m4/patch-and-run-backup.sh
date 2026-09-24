#!/usr/bin/env bash
# 把 /tmp/m4-backup.sh 里"建/删临时库"改成走 postgres 超级用户，并**不吞错误**。
#
# 为什么改：上一轮 `create database campus_m4restore` 未成功（campus 角色可能缺 CREATEDB），
# 而我把 stderr 送进了 /dev/null，于是多花一轮才看到真实原因。
# 诊断阶段**绝不吞错误输出**。
set -uo pipefail
S=/tmp/m4-backup.sh
[ -f "$S" ] || { echo "缺少 $S"; exit 1; }
cp -a "$S" "$S.bak"

python3 - "$S" <<'PY'
import sys
p = sys.argv[1]
t = open(p, encoding='utf-8').read()

old_drop = 'PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d postgres -q -c "drop database if exists $RESTORE_DB" >/dev/null 2>&1'
new_drop = 'sudo -u postgres psql -q -c "drop database if exists $RESTORE_DB" 2>&1 | sed "s/^/    drop: /"'
old_create = 'PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d postgres -q -c "create database $RESTORE_DB" >/dev/null 2>&1'
new_create = 'sudo -u postgres psql -q -c "create database $RESTORE_DB owner campus" 2>&1 | sed "s/^/    create: /"'

n = 0
if old_drop in t:
    t = t.replace(old_drop, new_drop); n += 1
if old_create in t:
    t = t.replace(old_create, new_create); n += 1
open(p, 'w', encoding='utf-8').write(t)
print(f"  替换 {n} 处（期望 2）")
PY

echo "=== 语法校验 ==="
bash -n "$S" && echo "  语法 OK" || { echo "  语法有错"; exit 1; }

echo "=== 确认替换生效 ==="
grep -n 'sudo -u postgres' "$S" | sed 's/^/  /'

echo
echo "=== 跑演练（timeout 300）==="
timeout 300 bash "$S"
echo "DRILL_EXIT $?"
