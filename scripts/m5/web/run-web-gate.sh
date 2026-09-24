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

echo "=== 1/7 确保网页端 Chrome 在 9222 ==="
bash scripts/m5/web/launch-web-chrome.sh || { echo "WEB_TARGET_VALIDITY: FAIL（无法把 web Chrome 拉到 9222）"; exit 1; }

echo
echo "=== 2/7 目标校验（对照设备版的前台应用检查）==="
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
echo "=== 3/7 拿门禁锁（与设备门禁共用同一把锁，避免互相干扰）==="
bash scripts/m5/gate-lock.sh acquire "$LOCK_OWNER" 2>&1 | sed 's/^/  /' || true
cleanup() { bash scripts/m5/gate-lock.sh release >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo
echo "=== 4/7 把页面带到前台（防 rAF 节流）==="
# ⚠️ 为什么必须做：网页端扫码门禁曾突然 FAIL、detail 里 `frames: 0`，
#    而摄像头与 <video> 都正常（getUserMedia 640x480、videoWidth=1920）。
#    真正原因是 `document.visibilityState="hidden"` ⇒ **requestAnimationFrame 被节流到 0**
#    ⇒ 逐帧解码循环跑不起来。
#    ⚠️ 那是**环境抖动**（窗口被模拟器等遮挡），不是产品缺陷；但它会让审计结果不可复现。
#    ⇒ 双保险：① launch-web-chrome.sh 用 Chrome 官方开关关掉遮挡/后台节流；
#              ② 这里在跑门禁之前，用 CDP `Page.bringToFront` 主动把页签带到前台。
node -e '
const port = process.env.CDP_PORT || 9222
;(async () => {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    if (!page) { console.log("  (无 page target，跳过 bringToFront)"); return }
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener("open", res, {once:true}); ws.addEventListener("error", rej, {once:true}) })
    let id = 0
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; ws.addEventListener("message", function h(e){ const m = JSON.parse(e.data); if (m.id === i) { ws.removeEventListener("message", h); r(m) } }); ws.send(JSON.stringify({id:i, method, params})) })
    await send("Page.enable")
    await send("Page.bringToFront")
    const vis = await send("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })
    const v = vis && vis.result && vis.result.result ? vis.result.result.value : null
    console.log("  bringToFront 后 visibilityState =", v)
    ws.close()
  } catch (e) { console.log("  (bringToFront 失败，继续):", String(e && e.message || e)) }
})()
' 2>&1 | sed 's/^/  /'

echo
echo "=== 5/7 跑门禁：$(basename "$GATE") ==="
node "$GATE"
RC=$?

echo
echo "=== 6/7 目标复核（期间页面没被切走）==="
URL2="$(curl -s -m 5 http://127.0.0.1:9222/json | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const a=JSON.parse(s);const p=a.find(t=>t.type==="page"&&t.webSocketDebuggerUrl);console.log(p?p.url:"")}catch(e){console.log("")}
})')"
case "$URL2" in
  "$WEB_BASE"*) echo "  ✓ 仍是网页端（${URL2}）" ;;
  *) echo "  ✗ 期间被切走：$URL2 ⇒ 本次证据作废"; echo "WEB_TARGET_VALIDITY(after): FAIL"; exit 1 ;;
esac

echo
echo "=== 7/7 汇总 ==="
echo "WEB_GATE_EXIT=$RC"
exit "$RC"
