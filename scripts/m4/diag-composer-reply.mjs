/**
 * FAIL 2 直接观测（不再提假设，只取事实）。
 *
 * 取回：
 *   1. 设备当前登录态
 *   2. 目标 `.cmt__reply` 的坐标与视口尺寸
 *   3. **点击那一刻该坐标实际命中哪个元素**（elementFromPoint）—— 最可能直接给答案
 *   4. 点击后弹层元素是否存在、内容是什么
 *   5. 页面上是否存在覆盖全屏的遮罩（残留弹层）
 */
const POST = process.argv[2] ?? 'aaaaaaaa-0001-4001-8001-000000000001'

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((x) => x.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
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
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i)
        r({ timeout: true })
      }
    }, 15000)
  })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.result?.exceptionDetails) return `ERR:${JSON.stringify(r.result.exceptionDetails).slice(0, 200)}`
  return r?.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await ev(`location.reload()`)
await wait(3000)
await ev(`location.hash = '#/feed?id=${POST}'`)
await wait(3500)

console.log('登录态:', await ev(`localStorage.getItem('campus.demo.session.v1') ? '已登录' : '未登录'`))

const before = await ev(`(() => {
  const els = [...document.querySelectorAll('.cmt__reply')]
  const out = { replyButtons: els.length, viewport: [window.innerWidth, window.innerHeight] }
  if (!els.length) return JSON.stringify(out)
  const el = els[0]
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect()
  out.rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  out.center = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  const hit = document.elementFromPoint(out.center.x, out.center.y)
  out.hitTag = hit ? hit.tagName + '.' + (hit.className || '').toString().slice(0, 60) : 'null'
  out.hitIsReplyButton = !!(hit && (hit === el || el.contains(hit) || hit.contains(el)))
  out.sheetExists = !!document.querySelector('.feed__replySheet, .feed__replyInput')
  out.fullScreenOverlays = [...document.querySelectorAll('div')].filter(d => {
    const s = getComputedStyle(d)
    return s.position === 'fixed' && d.getBoundingClientRect().width >= window.innerWidth - 2 && d.getBoundingClientRect().height >= window.innerHeight - 2
  }).map(d => d.className || '(no class)').slice(0, 5)
  return JSON.stringify(out)
})()`)
console.log('点击前:', typeof before === 'string' ? before : JSON.stringify(before))

// 真实点击该点
let parsed
try {
  parsed = JSON.parse(before)
} catch {
  console.log('无法解析点击前信息')
  process.exit(1)
}
if (parsed.center) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: parsed.center.x, y: parsed.center.y }] })
  await wait(80)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(1200)
}

const after = await ev(`(() => {
  const sheet = document.querySelector('.feed__replySheet, .feed__replyInput')
  return JSON.stringify({
    sheetExists: !!sheet,
    sheetText: sheet ? (sheet.innerText || '').replace(/\\s+/g,' ').slice(0, 80) : null,
    placeholder: sheet && sheet.placeholder !== undefined ? sheet.placeholder : null,
    bodyHead: (document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 100)
  })
})()`)
console.log('点击后:', typeof after === 'string' ? after : JSON.stringify(after))

try {
  ws.close()
} catch {
  /* 已关闭 */
}
process.exit(0)
