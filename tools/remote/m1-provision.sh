#!/usr/bin/env bash
# M1 服务器侧 provision：创建业务库与角色、准备部署目录（幂等）
# 明确不做：装额外软件、改 PG 冻结参数、开放新端口
set -euo pipefail

DB_NAME=campus
DB_USER=campus
DB_PASS_FILE=/srv/campus/.db_password

echo "== 1. 生成/读取数据库口令（仅存于服务器，不进 git）=="
mkdir -p /srv/campus/server/dist
if [ ! -f "$DB_PASS_FILE" ]; then
  # 注意：不要写成 `tr -dc ... </dev/urandom | head -c 40`——
  # head 先退出会给 tr 发 SIGPIPE，在 set -o pipefail 下整条流水线非 0，脚本直接中断（踩过）。
  # 这里让读取端读到 EOF，不产生 SIGPIPE。
  DB_PASS="$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-40)"
  printf '%s' "$DB_PASS" > "$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
  echo "  生成新的口令到 $DB_PASS_FILE"
else
  echo "  复用已有口令 $DB_PASS_FILE"
fi
DB_PASS="$(cat "$DB_PASS_FILE")"

echo "== 2. 创建角色与数据库（幂等）=="
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -Atc "select 1 from pg_database where datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
  echo "  已创建数据库 ${DB_NAME}"
else
  echo "  数据库 ${DB_NAME} 已存在"
fi

# 收紧：业务角色不需要建库/建角色权限
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE ${DB_USER} NOCREATEDB NOCREATEROLE NOSUPERUSER;" >/dev/null
# 只允许在 public schema 里建对象（迁移需要），不允许建其他 schema
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" >/dev/null

echo "== 3. 验证业务角色可连通 =="
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U "${DB_USER}" -d "${DB_NAME}" -Atc "select current_user||'@'||current_database()"

echo "== 4. 系统用户 campus（systemd unit 里 User=campus）=="
if ! id -u campus >/dev/null 2>&1; then
  useradd --system --home /srv/campus --shell /usr/sbin/nologin campus
  echo "  已创建 campus 用户"
else
  echo "  campus 用户已存在"
fi
chown -R campus:campus /srv/campus
chmod 750 /srv/campus

echo "== 5. 现状 =="
sudo -u postgres psql -Atc "select count(*) from pg_database where datname not in ('postgres','template0','template1')" | sed 's/^/  业务库数量: /'
ss -lntp | grep -E ':80|:5432|:3001' || true
