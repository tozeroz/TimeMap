#!/usr/bin/env bash
# 输出 seed 两篇帖子的权威计数，供 Gate 做"UI 与数据库一致"的比对。
# 单独成文件的原因：Gate 里内联这段 shell 时引号会被 PowerShell → ssh → bash 三层解析吃掉，
# 结果是 psql 报错、拿到垃圾数据（Gate 曾因此把 Slice 2 判成 FAIL）。
# 本项目其它远端脚本都走"文件 + base64"这条路，这里保持一致。
set -uo pipefail
export PGPASSWORD="$(cat /srv/campus/.db_password)"
P1=aaaaaaaa-0001-4001-8001-000000000001
P2=aaaaaaaa-0002-4002-8002-000000000002
q() { psql -h 127.0.0.1 -U campus -d campus -Atc "$1"; }
for p in "$P1" "$P2"; do
  l="$(q "select count(*) from likes where post_id = '$p'")"
  c="$(q "select count(*) from comments where post_id = '$p'")"
  printf 'COUNTS %s likes=%s comments=%s\n' "$p" "$l" "$c"
done
