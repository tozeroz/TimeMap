/**
 * FEED_CLOSE_NAVIGATION 的**判别性实测**
 *
 * ## 要区分的两个假设
 *   H1（"返回上一页"）：从 #/more 进入 #/feedlist，点关闭 → 回到 **#/more**
 *   H2（"固定跳 Campus"）：点关闭 → 无论从哪来都去 **#/campus**
 * 这两个假设在"上一页恰好是 campus"时**结果相同**，所以那种测试没有判别力。
 * 必须用**上一页 ≠ campus** 的路径，才能把它们分开。
 *
 * ## 为什么要有这个测试
 *   审核记录 52 认为当前 goBack('campus') 是"固定跳 Campus"，据此把该 claim 判为 DEVIATION；
 *   我读源码发现 goBack(fallback) 的实现是：
 *       if (window.history.length > 1) window.history.back()   ← 真后退
 *       else navigate(fallback)                                 ← 只在空历史时回落
 *   → 三种说法（我最初"一致"/审核"偏差"/我改判"偏差"）必须由**实测**裁决，而不是互相说服。
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('=== 路径准备（**刻意让"上一页" ≠ campus**）===')
console.log('=== 真实点击：Me → 三横线 → 更多功能 → #/more ===')
await ev(`location.hash = '#/me'`)
await sleep(2000)
await ev(`(() => {
  const b = [...document.querySelectorAll('button,[role="button"]')]
    .find((e) => /菜单|更多|menu/i.test((e.getAttribute('aria-label') || '') + String(e.className)))
  if (b) b.click(); return !!b
})()`)
await sleep(1200)
await ev(`(() => {
  const it = [...document.querySelectorAll('.drawer__item, button')].find((e) => /更多功能/.test((e.textContent || '').trim()))
  if (it) it.click(); return !!it
})()`)
await sleep(2000)
const atMore = await ev(`(() => ({ hash: location.hash }))()`)
console.log('  到达：' + JSON.stringify(atMore))

console.log('')
console.log('=== 点「校园圈」→ 期望进入 #/feedlist ===')
await ev(`(() => {
  const nodes = [...document.querySelectorAll('*')]
    .filter((e) => (e.textContent || '').trim().indexOf('校园圈') >= 0 && (e.textContent || '').trim().length < 40)
  const t = nodes[nodes.length - 1]
  if (!t) return false
  const c = t.closest('button,a,[role="button"],li') || t
  c.click()
  return true
})()`)
await sleep(2500)
const atFeed = await ev(`(() => ({ hash: location.hash }))()`)
console.log('  到达：' + JSON.stringify(atFeed))

console.log('')
console.log('=== 记录关闭前的一页（关键：它应当是 #/more，不是 #/campus）===')
const beforeClose = await ev(`(() => ({ hash: location.hash, historyLen: window.history.length }))()`)
console.log('  ' + JSON.stringify(beforeClose))

console.log('')
console.log('=== 点左上「关闭」按钮 → 观察落到哪 ===')
const closeInfo = await ev(`(() => {
  /* 按 aria-label 找关闭控件（须与实现一致；实现里 FeedList 用的是"返回"还是"关闭"也要看到） */
  const btns = [...document.querySelectorAll('button')].map((b) => ({
    aria: b.getAttribute('aria-label'), cls: String(b.className).slice(0, 24),
  }))
  const b = [...document.querySelectorAll('button')].find((x) => /关闭|返回/.test(x.getAttribute('aria-label') || ''))
  if (!b) return { clicked: false, buttons: btns.slice(0, 8) }
  const used = { aria: b.getAttribute('aria-label'), cls: String(b.className).slice(0, 24) }
  b.click()
  return { clicked: true, used, buttons: btns.slice(0, 8) }
})()`)
console.log('  ' + JSON.stringify(closeInfo))
await sleep(2500)
const afterClose = await ev(`(() => ({ hash: location.hash }))()`)
console.log('  关闭后：' + JSON.stringify(afterClose))

console.log('')
console.log('=== 裁决 ===')
const back = typeof afterClose.hash === 'string' ? afterClose.hash : ''
const h1 = back.indexOf('/more') >= 0           // 真后退（回到来源页）
const h2 = back.indexOf('/campus') >= 0 && atMore.hash !== '#/campus' // 固定跳 campus
console.log(`  关闭前=${beforeClose.hash}  关闭后=${back}`)
if (h1) {
  console.log('  → **H1 成立**：实现了"返回上一页"（回到来源页 #/more）')
  console.log('  → 因此 FEED_CLOSE_NAVIGATION 应为 **MATCH**，而不是 DEVIATION')
} else if (h2) {
  console.log('  → **H2 成立**：固定跳 #/campus（与来源页无关）')
  console.log('  → 因此该项确为 DEVIATION')
} else {
  console.log('  → 两者都不成立（落到别处或没反应）→ 需进一步诊断')
}
ws.close()
process.exit(0)
