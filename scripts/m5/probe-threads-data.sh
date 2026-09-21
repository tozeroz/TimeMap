#!/usr/bin/env bash
# 只读核查：/api/threads 的字段在真实数据上长什么样（决定"消息列表"能否渲染出姓名）
set -u
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) 会话表：id / kind / title / 成员数 / 最后消息 ==="
PSQL "select t.id || ' | kind=' || t.kind || ' | title=' || coalesce(t.title,'<NULL>') ||
             ' | members=' || (select count(*) from thread_members m where m.thread_id=t.id)::text ||
             ' | last=' || coalesce((select left(m2.body,24) from messages m2 where m2.thread_id=t.id and m2.deleted_at is null order by m2.created_at desc limit 1), '<无>')
        from message_threads t order by t.created_at"

echo
echo "=== 2) 每个会话的成员（谁在里面）==="
PSQL "select t.id || '  ↔  ' || u.display_name || ' (' || u.phone_e164 || ')'
        from message_threads t
        join thread_members tm on tm.thread_id = t.id
        join users u on u.id = tm.user_id
       order by t.id, u.display_name"

echo
echo "=== 3) 当前登录身份（演示账号）==="
PSQL "select id || ' | ' || display_name || ' | ' || phone_e164 || ' | ' || coalesce(school,'<无学校>') from users order by phone_e164"

echo
echo "=== 4) 结论用：direct 会话的 title 是否为空 ==="
PSQL "select 'direct 且 title 为空的数量 = ' || count(*)::text from message_threads where kind='direct' and title is null"
PSQL "select 'group 会话数量 = ' || count(*)::text from message_threads where kind='group'"
