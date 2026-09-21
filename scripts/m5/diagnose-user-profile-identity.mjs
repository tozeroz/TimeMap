/**
 * 诊断：点真实动态的作者 → UserProfileScreen 显示的是谁？
 *
 * ## 要验证的假设
 *   toFeedPost 产出的 author.id 形如 `u:<uuid>`（带前缀），
 *   而 UserProfileScreen 用 `users[id] ?? users.u1` 查 **mock 字典**（key 是 u1..u12）。
 *   两者永不可能匹配 → 必然回落到 mock 的 u1（"蒸柿煮捞呆"）。
 *   → 即：点真实作者会显示一个**完全无关的编造人物**。
 *
 * ## 判别性设计
 *   不只看"显示了名字"，而是看**显示的名字是否等于被点作者的名字**：
 *     被点作者（从卡片的 data-feed-id / 卡片文案取） vs 资料页上显示的名字
 *   相等 → 假设不成立；不等且恒为同一个 mock 名 → 假设成立。
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

console.log('=== 1) 回校园页（有真实动态）===')
await ev(`location.hash = '#/campus'`)
await sleep(2500)
const cards = await ev(`(() => {
  const cs = [...document.querySelectorAll('[data-feed-id]')]
  /* ⚠️ 选择器要**两个分支都覆盖**（我第一版只猜了有图分支的类名，全部落空）：
       有图卡片：.pcard__author / .pcard__author-name
       无图卡片：.pcard__authorBtn / .pcard__name */
  const pick = (c, sels) => {
    for (const s of sels) {
      const e = c.querySelector(s)
      if (e) return (e.textContent || '').trim()
    }
    return null
  }
  return cs.slice(0, 4).map((c) => ({
    feedId: c.getAttribute('data-feed-id'),
    authorName: pick(c, ['.pcard__author-name', '.pcard__name']),
    hasImage: !!c.querySelector('.pcard__mediaWrap'),
  }))
})()`)
console.log('  卡片（feedId + 作者名 + 有无图）:', JSON.stringify(cards))

console.log('')
console.log('=== 2) 点第一张卡片的**作者行**（真实作者的入口）===')
const before = await ev(`(() => {
  const c = document.querySelector('[data-feed-id]')
  if (!c) return { ok: false }
  const name = (c.querySelector('.pcard__author-name') || c.querySelector('.pcard__name') || {}).textContent || null
  const a = c.querySelector('.pcard__author') || c.querySelector('.pcard__authorBtn')
  if (!a) return { ok: false, why: 'no author button' }
  a.click()
  return { ok: true, clickedAuthorName: (name || '').trim(), feedId: c.getAttribute('data-feed-id') }
})()`)
console.log('  点击:', JSON.stringify(before))
await sleep(2500)

console.log('')
console.log('=== 3) 资料页显示了什么 ===')
const prof = await ev(`(() => {
  const name = (document.querySelector('.up__name') || {}).textContent || null
  const bt = document.body.innerText || ''
  return {
    hash: location.hash,
    shownName: name,
    tags: [...document.querySelectorAll('.tag')].map((t) => (t.textContent || '').trim()),
    textSample: bt.replace(/\\s+/g, ' ').slice(0, 160),
  }
})()`)
console.log('  资料页:', JSON.stringify(prof))

console.log('')
console.log('=== 4) 裁决 ===')
const clicked = before && before.clickedAuthorName
const shown = prof && prof.shownName
console.log(`  被点作者 = ${JSON.stringify(clicked)}`)
console.log(`  资料页显示 = ${JSON.stringify(shown)}`)
if (clicked && shown && clicked === shown) {
  console.log('  → ✓ 一致：假设**不成立**（点真实作者显示的就是本人）')
} else if (shown === '蒸柿煮捞呆') {
  console.log('  → ✗ **假设成立**：显示的是 mock 的 u1「蒸柿煮捞呆」，与真实作者无关')
} else {
  console.log(`  → 不一致但也不是 u1（显示 ${JSON.stringify(shown)}）→ 需进一步看 mock 字典的其它候选`)
}

console.log('')
console.log('=== 5) 顺带：该页「发消息」的去向（验证硬编码 t1）===')
const msgBtn = await ev(`(() => {
  const b = [...document.querySelectorAll('.up__msg')][0]
  return b ? { text: (b.textContent || '').trim() } : null
})()`)
console.log('  「发消息」按钮:', JSON.stringify(msgBtn))
const afterMsg = await ev(`(async () => {
  const b = [...document.querySelectorAll('.up__msg')][0]
  if (!b) return { ok: false }
  b.click()
  await new Promise(r => setTimeout(r, 1800))
  return { ok: true, hash: location.hash, bodyHasInvalid: /无效|invalid/.test(document.body.innerText || '') }
})()`)
console.log('  点击后:', JSON.stringify(afterMsg))
ws.close()
process.exit(0)
