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
KEY=1295270465
UP=/srv/campus/uploads
NODE=/opt/node-v24.21.0-linux-x64/bin/node
SINK=/run/campus/login-codes
export PGPASSWORD="$(cat /srv/campus/.db_password)"
PSQL() { psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
count_files() { find "$UP/public" "$UP/private" -type f 2>/dev/null | wc -l; }

echo "=== E0 两侧锁键必须一致（**这条不能靠人记，必须机械核对**）==="
# 踩过的坑：我曾在脚本里把 0x4D344241 误算成 1295270465，
# 于是 holder 与被测方用了**不同的键** → 机制层测试照样 PASS
# （因为两侧用同一个错键也会互相阻塞），但**生产里屏障其实不生效**。
# 这类"测试通过但证明了错的东西"最危险，所以把"键一致"做成断言。
# 从**部署产物**里取键（服务器上只有 dist/，没有 src/ —— 上一版写成 src 路径导致取空、假失败）。
# 打包后常量以内联字面量出现，例如 `4d344241` 的十进制 1295270465。
APP_KEY="$(grep -o '1295270465' /srv/campus/server/dist/index.mjs | head -1)"
[ -n "$APP_KEY" ] || APP_KEY="$(grep -oE 'pg_advisory_xact_lock_shared\([0-9]+\)' /srv/campus/server/dist/index.mjs | grep -oE '[0-9]+' | head -1)"
if [ "$APP_KEY" = "$KEY" ]; then
  ok "脚本锁键与应用侧一致（$KEY）"
else
  bad "**锁键不一致**：脚本 $KEY ≠ 应用 $APP_KEY —— 屏障在真实运行时不会生效"
fi
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
  # ⚠ uploadRequestId **必须是 UUID**（服务端校验 /^[0-9a-f-]{36}$/i）。
  # 上一版传的是 e2e-window-<epoch>，不是 UUID → 400 bad_upload_request_id，
  # 而且 400 发生在取锁**之前**，所以那两条断言根本没触及屏障。
  curl -s -o /dev/null -w '%{http_code}' -m 20 -X POST "$BASE/api/media" \
    -H "Authorization: Bearer $TOK" \
    -F "file=@$IMG;type=image/png" -F 'purpose=post' -F "uploadRequestId=$1"
}

echo
echo "=== 开一个 25 秒的排他窗口（模拟备份）==="
# ⚠ 窗口必须**显著长于**业务侧的锁等待上限（mutationBarrier.ts 的 LOCK_TIMEOUT_MS=5s）。
# 踩过的坑：上一版窗口只有 12 秒，而 E1 的上传本身会阻塞 5 秒，
# 轮到 E2 时窗口只剩不到 5 秒 → cleanup 等到窗口结束拿到锁 → 正常退出 0。
# 那是**正确行为**（窗口外放行），但会让"必须退 3"的断言变成时序运气。
# 让窗口 > 超时，E2 才是确定性断言。
psql -h 127.0.0.1 -U campus -d campus -q -c "select pg_advisory_lock($KEY)" -c "select pg_sleep(25)" -c "select pg_advisory_unlock($KEY)" >/tmp/m4-e2e-holder.log 2>&1 &
HOLDER=$!
sleep 2
INLOCK="$(PSQL "select count(*) from pg_locks where locktype='advisory' and granted and objid=$KEY")"
[ "$INLOCK" != "0" ] && ok "排他窗口已生效（pg_locks 可见）" || bad "排他锁没拿到，后面断言无意义"

echo
echo "=== E1 窗口内 POST /api/media 必须 503 ==="
C1="$(upload "$(cat /proc/sys/kernel/random/uuid)")"
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
RID="$(cat /proc/sys/kernel/random/uuid)"
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
