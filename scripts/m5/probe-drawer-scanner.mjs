/**
 * 探针：核实**我们自己的** app 抽屉里到底有没有「扫一扫」入口
 *
 * ⚠️ 为什么要专门做这个探针（我犯的错的复盘）：
 *   Round 318 我在 A4 观察里写"原版抽屉里有「扫一扫」，**我们抽屉里没有** ⇒ 缺失入口"。
 *   但**我当时看的是原版 app 的 dump，从未核对我们自己的 Drawer.tsx**。
 *   核对后发现 `Drawer.tsx:13` **本来就有** `{ label: '扫一扫', to: 'scanner' }`。
 *   ⇒ 那是一条**未经核实就写下的结论**（正是本项目反复强调要避免的：
 *     "我最初的判断"与"权威的意见"都不是证据，**实测才是**）。
 *
 * 本探针用**设备实证**给出可区分的证据：
 *   ① 打开我们的抽屉，读出**实际渲染出来的**条目文本
 *   ② 与**原版实测**的抽屉条目清单逐一比对
 *   ③ 点「扫一扫」，看它**落到哪个路由**、页面显示什么
 */
const OUT = 'G:\\demo map\\tools\\tmp\\drawer-scanner-probe.json'

/** 原版**实测**的抽屉条目（Round 318 只读观察 dump；含 bounds 的原文见 A3A4 文档） */
const ORIGINAL_ITEMS = ['账号与安全', '编辑资料', '校园认证', '隐私设置', '黑名单', '版本信息', '联系我们', '扫一扫']

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
const ev = (expression) =>
  new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    )
  }).then((m) => (m.result && m.result.result ? m.result.result.value : null))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fs = await import('node:fs')

const report = { originalItems: ORIGINAL_ITEMS }

console.log('=== ① 打开我们的抽屉，读实际渲染的条目 ===')
await ev(`location.hash = '#/me'`)
await sleep(2200)
await ev(`(() => { const b = document.querySelector('button[aria-label="菜单"]'); if (b) { b.click(); return true } return false })()`)
await sleep(1500)
report.drawer = await ev(`(() => {
  const items = [...document.querySelectorAll('.drawer__item')].map((n) => (n.innerText || '').trim())
  return { items, hasScanner: items.includes('扫一扫'), hasContact: items.includes('联系我们') }
})()`)
console.log('  ' + JSON.stringify(report.drawer))

console.log('')
console.log('=== ② 与原版实测清单比对 ===')
const ours = (report.drawer && report.drawer.items) || []
const missing = ORIGINAL_ITEMS.filter((n) => !ours.includes(n))
const extra = ours.filter((n) => !ORIGINAL_ITEMS.includes(n))
report.compare = { missing, extra }
console.log('  ⭐ 我们缺少的原版条目 = ' + JSON.stringify(missing))
console.log('  （额外条目 = ' + JSON.stringify(extra) + '）')

console.log('')
console.log('=== ③ 点「扫一扫」→ 看落到哪个路由、页面显示什么 ===')
await ev(`(() => {
  const hit = [...document.querySelectorAll('.drawer__item')].find((n) => (n.innerText || '').trim() === '扫一扫')
  if (hit) { hit.click(); return true }
  return false
})()`)
await sleep(3000)
report.afterClick = await ev(`(() => {
  const q = (s) => document.querySelector(s)
  return {
    hash: location.hash,
    text: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 400),
  }
})()`)
console.log('  ' + JSON.stringify(report.afterClick))

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)

ws.close()
await sleep(300)
process.exit(0)
