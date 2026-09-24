#!/usr/bin/env bash
# 只读：列出当前库里的"非种子残留"，供精确清理（不删任何东西）
set -u
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
SEED="'+8613800000001','+8613800000002','+8613800000003'"

echo "=== 种子用户（不动）==="
PSQL "select phone_e164 || ' | ' || coalesce(display_name,'-') from users where phone_e164 in ($SEED)"

echo
echo "=== 非种子用户（测试账号）==="
PSQL "select phone_e164 || ' | ' || coalesce(display_name,'-') || ' | ' || to_char(created_at,'MM-DD HH24:MI') from users where phone_e164 not in ($SEED) order by created_at"

echo
echo "=== 全部消息（含发送者，用于识别非种子发送者）==="
PSQL "select m.id || ' | kind=' || m.kind || ' | sender=' || coalesce(u.display_name,'(null)') || '/' || coalesce(u.phone_e164,'-') || ' | ' || to_char(m.created_at,'MM-DD HH24:MI') || ' | ' || left(coalesce(m.body,''),14) from messages m left join users u on u.id = m.sender_id order by m.created_at"

echo
echo "=== 全部 media（含 owner，用于识别非种子 owner）==="
PSQL "select md.id || ' | ' || md.scope || ' | owner=' || coalesce(u.display_name,'(null)') || ' | ' || md.width || 'x' || md.height || ' | ' || md.bytes || 'B | ' || to_char(md.created_at,'MM-DD HH24:MI') from media md left join users u on u.id = md.owner_user_id order by md.created_at"

echo
echo "=== 引用关系 ==="
PSQL "select mm.message_id || ' -> ' || mm.media_id || ' (' || mm.media_scope || ')' from message_media mm"

echo
echo "=== 板留言 ==="
PSQL "select bn.id || ' | from=' || coalesce(f.display_name,'(null)') || ' | to=' || coalesce(t.display_name,'(null)') || ' | ' || to_char(bn.created_at,'MM-DD HH24:MI') from board_notes bn left join users f on f.id=bn.from_user_id left join users t on t.id=bn.to_user_id"
