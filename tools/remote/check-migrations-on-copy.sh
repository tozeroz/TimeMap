#!/usr/bin/env bash
# 在**服务器上**用一份生产数据的副本验证新迁移能否干净应用。
#
# 为什么要这么绕：生产库是 PostgreSQL 18，而本机客户端是 15 ——
# `pg_restore` 直接报 `unsupported version (1.16) in file header`。
# 把 dump 拉回本地再恢复这条路走不通，所以：
#   ① 在服务器上 `pg_dump campus | pg_restore prod_copy`（同版本，最保真）
#   ② 用**新构建的后端包**连这个副本库启动一次（端口 3009，不碰 3001 的服务）
#   ③ 看它把迁移跑到多少、有没有失败；再看活动是否带 external_link
#   ④ 无论成败都删掉副本库和临时进程
#
# ⚠️ 全程只写 `prod_copy` 这个临时库，**不碰** campus 库和线上服务。
set -uo pipefail

BUNDLE=/tmp/check-bundle.mjs
LOG=/tmp/check-migrations.log
PORT_TEST=3009

cleanup() {
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null
  sleep 1
  sudo -u postgres psql -q -c 'drop database if exists prod_copy' campus >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== 1) 建副本库并拷数据（同版本 pg_dump/pg_restore）=="
sudo -u postgres psql -q -c 'drop database if exists prod_copy' campus
sudo -u postgres psql -q -c 'create database prod_copy owner campus' campus
# ⚠️ 不要加 --no-owner：否则表归 postgres 所有，而应用用 campus 连库，
#    迁移会报 `must be owner of table schema_migrations`（第一次就是这么失败的）。
sudo -u postgres bash -c 'pg_dump -Fc campus | pg_restore -d prod_copy'
echo "   副本库行数："
sudo -u postgres psql -At -F'|' prod_copy -c \
  "select (select count(*) from schema_migrations)||' migrations, '||(select count(*) from activities)||' activities, '||(select count(*) from places)||' places'"

echo
echo "== 2) 用新包连副本库启动（PORT=$PORT_TEST）=="
set -a; . /srv/campus/server.env; set +a
export DATABASE_URL="$(printf '%s' "$DATABASE_URL" | sed 's#/campus$#/prod_copy#')"
export PORT=$PORT_TEST
NODE_BIN=/opt/node-v24.21.0-linux-x64/bin/node
[ -x "$NODE_BIN" ] || NODE_BIN=$(command -v node)
cd /srv/campus/server/dist
"$NODE_BIN" "$BUNDLE" > "$LOG" 2>&1 &
APP_PID=$!

for i in $(seq 1 60); do
  curl -sf -m 2 "http://127.0.0.1:$PORT_TEST/api/ready" >/dev/null 2>&1 && { echo "    就绪 ${i}s"; break; }
  kill -0 "$APP_PID" 2>/dev/null || { echo "    ✗ 进程已退出"; break; }
  sleep 1
done

echo "   --- 迁移/错误日志 ---"
grep -E '\[migrate\]|ERROR|error:' "$LOG" | tail -8 | sed 's/^/    /'

echo
echo "== 3) 结果 =="
printf '  ready: '; curl -s -m 5 "http://127.0.0.1:$PORT_TEST/api/ready"; echo
printf '  活动数/带链接数: '
curl -s -m 10 "http://127.0.0.1:$PORT_TEST/api/activities" |
  "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const it=j.items||[];console.log(it.length+" / "+it.filter(a=>a.externalLink).length)}catch(e){console.log("解析失败")}})'
echo "   --- 抽查一条（应为带链接的新活动）---"
curl -s -m 10 "http://127.0.0.1:$PORT_TEST/api/activities/eeeeeeee-0002-4001-8001-000000000004" |
  "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);console.log("    "+a.title+" | place="+(a.place&&a.place.name)+" | link="+a.externalLink)}catch(e){console.log("    "+s.slice(0,200))}})'

echo
echo "== 4) 副本库里的迁移与地点检查 =="
sudo -u postgres psql -At -F'|' prod_copy -c "select version from schema_migrations order by version desc limit 4" | sed 's/^/    /'
sudo -u postgres psql -At -F'|' prod_copy -c "select id||' = '||name from places where id in ('aaaaaaaa-1111-4111-8111-000000000011','aaaaaaaa-1111-4111-8111-000000000091')" | sed 's/^/    /'
echo "CHECK_MIGRATIONS_DONE"
