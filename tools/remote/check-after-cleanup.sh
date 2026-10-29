#!/usr/bin/env bash
# 验证"先把误占用的 place id ...011 腾出来，再跑 026/027/028"这条路是否干净。
#
# 为什么需要这一步：上一次在副本库上的实测显示
#   026_map_display      OK
#   027_bjtu_parent_place FAIL: duplicate key value violates unique constraint "places_pkey"
# 原因是我的 020 迁移把 aaaaaaaa-…011 写成了「线上活动」，而 027 要用同一 id 插「北京交通大学」。
# 本脚本先做与生产将要执行的**同一段清理 SQL**，再跑新包，确认 026/027/028 全部干净应用。
#
# ⚠️ 只操作临时库 prod_copy。
set -uo pipefail

BUNDLE=/tmp/check-bundle.mjs
LOG=/tmp/check-migrations2.log
PORT_TEST=3009

cleanup() {
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null
  sleep 1
  sudo -u postgres psql -q -c 'drop database if exists prod_copy' campus >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== 1) 重建副本库 =="
sudo -u postgres psql -q -c 'drop database if exists prod_copy' campus
sudo -u postgres psql -q -c 'create database prod_copy owner campus' campus
sudo -u postgres bash -c 'pg_dump -Fc campus | pg_restore -d prod_copy'
sudo -u postgres psql -At prod_copy -c "select count(*)||' migrations' from schema_migrations"

echo
echo "== 2) 执行清理（与生产将要执行的同一段 SQL）=="
# ⚠️ 顺序必须是：先建 ...091 → 再改活动指向 → 最后删 ...011。
#    反过来（先改指向）会撞 activities_place_id_fkey：目标地点还不存在。
sudo -u postgres psql -v ON_ERROR_STOP=1 prod_copy <<'SQL'
INSERT INTO places (id, name, category, enabled, description, sort_order)
VALUES ('aaaaaaaa-1111-4111-8111-000000000091', '线上活动', '地标', true,
        '线上举行的讲座/分享/直播（腾讯会议、视频号直播等），没有固定坐标。', 90)
ON CONFLICT (id) DO NOTHING;

UPDATE activities SET place_id = 'aaaaaaaa-1111-4111-8111-000000000091'
 WHERE place_id = 'aaaaaaaa-1111-4111-8111-000000000011';

DELETE FROM places
 WHERE id = 'aaaaaaaa-1111-4111-8111-000000000011' AND name = '线上活动';
SQL
echo "   ...011 现在存在吗：$(sudo -u postgres psql -At prod_copy -c "select count(*) from places where id='aaaaaaaa-1111-4111-8111-000000000011'")（0 = 已腾出）"

echo
echo "== 3) 用新包启动（PORT=$PORT_TEST）=="
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
  kill -0 "$APP_PID" 2>/dev/null || { echo "    ✗ 进程退出"; break; }
  sleep 1
done
grep -E '\[migrate\]|ERROR' "$LOG" | tail -6 | sed 's/^/    /'

echo
echo "== 4) 结果 =="
printf '  ready: '; curl -s -m 5 "http://127.0.0.1:$PORT_TEST/api/ready"; echo
printf '  活动数/带链接数: '
curl -s -m 10 "http://127.0.0.1:$PORT_TEST/api/activities" |
  "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const it=JSON.parse(s).items||[];console.log(it.length+" / "+it.filter(a=>a.externalLink).length)}catch(e){console.log("parse-fail")}})'
echo "  --- 我加的 7 条（标题 | 地点 | 链接有无）---"
curl -s -m 10 "http://127.0.0.1:$PORT_TEST/api/activities" |
  "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const a of (JSON.parse(s).items||[]).filter(x=>x.id.startsWith("eeeeeeee-0002-"))) console.log("    "+a.title+" | "+(a.place&&a.place.name)+" | "+(a.externalLink?"有链接":"无链接"))}catch(e){console.log("parse-fail")}})'
echo "  --- 地点 ...011 / ...091 现在是谁 ---"
sudo -u postgres psql -At -F' = ' prod_copy -c "select id,name from places where id in ('aaaaaaaa-1111-4111-8111-000000000011','aaaaaaaa-1111-4111-8111-000000000091') order by id" | sed 's/^/    /'
echo "  --- 迁移尾部 ---"
sudo -u postgres psql -At prod_copy -c "select version from schema_migrations order by version desc limit 4" | sed 's/^/    /'
echo "CHECK_AFTER_CLEANUP_DONE"
