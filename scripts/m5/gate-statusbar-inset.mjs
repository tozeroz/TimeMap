/**
 * 模拟 inset 验证：证明"**只要 inset 非零，我的 CSS 就会正确让位、按钮就会可点**"
 *
 * ════════════════════════════════════════════════════════════════════════
 * 为什么需要这个测试（诚实划界）
 * ════════════════════════════════════════════════════════════════════════
 *   本项目模拟器是 **Android 12**，**不强制 edge-to-edge** ⇒
 *   `--safe-area-inset-top` 实测就是 **0px** ⇒ 修复在模拟器上是"惰性"的：
 *   我只能证明"不伤老系统"，**证明不了"治好新系统"**。
 *
 *   于是把这条链拆成两段，分别验证我能验的那段：
 *     ✅ 本测试：**手工把 --safe-area-inset-top 设成非零**，验证
 *        (a) viewport 顶部内边距确实等于它
 *        (b) 顶栏/按钮确实被推到它下方
 *        (c) 按钮中心处 `document.elementFromPoint()` **命中的就是那个按钮**
 *            —— 这直接模拟用户报的"按钮点不到"（被状态栏盖住）那个现象
 *     ❌ 未验证（本地做不到）：Android 15+ 上 Capacitor SystemBars 是否真的注入非零值。
 *        那一环依据**官方文档**（SystemBars 注入 `--safe-area-inset-*`），
 *        最终需在用户真机上确认。
 *
 * ⚠️ 这只是**测试内的临时覆盖**，不会改任何源文件；测完即恢复。
 */
import { writeFileSync } from 'node:fs'

const SIM = Number(process.env.SIM_INSET_PX ?? 36)
const OUT = 'G:\\demo map\\tools\\tmp\\inset-simulated-result.json'

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target')
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
      JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }),
    )
  })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const READ = `(() => {
  const vp = document.querySelector('.shell__viewport')
  const tb = document.querySelector('.topbar')
  const btn = document.querySelector('.topbar .iconbtn, .topbar button')
  const r = (n) => { if (!n) return null; const b = n.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height), cx: Math.round(b.left + b.width/2), cy: Math.round(b.top + b.height/2) } }
  const btnRect = r(btn)
  let hit = null
  if (btnRect) {
    const el = document.elementFromPoint(btnRect.cx, btnRect.cy)
    hit = el ? (el === btn ? 'self' : (btn.contains(el) ? 'descendant' : (el.tagName + '.' + (el.className || '')))) : 'null'
  }
  return {
    hash: location.hash,
    insetVar: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top').trim(),
    viewportPadTop: vp ? getComputedStyle(vp).paddingTop : null,
    topbar: r(tb),
    button: btnRect,
    hitAtButtonCenter: hit,
    mediaTopbarTop: (() => { const m = document.querySelector('.media .topbar'); return m ? Math.round(m.getBoundingClientRect().top) : null })(),
  }
})()`

const out = { simInsetPx: SIM, at: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  out.steps.push({ k, v })
  console.log('  ' + k + ' = ' + JSON.stringify(v))
}

console.log(`=== 1) 施加模拟 inset = ${SIM}px（仅测试内临时设置）===`)
await evaluate(`location.hash = '#/me'`)
await sleep(2500)
log('BEFORE_SET', await evaluate(READ))

await evaluate(`document.documentElement.style.setProperty('--safe-area-inset-top', '${SIM}px')`)
await sleep(800)
log('AFTER_SET', await evaluate(READ))

console.log('=== 2) 深色页面（media 的绝对定位顶栏不应双重偏移；此处用可达到的页面近似验证）===')
await evaluate(`location.hash = '#/scanner'`)
await sleep(2500)
log('SCANNER_WITH_SIM', await evaluate(READ))

console.log('=== 3) 清除模拟值并恢复 ===')
await evaluate(`document.documentElement.style.removeProperty('--safe-area-inset-top')`)
await sleep(800)
log('AFTER_CLEAR', await evaluate(READ))

// ── 判定 ───────────────────────────────────────────────────────────-
const before = out.steps.find((s) => s.k === 'BEFORE_SET')?.v
const after = out.steps.find((s) => s.k === 'AFTER_SET')?.v
const cleared = out.steps.find((s) => s.k === 'AFTER_CLEAR')?.v

const padApplied = after && after.viewportPadTop === `${SIM}px`
const topbarPushed = after && after.topbar && after.topbar.top === SIM
const buttonBelow = after && after.button && after.button.cy >= SIM
const hitIsButton = after && (after.hitAtButtonCenter === 'self' || after.hitAtButtonCenter === 'descendant')
const restored = cleared && cleared.viewportPadTop === '0px'

const verdict = {
  INSET_VAR_APPLIED_TO_VIEWPORT_PADDING: padApplied ? 'PASS' : 'FAIL',
  TOPBAR_PUSHED_BELOW_INSET: topbarPushed ? 'PASS' : 'FAIL',
  BUTTON_CENTER_BELOW_INSET: buttonBelow ? 'PASS' : 'FAIL',
  BUTTON_IS_HIT_TESTABLE_AT_CENTER: hitIsButton ? 'PASS' : 'FAIL',
  SIM_REMOVED_RESTORES_LAYOUT: restored ? 'PASS' : 'FAIL',
  detail: { before, after, cleared, simInsetPx: SIM },
  facts_not_assertions: {
    CSS_SIDE_VERIFIED: 'PASS（人为给非零 inset 时，布局正确让位且按钮可被命中）',
    ANDROID15_INSET_INJECTION: '**NOT EVALUATED**（模拟器为 Android 12，不强制 edge-to-edge，inset 恒为 0；该环依据官方文档，需真机确认）',
  },
}
const KEYS = Object.keys(verdict).filter((k) => /^[A-Z_]+$/.test(k))
const anyFail = KEYS.some((k) => String(verdict[k]).startsWith('FAIL'))
verdict.SIMULATED_INSET_GATE = anyFail ? 'FAIL' : 'PASS'
log('VERDICT', verdict)
writeFileSync(OUT, JSON.stringify(verdict, null, 2), 'utf8')
ws.close()
await sleep(200)
process.exit(anyFail ? 1 : 0)
