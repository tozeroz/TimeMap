#!/usr/bin/env bash
# 网页端门禁 runner —— 与 run-device-gate.sh 对应，但目标是**桌面浏览器里的网页端**
#
# ════════════════════════════════════════════════════════════════════════════
# 为什么复用同一批门禁（而不是为网页端另写一套断言）
# ════════════════════════════════════════════════════════════════════════════
#   既有门禁本来就是 CDP + DOM 选择器驱动的，编码的是"每个功能怎样才算正确"。
#   若为网页端另写一套，就会有两套口径，且必然随时间漂移。
#   ⇒ 复用同一批断言、只换"目标"，才能保证两端**用的是同一个正确性定义**。
#
# ════════════════════════════════════════════════════════════════════════════
# 与 run-device-gate.sh 的差异（以及为什么）
# ════════════════════════════════════════════════════════════════════════════
#   · 设备版：用 adb 检查前台应用 + artifact provenance（web→cap→已装 APK）
#     ⇒ 这两项**对网页端不适用**（没有 APK、没有前台应用概念），
#        所以这里不照抄，而是做**对应的**目标校验：
#          - CDP 上必须是**桌面浏览器**（不能是 Android WebView）
#          - 页面 URL 必须是我们的**网页端地址**
#     ⚠️ 合并"跳过不适用检查 + 补上对应检查"这件事要**讲清楚**，
#        否则就变成"为了让它跑通而删掉检查"。
#   · 设备版会重启/清理 App；网页端只需确保页面在正确的路由上。
#
# ⚠️ 不要与设备门禁并发跑：两者都要占 9222（见 launch-web-chrome.sh 的说明）。
#
# 用法：bash scripts/m5/web/run-web-gate.sh scripts/m5/gate-xxx.mjs
set -uo pipefail

GATE="${1:?用法: run-web-gate.sh <gate.mjs>}"
WEB_BASE="${WEB_BASE:-https://8.148.156.146}"
LOCK_OWNER="web-gate:$(basename "$GATE")"

echo "=== 1/6 确保网页端 Chrome 在 9222 ==="
bash scripts/m5/web/launch-web-chrome.sh || { echo "WEB_TARGET_VALIDITY: FAIL（无法把 web Chrome 拉到 9222）"; exit 1; }

echo
echo "=== 2/6 目标校验（对照设备版的前台应用检查）==="
VER="$(curl -s -m 5 http://127.0.0.1:9222/json/version || true)"
if printf '%s' "$VER" | grep -q 'Android-Package'; then
  echo "  ✗ CDP 上是 **Android WebView**，不是桌面浏览器 ⇒ 这次测的不是网页端"
  echo "WEB_TARGET_VALIDITY: FAIL"
  exit 1
fi
BROWSER="$(printf '%s' "$VER" | grep -o '"Browser": *"[^"]*"' | head -1 | sed 's/.*: *"//; s/"$//')"
echo "  ✓ 桌面浏览器：${BROWSER:-未知}"

URL="$(curl -s -m 5 http://127.0.0.1:9222/json | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const a=JSON.parse(s);const p=a.find(t=>t.type==="page"&&t.webSocketDebuggerUrl);console.log(p?p.url:"")}catch(e){console.log("")}
})')"
echo "  页面 url：${URL:-未取到}"
case "$URL" in
  "$WEB_BASE"*) echo "  ✓ 页面是我们的网页端地址" ;;
  *) echo "  ✗ 页面不是网页端地址（期望以 $WEB_BASE 开头）⇒ 拒绝给结论"; echo "WEB_TARGET_VALIDITY: FAIL"; exit 1 ;;
esac
echo "WEB_TARGET_VALIDITY: PASS"

echo
echo "=== 3/6 拿门禁锁（与设备门禁共用同一把锁，避免互相干扰）==="
bash scripts/m5/gate-lock.sh acquire "$LOCK_OWNER" 2>&1 | sed 's/^/  /' || true
cleanup() { bash scripts/m5/gate-lock.sh release >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo
echo "=== 4/6 跑门禁：$(basename "$GATE") ==="
node "$GATE"
RC=$?

echo
echo "=== 5/6 目标复核（期间页面没被切走）==="
URL2="$(curl -s -m 5 http://127.0.0.1:9222/json | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const a=JSON.parse(s);const p=a.find(t=>t.type==="page"&&t.webSocketDebuggerUrl);console.log(p?p.url:"")}catch(e){console.log("")}
})')"
case "$URL2" in
  "$WEB_BASE"*) echo "  ✓ 仍是网页端（${URL2}）" ;;
  *) echo "  ✗ 期间被切走：$URL2 ⇒ 本次证据作废"; echo "WEB_TARGET_VALIDITY(after): FAIL"; exit 1 ;;
esac

echo
echo "=== 6/6 汇总 ==="
echo "WEB_GATE_EXIT=$RC"
exit "$RC"
