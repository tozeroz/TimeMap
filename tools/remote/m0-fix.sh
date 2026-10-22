#!/usr/bin/env bash
# 修复被乱码脚本破坏的两步：Node 安装 + Nginx /health 配置；并核对 PG 冻结参数是否生效
set -euo pipefail

NODE_VERSION="v24.22.1"
NODE_DIR="/opt/node-${NODE_VERSION}-linux-x64"
PUBLIC_IP="8.148.156.146"

log() { printf '\n== %s ==\n' "$*"; }

log "A. 安装 Node ${NODE_VERSION}（官方二进制 + SHA256 校验）"
if [ ! -x "${NODE_DIR}/bin/node" ]; then
  cd /opt
  curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
  grep "node-${NODE_VERSION}-linux-x64.tar.xz" SHASUMS256.txt > "/opt/node-${NODE_VERSION}.sha256"
  sha256sum -c "/opt/node-${NODE_VERSION}.sha256"
  tar -xJf "node-${NODE_VERSION}-linux-x64.tar.xz"
  rm -f "node-${NODE_VERSION}-linux-x64.tar.xz" "SHASUMS256.txt"
fi
ln -sf "${NODE_DIR}/bin/node" /usr/local/bin/node
ln -sf "${NODE_DIR}/bin/npm"  /usr/local/bin/npm
ln -sf "${NODE_DIR}/bin/npx"  /usr/local/bin/npx
printf 'node=%s\n' "$(/usr/local/bin/node --version)"
printf 'node_realpath=%s\n' "$(readlink -f /usr/local/bin/node)"
printf 'npm=%s\n' "$(/usr/local/bin/npm --version)"
printf 'checksum_record=%s\n' "$(cat /opt/node-${NODE_VERSION}.sha256)"

log "B. 重写 Nginx 站点配置（含 /health 与 /api 骨架）"
cat > /etc/nginx/sites-available/campus.conf <<NGINXEOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${PUBLIC_IP} _;

    location = /health {
        default_type application/json;
        return 200 '{"status":"ok","service":"campus-gateway","stage":"M0"}';
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / { return 404; }
}
NGINXEOF
nginx -t
systemctl reload nginx
printf 'local_health='; curl -s -m 5 http://127.0.0.1/health; echo

log "C. 核对 PostgreSQL 冻结参数是否真的生效"
sudo -u postgres psql -Atc "show listen_addresses; show max_connections; show shared_buffers; show work_mem; show effective_cache_size; show max_parallel_workers;"
printf 'business_tables='; sudo -u postgres psql -Atc "select count(*) from pg_database where datname not in ('postgres','template0','template1');"

log "D. 完成"
ss -lntp | grep -E ':80|:5432'
