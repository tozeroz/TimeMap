#!/usr/bin/env bash
# 诊断：门禁残留导致 users 3→8、media 3→9 的漂移（只读）
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) 全部用户（看哪些不是三个种子账号）==="
PSQL "select coalesce(phone_e164,'<null>') || ' | ' || display_name
        || ' | created=' || to_char(created_at,'MM-DD HH24:MI')
        || ' | posts=' || (select count(*) from posts p where p.author_id=u.id)
        || ' | msgs=' || (select count(*) from messages m where m.sender_id=u.id)
        from users u order by created_at"

echo
echo "=== 2) 三个种子账号是谁（按已知手机号）==="
PSQL "select phone_e164 || ' = ' || display_name from users
        where phone_e164 in ('+8613800000001','+8613800000002','+8613800000003') order by phone_e164"

echo
echo "=== 3) media 的来源分布（哪些是种子、哪些是门禁造的）==="
PSQL "select 'scope=' || scope || ' mime=' || mime || ' owner=' || left(coalesce(owner_user_id::text,'<null>'),8)
        || ' created=' || to_char(created_at,'MM-DD HH24:MI')
        || ' referenced=' || (select count(*) from post_media pm where pm.media_id = m.id)
                         + (select count(*) from message_media mm where mm.media_id = m.id)
        from media m order by created_at"

echo
echo "=== 4) 门禁是否清理自己造的账号？看 m5 脚本里的 cleanup 痕迹 ==="
grep -l 'delete from users\|delete from media' /tmp/m5/*.sh 2>/dev/null | sed 's/^/  含删除语句: /' || echo "  （/tmp/m5 下没有脚本包含 delete from users/media）"

echo
echo "=== 5) 这些残留账号/媒体是否**影响任何 Gate 断言**？==="
echo "  --- M5 gate 里与 users/media 总数相关的断言 ---"
grep -n -E 'users|media' /tmp/gate-m5.sh 2>/dev/null | grep -E 'count|总数|baseline|BASELINE' | head -12 | sed 's/^/    /'
