/**
 * WO#6 设备侧 Gate：底部 tab 项的**排布方向**（竖排）+ 导航回归。
 *
 * ## 坐标单位（**显式冻结，不得混用** —— 审核记录 40 的强制要求）
 *
 *   本脚本**全程使用 CSS px**（即 `getBoundingClientRect()` 的返回值），
 *   device px = CSS px × dpr（本设备 dpr = 1.75）。
 *
 *   为什么必须冻结：原版激活项的水平中心差是
 *       |174.5 − 160.5| = 14 device px ÷ 1.75 ≈ **8 CSS px**
 *   若把阈值 12 当成 device px，则**连原版自己都会失败**（8 < 12 但量纲不同，
 *   比较本身无意义）。所以：
 *       · 断言量：CSS px
 *       · 阈值：12 CSS px（原版实测 8 CSS px，留 4 CSS px 余量吸收取整/字宽差异）
 *   所有打印都带单位后缀 `Css` / `dev`，防止再犯。
 *
 * ## 三条验收（审核记录 40 给定）
 *   TAB_ITEM_ORIENTATION   ：图标在文字上方、且水平中心对齐（竖排）
 *   TAB_LABELS_PRESERVED   ：三个 tab 文字仍是 <昵称> / 校园 / 地图
 *   TAB_NAVIGATION_REGRESSION：点每个 tab → 仍进入各自原有 route
 *   （外加 FAB / 栏高不变，因为本单不该动它们）
 *
 * ## 判别力
 *   本脚本在**改 CSS 之前**跑必须 FAIL（当前是横排）；
 *   改完后再跑必须 PASS。这正是"先证明断言能失败"。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo6-gate.json'
const report = { startedAt: new Date().toISOString(), steps: [], verdict: null }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

// ---------- 阈值（CSS px，见文件头"坐标单位"）----------
const TOL_ALIGN_CSS = 12 // 原版实测 8 CSS px
const TOL_STACK_CSS = 1 // 图标底边 <= 文字顶边 + 1 CSS px
const EXPECTED_LABELS = ['校园', '地图'] // 另加动态昵称项（不硬编码）

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
const send = (method, params) =>
  new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
async function evaluate(expression, timeoutMs = 30000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2000))

// ---------- ① 排布方向 ----------
const geo = await evaluate(`(() => {
  const bar = document.querySelector('.tabbar')
  if (!bar) return { found: false }
  const br = bar.getBoundingClientRect()
  const items = [...document.querySelectorAll('.tabbar__item')].map((el) => {
    const r = el.getBoundingClientRect()
    const svg = el.querySelector('svg')
    const label = el.querySelector('.tabbar__label')
    const sr = svg ? svg.getBoundingClientRect() : null
    const lr = label ? label.getBoundingClientRect() : null
    return {
      text: (label ? label.textContent : el.textContent || '').trim(),
      item: { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height },
      icon: sr ? { top: sr.top, bottom: sr.bottom, left: sr.left, width: sr.width, height: sr.height } : null,
      label: lr ? { top: lr.top, bottom: lr.bottom, left: lr.left, width: lr.width, height: lr.height } : null,
    }
  })
  const fab = document.querySelector('.tabbar__fab')
  const fr = fab ? fab.getBoundingClientRect() : null
  return {
    found: true,
    dpr: window.devicePixelRatio,
    barHeightCss: br.height,
    items,
    fab: fr ? { widthCss: fr.width, heightCss: fr.height, bg: getComputedStyle(fab).backgroundColor, radius: getComputedStyle(fab).borderRadius } : null,
  }
})()`)
if (!geo || !geo.found) {
  console.error('FATAL 找不到 .tabbar')
  process.exit(1)
}
log('DPR', geo.dpr)
log('BAR_HEIGHT_CSS', geo.barHeightCss)
console.log(`  （换算：栏高 ${geo.barHeightCss} CSS px = ${(geo.barHeightCss * geo.dpr).toFixed(1)} dev px）`)

let orientOk = true
const perItem = []
for (const it of geo.items) {
  if (!it.icon || !it.label) {
    orientOk = false
    perItem.push({ text: it.text, ok: false, why: '缺 icon 或 label 节点' })
    continue
  }
  const iconCx = it.icon.left + it.icon.width / 2
  const labelCx = it.label.left + it.label.width / 2
  const stackGapCss = it.label.top - it.icon.bottom // 竖排时应 >= 0（图标整体在上方）
  const alignDeltaCss = Math.abs(iconCx - labelCx)
  const ok = stackGapCss >= -TOL_STACK_CSS && alignDeltaCss <= TOL_ALIGN_CSS
  orientOk &&= ok
  perItem.push({
    text: it.text,
    ok,
    stackGapCss: Number(stackGapCss.toFixed(2)),
    alignDeltaCss: Number(alignDeltaCss.toFixed(2)),
    // 同时给出设备 px 值供人工核对（**不用于判定**）
    stackGapDev: Number((stackGapCss * geo.dpr).toFixed(1)),
    alignDeltaDev: Number((alignDeltaCss * geo.dpr).toFixed(1)),
  })
}
log('PER_ITEM_CSS', perItem)
console.log('  （判定量纲：CSS px；stackGap 应 >= 0、alignDelta 应 <= 12）')

// ---------- ② 文字保持 ----------
const labels = geo.items.map((i) => i.text)
const nonNickname = labels.filter((l) => l !== '校园' && l !== '地图')
const labelsOk =
  labels.includes('校园') && labels.includes('地图') && nonNickname.length === 1
log('LABELS', { labels, nonNickname, ok: labelsOk })

// ---------- ③ 导航回归 ----------
const nav = []
for (const [label, expect] of [
  ['校园', '#/campus'],
  ['地图', '#/map'],
]) {
  const r = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.tabbar__item')]
    const el = items.find((e) => ((e.querySelector('.tabbar__label')||{}).textContent||'').trim() === '${label}')
    if (!el) return { clicked: false }
    el.click()
    return { clicked: true }
  })()`)
  await new Promise((r2) => setTimeout(r2, 1200))
  const hash = await evaluate(`location.hash`)
  nav.push({ label, expect, clicked: r && r.clicked, hash, ok: typeof hash === 'string' && hash.startsWith(expect) })
  // 点完回到校园，保证下一个测量在同一基线
  await evaluate(`location.hash = '#/campus'`)
  await new Promise((r2) => setTimeout(r2, 800))
}
log('NAV', nav)

// ---------- ④ FAB / 栏高不变 ----------
const fabUnchanged =
  !!geo.fab &&
  Math.abs(geo.fab.widthCss - 44) < 0.6 &&
  Math.abs(geo.fab.heightCss - 44) < 0.6 &&
  geo.fab.bg === 'rgb(17, 17, 17)'
const barUnchanged = Math.abs(geo.barHeightCss - 58) < 0.6
log('FAB_UNCHANGED', { fab: geo.fab, ok: fabUnchanged })
log('BAR_HEIGHT_UNCHANGED', { heightCss: geo.barHeightCss, ok: barUnchanged })

const verdict = {
  TAB_ITEM_ORIENTATION: orientOk ? 'PASS' : 'FAIL',
  TAB_LABELS_PRESERVED: labelsOk ? 'PASS' : 'FAIL',
  TAB_NAVIGATION_REGRESSION: nav.every((n) => n.ok) ? 'PASS' : 'FAIL',
  FAB_GEOMETRY_UNCHANGED: fabUnchanged ? 'PASS' : 'FAIL',
  TABBAR_HEIGHT_UNCHANGED: barUnchanged ? 'PASS' : 'FAIL',
}
verdict.WO6_DEVICE_GATE = Object.values(verdict).every((v) => v === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', verdict)

ws.close()
process.exit(verdict.WO6_DEVICE_GATE === 'PASS' ? 0 : 1)
