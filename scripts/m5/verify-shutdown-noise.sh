#!/usr/bin/env bash
# 验证 B2 修复：**正常停机不再产生假警报**
#
# 断言：连续重启 N 次（期间持续轮询 /api/ready 以最大化"在飞 refresh"的机会），
#       日志里**不得出现**
#         · `[migrate] TERMINAL failure`
#         · `[health] ready: true -> false`
#
# 为什么这样测：缺陷的触发条件是"关机窗口内恰好有一次 refresh 在飞"。
# 只做一次重启很可能碰不到；持续轮询 /api/ready 会**主动制造**这个条件
# （/api/ready 本身就会调 db.refresh()）。这样测才是"能失败的测试"。
set -u
N="${1:-3}"
echo "=== B2 修复验证：重启 $N 次，期间轮询 /api/ready ==="
echo "  标记起点时间: $(date -Is)"
START="$(date -Is)"
sleep 1

for i in $(seq 1 "$N"); do
  echo "--- 第 $i 次重启 ---"
  # 后台持续轮询 /api/ready：制造"关机瞬间有 refresh 在飞"的条件
  ( for _ in $(seq 1 60); do curl -s -m 1 -o /dev/null http://127.0.0.1:3001/api/ready || true; sleep 0.05; done ) &
  POLLER=$!
  sleep 0.6
  systemctl restart campus-backend.service
  wait $POLLER 2>/dev/null || true
  # 等服务起来
  for _ in $(seq 1 40); do
    if curl -s -m 1 http://127.0.0.1:3001/api/health 2>/dev/null | grep -q '"status":"ok"'; then break; fi
    sleep 0.3
  done
  sleep 0.5
  echo "  ready: $(curl -s -m 2 http://127.0.0.1:3001/api/ready | head -c 160)"
done

echo
echo "=== 断言：上述时间窗内的日志 ==="
J="$(journalctl -u campus-backend.service --since "$START" --no-pager 2>&1)"
echo "$J" | grep -nE '\[shutdown\]|\[migrate\]|\[health\]|\[listen\]' | sed 's/^/    /'

echo
B1=$(printf '%s' "$J" | grep -c 'TERMINAL failure' || true)
B2=$(printf '%s' "$J" | grep -c 'ready: true -> false' || true)
B3=$(printf '%s' "$J" | grep -c 'Cannot use a pool after calling end' || true)
echo "  出现 'TERMINAL failure'            : $B1 次（期望 0）"
echo "  出现 'ready: true -> false'        : $B2 次（期望 0）"
echo "  出现 'Cannot use a pool after end' : $B3 次（期望 0）"

echo
if [ "$B1" = "0" ] && [ "$B2" = "0" ] && [ "$B3" = "0" ]; then
  echo "B2_SHUTDOWN_NOISE: PASS（$N 次重启均无假警报）"
else
  echo "B2_SHUTDOWN_NOISE: FAIL（仍有假警报）"
fi
