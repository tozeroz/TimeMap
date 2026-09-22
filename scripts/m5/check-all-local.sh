#!/usr/bin/env bash
# 本地静态检查聚合入口（**非破坏性、不需要设备、不需要服务器**）
#
# ## 为什么需要它
#   本仓库的检查脚本越来越多（类型 / 门禁语法 / PS1 完整性 / 清单一致性 / 基线完整性 / 产物溯源…），
#   而它们此前**散在各处、需要人记得逐个跑** —— 实测这已经造成过问题：
#     · 我改完 `app/` 后用 `npx tsc --noEmit`（solution 配置）得到"0 错误"，
#       而它其实**一个文件都没检查**；后来换成真实叶子配置才发现 12 个错误。
#     · 我改完 `deploy-server.ps1` 后没跑 PS1 完整性检查，结果它静默坏掉（截断成 3 字节）。
#   → 把"该跑的本地检查"收成**一条命令**，比依赖记忆可靠。
#
# ## 它跑什么（全部只读、不连服务器、不碰设备）
#   ① check-types.sh                —— 三个 TS 工程（且会报告**真的检查了几个文件**）
#   ② check-gate-syntax.sh          —— 所有 *.mjs 门禁的语法（含"反引号/模板串"这类陷阱）
#   ③ check-ps1-integrity.sh        —— tools/*.ps1 的 BOM/换行/非空可解析
#   ④ 基线清单一致性 check-baseline-manifest.mjs
#   ⑤ check-baseline-integrity.sh   —— 基线文件本身的完整性（若存在）
#
# ## 不跑什么（以及为什么）
#   · 设备门禁（run-device-gate.sh）—— 需要 MuMu 与 CDP，且是**串行独占**资源
#   · 服务器侧门禁（run-gate-server.sh）—— 需要 ssh；且含**破坏性**节（见 run-destructive-gate.sh）
#   · CORS 契约检查（check-cors-contract.sh）—— 需要**服务器上**的 client 源码副本与真实预检
#   · 任何 selftest-* —— 它们验证"门禁能红"，属**一次性/变更时**执行，不必每次跑
#
# 用法：bash scripts/m5/check-all-local.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

FAIL=0
run() {
  local title="$1"; shift
  echo
  echo "=============================================================="
  echo "== $title"
  echo "=============================================================="
  if "$@"; then
    echo "-- OK: $title"
  else
    echo "-- **FAIL**: $title"
    FAIL=1
  fi
}

run "① 类型检查（三工程；会报告实际检查文件数）" bash scripts/m5/check-types.sh
run "② 门禁语法检查（*.mjs）"                   bash scripts/m5/check-gate-syntax.sh
run "③ PowerShell 脚本完整性（BOM/换行/非空可解析）" bash scripts/m5/check-ps1-integrity.sh
# ⭐ ④b 基线来源权威性（审核记录 57 的 X5 批准接入常规检查）
# ⚠️ 注意它抓的是 **UNEXPLAINED** mismatch，不是所有 mismatch ——
#    旧快照 ≠ 权威索引 是**合法历史**（M0 复现失败 → M3 恢复），不应判 FAIL。
#    正确口径：有 supersedes 声明 → EXPLAINED_MISMATCH（OK）；无解释 → FAIL。
run "④b 基线来源权威性（SOURCE_VALIDITY；抓 UNEXPLAINED mismatch）" node scripts/m5/baseline-inventory.mjs --check

echo
echo "=============================================================="
echo "== ④ 冻结 manifest 一致性"
echo "=============================================================="
if node scripts/m5/check-baseline-manifest.mjs; then
  echo "-- OK: manifest 一致性"
else
  echo "-- **FAIL**: manifest 一致性"
  FAIL=1
fi

echo
echo "=============================================================="
echo "== ⑤ 基线完整性（**服务器侧专用**，本地不跑）"
echo "=============================================================="
# ⚠️ 我第一版把 `check-baseline-integrity.sh` 放进了这个"本地"聚合器 —— **那是错的**：
#    它依赖 `/srv/campus/.db_password` 与 `psql`，属**服务器侧**脚本。
#    在本地跑它必然失败，而失败原因是 `psql: command not found` ——
#    与它声称要验证的性质（基线/残留）**毫无关系**。
#    这正是本项目反复出现的形态：**一个检查因为错误的原因而红**，
#    久之会训练人忽略红色。→ 已移除，改由服务器侧路径执行。
echo "  check-baseline-integrity.sh 需要服务器环境（/srv/campus/.db_password + psql）"
echo "  → 请在服务器上跑：bash /tmp/check-baseline-integrity.sh"
echo "  （本聚合器只跑**非破坏性、不需要服务器、不需要设备**的检查 —— 见文件头说明）"

echo
echo "=============================================================="
if [ "$FAIL" -eq 0 ]; then
  echo "CHECK_ALL_LOCAL: PASS（上述各项本地检查全部通过；其中 ④b 为审核 57 批准接入的基线来源权威性检查）"
else
  echo "CHECK_ALL_LOCAL: FAIL（至少一项失败，见上面的 **FAIL** 标记）"
fi
echo "=============================================================="
exit "$FAIL"
