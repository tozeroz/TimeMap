#!/usr/bin/env bash
# X3.1：受控并发复现 —— 冷启动耗时是否随**并发 DB 客户端数**上升？
#
# ## 为什么做这个实验
#   X3 的事实是：
#     · 清洁冷启动 **11~20 秒**（实测 3 次，空闲机器）
#     · 2026-09-22 06:49 那次是 **176 秒**，而当时我正在**并发跑多个 gate/脚本**
#   → 假设："176s 由并发争用导致" 目前只是 **CONSISTENT**，**未被证明**。
#   本脚本用**受控控制变量**检验它：唯一变的是"并发 DB 客户端数 N"，其余尽量保持一致。
#
# ## 设计（自然控制变量对，符合审核 43 的偏好）
#   对 N ∈ {0, N1, N2}：先起 N 个后台 DB 客户端 → 重启后端 → 逐秒测 /api/ready →
#   记录 READY_AT。N=0 即 X3 已经测过的基线。
#   并发客户端做什么：反复执行轻量查询 + 周期性开新连接（模拟 gate/test 脚本的行为，
#   它们各自 `psql` 一次就退出）。**不写任何数据**（只读查询），避免污染。
#
# ## 边界（不夸大）
#   它检验的是**DB 连接/CPU 争用**这一分量，**不是**完整 gate 负载
#   （真实 gate 还会做 HTTP 请求、上传媒体等）。所以：
#     · 若 READY_AT 随 N 显著上升 → **支持**争用假设
#     • 若几乎不变 → **削弱**它，需要另找 176s 的原因（例如当时 PG 自身的瞬时状态）
#
# ⚠️ 破坏性：会重启后端若干次（每次约 15~30s，N 大时可能更久）。**显式运行**。
#
# 用法（服务器上）：bash /tmp/probe-cold-start-load.sh [N1] [N2]
#   默认 bash /tmp/probe-cold-start-load.sh 8 20
set -uo pipefail
SVC=campus-backend.service
LOCK=/srv/campus/gate.lock
PW="$(cat /srv/campus/.db_password)"
N1="${1:-8}"
N2="${2:-20}"
OUT="/srv/campus/coldstart-load-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

if [ -f "$LOCK" ]; then
  echo "FATAL Gate 互斥锁被占用（$(cat "$LOCK")）—— 破坏性探针必须独占。" >&2
  exit 3
fi

echo "=== X3.1 受控并发复现 ==="
echo "  输出目录: $OUT"
echo "  并发档位: 0（基线）/ $N1 / $N2"

# 后台 DB 负载：N 个 worker，各自反复做只读查询 + 周期性重连
start_load() {
  local n="$1"
  LOAD_PIDS=()
  for i in $(seq 1 "$n"); do
    (
      # 每个 worker 在窗口内持续跑；用 `while` 而不是"跑一次就退"，
      # 因为要模拟**持续**争用，而不是一瞬间的峰值
      for _ in $(seq 1 200); do
        PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc 'select count(*) from users' >/dev/null 2>&1
        sleep 0.05
      done
    ) &
    LOAD_PIDS+=("$!")
  done
}
stop_load() {
  for p in "${LOAD_PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  LOAD_PIDS=()
}

measure() {
  local n="$1"
  echo
  echo "--- N=$n 档：起负载 → 重启 → 测直到 ready ---"
  if [ "$n" -gt 0 ]; then start_load "$n"; sleep 2; fi
  local CT0; CT0="$(PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "select count(*) from pg_stat_activity where datname='campus'" 2>/dev/null | tr -d '\n')"
  local LA0; LA0="$(awk '{print $1}' /proc/loadavg)"
  echo "    重启前：campus 连接数=$CT0  loadavg=$LA0"
  local t0; t0=$(date +%s)
  systemctl restart "$SVC"
  local ready=""
  for i in $(seq 1 300); do
    R="$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready 2>/dev/null || echo 000)"
    if [ "$R" = "200" ]; then ready=$(( $(date +%s) - t0 )); break; fi
    sleep 1
  done
  local LAMAX; LAMAX="$(awk '{print $1}' /proc/loadavg)"
  if [ -n "$ready" ]; then
    echo "    READY_AT=${ready}s  （重启后 loadavg=$LAMAX）"
  else
    echo "    READY_AT=未在 300s 内就绪"
    ready=NA
  fi
  # 记启动期是否出现 DB 不可达
  # ⚠️ 这里是**同一个 bug 的第三次出现**，记下来：
  #    `grep -c` 在"0 匹配"时**退出码为 1**，于是 `|| echo 0` 又追加一个 0 →
  #    UNREACH 变成 "0\n0"，写进 CSV 就多出一行孤立的 "0"（本轮结果文件里就有这种多余行）。
  #    同类 bug 之前出现在：`check-ps1-integrity.sh` 的 CR 计数、`check-cors-contract.sh` 的判定累积。
  #    → 正确写法：**不要用 `|| echo 0` 兜 grep -c**，用 `${var:-0}` 或 `awk` 统计。
  local UNREACH; UNREACH="$(journalctl -u "$SVC" --no-pager --since "@$t0" 2>/dev/null | grep -c 'database unreachable')"
  UNREACH="${UNREACH:-0}"
  echo "    启动期 'database unreachable' 次数=$UNREACH"
  stop_load
  echo "$n,$ready,$CT0,$LA0,$LAMAX,$UNREACH" >> "$OUT/result.csv"
  # 每次之间留出稳定时间，避免上一次的负载/连接残留影响下一次
  sleep 5
}

echo "N,READY_AT_s,conn_before,loadavg_before,loadavg_after,unreachable_count" > "$OUT/result.csv"
measure 0
measure "$N1"
measure "$N2"

echo
echo "=== 结果 ==="
column -s, -t "$OUT/result.csv" 2>/dev/null || cat "$OUT/result.csv"
echo
echo "=== 判读 ==="
echo "  · 若 READY_AT 随 N 明显上升 → **支持**'176s 由并发争用导致'的假设"
echo "  · 若几乎不变              → **削弱**该假设，需另找 176s 的原因"
echo "  ⚠️ 边界：本实验只变'并发 DB 客户端数'这一维；"
echo "     真实 gate 负载还含 HTTP/上传等，故结论只覆盖 DB 争用这一分量。"
echo "  原始结果：$OUT/result.csv"
