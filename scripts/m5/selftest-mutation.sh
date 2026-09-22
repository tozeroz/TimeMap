#!/usr/bin/env bash
# 通用敏感度自测驱动：证明某门禁的指定断言**真的能红**
#
# ════════════════════════════════════════════════════════════════════
# 为什么要有这个"通用"驱动（而不是每单写一个一次性脚本）
# ════════════════════════════════════════════════════════════════════
#   本项目的核心纪律是：**断言必须被证明能红**（否则一条恒真断言也会 PASS）。
#   但 Round 267 审计发现：**13 个设备门禁里只有 2 个有"可重复"的敏感度脚本**
#   （selftest-wo10-gate.mjs / selftest-wo15-card-content.sh），其余多数只在文档里
#   有一轮性记录 —— 即"纪律存在、但没有机械化"，下次无法一遍复现。
#
#   ⇒ 把三阶段流程抽成**通用驱动**：调用方只需提供
#       ① 门禁文件  ② 突变脚本（inject/restore）  ③ 期望变红的键
#     流程与纪律（含还原保证）全在这里统一实现，新增覆盖的成本从"写一个脚本"降到"填三个参数"。
#
# ════════════════════════════════════════════════════════════════════
# 三阶段（与 selftest-wo15-card-content.sh 同一纪律）
# ════════════════════════════════════════════════════════════════════
#   ① 基线：当前代码 ⇒ 期望指定键全 PASS 且 DEVICE_GATE_EXIT=0
#   ② 突变：注入受控缺陷 ⇒ 期望**指定键变 FAIL**、且**其它键仍 PASS**（归因清晰）+ EXIT=1
#   ③ 还原：断言回到"**本自测开始前**的内容"（sha256 比对，**不是**比 HEAD —— 见下），
#           再跑一次回到全绿
#
# ⚠️ ③ 为什么比 sha256 而不比 git HEAD：
#   我第一版比 HEAD，结果**把自己未提交的合法改动误判成"突变有残留"**。
#   正确要求是"还原到测试前状态"，与它是否已提交无关。
#
# ⚠️ 突变阶段**必须重新构建+安装**：`run-device-gate.sh` 不负责构建，
#   漏掉会让设备跑旧包 ⇒ 自测得到**无意义的结论**（这一条我也踩过）。
#
# 用法：
#   bash scripts/m5/selftest-mutation.sh \
#        <门禁相对路径> <突变脚本相对路径> <期望变红的键> [<其它键...>]
#
# 示例：
#   bash scripts/m5/selftest-mutation.sh \
#        scripts/m5/gate-wo16-board-avatar.mjs \
#        scripts/m5/mutate-board-avatar.mjs \
#        BOARD_NOTE_AVATAR_NOT_MOCK BOARD_NOTE_AVATAR_INITIAL_MATCHES_NAME
#
# 环境变量：
#   MUT_TARGET=<相对路径>   突变所修改的源文件（用于 sha256 比对；必填）
#   GATE_ENV="K=V K2=V2"    跑门禁时需要的环境变量（如 WO_BOARD_PEER_ID）
set -uo pipefail

cd "G:/demo map" 2>/dev/null || cd "$(dirname "$0")/../.." || exit 2

GATE="${1:-}"
MUT="${2:-}"
shift 2 2>/dev/null || true
EXPECT_FAIL=("$@")
: "${MUT_TARGET:?必须设置 MUT_TARGET=<突变所修改的源文件相对路径>}"

if [ -z "$GATE" ] || [ -z "$MUT" ] || [ "${#EXPECT_FAIL[@]}" -eq 0 ]; then
  echo "用法: bash scripts/m5/selftest-mutation.sh <gate> <mutate-script> <期望变红的键...>"
  echo "      （并设置 MUT_TARGET=<被突变的源文件>）"
  exit 2
fi

restore_if_needed() {
  if [ -f "$MUT_TARGET" ] && [ -f "tools/tmp/$(basename "$MUT_TARGET").orig.txt" ]; then
    node "$MUT" restore >/dev/null 2>&1 || true
    echo "  （trap）已确保工作区回到未突变状态"
  fi
}
trap restore_if_needed EXIT

rebuild_install() {
  echo "  （构建 + 同步 + 安装 APK …）"
  ( cd app && pnpm build >/dev/null 2>&1 && npx cap sync android >/dev/null 2>&1 ) || return 1
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "tools/build-android.ps1" >/dev/null 2>&1 || return 1
  return 0
}

run_gate() {
  # ⚠️⚠️ 这里修过一个**会造成"陈旧锁"的真实 bug**（我自己引入的）：
  #   第一版写的是 `... | grep -E 'VERDICT =|DEVICE_GATE_EXIT' | head -2`。
  #   **`head -2` 取够 2 行就退出** ⇒ grep 再写就吃到 SIGPIPE 而退出 ⇒
  #   门禁脚本自己的后续输出也吃到 SIGPIPE ⇒ **脚本被杀死在半路，走不到"释放门禁锁"那一步**
  #   ⇒ 服务器上的 `/srv/campus/gate.lock` **泄漏**，下一次门禁直接 FATAL
  #     「另一个 Gate 正在运行（互斥锁被占用）」。
  #   实跑证据：`gate-lock.sh status` 显示
  #     device-gate:gate-wo16-board-avatar.mjs|320357|…（年龄 197s）而**没有任何门禁在跑**。
  #   教训：**在"会自己获取/释放资源的脚本"下游用 head/N 行截断，等于可能把它杀掉**。
  #   ⇒ 现在改为：**先把输出整个收下来**，再在本地提取需要的行（不提前关管道）。
  local out
  # shellcheck disable=SC2086
  out="$(env ${GATE_ENV:-} bash scripts/m5/run-device-gate.sh "$GATE" 2>&1)"
  printf '%s\n' "$out" | grep -E 'VERDICT =|DEVICE_GATE_EXIT' | grep -v '^$'
}

# 等门禁锁空闲（有界等待）——避免上一阶段刚结束、释放还没落地就开下一阶段
wait_lock_free() {
  local i s
  for i in $(seq 1 30); do
    s="$(bash scripts/m5/gate-lock.sh status 2>&1)"
    if printf '%s' "$s" | grep -q '空闲'; then
      return 0
    fi
    sleep 2
  done
  echo "  ⚠ 门禁锁等待超时（60s）——继续尝试，若失败需人工检查 /srv/campus/gate.lock"
  return 0
}

# 从 VERDICT 行里取某键的值
key_val() { echo "$1" | grep -o "\"$2\":\"[A-Z_]*\"" | head -1 | sed 's/.*:"//;s/"//'; }

fail=0
PRE_HASH="$(sha256sum "$MUT_TARGET" | cut -d' ' -f1)"
echo "（测试前：$MUT_TARGET sha256=${PRE_HASH:0:12}…）"
echo "门禁：$GATE"
echo "期望变红的键：${EXPECT_FAIL[*]}"
echo

echo "════════ ① 基线：期望指定键全 PASS ════════"
rebuild_install || { echo "  **FAIL** 构建/安装失败"; exit 1; }
wait_lock_free
BASE="$(run_gate)"
echo "$BASE" | sed 's/^/  /'
if echo "$BASE" | grep -q 'DEVICE_GATE_EXIT=0'; then
  echo "  PASS 基线为绿"
else
  echo "  **FAIL** 基线不是绿的 —— 先修基线，本自测无意义"
  fail=1
fi
for k in "${EXPECT_FAIL[@]}"; do
  v="$(key_val "$BASE" "$k")"
  if [ "$v" = "PASS" ]; then echo "  PASS 基线里 $k = PASS"; else echo "  **FAIL** 基线里 $k = '$v'（期望 PASS）"; fail=1; fi
done

echo
echo "════════ ② 突变：注入受控缺陷 ════════"
node "$MUT" inject || { echo "  **FAIL** 突变注入失败"; exit 1; }
rebuild_install || { echo "  **FAIL** 构建/安装失败（突变阶段）"; exit 1; }
wait_lock_free
MUT_OUT="$(run_gate)"
echo "$MUT_OUT" | sed 's/^/  /'

for k in "${EXPECT_FAIL[@]}"; do
  if echo "$MUT_OUT" | grep -q "\"$k\":\"FAIL\""; then
    echo "  PASS ⭐ $k **真的能红**"
  else
    echo "  **FAIL** ⭐ 突变下 $k 没红 ⇒ 它**没有判别力**"
    fail=1
  fi
done
if echo "$MUT_OUT" | grep -q 'DEVICE_GATE_EXIT=1'; then
  echo "  PASS 突变下 DEVICE_GATE_EXIT=1"
else
  echo "  **FAIL** 突变下退出码不是 1"
  fail=1
fi

echo
echo "════════ ③ 还原：应回到测试前状态且全绿 ════════"
node "$MUT" restore || { echo "  **FAIL** 还原失败"; exit 1; }
if [ "$(sha256sum "$MUT_TARGET" | cut -d' ' -f1)" = "$PRE_HASH" ]; then
  echo "  PASS 与本自测**开始前**的内容字节一致"
else
  echo "  **FAIL** 还原后与测试前不一致（有残留）"
  fail=1
fi
rebuild_install || { echo "  **FAIL** 构建/安装失败（还原阶段）"; exit 1; }
wait_lock_free
REST="$(run_gate)"
echo "$REST" | sed 's/^/  /'
if echo "$REST" | grep -q 'DEVICE_GATE_EXIT=0'; then
  echo "  PASS 还原后回到全绿（证明②的变红确实由突变引起）"
else
  echo "  **FAIL** 还原后没回到全绿"
  fail=1
fi

echo
if [ "$fail" = "0" ]; then
  echo "SELFTEST_MUTATION: PASS（$GATE 的指定断言已被证明能红；突变撤销后字节一致地回到全绿）"
else
  echo "SELFTEST_MUTATION: FAIL"
fi
exit "$fail"
