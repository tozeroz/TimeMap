#!/usr/bin/env bash
# 输出"声明支持的消息类型"（权威来源 = DB 约束 messages_kind_allowed）
# 只读。输出为逗号分隔的 kind 列表，便于直接传给 gate 的 --kinds。
set -u
PW="$(cat /srv/campus/.db_password)"
DEF="$(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "select pg_get_constraintdef(oid) from pg_constraint where conname='messages_kind_allowed'")"
echo "约束定义: $DEF" >&2
# 从 "CHECK ((kind = ANY (ARRAY['text'::text, 'image'::text, 'voice'::text])))" 里抽出取值
KINDS="$(printf '%s' "$DEF" | grep -o "'[a-z]*'::text" | sed "s/'//g; s/::text//g" | paste -sd, -)"
echo "$KINDS"
