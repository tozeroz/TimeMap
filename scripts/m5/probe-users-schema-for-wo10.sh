#!/usr/bin/env bash
# WO#10 前置：MessageScreen 剩余 mock 区域的**字段级 inventory**（只读）
#
# 审核记录 50 要求：报计划时先做字段级 inventory，而不是以"把卡片所有字段都接真"为目标。
#   field → 当前来源 → 是否有权威来源 → 可写/只读 → 若无来源：hide / defer / 显式 redesign
# 并明确：**不得**因为工作单叫"去 mock"就临时给学校/学院/年级/头像造数据库字段。
#
# 本脚本只**查事实**（表结构 + 现有接口），不做任何设计决定、不写库。
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) users 表有哪些列（决定"权威来源是否存在"）==="
PSQL "select column_name || ' | ' || data_type || ' | nullable=' || is_nullable
        from information_schema.columns where table_name='users' order by ordinal_position"

echo
echo "=== 2) users 表的实际数据（看哪些列真的有值）==="
PSQL "select id || ' | ' || handle || ' | ' || display_name || ' | ' || phone_e164
        from users order by phone_e164"

echo
echo "=== 3) 是否存在 profile / 资料类表 ==="
PSQL "select table_name from information_schema.tables
        where table_schema='public' and (table_name like '%profile%' or table_name like '%user%')
        order by table_name"

echo
echo "=== 4) 现有接口清单（与"用户资料/推荐"相关的）==="
echo "  （从源码里核对，避免凭记忆）"
