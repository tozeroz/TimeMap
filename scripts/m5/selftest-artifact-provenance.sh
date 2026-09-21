#!/usr/bin/env bash
# 敏感度自检：证明 check-artifact-provenance.sh **能失败**
#
# ## 为什么必须有它（本项目冻结的纪律）
#   REQUIRED: controlled sensitivity test —— 破坏 invariant → Gate 必须 FAIL/exit 非零；
#             恢复 → PASS/exit 0。
#   只在"一致"状态下跑出 PASS 是不够的：那不能排除"这个检查永远报 PASS"。
#
# ## 本自检怎么做的（不改真实产物、不删任何东西）
#   用 `PROV_DIST_DIR` / `PROV_CAP_DIR` 把检查器指向两个**临时 decoy 目录**：
#     突变 A：两目录里放**不同名**的 index-*.js → 期望 FAIL（模拟"漏跑 cap sync"）
#     恢复  ：两目录里放**同名同内容**的文件        → 期望 **再往前走**（进入 APK 比对阶段）
#   ⚠️ 真实运行时这两个环境变量不传，检查器用仓库真实路径。
#
#   ⚠️ 关于"完整 PASS"：本自检**无法**让 decoy 通过第 3、4 步（APK 内的文件比对）——
#      因为装的 APK 里只有真实 bundle。因此 decoy 场景只能验证到"是否 FAIL 在第 1/2 步"，
#      这恰好就是我们要证的那一步（**同名性**）。
#      完整三方 sha256 的一致性另有实证：脚本在真实路径上的运行输出（本会话已记录）。
set -uo pipefail
ROOT='G:\demo map'
BASE="$ROOT/tools/tmp/prov-selftest"
A="$BASE/dist-a"
B="$BASE/cap-b"
mkdir -p "$A" "$B"

CHECK="$ROOT/scripts/m5/check-artifact-provenance.sh"

echo "=== 突变 A：dist 与 cap 里是**不同名**的 bundle → 期望 FAIL（模拟漏跑 cap sync）==="
# 清掉上一轮（只删这个自检目录下的精确文件；不碰真实产物）
rm -f "$A"/index-*.js "$B"/index-*.js 2>/dev/null
printf 'aaa' > "$A/index-AAAAAAAA.js"
printf 'bbb' > "$B/index-BBBBBBBB.js"
OUT_A="$(PROV_DIST_DIR="$A" PROV_CAP_DIR="$B" bash "$CHECK" 2>&1)"
RC_A=$?
printf '%s\n' "$OUT_A" | grep -E '不同名|同名|FAIL|PASS' | head -4 | sed 's/^/    /'
echo "    exit=$RC_A"
if [ "$RC_A" -ne 0 ] && printf '%s' "$OUT_A" | grep -q '不同名'; then
  echo "  PASS 突变 A 被判 FAIL（且原因正确：不同名）"
  SEL_A=0
else
  echo "  FAIL 突变 A 未被判 FAIL —— 这个检查没有判别力"
  SEL_A=1
fi

echo
echo "=== 恢复：dist 与 cap 里放**同名同内容**的文件 → 期望不再报'不同名'==="
rm -f "$A"/index-*.js "$B"/index-*.js 2>/dev/null
printf 'same' > "$A/index-SAMESAME.js"
printf 'same' > "$B/index-SAMESAME.js"
OUT_B="$(PROV_DIST_DIR="$A" PROV_CAP_DIR="$B" bash "$CHECK" 2>&1)"
RC_B=$?
printf '%s\n' "$OUT_B" | grep -E '不同名|同名|ARTIFACT_PROVENANCE' | head -3 | sed 's/^/    /'
if printf '%s' "$OUT_B" | grep -q 'PASS 同名'; then
  echo "  PASS 恢复后被判'同名'（判别力来自**内容之外的同名性**，且恢复即改判）"
  SEL_B=0
else
  echo "  FAIL 恢复后仍未判同名 —— 自检本身有问题"
  SEL_B=1
fi

echo
echo "=== 真实路径再跑一次（应恢复为完整 PASS：三方 sha256 一致）==="
OUT_C="$(bash "$CHECK" 2>&1)"
RC_C=$?
printf '%s\n' "$OUT_C" | grep -E 'ARTIFACT_PROVENANCE|三方 sha256' | sed 's/^/    /'
echo "    exit=$RC_C"
[ "$RC_C" -eq 0 ] && SEL_C=0 || SEL_C=1

echo
if [ $((SEL_A + SEL_B + SEL_C)) -eq 0 ]; then
  echo "ARTIFACT_PROVENANCE_SENSITIVITY: PASS"
  echo "  （突变→FAIL 且原因正确；恢复→改判；真实路径→完整 PASS）"
  exit 0
else
  echo "ARTIFACT_PROVENANCE_SENSITIVITY: FAIL"
  exit 1
fi
