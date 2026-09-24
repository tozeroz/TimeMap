#!/usr/bin/env bash
# 导出 M0 需要入库的服务器配置与版本清单（带分隔标记，便于本地切分）
emit() { printf '\n@@@FILE:%s@@@\n' "$1"; cat "$1" 2>/dev/null || echo "(missing)"; }

echo "@@@ENV@@@"
. /etc/os-release
printf 'os=%s\n' "$PRETTY_NAME"
printf 'kernel=%s\n' "$(uname -r)"
printf 'arch=%s\n' "$(uname -m)"
printf 'cpu_count=%s\n' "$(nproc)"
printf 'node=%s\n' "$(/usr/local/bin/node --version)"
printf 'node_realpath=%s\n' "$(readlink -f /usr/local/bin/node)"
printf 'npm=%s\n' "$(/usr/local/bin/npm --version)"
printf 'psql=%s\n' "$(psql --version | awk '{print $3}')"
printf 'pg_cluster=%s\n' "$(pg_lsclusters -h | awk '{print $1"/"$2" port="$3" status="$4}')"
printf 'nginx=%s\n' "$(nginx -v 2>&1 | awk -F/ '{print $2}')"
printf 'systemd=%s\n' "$(systemctl --version | head -1 | awk '{print $2}')"
printf 'public_ip=8.148.156.146\n'
printf 'private_ip=%s\n' "$(hostname -I | awk '{print $1}')"

emit /etc/nginx/sites-available/campus.conf
emit /etc/postgresql/18/main/conf.d-campus-freeze.conf
emit /etc/systemd/system/campus-backend.service

echo "@@@EFFECTIVE_PG@@@"
sudo -u postgres psql -Atc "select name||'='||setting from pg_settings where name in ('listen_addresses','max_connections','shared_buffers','work_mem','maintenance_work_mem','autovacuum_work_mem','effective_cache_size','max_parallel_workers','max_parallel_workers_per_gather','max_parallel_maintenance_workers','autovacuum_max_workers') order by name;"
echo "@@@BUSINESS_TABLES@@@"
sudo -u postgres psql -Atc "select count(*) from pg_database where datname not in ('postgres','template0','template1');"

echo "@@@NODE_SHA@@@"
cat /opt/node-v24.21.0.sha256

echo "@@@HEALTH@@@"
curl -s -m 5 http://127.0.0.1/health; echo
