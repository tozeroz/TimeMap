#!/usr/bin/env bash
# 机械检查：**所有设备侧 Gate 脚本的语法**（三次重复事故的防线）
#
# ## 为什么需要它（而不是靠记性）
#   设备侧 Gate 大量写成 `await evaluate(`` ` ``(() => {...})()`` ` ``)` 的形式。
#   只要**模板字符串内部**再出现一个反引号（例如注释里写了 `[data-at-panel]`），
#   模板就会提前闭合 → 整个脚本 SyntaxError（"missing ) after argument list"）。
#   本项目已**踩了三次**（给审核写消息 ×1、gate-wo9b 注释 ×2）。
#   三次都不是"不懂语法"，而是**靠记性防不住** → 必须机械检查。
#
# ## 检查方式
#   用 `node --check`（真正的 JS 语法检查，而不是自己写启发式）。
#   语法错了就 exit 非零，并把报错行打出来 —— 那一行通常就是提前闭合的位置。
#
# ## 用法
#   bash scripts/m5/check-gate-syntax.sh          # 检查 scripts/m5/*.mjs
#   bash scripts/m5/check-gate-syntax.sh <file>…  # 检查指定文件
set -uo pipefail

DIR='G:\demo map\scripts\m5'
FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then
  # 用 find 而不是 glob，避免路径含空格时的分词问题
  mapfile -t FILES < <(find "$DIR" -maxdepth 1 -name '*.mjs' -type f | sort)
fi

BAD=0
CHECKED=0
for f in "${FILES[@]}"; do
  [ -e "$f" ] || continue
  CHECKED=$((CHECKED + 1))
  if OUT="$(node --check "$f" 2>&1)"; then
    echo "  PASS $(basename "$f")"
  else
    BAD=$((BAD + 1))
    echo "  FAIL $(basename "$f")"
    # 只打前 6 行：第一行通常就是出错位置（提前闭合的那一行）
    printf '%s\n' "$OUT" | head -6 | sed 's/^/       /'
  fi
done

echo
echo "  检查 $CHECKED 个 .mjs"
if [ "$BAD" -eq 0 ]; then
  echo "GATE_SYNTAX_CHECK: PASS"
  exit 0
else
  echo "GATE_SYNTAX_CHECK: FAIL（$BAD 个文件语法不过）"
  exit 1
fi
