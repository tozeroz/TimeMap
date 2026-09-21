#!/usr/bin/env bash
# 诊断：语音生命周期 C1「期望 503，实际 201」—— 备份屏障为何未生效
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) gate 里 C1 前后在做什么（找屏障文件）==="
grep -a -n -B18 'C1 期望 503' /tmp/gate-wo11c.txt 2>/dev/null | head -22 | sed 's/^/  /'

echo
echo "=== 2) 服务器上有哪些"屏障/哨兵"文件 ==="
for p in /srv/campus/uploads/.backup-barrier /srv/campus/.backup-barrier /srv/campus/uploads/.barrier \
         /srv/campus/uploads/.backup /run/campus/backup-barrier /srv/campus/backup-barrier; do
  if [ -e "$p" ]; then echo "  存在: $p"; else echo "  不存在: $p"; fi
done

echo
echo "=== 3) uploads 目录全貌（含隐藏文件）==="
ls -laR /srv/campus/uploads 2>/dev/null | head -30 | sed 's/^/  /'

echo
echo "=== 4) 服务端代码里"备份屏障"的实现（找 503 的来源）==="
grep -o -n 'backup[A-Za-z_]*' /srv/campus/server/dist/index.mjs 2>/dev/null | sort -u -t: -k2 | head -20 | sed 's/^/  /'

echo
echo "=== 5) 该屏障的环境变量名（server.env 里找）==="
grep -i -E 'backup|barrier|maintenance' /srv/campus/server.env 2>/dev/null | sed 's/^/  /' || echo "  （server.env 里没有相关键）"
echo "  --- 服务实际拿到的环境（只看相关键）---"
systemctl show campus-backend.service -p Environment --value 2>/dev/null | tr ' ' '\n' | grep -i -E 'backup|barrier|upload|maintenance' | sed 's/^/  /'

echo
echo "=== 6) 相关目录权限（服务以 campus 运行，能否创建/读取屏障文件）==="
stat -c '%A %U:%G %n' /srv/campus /srv/campus/uploads 2>&1 | sed 's/^/  /'

echo
echo "=== 7) 手动复现：创建常见屏障文件后上传，看是否 503 ==="
# 先看 gate 用的是哪个路径 —— 从 gate 输出或 m5 脚本里找
grep -l 'C1' /tmp/m5/*.sh 2>/dev/null | sed 's/^/  相关脚本: /'
for f in /tmp/m5/*.sh; do
  if grep -q 'C1 期望 503' "$f" 2>/dev/null || grep -q '期望 503' "$f" 2>/dev/null; then
    echo "  --- $f 里 C1 的实现（前后 20 行）---"
    grep -n -B10 -A6 '期望 503' "$f" | head -30 | sed 's/^/    /'
  fi
done
