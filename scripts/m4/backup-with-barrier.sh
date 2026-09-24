#!/usr/bin/env bash
# M4 BACKUP_MUTATION_BARRIER —— 在**排他** advisory 锁窗口内完成
# pg_dump 与 uploads 归档，使两者属于**同一个逻辑时刻**。
#
# ## 为什么需要它（审核记录 19 的 P0）
#
# 只做"备份前两侧一致检查"（PRE_BACKUP_CROSS_REFERENCE_INTEGRITY）挡不住：
#   pg_dump 完成 → 用户上传新图（DB 行 + 文件都成功）
#                → uploads.tar 把新文件收进去，但 pg_dump 里没有这条行
# 结果是数据库与媒体归档**各自内部正确，但不属于同一时刻**。
#
# ## 机制
#
# 备份侧：**会话级排他锁** `pg_advisory_lock(KEY)`
# 业务侧：**事务级共享锁** `pg_advisory_xact_lock_shared(KEY)`（见 server/src/mutationBarrier.ts）
#
# 共享锁挡不住排他锁的申请；排他锁会等待已持有的共享锁释放、并阻塞新的共享锁。
# 于是备份窗口内所有会改变 media 的业务写都被挡在外面。
#
# ## 为什么用 psql 会话 + \! 而不是分两条命令
#
# `pg_advisory_lock` 是**会话级**的：只要 psql 会话不退出，锁就一直有效。
# `\!` 在**同一个会话内**执行 shell 命令 —— 所以 dump 与 archive 都在窗口内。
# 若改成"先 psql 取锁、再另起进程 dump"，取锁的那个会话一退出锁就没了。
#
# 用法：backup-with-barrier.sh <generation_dir> <uploads_root> <lock_seconds_to_hold_after>
#   最后一个参数用于**竞争条件测试**：备份动作完成后再多持锁 N 秒，
#   方便 Gate 在窗口内发起并发 upload/revoke 并断言它们进不来。
#   正常备份传 0。
set -euo pipefail

GEN="${1:?用法: backup-with-barrier.sh <generation_dir> <uploads_root> [hold_seconds]}"
UPLOADS="${2:?需要 uploads_root}"
HOLD="${3:-0}"

# 必须与 server/src/mutationBarrier.ts 的 MEDIA_MUTATION_LOCK_KEY 一致（0x4d344241）
KEY=1295270465
PSQL_BASE=(psql -h 127.0.0.1 -U campus -d campus -q -v ON_ERROR_STOP=1)
export PGPASSWORD="$(cat /srv/campus/.db_password)"

STEPS="$GEN/.barrier-steps.sh"
cat > "$STEPS" <<STEPS_EOF
set -e
PGPASSWORD="\$(cat /srv/campus/.db_password)" pg_dump -Fc -h 127.0.0.1 -U campus -d campus -f "$GEN/database.dump"
tar --zstd -cf "$GEN/uploads.tar.zst" -C "$UPLOADS" public private 2>/dev/null
STEPS_EOF
chmod +x "$STEPS"

echo "[barrier] 取得排他锁（key=$KEY），在窗口内执行 dump + archive"
"${PSQL_BASE[@]}" <<SQL
select pg_advisory_lock($KEY) as lock_acquired;
\! bash "$STEPS"
select pg_sleep($HOLD) as hold_extra;
select pg_advisory_unlock($KEY) as lock_released;
SQL
echo "[barrier] 锁已释放"

# 产物检查：两个产物都必须存在且非空，否则"窗口内完成"这句话没有意义
for f in "$GEN/database.dump" "$GEN/uploads.tar.zst"; do
  if [ -s "$f" ]; then
    echo "[barrier] OK $(basename "$f") $(stat -c %s "$f") 字节"
  else
    echo "[barrier] FAIL 产物缺失或为空: $f" >&2
    exit 1
  fi
done
rm -f "$STEPS"
