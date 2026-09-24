/**
 * 诊断：FeedListScreen（#/feedlist）究竟从哪进入？
 *
 * 我已错两次（先搜校园页的"动态"按钮、再猜"更多 → 校园圈"）——
 * 这次不再猜，直接把**当前页可点的东西**和**各页导航结构**打出来。
 */
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
async function ev(expression, timeoutMs = 20000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

const snap = async (label) => {
  const s = await ev(`(() => {
    const btns = [...document.querySelectorAll('button,a,[role="button"]')].map((e) => ({
      aria: e.getAttribute('aria-label') || null,
      text: (e.textContent || '').trim().slice(0, 24) || null,
    })).filter((x) => x.aria || x.text)
    return { hash: location.hash, buttons: btns.slice(0, 30), buttonCount: btns.length }
  })()`)
  console.log(`--- ${label} ---`)
  console.log(`  hash = ${s && s.hash}   （可点元素 ${s && s.buttonCount} 个）`)
  for (const b of (s && s.buttons) || []) {
    console.log(`    aria=${JSON.stringify(b.aria)}  text=${JSON.stringify(b.text)}`)
  }
}

await ev(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2500))
await snap('校园页 #/campus')

/* 直接看路由表：判断 feedlist 是否只由 MoreScreen 提供 */
console.log('')
console.log('--- 试探：各可能页面的 hash ---')
for (const h of ['#/more', '#/me', '#/profile', '#/mine']) {
  await ev(`location.hash = '${h}'`)
  await new Promise((r) => setTimeout(r, 1600))
  const cur = await ev(`location.hash`)
  const hasFeedEntry = await ev(`(() => /校园圈/.test(document.body.innerText || ''))()`)
  console.log(`  ${h} → 实际 hash=${cur}  含"校园圈"字样=${hasFeedEntry}`)
}

console.log('')
await ev(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 1500))
const tabbar = await ev(`(() => {
  const t = [...document.querySelectorAll('[class*="tab"],nav,[role="tablist"] *')].map((e) => ({
    cls: e.className && String(e.className).slice(0, 40),
    text: (e.textContent || '').trim().slice(0, 20),
    aria: e.getAttribute('aria-label'),
  })).filter((x) => x.text || x.aria)
  return t.slice(0, 20)
})()`)
console.log('--- 底部 tab 栏结构 ---')
for (const t of tabbar || []) {
  console.log(`    cls=${JSON.stringify(t.cls)}  text=${JSON.stringify(t.text)}  aria=${JSON.stringify(t.aria)}`)
}

ws.close()
process.exit(0)
