/**
 * WO#18 探针：地点搜索页接权威数据源后的真实 DOM（先取证据再定断言）
 *
 * 要看清的三件事：
 *   ① 列表行是否来自**服务端**（name/address 与 API 一致）
 *   ② `distance`（'320m' 这类）**是否有定位才出现** —— 无定位时应**完全不渲染**
 *   ③ 搜索是否走**服务端**（输入关键词后行集合随 API 过滤变化）
 */
const OUT = 'G:\\demo map\\tools\\tmp\\wo18-probe.json'
const API = 'https://8.148.156.146'

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

const READ = `(() => {
  const q = (s) => document.querySelector(s)
  const rows = [...document.querySelectorAll('[data-poi-row]')].map((el) => ({
    title: (el.querySelector('.row__title') || {}).innerText,
    sub: (el.querySelector('.row__sub') || {}).innerText,
    distance: (el.querySelector('.poi__distance') || {}).innerText || null,
  }))
  return {
    hash: location.hash,
    state: q('[data-poi-state]') ? q('[data-poi-state]').getAttribute('data-poi-state') : null,
    rowCount: rows.length,
    rows,
    emptyText: q('[data-poi-empty]') ? q('[data-poi-empty]').innerText : null,
    errorText: q('[data-poi-error]') ? q('[data-poi-error]').innerText : null,
    hasNoPlaceRow: /不添加地点/.test((q('.list') || document.body).innerText),
    screenText: (q('.screen') || document.body).innerText.replace(/\\s+/g, ' ').trim().slice(0, 400),
  }
})()`

const report = {}

console.log('=== 0) 期望值来自服务端 ===')
report.expected = await ev(`(async () => {
  const r = await fetch('${API}/api/places')
  const j = await r.json()
  return (j.items || []).map(p => ({ id: p.id, name: p.name, address: p.address, postCount: p.postCount }))
})()`)
console.log('  ' + JSON.stringify(report.expected))

console.log('')
console.log('=== ① 进 #/poi（无关键词）===')
await ev(`location.hash = '#/campus'`)
await sleep(1200)
await ev(`location.hash = '#/poi'`)
await sleep(3500)
report.all = await ev(READ)
console.log('  ' + JSON.stringify(report.all))

console.log('')
console.log('=== ② 输入关键词「交通」⇒ 应走服务端过滤 ===')
await ev(`(() => {
  const el = document.querySelector('.poi__input')
  if (!el) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, '交通')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(3000)
report.filtered = await ev(READ)
console.log('  ' + JSON.stringify(report.filtered))

console.log('')
console.log('=== ③ 输入不存在的关键词 ⇒ 应显示空态 ===')
await ev(`(() => {
  const el = document.querySelector('.poi__input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, 'zzzznotfound')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(3000)
report.empty = await ev(READ)
console.log('  ' + JSON.stringify(report.empty))

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)

ws.close()
await sleep(300)
process.exit(0)
