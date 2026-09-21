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
echo "=== 2) 本地与远端 SHA256 必须一致（证明跑的就是我改的那份）==="
LOCAL_SHA=$(sha256sum "$LOCAL_GATE" 2>/dev/null | cut -d' ' -f1 || certutil -hashfile "$LOCAL_GATE" SHA256 | sed -n 2p | tr -d ' \r')
echo "  local  : $LOCAL_SHA"
REMOTE_SHA=$(ssh -i "$KEY" -o BatchMode=yes "$HOST" "sha256sum /tmp/gate-m5.sh | cut -d' ' -f1")
echo "  remote : $REMOTE_SHA"
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "  FAIL 哈希不一致 —— 远端不是我要跑的那份，终止"
  exit 1
fi
echo "  PASS 哈希一致"

echo
echo "=== 3) 跑门禁并打印账本与结果 ==="
ssh -i "$KEY" -o BatchMode=yes "$HOST" "bash /tmp/gate-m5.sh /tmp/gate-current.txt >/dev/null 2>&1; echo EXIT=\$?; grep -E 'M5_OVERALL|WO#9A|WO#7|WO#6|GROUP_|REAL_EXIT|M5_SERVER_GATE_RESULT|PERSISTENT|STAGE|REGRESSION' /tmp/gate-current.txt | head -30"
