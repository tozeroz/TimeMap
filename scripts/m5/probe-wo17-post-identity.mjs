/**
 * WO#17 探针：验证**身份篡改**是否真的修好（先取证据再定断言）
 *
 * 核心判据（审核 62 给的定义）：**"请求 post A，页面不得显示 post B"**
 *   ⇒ 用一个**不存在的 id** 打开 `#/comments`，页面上**不得出现任何真实动态的内容**。
 *   改前会回落 `posts[0]`，于是会显示 mock 第一条动态的正文与作者 —— 探针须能看出来。
 *
 * ⚠️ 为什么用"不存在的 id"而不是别的：
 *   它是能触发静默兜底的**最小输入**，且结果可机械判定
 *   （"页面上是否出现了某条已知动态的正文"）。
 *
 * 同时对照 `#/feed`（FeedDetailScreen）在同一输入下的行为 —— 两者应一致。
 */
const OUT = 'G:\\demo map\\tools\\tmp\\wo17-probe.json'

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

const MISSING = 'deadbeef-0000-4000-8000-000000000000'
const report = { missingId: MISSING }

/** 读页面关键信息：是否出现"已知动态的正文"（= 回落了别的实体） */
const READ = `(() => {
  const q = (s) => document.querySelector(s)
  const txt = (q('.screen') || document.body).innerText
  return {
    hash: location.hash,
    state: q('[data-cd-state]') ? q('[data-cd-state]').getAttribute('data-cd-state') : null,
    countText: q('[data-cd-count]') ? q('[data-cd-count]').innerText.replace(/\\s+/g,' ').trim() : null,
    author: q('[data-cd-author]') ? q('[data-cd-author]').getAttribute('data-cd-author') : null,
    cmtBodies: [...document.querySelectorAll('[data-cmt-body]')].map(e=>e.getAttribute('data-cmt-body')),
    text: txt.replace(/\\s+/g,' ').trim().slice(0, 500),
  }
})()`

console.log('=== ① 参照：先取真实动态（用于判断"是否显示了某条真实动态"）===')
const real = await ev(`(async () => {
  const r = await fetch('https://8.148.156.146/api/posts')
  const j = await r.json()
  return (j.items||[]).slice(0,4).map(p => ({ id: p.id, author: p.author, body: p.body }))
})()`)
report.realPosts = real
console.log('  真实动态数 = ' + (real ? real.length : 0))
if (real) for (const p of real) console.log('    · ' + p.id.slice(0, 8) + ' / ' + p.author + ' / ' + String(p.body).slice(0, 24))

console.log('')
console.log('=== ② #/comments?id=<不存在> —— 不得出现任何真实动态的内容 ⭐ ===')
await ev(`location.hash = '#/feed'`)
await sleep(1200)
await ev(`location.hash = '#/comments?id=${MISSING}'`)
await sleep(3000)
report.commentsMissing = await ev(READ)
console.log('  ' + JSON.stringify(report.commentsMissing))

console.log('')
console.log('=== ③ #/feed?id=<不存在> —— 两屏行为应一致 ===')
await ev(`location.hash = '#/campus'`)
await sleep(1200)
await ev(`location.hash = '#/feed?id=${MISSING}'`)
await sleep(3000)
report.feedMissing = await ev(READ)
console.log('  ' + JSON.stringify(report.feedMissing))

console.log('')
console.log('=== ④ 有效 id：#/comments?id=<真实> —— 应显示**同一条**动态 ===')
const realId = real && real[0] ? real[0].id : ''
if (realId) {
  await ev(`location.hash = '#/campus'`)
  await sleep(1200)
  await ev(`location.hash = '#/comments?id=${realId}'`)
  await sleep(3200)
  report.commentsReal = await ev(READ)
  console.log('  ' + JSON.stringify(report.commentsReal))
  await ev(`location.hash = '#/campus'`)
  await sleep(1200)
  await ev(`location.hash = '#/feed?id=${realId}'`)
  await sleep(3200)
  report.feedReal = await ev(READ)
  console.log('  ' + JSON.stringify(report.feedReal))
}

// 机械判定：不存在的 id 下，页面里是否出现了某条**真实动态**的正文
function leaksRealPost(view, posts) {
  if (!view || !posts) return []
  const t = String(view.text || '')
  return posts.filter((p) => p.body && t.includes(String(p.body).slice(0, 12))).map((p) => p.id)
}
report.leakInComments = leaksRealPost(report.commentsMissing, real)
report.leakInFeed = leaksRealPost(report.feedMissing, real)
console.log('')
console.log('  ⭐ #/comments 下泄漏的真实动态 = ' + JSON.stringify(report.leakInComments))
console.log('  ⭐ #/feed     下泄漏的真实动态 = ' + JSON.stringify(report.leakInFeed))

fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)

ws.close()
await sleep(300)
process.exit(0)
