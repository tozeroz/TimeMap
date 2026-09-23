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
GATES=()
for f in scripts/m5/gate-*.mjs; do
  b="$(basename "$f")"
  # 服务器侧门禁（不是设备/浏览器目标）排除
  case " gate-place-not-campus.mjs gate-tls-cert-health.sh " in *" $b "*) continue ;; esac
  [ -n "$ONLY" ] && case "$b" in *"$ONLY"*) ;; *) continue ;; esac
  GATES+=("$b")
done
echo "  共 ${#GATES[@]} 个门禁"
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
  bash scripts/m5/web/run-web-gate.sh "scripts/m5/$g" > "$LOG" 2>&1
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

echo
echo "════════ 汇总 ════════"
echo "  PASS: $PASS_N ／ FAIL: $FAIL_N ／ 共 ${#GATES[@]}"
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "  需要分类的："
  for f in "${FAILED[@]}"; do echo "    · $f"; done
fi
echo
echo "  明细：$SUMMARY"
echo "  完整日志：G:/demo map/tools/tmp/web-audit/"
echo
echo "WEB_AUDIT: TOTAL=${#GATES[@]} PASS=$PASS_N FAIL=$FAIL_N"
