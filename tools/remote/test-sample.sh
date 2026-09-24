#!/usr/bin/env bash
echo "MARKER: start"
sample() {
  local label="$1" conc="$2"
  local out="/srv/campus/m0-resource-${label}.txt"
  mkdir -p /srv/campus
  local oom_before oom_after
  oom_before="$(dmesg 2>/dev/null | grep -c 'Out of memory' || echo 0)"
  echo "  oom_before raw='$oom_before'"
  if [ "$conc" -gt 1 ]; then
    if command -v ab >/dev/null 2>&1; then
      echo "  using ab"
      ab -n $((conc * 20)) -c "$conc" -q http://127.0.0.1/health >/dev/null 2>&1 || true
    else
      echo "  using curl loop"
      for i in $(seq 1 $((conc * 5))); do curl -s -o /dev/null http://127.0.0.1/health & done
      wait
    fi
  fi
  oom_after="$(dmesg 2>/dev/null | grep -c 'Out of memory' || echo 0)"
  {
    echo "label=${label}"
    echo "concurrency=${conc}"
    echo "mem_available_mb=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)"
    echo "swap_used_mb=$(free -m | awk '/Swap/{print $3}')"
    echo "load_avg=$(awk '{print $1","$2","$3}' /proc/loadavg)"
    echo "nginx_rss_kb=$(ps -o rss= -C nginx 2>/dev/null | awk '{s+=$1} END{print s+0}')"
    echo "postgres_rss_kb=$(ps -o rss= -C postgres 2>/dev/null | awk '{s+=$1} END{print s+0}')"
    echo "oom_kill_delta=$((oom_after - oom_before))"
  } > "$out"
  echo "  sampled -> $out"
}
echo "MARKER: calling sample idle"
sample idle 1
echo "MARKER: calling sample conc5"
sample conc5 5
echo "MARKER: done"
cat /srv/campus/m0-resource-idle.txt
