#!/usr/bin/env bash
# M0 服务器 provision（幂等）
# 范围：apt 基础包 → Node 24.22.1 官方二进制 → PostgreSQL 调参（仅 localhost）
#       → Nginx 骨架（/health + /api 反代）→ systemd unit（disabled/inactive）
# 明确不做：任何业务表、任何业务 API、任何 Node 常驻服务
set -euo pipefail

NODE_VERSION="v24.22.1"
NODE_DIR="/opt/node-${NODE_VERSION}-linux-x64"
NODE_SHA256_FILE="/opt/node-${NODE_VERSION}.sha256"
PUBLIC_IP="8.148.156.146"

log() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

log "1/6 apt update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

log "2/6 安装 postgresql / nginx / 基础工具"
apt-get install -y -qq postgresql nginx curl ca-certificates xz-utils jq apache2-utils >/dev/null
echo "postgresql: $(psql --version)"
echo "nginx: $(nginx -v 2>&1)"

log "3/6 安装 Node ${NODE_VERSION}（官方二进制，不用 nvm/NodeSource）"
if [ ! -x "${NODE_DIR}/bin/node" ]; then
  cd /opt
  curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
  curl -fsSLO "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
  grep "node-${NODE_VERSION}-linux-x64.tar.xz" SHASUMS256.txt > "${NODE_SHA256_FILE}"
  sha256sum -c "${NODE_SHA256_FILE}"
  tar -xJf "node-${NODE_VERSION}-linux-x64.tar.xz"
  rm -f "node-${NODE_VERSION}-linux-x64.tar.xz"
fi
ln -sf "${NODE_DIR}/bin/node" /usr/local/bin/node
ln -sf "${NODE_DIR}/bin/npm"  /usr/local/bin/npm
ln -sf "${NODE_DIR}/bin/npx"  /usr/local/bin/npx
echo "node: $(/usr/local/bin/node --version)  path: $(readlink -f /usr/local/bin/node)"
echo "npm:  $(/usr/local/bin/npm --version)"
echo "冻结校验和记录: $(cat ${NODE_SHA256_FILE})"

log "4/6 PostgreSQL 调参（仅 localhost，按审核冻结参数）"
PGVER="$(ls /etc/postgresql | head -1)"
PGCONF="/etc/postgresql/${PGVER}/main/postgresql.conf"
cp -n "${PGCONF}" "${PGCONF}.orig" || true
# 用 include 方式追加覆盖，避免手改原文件顺序问题
cat > /etc/postgresql/${PGVER}/main/conf.d-campus-freeze.conf <<'EOF'
# M0 冻结参数（审核记录 02 / PLAN.md 第五节）
listen_addresses = 'localhost'
max_connections = 15
shared_buffers = 64MB
effective_cache_size = 192MB
work_mem = 1MB
maintenance_work_mem = 16MB
autovacuum_work_mem = 16MB
max_parallel_workers_per_gather = 0
max_parallel_workers = 0
max_parallel_maintenance_workers = 0
autovacuum_max_workers = 2
EOF
grep -q "conf.d-campus-freeze.conf" "${PGCONF}" || \
  echo "include = '/etc/postgresql/${PGVER}/main/conf.d-campus-freeze.conf'" >> "${PGCONF}"
systemctl enable --now postgresql
systemctl restart postgresql
sleep 2
systemctl is-active postgresql
echo "PGVER=${PGVER}"

log "5/6 Nginx 骨架（/health + /api 反代骨架）"
cat > /etc/nginx/sites-available/campus.conf <<EOF
# M0 骨架：/health 由 Nginx 直接返回；/api 反代到尚未启动的后端（M1 才启用）
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
EOF
ln -sf /etc/nginx/sites-available/campus.conf /etc/nginx/sites-enabled/campus.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx
systemctl is-active nginx

log "6/6 systemd unit 骨架（保持 disabled + inactive）"
cat > /etc/systemd/system/campus-backend.service <<'EOF'
# M0：只冻结 unit 形态，不启动任何进程。M1 才接入真实 Fastify 服务。
[Unit]
Description=Campus API (M0 skeleton - intentionally inactive)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
# M1 会替换为真实实现；此处不留假进程
ExecStart=/opt/node-v24.22.1-linux-x64/bin/node /srv/campus/server/dist/index.js
WorkingDirectory=/srv/campus/server
User=campus
Group=campus
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=3001
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl disable campus-backend.service >/dev/null 2>&1 || true
echo "verify:"; systemd-analyze verify /etc/systemd/system/campus-backend.service && echo "  systemd-analyze verify: PASS"
echo "  is-enabled: $(systemctl is-enabled campus-backend.service 2>&1 || true)"
echo "  is-active:  $(systemctl is-active campus-backend.service 2>&1 || true)"

log "完成"
ss -lntp | grep -E ':80|:5432' || true
