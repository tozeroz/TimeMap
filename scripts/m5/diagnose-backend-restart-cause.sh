#!/usr/bin/env bash
# 追查：campus-backend.service 在 06:10:17 为何重启？
#
# 这正好是抓现场脚本刚捕获到的线索，也与先前那次"未定位的登录失败"模式一致
# （那次失败发生在服务进程重启 05:23:45 之前）。
# 若"某些 Gate 步骤会导致后端重启"，那就能解释间歇性登录失败：
#   重启窗口内正在进行中的请求会失败。
set -uo pipefail

echo "=== 1) 服务重启历史（systemd 记录）==="
systemctl show campus-backend.service -p NRestarts --value | sed 's/^/  总重启次数: /'
journalctl -u campus-backend.service --no-pager --since '2 hours ago' 2>/dev/null \
  | grep -E 'Stopping|Stopped|Starting|Started|Deactivated|Scheduled restart|Failed|Killed' \
  | tail -20 | sed 's/^/  /'

echo
echo "=== 2) 谁触发了它？看 systemd 的触发来源 ==="
journalctl --no-pager --since '2 hours ago' 2>/dev/null \
  | grep -iE 'campus-backend' | grep -viE 'node\[|migrate' | tail -25 | sed 's/^/  /'

echo
echo "=== 3) 是否有其它单元/脚本依赖或重启它 ==="
echo "  --- 谁 Wants/Requires 了它 ---"
systemctl list-dependencies --reverse campus-backend.service --no-pager 2>/dev/null | head -10 | sed 's/^/    /'
echo "  --- 相关 timer ---"
systemctl list-timers --all --no-pager 2>/dev/null | grep -i campus | sed 's/^/    /'

echo
echo "=== 4) 部署脚本是否会 restart？==="
grep -n 'restart\|systemctl' /srv/campus/deploy*.sh 2>/dev/null | head -10 | sed 's/^/  /' || echo "  （/srv/campus 下没有 deploy 脚本）"

echo
echo "=== 5) ⭐ 是否**任何 m5 脚本**会导致重启？（这是关键问题）==="
for f in /tmp/m5/*.sh; do
  if grep -qE 'systemctl (restart|stop|start) campus-backend' "$f" 2>/dev/null; then
    echo "  含重启语句: $f"
    grep -n -E 'systemctl (restart|stop|start) campus-backend' "$f" | sed 's/^/    /'
  fi
done
echo "  --- 网关脚本 run-gate.sh 与 gate-m5.sh ---"
grep -n -E 'systemctl|restart' /tmp/run-gate.sh /tmp/gate-m5.sh 2>/dev/null | head -10 | sed 's/^/    /' || echo "    （无）"

echo
echo "=== 6) ⭐ 是否有脚本停/起 **postgresql**？（服务会因 PG 断开而重启或报错）==="
for f in /tmp/m5/*.sh; do
  if grep -qE 'systemctl (restart|stop|start) postgresql' "$f" 2>/dev/null; then
    echo "  含 PG 停起: $f"
    grep -n -E 'systemctl (restart|stop|start) postgresql' "$f" | sed 's/^/    /'
  fi
done
grep -rn 'postgresql' /tmp/run-gate.sh 2>/dev/null | head -5 | sed 's/^/    /' || true

echo
echo "=== 7) 结论方向 ==="
echo "  · 若第 5 节命中了某个 m5 脚本 → 就能解释'间歇性登录失败'："
echo "    该脚本重启后端时，其它段正在进行中的请求会失败（与观察到的'单独跑即 PASS'一致）"
echo "  · 若第 6 节命中 → 说明有脚本停 PG，后端连接池会被打断"
