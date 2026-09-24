#!/usr/bin/env bash
# WO14.5(MapScreen) inventory 第一步：服务端到底有没有**权威**的地点/学校数据？
#
# ## 为什么要先问这个
#   `MapScreen.tsx:10` 从 mock 导入 `mapMarkers`（6 条，带 place/lat/lng/x/y）。
#   但迁移里有 `places`(003) 与 `schools`/`campuses`(004) 表 ——
#   如果这些表**有数据**，那么地图标记就应当与 WO#12/WO#14 同一命题：**把 mock 换成权威**；
#   如果这些表**是空壳**（只有结构没有数据），那"权威来源"根本不存在，
#   处置就完全不同（应当如实记为无权威来源，而不是硬造一个接口）。
#   ⭐ 这正是本项目反复的教训：**先取证，再断言"有/没有权威来源"**。
#
# 只读。用法（服务器上）：bash /tmp/probe-map-authority.sh
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
P() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) places 表：结构与数据量 ==="
P "select 'columns=' || string_agg(column_name || ':' || data_type, ', ' order by ordinal_position)
     from information_schema.columns where table_name='places'"
P "select 'rows=' || count(*)::text from places"
echo "  --- 全部行（最多 24）（列名是 latitude/longitude，我第一版误写成 lat/lng 导致报错）---"
P "select coalesce(name,'<null>') || ' | ' || coalesce(address,'<null>') || ' | ' || latitude::text || ',' || longitude::text
     from places order by name limit 20"

echo
echo "=== 2) schools / campuses 表：结构与数据量 ==="
P "select 'schools cols=' || string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns where table_name='schools'"
P "select 'schools rows=' || count(*)::text from schools"
P "select 'campuses cols=' || string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns where table_name='campuses'"
P "select 'campuses rows=' || count(*)::text from campuses"
echo "  --- schools 全部行 ---"
P "select coalesce(name,'<null>') || ' | ' || coalesce(region,'<null>')
     from schools order by name limit 10"

echo
echo "=== 3) posts 是否带地点（能否由 posts+places 推出标记）==="
P "select 'posts cols=' || string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns where table_name='posts'"
echo "  --- 有 place 关联的 post 数量 ---"
P "select 'posts_with_place=' || count(*)::text from posts where place_id is not null" 2>/dev/null \
  || echo "  （posts 无 place_id 列 —— 说明标记不能由 posts 推出）"

echo
echo "=== 4) 结论（自动判定）==="
PL="$(P "select count(*)::text from places" | tr -d '\n')"
SC="$(P "select count(*)::text from schools" | tr -d '\n')"
echo "  places 行数 = ${PL:-?}"
echo "  schools 行数 = ${SC:-?}"
if [ "${PL:-0}" -gt 0 ] 2>/dev/null; then
  echo "  ⇒ **places 有数据** → 地图标记**可能**有权威来源，下一步应核对 mock 的 6 条是否能对上。"
else
  echo "  ⇒ **places 为空** → 地图标记**当前没有权威来源**；"
  echo "     处置应与 WO#12/#14 的冻结一致：**如实记为无权威来源**，不得硬造接口或编造数据。"
fi
