/**
 * 量我们自己 App 的留言板表情行几何（验证 board.css 的改动是否真的生效）。
 *
 * 为什么要这一步：我改了 board.css（gap 8→24px、item 34→40px），但是**在没有设备验证的情况下提交的**
 * （当时有别的设备端验证在跑，按 docs/DISCIPLINE-device-concurrency.md 不能重装 APK）。
 * 现在设备空闲，补上这一环 —— **构建通过 ≠ 渲染正确**。
 *
 * 期望（由原版 dump 换算，dpr 1.75）：
 *   item 宽 70/1.75 = 40 CSS px
 *   pitch 112/1.75 = 64 CSS px → gap 42/1.75 = 24 CSS px
 */
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((x) => x.type === 'page')
if (!target) {
  console.error('找不到可调试页面')
  process.exit(1)
}
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
  if (r?.result?.exceptionDetails) return `ERR:${JSON.stringify(r.result.exceptionDetails).slice(0, 150)}`
  return r?.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await ev(`location.reload()`)
await wait(3000)
await ev(`location.hash = '#/board/22222222-2222-4222-8222-222222222222'`)
await wait(4000)

const out = await ev(`(() => {
  const items = [...document.querySelectorAll('.board__emoji')]
  if (!items.length) return JSON.stringify({ error: 'no .board__emoji rendered', body: (document.body.innerText||'').slice(0,120) })
  const rects = items.map((e) => e.getBoundingClientRect())
  const first = rects[0]
  const pitch = rects.length > 1 ? Math.round((rects[1].left - rects[0].left) * 100) / 100 : null
  const cs = getComputedStyle(items[0])
  const csRow = getComputedStyle(document.querySelector('.board__emojis'))
  return JSON.stringify({
    count: items.length,
    itemWidth: Math.round(first.width * 100) / 100,
    itemHeight: Math.round(first.height * 100) / 100,
    pitch,
    gapCSS: csRow.gap,
    widthCSS: cs.width,
    dpr: window.devicePixelRatio,
    viewportWidth: window.innerWidth
  })
})()`)

console.log('测量结果:', out)
let v
try {
  v = JSON.parse(out)
} catch {
  process.exit(1)
}
const checks = []
if (typeof v.itemWidth === 'number') {
  checks.push(['item 宽 ≈ 40 CSS px', Math.abs(v.itemWidth - 40) < 1.5, `${v.itemWidth}`])
  checks.push(['gap ≈ 24 CSS px', Math.abs(v.pitch - 64) < 2, `pitch=${v.pitch}`])
  checks.push(['dpr = 1.75（换算基准）', Math.abs(v.dpr - 1.75) < 0.01, `${v.dpr}`])
}
let failed = 0
for (const [name, pass, actual] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}（实际 ${actual}）`)
  if (!pass) failed = 1
}
console.log('')
console.log(failed === 0 ? 'DEVICE_BOARD_GEOMETRY_RESULT PASS' : 'DEVICE_BOARD_GEOMETRY_RESULT FAIL')
try {
  ws.close()
} catch {
  /* 已关闭 */
}
process.exit(failed)
