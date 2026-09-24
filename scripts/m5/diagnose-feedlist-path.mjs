/**
 * 诊断（续）：追出到 #/feedlist 的**完整真实点击路径**
 * 已知：`#/more` 存在且含「校园圈」；底部 tabbar = [头像(Lemy) / 校园(active) / 地图] + 发布 FAB。
 * 本探针把每一跳的 hash 打出来，直到到达 #/feedlist。
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

// 回到校园页
await ev(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2200))

console.log('=== 跳 1：点底部 tab 栏的头像项（第一个非 active 项）===')
const step1 = await ev(`(() => {
  const items = [...document.querySelectorAll('.tabbar__item')]
  const info = items.map((e, i) => ({ i, text: (e.textContent || '').trim().slice(0, 16), active: e.className.indexOf('is-active') >= 0 }))
  const target = items.find((e) => e.className.indexOf('is-active') < 0)
  if (!target) return { ok: false, items: info }
  target.click()
  return { ok: true, items: info, clickedIndex: items.indexOf(target) }
})()`)
console.log('  点击结果 =', JSON.stringify(step1))
await new Promise((r) => setTimeout(r, 2200))
const hash1 = await ev(`location.hash`)
console.log('  → hash =', hash1)

console.log('')
console.log('=== 跳 2：在当前页找「更多」入口并点击 ===')
const step2 = await ev(`(() => {
  const cands = [...document.querySelectorAll('button,a,[role="button"],li,div')]
    .filter((e) => /^更多$/.test((e.textContent || '').trim()) || /更多/.test(e.getAttribute('aria-label') || ''))
    .map((e) => ({ tag: e.tagName, text: (e.textContent || '').trim().slice(0, 20), cls: String(e.className).slice(0, 30), aria: e.getAttribute('aria-label') }))
  const target = [...document.querySelectorAll('button,a,[role="button"],li,div')]
    .find((e) => /^更多$/.test((e.textContent || '').trim()) || /更多/.test(e.getAttribute('aria-label') || ''))
  if (!target) return { ok: false, candidates: cands.slice(0, 10) }
  target.click()
  return { ok: true, clicked: { text: (target.textContent || '').trim().slice(0, 20), cls: String(target.className).slice(0, 30) } }
})()`)
console.log('  点击结果 =', JSON.stringify(step2))
await new Promise((r) => setTimeout(r, 2200))
const hash2 = await ev(`location.hash`)
console.log('  → hash =', hash2)

console.log('')
console.log('=== 跳 3：找「校园圈」并点击 → 期望到达 #/feedlist ===')
const step3 = await ev(`(() => {
  const nodes = [...document.querySelectorAll('*')]
    .filter((e) => (e.textContent || '').trim().indexOf('校园圈') >= 0 && (e.textContent || '').trim().length < 40)
  const target = nodes[nodes.length - 1]
  if (!target) return { ok: false }
  const clickable = target.closest('button,a,[role="button"],li,div') || target
  const before = location.hash
  clickable.click()
  return { ok: true, tag: clickable.tagName, cls: String(clickable.className).slice(0, 40), text: (clickable.textContent || '').trim().slice(0, 30) }
})()`)
console.log('  点击结果 =', JSON.stringify(step3))
await new Promise((r) => setTimeout(r, 2500))
const hash3 = await ev(`location.hash`)
console.log('  → hash =', hash3)

console.log('')
console.log('=== 结果 ===')
console.log(`  完整路径 hash 轨迹: #/campus → ${hash1} → ${hash2} → ${hash3}`)
const isFeed = typeof hash3 === 'string' && hash3.indexOf('feedlist') >= 0
console.log(isFeed ? '  ✅ 到达 #/feedlist' : '  ❌ 未到达 #/feedlist（需继续追）')
if (isFeed) {
  const dom = await ev(`(() => {
    const bt = document.body.innerText || ''
    return {
      hasFeedIds: document.querySelectorAll('[data-feed-id]').length,
      hasNetworkErrorCopy: /网络不给力|点击刷新/.test(bt),
      hasRefreshButton: [...document.querySelectorAll('button')].some((b) => /刷新/.test(b.textContent || '')),
      fakeNumbers: ['12,486', '38,920'].filter((n) => bt.includes(n)),
      residue: [/M1-E2E-/, /TLS 日志泄漏检查/].map((p) => p.source).filter((s) => new RegExp(s).test(bt)),
      imgCount: document.querySelectorAll('img').length,
      textSample: bt.replace(/\\s+/g, ' ').slice(0, 200),
    }
  })()`)
  console.log('  DOM =', JSON.stringify(dom))
}
ws.close()
process.exit(0)
