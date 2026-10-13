#!/usr/bin/env bash
# M0 Exit Gate —— 服务器侧断言（在服务器上执行）
#
# 设计原则（据 docs/pending/review-log/02）：
#   不要一个「大脚本返回 PASS」，而是明确的 assertion 集合；任一 mandatory 失败 → 退出码非 0。
# 用法：
#   bash verify-m0-server.sh                 # 常规断言
#   bash verify-m0-server.sh save-boot       # 记录 boot_id 与状态（reboot 前）
#   bash verify-m0-server.sh check-boot      # 对比 boot_id（reboot 后）
#
# 输出格式： PASS|FAIL <SECTION> <assertion...>

FAILED=0
STATE_DIR=/srv/campus
STATE_FILE="${STATE_DIR}/m0-reboot-state.json"

p() { printf 'PASS %s %s\n' "$1" "$2"; }
f() { printf 'FAIL %s %s\n' "$1" "$2"; FAILED=1; }
chk() { # chk <section> <desc> <cmd...>
  local sec="$1" desc="$2"; shift 2
  if "$@" >/dev/null 2>&1; then p "$sec" "$desc"; else f "$sec" "$desc"; fi
}
expect_eq() { # expect_eq <section> <desc> <actual> <expected>
  if [ "$3" = "$4" ]; then p "$1" "$2 (=$3)"; else f "$1" "$2 (got='$3' want='$4')"; fi
}

# 等服务变成 active（带超时），耗时写入全局 WAIT_ELAPSED。
# 为什么需要：重启后各服务启动有先后 —— 这台机器只有 2 vCPU / 396MB，
# PostgreSQL 起来要几十秒，紧接着就断言会把"还在启动中"误判成"没起来"。
# M1 的重启 Gate 上实测踩到过：断言时 PG 和 backend 都还是 inactive，
# 而 40 秒后的下一组断言里它们全正常。
#
# 审核方（记录 04）对轮询提了四条硬要求，这里全部满足：
#   明确 timeout / 非无限等待 / 失败时打印最后状态 / 失败时输出 journal + systemctl 诊断
# 超时仍然是 FAIL —— 轮询只容忍慢启动，不掩盖"真的起不来"。
wait_active() { # wait_active <unit> <timeout_s>；输出 WAIT_ELAPSED、WAIT_LAST_STATE
  local unit="$1" tmo="${2:-120}" i=0
  WAIT_ELAPSED="$tmo"
  WAIT_LAST_STATE="unknown"
  while [ "$i" -lt "$tmo" ]; do
    WAIT_LAST_STATE="$(systemctl is-active "$unit" 2>&1)"
    if [ "$WAIT_LAST_STATE" = "active" ]; then
      WAIT_ELAPSED="$i"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  # 超时：把现场信息打出来，而不是只留一个 FAIL 让审核方猜原因
  echo "  --- $unit 等待 ${tmo}s 超时，最后状态: $WAIT_LAST_STATE ---"
  echo "  --- systemctl status ---"
  systemctl status "$unit" --no-pager -n 15 2>&1 | sed 's/^/    /'
  echo "  --- journalctl -u $unit (last 20) ---"
  journalctl -u "$unit" -n 20 --no-pager 2>&1 | sed 's/^/    /'
  return 1
}

FROZEN_NODE_VERSION="v24.21.0"
FROZEN_NODE_PATH="/opt/node-v24.21.0-linux-x64/bin/node"
FROZEN_NODE_SHA="fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"
HEALTH_BODY='{"status":"ok","service":"campus-gateway","stage":"M0"}'

# 用法: verify-m0-server.sh [assert|save-boot|check-boot] [M0|M1]
#
# 为什么要分 stage：
#   M0 里有几条断言是"**还没有**业务库 / 后端服务是 disabled+inactive"——
#   它们断言的是 M0 阶段"不该存在什么"。M1 恰恰要把这些东西做出来，
#   所以"M1 PASS = M0 invariants PASS + M1 新断言 PASS"这句话如果照字面执行，
#   永远不可能成立。正确做法不是删掉这几条，而是把它们标注为**阶段相关**：
#   M1 阶段把它们反转成"现在必须存在且状态正确"。
#   永久性断言（Node 冻结、PG 参数、私钥治理、端口、nginx、基线完整性）不加 stage 判断，任何阶段都必须 PASS。
mode="${1:-assert}"
stage="${2:-M0}"

# ---------- [NODE] ----------
if [ "$mode" = "assert" ]; then
  expect_eq NODE "node --version == frozen" "$($FROZEN_NODE_PATH --version 2>/dev/null)" "$FROZEN_NODE_VERSION"
  got_path="$(readlink -f /usr/local/bin/node 2>/dev/null)"
  expect_eq NODE "node binary path == frozen" "$got_path" "$FROZEN_NODE_PATH"
  got_sha="$(sha256sum /opt/node-v24.21.0-linux-x64.tar.xz 2>/dev/null | awk '{print $1}')"
  if [ -z "$got_sha" ]; then
    # tarball 已删除，用记录的校验和文件核对
    recorded="$(awk '{print $1}' /opt/node-v24.21.0.sha256 2>/dev/null)"
    expect_eq NODE "binary checksum record == expected" "$recorded" "$FROZEN_NODE_SHA"
  else
    expect_eq NODE "binary checksum == expected" "$got_sha" "$FROZEN_NODE_SHA"
  fi
  chk NODE "npm present" test -x /usr/local/bin/npm

  # ---------- [POSTGRESQL] ----------
  expect_eq POSTGRESQL "service active" "$(systemctl is-active postgresql)" "active"
  expect_eq POSTGRESQL "service enabled" "$(systemctl is-enabled postgresql)" "enabled"
  chk POSTGRESQL "pg_isready succeeds" pg_isready -h 127.0.0.1 -q

  q() { sudo -u postgres psql -Atc "$1" 2>/dev/null; }
  expect_eq POSTGRESQL "listen_addresses" "$(q "show listen_addresses")" "localhost"
  expect_eq POSTGRESQL "max_connections" "$(q "show max_connections")" "15"
  # 注意：SHOW 返回的是人类可读值（64MB），不是页数（8192）
  expect_eq POSTGRESQL "shared_buffers" "$(q "show shared_buffers")" "64MB"
  expect_eq POSTGRESQL "work_mem" "$(q "show work_mem")" "1MB"
  expect_eq POSTGRESQL "maintenance_work_mem" "$(q "show maintenance_work_mem")" "16MB"
  expect_eq POSTGRESQL "effective_cache_size" "$(q "show effective_cache_size")" "192MB"
  expect_eq POSTGRESQL "max_parallel_workers" "$(q "show max_parallel_workers")" "0"
  expect_eq POSTGRESQL "max_parallel_workers_per_gather" "$(q "show max_parallel_workers_per_gather")" "0"
  expect_eq POSTGRESQL "autovacuum_max_workers" "$(q "show autovacuum_max_workers")" "2"

  if ss -lnt 2>/dev/null | grep -qE '0\.0\.0\.0:5432|\[::\]:5432'; then
    f POSTGRESQL "5432 bound only to loopback"
  else
    p POSTGRESQL "5432 bound only to loopback"
  fi
  # 【阶段相关】M0 要求"没有业务库"，M1 起要求"恰好有一个 campus 业务库"
  if [ "$stage" = "M0" ]; then
    expect_eq POSTGRESQL "no business database" "$(q "select count(*) from pg_database where datname not in ('postgres','template0','template1')")" "0"
  else
    expect_eq POSTGRESQL "business database count" "$(q "select count(*) from pg_database where datname not in ('postgres','template0','template1')")" "1"
    expect_eq POSTGRESQL "business database name" "$(q "select datname from pg_database where datname not in ('postgres','template0','template1')")" "campus"
  fi
  expect_eq POSTGRESQL "no business tables in postgres db" "$(sudo -u postgres psql -Atc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null)" "0"

  # ---------- [NGINX] ----------
  chk NGINX "nginx -t" nginx -t
  expect_eq NGINX "service active" "$(systemctl is-active nginx)" "active"
  expect_eq NGINX "service enabled" "$(systemctl is-enabled nginx)" "enabled"
  expect_eq NGINX "local /health == HTTP 200" "$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/health)" "200"
  expect_eq NGINX "local /health body == expected" "$(curl -s -m 5 http://127.0.0.1/health)" "$HEALTH_BODY"
  chk NGINX ":80 listening" bash -c "ss -lnt | grep -q ':80 '"
  # 检查**生效配置**而不是某个文件：
  # M2 起 location 被抽到 snippets/campus-locations.inc（80 与 443 共用，避免两处漂移），
  # 于是"grep sites-available/campus.conf"这种写法会假失败。
  # nginx -T 打印的是展开 include 之后的完整配置，断言它才与"实际生效"等价。
  chk NGINX "/api proxy configuration exists (effective config)" bash -c "nginx -T 2>/dev/null | grep -q 'location /api/'"

  # ---------- [BACKEND_SYSTEMD] ----------
  # 【阶段相关】M0 要求后端"不存在/未启用"，M1 起要求它 enabled + active
  chk BACKEND_SYSTEMD "systemd-analyze verify" systemd-analyze verify /etc/systemd/system/campus-backend.service
  if [ "$stage" = "M0" ]; then
    expect_eq BACKEND_SYSTEMD "service disabled" "$(systemctl is-enabled campus-backend.service 2>&1)" "disabled"
    expect_eq BACKEND_SYSTEMD "service inactive" "$(systemctl is-active campus-backend.service 2>&1)" "inactive"
  else
    expect_eq BACKEND_SYSTEMD "service enabled" "$(systemctl is-enabled campus-backend.service 2>&1)" "enabled"
    expect_eq BACKEND_SYSTEMD "service active" "$(systemctl is-active campus-backend.service 2>&1)" "active"
  fi

  # ---------- [RESOURCE_BASELINE] ----------
  # 采样：idle + nginx /health 并发 5/20（Node 并发资源测试按审核意见留到 M1）
  sample() { # sample <label> <concurrency>
    local label="$1" conc="$2"
    local out="/srv/campus/m0-resource-${label}.txt"
    mkdir -p /srv/campus
    local oom_before oom_after
    # 注意：grep -c 无匹配时也会输出 "0" 但返回非 0 —— 不能再 `|| echo 0`，
    # 否则变量会变成两行 "0\n0"，$(( )) 直接算错并把整个采样块打断（踩过）。
    oom_before="$(dmesg 2>/dev/null | grep -c 'Out of memory' || true)"
    [ -z "$oom_before" ] && oom_before=0
    if [ "$conc" -gt 1 ]; then
      if command -v ab >/dev/null 2>&1; then
        ab -n $((conc * 20)) -c "$conc" -q http://127.0.0.1/health >/dev/null 2>&1 || true
      else
        for i in $(seq 1 $((conc * 5))); do curl -s -o /dev/null http://127.0.0.1/health & done
        wait
      fi
    fi
    oom_after="$(dmesg 2>/dev/null | grep -c 'Out of memory' || true)"
    [ -z "$oom_after" ] && oom_after=0
    {
      echo "label=${label}"
      echo "concurrency=${conc}"
      echo "mem_available_mb=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"
      echo "swap_used_mb=$(free -m | awk '/Swap/{print $3}')"
      echo "load_avg=$(cut -d' ' -f1-3 /proc/loadavg)"
      echo "nginx_rss_kb=$(ps -o rss= -C nginx 2>/dev/null | awk '{s+=$1} END{print s+0}')"
      echo "postgres_rss_kb=$(ps -o rss= -C postgres 2>/dev/null | awk '{s+=$1} END{print s+0}')"
      echo "oom_kill_delta=$((oom_after - oom_before))"
    } > "$out"
    echo "  sampled -> $out"
  }
  sample idle 1
  sample conc5 5
  sample conc20 20
  for f2 in idle conc5 conc20; do
    if [ -s "/srv/campus/m0-resource-${f2}.txt" ]; then p RESOURCE_BASELINE "sample ${f2} exists"; else f RESOURCE_BASELINE "sample ${f2} exists"; fi
  done
  if grep -h 'oom_kill_delta=' /srv/campus/m0-resource-*.txt 2>/dev/null | grep -qv 'oom_kill_delta=0'; then
    f RESOURCE_BASELINE "no OOM kill during test interval"
  else
    p RESOURCE_BASELINE "no OOM kill during test interval"
  fi
fi

# ---------- [REBOOT] ----------
case "$mode" in
  save-boot)
    mkdir -p "$STATE_DIR"
    # 用 printf 而不是 heredoc：heredoc 里的双引号在经过多层传递时容易被吃掉（踩过）
    printf '{"boot_id":"%s","saved_at":"%s"}\n' \
      "$(cat /proc/sys/kernel/random/boot_id)" "$(date -Is)" > "$STATE_FILE"
    echo "saved: $STATE_FILE -> $(cat /proc/sys/kernel/random/boot_id)"
    ;;
  check-boot)
    cur="$(cat /proc/sys/kernel/random/boot_id)"
    old="$(sed -n 's/.*"boot_id":"\([^"]*\)".*/\1/p' "$STATE_FILE" 2>/dev/null)"
    if [ -z "$old" ]; then
      f REBOOT "boot_id_before recorded (run save-boot first)"
    elif [ "$cur" != "$old" ]; then
      p REBOOT "boot_id_after != boot_id_before"
    else
      f REBOOT "boot_id_after != boot_id_before (未重启)"
    fi
    if wait_active nginx 60; then p REBOOT "nginx active after reboot (${WAIT_ELAPSED}s)"; else f REBOOT "nginx active after reboot (超时 60s，最后状态: $WAIT_LAST_STATE)"; fi
    if wait_active postgresql 120; then p REBOOT "postgresql active after reboot (${WAIT_ELAPSED}s)"; else f REBOOT "postgresql active after reboot (超时 120s，最后状态: $WAIT_LAST_STATE)"; fi
    # 【阶段相关】M0 时后端还不存在，重启后自然是 inactive；
    # M1 起它必须开机自启，所以这里必须反转成 active —— 这正是 M1 Gate 第 5 组要证明的事。
    if [ "$stage" = "M0" ]; then
      expect_eq REBOOT "campus-backend inactive after reboot" "$(systemctl is-active campus-backend.service 2>&1)" "inactive"
    else
      if wait_active campus-backend.service 120; then
        p REBOOT "campus-backend active after reboot（开机自启生效，${WAIT_ELAPSED}s）"
      else
        f REBOOT "campus-backend active after reboot（超时 120s，最后状态: $WAIT_LAST_STATE）"
      fi
    fi
    expect_eq REBOOT "/health works after reboot" "$(curl -s -m 5 http://127.0.0.1/health)" "$HEALTH_BODY"
    if ss -lnt 2>/dev/null | grep -qE '0\.0\.0\.0:5432|\[::\]:5432'; then
      f REBOOT "PostgreSQL still loopback-only after reboot"
    else
      p REBOOT "PostgreSQL still loopback-only after reboot"
    fi
    ;;
esac

echo
if [ "$FAILED" -eq 0 ]; then echo "SECTION_RESULT PASS"; else echo "SECTION_RESULT FAIL"; fi
exit "$FAILED"
