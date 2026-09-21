#!/usr/bin/env bash
# M4 BACKUP_MUTATION_BARRIER —— **端到端**断言（把上一轮标注的"弱证据"补成机械证据）
#
# 上一轮 verify-backup-barrier.sh 只证明了**机制层**（共享锁在窗口内阻塞超时、
# 窗口后立即成功），并如实标注了两条弱证据：
#   1. HTTP 层在窗口内返回 503 —— 未断言
#   2. cleanup --apply 在窗口内退出码 3 且不删文件 —— 未断言
# 本脚本补这两条。做法：持排他锁期间用**真实会话**打真实接口。
#
# 断言：
#   E1 窗口内 POST /api/media        → **503**（backup_in_progress）
#   E2 窗口内 cleanup --apply        → **退出码 3**，且**盘上文件数不变**（fail-closed）
#   E3 窗口结束后同样的上传           → **201**（证明窗口外恢复正常，不是把功能弄坏）
#   E4 窗口内读接口 GET /api/posts    → **200**（读不受影响，这是设计的一部分）
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

BASE=http://127.0.0.1
KEY=1295258177
UP=/srv/campus/uploads
NODE=/opt/node-v24.21.0-linux-x64/bin/node
SINK=/run/campus/login-codes
export PGPASSWORD="$(cat /srv/campus/.db_password)"
PSQL() { psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
count_files() { find "$UP/public" "$UP/private" -type f 2>/dev/null | wc -l; }

echo "=== 准备：一个真实会话 + 一份真实图片 ==="
PH="138$(printf '%08d' $((RANDOM*RANDOM%100000000)))"
REQ="$(curl -s -m 10 -X POST "$BASE/api/auth/request-code" -H 'Content-Type: application/json' -d "{\"phone\":\"$PH\"}")"
SINKF="$(printf '%s' "$REQ" | sed -n 's/.*"sink":"\([^"]*\)".*/\1/p')"
CODE="$(sed -n 's/.*"code": *"\([0-9]*\)".*/\1/p' "$SINKF" 2>/dev/null)"
TOK="$(curl -s -m 10 -X POST "$BASE/api/auth/verify-code" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PH\",\"code\":\"$CODE\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
UID_="$(PSQL "select id from users where phone_e164='+86$PH'")"
[ -n "$TOK" ] && ok "真实会话就绪（$PH）" || { bad "登录失败，无法继续"; exit 1; }

# 用盘上已有的种子 PNG 当上传体（它本来就是合法图片）
IMG="$UP/public/2026/09/seed-lemy-1.png"
[ -f "$IMG" ] && ok "测试图片就绪（$(stat -c %s "$IMG") 字节的真实 PNG）" || { bad "缺测试图片 $IMG"; exit 1; }

upload() {   # $1 = requestId
  curl -s -o /dev/null -w '%{http_code}' -m 20 -X POST "$BASE/api/media" \
    -H "Authorization: Bearer $TOK" \
    -F "file=@$IMG;type=image/png" -F 'purpose=post' -F "uploadRequestId=$1"
}

echo
echo "=== 开一个 12 秒的排他窗口（模拟备份）==="
psql -h 127.0.0.1 -U campus -d campus -q -c "select pg_advisory_lock($KEY)" -c "select pg_sleep(12)" -c "select pg_advisory_unlock($KEY)" >/tmp/m4-e2e-holder.log 2>&1 &
HOLDER=$!
sleep 2
INLOCK="$(PSQL "select count(*) from pg_locks where locktype='advisory' and granted and objid=$KEY")"
[ "$INLOCK" != "0" ] && ok "排他窗口已生效（pg_locks 可见）" || bad "排他锁没拿到，后面断言无意义"

echo
echo "=== E1 窗口内 POST /api/media 必须 503 ==="
C1="$(upload "e2e-window-$(date +%s)")"
[ "$C1" = "503" ] && ok "**窗口内上传 → 503**（备份窗口内写操作被明确拒绝，而不是静默成功）" \
  || bad "窗口内上传期望 503，实际 $C1"

echo
echo "=== E4 窗口内读接口必须不受影响 ==="
C4="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$BASE/api/posts")"
[ "$C4" = "200" ] && ok "窗口内读帖子 → 200（**读路径不加锁**，设计如此）" || bad "窗口内读失败（$C4）"

echo
echo "=== E2 窗口内 cleanup --apply 必须退出码 3 且不删文件 ==="
BEFORE="$(count_files)"
sudo -u campus bash -c "set -a; . /srv/campus/server.env; set +a; $NODE /srv/campus/server/dist/cleanup.mjs --apply --max-age-hours 0" >/tmp/m4-e2e-cleanup.log 2>&1
RC=$?
AFTER="$(count_files)"
[ "$RC" = "3" ] && ok "**cleanup 在窗口内退出码 3**（备份窗口内被挡，明确可识别）" \
  || bad "cleanup 期望退出码 3，实际 $RC（输出：$(head -c 120 /tmp/m4-e2e-cleanup.log)）"
[ "$BEFORE" = "$AFTER" ] && ok "**文件数未变（$BEFORE）—— fail-closed，一个都没删**" \
  || bad "窗口内竟然删了文件（$BEFORE → $AFTER）"

wait $HOLDER 2>/dev/null || true
sleep 1

echo
echo "=== E3 窗口结束后上传必须恢复 201 ==="
RID="e2e-after-$(date +%s)"
C3="$(upload "$RID")"
[ "$C3" = "201" ] && ok "**窗口结束后上传 → 201（写入恢复，屏障不会锁死功能）**" \
  || bad "窗口结束后上传期望 201，实际 $C3"

echo
echo "=== 清理（用真实接口产生的那条 media 连文件一起删）==="
MID="$(PSQL "select id from media where upload_request_id='$RID'")"
if [ -n "$MID" ]; then
  K="$(PSQL "select scope || '/' || storage_key from media where id='$MID'")"
  [ -n "$K" ] && rm -f "$UP/$K"
  PSQL "delete from media where id='$MID'" >/dev/null
  ok "测试 media 已清理"
else
  ok "无需清理（窗口内那次没有产生 media）"
fi
PSQL "delete from sessions where user_id='$UID_'" >/dev/null
PSQL "delete from login_challenges where phone_e164='+86$PH'" >/dev/null
PSQL "delete from users where id='$UID_'" >/dev/null
rm -f "$SINK"/*.json 2>/dev/null || true
ok "测试账号已清理"

echo
if [ "$FAILED" -eq 0 ]; then echo "BARRIER_E2E_RESULT PASS"; else echo "BARRIER_E2E_RESULT FAIL"; fi
exit "$FAILED"
