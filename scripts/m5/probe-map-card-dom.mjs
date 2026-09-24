/**
 * 探针：地图标记的**卡片内容**在 DOM 里长什么样（为"补卡片内容断言"取证）
 *
 * 背景：我在 Round 266 closeout 时发现一个**自己引入的回归** ——
 *   三个地图实现原本 `posts.find(p => p.id === m.postId)` 去 **mock** 里查帖子，
 *   而 WO#15 之后 `m.postId` 是真实 UUID ⇒ find 永远 undefined ⇒ 卡片封面与文字都空。
 *   而**我的 WO#15 门禁没抓到它**，因为那批断言只覆盖 数量/地点名/无 mock/无回落。
 *
 * ⇒ 本探针先弄清"卡片内容"在页面上**可观测的形态**，才能写出有判别力的断言。
 *   要点：不同 provider 下标记渲染位置不同（在线是 SDK 图层、离线是自绘 DOM），
 *   所以要先看**都有什么可查**。
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
const ev = (expression) =>
  new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  }).then((m) => (m.result && m.result.result ? m.result.result.value : null))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('=== 1) 进在线地图页 ===')
await ev(`location.hash = '#/campus'`)
await sleep(1500)
await ev(`location.hash = '#/map'`)
await sleep(4500)

const probe = await ev(`(() => {
  const q = (s) => document.querySelectorAll(s).length
  const rm = [...document.querySelectorAll('.rm')]
  return {
    provider: (document.querySelector('[data-marker-phase]') || {}).textContent,
    badgePlaces: (() => { const b = document.querySelector('[data-marker-places]'); return b ? b.getAttribute('data-marker-places') : null })(),
    counts: {
      '.rm': q('.rm'),
      '.rm__card': q('.rm__card'),
      '.rm__img': q('.rm__img'),
      '.rm__img--text': q('.rm__img--text'),
      '.rm__name': q('.rm__name'),
      '.rm__pin': q('.rm__pin'),
      '.map__marker': q('.map__marker'),
      'img': q('img'),
    },
    cards: rm.slice(0, 8).map((el) => ({
      name: (el.querySelector('.rm__name') || {}).textContent || null,
      imgSrc: (() => { const i = el.querySelector('img.rm__img'); return i ? i.getAttribute('src') : null })(),
      textContent: (() => { const s = el.querySelector('.rm__img--text'); return s ? (s.textContent || '').trim() : null })(),
      html: el.innerHTML.slice(0, 140),
    })),
  }
})()`)
console.log(JSON.stringify(probe, null, 2))

ws.close()
await sleep(300)
process.exit(0)
