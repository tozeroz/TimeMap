/**
 * 只读测量：我方 App 底部 tab 栏的**真实渲染几何**（含图标与文字的相对位置）。
 *
 * 为什么要测：原版的证据（dump bounds + 截图视觉）显示底部 tab 项是
 * **图标在上、文字在下（竖排）**；而我方 `tabbar.css` 的 `.tabbar__item` 是
 * `display:flex`（默认 row）→ 看起来是**左右横排**。
 * 这可能是真实偏差，但**不能只看 CSS 猜** —— 必须测实际渲染的 rect 关系。
 *
 * 判定方法（几何，不靠名字）：
 *   对每个 .tabbar__item，取其自身 rect、其中 svg（图标）的 rect、以及文字节点的 rect，
 *   比较**垂直关系**：
 *     · 竖排：icon.bottom <= label.top（图标整体在文字上方）且水平中心接近
 *     · 横排：icon.right <= label.left（图标整体在文字左侧）且垂直中心接近
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\tabbar-measure.json'

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target')
  process.exit(2)
}
console.log('PAGE =', page.url)

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
  return r.result && r.result.result ? r.result.result.value : null
}

// 回到校园页（tab 栏在那里）
await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2000))

const res = await evaluate(`(() => {
  const bar = document.querySelector('.tabbar')
  if (!bar) return { found: false }
  const barRect = bar.getBoundingClientRect()
  const items = [...document.querySelectorAll('.tabbar__item')].map((el) => {
    const r = el.getBoundingClientRect()
    const svg = el.querySelector('svg')
    const label = el.querySelector('.tabbar__label') || el.querySelector('span:not(:first-child)')
    const sr = svg ? svg.getBoundingClientRect() : null
    const lr = label ? label.getBoundingClientRect() : null
    return {
      text: (el.textContent || '').trim(),
      item: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      icon: sr ? { x: Math.round(sr.left), y: Math.round(sr.top), w: Math.round(sr.width), h: Math.round(sr.height) } : null,
      label: lr ? { x: Math.round(lr.left), y: Math.round(lr.top), w: Math.round(lr.width), h: Math.round(lr.height) } : null,
    }
  })
  const fab = document.querySelector('.tabbar__fab')
  const fr = fab ? fab.getBoundingClientRect() : null
  return {
    found: true,
    dpr: window.devicePixelRatio,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    bar: { x: Math.round(barRect.left), y: Math.round(barRect.top), w: Math.round(barRect.width), h: Math.round(barRect.height) },
    items,
    fab: fr ? { x: Math.round(fr.left), y: Math.round(fr.top), w: Math.round(fr.width), h: Math.round(fr.height), radius: getComputedStyle(fab).borderRadius, bg: getComputedStyle(fab).backgroundColor } : null,
  }
})()`)

if (!res || !res.found) {
  console.error('FATAL 找不到 .tabbar（页面不对？）', JSON.stringify(res))
  process.exit(1)
}

writeFileSync(OUT, JSON.stringify(res, null, 2), 'utf8')
console.log('设备像素比 dpr =', res.dpr, ' viewport =', JSON.stringify(res.viewport))
console.log('底部栏 bar   =', JSON.stringify(res.bar), `→ 设备 px 高 ≈ ${Math.round(res.bar.h * res.dpr)}`)
console.log('')

/** 判断每个 item 是竖排还是横排 */
function classify(it) {
  if (!it.icon || !it.label) return 'n/a（缺图标或文字节点）'
  const iconCx = it.icon.x + it.icon.w / 2
  const labelCx = it.label.x + it.label.w / 2
  const iconCy = it.icon.y + it.icon.h / 2
  const labelCy = it.label.y + it.label.h / 2
  const verticalStack = it.icon.y + it.icon.h <= it.label.y + 1 && Math.abs(iconCx - labelCx) < 12
  const horizontalRow = it.icon.x + it.icon.w <= it.label.x + 1 && Math.abs(iconCy - labelCy) < 6
  if (verticalStack) return '竖排（图标在上、文字在下）'
  if (horizontalRow) return '横排（图标在左、文字在右）'
  return `都不像（iconCy=${Math.round(iconCy)} labelCy=${Math.round(labelCy)} iconCx=${Math.round(iconCx)} labelCx=${Math.round(labelCx)}）`
}

console.log('=== 逐项几何与排布判定（CSS px）===')
for (const it of res.items) {
  console.log(`  text='${it.text}'`)
  console.log(`    item  ${JSON.stringify(it.item)}`)
  console.log(`    icon  ${JSON.stringify(it.icon)}`)
  console.log(`    label ${JSON.stringify(it.label)}`)
  console.log(`    → **${classify(it)}**`)
}
console.log('')
console.log('=== FAB（发布按钮）===')
console.log('  ', JSON.stringify(res.fab))
console.log(`  → 设备 px 直径 ${res.fab ? Math.round(res.fab.w * res.dpr) : 'n/a'}`)
console.log('')
console.log('=== 对照原版（来自 board-observation-1.xml 的 bounds，同一台 1080×1920 设备）===')
console.log('  原版可见白条高 ≈ 1920/19.5 ≈ 98–101 设备 px（**视觉量级估算，弱证据**）')
console.log('  原版 tab 项**可点区域** 187×171 设备 px（含 padding，比可见条高 —— 两者不是同一个量，不可直接比）')
console.log('  原版 FAB **可点节点** = w=171 h=171 设备 px（不等于可见圆直径；可见直径 NOT_MEASURED_RELIABLY）')
console.log('  原版 tab 项排布 = **竖排（图标在上 y=[1746,1795]，文字在下 y=[1829,1868]）** ← dump bounds + 视觉双证')

// 显式关闭并退出：否则 WebSocket 会挂住事件循环，导致调用方（PowerShell/CI）超时
ws.close()
process.exit(0)
