#!/usr/bin/env bash
# 诊断：部署的 index.mjs 里的备份屏障实现，与仓库源码是否一致
set -uo pipefail
B=/srv/campus/server/dist/index.mjs

echo "=== 1) 部署产物里的 lock_timeout 相关片段 ==="
grep -o -E "lock_timeout[^\"']{0,40}" "$B" | sort -u | head -10 | sed 's/^/  /'
echo "  --- LOCK_TIMEOUT 附近（宽窗口）---"
grep -o -E ".{60}lock_timeout.{60}" "$B" | head -3 | sed 's/^/  /'

echo
echo "=== 2) 部署产物里的 advisory lock 调用 ==="
grep -o -E "pg_advisory[_a-z]*\([^)]{0,40}" "$B" | sort -u | head -10 | sed 's/^/  /'

echo
echo "=== 3) 锁键数值（源码里是 0x4D344241 = 1295270465；压缩后可能以十进制出现）==="
for n in 1295270465 1295270464; do
  C=$(grep -o "$n" "$B" | wc -l)
  echo "  $n 出现 $C 次"
done

echo
echo "=== 4) 屏障函数是否真的被 media 上传路径调用 ==="
echo "  --- backup_in_progress 片段 ---"
grep -o -E ".{40}backup_in_progress.{40}" "$B" | head -2 | sed 's/^/  /'
grep -o -E "Retry-After[^\"']{0,20}" "$B" | head -3 | sed 's/^/  /'

echo
echo "=== 5) 部署产物构建时间 vs 仓库最后一次编译 ==="
stat -c '%y  %n' "$B" | sed 's/^/  /'

echo
echo "=== 6) 服务进程的启动时间（是否晚于 bundle）==="
systemctl show campus-backend.service -p ExecMainStartTimestamp --value | sed 's/^/  /'

echo
echo "=== 7) 直接看进程实际加载的 bundle 路径 ==="
PID=$(systemctl show campus-backend.service -p MainPID --value)
echo "  MainPID=$PID"
if [ -n "$PID" ] && [ "$PID" != "0" ]; then
  tr '\0' ' ' < /proc/$PID/cmdline 2>/dev/null | sed 's/^/  cmdline: /'
  echo
  echo "  --- 该进程打开的 index.mjs（若已删除会显示 deleted）---"
  ls -l /proc/$PID/cwd 2>/dev/null | sed 's/^/  /'
fi
