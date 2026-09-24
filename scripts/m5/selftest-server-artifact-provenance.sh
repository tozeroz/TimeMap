#!/usr/bin/env bash
# 敏感度自检：证明 check-server-artifact-provenance.sh **能失败**
#
# ## 为什么必须有（本项目冻结的纪律）
#   REQUIRED: controlled sensitivity test —— 破坏 invariant → 必须 FAIL/exit 非零；恢复 → PASS。
#   只在"一致"状态下跑出 PASS，无法排除"这个检查永远报 PASS"。
#
# ## 怎么做的（不碰真实产物）
#   用 SPA_REMOTE_BUNDLE / SPA_REMOTE_GATE 把检查器指向**不存在的远端路径**：
#     突变 A：远端 bundle 路径不存在 → 期望 FAIL（且原因为"读不到"）
#     突变 B：远端 gate 路径不存在  → 期望 FAIL（同上）
#   恢复  ：不传环境变量 → 期望完整 PASS（三方一致）
#
#   为什么这个突变是**有效**的：真实事故正是"服务器上是旧副本" ——
#   那种情况下**内容不同**或**路径不对**都会让检查失败；
#   这里用"路径不存在"触发同一个判定分支（hash 取不到 → FAIL），
#   避免去改动真实部署文件（那会污染真机环境）。
set -uo pipefail
ROOT='G:\demo map'
CHECK="$ROOT/scripts/m5/check-server-artifact-provenance.sh"

echo "=== 突变 A：远端 bundle 路径不存在 → 期望 FAIL ==="
OUT_A="$(SPA_REMOTE_BUNDLE='/nonexistent/path/index.mjs' bash "$CHECK" 2>&1)"
RC_A=$?
printf '%s\n' "$OUT_A" | grep -E 'FAIL|SERVER_ARTIFACT_PROVENANCE' | head -3 | sed 's/^/    /'
if [ "$RC_A" -ne 0 ]; then
  echo "  PASS 突变 A 被判 FAIL（exit=$RC_A）"
  SEL_A=0
else
  echo "  FAIL 突变 A 未被判 FAIL —— 检查没有判别力"
  SEL_A=1
fi

echo
echo "=== 突变 B：远端 gate 路径不存在 → 期望 FAIL ==="
OUT_B="$(SPA_REMOTE_GATE='/nonexistent/gate-m5.sh' bash "$CHECK" 2>&1)"
RC_B=$?
printf '%s\n' "$OUT_B" | grep -E 'FAIL|SERVER_ARTIFACT_PROVENANCE' | head -3 | sed 's/^/    /'
if [ "$RC_B" -ne 0 ]; then
  echo "  PASS 突变 B 被判 FAIL（exit=$RC_B）"
  SEL_B=0
else
  echo "  FAIL 突变 B 未被判 FAIL"
  SEL_B=1
fi

echo
echo "=== 恢复：不传覆盖 → 期望完整 PASS ==="
OUT_C="$(bash "$CHECK" 2>&1)"
RC_C=$?
printf '%s\n' "$OUT_C" | grep -E 'SERVER_ARTIFACT_PROVENANCE|完全一致' | sed 's/^/    /'
if [ "$RC_C" -eq 0 ]; then
  echo "  PASS 恢复后完整 PASS"
  SEL_C=0
else
  echo "  FAIL 恢复后仍未 PASS"
  SEL_C=1
fi

echo
if [ $((SEL_A + SEL_B + SEL_C)) -eq 0 ]; then
  echo "SERVER_ARTIFACT_PROVENANCE_SENSITIVITY: PASS"
  echo "  （路径不存在→FAIL；恢复→完整 PASS）"
  exit 0
else
  echo "SERVER_ARTIFACT_PROVENANCE_SENSITIVITY: FAIL"
  exit 1
fi
