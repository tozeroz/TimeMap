#!/usr/bin/env bash
# 在服务器上以 campus 用户跑 seed（与 systemd service 同一身份、同一环境变量来源）
#
# 为什么用脚本文件而不是一行 ssh 命令：
#   本项目反复踩过"嵌套引号/here-string 被 PowerShell 或 shell 吃掉"的坑，
#   凡是有引号、变量、重定向的组合，一律落成文件再执行。
set -euo pipefail

ENV_FILE=/srv/campus/server.env
NODE=/opt/node-v24.21.0-linux-x64/bin/node
SEED=/srv/campus/server/dist/seed.mjs

if [ ! -f "$ENV_FILE" ]; then echo "FATAL 缺 $ENV_FILE"; exit 2; fi
if [ ! -f "$SEED" ]; then echo "FATAL 缺 $SEED"; exit 2; fi

echo "=== 跑 seed 前的基线 ==="
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
PSQL "select 'users=' || (select count(*) from users) || ' threads=' || (select count(*) from message_threads) || ' members=' || (select count(*) from thread_members) || ' messages=' || (select count(*) from messages) || ' media=' || (select count(*) from media) || ' message_media=' || (select count(*) from message_media)"
PSQL "select 'group threads = ' || count(*)::text from message_threads where kind='group'"

echo
echo "=== 以 campus 身份跑 seed（环境变量取自 server.env）==="
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
# 明确 UPLOAD_ROOT（seed 默认就是它，这里写出来让日志可核对）
export UPLOAD_ROOT="${UPLOAD_ROOT:-/srv/campus/uploads}"

setpriv --reuid=campus --regid=campus --init-groups \
  env UPLOAD_ROOT="$UPLOAD_ROOT" DATABASE_URL="$DATABASE_URL" \
  "$NODE" "$SEED" 2>&1 | tail -25

echo
echo "=== 跑 seed 后的结果 ==="
PSQL "select 'users=' || (select count(*) from users) || ' threads=' || (select count(*) from message_threads) || ' members=' || (select count(*) from thread_members) || ' messages=' || (select count(*) from messages) || ' media=' || (select count(*) from media) || ' message_media=' || (select count(*) from message_media)"
echo "--- 群会话 ---"
PSQL "select t.id || ' | ' || t.kind || ' | title=' || coalesce(t.title,'<NULL>') || ' | members=' || (select count(*) from thread_members m where m.thread_id=t.id)::text || ' | msgs=' || (select count(*) from messages ms where ms.thread_id=t.id)::text from message_threads t where t.kind='group'"
echo "--- 群成员 ---"
PSQL "select u.display_name || ' (' || u.phone_e164 || ')' from thread_members tm join users u on u.id=tm.user_id where tm.thread_id='aaaaaaaa-0001-4001-8001-00000000000a' order by u.display_name"
echo "--- 群消息 ---"
PSQL "select m.kind || ' | ' || coalesce(u.display_name,'?') || ' | ' || left(m.body,30) from messages m left join users u on u.id=m.sender_id where m.thread_id='aaaaaaaa-0001-4001-8001-00000000000a' order by m.created_at, m.id"
echo "--- 群内图片媒体（应有 private 行 + message_media 关联）---"
PSQL "select md.id || ' | scope=' || md.scope || ' | ' || md.storage_key || ' | ' || md.mime || ' | ' || md.bytes::text || 'B' from media md where md.id='bbbbbbbb-0003-4003-8003-000000000003'"
PSQL "select 'message_media rows = ' || count(*)::text from message_media where message_id='aaaaaaaa-0006-4006-8006-00000000000f'"
echo "--- 实体文件是否真的落盘（防悬空引用）---"
ls -l /srv/campus/uploads/private/2026/09/seed-group-anmoss-1.png 2>&1
