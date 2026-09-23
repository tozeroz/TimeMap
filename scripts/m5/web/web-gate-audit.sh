#!/usr/bin/env bash
# 网页端全量门禁审计：把既有门禁**逐个跑在网页端**，汇总并分类失败原因
#
# ════════════════════════════════════════════════════════════════════════════
# 为什么要跑全量、而不是只挑几个
# ════════════════════════════════════════════════════════════════════════════
#   用户的要求是"网页端所有功能都经过测试、确认无误"。
#   ⇒ 那就必须**全部**过一遍，并把"不适用"与"真失败"分开：
#      · NOT_APPLICABLE：门禁断言的是原生专属行为（例如 Android 手势/原生插件/
#        应用生命周期），网页端本就不同 ⇒ 应显式登记为"不适用"，**不是**删掉它
#      · FAIL：真实缺陷 ⇒ 必须修
#   把两者混为一谈（例如为了跑绿而删掉断言）就是造假。
#
# ⚠️ 不要与设备门禁并发：两者都要占 9222（见 launch-web-chrome.sh）。
#
# 用法：bash scripts/m5/web/web-gate-audit.sh [--only <子串>]
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 1

ONLY=""
[ "${1:-}" = "--only" ] && ONLY="${2:-}"

echo "════════════════════════════════════════════════════════════"
echo "  网页端全量门禁审计  $(date -Iseconds)"
echo "════════════════════════════════════════════════════════════"
echo
echo "=== 1) 确保网页端会话（从模拟器 App 复制 token，对真实用户零影响）==="
bash scripts/m5/web/setup-web-session.sh 2>&1 | tail -6 | sed 's/^/  /'

echo
echo "=== 2) 发现门禁（复用设备门禁的同一批文件）==="
# ⭐ 网页端**明确不适用**的门禁（**不是**删掉它，而是显式登记并给出理由）
#   ⚠️ 为什么要有这张表：用户要求"网页端所有功能都经过测试、确认无误"。
#      如果我把不适用的门禁悄悄跳过、或者为了跑绿而删掉断言，那才是造假。
#      显式列出来 + 写明理由，才能让"哪些没测、为什么没测"一目了然。
web_not_applicable() {
  case "$1" in
    gate-statusbar-inset.mjs)
      echo "原生专属：断言的是 Android 15+ edge-to-edge 的 --safe-area-inset-* 注入与顶栏让位。浏览器没有系统状态栏覆盖问题（页面自带浏览器 chrome），该逻辑在网页端**本就不应生效**。⚠️ 其"不生效"本身由 gate-web-app-mount 等门禁从另一侧保证（应用照常渲染）。"
      ;;
    gate-wo23-update-platform.mjs)
      echo "原生专属（**对照侧**）：它断言的正是"原生端**仍然有** APK 更新动作"。按 WO#25 的 P0 裁定，网页端**必须没有**该动作 ⇒ 这条在网页端必然为假。网页端那一侧由 gate-web-update-platform.mjs 负责（两者是**对称的一对**：一条防"网页端泄漏 APK 语义"，一条防"改过头把手机端更新也去掉"）。"
      ;;
    *) echo "" ;;
  esac
}

# ⚠️ 需要环境变量的门禁（设备审计里有同一张表；网页端必须**同样**注入，
#    否则会得到 exit=2 的 FATAL —— 那是**脚手架缺口**，不是网页端缺陷。
#    实测：gate-wo16 就因此报 "FATAL 需要 WO_BOARD_PEER_ID"）
gate_env() {
  case "$1" in
    gate-wo16-board-avatar.mjs) echo "WO_BOARD_PEER_ID=11111111-1111-4111-8111-111111111111" ;;
    gate-wo7-text-send.mjs)     echo "WO_TEXT_SEND_PEER=11111111-1111-4111-8111-111111111111" ;;
    *) echo "" ;;
  esac
}

GATES=()
SKIPPED=()
for f in scripts/m5/gate-*.mjs; do
  b="$(basename "$f")"
  # 服务器侧门禁（不是设备/浏览器目标）排除
  case " gate-place-not-campus.mjs gate-tls-cert-health.sh " in *" $b "*) continue ;; esac
  [ -n "$ONLY" ] && case "$b" in *"$ONLY"*) ;; *) continue ;; esac
  # 网页端不适用 ⇒ 不计入"应通过"，但要**打印出来**
  WHY="$(web_not_applicable "$b")"
  if [ -n "$WHY" ]; then SKIPPED+=("$b|$WHY"); continue; fi
  GATES+=("$b")
done
echo "  共 ${#GATES[@]} 个门禁（另有 ${#SKIPPED[@]} 个明确不适用）"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  for s in "${SKIPPED[@]}"; do
    echo "    ⊘ ${s%%|*}"
    echo "      理由：${s#*|}"
  done
fi
[ "${#GATES[@]}" -eq 0 ] && { echo "  **FATAL** 一个都没发现，不静默继续"; exit 2; }

OUT=G:/demo\ map/tools/tmp/web-audit
mkdir -p "G:/demo map/tools/tmp/web-audit"
SUMMARY="G:/demo map/tools/tmp/web-audit/summary.txt"
: > "$SUMMARY"

PASS_N=0; FAIL_N=0
FAILED=()
for g in "${GATES[@]}"; do
  printf '  %-42s ' "$g"
  LOG="G:/demo map/tools/tmp/web-audit/${g}.log"
  # ⚠️ 注入该门禁需要的环境变量（与设备审计同一张表）——不给就会 exit=2 FATAL，
  #    那是脚手架缺口而非功能缺陷。
  ENV_KV="$(gate_env "$g")"
  if [ -n "$ENV_KV" ]; then
    env $ENV_KV bash scripts/m5/web/run-web-gate.sh "scripts/m5/$g" > "$LOG" 2>&1
  else
    bash scripts/m5/web/run-web-gate.sh "scripts/m5/$g" > "$LOG" 2>&1
  fi
  RC=$?
  VERDICT="$(grep -oE 'VERDICT = \{.*' "$LOG" | head -1)"
  if [ "$RC" = 0 ]; then
    PASS_N=$((PASS_N+1)); echo "exit=0"
    # 统计键级别结果
    printf '%s\n' "$VERDICT" >> "$SUMMARY"
  else
    FAIL_N=$((FAIL_N+1)); echo "exit=$RC  ← 需分类"
    FAILED+=("$g")
    {
      echo "===== $g (exit=$RC) ====="
      grep -E 'VERDICT|FATAL|WEB_TARGET_VALIDITY|Error|error|FAIL' "$LOG" | head -12
      echo
    } >> "$SUMMARY"
  fi
done

# ⭐ 网页端**专属**门禁（不在设备审计的发现范围内：设备审计 glob scripts/m5/gate-*.mjs，
#    而这些在 scripts/m5/web/ 下）⇒ 两套门禁天然分离，各自诚实。
echo
echo "  --- 网页端专属门禁 ---"
WEB_ONLY=()
for f in scripts/m5/web/gate-*.mjs; do
  [ -f "$f" ] || continue
  WEB_ONLY+=("$(basename "$f")")
done
for g in "${WEB_ONLY[@]}"; do
  printf '  %-42s ' "$g"
  LOG="G:/demo map/tools/tmp/web-audit/${g}.log"
  bash scripts/m5/web/run-web-gate.sh "scripts/m5/web/$g" > "$LOG" 2>&1
  RC=$?
  VERDICT="$(grep -oE 'VERDICT = \{.*' "$LOG" | head -1)"
  if [ "$RC" = 0 ]; then
    PASS_N=$((PASS_N+1)); echo "exit=0"
    printf '%s\n' "$VERDICT" >> "$SUMMARY"
  else
    FAIL_N=$((FAIL_N+1)); echo "exit=$RC  ← 需分类"
    FAILED+=("$g")
    {
      echo "===== $g (exit=$RC) ====="
      grep -E 'VERDICT|FATAL|Error|error|FAIL' "$LOG" | head -12
      echo
    } >> "$SUMMARY"
  fi
done
TOTAL=$(( ${#GATES[@]} + ${#WEB_ONLY[@]} ))

echo
echo "════════ 汇总 ════════"
echo "  PASS: $PASS_N ／ FAIL: $FAIL_N ／ 共 $TOTAL"
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "  需要分类的："
  for f in "${FAILED[@]}"; do echo "    · $f"; done
fi
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo "  明确不适用（已给理由，未计入总数）：${#SKIPPED[@]} 个"
  for s in "${SKIPPED[@]}"; do echo "    ⊘ ${s%%|*}"; done
fi
echo
echo "  明细：$SUMMARY"
echo "  完整日志：G:/demo map/tools/tmp/web-audit/"
echo
echo "WEB_AUDIT: TOTAL=$TOTAL PASS=$PASS_N FAIL=$FAIL_N SKIPPED=${#SKIPPED[@]}"
