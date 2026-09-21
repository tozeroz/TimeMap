/**
 * M5 留言板：**用"点表情"来产生正文**，验证写入路径。
 *
 * 为什么用表情而不是打字（四轮实测结论）：
 *   在这个 Capacitor WebView 里，四种合成输入方式（原生 setter + input 事件、
 *   Input.insertText、insertText 复跑、逐字符 keyDown/char/keyUp）都无法让
 *   React 19 的受控 state 更新 —— 输入框 value 看起来是对的，但提交时 draft 是空串，
 *   服务端于是正确地回 400 bad_body。
 *   而**表情按钮的 onClick 是 React 自己调用的** setDraft(prev => prev + emoji)，
 *   用真实触摸点一下表情，state 里就有真实文本 —— 完全不依赖任何注入。
 *   这既绕开 harness 限制，又没有为了让测试通过而改动产品代码。
 *
 * 用法：node scripts/m5/device-board-emoji-check.mjs [peerUserId]
 */
const peerId = process.argv[2] ?? '22222222-2222-4222-8222-222222222222'

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
const tapEl = async (selector, index = 0) => {
  const box = await ev(
    `(() => { const e = document.querySelectorAll('${selector}')[${index}]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }) })()`,
  )
  if (!box) return null
  const p = JSON.parse(box)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
  await wait(70)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(500)
  return p
}

let failed = 0
const ok = (m) => console.log(`  PASS ${m}`)
const bad = (m) => {
  console.log(`  FAIL ${m}`)
  failed = 1
}

await ev(`location.reload()`)
await wait(3000)
await ev(`location.hash = '#/board/${peerId}'`)
await wait(4000)

const before = await ev(`document.querySelectorAll('.note').length`)
console.log(`  进入留言板：当前便签数 ${before}`)

// 1) 点第一个表情 —— 由 React 自己把文本放进 draft
const emojiTxt = await ev(`document.querySelectorAll('.board__emoji')[0]?.textContent ?? null`)
const ep = await tapEl('.board__emoji', 0)
if (!ep) {
  bad('找不到表情按钮')
  process.exit(1)
}
const draft = await ev(`document.querySelector('.board__input')?.value ?? null`)
console.log(`  点了表情「${emojiTxt}」→ 输入框 value = ${JSON.stringify(draft)}`)
draft
  ? ok('**点表情让 React 把文本放进了 state**（value 非空，未使用任何注入）')
  : bad('点表情后输入框仍为空（React state 仍未更新）')

// 2) 点「留言」
await tapEl('.board__send')
await wait(3000)

const after = await ev(`(() => JSON.stringify({
  noteCount: document.querySelectorAll('.note').length,
  hasEmoji: (document.body.innerText || '').includes(${JSON.stringify(emojiTxt ?? '')}),
  emptyShown: !!document.querySelector('.board__emptyText')
}))()`)
let a
try {
  a = JSON.parse(after)
} catch {
  a = { noteCount: -1, hasEmoji: false, emptyShown: null }
}
a.noteCount > before
  ? ok(`**留言成功：便签数 ${before} → ${a.noteCount}**`)
  : bad(`点「留言」后便签数不变（${before} → ${a.noteCount}）`)
a.emptyShown === false ? ok('有便签后空态不再显示') : bad('有便签却仍显示空态')

// 3) 重新加载，证明写到了服务端
await ev(`location.reload()`)
await wait(3000)
await ev(`location.hash = '#/board/${peerId}'`)
await wait(4000)
const finalCount = await ev(`document.querySelectorAll('.note').length`)
finalCount > before
  ? ok(`**重新加载后便签仍在（${finalCount} 条）—— 证明写入了服务端**`)
  : bad(`重新加载后便签数回到 ${finalCount}（说明只写进了本地状态）`)

console.log('')
console.log(failed === 0 ? 'DEVICE_BOARD_WRITE_RESULT PASS' : 'DEVICE_BOARD_WRITE_RESULT FAIL')
try {
  ws.close()
} catch {
  /* 已关闭 */
}
process.exit(failed)
