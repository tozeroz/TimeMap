#!/usr/bin/env bash
# 核对服务器 DB 当前基线（只读）
# 用途：每次跑完 Gate 后确认"测试残留已清、种子口径未漂移"
#
# ## ⭐ 2026-09-22（WO14.5b）新增：**覆盖度审计**
#   起因是一次真实盲区：`places` 表里藏着 **22 行测试残留**（`同名地点<随机数>`，
#   假坐标 31.1,121.1 / 39.9,116.3），而本脚本**根本不查 places** ——
#   于是这批残留躲过了所有基线检查（直到 WO14.5 inventory 才偶然发现）。
#
#   教训不只是"补上 places"，而是**让"没被检查的表"显式可见**：
#   原先的输出会让人以为"基线只有这 8 张表"；实际库里有 20+ 张表，
#   未被覆盖的那些**不是"干净"，只是"没查"**。
#   ⇒ 所以本脚本现在会明确列出：已覆盖 N 张 ／ 未覆盖 M 张（并点名）。
#
#   ⚠️ 这仍是**部分覆盖**：本脚本不声称"未覆盖的表是干净的"。
#     它对残留的判定只对**已覆盖表**成立。
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 种子口径（WO#9A 起；WO14.5b 追加 places；Round 267 追加 schools/campuses/归属列）==="
PSQL "select 'users=' || (select count(*) from users)
      || ' message_threads=' || (select count(*) from message_threads)
      || ' thread_members=' || (select count(*) from thread_members)
      || ' messages=' || (select count(*) from messages)
      || ' media=' || (select count(*) from media)
      || ' message_media=' || (select count(*) from message_media)
      || ' message_mentions=' || (select count(*) from message_mentions)
      || ' board_notes=' || (select count(*) from board_notes)
      || ' places=' || (select count(*) from places)
      || ' schools=' || (select count(*) from schools)
      || ' campuses=' || (select count(*) from campuses)
      || ' posts_with_campus=' || (select count(*) from posts where school_campus_id is not null)
      || ' users_with_campus=' || (select count(*) from users where school_campus_id is not null)"
echo "  期望：users=3 message_threads=3 thread_members=5 messages=5 media=3 message_media=1 message_mentions=0 board_notes=1 places=2"
echo "        schools=0 campuses=0 posts_with_campus=0 users_with_campus=0"
echo "  （places 期望 2：北京交通大学 + 达美乐比萨(广州萝岗万达广场)——后者是**原版基线实测到**的地点）"
echo "  ⚠️ 为什么把 schools/campuses/归属列也纳入基线（Round 267 补）："
echo "     我做 PLACE_DOES_NOT_IMPLY_CAMPUS 的敏感度时造了 schools/campuses 行，"
echo "     而**撤销只删了 campuses、没删 schools** ⇒ 残留 1 行；"
echo "     当时本脚本**不含这几张表** ⇒ 残留**没被报出来**。"
echo "     ⇒ 与之前 places 22 行残留同一类教训：**清理不完整 + 检查未覆盖该表**。"
echo "     归属列期望全 0：审核 60 的计数策略 A —— 不得由 place 推断 campus 归属。"

echo
echo "=== WO#9B 新增列 / 标记分布 ==="
PSQL "select 'mentions_all=true 的消息数 = ' || count(*)::text from messages where mentions_all"
PSQL "select '列是否存在 = ' || count(*)::text from information_schema.columns where table_name='messages' and column_name='mentions_all'"

echo
echo "=== 测试残留检查（已知形态；任何 WO*- 前缀都应为 0）==="
PSQL "select 'WO%- 残留消息 = ' || count(*)::text from messages where body ~ '^WO[0-9A-Z]*-'"
# WO14.5b：places 的残留形态（本轮清掉的 22 行就是它）
# ⚠️ 注：上一行注释里我曾误插入一个**零宽空格**（U+200B），使 `places` 变成 `pl<U+200B>aces` ——
#    在注释里无害，但这类**不可见字符**是审查者永远看不出来的坑，故记下来。
PSQL "select 'places 同名地点残留 = ' || count(*)::text from places where name like '同名地点%'"
echo "  期望：两者都为 0（places 的 22 行已于 2026-09-22 清理，见 cleanup-places-residue.sh）"

echo
echo "=== ⭐ 覆盖度审计（让「没被检查的表」显式可见）==="
COVERED="users message_threads thread_members messages media message_media message_mentions board_notes places"
PSQL "select '库中表总数 = ' || count(*)::text
        from information_schema.tables
       where table_schema='public' and table_type='BASE TABLE'"
echo "  已纳入本口径的表（$COVERED）"
echo "  --- 未覆盖的表（⚠️ 不是「干净」，只是「没查」）---"
PSQL "select '    ' || table_name
        from information_schema.tables
       where table_schema='public' and table_type='BASE TABLE'
         and table_name not in ('users','message_threads','thread_members','messages','media',
                                'message_media','message_mentions','board_notes','places',
                                'schema_migrations')
       order by table_name"

echo
echo "=== 迁移状态 ==="
PSQL "select '已应用迁移 = ' || count(*)::text || ' ／ 最新 = ' || max(version) from schema_migrations"
