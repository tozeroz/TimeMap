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
API_ORIGIN_PREFLIGHT='G:\demo map\scripts\m5\preflight-api-origin.mjs'
PROVENANCE_CHECK='G:\demo map\scripts\m5\check-artifact-provenance.sh'

echo "=== 1/8 把目标 App 带到前台（am start，不做 force-stop）==="
"$ADB" -s "$SERIAL" shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 3

echo "=== 2/8 建 CDP 转发（必须早于 preflight 的 CDP 检查）==="
PID="$("$ADB" -s "$SERIAL" shell pidof "$PKG" | tr -d '\r')"
if [ -z "$PID" ]; then echo "  FATAL 拿不到 $PKG 的 pid"; exit 1; fi
"$ADB" -s "$SERIAL" forward --remove-all >/dev/null 2>&1
"$ADB" -s "$SERIAL" forward tcp:9222 "localabstract:webview_devtools_remote_${PID}" >/dev/null 2>&1
sleep 1
echo "  forward tcp:9222 → webview_devtools_remote_$PID"

echo "=== 3/8 VISUAL_TARGET_VALIDITY（采集前）==="
powershell -NoProfile -Command "& '$PREFLIGHT' -ExpectPackage $PKG -ExpectCdpUrl localhost" || {
  echo "  VISUAL_TARGET_VALIDITY: FAIL → 证据作废，终止（这不是产品 FAIL）"
  exit 1
}

echo "=== 4/8 ARTIFACT_PROVENANCE（web → cap asset → 已装 APK 三者一致）==="
# 为什么要有它（真实事故；审核记录 50 建议做成机械证明）：
#   我改完前端只跑了 pnpm build + build-android.ps1，**漏跑 npx cap sync android**，
#   装机后跑的是**旧 bundle**，而设备 Gate 照样有输出 ——
#   差点把"新代码根本没生效"误读成"新代码没通过"。
#   同类问题还有：服务器上的 gate 是手工拷贝的旧副本（改了仓库不会自动生效）。
#   两者本质相同：**source changed ≠ executed artifact changed**。
#   → 引用任何设备结论之前，先证明 web 产物 / cap asset / 已装 APK **同名且同 sha256**。
bash "$PROVENANCE_CHECK" || {
  echo "  ARTIFACT_PROVENANCE: FAIL → 本次设备结论**不可引用**（装的可能不是当前代码）"
  exit 3
}

echo "=== 5/8 API_E2E_ORIGIN_VALIDITY（采集前；审核记录 47 要求的机械前置）==="
# 为什么要有它（本项目**已踩两次**的坑）：
#   在 Capacitor WebView 里用**相对路径** fetch 会打到 WebView 自己的本地服务器
#   （https://localhost），并且**返回 HTML 且状态码 200** → json() 得 {}，
#   看起来像"服务端没返回字段"。第一次踩在 WO#5 的语音 E2E，第二次踩在 WO#9A 的身份 oracle。
# 审核 47 要求把它升级成**机械前置**：捕获到 text/html 就**直接 FATAL**，
#   不要继续 json() 让 {} 污染后续判断。
# 因此：这里先证明"绝对 origin 能从 WebView 打到后端且返回 JSON"，
#   不成立就终止（exit 2），后续所有 API 断言一并不作数。
node "$API_ORIGIN_PREFLIGHT"
RC_ORIGIN=$?
if [ "$RC_ORIGIN" -ne 0 ]; then
  echo "  API_E2E_ORIGIN_VALIDITY: FATAL（exit $RC_ORIGIN）→ 本次所有 API 断言不可信，终止"
  exit 2
fi

echo "=== 6/8 跑 Gate: $GATE ==="
node "$GATE" "$@"
RC=$?

echo "=== 7/8 VISUAL_TARGET_VALIDITY（采集后复核：确认期间没被切走）==="
powershell -NoProfile -Command "& '$PREFLIGHT' -ExpectPackage $PKG -ExpectCdpUrl localhost" || {
  echo "  VISUAL_TARGET_VALIDITY(after): FAIL → 本次证据作废"
  exit 1
}

echo
echo "=== 8/8 汇总 ==="
echo "DEVICE_GATE_EXIT=$RC"
exit $RC
