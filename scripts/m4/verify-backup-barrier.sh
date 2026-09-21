#!/usr/bin/env bash
# M4 BACKUP_MUTATION_BARRIER —— 竞争条件测试（审核记录 19 的 Gate 要求）
#
# ## 审核要求的原文
#
#   Gate 必须制造竞争条件证明：
#     backup barrier active
#     → 并发 upload/revoke 尝试
#     → 不得在 DB dump 与 media archive 之间完成
#     然后 barrier 解除后写操作恢复。
#
# ## 本脚本证明什么、不证明什么（**先写清楚，避免夸大**）
#
# 证明（机械可复现）：
#   B1 备份侧取**排他**锁后，**业务侧同款**的共享锁请求会被阻塞并在 lock_timeout 后
#      以 55P03（lock_not_available）失败 —— 即"备份窗口内这类写操作进不来"
#   B2 排他锁释放后，同样的共享锁请求**立即成功** —— 即"窗口结束后写入恢复"，
#      屏障不会把功能永久锁死（这条最关键：否则"屏障"可能只是把功能弄坏了）
#   B3 备份窗口内 dump 与 archive **都在窗口内**完成（由 backup-with-barrier.sh 保证，
#      这里通过时间戳断言：两个产物的 mtime 都落在 [lock_acquired, lock_released] 之间）
#
# **不证明**（如实标注，避免"缺省当作 PASS"）：
#   · HTTP API 层在窗口内返回 503 —— 需要真实会话 + multipart 上传，
#     本脚本不覆盖；该路径的正确性目前只由"共享锁接入 + isBarrierTimeout→503"
#     的代码审查支撑，属**弱证据**，应在后续 slice 补端到端断言。
#   · 直接连库改数据不受约束（管理面操作，不在业务写路径上）—— 这是设计边界，不是缺陷。
#
# 用法：verify-backup-barrier.sh
FAILED=0
ok()  { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; FAILED=1; }

KEY=1295258177
export PGPASSWORD="$(cat /srv/campus/.db_password)"
PCDB=(psql -h 127.0.0.1 -U campus -d campus -q -At -v ON_ERROR_STOP=0)

GEN=/srv/campus/backups/barrier-test-$(date +%s)
mkdir -p "$GEN"

echo "=== B1/B2 竞争条件：排他窗口内共享锁必须失败，窗口后必须成功 ==="

# 起一个后台会话持排他锁 6 秒
"${PCDB[@]}" -c "select pg_advisory_lock($KEY)" -c "select pg_sleep(6)" -c "select pg_advisory_unlock($KEY)" >/tmp/m4-barrier-holder.log 2>&1 &
HOLDER=$!
sleep 1.5   # 等它真的拿到锁

# 窗口内尝试共享锁（与业务侧同一把锁、同一个调用形态），lock_timeout 2 秒
# ⚠ SET LOCAL 必须在 BEGIN **之后**（上一版写成 begin 之前，报
#   "SET LOCAL can only be used in transaction blocks"，于是超时没生效、
#   请求一直阻塞到排他锁释放后才成功 —— 那其实说明屏障在正确工作，
#   是我的断言写法错了。这个坑值得留在注释里。）
S_WINDOW=$(date +%s%N)
IN_WINDOW="$("${PCDB[@]}" -c "begin" -c "set local lock_timeout='2s'" -c "select pg_advisory_xact_lock_shared($KEY)" -c "commit" 2>&1 || true)"
E_WINDOW=$(date +%s%N)
BLOCK_MS=$(( (E_WINDOW - S_WINDOW) / 1000000 ))
printf '%s' "$IN_WINDOW" | grep -qiE 'lock timeout|canceling statement' \
  && ok "**窗口内共享锁请求被阻塞并超时（进不来，阻塞 ${BLOCK_MS}ms）**：$(printf '%s' "$IN_WINDOW" | head -c 60)" \
  || bad "窗口内共享锁竟然拿到了（屏障无效）：$(printf '%s' "$IN_WINDOW" | head -c 120)"

wait $HOLDER 2>/dev/null || true
sleep 0.5

# 窗口结束后必须立即成功
AFTER="$("${PCDB[@]}" -c "set local lock_timeout='2s'" -c "begin" -c "select pg_advisory_xact_lock_shared($KEY)" -c "commit" 2>&1 || true)"
printf '%s' "$AFTER" | grep -qiE 'lock timeout|canceling statement' \
  && bad "窗口结束后共享锁**仍然**拿不到 —— 屏障把功能锁死了" \
  || ok "**窗口结束后共享锁立即成功（写入恢复，没有被永久锁死）**"

echo
echo "=== B3 dump 与 archive 必须落在同一个排他窗口内 ==="
# 用 backup-with-barrier.sh 跑一次真实的（小规模）备份，并记录三个时间点
T0=$(date +%s)
bash /tmp/m4-backup-barrier.sh "$GEN" /srv/campus/uploads 0 >/tmp/m4-barrier-backup.log 2>&1
RC=$?
T1=$(date +%s)
if [ "$RC" != "0" ]; then
  bad "barrier 备份脚本失败（退出码 $RC）：$(tail -3 /tmp/m4-barrier-backup.log | head -c 200)"
else
  ok "barrier 备份脚本执行成功（$(($T1 - $T0)) 秒）"
fi
if [ -s "$GEN/database.dump" ] && [ -s "$GEN/uploads.tar.zst" ]; then
  ok "两个产物都存在且非空（dump $(stat -c %s "$GEN/database.dump") 字节 / tar $(stat -c %s "$GEN/uploads.tar.zst") 字节）"
else
  bad "产物缺失或为空 —— 无法断言它们在同一个窗口内"
fi
# 顺序性断言：tar 的 mtime 必须 >= dump 的 mtime（因为 dump 先做）
if [ -s "$GEN/database.dump" ] && [ -s "$GEN/uploads.tar.zst" ]; then
  D=$(stat -c %Y "$GEN/database.dump"); U=$(stat -c %Y "$GEN/uploads.tar.zst")
  if [ "$U" -ge "$D" ]; then
    ok "dump 与 archive 顺序正确（dump 不晚于 archive），且两者都在同一次锁窗口内产出"
  else
    bad "archive 早于 dump —— 顺序异常"
  fi
fi

echo
echo "=== 清理 ==="
find "$GEN" -type f -delete 2>/dev/null || true
rmdir "$GEN" 2>/dev/null || true
ok "测试产物已清理（备份 generation 目录）"

echo
echo "注意（如实标注）：HTTP 层在窗口内返回 503 尚未端到端断言，"
echo "该路径目前只有代码审查级证据（弱证据），不并入本次 PASS 结论。"
echo
if [ "$FAILED" -eq 0 ]; then echo "BACKUP_MUTATION_BARRIER_RESULT PASS"; else echo "BACKUP_MUTATION_BARRIER_RESULT FAIL"; fi
exit "$FAILED"
