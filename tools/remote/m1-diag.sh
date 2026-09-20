#!/usr/bin/env bash
echo "== systemctl status =="
systemctl status campus-backend.service --no-pager -l | head -25
echo
echo "== journal 最近 40 行 =="
journalctl -u campus-backend.service -n 40 --no-pager
echo
echo "== 直接手工跑一次（不经 systemd），看真实报错 =="
sudo -u campus env DATABASE_URL="$(cat /srv/campus/server.env | sed 's/^DATABASE_URL=//')" \
  /opt/node-v24.21.0-linux-x64/bin/node /srv/campus/server/dist/index.mjs 2>&1 | head -20 &
sleep 4
echo "--- 手工进程的端口 ---"
ss -lntp | grep 3001 || echo "  3001 未监听"
pkill -f 'campus/server/dist/index.mjs' 2>/dev/null || true
