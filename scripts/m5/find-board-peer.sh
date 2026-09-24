#!/usr/bin/env bash
# 找出"留言板双方"的 userId（供 gate-board-note-avatar.mjs 用 WO_BOARD_PEER_ID 指定）
#
# 背景（本脚本存在的原因）：
#   留言板是**按 peer 的双方留言**（`GET/POST /api/board-notes/:userId`），
#   所以门禁必须知道"对方是谁"才能取到样本。
#   我第一版把端点写成 `/api/board-notes` → 404 → 样本没建立 → Gate 记 INCONCLUSIVE。
#
# 只读。用法（服务器上）：bash /tmp/find-board-peer.sh
set -uo pipefail
PW="$(cat /srv/campus/.db_password)"
P() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }

echo "=== board_notes 的双方（from → to）==="
P "select '  ' || fu.display_name || ' (' || left(b.from_user_id::text,8) || ')'
   || '  →  ' || tu.display_name || ' (' || left(b.to_user_id::text,8) || ')'
   || '   id=' || left(b.id::text,8)
   from board_notes b
   join users fu on fu.id = b.from_user_id
   join users tu on tu.id = b.to_user_id
   order by b.created_at"

echo
echo "=== 三个用户（用于挑 peer）==="
P "select '  ' || display_name || '  id=' || id::text || '  phone=' || coalesce(phone_e164,'<null>')
     from users order by created_at"

echo
echo "=== 说明 ==="
echo "  · 登录账号若是 A、peer 填 B，则板上有 A→B 与 B→A 的留言（双方都能看到同一块板）"
echo "  · 门禁需要「我」与「对方」两类同时存在（mine=true / false）"
echo "  · 若只有一条，门禁会用 POST 补一条「我」的（写我们自己的库，合规）"
