#!/usr/bin/env bash
# X5 自测：`baseline-inventory.mjs --check` 必须只抓 **UNEXPLAINED** mismatch
#
# ## 为什么自测的判据是"这一条"（审核记录 57 的要求）
#   审核 57 明确：**不要**把"snapshot ≠ manifest"一律当 FAIL ——
#   旧快照是**合法历史**（M0 复现失败 → M3 恢复），保留它才有 provenance。
#   正确的三分法：
#     snapshot == manifest                                  → OK
#     snapshot != manifest **且有**已声明 supersedes         → EXPLAINED_MISMATCH（仍 OK）
#     snapshot != manifest **且没有**解释                    → **FAIL**
#   ⇒ 所以自测必须验证**两个方向**：
#     ① 基线（有 supersedes）→ 必须 **PASS**，且 3 处 mismatch 记为 EXPLAINED
#     ② 受控破坏（拿掉 supersedes 声明）→ 必须 **FAIL**，且故障名指向 UNEXPLAINED
#   只测 ① 的话，"把所有 mismatch 都当 FAIL" 的错误实现也会"通过"——
#   而那正是我第一版工具的错口径。
#
# ## 受控破坏怎么做（必须可逆、且即使中断也能复原）
#   把 `supplements/at-panel.json` **临时改名**（不是删除，避免"删了忘了还原"），
#   跑一次 --check，再用 **trap EXIT 保证还原**。
#
# 用法：bash scripts/m5/selftest-baseline-inventory.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
SUP='docs/original-baseline/supplements/at-panel.json'
HID='docs/original-baseline/supplements/at-panel.json.hidden-by-selftest'
FAIL=0

# ⭐ 无论怎么退出都还原（否则会把基线弄成"少一个补采"的状态）
restore() {
  if [ -f "$HID" ]; then mv -f "$HID" "$SUP"; fi
}
trap restore EXIT

echo "=== ① 基线（有 supersedes 声明）→ 必须 PASS，且 mismatch 被标 EXPLAINED ==="
OUT1="$(node scripts/m5/baseline-inventory.mjs --check 2>&1)"
RC1=$?
printf '%s\n' "$OUT1" | grep -aE 'BASELINE_SOURCE_VALIDITY|BASELINE_UNEXPLAINED_MISMATCHES|EXPLAINED_MISMATCH' | sed 's/^/    /'
if [ "$RC1" = "0" ] && printf '%s' "$OUT1" | grep -q 'BASELINE_UNEXPLAINED_MISMATCHES: 0'; then
  echo "  PASS 基线通过，且未把合法历史误判为 FAIL"
else
  echo "  **FAIL** 基线本应 PASS"
  FAIL=1
fi

echo
echo "=== ② 受控破坏：临时拿掉 at-panel 的 supersedes 声明 → 必须 FAIL ==="
if [ ! -f "$SUP" ]; then echo "  **FAIL** 找不到 $SUP"; exit 1; fi
mv -f "$SUP" "$HID"
OUT2="$(node scripts/m5/baseline-inventory.mjs --check 2>&1)"
RC2=$?
printf '%s\n' "$OUT2" | grep -aE 'BASELINE_SOURCE_VALIDITY|BASELINE_UNEXPLAINED_MISMATCHES|无任何 supersedes' | sed 's/^/    /'
if [ "$RC2" != "0" ] && printf '%s' "$OUT2" | grep -q 'BASELINE_UNEXPLAINED_MISMATCHES: 1'; then
  echo "  PASS 正确抓到 UNEXPLAINED mismatch（exit=$RC2）"
else
  echo "  **FAIL** 破坏了却没判 FAIL（或故障数量不符）"
  FAIL=1
fi
restore

echo
echo "=== ③ 还原后必须回到 PASS（证明破坏是唯一变量）==="
OUT3="$(node scripts/m5/baseline-inventory.mjs --check 2>&1)"
RC3=$?
if [ "$RC3" = "0" ] && printf '%s' "$OUT3" | grep -q 'BASELINE_SOURCE_VALIDITY: PASS'; then
  echo "  PASS 已还原且回到 PASS"
else
  echo "  **FAIL** 还原后仍不是 PASS —— 自测污染了环境"
  FAIL=1
fi
ls -1 docs/original-baseline/supplements/ | sed 's/^/    现有补采: /'

echo
if [ "$FAIL" -eq 0 ]; then
  echo "SELFTEST_BASELINE_INVENTORY: PASS（两个方向都验证：合法历史不误杀、无解释的不一致必抓）"
else
  echo "SELFTEST_BASELINE_INVENTORY: FAIL"
fi
exit "$FAIL"
