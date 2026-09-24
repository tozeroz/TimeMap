/**
 * 顶栏内边距（状态栏留白）探针 —— 用于对比"改前/改后"
 *
 * ⚠️ 为什么必须做这个对比：
 *   修复是"在原生壳里为状态栏留出顶部内边距"。但存在一个**回归风险**：
 *   Android <15（例如本项目模拟器 MuMu 的 Android 12）**不强制 edge-to-edge**，
 *   此时 WebView 本来就排在状态栏下方 —— 若再补一条 inset，就会**双重留白**。
 *   ⇒ 所以要在 Android 12 上量一次：改后顶部位置**不应变化**（inset 必须是 0）。
 *   这是"老系统不被新修复伤到"的判别性证据。
 *
 * 用法：node tools/tmp/probe-top-inset.mjs <标签>
 */
import { writeFileSync } from 'node:fs'

const label = process.env.TOP_PROBE_LABEL ?? process.argv[2] ?? 'run'
const OUT = `G:\\demo map\\tools\\tmp\\top-inset-${label}.json`

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target（用 run-device-gate.sh 的风格起，先 adb forward 9222）')
  process.exit(2)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
async function evaluate(expression, timeoutMs = 20000) {
  const p = new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    )
  })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const r = (sel) => {
    const n = document.querySelector(sel)
    if (!n) return null
    const b = n.getBoundingClientRect()
    return { top: Math.round(b.top), h: Math.round(b.height) }
  }
  const vp = document.querySelector('.shell__viewport')
  const cs = getComputedStyle(document.documentElement)
  // env() 实测值：插一个只受 env() 影响的元素来量
  const d = document.createElement('div')
  d.style.cssText = 'position:absolute;visibility:hidden;height:env(safe-area-inset-top,0px);width:1px'
  document.body.appendChild(d)
  const envTop = getComputedStyle(d).height
  d.remove()
  return {
    hash: location.hash,
    nativeClass: document.querySelector('.shell') ? document.querySelector('.shell').className : null,
    innerH: window.innerHeight,
    viewportPadTop: vp ? getComputedStyle(vp).paddingTop : null,
    viewportTop: r('.shell__viewport'),
    topbar: r('.topbar'),
    bigtitle: r('.bigtitle'),
    screen: r('.screen'),
    varSafeAreaTop: cs.getPropertyValue('--safe-area-inset-top').trim(),
    varHSafeTop: cs.getPropertyValue('--h-safe-top').trim(),
    varHStatusbar: cs.getPropertyValue('--h-statusbar').trim(),
    envTopProbe: envTop,
  }
})()`

// 依次量几个代表性页面（含"顶部有可点按钮"的页面）
const targets = ['#/campus', '#/me', '#/scanner']
const out = { label, at: new Date().toISOString(), pages: {} }
for (const h of targets) {
  await evaluate(`location.hash = ${JSON.stringify(h)}`)
  await sleep(2500)
  out.pages[h] = await evaluate(PROBE)
  console.log(`  ${h}: ` + JSON.stringify(out.pages[h]))
}
writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
console.log(`  已写 ${OUT}`)
ws.close()
await sleep(200)
process.exit(0)
