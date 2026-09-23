#!/usr/bin/env bash
# 启动一个**专门用于网页端测试**的 Chrome，并让它占用 **9222**（与既有门禁的约定一致）
#
# ════════════════════════════════════════════════════════════════════════════
# 核心思路：复用既有门禁，而不是为网页端另写一套断言
# ════════════════════════════════════════════════════════════════════════════
#   既有 20+ 个设备门禁本来就是**通过 CDP + DOM 选择器**驱动的 ——
#   它们编码的是"每个功能怎样才算正确"（M5 的验收口径）。
#   它们的 CDP 地址硬编码为 `http://127.0.0.1:9222/json`（62 个文件）。
#
#   ⇒ 与其改 62 个文件（churn 大、易错），不如让**网页端也用 9222**：
#       · 设备门禁用 adb 把模拟器 WebView 转发到 9222
#       · 网页端门禁先把该转发撤掉（端口即释放），再让 Chrome 监听 9222
#     ⇒ **现有门禁一行都不用改**，靠"谁占着 9222"切换目标，
#       而且 `run-device-gate.sh` 自己会重建 adb 转发 ⇒ 两个目标天然互斥。
#
#   ⚠️ 因此**不要并发**跑设备门禁与网页端门禁（会抢 9222）。
#
# ⚠️ 用**独立 user-data-dir**：绝不能碰用户自己的 Chrome 配置。
set -uo pipefail

CHROME="${CHROME_BIN:-C:/Program Files/Google/Chrome/Application/chrome.exe}"
PORT="${CDP_PORT:-9222}"
PROFILE="${WEB_PROFILE_DIR:-G:/demo map/tools/tmp/web-chrome-profile}"
URL="${WEB_URL:-https://8.148.156.146/}"
ADB="${ADB_BIN:-G:/Program Files/Netease/MuMu/nx_main/adb.exe}"

echo "=== 1) 检查 9222 现在是谁占着 ==="
if curl -s -m 3 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  VER=$(curl -s -m 3 "http://127.0.0.1:$PORT/json/version")
  if printf '%s' "$VER" | grep -q 'Android-Package'; then
    echo "  ⚠️ 9222 被**模拟器 WebView** 占着 ⇒ 撤掉 adb 转发以释放端口"
    # ⚠️ 这里修过一次**静默失败**：
    #    初版写 `"$ADB" forward --remove-all >/dev/null 2>&1 || true`
    #      · 不带 `-s <serial>` 时只作用于"默认设备"，本机有多个 adb 端点时不生效
    #      · 末尾的 `|| true` 又把失败**吞掉**了 ⇒ 表现为"撤了但端口还占着"，
    #        而我一度以为是"端口被别的进程占用"（错误归因）
    #    ⇒ 改成：显式指定 serial + **失败就报出来**（不再 || true）。
    ADB_SERIAL="${ADB_SERIAL:-127.0.0.1:16384}"
    if ! "$ADB" -s "$ADB_SERIAL" forward --remove "tcp:$PORT" 2>&1 | sed 's/^/    /'; then
      echo "  ⚠️ 撤转发命令返回非零（下面会再确认端口是否真的释放）"
    fi
    sleep 1
  else
    echo "  ✓ 9222 上已是桌面浏览器（很可能是我们自己的 web Chrome）⇒ 复用"
    printf '%s' "$VER" | grep -E '"Browser"|"webSocketDebuggerUrl"' | sed 's/^/    /'
    exit 0
  fi
fi

echo
echo "=== 2) 确认端口已空 ==="
if curl -s -m 3 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "  ✗ 端口仍被占用（可能是别的进程）—— 不强行抢，请人工确认"
  exit 1
fi
echo "  ✓ 已释放"

echo
echo "=== 3) 启动 Chrome（独立 profile，调试端口 $PORT）==="
mkdir -p "$PROFILE"
# ⚠️ **不加** --ignore-certificate-errors。
#    理由：我们刚把证书换成公共信任的 Let's Encrypt；若这里忽略证书错误，
#    就等于把"证书是否可信"从测试里抹掉 —— 而"浏览器不认私有 CA"
#    正是我们换证书要解决的问题。
"$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=Translate,OptimizationHints \
  --window-size=430,932 \
  "$URL" >/dev/null 2>&1 &

for i in $(seq 1 30); do
  if curl -s -m 3 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "  ✓ 端口就绪（第 ${i} 次探测）"
    curl -s -m 3 "http://127.0.0.1:$PORT/json/version" | grep -E '"Browser"' | sed 's/^/    /'
    exit 0
  fi
  sleep 1
done
echo "  ✗ 30 秒内未就绪"
exit 1
