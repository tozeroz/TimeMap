#!/usr/bin/env bash
# WO14.5b 诊断：`places` 表里的 23 行测试残留能否安全清理？
#
# ## 背景（本轮发现）
#   `places` 共 24 行，其中 23 行形如
#     `同名地点<10位数字> | 同名A的地址(31.1,121.1) ／ 同名B的地址(39.9,116.3)`
#   —— 明显的"同名地点"测试造数；唯一真实行是「北京交通大学 | 西直门外上园村3号」。
#   ⭐ 而 `check-server-baseline.sh` **不覆盖 places**，所以这批残留长期不可见。
#
# ## 清理前必须回答的问题
#   1. `posts.place_id` 是否**引用了**这些测试行？（有外键，直接删会失败或连带）
#   2. 除了 posts，还有别的地方引用 places 吗？（comments / media / 其它表）
#   3. `places` 与 mock 的 6 个地点有没有任何对应关系？（决定 WO15 的处置方向）
#
# 只读。用法（服务器上）：bash /tmp/diagnose-places-residue.sh
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
P() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) 谁引用了 places？先列出所有外键 ==="
P "select 'FK: ' || tc.table_name || '.' || kcu.column_name
     || ' -> ' || ccu.table_name || '.' || ccu.column_name
   from information_schema.table_constraints tc
   join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
   join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
  where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'places'"

echo
echo "=== 2) posts.place_id 指向的是真实行还是测试残留？ ==="
P "select 'posts_with_place_id=' || count(*)::text from posts where place_id is not null"
echo "  --- 这些 post 的 place 名字 ---"
P "select coalesce(p.body,'<no body>') || '  ==>  place: ' || coalesce(pl.name,'<null>')
     from posts p left join places pl on pl.id = p.place_id
    where p.place_id is not null"

echo
echo "=== 3) 测试残留行的精确计数与形态 ==="
P "select 'residue_同名地点=' || count(*)::text from places where name like '同名地点%'"
P "select 'real_rows=' || count(*)::text from places where name not like '同名地点%'"
echo "  --- 非残留行 ---"
P "select name || ' | ' || coalesce(address,'<null>') || ' | ' || latitude::text || ',' || longitude::text
     from places where name not like '同名地点%'"

echo
echo "=== 4) 这 23 行是否被任何 post 引用（决定能否直接删）==="
P "select 'residue_referenced_by_posts=' || count(*)::text
     from posts p join places pl on pl.id = p.place_id
    where pl.name like '同名地点%'"

echo
echo "=== 5) mock 的 6 个地点名在 places 里是否存在 ==="
for n in 阳光操场 教育超市 图书馆 逸夫教学楼 思源楼 学苑公寓; do
  C="$(P "select count(*)::text from places where name = '$n'" | tr -d '\n')"
  echo "  $n : ${C:-?} 行"
done

echo
echo "=== 6) 结论（自动判定）==="
REF="$(P "select count(*)::text from posts p join places pl on pl.id=p.place_id where pl.name like '同名地点%'" | tr -d '\n')"
echo "  残留被 posts 引用数 = ${REF:-?}"
if [ "${REF:-1}" = "0" ]; then
  echo "  ⇒ 残留**没有被引用** → 理论上可安全删除（仍需人工确认后执行；本脚本只读不删）。"
else
  echo "  ⇒ ⚠️ 残留**被引用** → 不能直接删；需先决定那些 post 的归属。"
fi
echo "  ⚠️ 提醒：本脚本**只诊断、不删除**。删除是破坏性操作，须单独立项并显式执行。"
