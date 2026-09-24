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

FAKE_MEDIA="${FAKE_MEDIA:-1}"
CHROME_FLAGS=()
if [ "$FAKE_MEDIA" = "1" ]; then
  CHROME_FLAGS+=(--use-fake-device-for-media-stream --use-fake-ui-for-media-stream)
fi

# ⭐ 关闭后台/遮挡节流（**实测必需**，不是可选的"优化"）
# ⚠️ 踩到的现象：网页端两个扫码门禁突然 FAIL，detail 里 `frames: 0`
#    （而此前同一批门禁 PASS、frames 有 64）。
#    诊断结论（逐项排除）：
#      · 摄像头**正常** —— getUserMedia 拿到 640x480、readyState=4
#      · 扫码页 <video> **正常** —— videoWidth=1920、未暂停、readyState=4
#      · 但 `document.visibilityState="hidden"`、`hasFocus=false`
#      · 且 200ms 内 `requestAnimationFrame` **回调 0 次**
#    ⇒ 根因：Chrome 窗口被其它窗口（如模拟器）遮挡 ⇒ **rAF 被节流到 0**
#      ⇒ 逐帧解码循环跑不起来 ⇒ frames 恒为 0 ⇒ 扫码门禁**误判为功能缺陷**。
#    ⚠️ 这是**环境抖动**，不是产品问题；留着它会让"网页端全量审计"不可复现
#      （同一批门禁换个窗口遮挡状态结论就不同）。
#    ⇒ 用 Chrome 官方开关关掉这三类节流（三件套都要）：
#        --disable-backgrounding-occluded-windows  窗口被遮挡也不进后台
#        --disable-renderer-backgrounding          渲染进程不降级
#        --disable-background-timer-throttling     不做后台定时器节流
#    ⚠️ 另：run-web-gate.sh 在跑门禁前还会 `Page.bringToFront`（双保险）。
CHROME_FLAGS+=(--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling)
# ⚠️ 关键：把"本次期望的 flag 集合"记在 profile 里。
#    因为下面遇到"9222 上已有桌面浏览器"时会**复用**它 —— 若复用了一个用**旧 flag**
#    启动的实例，我改了 flag 却以为生效了（例如以为已启用合成摄像头，实际没有），
#    那就会得出错误结论。所以要先比对，不一致就重启。
FLAGS_MARKER="$PROFILE/.dsh-flags"
DESIRED_FLAGS="$(printf '%s\n' "${CHROME_FLAGS[@]:-}")"

echo "=== 1) 检查 9222 现在是谁占着 ==="
if curl -s -m 3 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  VER=$(curl -s -m 3 "http://127.0.0.1:$PORT/json/version")
  if printf '%s' "$VER" | grep -q 'Android-Package'; then
    echo "  ⚠️ 9222 被**模拟器 WebView** 占着 ⇒ 撤掉 adb 转发以释放端口"
    ADB_SERIAL="${ADB_SERIAL:-127.0.0.1:16384}"
    if ! "$ADB" -s "$ADB_SERIAL" forward --remove "tcp:$PORT" 2>&1 | sed 's/^/    /'; then
      echo "  ⚠️ 撤转发命令返回非零（下面会再确认端口是否真的释放）"
    fi
    sleep 1
  else
    EXISTING="$(cat "$FLAGS_MARKER" 2>/dev/null || echo '(未知)')"
    if [ "$EXISTING" = "$DESIRED_FLAGS" ]; then
      echo "  ✓ 9222 上已有桌面浏览器，且启动参数与本次期望一致 ⇒ 复用"
      printf '%s' "$VER" | grep -E '"Browser"' | sed 's/^/    /'
      exit 0
    fi
    echo "  ⚠️ 已有桌面浏览器，但启动参数与期望不一致 ⇒ 重启（避免"以为生效了"）"
    echo "     已有: $(printf '%s' "$EXISTING" | tr '\n' ' ')"
    echo "     期望: $(printf '%s' "$DESIRED_FLAGS" | tr '\n' ' ')"
    powershell.exe -NoProfile -Command "
\$ps = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*web-chrome-profile*' }
if (\$ps) { \$ps | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue } }" >/dev/null 2>&1 || true
    sleep 2
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
#
# ⭐ 合成媒体设备（--use-fake-device-for-media-stream）：
#    这台测试机**没有真实摄像头/麦克风**。不加这两个开关时，扫描器/录音相关门禁
#    会因为拿不到流而卡在"正在准备摄像头…"⇒ 无法判定功能对错
#    （实测：gate-scanner-entry / gate-wo21 / gate-wo22×2 四个门禁因此 FAIL）。
#    用 Chrome 官方的合成设备（y4m 视频 + 生成音频）就能让**同一条功能路径真的跑起来**，
#    于是断言验的是应用逻辑，而不是"这台机器有没有摄像头"。
#    ⚠️ --use-fake-ui-for-media-stream 会自动同意权限弹窗。
#       代价：**无法**用它测"用户拒绝授权"这条分支 ⇒ 那一分支需要单独的方式验证，
#       不能因此声称已覆盖。（详见 docs/WEB-FRONTEND.md）
#    ⚠️ 可用 FAKE_MEDIA=0 关掉这两个开关（用于验证"无设备/拒绝授权"时的显式状态）。
# （FAKE_MEDIA / CHROME_FLAGS / DESIRED_FLAGS 已在上面定义 —— 那里是"复用判断"所需，
#  这里不再重复定义，避免两处定义将来各自漂移。）
[ "$FAKE_MEDIA" = "1" ] && echo "  （启用合成摄像头/麦克风；FAKE_MEDIA=0 可关闭）"
"$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=Translate,OptimizationHints \
  --window-size=430,932 \
  "${CHROME_FLAGS[@]}" \
  "$URL" >/dev/null 2>&1 &

for i in $(seq 1 30); do
  if curl -s -m 3 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "  ✓ 端口就绪（第 ${i} 次探测）"
    curl -s -m 3 "http://127.0.0.1:$PORT/json/version" | grep -E '"Browser"' | sed 's/^/    /'
    # 记录本次启动参数，供下次"复用判断"比对（见上文 ⚠️）
    printf '%s' "$DESIRED_FLAGS" > "$FLAGS_MARKER" 2>/dev/null || true
    exit 0
  fi
  sleep 1
done
echo "  ✗ 30 秒内未就绪"
exit 1
