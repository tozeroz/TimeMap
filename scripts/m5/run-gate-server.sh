#!/usr/bin/env bash
# 跑 M5 gate 并打印关键结果 + 真实退出码
# 用法: bash run-gate.sh <输出文件>
#
# 【2026-09-22 升级】加入 **Gate 互斥锁**。
#   为什么：M5 gate 里的 verify-tmp-selfheal.sh 会
#       systemctl restart campus-backend.service + rm -rf /srv/campus/uploads/.tmp
#   —— 即**服务器侧 Gate 会重启后端**。若此时另有 Gate（设备侧或另一个服务器侧）
#   正在打同一个后端，在飞的请求会失败，表现为**间歇性**的 "FAIL 登录失败"，
#   而同一脚本单独跑却 PASS。这与此前那处"未复现、未定位"的故障形态一致。
#   → 用同一把锁（/srv/campus/gate.lock）串行化，避免"并行跑出含糊失败"。
#   锁的陈旧判定与抢占规则见 scripts/m5/gate-lock.sh 的注释。
set -u

LOCK=/srv/campus/gate.lock
STALE_SECONDS="${CAMPUS_LOCK_STALE_SECONDS:-1800}"

acquire_lock() {
  local owner="$1" now
  now="$(date +%s)"
  # set -C（noclobber）保证"创建即占位"，避免检查-创建之间的竞态
  if ( set -C; printf '%s|%s|%s|%s\n' "$owner" "$$" "$now" "$(hostname)" > "$LOCK" ) 2>/dev/null; then
    echo "  [gate-lock] 已获取锁（owner=$owner）"
    return 0
  fi
  local cur age
  cur="$(cat "$LOCK" 2>/dev/null || echo '__NONE__')"
  if [ "$cur" = "__NONE__" ]; then
    echo "  [gate-lock] 锁文件消失（竞态）→ 重试一次"
    ( set -C; printf '%s|%s|%s|%s\n' "$owner" "$$" "$now" "$(hostname)" > "$LOCK" ) 2>/dev/null && return 0
    return 1
  fi
  age=$(( now - $(stat -c %Y "$LOCK" 2>/dev/null || echo "$now") ))
  echo "  [gate-lock] 锁已被占用：$cur（年龄 ${age}s）"
  local lpid lhost
  lpid="$(printf '%s' "$cur" | cut -d'|' -f2)"
  lhost="$(printf '%s' "$cur" | cut -d'|' -f4)"
  if [ "$age" -gt "$STALE_SECONDS" ]; then
    echo "  [gate-lock] 判为**陈旧锁**（年龄 ${age}s > ${STALE_SECONDS}s）→ 抢占"
  elif [ "$lhost" = "$(hostname)" ] && [ -n "$lpid" ] && ! kill -0 "$lpid" 2>/dev/null; then
    echo "  [gate-lock] 判为**陈旧锁**（本机 PID $lpid 已不存在）→ 抢占"
  else
    echo "  [gate-lock] 另一个 Gate 正在运行，**不并发**。"
    echo "  [gate-lock] 若确认没有别的 Gate：rm -f $LOCK"
    return 1
  fi
  rm -f "$LOCK"
  ( set -C; printf '%s|%s|%s|%s\n' "$owner" "$$" "$now" "$(hostname)" > "$LOCK" ) 2>/dev/null && return 0
  return 1
}

release_lock() {
  rm -f "$LOCK"
  echo "  [gate-lock] 已释放"
}

if ! acquire_lock "server-gate:$$"; then
  echo "FATAL 另一个 Gate 正在运行 —— 两个 Gate 不得并发打同一后端。"
  echo "REAL_EXIT=3"
  exit 3
fi
trap release_lock EXIT

OUT="${1:-/tmp/gate-out.txt}"
bash /tmp/gate-m5.sh > "$OUT" 2>&1
RC=$?
echo "REAL_EXIT=$RC"
grep -a -E 'M5_SERVER_GATE_RESULT|M5_VOICE|M5_AUTH|M5_MEDIA_MESSAGE_API|M5_MEDIAID|M5_UNATTACHED|M5_TMP|M5_BOARD|M5_BASELINE|PERSISTENT|STAGE|REGRESSION|REAL_EXIT' "$OUT"
