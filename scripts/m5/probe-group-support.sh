#!/usr/bin/env bash
# WO#9A 前提前置核查（只读）：后端在多大程度上已经支持"群聊"？
#
# 为什么先查这个：WO#9A 的范围取决于后端已有多少。
# 若 kind 约束已允许 'group'、成员表与读模型都不假设"只有 2 人"，
# 那就只是"造种子 + 接前端"；否则要先改 schema/读模型（范围大得多）。
set -u
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) message_threads 的约束（kind 允许哪些值？）==="
PSQL "select conname || ' : ' || pg_get_constraintdef(oid) from pg_constraint where conrelid='message_threads'::regclass order by conname"
echo
echo "=== 2) message_threads 的列定义（is_nullable 取自 information_schema，不自己拼字符串）==="
# ⚠️ 本行第一版写错过：`coalesce(' NOT NULL','')` **永远**返回 ' NOT NULL'，
#    于是无论真实可空性如何都会打印 NOT NULL（我当时据此差点误判 title 不可空）。
#    现在直接读 information_schema.is_nullable —— 权威值，不自己拼。
PSQL "select column_name || ' ' || data_type || ' nullable=' || is_nullable
        from information_schema.columns where table_name='message_threads' order by ordinal_position"
echo "  ⚠️ 可空性以 information_schema.is_nullable 为准；约束列表（上一节）里没有 title_not_null"
echo "     —— 与实测 title 可以为 NULL 一致"
echo
echo "=== 3) thread_members 的约束（是否限制成员数/角色？）==="
PSQL "select conname || ' : ' || pg_get_constraintdef(oid) from pg_constraint where conrelid='thread_members'::regclass order by conname"
PSQL "select column_name || ' ' || data_type from information_schema.columns where table_name='thread_members' order by ordinal_position"
echo
echo "=== 4) 现有数据 ==="
PSQL "select 'threads: ' || string_agg(kind || '=' || cnt, ', ') from (select kind, count(*)::text as cnt from message_threads group by kind) x"
echo
echo "=== 5) 读模型/接口里是否假设了"两人会话" ==="
echo "  （这一项需要在源码里核，脚本只列 SQL 侧）"
PSQL "select 'thread_members 行数 = ' || count(*)::text from thread_members"

echo
echo "=== 6) 迁移文件里与 thread 相关的部分 ==="
ls -1 /srv/campus/server/migrations/ 2>/dev/null | head -20
