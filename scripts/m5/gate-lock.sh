#!/usr/bin/env bash
# Gate 互斥锁：保证**同一时刻只有一个 Gate 在打这台后端**
#
# ## 为什么要它（起因是一个未定位的间歇性失败）
#   M5 服务器侧 Gate 含 `verify-tmp-selfheal.sh`，它会
#       systemctl restart campus-backend.service + rm -rf /srv/campus/uploads/.tmp
#   即**服务器侧 Gate 会重启后端**（必要的测试，但意味着它不是无副作用的）。
#   于是"设备侧 Gate 正在打同一个后端"与"服务器侧 Gate 正在重启它"并发时
#   会互相干扰：在飞的请求失败 → 表现为**间歇性**的 "FAIL 登录失败"，
#   而同一个脚本**单独**跑却 PASS。
#
# ## 锁放在哪
#   放在**服务器**上（`/srv/campus/gate.lock`），因为被争用的共享资源是那台后端。
#   这样无论从工作站发起设备 Gate，还是直接在服务器上跑服务器 Gate，看到的都是同一把锁。
#
# ## 语义
#   acquire <持有者描述>   拿锁；已被占用则**退出码 1** 并打印"谁在持有、多久了"
#   release                释放（只有当前持有者能释放，防止误删别人的锁）
#   status                 看状态（只读）
#
# ## 陈旧锁处理（重要：不能因为一次崩溃就永久锁死）
#   锁记录里带 PID 与时间。若满足任一条件，视为**陈旧**并允许抢占：
#     · 持有者是在**本机**跑的且该 PID 已不存在（进程死了没来得及释放）
#     · 锁文件年龄超过 STALE_SECONDS（默认 1800s = 30 分钟；正常 Gate 远小于此）
#   抢占时会打印原因 —— 不静默抢占（静默抢占会让"锁"变成摆设）。
#
# ## 边界（不要夸大）
#   它解决的是**这一类**并发干扰；**不**证明某次具体的失败就是这个原因（那次仍未定位）。
set -uo pipefail

SSH_KEY="${CAMPUS_SSH_KEY:-G:\\demo map\\TimeMap.pem}"
SSH_HOST="${CAMPUS_SSH_HOST:-root@8.148.156.146}"
LOCK=/srv/campus/gate.lock
STALE_SECONDS="${CAMPUS_LOCK_STALE_SECONDS:-1800}"

ssh_do() {
  ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" "$1" 2>&1
}

# 只读地读取锁内容（字段：owner|pid|epoch|host）
read_lock() {
  ssh_do "if [ -f $LOCK ]; then cat $LOCK; else echo '__NONE__'; fi"
}

age_of_lock() {
  ssh_do "if [ -f $LOCK ]; then echo \$(( \$(date +%s) - \$(stat -c %Y $LOCK) )); else echo -1; fi"
}

case "${1:-}" in
  acquire)
    OWNER="${2:-unnamed}"
    NOW="$(date +%s)"
    # 原子创建：用 noclobber 语义（set -C）避免"检查后创建"的竞态
    RESULT="$(ssh_do "set -C; printf '%s|%s|%s|%s\n' '$OWNER' \"\$\$\" '$NOW' \"\$(hostname)\" > $LOCK 2>/dev/null && echo ACQUIRED || echo BUSY")"
    if printf '%s' "$RESULT" | grep -q ACQUIRED; then
      echo "  [gate-lock] 已获取锁（owner=$OWNER）"
      exit 0
    fi
    # 已被占用 → 判断是否陈旧
    CUR="$(read_lock)"
    AGE="$(age_of_lock)"
    echo "  [gate-lock] 锁已被占用：$CUR（年龄 ${AGE}s）"
    STALE=0
    REASON=""
    if [ "$AGE" -ge 0 ] && [ "$AGE" -gt "$STALE_SECONDS" ]; then
      STALE=1; REASON="锁年龄 ${AGE}s > ${STALE_SECONDS}s（超时）"
    else
      # 持有者在**本机**且 PID 已不存在 → 陈旧
      LPID="$(printf '%s' "$CUR" | cut -d'|' -f2)"
      LHOST="$(printf '%s' "$CUR" | cut -d'|' -f4)"
      if [ -n "$LPID" ] && [ "$LHOST" = "$(hostname)" ] && ! kill -0 "$LPID" 2>/dev/null; then
        STALE=1; REASON="持有者本机 PID $LPID 已不存在（进程死了没释放）"
      fi
    fi
    if [ "$STALE" = "1" ]; then
      echo "  [gate-lock] 判定为**陈旧锁**：$REASON → 抢占"
      ssh_do "set -C; rm -f $LOCK; printf '%s|%s|%s|%s\n' '$OWNER' \"\$\$\" '$NOW' \"\$(hostname)\" > $LOCK && echo ACQUIRED || echo BUSY" | tail -1
      ssh_do "test -f $LOCK && echo OK" >/dev/null 2>&1
      echo "  [gate-lock] 已抢占并获取锁（owner=$OWNER）"
      exit 0
    fi
    echo "  [gate-lock] 另一个 Gate 正在运行，**不并发**。"
    exit 1
    ;;
  release)
    CUR="$(read_lock)"
    OWNER_IN_LOCK="$(printf '%s' "$CUR" | cut -d'|' -f1)"
    ME="${2:-}"
    if [ "$CUR" = "__NONE__" ]; then
      echo "  [gate-lock] 没有锁，无需释放"
      exit 0
    fi
    if [ -n "$ME" ] && [ "$OWNER_IN_LOCK" != "$ME" ]; then
      echo "  [gate-lock] 锁属于 '$OWNER_IN_LOCK'，不是 '$ME' → **不释放**（避免误删别人的锁）"
      exit 1
    fi
    ssh_do "rm -f $LOCK && echo RELEASED"
    echo "  [gate-lock] 已释放（原 owner=$OWNER_IN_LOCK）"
    ;;
  status)
    CUR="$(read_lock)"
    AGE="$(age_of_lock)"
    if [ "$CUR" = "__NONE__" ]; then
      echo "  [gate-lock] 空闲（无锁）"
    else
      echo "  [gate-lock] 被占用：$CUR（年龄 ${AGE}s）"
    fi
    ;;
  *)
    echo "用法: bash scripts/m5/gate-lock.sh {acquire <owner>|release [owner]|status}"
    exit 2
    ;;
esac
