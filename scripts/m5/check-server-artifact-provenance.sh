#!/usr/bin/env bash
# 服务端 artifact provenance 机械检查（**部署产物 vs 仓库源**）
#
# ## 它防的是什么（真实事故；审核记录 50 指出与 Android 侧同源）
#
# 真实事故：服务器上跑的 M5 gate 是一份**手工拷贝的旧副本**，
#   我改了仓库里的 gate 之后，服务器仍在跑老断言，并报出
#   "M5_SERVER_REGRESSION: PASS" —— 那条 PASS 是按**旧断言**得出的。
#   露馅靠的是账本行内容不对（写着 WO5_PHASE1_IMPLEMENTED_AWAITING_FINAL_CLOSE），
#   而不是任何机械检查。
#
# 审核 50 把这类问题总结为：
#   **source changed ≠ executed artifact changed**
# 并在 Android 侧要求"web build → cap asset → installed APK"三方一致。
# 本脚本是**服务端对应物**：
#   本地源码/产物  →  服务器上的部署产物  →  实际在跑的服务
#
# ## 检查什么（三者 + 一处时间关系）
#   ① server/dist/index.mjs        本地 sha256 == 服务器 /srv/campus/dist/index.mjs
#   ② scripts/gates/m5/gate-server.sh  本地 sha256 == 服务器 /tmp/gate-m5.sh
#   ③ 服务进程的启动时间 **晚于** 部署产物 mtime
#      （否则"文件是新的、但跑的还是旧进程" —— 与 Android 侧"装了旧 APK"同构）
#
# ## 用法
#   bash scripts/m5/check-server-artifact-provenance.sh
# 退出码 0 = 一致；1 = 不一致（**此时不得引用任何服务端 Gate 结论**）
set -uo pipefail

KEY='G:\demo map\TimeMap.pem'
HOST='root@8.148.156.146'
ROOT='G:\demo map'
LOCAL_BUNDLE="$ROOT/server/dist/index.mjs"
LOCAL_GATE="$ROOT/scripts/gates/m5/gate-server.sh"
REMOTE_BUNDLE="${SPA_REMOTE_BUNDLE:-/srv/campus/server/dist/index.mjs}"
REMOTE_GATE="${SPA_REMOTE_GATE:-/tmp/gate-m5.sh}"
SERVICE='campus-backend.service'
# 远端路径可用环境变量覆盖 —— 只为**敏感度自检**（见 selftest-server-artifact-provenance.sh），
# 正常运行不要传。

SSH() { ssh -i "$KEY" -o BatchMode=yes "$HOST" "$1" 2>&1; }

# ⚠️ 哈希提取必须**归一化**（我第一版在这里踩了坑，记下来避免重犯）：
#   在 Git Bash 下 `sha256sum file | cut -c1-16` 会得到 **带前导反斜杠** 的串
#   （如 `\3b31cfdfe8867a4`）—— coreutils 对文件名做了转义。
#   结果：本地值 `\96f8fb35…` 与远端值 `96f8fb35…` 明明同源，比较却**不等** →
#   **假 FAIL**。这正是"环境造成的断言缺陷"，比产品缺陷更隐蔽。
#   → 修正：用 awk 取第一列，再 tr 掉所有非十六进制字符，最后校验长度 64。
hash_of_local() {
  # 取纯 hex，并断言长度（长度不对就是提取错了，而不是"内容不同"）
  local h
  h="$(sha256sum "$1" 2>/dev/null | awk '{print $1}' | tr -cd '0-9a-f')"
  if [ "${#h}" -ne 64 ]; then echo ""; else echo "$h"; fi
}
hash_of_remote() {
  local h
  h="$(SSH "sha256sum $1 2>/dev/null" | awk '{print $1}' | tr -cd '0-9a-f')"
  if [ "${#h}" -ne 64 ]; then echo ""; else echo "$h"; fi
}

FAIL=0
ok()  { echo "  PASS $1"; }
bad() { echo "  FAIL $1"; FAIL=1; }

echo "=== 0) 本地产物是否存在（先有产物才谈一致性）==="
for f in "$LOCAL_BUNDLE" "$LOCAL_GATE"; do
  if [ -f "$f" ]; then
    echo "  $(basename "$f")  $(hash_of_local "$f" | cut -c1-16)…"
  else
    bad "本地缺 $f（先跑 server 的 pnpm build / 或确认 gate 路径）"
  fi
done
[ "$FAIL" -eq 1 ] && exit 1

LOCAL_BUNDLE_SHA="$(hash_of_local "$LOCAL_BUNDLE")"
LOCAL_GATE_SHA="$(hash_of_local "$LOCAL_GATE")"

echo
echo "=== 1) API bundle：本地 vs 服务器 ==="
REMOTE_BUNDLE_SHA="$(hash_of_remote "$REMOTE_BUNDLE")"
if [ -z "$REMOTE_BUNDLE_SHA" ]; then
  bad "服务器上读不到 $REMOTE_BUNDLE"
else
  echo "  local : ${LOCAL_BUNDLE_SHA:0:16}…"
  echo "  remote: ${REMOTE_BUNDLE_SHA:0:16}…"
  if [ "$LOCAL_BUNDLE_SHA" = "$REMOTE_BUNDLE_SHA" ]; then
    ok "API bundle 本地与服务器**完全一致**"
  else
    bad "API bundle **不一致** → 服务器跑的不是仓库当前代码（先部署）"
  fi
fi

echo
echo "=== 2) M5 gate 脚本：本地 vs 服务器 ==="
REMOTE_GATE_SHA="$(hash_of_remote "$REMOTE_GATE")"
if [ -z "$REMOTE_GATE_SHA" ]; then
  bad "服务器上读不到 $REMOTE_GATE"
else
  echo "  local : ${LOCAL_GATE_SHA:0:16}…"
  echo "  remote: ${REMOTE_GATE_SHA:0:16}…"
  if [ "$LOCAL_GATE_SHA" = "$REMOTE_GATE_SHA" ]; then
    ok "gate 脚本本地与服务器**完全一致**"
  else
    bad "gate 脚本**不一致** → 服务器跑的是旧副本（那次事故的形态）"
  fi
fi

echo
echo "=== 3) 时间关系：服务进程启动时间是否晚于部署产物 ==="
# 若"文件是新的、但进程还是旧的"，结论同样不可信 —— 与 Android 侧"装了旧 APK"同构
BUNDLE_MTIME="$(SSH "stat -c %Y $REMOTE_BUNDLE 2>/dev/null")"
BUNDLE_MTIME="$(printf '%s' "$BUNDLE_MTIME" | tr -d '\r\n')"
START_TS="$(SSH "systemctl show $SERVICE -p ExecMainStartTimestamp --value")"
START_TS="$(printf '%s' "$START_TS" | tr -d '\r\n')"
echo "  bundle mtime      : $BUNDLE_MTIME（epoch 秒）"
echo "  服务启动时间戳    : $START_TS"
START_EPOCH="$(SSH "date -d '$START_TS' +%s 2>/dev/null")"
START_EPOCH="$(printf '%s' "$START_EPOCH" | tr -d '\r\n')"
if [ -z "$BUNDLE_MTIME" ] || [ -z "$START_EPOCH" ]; then
  bad "拿不到时间戳（无法判定进程是否已重启加载新产物）"
else
  if [ "$START_EPOCH" -ge "$BUNDLE_MTIME" ]; then
    ok "服务启动时间（$START_EPOCH）晚于 bundle mtime（$BUNDLE_MTIME）→ 当前进程已加载该产物"
  else
    bad "服务启动时间（$START_EPOCH）**早于** bundle mtime（$BUNDLE_MTIME）→ 产物更新了但进程没重启"
  fi
fi

echo
echo "=== 4) 迁移账本（顺带核对，防止"代码新了但库没跟上"）==="
LEDGER="$(SSH "journalctl -u $SERVICE --no-pager -n 200 2>/dev/null | grep -o '\\[migrate\\] ready applied=[0-9]*/[0-9]*' | tail -1")"
LEDGER="$(printf '%s' "$LEDGER" | tr -d '\r\n')"
if [ -n "$LEDGER" ]; then
  ok "$LEDGER"
else
  echo "  info 未从日志取到迁移账本行（不影响一致性判定）"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "SERVER_ARTIFACT_PROVENANCE: PASS（本地源 → 服务器产物 → 运行进程 三者一致）"
  exit 0
else
  echo "SERVER_ARTIFACT_PROVENANCE: FAIL（source changed ≠ executed artifact changed）"
  exit 1
fi
