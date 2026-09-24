#!/usr/bin/env bash
# WO#15 服务端增量验证：帖子端点是否返回地点坐标（placeLat/placeLng）
#
# ## 为什么要专门验这一层
#   本增量为帖子补了两个坐标字段（服务端 left join places）。必须证明：
#     ① 两个端点真的返回字段（而不是我改了代码、线上跑的仍是旧产物）
#     ② 值**是数值**而不是字符串 —— ⚠️ pg 常把 numeric/double 以字符串返回，
#        而地图 SDK 的 LatLng 需要 number；**TS 编译期看不出来**（运行时才炸），
#        标记可能静默跑到 0,0。服务端因此显式做了 Number() 转换。
#     ③ 无地点的帖子返回 null（不是 0,0 —— 那会伪造一个"几内亚湾"的位置）
#     ④ 与原版基线对照：原版 poi-search 的列表行是「地点名 + 地址」，
#        我们的 places 正是这个形状（北京交通大学 | 西直门外上园村3号）。
#
# ## 复杂 Python 逻辑放在同目录的 .py 里（**不**塞进 bash 的 python3 -c）
#   原因见那个 .py 的文件头：我在 bash 里连续踩了 heredoc 接管 stdin、以及
#   单引号包内 `\"` 不转义两个坑。跨语言引号层数 > 1 就该拆文件。
#
# 只读（只发 GET）。用法（服务器上需两个文件同目录）：
#   bash /tmp/verify-wo15-place-coords.sh
set -uo pipefail
BASE="${CAMPUS_BASE:-http://127.0.0.1}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$HERE/verify-wo15-place-coords.py"
PW="$(cat /srv/campus/.db_password)"
P() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
FAIL=0

if [ ! -f "$PY" ]; then echo "FATAL 缺少 $PY"; exit 2; fi

echo "=== 1) GET /api/posts 的坐标字段与类型 ==="
TP1="$(mktemp)"; TP2="$(mktemp)"
curl -s "$BASE/api/posts" -o "$TP1"
PID="$(P "select id from posts where place_id is not null order by created_at limit 1" | tr -d '\n')"
if [ -n "$PID" ]; then
  curl -s "$BASE/api/posts/$PID" -o "$TP2"
  python3 "$PY" "$TP1" "$TP2" || FAIL=1
else
  echo "  （库里没有带地点的 post —— 只验列表端点）"
  python3 "$PY" "$TP1" || FAIL=1
fi
echo

echo "=== 2) 与 DB 的 places 逐字对照（原版 poi-search 行形状 = 地点名 + 地址）==="
P "select '    DB: ' || pl.name || ' | ' || pl.address || ' | ' || pl.latitude::text || ',' || pl.longitude::text
     from posts p join places pl on pl.id = p.place_id
    group by pl.name, pl.address, pl.latitude, pl.longitude
    order by pl.name"
echo

echo "=== 3) 全库坐标健全性（不得有 0,0；纬度/经度必须成对出现）==="
P "select '    places 总数=' || count(*)::text
        || ' ／ 坐标为 0,0 的行=' || count(*) filter (where latitude = 0 and longitude = 0)::text
        || ' ／ 纬度或经度为 null 的行=' || count(*) filter (where latitude is null or longitude is null)::text
     from places"
echo

echo "=== 4) 无地点的 post 覆盖情况（如实说明样本量）==="
P "select '    带地点 post=' || count(*) filter (where place_id is not null)::text
        || ' ／ 无地点 post=' || count(*) filter (where place_id is null)::text from posts"
echo "  ⚠️ 若无地点 post 为 0，则「null 坐标」这条**无样本可验** —— 如实说明，不假装验过。"
echo

rm -f "$TP1" "$TP2"
  echo "    ⚠️ 若无地点 post 为 0，则「null 坐标」这条无样本可验 —— 如实说明，不假装验过。"
exit "$FAIL"
