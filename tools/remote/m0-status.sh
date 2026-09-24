#!/usr/bin/env bash
# 现状核查：Node / PostgreSQL / Nginx / systemd 到底装到哪一步了
echo "=== Node ==="
ls -la /opt/ 2>/dev/null | grep -E 'node' || echo "  /opt 下没有 node"
test -x /opt/node-v24.21.0-linux-x64/bin/node && echo "  node 二进制存在: $(/opt/node-v24.21.0-linux-x64/bin/node --version)" || echo "  node 二进制缺失"
command -v node >/dev/null && echo "  PATH 里的 node: $(node --version)" || echo "  PATH 里没有 node"
test -f /opt/node-v24.21.0.sha256 && echo "  校验和文件: $(cat /opt/node-v24.21.0.sha256)" || echo "  校验和文件缺失"

echo "=== PostgreSQL ==="
systemctl is-active postgresql; systemctl is-enabled postgresql
psql --version
pg_lsclusters 2>/dev/null

echo "=== Nginx ==="
systemctl is-active nginx; systemctl is-enabled nginx
nginx -v 2>&1
curl -s -m 5 http://127.0.0.1/health; echo

echo "=== systemd unit ==="
systemctl is-enabled campus-backend.service 2>&1
systemctl is-active campus-backend.service 2>&1
systemd-analyze verify /etc/systemd/system/campus-backend.service && echo "verify PASS"

echo "=== 端口 ==="
ss -lntp | grep -E ':80|:5432'
