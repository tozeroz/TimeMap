#!/usr/bin/env bash
for f in idle conc5 conc20; do
  echo "@@@RESOURCE:${f}@@@"
  cat "/srv/campus/m0-resource-${f}.txt" 2>/dev/null || echo "(missing)"
done
echo "@@@SOCKETS@@@"
ss -lntp | grep -E ':80|:5432'
echo "@@@SERVICES@@@"
for s in nginx postgresql campus-backend.service; do
  printf '%s: active=%s enabled=%s\n' "$s" "$(systemctl is-active $s 2>&1)" "$(systemctl is-enabled $s 2>&1)"
done
echo "@@@REBOOT_STATE@@@"
cat /srv/campus/m0-reboot-state.json 2>/dev/null || echo "(missing)"
