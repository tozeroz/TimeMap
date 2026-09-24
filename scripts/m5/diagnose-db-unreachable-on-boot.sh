#!/usr/bin/env bash
# 诊断：为什么后端重启后 ~3 分钟报 "database unreachable"？
#
# 背景（2026-09-22 发现）：campus-backend 重启后
#   06:49:54 Started → 06:51:21 起持续 "[migrate] retryable: database unreachable"
#   → 06:52:50 才 "ready: false -> true"（**2 分 56 秒**）
# 这正是长期"未定位的间歇性登录失败"的机制：
#   重启窗口内任何请求都会失败，而 Gate 的 verify-tmp-selfheal.sh 只 sleep 5 就继续。
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) PostgreSQL 状态与最近重启 ==="
systemctl is-active postgresql | sed 's/^/  active: /'
systemctl show postgresql -p ExecMainStartTimestamp -p NRestarts --value | sed 's/^/  /'
journalctl -u postgresql --no-pager --since '30 minutes ago' 2>/dev/null | grep -E 'restart|shutdown|LOG:|FATAL|WARNING' | tail -12 | sed 's/^/  /'

echo
echo "=== 2) 当前能否连库 ==="
PSQL "select 'ok now: ' || now()::text" | sed 's/^/  /'

echo
echo "=== 3) ⭐ 内存与 swap（396MB 的机器，PG + Node 同时启动时的压力）==="
free -m | sed 's/^/  /'
echo "  --- swap 使用最高的进程 ---"
for p in /proc/[0-9]*; do
  [ -r "$p/status" ] || continue
  n=$(awk -F'\t' '/^Name:/{print $2}' "$p/status" 2>/dev/null)
  v=$(awk -F'\t' '/^VmSwap:/{print $2}' "$p/status" 2>/dev/null)
  [ -n "$v" ] && [ "${v:-0}" -gt 1000 ] && echo "    $n swap=${v}kB pid=${p#/proc/}"
done | sort -t= -k2 -rn | head -6 | sed 's/^/  /'

echo
echo "=== 4) PG 的连接与 max_connections ==="
PSQL "select 'used=' || count(*)::text || ' max=' || current_setting('max_connections') from pg_stat_activity" | sed 's/^/  /'
PSQL "select 'reserved=' || current_setting('superuser_reserved_connections')" | sed 's/^/  /'
echo "  --- 连接状态分布 ---"
PSQL "select coalesce(state,'<null>') || ' x' || count(*)::text from pg_stat_activity group by state" | sed 's/^/  /'

echo
echo "=== 5) ⭐ PG 的启动耗时（关键：是不是 PG 自己就慢）==="
journalctl -u postgresql --no-pager -n 200 2>/dev/null | grep -E 'database system is ready|starting PostgreSQL|listening on' | tail -6 | sed 's/^/  /'

echo
echo "=== 6) 后端启动各阶段耗时（用最近一次重启的日志算差值）==="
journalctl -u campus-backend.service --no-pager -n 60 2>/dev/null | grep -E 'Started|tmp 目录就绪|listen|migrate|health' | tail -12 | sed 's/^/  /'

echo
echo "=== 7) 磁盘 IO / 负载（小机器上 PG 启动慢的常见原因）==="
cat /proc/loadavg | sed 's/^/  loadavg: /'
uptime | sed 's/^/  /'
df -h / | sed 's/^/  /'
echo "  --- 是否有 OOM 记录 ---"
dmesg 2>/dev/null | grep -i -E 'oom|killed process' | tail -5 | sed 's/^/  /' || echo "  （无 / 无权限）"
