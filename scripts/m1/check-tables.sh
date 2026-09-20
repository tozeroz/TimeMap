#!/usr/bin/env bash
# 列出 public schema 下的表（M1 SCOPE 用：确认没悄悄多出业务表）。
# 单独写成脚本而不是在 PowerShell 里拼 ssh 命令行：
# 嵌套引号会被 PowerShell 和 ssh 各吃一层，psql 最后收到的是一堆被拆散的参数
# （表现为 "extra command-line argument ... ignored"），这类失败很难从报错里看出根因。
export PGPASSWORD="$(cat /srv/campus/.db_password)"
psql -h 127.0.0.1 -U campus -d campus -Atc \
  "select tablename from pg_tables where schemaname='public' order by 1"
