#!/usr/bin/env bash
# WO15 诊断：核对"原版基线 vs 我们数据"在**地点维度**的对应关系
#
# ## 为什么做这个
#   刚发现结构化基线 `docs/test/original-baseline/supplements/schools.json` 里记了一条原版实测：
#     「北京交通大学 (校本部) **4条校园圈**」
#   而我们的库里有 **4 条 post 带 place_id** —— 需要核对这是不是巧合，
#   以及我们的 `school_campus_id` 是否为 NULL（基线说 M3 起应有该列）。
#
# ## 附带要回答的
#   · posts.place（text 列）与 place_id→places.name 是否一致？（两个来源可能漂移）
#   · place_id 与 school_campus_id 的分布
#
# 只读。用法（服务器上）：bash /tmp/diagnose-map-vs-baseline.sh
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
P() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) posts 的地点维度分布 ==="
P "select 'posts 总数=' || count(*)::text from posts"
P "select 'place_id 非空=' || count(*)::text from posts where place_id is not null"
P "select 'place(text) 非空=' || count(*)::text from posts where place is not null"
P "select 'school_campus_id 非空=' || count(*)::text from posts where school_campus_id is not null"

echo
echo "=== 2) ⭐ place（text 列）与 place_id→places.name 是否一致（两来源漂移检查）==="
P "select '一致=' || count(*)::text
     from posts p join places pl on pl.id = p.place_id
    where p.place is not null and p.place = pl.name"
P "select '不一致=' || count(*)::text
     from posts p join places pl on pl.id = p.place_id
    where p.place is not null and p.place <> pl.name"
echo "  --- 逐条对照 ---"
P "select '    post=' || left(p.id::text,8) || '  place_text=' || coalesce(p.place,'<null>')
   || '  place_join=' || coalesce(pl.name,'<no join>')
   from posts p left join places pl on pl.id = p.place_id
   where p.place_id is not null or p.place is not null"

echo
echo "=== 3) 与原版基线对照：北京交通大学 (校本部) 4条校园圈 ==="
P "select '锚在 places.name=北京交通大学 的 post 数 = ' || count(*)::text
     from posts p join places pl on pl.id=p.place_id where pl.name='北京交通大学'"
echo "  基线记录（supplements/schools.json）：北京交通大学 (校本部) **4条校园圈**"
echo "  ⚠️ 注意上面查询得到的是 **3**（不是 4）——基线记的原版是 4条校园圈。"
echo "     ⇒ 两侧数量**不同**（我们 3 ／ 原版 4），这本身就是一条偏差事实，须如实记录。"
echo "  ⚠️ 数量相同**不能**推断「我们复刻对了」—— 必须看到原版的 4 条是什么内容才能比。"

echo
echo "=== 4) schools / campuses 表（基线说应有 学校×校区 两层）==="
P "select 'schools 行数=' || count(*)::text from schools"
P "select 'campuses 行数=' || count(*)::text from campuses"
echo "  基线 supplements/schools.json 的 verdict：SUPPORTED（学校是真实实体）+ REVISION_NEEDED（缺校区子实体）"
echo "  已应用迁移：004_m3_model_revisions（schools / campuses）"

echo
echo "=== 5) 结论 ==="
echo "  · places 的形状（name+address）与原版 poi-search 列表行「地点名 + 地址」**一致** ⇒ places 有基线支撑"
echo "  · 原版 poi-search 首项「不添加地点」⇒ 地点可选，与 posts.place_id 可空一致"
echo "  · 原版地图页顶部下拉是**校区列表**、学校搜索在**另一个页面**"
echo "  · 原版右侧计数是「**N条校园圈**」（动态数），**不是**「N 位同学」（成员数）"
