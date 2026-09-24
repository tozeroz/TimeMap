/**
 * 探针：学校搜索页 `#/schools` 与校区面板的真实 DOM（为 WO#16 层 B 的门禁取证）
 *
 * 为什么先探针再写断言（本项目已多次吃亏）：
 *   我的断言口径错过好几次 —— 整页 imgCount 判头像（WO#14）、整页文本判 mock 地点（WO#15）、
 *   面板关闭态查"只在打开时出现"的数据（WO#16 层 A，两条断言因此没有判别力）。
 *   ⇒ **先看真实的 DOM 结构，再决定断言写在哪个节点上。**
 */
const OUT = 'G:\\demo map\\tools\\tmp\\wo16b-probe.json'
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

const report = {}

console.log('=== ① 直接进 #/schools ===')
await ev(`location.hash = '#/campus'`)
await sleep(1500)
await ev(`location.hash = '#/schools'`)
await sleep(3200)
report.search = await ev(`(() => {
  const q = (s) => document.querySelector(s)
  const input = q('.ss__input')
  const rows = [...document.querySelectorAll('[data-school-row]')].map((el) => ({
    text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
    hasCount: !!el.querySelector('[data-school-row-count]'),
  }))
  return {
    hash: location.hash,
    placeholder: input ? input.getAttribute('placeholder') : null,
    groupLabel: (q('[data-school-search-group]') || {}).innerText,
    rowCount: rows.length,
    rows,
    countUnavailableNote: (q('[data-school-count-unavailable]') || {}).innerText,
    screenText: (q('.screen') || document.body).innerText.slice(0, 400),
  }
})()`)
console.log('  ' + JSON.stringify(report.search))

console.log('')
console.log('=== ② 回 campus，点开校区面板 ===')
await ev(`location.hash = '#/campus'`)
await sleep(2500)
await ev(`(() => { const el = document.querySelector('.bigtitle__sub'); if (el) el.click(); return true })()`)
await sleep(1800)
report.panel = await ev(`(() => {
  const q = (s) => document.querySelector(s)
  const panel = q('[data-school-picker]')
  const rows = [...document.querySelectorAll('[data-campus-row]')].map((el) => (el.innerText || '').trim())
  const entry = q('[data-school-search-entry]')
  return {
    panelState: panel ? panel.getAttribute('data-school-picker') : null,
    title: (q('[data-school-picker-title]') || {}).innerText,
    campusRows: rows,
    rowCount: rows.length,
    hasSearchEntry: !!entry,
    searchEntryText: entry ? (entry.innerText || '').trim() : null,
  }
})()`)
console.log('  ' + JSON.stringify(report.panel))

console.log('')
console.log('=== ③ 点「搜索其他学校」入口 → 应到 #/schools ===')
await ev(`(() => { const el = document.querySelector('[data-school-search-entry]'); if (el) el.click(); return true })()`)
await sleep(2500)
report.entryNav = await ev(`({ hash: location.hash })`)
console.log('  ' + JSON.stringify(report.entryNav))

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)

ws.close()
await sleep(400)
process.exit(0)
