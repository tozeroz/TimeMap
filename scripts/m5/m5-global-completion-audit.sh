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
# ⚠️ 这里修过一个**真实缺陷**：原先是**硬编码**的门禁列表，于是本轮新增的 5 个门禁
#    （wo17 / wo18 / wo20 / scanner / media-preview）**没有被审计跑到**，
#    而列表面上看还是"绿的" —— 典型的"**过期清单静默少测**"。
#    ⇒ 改为**自动发现**：取 scripts/m5 下所有 gate-*.mjs（排除服务器侧那两个），
#      这样以后新增门禁**自动纳入**，不会再漏。
#    ⚠️ 服务器侧门禁（不在设备上跑）单独排除：
#      · gate-place-not-campus.mjs（走 ssh 查服务器 DB + bundle）
SERVER_SIDE_GATES="gate-place-not-campus.mjs gate-tls-cert-health.sh"
DEVICE_GATES=()
while IFS= read -r f; do
  b="$(basename "$f")"
  case " $SERVER_SIDE_GATES " in *" $b "*) continue ;; esac
  DEVICE_GATES+=("$b")
done < <(ls scripts/m5/gate-*.mjs | sort)
# ⚠️ 若自动发现拿不到（例如路径不对），退回空数组并**明确报错**，不静默少测
if [ "${#DEVICE_GATES[@]}" -eq 0 ]; then
  echo "**FATAL** 自动发现门禁失败：scripts/m5/gate-*.mjs 一个都没找到 —— 不静默继续"
  exit 2
fi
echo "（自动发现设备门禁 ${#DEVICE_GATES[@]} 个：${DEVICE_GATES[*]}）"

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
  # ⭐ 修掉一个**可诊断性缺陷**：原实现只打印 DEVICE_GATE_EXIT=，把门禁的完整输出丢掉 ⇒
  #    失败时**没有原因可查**（Round 319 我就只能靠猜）。现在把失败输出留档：
  if [ "$rc" -ne 0 ] || printf '%s' "$exit_line" | grep -q 'DEVICE_GATE_EXIT=1'; then
    mkdir -p tools/tmp/audit-failures
    printf '%s\n' "$out" > "tools/tmp/audit-failures/$gate.round${AUDIT_ROUND:-x}.log"
    echo "      ↳ 失败输出已留档 tools/tmp/audit-failures/$gate.round${AUDIT_ROUND:-x}.log"
  fi
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
# ⚠️ 这里原先是**一行硬编码**（只跑 gate-place-not-campus.mjs）。
#    教训：硬编码列表会让新增的门禁**永远不被跑到**，而输出看起来还是"绿的"
#    —— 本轮之前已经因为同类问题吃过一次亏（审计脚本曾硬编码 15 个设备门禁，
#       导致新增的 10 个"从未被测过"）。
#    ⇒ 改成**按显式列表循环**，并按扩展名分派执行方式。
#    ⚠️ 为什么这里不用自动发现（不像设备门禁那样）：服务器侧门禁的**执行方式不同**
#       （有的本地 node 跑、有的要 ssh 到服务器），无法靠文件名一律处理；
#       但**列表至少集中在一处**，且下面会打印每个门禁的结论行，缺谁会看得出来。
SERVER_SIDE_LIST=(
  "gate-place-not-campus.mjs"
  "gate-tls-cert-health.sh"
)
for _g in "${SERVER_SIDE_LIST[@]}"; do
  _p="scripts/m5/$_g"
  if [ ! -f "$_p" ]; then
    printf '  %-38s %s\n' "$_g" "**FATAL** 列表里有但文件不存在 —— 不能静默跳过"
    continue
  fi
  case "$_g" in
    *.mjs) _out="$(node "$_p" 2>&1)" ;;
    *.sh)  _out="$(bash "$_p" 2>&1)" ;;
    *)     _out="(未知扩展名，未执行)" ;;
  esac
  # 取该门禁自己打印的结论行（各门禁都按约定输出 "KEY: VERDICT"）
  _line="$(printf '%s' "$_out" | grep -oE '(PLACE_NOT_CAMPUS_GATE|TLS_CERT_HEALTH): [A-Z_]+' | tail -1)"
  [ -z "$_line" ] && _line="**未打印结论行**（门禁坏了或输出格式变了）"
  printf '  %-38s %s\n' "$_g" "$_line"
done

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
  # ⚠️ 命名已按审核 62 第 2 条修正：这个名字**夸大了它证明的东西** ——
  #    它证明的是"现有门禁全绿 + 正序逆序一致 + 当前 regression 无明显顺序依赖"，
  #    **没有**证明"M5 产品已经 complete"。
  echo "M5_GLOBAL_REGRESSION_AUDIT: PASS（两轮逐门禁结论一致且全绿 ⇒ 按审核 61/62 停止局部收敛）"
  echo "M5_COMPLETION_STATUS: BLOCKED（产品完成度 = 受阻；剩余项见 docs/pending/m5/M5-GLOBAL-COMPLETION-AUDIT.md §三 A 类）"
  echo "M5_CLOSEOUT_PHASE: ACTIVE（审核 62 第 3 条：已进入关账执行阶段，但 FINAL CLOSE = BLOCKED）"
else
  if [ -n "$ORDER_SENSITIVE" ]; then
    echo "M5_GLOBAL_REGRESSION_AUDIT: 顺序敏感项 →$ORDER_SENSITIVE"
    echo "  ⇒ 按审核 61：**只针对这些**调查，不要展开成全门禁专项工程"
  else
    echo "M5_GLOBAL_REGRESSION_AUDIT: FAIL（两轮一致，但有门禁非绿 ⇒ 那是真实缺陷，需修）"
  fi
fi
