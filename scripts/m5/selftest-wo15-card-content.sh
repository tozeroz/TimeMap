#!/usr/bin/env bash
# 自测：`MARKER_CARD_CONTENT_FROM_AUTHORITY` 这条断言**真的能红**吗？
#
# ════════════════════════════════════════════════════════════════════
# 为什么必须有它（本项目的核心纪律）
# ════════════════════════════════════════════════════════════════════
#   Round 266 我查出并修掉了一个**自己引入的回归**：三个地图实现原本
#     const post = posts.find((p) => p.id === m.postId)   ← 去 **mock** 里查帖子
#   而 WO#15 之后 m.postId 是**真实帖子的 UUID**（mock 里是 p1/p2…）
#   ⇒ 该 find **永远 undefined** ⇒ 卡片封面与文字**都是空**；
#     而标记仍画得出来、地名也还在 ⇒ 表现为"卡片没内容"，**极难发现**。
#   ⚠️ **当时那批断言完全没覆盖卡片内容** ⇒ 那是断言覆盖面的**缺口**。
#
#   Round 267 补了 `MARKER_CARD_CONTENT_FROM_AUTHORITY`。
#   但"补了一条断言"本身**不构成**保障 —— 它可能是**没有判别力**的
#   （比如永远返回 PASS）。本项目已反复强调：**断言必须被证明能红**。
#
# ════════════════════════════════════════════════════════════════════
# 三阶段（用一个"受控突变"制造已知缺陷）
# ════════════════════════════════════════════════════════════════════
#   ① 基线   ：当前代码 ⇒ 期望 6 键全 PASS、DEVICE_GATE_EXIT=0
#   ② 突变   ：把卡片内容改回"空"（等价于旧代码在 mock 里查不到帖子的后果）
#               ⇒ 期望 **只有** MARKER_CARD_CONTENT_FROM_AUTHORITY 变 FAIL，
#                 其余 5 键仍 PASS（**归因清晰**：证明是这个原因导致的红），
#                 且 DEVICE_GATE_EXIT=1
#   ③ 还原   ：从备份还原 ⇒ 断言 `git diff --exit-code` **字节一致**，
#              再跑一次回到 6 键全 PASS（证明②的变红确实由突变引起）
#
# ⚠️ 需要设备在线的完整门禁链（跑 run-device-gate.sh），因此较慢（每阶段含构建+安装）。
# ⚠️ 退出时**总会**尝试还原（trap EXIT），避免把突变留在工作区。
#
# 用法：bash scripts/m5/selftest-wo15-card-content.sh
set -uo pipefail

cd "G:/demo map" 2>/dev/null || cd "$(dirname "$0")/../.." || exit 2
MUT="scripts/m5/mutate-card-content.mjs"
GATE="scripts/m5/gate-wo15-map-markers.mjs"
TARGET="app/src/native/TencentMap.tsx"
KEY="MARKER_CARD_CONTENT_FROM_AUTHORITY"

restore_if_needed() {
  if [ -f "tools/tmp/TencentMap.orig.txt" ]; then
    node "$MUT" restore >/dev/null 2>&1 || true
    rm -f "tools/tmp/TencentMap.orig.txt" 2>/dev/null || true
    echo "  （trap）已确保工作区回到未突变状态"
  fi
}
trap restore_if_needed EXIT

# ⚠️ 必须重新构建 + 安装：`run-device-gate.sh` **不负责构建**，
#    所以"改了源码"不会自动反映到设备上 —— 突变阶段若漏掉这一步，
#    设备跑的还是旧包，本自测会得到**无意义的结论**。
rebuild_install() {
  echo "  （构建 + 同步 + 安装 APK …）"
  ( cd app && pnpm build >/dev/null 2>&1 && npx cap sync android >/dev/null 2>&1 ) || return 1
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools/build-android.ps1" >/dev/null 2>&1 || return 1
  return 0
}

run_gate() {
  bash scripts/m5/run-device-gate.sh "$GATE" 2>&1 \
    | grep -E 'VERDICT =|DEVICE_GATE_EXIT' | head -2
}

fail=0

echo "════════ ① 基线：当前代码应 6 键全 PASS ════════"
rebuild_install || { echo '  **FAIL** 构建/安装失败'; exit 1; }
BASE="$(run_gate)"
echo "$BASE" | sed 's/^/  /'
if echo "$BASE" | grep -q 'DEVICE_GATE_EXIT=0'; then
  echo "  PASS 基线为绿"
else
  echo "  **FAIL** 基线不是绿的 —— 先修基线，本自测无意义"
  fail=1
fi
if echo "$BASE" | grep -q "\"$KEY\":\"PASS\""; then
  echo "  PASS 基线里 $KEY = PASS"
else
  echo "  **FAIL** 基线里 $KEY 不是 PASS"
  fail=1
fi

echo
echo "════════ ② 突变：把卡片内容改回「空」 ════════"
node "$MUT" inject || { echo "  **FAIL** 突变注入失败"; exit 1; }
echo "  已突变 $TARGET（cover=undefined ／ 文本片段=空串）"
rebuild_install || { echo '  **FAIL** 构建/安装失败（突变阶段）'; exit 1; }
MUT_OUT="$(run_gate)"
echo "$MUT_OUT" | sed 's/^/  /'

if echo "$MUT_OUT" | grep -q "\"$KEY\":\"FAIL\""; then
  echo "  PASS ⭐ 断言**真的能红**（这是本自测存在的全部意义）"
else
  echo "  **FAIL** ⭐ 突变下该断言竟然没红 ⇒ 它**没有判别力**"
  fail=1
fi

# 归因清晰性：突变下**其余键**应仍 PASS，证明变红不是"整个 Gate 崩了"
OTHERS_FAILED=0
for k in MAP_MARKERS_FROM_AUTHORITY MARKER_COUNT_MATCHES_POSTS_WITH_VALID_COORDS \
         OFFLINE_RENDERS_NO_GEO_MARKERS NO_FABRICATED_PLACE_DATA MAP_NO_FALLBACK_ON_UNAVAILABLE; do
  if echo "$MUT_OUT" | grep -q "\"$k\":\"FAIL\""; then
    echo "  ⚠ 突变下 $k 也 FAIL 了 —— 归因不够干净（需检查该突变是否影响了别的断言）"
    OTHERS_FAILED=1
  fi
done
if [ "$OTHERS_FAILED" = "0" ]; then
  echo "  PASS 归因清晰：突变只打红了目标键，其余 5 键仍 PASS"
fi

echo
echo "════════ ③ 还原：应回到 6 键全 PASS 且字节一致 ════════"
node "$MUT" restore || { echo "  **FAIL** 还原失败"; exit 1; }
rm -f "tools/tmp/TencentMap.orig.txt" 2>/dev/null || true

if git diff --exit-code "$TARGET" >/dev/null 2>&1; then
  echo "  PASS git diff --exit-code = 0（与提交版本**字节一致**）"
else
  echo "  **FAIL** 还原后与原提交不一致（有残留改动）"
  fail=1
fi

rebuild_install || { echo '  **FAIL** 构建/安装失败（还原阶段）'; exit 1; }
REST="$(run_gate)"
echo "$REST" | sed 's/^/  /'
if echo "$REST" | grep -q 'DEVICE_GATE_EXIT=0' && echo "$REST" | grep -q "\"$KEY\":\"PASS\""; then
  echo "  PASS 还原后回到全绿（证明②的变红确实由突变引起）"
else
  echo "  **FAIL** 还原后没回到全绿"
  fail=1
fi

echo
if [ "$fail" = "0" ]; then
  echo "SELFTEST_WO15_CARD_CONTENT: PASS（断言已被证明能红，且突变撤销后字节一致地回到全绿）"
else
  echo "SELFTEST_WO15_CARD_CONTENT: FAIL"
fi
exit "$fail"
