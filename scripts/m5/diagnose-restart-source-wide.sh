#!/usr/bin/env bash
# 追查重启来源（续）：扩大搜索面 + 对齐"未定位登录失败"的时刻
set -uo pipefail

echo "=== 1) 全部重启时刻（更长历史）==="
journalctl -u campus-backend.service --no-pager --since '4 hours ago' 2>/dev/null \
  | grep -E 'Started campus-backend' | sed 's/^/  /'

echo
echo "=== 2) ⭐ 05:19:37（媒体段登录失败那一刻）前后 3 分钟内是否有重启？ ==="
journalctl -u campus-backend.service --no-pager --since '2026-09-22 05:15:00' --until '2026-09-22 05:25:00' 2>/dev/null \
  | grep -E 'Started|Stopping|Stopped|Deactivated' | sed 's/^/  /' || echo "  （该窗口内无重启记录）"

echo
echo "=== 3) 扩大搜索：所有可能重启后端的写法（全 /tmp 与 /srv）==="
for pat in 'systemctl restart' 'systemctl stop' 'systemctl start' 'service campus' 'systemd-run' 'killall node' 'pkill node'; do
  HITS="$(grep -rln "$pat" /tmp/*.sh /tmp/m5/*.sh /srv/campus/*.sh 2>/dev/null | head -5)"
  if [ -n "$HITS" ]; then
    echo "  【$pat】命中："
    printf '%s\n' "$HITS" | sed 's/^/    /'
    grep -rn "$pat" /tmp/*.sh /tmp/m5/*.sh /srv/campus/*.sh 2>/dev/null | head -6 | sed 's/^/      /'
  fi
done

echo
echo "=== 4) deploy 相关脚本在哪、是否含 restart ==="
ls -la /root/*.sh /srv/campus/*.sh 2>/dev/null | sed 's/^/  /'
if [ -f /root/deploy.sh ]; then grep -n -E 'systemctl|restart' /root/deploy.sh | sed 's/^/    /'; fi

echo
echo "=== 5) ⭐ systemd 的 ExecStop/ExecStart 定义（看是谁在停）==="
systemctl cat campus-backend.service 2>/dev/null | sed 's/^/  /'

echo
echo "=== 6) 谁在 06:10:16 那个时刻登录过（auth 日志线索）==="
journalctl --no-pager --since '2026-09-22 06:09:00' --until '2026-09-22 06:11:00' 2>/dev/null \
  | grep -viE 'node\[|migrate|session opened for user root' | head -20 | sed 's/^/  /'
