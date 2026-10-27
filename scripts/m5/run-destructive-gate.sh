#!/usr/bin/env bash
# ⭐ DESTRUCTIVE_SELF_HEAL_GATE —— 破坏性自愈/重启门禁（**必须显式执行**）
#
# ## 为什么把它从常规回归里拆出来（审核记录 55）
#   常规 M5 regression gate **不应该每次都把正在服务的 backend 重启**、
#   并制造接近 3 分钟的不可用窗口。
#   依据（实测）：这一节跑的是 `verify-tmp-selfheal.sh`，它会
#       systemctl restart campus-backend.service  +  清空 uploads/.tmp
#   而本机重启后**可能要约 176 秒才 `/api/ready == 200`**
#   （free/swap/loadavg 压力下 `[migrate] retryable: database unreachable` 反复重试；
#    机制见 docs/archive/legacy-development/review-log/55 §二）。
#
#   审核 55 的建议原话意译：
#     「把 TMP_SELFHEAL / restart test 从普通无副作用 regression 路径拆出为
#       **DESTRUCTIVE_SELF_HEAL_GATE**，要求显式 maintenance / exclusive execution；
#       普通 server regression 尽量不 restart 服务。」
#
# ## 它做什么
#   ① **强制**取得 Gate 互斥锁（同一把锁，设备侧与服务器侧共用）——
#      拿不到就明确拒绝，不并发（并发正是此前"间歇性失败"的机制之一）
#   ② 以 `M5_ALLOW_DESTRUCTIVE=1` 跑完整 gate → 第 3 节真跑（会重启后端 + 清 .tmp）
#   ③ 结束时释放锁（trap EXIT）
#
# ## 与常规回归的关系
#   · 常规：`bash /tmp/run-gate.sh <out>` → 第 3 节记 `SKIPPED_DESTRUCTIVE`，
#           汇总里显示 `DESTRUCTIVE SKIPPED（未执行，不是 PASS）`
#   · 破坏性：本脚本 → 第 3 节真跑，`M5_TMP_SELFHEAL PASS/FAIL` 参与判定
#
# 用法（服务器上）：bash /tmp/run-destructive-gate.sh [输出文件]
set -uo pipefail

OPS=/srv/campus/ops
LOCK=/srv/campus/gate.lock
STALE_SECONDS="${CAMPUS_LOCK_STALE_SECONDS:-1800}"
OUT="${1:-/tmp/gate-destructive.txt}"

echo "=== DESTRUCTIVE_SELF_HEAL_GATE ==="
echo "⚠️ 本节会**重启后端服务**并清空 uploads/.tmp；期间服务可能不可用（实测最长约 176s 才 ready）。"
echo "   因此：要求**独占执行**（持 Gate 互斥锁）。"
echo

# ---------- 强制互斥 ----------
NOW="$(date +%s)"
acquire() {
  if ( set -C; printf 'destructive-gate|%s|%s|%s\n' "$$" "$NOW" "$(hostname)" > "$LOCK" ) 2>/dev/null; then
    echo "  [gate-lock] 已获取锁（owner=destructive-gate:$$）"
    return 0
  fi
  local cur age lpid lhost
  cur="$(cat "$LOCK" 2>/dev/null || echo '__NONE__')"
  [ "$cur" = "__NONE__" ] && return 1
  age=$(( NOW - $(stat -c %Y "$LOCK" 2>/dev/null || echo "$NOW") ))
  lpid="$(printf '%s' "$cur" | cut -d'|' -f2)"
  lhost="$(printf '%s' "$cur" | cut -d'|' -f4)"
  echo "  [gate-lock] 已被占用：$cur（年龄 ${age}s）"
  if [ "$age" -gt "$STALE_SECONDS" ]; then
    echo "  [gate-lock] 判为陈旧（年龄 > ${STALE_SECONDS}s）→ 抢占"
  elif [ "$lhost" = "$(hostname)" ] && [ -n "$lpid" ] && ! kill -0 "$lpid" 2>/dev/null; then
    echo "  [gate-lock] 判为陈旧（本机 PID $lpid 已不存在）→ 抢占"
  else
    return 1
  fi
  rm -f "$LOCK"
  ( set -C; printf 'destructive-gate|%s|%s|%s\n' "$$" "$NOW" "$(hostname)" > "$LOCK" ) 2>/dev/null
}
if ! acquire; then
  echo "FATAL 另一个 Gate 正在运行 —— 破坏性门禁**必须独占**。"
  echo "      稍后重试；确认无人在跑：rm -f $LOCK"
  exit 3
fi
trap 'rm -f "$LOCK"; echo "  [gate-lock] 已释放"' EXIT

# ---------- 真跑 ----------
echo
echo "=== 以 M5_ALLOW_DESTRUCTIVE=1 跑完整 gate ==="
M5_ALLOW_DESTRUCTIVE=1 bash /tmp/gate-m5.sh > "$OUT" 2>&1
RC=$?
echo "REAL_EXIT=$RC"
grep -a -E 'M5_SERVER_GATE_RESULT|DESTRUCTIVE|M5_TMP_SELFHEAL|PERSISTENT|STAGE|REGRESSION' "$OUT" | head -10
exit "$RC"
