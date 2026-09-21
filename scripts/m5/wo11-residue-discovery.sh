#!/usr/bin/env bash
# WO#11 数据清理 —— **第 1~3 步：发现候选 / 逐个复核 ID / 依赖预览**（只读）
#
# 审核记录 52 授权的删除流程（必须逐步执行并留下痕迹）：
#   pattern discovers candidates
#   → exact 20 IDs reviewed
#   → dependency preview
#   → full pg_dump verified
#   → delete exact IDs in transaction
#   → deleted_count == 20
#   → canonical data remains intact
#
# 本脚本只做前三步（只读）；**不做任何删除**。
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== 1) pattern discovers candidates（用形态匹配，不是写死的 id 清单）==="
echo "  匹配形态："
echo "    · body LIKE 'M1-E2E-%'"
echo "    · body LIKE 'TLS 日志泄漏检查%'"
echo
echo "  --- 候选逐条列出（id / 作者 / 正文 / 时间 / 关联计数）---"
PSQL "select p.id::text
             || ' | author=' || coalesce(u.display_name,'<null>')
             || ' | comments=' || (select count(*) from comments c where c.post_id = p.id)
             || ' | likes='    || (select count(*) from likes l where l.post_id = p.id)
             || ' | media='    || (select count(*) from post_media pm where pm.post_id = p.id)
             || ' | ' || to_char(p.created_at,'MM-DD HH24:MI')
             || ' | ' || left(p.body, 40)
        from posts p left join users u on u.id = p.author_id
       where p.body like 'M1-E2E-%' or p.body like 'TLS 日志泄漏检查%'
       order by p.created_at"

echo
echo "=== 2) exact 20 IDs reviewed（数量与 ID 清单）==="
CNT="$(PSQL "select count(*) from posts where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%'")"
echo "  候选总数 = $CNT"
if [ "$CNT" = "20" ]; then
  echo "  PASS 与审核授权的数量（20）一致"
else
  echo "  ⚠️ 与审核授权的 20 **不一致** —— 必须停下来核对（不按当前数量直接删）"
fi
echo
echo "  --- 按形态分别计数 ---"
PSQL "select 'M1-E2E-* : ' || count(*)::text from posts where body like 'M1-E2E-%'"
PSQL "select 'TLS 日志泄漏检查* : ' || count(*)::text from posts where body like 'TLS 日志泄漏检查%'"

echo
echo "=== 3) dependency preview（这些帖子牵连了什么）==="
echo "  --- comments ---"
PSQL "select coalesce(string_agg(c.id::text, ', '), '<none>')
        from comments c join posts p on p.id = c.post_id
       where p.body like 'M1-E2E-%' or p.body like 'TLS 日志泄漏检查%'"
echo "  --- likes ---"
PSQL "select coalesce(string_agg(l.id::text, ', '), '<none>')
        from likes l join posts p on p.id = l.post_id
       where p.body like 'M1-E2E-%' or p.body like 'TLS 日志泄漏检查%'"
echo "  --- post_media（媒体引用）---"
PSQL "select coalesce(string_agg(pm.post_id::text || '→' || pm.media_id::text, ', '), '<none>')
        from post_media pm join posts p on p.id = pm.post_id
       where p.body like 'M1-E2E-%' or p.body like 'TLS 日志泄漏检查%'"

echo
echo "=== 3b) ⚠️ 关键安全检查：会不会牵连**非候选**数据 ==="
echo "  --- 候选帖子的媒体，是否还被**别的（非候选）帖子**引用？---"
PSQL "select coalesce(string_agg(x.media_id::text, ', '), '<none>')
        from (select distinct pm.media_id
                from post_media pm
               where pm.post_id in (select id from posts
                                     where body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%')
                 and pm.media_id in (select pm2.media_id from post_media pm2
                                      where pm2.post_id not in (select id from posts
                                                                 where body like 'M1-E2E-%'
                                                                    or body like 'TLS 日志泄漏检查%'))
             ) x"
echo "  （若上面是 <none> → 删帖不会让任何**非候选**帖子失去媒体）"

echo
echo "=== 3c) canonical data preview（删后应保留的\"规范数据\"）==="
PSQL "select '总帖数 = ' || count(*)::text from posts"
PSQL "select '非候选帖数 = ' || count(*)::text from posts
       where not (body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%')"
PSQL "select '用户数 = ' || count(*)::text from users"
PSQL "select '会话数 = ' || count(*)::text from message_threads"
PSQL "select '消息数 = ' || count(*)::text from messages"
PSQL "select 'media 总数 = ' || count(*)::text from media"
PSQL "select 'board_notes = ' || count(*)::text from board_notes"
echo
echo "  --- 非候选帖子的正文（逐条，作为\"将保留\"的清单）---"
PSQL "select left(id::text,8) || ' | ' || left(body, 46)
        from posts where not (body like 'M1-E2E-%' or body like 'TLS 日志泄漏检查%')
       order by created_at"

echo
echo "（本脚本不含任何 DELETE —— 删除在下一步单独执行，需先完成 pg_dump 校验）"
