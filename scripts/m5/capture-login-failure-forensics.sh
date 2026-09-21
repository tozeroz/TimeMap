#!/usr/bin/env bash
# 失败自动抓现场（审核记录 53 要求）
#
# ## 背景
#   server gate 的媒体段曾报 "FAIL 登录失败"，但单独跑同一脚本即 PASS ——
#   随后**未复现、未定位根因**。审核 53 因此裁定：
#     接受"记录并观察" + **下次失败自动抓现场**（**不**要求现在盲跑 10 次统计失败率）。
#
# ## 它做什么
#   在"登录失败"发生的那一刻，把**能用于事后归因的一切**快照下来，
#   写到一个带时间戳的目录（默认 /srv/campus/forensics/<ts>/），包括：
#     · 服务状态与启动时间（是否是"进程刚重启"导致的一次性抖动）
#     · 后端日志末尾（journalctl -u campus-backend）
#     · pg_stat_activity（含 wait_event —— 能看出是否卡在锁/IO 上）
#     · 当次 request-code 的**原始响应**与 sink 目录列表
#     · /api/health 与 /api/ready 的状态
#     · 服务进程的 fd/线程数（资源耗尽线索）
#
# ## 为什么不在脚本里内联
#   本项目反复踩过"嵌套引号被 PowerShell/shell 吃掉"的坑 ——
#   凡是带引号、变量、重定向的组合，一律落成文件再执行（既有纪律）。
#
# 用法（由 verify-*.sh 在登录失败分支调用）：
#   bash scripts/m5/capture-login-failure-forensics.sh "<原因/上下文>"
set -uo pipefail

REASON="${1:-unknown}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="/srv/campus/forensics/$TS-login-failure"
mkdir -p "$OUT"

BASE=http://127.0.0.1
PW="$(cat /srv/campus/.db_password 2>/dev/null || echo '')"
SINK=/run/campus/login-codes

echo "  [forensics] 抓现场到 $OUT"
{
  echo "reason: $REASON"
  echo "at: $(date -Is)"
  echo "host: $(hostname)  uptime: $(uptime -p 2>/dev/null || uptime)"
} > "$OUT/meta.txt"

# 1) 服务状态 + 启动时间（关键：判断是否"刚重启过"）
{
  echo "--- systemctl status (摘要) ---"
  systemctl status campus-backend.service --no-pager -n 0 2>&1 | head -20
  echo
  echo "--- 启动时间 / 重启次数 ---"
  systemctl show campus-backend.service -p ExecMainStartTimestamp -p NRestarts -p MainPID --value 2>&1
  echo
  echo "--- postgresql 状态 ---"
  systemctl is-active postgresql 2>&1
} > "$OUT/service.txt" 2>&1

# 2) 后端日志末尾（含错误）
journalctl -u campus-backend.service --no-pager -n 300 > "$OUT/backend-journal.txt" 2>&1

# 3) 数据库活动与等待事件（能看出卡在锁/IO）
{
  echo "--- pg_stat_activity（campus 库）---"
  PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc \
    "select pid::text || ' | ' || coalesce(state,'-') || ' | wait=' || coalesce(wait_event_type,'-') || '/' || coalesce(wait_event,'-')
            || ' | ' || left(coalesce(query,''),80)
       from pg_stat_activity where datname='campus' order by state" 2>&1
  echo
  echo "--- 是否有人持有/等待 advisory 锁 ---"
  PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc \
    "select locktype || ' objid=' || coalesce(objid::text,'-') || ' mode=' || mode || ' granted=' || granted::text
       from pg_locks where locktype='advisory'" 2>&1
  echo
  echo "--- 连接数 vs max_connections ---"
  PGPASSWORD="$PW" psql -h 127.0.0.1 -U campus -d campus -Atc \
    "select 'used=' || count(*)::text || ' max=' || current_setting('max_connections') from pg_stat_activity" 2>&1
} > "$OUT/db-state.txt" 2>&1

# 4) OTP sink 现场
{
  echo "--- $SINK 列表 ---"
  ls -la "$SINK" 2>&1
  echo
  echo "--- latest.json 内容（若存在）---"
  cat "$SINK/latest.json" 2>&1 || true
} > "$OUT/otp-sink.txt" 2>&1

# 5) 健康与就绪（注意：/api/ready 在 PG 不可用时应为 503）
{
  echo -n "/api/health → "; curl -s -m 5 -o /dev/null -w '%{http_code}\n' "$BASE/api/health" 2>&1
  echo -n "/api/ready  → "; curl -s -m 5 -o /dev/null -w '%{http_code}\n' "$BASE/api/ready" 2>&1
} > "$OUT/health.txt" 2>&1

# 6) 进程资源（fd/线程 —— 资源耗尽线索）
{
  PID="$(systemctl show campus-backend.service -p MainPID --value 2>/dev/null)"
  echo "MainPID=$PID"
  if [ -n "$PID" ] && [ "$PID" != "0" ]; then
    echo "--- 打开的文件数 ---"
    ls /proc/$PID/fd 2>/dev/null | wc -l
    echo "--- ulimit -n（该进程）---"
    grep -i 'max open files' /proc/$PID/limits 2>&1
    echo "--- 线程数 ---"
    ls /proc/$PID/task 2>/dev/null | wc -l
  fi
  echo "--- 磁盘 ---"
  df -h /srv/campus 2>&1
  echo "--- 内存 ---"
  free -m 2>&1
} > "$OUT/process.txt" 2>&1

# 7) 汇总一行，便于 grep
SUMMARY="$(printf 'reason=%s out=%s health=%s ready=%s' \
  "$REASON" "$OUT" \
  "$(curl -s -m 5 -o /dev/null -w '%{http_code}' $BASE/api/health 2>/dev/null)" \
  "$(curl -s -m 5 -o /dev/null -w '%{http_code}' $BASE/api/ready 2>/dev/null)")"
echo "  [forensics] $SUMMARY"
echo "$SUMMARY" >> "$OUT/meta.txt"

echo "  [forensics] 已抓：$(ls -1 "$OUT" | tr '\n' ' ')"
