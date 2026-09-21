#!/usr/bin/env bash
# 组合 runner：**先建 CDP 转发 → 跑 VISUAL_TARGET_VALIDITY → 跑设备 Gate → 再核一次 preflight**
#
# 为什么需要它（H4，本轮踩到的坑）：
#   我原先手动调用顺序是「先 preflight → 后建 CDP 转发」，
#   于是 preflight 的 CDP 检查必然报 unreachable（**假 FAIL**）。
#   假 FAIL 会让"证据作废"这条纪律被误触发，久了就会被忽略 —— 那正是纪律失效的开始。
#   → 把顺序封进 runner，顺序错不了。
#
# 用法（在工作站上跑）：
#   bash scripts/m5/run-device-gate.sh <gate脚本.mjs> [更多参数...]
set -u

if [ $# -lt 1 ]; then
  echo "用法: bash scripts/m5/run-device-gate.sh <gate脚本.mjs> [args...]"
  exit 2
fi
GATE="$1"; shift

ADB='G:\Program Files\Netease\MuMu\nx_main\adb.exe'
SERIAL='127.0.0.1:16384'
PKG='com.campusx.demo'
PREFLIGHT='G:\demo map\scripts\m5\preflight-capture.ps1'

echo "=== 1/5 把目标 App 带到前台（am start，不做 force-stop）==="
"$ADB" -s "$SERIAL" shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 3

echo "=== 2/5 建 CDP 转发（必须早于 preflight 的 CDP 检查）==="
PID="$("$ADB" -s "$SERIAL" shell pidof "$PKG" | tr -d '\r')"
if [ -z "$PID" ]; then echo "  FATAL 拿不到 $PKG 的 pid"; exit 1; fi
"$ADB" -s "$SERIAL" forward --remove-all >/dev/null 2>&1
"$ADB" -s "$SERIAL" forward tcp:9222 "localabstract:webview_devtools_remote_${PID}" >/dev/null 2>&1
sleep 1
echo "  forward tcp:9222 → webview_devtools_remote_$PID"

echo "=== 3/5 VISUAL_TARGET_VALIDITY（采集前）==="
powershell -NoProfile -Command "& '$PREFLIGHT' -ExpectPackage $PKG -ExpectCdpUrl localhost" || {
  echo "  VISUAL_TARGET_VALIDITY: FAIL → 证据作废，终止（这不是产品 FAIL）"
  exit 1
}

echo "=== 4/5 跑 Gate: $GATE ==="
node "$GATE" "$@"
RC=$?

echo "=== 5/5 VISUAL_TARGET_VALIDITY（采集后复核：确认期间没被切走）==="
powershell -NoProfile -Command "& '$PREFLIGHT' -ExpectPackage $PKG -ExpectCdpUrl localhost" || {
  echo "  VISUAL_TARGET_VALIDITY(after): FAIL → 本次证据作废"
  exit 1
}

echo
echo "DEVICE_GATE_EXIT=$RC"
exit $RC
