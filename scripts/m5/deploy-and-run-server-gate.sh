#!/usr/bin/env bash
# 部署**当前仓库版本**的门禁脚本到服务器，并跑一次
#
# ## 为什么要这个脚本（本轮发现的真实流程缺口）
#   服务器上执行的是 /tmp/gate-m5.sh 与 /tmp/run-gate.sh —— **手工拷贝的历史副本**。
#   我在仓库里改了 scripts/gates/m5/gate-server.sh（新增 WO#6/WO#7/WO#9A 的键与 M5_OVERALL），
#   但服务器上的副本**没有更新**。症状：
#     我报告的 "M5_SERVER_REGRESSION: PASS" 里，M5_OVERALL 打的是
#       `WO1_WO2_WO3_CLOSED + WO5_PHASE1_IMPLEMENTED_AWAITING_FINAL_CLOSE`
#     —— 那是**好几轮之前**的账本，说明跑的根本不是我改的那份。
#   → **"我改了门禁"不等于"门禁被跑了"**。门禁脚本本身也必须像代码一样部署，
#     否则"PASS"是拿旧断言换来的，而旧断言不认识新的不变量。
#
# 用法（在工作站上跑）：
#   bash scripts/m5/deploy-and-run-server-gate.sh
set -euo pipefail

KEY='G:\demo map\TimeMap.pem'
HOST='root@8.148.156.146'
LOCAL_GATE='G:\demo map\scripts\gates\m5\gate-server.sh'

echo "=== 1) 上传当前仓库版本的门禁 ==="
scp -i "$KEY" -o BatchMode=yes "$LOCAL_GATE" "$HOST:/tmp/gate-m5.sh" >/dev/null
echo "  已上传 scripts/gates/m5/gate-server.sh → /tmp/gate-m5.sh"

echo
echo "=== 1.5) ⭐ 本地静态检查（先证本地是健康的，再谈服务器侧结论）==="
# 为什么放在**部署之前**：
#   如果本地类型检查/门禁语法/PS1 完整性就有问题，那么"服务器侧门禁 PASS"是在
#   验证一份**本身不健康**的产物 —— 顺序上应当先证本地，再证服务器。
#   这也是把 `check-all-local.sh` 从"一个要记得跑的脚本"变成**流程的一步**：
#   本会话已两次因"忘了跑某个检查"而让缺陷溜过（solution 配置的 tsc 空过、
#   deploy-server.ps1 被截断成 3 字节却没人发现）。
if ! bash 'G:\demo map\scripts\m5\check-all-local.sh'; then
  echo "  **FAIL** 本地静态检查未通过 —— 先修本地，再跑服务器侧门禁"
  exit 1
fi

echo
echo "=== 2) SERVER_ARTIFACT_PROVENANCE（委托给权威检查器）==="
# ⚠️ 这里**不再**自己算哈希（原实现用 `sha256sum | cut -d' ' -f1`，
#    在 Git Bash 下会因 coreutils 对文件名转义而带上前导反斜杠 →
#    与远端值比较时**假 FAIL**（或更糟：两边同样被转义时**假 PASS**）；
#    它的回退分支还混用了 certutil 的输出格式，更脆）。
#    现在统一交给 scripts/m5/check-server-artifact-provenance.sh：
#      · 哈希归一化（awk + tr -cd 0-9a-f + 长度校验，避免转义问题）
#      · 同时核对 **API bundle**（原实现只看 gate 脚本）
#      · 核对 **服务进程启动时间 vs bundle mtime**（防"文件新了但进程没重启"）
#      · 顺带打印迁移账本
bash 'G:\demo map\scripts\m5\check-server-artifact-provenance.sh' || {
  echo "  FAIL provenance 不成立 —— **不得引用任何服务端 Gate 结论**"
  exit 1
}

echo
echo "=== 3) ⭐ CORS 客户端方法契约（审核记录 55 的 X1）==="
# 为什么放在**服务器侧**这条流程里：
#   `check-cors-contract.sh` 必须发**真实预检**（OPTIONS + Origin + ACRM + ACRH），
#   也就是必须在**能访问后端**的地方跑。它同时需要**客户端源码**来判断
#   "客户端到底会调用哪些方法"（审核 55：不变量必须是"客户端实际调用的"，
#    而不是"所有已注册路由的"）。
# → 所以这里两件事：先把 client.ts 传成检查器约定的输入，再跑检查。
scp -i "$KEY" -o BatchMode=yes 'G:\demo map\app\src\api\client.ts' "$HOST:/tmp/client-methods-input.txt" >/dev/null
scp -i "$KEY" -o BatchMode=yes 'G:\demo map\scripts\m5\check-cors-contract.sh' "$HOST:/tmp/check-cors-contract.sh" >/dev/null
CORS_OUT="$(ssh -i "$KEY" -o BatchMode=yes "$HOST" 'bash /tmp/check-cors-contract.sh')"
printf '%s\n' "$CORS_OUT" | grep -E '客户端实际使用|method |PASS|FAIL|CORS_CLIENT_METHOD_COVERAGE' | sed 's/^/  /'
if printf '%s' "$CORS_OUT" | grep -q 'CORS_CLIENT_METHOD_COVERAGE: PASS'; then
  echo "  ✓ 客户端实际调用的每个 method 都通过真实预检契约"
else
  echo "  **FAIL** CORS 客户端方法契约不成立 —— 客户端会以「Failed to fetch」失败"
  exit 1
fi

echo
echo "=== 4) 跑门禁并打印账本与结果 ==="
# ⚠️ 调用契约（这里原本是错的，记下来）：
#   gate-m5.sh 的第一个参数是**脚本目录**（默认 /tmp/m5），**不是输出文件**。
#   原实现写的是 `bash /tmp/gate-m5.sh /tmp/gate-current.txt` ——
#   把输出文件当成脚本目录传进去 → 脚本内部找不到聚合目标而退出（实测 EXIT=2，
#   且输出文件根本没被创建，于是后面的 grep 报 "No such file or directory"）。
#   → 正确入口是包装器 /tmp/run-gate.sh <输出文件>：它捕获 gate 输出并打印 **REAL_EXIT**。
#   （这个 bug 之所以一直没被发现，是因为我平时走的是另一条调用路径 ——
#     这正是"包装脚本本身没被端到端跑过"的典型后果。）
ssh -i "$KEY" -o BatchMode=yes "$HOST" "bash /tmp/run-gate.sh /tmp/gate-current.txt; echo '--- 账本 ---'; grep -a -E 'WO[0-9]|CLOSED|NEXT' /tmp/gate-current.txt | tail -6"
