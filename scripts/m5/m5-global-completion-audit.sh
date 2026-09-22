#!/usr/bin/env bash
# ⭐ M5 GLOBAL COMPLETION AUDIT（审核 61 的第 9/10 条要求）
#
# ════════════════════════════════════════════════════════════════════
# 为什么这样做（审核 61 的原话）
# ════════════════════════════════════════════════════════════════════
#   > 完成 WO#16 后，应回到一次 **M5 全局 completion audit**，
#   > 而不是继续无限局部加固。
#   > 我建议最多做：**正常完整回归顺序** + **反向顺序完整回归一次**。
#   > 如果两轮 verdict 一致，就停止。如果某一条只在顺序变化后失败，再针对那一条调查。
#
# ⇒ 本脚本就是这两轮：**正常顺序**与**反向顺序**各跑一遍全部设备门禁 +
#   服务器侧门禁 + 本地检查，然后**逐门禁比对两次结论**并给出：
#     · 一致的绿：可停止
#     · 顺序敏感（一次绿一次红）：**那一条**才是要调查的对象
#
# ⚠️ 为什么要跑反向顺序：本项目已两度因"顺序相关状态残留"产生假结果
#   （WO#14 门禁被上一个门禁留的地理弹窗挡住；MAP_GEO_PERMISSION_MODAL 被
#    会话缓存的权限状态影响）。正向跑一遍**发现不了**这类问题。
#
# 用法：bash scripts/m5/m5-global-completion-audit.sh            # 两轮都跑
#       bash scripts/m5/m5-global-completion-audit.sh --forward  # 只跑正向
set -uo pipefail
cd "G:/demo map" 2>/dev/null || cd "$(dirname "$0")/../.." || exit 2

ONLY_FORWARD=0
[ "${1:-}" = "--forward" ] && ONLY_FORWARD=1

# 设备门禁（按"从基础到上层"的正常执行顺序）
DEVICE_GATES=(
  gate-wo6-tabbar-orientation.mjs
  gate-wo7-text-send.mjs
  gate-wo8-message-list.mjs
  gate-wo9a-group-slice.mjs
  gate-wo9b-at-panel-layerA.mjs
  gate-wo10-message-screen-mock.mjs
  gate-wo11-feed-list.mjs
  gate-wo12-user-profile.mjs
  gate-wo13-profile-edit.mjs
  gate-wo14-me-identity.mjs
  gate-wo15-map-markers.mjs
  gate-wo16-board-avatar.mjs
  gate-wo16a-campus-mock.mjs
  gate-wo16b-schools.mjs
  gate-composer-coverage.mjs
)

# 需要环境变量的门禁（如实列在这里，而不是靠调用方记得）
gate_env() {
  case "$1" in
    gate-wo16-board-avatar.mjs) echo "WO_BOARD_PEER_ID=11111111-1111-4111-8111-111111111111" ;;
    gate-wo7-text-send.mjs)     echo "WO_TEXT_SEND_PEER=11111111-1111-4111-8111-111111111111" ;;
    *) echo "" ;;
  esac
}

# ⚠️ 关键：**不要**在下游用 head/N 行截断 —— 那会给门禁发 SIGPIPE 并让它死在中途，
#    从而**泄漏服务器上的门禁锁**（这个坑我踩过，见 selftest-mutation.sh 的注释）。
run_one() {
  local gate="$1" out rc
  out="$(env $(gate_env "$gate") bash scripts/m5/run-device-gate.sh "scripts/m5/$gate" 2>&1)"
  rc=$?
  local exit_line
  exit_line="$(printf '%s\n' "$out" | grep -E 'DEVICE_GATE_EXIT=' | tail -1)"
  echo "${exit_line:-无 DEVICE_GATE_EXIT（rc=$rc）}"
}

wait_lock_free() {
  local i
  for i in $(seq 1 40); do
    bash scripts/m5/gate-lock.sh status 2>&1 | grep -q '空闲' && return 0
    sleep 3
  done
  echo "  ⚠ 门禁锁等待超时（120s）"
  return 0
}

echo "════════════════════════════════════════════════════════"
echo " M5 GLOBAL COMPLETION AUDIT — 第 1 轮（正常顺序）"
echo "════════════════════════════════════════════════════════"
declare -A FWD
for g in "${DEVICE_GATES[@]}"; do
  wait_lock_free
  r="$(run_one "$g")"
  FWD["$g"]="$r"
  printf '  %-38s %s\n' "$g" "$r"
done

echo
echo "  --- 服务器侧门禁 ---"
PLACE_LINE="$(node scripts/m5/gate-place-not-campus.mjs 2>&1 | grep -o '"PLACE_NOT_CAMPUS_GATE":"[A-Z]*"' | head -1)"
echo "  gate-place-not-campus.mjs            $PLACE_LINE"

echo
echo "  --- 本地检查 ---"
LOCAL_LINE="$(bash scripts/m5/check-all-local.sh 2>&1 | grep -E 'CHECK_ALL_LOCAL|BASELINE_MANIFEST_CONSISTENCY' | tr '\n' ' ')"
echo "  check-all-local.sh                   $LOCAL_LINE"

if [ "$ONLY_FORWARD" = "1" ]; then
  echo
  echo "（--forward：跳过反向轮）"
  exit 0
fi

echo
echo "════════════════════════════════════════════════════════"
echo " M5 GLOBAL COMPLETION AUDIT — 第 2 轮（**反向顺序**）"
echo "════════════════════════════════════════════════════════"
declare -A REV
for ((i=${#DEVICE_GATES[@]}-1; i>=0; i--)); do
  g="${DEVICE_GATES[$i]}"
  wait_lock_free
  r="$(run_one "$g")"
  REV["$g"]="$r"
  printf '  %-38s %s\n' "$g" "$r"
done

echo
echo "════════════════════════════════════════════════════════"
echo " 两轮比对（审核 61：一致即停；只在顺序变化后失败者才需调查）"
echo "════════════════════════════════════════════════════════"
ORDER_SENSITIVE=""
ALL_OK=1
for g in "${DEVICE_GATES[@]}"; do
  a="${FWD[$g]}"; b="${REV[$g]}"
  if [ "$a" = "$b" ]; then
    printf '  ✅ 一致  %-38s %s\n' "$g" "$a"
    echo "$a" | grep -q 'EXIT=0' || ALL_OK=0
  else
    printf '  ⚠ **顺序敏感** %-34s 正向=%s ／ 反向=%s\n' "$g" "$a" "$b"
    ORDER_SENSITIVE="$ORDER_SENSITIVE $g"
    ALL_OK=0
  fi
done

echo
if [ "$ALL_OK" = "1" ]; then
  echo "M5_GLOBAL_AUDIT: PASS（两轮逐门禁结论一致且全绿 ⇒ 按审核 61 可停止局部收敛）"
else
  if [ -n "$ORDER_SENSITIVE" ]; then
    echo "M5_GLOBAL_AUDIT: 顺序敏感项 →$ORDER_SENSITIVE"
    echo "  ⇒ 按审核 61：**只针对这些**调查，不要展开成全门禁专项工程"
  else
    echo "M5_GLOBAL_AUDIT: FAIL（两轮一致，但有门禁非绿 ⇒ 那是真实缺陷，需修）"
  fi
fi
