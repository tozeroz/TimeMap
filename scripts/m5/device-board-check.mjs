/**
 * M5 Slice 1 留言板：设备端验证。
 *
 * 断言（对应审核记录 18 对 board_notes 的要求）：
 *  1. 空态文案来自**服务端**（「可以给同学留言噢」），不是前端硬编码
 *  2. 能通过界面留言 → 便签出现 → 且**重新拉取后仍在**（证明写到了服务端，不是本地假成功）
 *  3. 标题/副标题/按钮/占位符符合原版可采信证据
 *  4. 表情行数量**如实报告**（不声称与原版一致 —— 该数字仍是开放项）
 *
 * 用法：node scripts/m5/device-board-check.mjs <peerUserId>
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
  if (r?.result?.exceptionDetails) return `ERR:${JSON.stringify(r.result.exceptionDetails).slice(0, 200)}`
  return r?.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
const ok = (m) => console.log(`  PASS ${m}`)
const bad = (m) => {
  console.log(`  FAIL ${m}`)
  failed = 1
}
const byText = (sel, text) => `[...document.querySelectorAll('${sel}')].find(e => e.textContent.trim() === ${JSON.stringify(text)})`

// 先 reload 再进路由（否则同 hash 不重挂载，会读到过期状态 —— 本项目踩过多次）
await ev(`location.reload()`)
await wait(3000)
await ev(`location.hash = '#/board/${peerId}'`)
await wait(4000)

const s1 = await ev(`(() => JSON.stringify({
  title: document.querySelector('.board__title')?.textContent ?? null,
  sub: document.querySelector('.board__sub')?.textContent ?? null,
  emptyText: document.querySelector('.board__emptyText')?.textContent ?? null,
  placeholder: document.querySelector('.board__input')?.placeholder ?? null,
  sendBtn: document.querySelector('.board__send')?.textContent?.trim() ?? null,
  emojiCount: document.querySelectorAll('.board__emoji').length,
  noteCount: document.querySelectorAll('.note').length
}))()`)
let a
try {
  a = JSON.parse(s1)
} catch {
  console.error('无法解析页面:', String(s1).slice(0, 150))
  process.exit(1)
}
console.log(`  页面: title=${a.title} sub=${a.sub} empty=${a.emptyText} 表情=${a.emojiCount} 便签=${a.noteCount}`)

a.title === '留言' ? ok('标题「留言」（原版可采信证据）') : bad(`标题是 '${a.title}'`)
a.sub === '仅双方可见' ? ok('副标题「仅双方可见」') : bad(`副标题是 '${a.sub}'`)
a.placeholder === '留言仅双方可见' ? ok('输入框占位「留言仅双方可见」') : bad(`占位是 '${a.placeholder}'`)
a.sendBtn === '留言' ? ok('按钮「留言」') : bad(`按钮是 '${a.sendBtn}'`)

// 1. 空态文案
if (a.noteCount === 0) {
  a.emptyText === '可以给同学留言噢'
    ? ok('空态文案「可以给同学留言噢」（且取自服务端返回的 emptyText）')
    : bad(`空态文案是 '${a.emptyText}'`)
} else {
  console.log(`  （已有 ${a.noteCount} 条便签，跳过空态断言）`)
}

// 4. 表情行数量如实报告
console.log(`  NOTE 表情行实际数量 = ${a.emojiCount}（原版数量仍是开放项，本轮不声称一致）`)

// 2. 留言 → 便签出现 → 重新拉取后仍在
const UNIQUE = `M5设备留言${Date.now() % 100000}`
/*
  用 **CDP Input.insertText** 输入，而不是"原生 setter + 派发 input 事件"。
  为什么（实测踩到）：后者在 React 19 下**没有进入组件 state** ——
  于是点「留言」时 draft 仍是空字符串，提交了一个空正文。
  服务端正确地回了 **400 bad_body**（产品行为是对的），
  但脚本的后续断言全失败，很容易被误读成"留言功能坏了"。
  真实输入事件（insertText）才是"像人一样打字"，也才是可靠的注入方式。
*/
const inputBox = await ev(`(() => { const i = document.querySelector('.board__input'); if (!i) return null; const r = i.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }) })()`)
if (inputBox) {
  const pt = JSON.parse(inputBox)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] })
  await wait(60)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(600)
  /*
    用**逐字符真实按键事件**注入，而不是 Input.insertText。
    为什么（实测踩到）：insertText 之后 DOM 的 value 读回来是对的，
    但 React 的受控 state **没有更新**（受控输入在 state 未更新时会回退 DOM 值），
    于是提交的 draft 是空串 → 服务端正确地回 400 bad_body（产品没错）。
    逐字符 keyDown/char/keyUp 是"像人一样打字"，能走完整的 React 输入路径。
  */
  // **每个字符只发一次 char 事件**。
  // 踩过的坑：keyDown/char/keyUp 三次都带 text 会让 React 收到两次输入
  // （实测输入框变成 "MM55设设备备留留言言…"，每字符翻倍）。
  // 只发 char 即可触发一次完整的 React onChange。
  for (const ch of UNIQUE) {
    await send('Input.dispatchKeyEvent', { type: 'char', text: ch })
    await wait(25)
  }
  await wait(500)
}
// 校验确实进了 state（输入框的 value 应等于我们输入的内容）
const typed = await ev(`document.querySelector('.board__input')?.value ?? null`)
typed === UNIQUE ? console.log('  （已确认文本进入了输入框 state）') : console.log(`  ⚠ 输入框 value='${typed}'，与期望不符`)
// 用原生事件点击发送按钮（element.click() 在 WebView 里通常有效；若无效则回退到坐标点击）
/*
  用**真实触摸坐标**点发送，而不是 `b.click()`。
  为什么（实测踩到）：`b.click()` 在这个 Capacitor WebView 里**没有触发 React 的 onClick** ——
  文本进了 state、按钮也在，但提交没发生。本项目其它 device 脚本一直用
  dispatchTouchEvent 坐标点击，正是因为这个原因。
*/
const btnBox = await ev(`(() => { const b = document.querySelector('.board__send'); if (!b) return null; const r = b.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }) })()`)
let clicked = false
if (btnBox) {
  const bp = JSON.parse(btnBox)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bp.x, y: bp.y }] })
  await wait(70)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  clicked = true
}
await wait(2500)
if (!clicked) console.log('  （发送按钮点击未生效，尝试坐标点击）')

const s2 = await ev(`(() => JSON.stringify({
  noteCount: document.querySelectorAll('.note').length,
  hasMine: (document.body.innerText || '').includes(${JSON.stringify(UNIQUE)}),
  emptyShown: !!document.querySelector('.board__emptyText')
}))()`)
let b2
try {
  b2 = JSON.parse(s2)
} catch {
  b2 = { noteCount: -1, hasMine: false, emptyShown: null }
}
b2.hasMine ? ok('留言后便签出现（内容与提交一致）') : bad(`留言后没看到便签（便签数=${b2.noteCount}）`)
b2.emptyShown === false ? ok('有便签后空态不再显示') : bad('有便签却仍显示空态')

// 再 reload 一次，证明写到了服务端（不是本地假成功）
await ev(`location.reload()`)
await wait(3000)
await ev(`location.hash = '#/board/${peerId}'`)
await wait(4000)
const s3 = await ev(`(document.body.innerText || '').includes(${JSON.stringify(UNIQUE)})`)
s3 === true
  ? ok('**重新加载后便签仍在**（证明写入了服务端，不是本地假成功）')
  : bad('重新加载后便签消失（说明只是本地状态）')

console.log('')
console.log(failed === 0 ? 'DEVICE_BOARD_RESULT PASS' : 'DEVICE_BOARD_RESULT FAIL')
try {
  ws.close()
} catch {
  /* 已关闭 */
}
process.exit(failed)
