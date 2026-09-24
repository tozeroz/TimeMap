#!/usr/bin/env bash
# M0 环境探测：只读，不做任何修改
echo "=== OS / KERNEL / ARCH ==="
. /etc/os-release; echo "os=$PRETTY_NAME"; echo "id=$ID $VERSION_ID"
uname -r; uname -m

echo "=== CPU / MEM ==="
nproc
grep -m1 'model name' /proc/cpuinfo | sed 's/.*: //'
free -m

echo "=== DISK ==="
df -h /

echo "=== 已安装的运行时 ==="
for b in node npm pnpm psql nginx systemctl git python3; do
  printf '%-10s %s\n' "$b" "$(command -v $b 2>/dev/null || echo NONE)"
done

echo "=== apt 候选版本 ==="
for p in nodejs npm postgresql nginx; do
  printf '%-12s installed=%-10s candidate=%s\n' "$p" \
    "$(dpkg-query -W -f='${Version}' $p 2>/dev/null || echo -)" \
    "$(apt-cache policy $p 2>/dev/null | awk '/Candidate:/{print $2}')"
done

echo "=== apt 源 ==="
ls /etc/apt/sources.list.d/ 2>/dev/null
grep -rh '^deb ' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null | head -5

echo "=== 监听端口 ==="
ss -lntp 2>/dev/null

echo "=== 防火墙 ==="
(command -v ufw >/dev/null && ufw status) 2>/dev/null || echo "ufw: NONE"
iptables -S 2>/dev/null | head -12

echo "=== swap ==="
swapon --show
