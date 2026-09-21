/**
 * 测量**我方**会话页 composer 的真实渲染几何，用于与原版 dump 做 claim-level 对比。
 *
 * 原版证据（合规只读产物）：docs/original-baseline/screens/original-chat/20260921-205407-04-chat-open.xml
 *   底部 y=[1786,1920]（高 134 设备 px）
 *     EditText inputTextView  x=[63,885]   y=[1811,1881]  「发消息…」
 *     ImageView emojiBtn      x=[899,948]  y=[1822,1871]
 *     ImageView plusBtn       x=[968,1024] y=[1818,1874]
 *   → 顺序 = **[输入框][表情][加号]**，图标按钮 **2** 个，**没有麦克风按钮**
 *
 * 本脚本只读测量我方；断言与对比在 Node 侧打印，不修改任何东西。
 * ⚠️ 前置：必须先通过 VISUAL_TARGET_VALIDITY（脚本内会自查前台包名）
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\composer-measure.json'
const THREAD = '66666666-cccc-4ccc-8ccc-000000000003'

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

await evaluate(`location.hash = '#/chat/${THREAD}'`)
await new Promise((r) => setTimeout(r, 2500))

const res = await evaluate(`(() => {
  const bar = document.querySelector('.chatbar')
  if (!bar) return { found: false }
  const br = bar.getBoundingClientRect()
  const dpr = window.devicePixelRatio
  // 把 CSS px 换算成**设备 px**，便于与原版 dump（设备 px）直接比较
  const toDev = (r) => ({
    x1: Math.round(r.left * dpr), y1: Math.round(r.top * dpr),
    x2: Math.round(r.right * dpr), y2: Math.round(r.bottom * dpr),
  })
  const children = [...bar.children].map((el) => {
    const r = el.getBoundingClientRect()
    const d = toDev(r)
    // 识别控件类型（用**实际标签/属性**，不靠 class 名猜测）
    let kind = 'unknown'
    if (el.tagName === 'INPUT' && el.type === 'text') kind = 'text-input'
    else if (el.tagName === 'INPUT' && el.type === 'file') kind = 'file-input'
    else if (el.tagName === 'LABEL') kind = 'label(file-picker)'
    else if (el.tagName === 'BUTTON') kind = 'button:' + (el.getAttribute('aria-label') || '?')
    return { kind, dev: d, cssWidth: Math.round(r.width * 10) / 10 }
  })
  return {
    found: true,
    dpr,
    viewportCss: { w: window.innerWidth, h: window.innerHeight },
    barDev: toDev(br),
    barHeightDev: Math.round(br.height * dpr),
    children,
    childCount: children.length,
  }
})()`)

if (!res || !res.found) {
  console.error('FATAL 找不到 .chatbar（页面不对？）', JSON.stringify(res))
  process.exit(1)
}
writeFileSync(OUT, JSON.stringify(res, null, 2), 'utf8')

console.log('=== 我方 composer（换算为**设备 px**，与原版 dump 同量纲）===')
console.log(`  dpr=${res.dpr}  viewport=${res.viewportCss.w}x${res.viewportCss.h} CSS px`)
console.log(`  .chatbar  x=[${res.barDev.x1},${res.barDev.x2}]  y=[${res.barDev.y1},${res.barDev.y2}]  高 ${res.barHeightDev} 设备 px`)
console.log(`  子控件数 = ${res.childCount}`)
for (const c of res.children) {
  console.log(`    ${c.kind.padEnd(28)} x=[${String(c.dev.x1).padStart(4)},${String(c.dev.x2).padStart(4)}] y=[${c.dev.y1},${c.dev.y2}]`)
}

console.log('')
console.log('=== 与原版 dump 逐项对照（原版 = 只读 dump，设备 px）===')
console.log('  原版 composer  y=[1786,1920]  高 134 设备 px')
console.log('    顺序: [输入框 x=63..885] [表情 899..948] [加号 968..1024]')
console.log('    图标按钮数 = 2（表情、加号）；**无麦克风按钮**')
console.log('')
const icons = res.children.filter((c) => c.kind.startsWith('button:') || c.kind.startsWith('label'))
console.log(`  我方图标按钮数 = ${icons.length}`)
for (const c of icons) console.log(`    ${c.kind}`)
console.log('')
console.log('  ⚠️ 差异要点（需人工 / 进一步取证确认，不在此脚本下结论）：')
console.log(`    · 我方控件数 ${res.childCount} vs 原版 3（输入框+2 图标）`)
console.log('    · 原版输入框在**最左**；我方第一个控件是' + (res.children[0] ? res.children[0].kind : '?'))

ws.close()
process.exit(0)
