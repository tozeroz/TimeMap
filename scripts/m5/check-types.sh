#!/usr/bin/env bash
# 机械类型检查（**并检测"空过"**）
#
# ## 为什么需要它（本项目真实事故）
#
# 我长期用 `npx tsc --noEmit` 做前端类型检查，它**一直报 0 diagnostics**，
# 于是我以为前端类型是干净的。实际上：
#
#   app/tsconfig.json 是 **solution-style** 配置：
#       { "files": [], "references": [ {"path":"./tsconfig.app.json"}, {"path":"./tsconfig.node.json"} ] }
#   对这种配置跑 `tsc --noEmit`（不带 -p / --build）**什么都不检查** ——
#   它会以 exit 0 结束，但**一个文件都没读**（实测 src 文件数 = 0）。
#
# 后果：我在 MessageScreen 里删掉 state 后留下了 6 处悬空引用
# （setTarget / setRequest / setApplied / target），
# 类型检查却报 "0 diagnostics" ——**假 PASS**。
# 用真实工程配置（-p tsconfig.app.json）一跑，立刻报出 **12 个错误**（含"检查了 58 个文件"）。
#
# 这与我一直在猎杀的那类缺陷完全同构：**一个无法失败的 Gate**。
# 因此本脚本除了"跑类型检查"，还必须**证明它真的读了文件**。
#
# ## 检查什么
#   对每个真实工程配置（tsconfig.app.json / tsconfig.node.json / server/tsconfig.json）：
#     ① `tsc --noEmit -p <config> --listFiles` → 统计其中属于 src/ 的文件数
#     ② 若文件数为 0 → **FAIL**（"检查了 0 个文件"= 空过，不是通过）
#     ③ 若 tsc 报错 → FAIL 并打印前若干条
#   最后打印每个工程实际检查的文件数与结论。
#
# ## 用法
#   bash scripts/m5/check-types.sh
# 退出码 0 = 全部工程都真的被检查且无错；1 = 有错或存在空过
set -uo pipefail
ROOT='G:\demo map'

# 相对 ROOT 的工程配置；只列**真实 leaf 配置**，不列 solution-style 的聚合文件
PROJECTS=(
  'app/tsconfig.app.json'
  'app/tsconfig.node.json'
  'server/tsconfig.json'
)

BAD=0
declare -a SUMMARY=()

for proj in "${PROJECTS[@]}"; do
  cfg="$ROOT/$proj"
  dir="$(dirname "$cfg")"
  base="$(basename "$cfg")"
  echo "=== $proj ==="
  if [ ! -f "$cfg" ]; then
    echo "  FAIL 配置不存在: $cfg"
    BAD=1
    continue
  fi

  # 一次运行同时拿"读了哪些文件"与"有没有错误"
  OUT="$(cd "$dir" && npx tsc --noEmit -p "$base" --listFiles 2>&1)"
  RC=$?
  # ⚠️ 统计口径：**工程内**文件（排除 node_modules 与 lib.*.d.ts），而不是只看 src/。
  #   我第一版只数 src/ 下的文件，于是把 app/tsconfig.node.json 误判成"空过" ——
  #   它的 include 是 ["vite.config.ts"]，本来就**不在 src/ 下**，属于**设计如此**。
  #   "空过"的正确判据是：该配置**没有读任何属于本工程的文件**。
  FILE_COUNT="$(printf '%s\n' "$OUT" \
    | grep -E '[/\\](app|server)[/\\]' \
    | grep -v 'node_modules' \
    | grep -cE '\.(ts|tsx|mts|cts)$' || true)"
  ERR_LINES="$(printf '%s\n' "$OUT" | grep -E 'error TS' || true)"
  ERR_COUNT="$(printf '%s' "$ERR_LINES" | grep -c 'error TS' || true)"

  echo "  检查到的工程文件数: $FILE_COUNT"
  echo "  类型错误数          : $ERR_COUNT"

  if [ "$FILE_COUNT" -eq 0 ]; then
    # 这是本脚本存在的**核心理由**：0 个文件不是"通过"，是"什么都没查"
    echo "  FAIL **空过**：该配置没有检查任何属于本工程的文件 ——"
    echo "       （很可能传的是 solution-style 配置：它只有 files:[] + references，"
    echo "         必须用 -p <leaf 配置> 或 --build 才真正检查）"
    BAD=1
    SUMMARY+=("$proj: VACUOUS(0 files)")
  elif [ "$ERR_COUNT" -ne 0 ] || [ "$RC" -ne 0 ]; then
    echo "  FAIL 类型错误："
    printf '%s\n' "$ERR_LINES" | head -12 | sed 's/^/       /'
    BAD=1
    SUMMARY+=("$proj: FAIL($ERR_COUNT errors)")
  else
    echo "  PASS 无类型错误（真的检查了 $FILE_COUNT 个文件）"
    SUMMARY+=("$proj: PASS($FILE_COUNT files)")
  fi
  echo
done

echo "=== 汇总 ==="
for s in "${SUMMARY[@]}"; do echo "  $s"; done
echo
if [ "$BAD" -eq 0 ]; then
  echo "TYPECHECK: PASS（所有工程都真的被检查、且无错误）"
  exit 0
else
  echo "TYPECHECK: FAIL"
  exit 1
fi
