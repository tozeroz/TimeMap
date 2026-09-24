#!/usr/bin/env bash
# X3：BACKEND_COLD_START / RESOURCE_PRESSURE **事实采集**（审核记录 55 的 DO NOW）
#
# ## 审核 55 的裁定（必须严格遵守）
#   「不要现在提高 max_connections；"396MB + max_connections=15 是根因"目前**不能成立**。」
#   已确认的只是**机制**：重启后 readiness 可能约 176s 为 false，在其之前放行流量就会失败。
#   数字（free/swap/loadavg/max_connections）只能说明预算紧张，**不足以单独证明根因**。
#
#   DO NOT：blindly raise max_connections ／ add more swap as "the fix"
#   DO NOW：记录启动期间的**精确 DB 连接错误 / SQLSTATE**、失败时刻的
#           pg_stat_activity 状态与计数、应用连接池 max 与**所有**并发 DB 客户端、
#           MemAvailable、swap-in/out、OOM / journal 信号
#
# ## 本脚本只**记录**，不改任何参数
#   它会重启一次后端（这是产生冷启动窗口的唯一办法），在窗口内按秒采样上述事实，
#   把结果落盘成一个报告。
#
# ⚠️ 它属于**破坏性**操作（重启服务 → 可能短暂不可用）。因此：
#    · 必须**显式**运行本脚本（不会由常规回归触发）
#    · 运行前要求 Gate 互斥锁空闲（复用同一把锁的语义），避免与其它 Gate 并发
#
# 用法（服务器上）：bash /tmp/probe-cold-start.sh [输出目录]
set -uo pipefail
SVC=campus-backend.service
LOCK=/srv/campus/gate.lock
OUT_DIR="${1:-/srv/campus/coldstart-$(date +%Y%m%d-%H%M%S)}"
PW="$(cat /srv/campus/.db_password)"
PSQL() { PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc "$1" 2>&1; }
mkdir -p "$OUT_DIR"

echo "=== X3 冷启动事实采集（只记录，不改参数）==="
echo "  输出目录: $OUT_DIR"

if [ -f "$LOCK" ]; then
  echo "FATAL Gate 互斥锁被占用（$(cat "$LOCK")）—— 破坏性探针必须独占。"
  exit 3
fi

# ---------- 0) 静态配置（审核 55 要求"检查应用连接池 max"）----------
{
  echo "### 0. 静态配置（采集时点 $(date -Is)）"
  echo
  echo "--- 应用连接池（server/src/config.ts 默认值）---"
  echo "  PG_POOL_MAX            默认 5    （实际生效值见 server.env，若未设则用默认）"
  echo "  PG_IDLE_TIMEOUT_MS     默认 10000"
  echo "  PG_CONNECT_TIMEOUT_MS  默认 5000"
  echo
  echo "--- server.env 里显式设置过的 PG_*（若为空则全用默认）---"
  grep -E '^PG_' /srv/campus/server.env 2>/dev/null || echo "  （未显式设置任何 PG_*）"
  echo
  echo "--- PostgreSQL 连接预算 ---"
  PSQL "select 'max_connections=' || current_setting('max_connections')
             || '  superuser_reserved=' || current_setting('superuser_reserved_connections')
             || '  → 应用可用约 ' || (current_setting('max_connections')::int - current_setting('superuser_reserved_connections')::int)::text"
  echo
  echo "--- **所有**会连库的客户端（审核 55 要求核对并发 DB 客户端）---"
  echo "  [1] campus-backend.service（pg 池，最大 5）"
  echo "  [2] gate/test 脚本（verify-*.sh 每条都自己开 psql / curl）"
  echo "  [3] cleanup / cleanup-auth / seed / admin（oneshot，含 systemd timer 每 6h）"
  echo "  [4] 人工 psql 会话"
  echo "  --- 当前 pg_stat_activity 按 application_name 分布 ---"
  # ⚠️ 我第一版写的是 `group by 1 order by 2 desc` —— PostgreSQL 不允许
  #    "ORDER BY 序号"指向不在 select list 里的表达式（报 ORDER BY position 2 is not in select list）。
  #    改成 ORDER BY 同名别名/表达式本身。
  PSQL "select coalesce(nullif(application_name,''),'<empty>') as app, count(*)::text as n
          from pg_stat_activity where datname='campus'
         group by 1 order by count(*) desc"
  echo "  --- 当前连接状态分布 ---"
  # ⚠️ 另一处同类错误：我在 `count(*)` 外面套了 `||` 拼接，PostgreSQL 报
  #    "aggregate functions are not allowed in GROUP BY"（因为整条表达式被当成分组键）。
  #    → 先 group by state 聚合，再拼接。
  PSQL "select coalesce(state,'<null>') as st, count(*)::text as n
          from pg_stat_activity where datname='campus'
         group by 1 order by count(*) desc"
  echo
  echo "--- 机器资源（快照）---"
  echo "  MemTotal/MemAvailable:"; grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo | sed 's/^/    /'
  echo "  vmstat（procs/memory/swap/io 首行表头 + 一行）:"; vmstat 1 2 | tail -2 | sed 's/^/    /'
  echo "  loadavg: $(cat /proc/loadavg)"
  echo "  nproc: $(nproc)"
} > "$OUT_DIR/00-static-config.txt" 2>&1
cat "$OUT_DIR/00-static-config.txt"

# ---------- 1) 重启并逐秒采样 ----------
echo
echo "=== 1) 重启 $SVC 并逐秒采样（最多 300s，或直到 ready=200 后 10s）==="
: > "$OUT_DIR/01-readiness-timeline.csv"
# 第 11 列 loadavg1 是**关键混淆变量**：2026-09-22 06:49 那次 176s 是在并发跑多个 gate 期间观测的，
# 而 07:48 这次（空闲）只有 14s。要判断"冷启动是否固有很慢"，必须同时看这一列与并发连接数。
echo "t_s,ready_http,state,mem_available_kb,swap_in,swap_out,pg_conn_total,pg_conn_active,pg_conn_idle,pg_wait_lock,loadavg1,n_psql_procs,run_queue" > "$OUT_DIR/01-readiness-timeline.csv"

T0=$(date +%s)
systemctl restart "$SVC"
for i in $(seq 1 300); do
  T=$(( $(date +%s) - T0 ))
  R="$(curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1/api/ready 2>/dev/null || echo 000)"
  ST="$(curl -s -m 2 http://127.0.0.1/api/ready 2>/dev/null | sed -n 's/.*"reason":"\([^"]*\)".*/\1/p')"
  MA="$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)"
  SI="$(awk '/^pswpin:/{print $2}' /proc/vmstat)"
  SO="$(awk '/^pswpout:/{print $2}' /proc/vmstat)"
  CT="$(PSQL "select count(*) from pg_stat_activity where datname='campus'" | tr -d '\n')"
  CA="$(PSQL "select count(*) from pg_stat_activity where datname='campus' and state='active'" | tr -d '\n')"
  CI="$(PSQL "select count(*) from pg_stat_activity where datname='campus' and state='idle'" | tr -d '\n')"
  WL="$(PSQL "select count(*) from pg_locks where not granted" | tr -d '\n')"
  LA="$(awk '{print $1}' /proc/loadavg)"
  # "所有并发 DB 客户端"的一部分：此刻在跑的 psql 进程数（gate/test 脚本各自会开）
  NP="$(ps -eo comm 2>/dev/null | grep -c '^psql$' || echo 0)"
  RQ="$(awk '{print $1}' /proc/loadavg | cut -d. -f1)"
  # 首次就绪后额外采 10 秒，确认稳定
  if [ "$R" = "200" ]; then
    echo "$T,$R,$ST,$MA,$SI,$SO,$CT,$CA,$CI,$WL,$LA,$NP,$RQ" >> "$OUT_DIR/01-readiness-timeline.csv"
    if [ -z "${READY_AT:-}" ]; then READY_AT=$T; echo "  ✓ 首次 /api/ready=200 于第 ${T}s"; fi
    [ $(( T - READY_AT )) -ge 10 ] && break
  else
    echo "$T,$R,$ST,$MA,$SI,$SO,$CT,$CA,$CI,$WL,$LA,$NP,$RQ" >> "$OUT_DIR/01-readiness-timeline.csv"
    # 每 15 秒回显一次，便于人看进度
    [ $(( T % 15 )) -eq 0 ] && echo "    t=${T}s ready=$R state=${ST:-<none>}"
  fi
  sleep 1
done
echo "  READY_AT=${READY_AT:-未在 300s 内就绪}"

# ---------- 2) 启动期 journal（含我新加的 SQLSTATE 明细）----------
echo
echo "=== 2) 取启动期 journal（关键：现在应能看到 code/errno/syscall）==="
journalctl -u "$SVC" --no-pager --since "@$T0" > "$OUT_DIR/02-journal-since-restart.txt" 2>&1
grep -a -E '\[migrate\]|\[health\]|\[uploads\]|\[listen\]|\[shutdown\]' "$OUT_DIR/02-journal-since-restart.txt" | head -25 | sed 's/^/  /'

# ---------- 3) 汇总关键事实 ----------
{
  echo "### 3. 汇总关键事实"
  echo
  echo "READY_AT_SECONDS=${READY_AT:-none}"
  echo
  echo "--- 启动各阶段时间差（从 journal 提取）---"
  grep -a -E 'Started campus-backend|tmp 目录就绪|\[listen\]|ready: false -> true|ready applied' "$OUT_DIR/02-journal-since-restart.txt" \
    | sed 's/^/  /' | head -12
  echo
  echo "--- 启动期出现过的 distinct 错误明细（应有 code= 字段了）---"
  grep -a -oE 'database unreachable: [^"]*' "$OUT_DIR/02-journal-since-restart.txt" | sort -u | sed 's/^/  /' | head -10
  echo
  echo "--- 是否有 OOM / 被杀信号 ---"
  journalctl --no-pager --since "@$T0" 2>/dev/null | grep -i -E 'oom|out of memory|killed process' | head -5 | sed 's/^/  /' || echo "  （无）"
  echo
  echo "--- 采样窗口内的资源极值 ---"
  # ⚠️ 取首/末行要用能容忍"末行为空"的写法：
  #    我第一版写 `awk -F, 'END{print $5}'` —— 文件末尾若有空行，END 作用在空行上会打印空串，
  #    于是 `$(( 空 - 数 ))` 报 `arithmetic syntax error: operand expected (error token is "-  ")`。
  #    → 用 `NR==2{...} {if(NF>5) last=$5} END{print last}` 这种"记住最后一个有内容的行"的写法。
  SWAP_IN_FIRST="$(awk -F, 'NR==2{print $5; exit}' "$OUT_DIR/01-readiness-timeline.csv")"
  SWAP_OUT_FIRST="$(awk -F, 'NR==2{print $6; exit}' "$OUT_DIR/01-readiness-timeline.csv")"
  SWAP_IN_LAST="$(awk -F, 'NR>1 && NF>5{v=$5} END{print v}' "$OUT_DIR/01-readiness-timeline.csv")"
  SWAP_OUT_LAST="$(awk -F, 'NR>1 && NF>6{v=$6} END{print v}' "$OUT_DIR/01-readiness-timeline.csv")"
  echo "  MemAvailable 最小: $(awk -F, 'NR>1 && NF>3{print $4}' "$OUT_DIR/01-readiness-timeline.csv" | sort -n | head -1) kB"
  echo "  MemAvailable 最大: $(awk -F, 'NR>1 && NF>3{print $4}' "$OUT_DIR/01-readiness-timeline.csv" | sort -n | tail -1) kB"
  echo "  swap_in  增量: $(( ${SWAP_IN_LAST:-0} - ${SWAP_IN_FIRST:-0} )) 页"
  echo "  swap_out 增量: $(( ${SWAP_OUT_LAST:-0} - ${SWAP_OUT_FIRST:-0} )) 页"
  echo "  campus 连接数 最大: $(awk -F, 'NR>1 && NF>6{print $7}' "$OUT_DIR/01-readiness-timeline.csv" | sort -n | tail -1)"
  echo "  等待中的锁 最大:   $(awk -F, 'NR>1 && NF>9{print $10}' "$OUT_DIR/01-readiness-timeline.csv" | sort -n | tail -1)"
  echo "  loadavg 最大:      $(awk -F, 'NR>1 && NF>10{print $11}' "$OUT_DIR/01-readiness-timeline.csv" | sort -n | tail -1)"
  echo
  echo "--- ⭐ 关键对照：本次冷启动 vs 2026-09-22 06:49 那次的 176s ---"
  echo "  本次 READY_AT=${READY_AT:-none}s"
  echo "  历史那次（journal 时间戳）：Started 06:49:54 → ready:false->true 06:52:50 = **176s**"
  echo "  ⚠️ 该次是在**并发跑多个 gate/脚本**期间观测到的；"
  echo "     所以两者差异可能来自**并发争用**，而不是"冷启动固有很慢"。"
  echo "     本文件提供本轮的事实；若要与历史那次对比，必须同时看 loadavg 与并发 DB 客户端数。"
  echo
  echo "--- ⚠️ 判据纪律（审核 55）---"
  echo "  · free/MemAvailable 小 **不等于** 内存不可用"
  echo "  · swap 有使用 **不等于** 当次 DB unreachable 由 swap 导致"
  echo "  · max_connections 紧 **不等于** 连接耗尽 —— 需要实际 SQLSTATE/connection error"
  echo "  · 本文件只提供事实；**结论**须由 SQLSTATE 与连接数/等待数共同支撑"
} > "$OUT_DIR/03-summary.txt" 2>&1
cat "$OUT_DIR/03-summary.txt"

echo
echo "=== 采集完成：$OUT_DIR ==="
ls -1 "$OUT_DIR" | sed 's/^/  /'
