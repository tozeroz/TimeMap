#!/usr/bin/env bash
# 记录/查看 boot_id 状态（排查用）
echo "--- 直接写一次（用 printf，避免 heredoc 里的引号被中间层吃掉）---"
mkdir -p /srv/campus
boot="$(cat /proc/sys/kernel/random/boot_id)"
printf '{"boot_id":"%s","saved_at":"%s"}\n' "$boot" "$(date -Is)" > /srv/campus/m0-reboot-state.json
cat /srv/campus/m0-reboot-state.json
echo "--- load_avg 单独验证 ---"
printf 'via cut: %s\n' "$(cut -d' ' -f1-3 /proc/loadavg)"
printf 'via awk: %s\n' "$(awk '{print $1" "$2" "$3}' /proc/loadavg)"
