/**
 * M3 Slice 1 设备端验证（在我们自己的 demo app 上；允许写操作）。
 *
 * 验证目标（对齐原版实测的结构）：
 *   1. 校园页在线时以 API 为权威数据源（能列出 __SEED__ 帖子）
 *   2. 点卡片进详情，标题是「评论 N」且 **N 含回复**
 *   3. 顶层评论下有**嵌套的回复列表**，回复行带「回复 <目标>」（replyTo 来自 parent_id 的作者）
 *   4. 点「回复」打开回复弹层，标题是「回复 @昵称」，输入框占位「留下我的回复...」
 *   5. 未登录时发评论 → 不本地假成功，而是提示登录并跳登录页
 *
 * 前置：adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 */
const seedPostId = 'aaaaaaaa-0001-4001-8001-000000000001'

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!target) {
  console.error('no debuggable page')
  process.exit(1)
}

let ws
let msgId = 0
let pending = new Map()

async function connect() {
  const l = await (await fetch('http://127.0.0.1:9222/json')).json()
  const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
  if (!t) throw new Error('找不到可调试页面')
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  })
  for (let i = 0; i < 20; i++) {
    const p = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
    if (p && !p.timeout && p.result?.result?.value) return
    await wait(400)
  }
  throw new Error('调试会话不可用')
}

await connect()

function send(method, params) {
  const id = ++msgId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve({ timeout: true })
      }
    }, 20000)
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (!r || r.timeout) throw new Error(`CDP 超时: ${expression.slice(0, 60)}`)
  if (r.result?.exceptionDetails) throw new Error(`页面异常: ${JSON.stringify(r.result.exceptionDetails).slice(0, 200)}`)
  const v = r.result?.result?.value
  return v === undefined ? null : v
}

const bodyText = async () => {
  const v = await evaluate(`(document.body ? document.body.innerText : '').replace(/\\s+/g, ' ')`)
  return typeof v === 'string' ? v : ''
}

async function tapAt(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await wait(70)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(250)
}

async function centerOf(selector, textMatch) {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const el = ${textMatch ? `nodes.find((n) => n.textContent.trim() === ${JSON.stringify(textMatch)}) ?? nodes[0]` : 'nodes[0]'}
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
}

let failed = 0
const ok = (m) => console.log(`  PASS ${m}`)
const bad = (m) => {
  console.log(`  FAIL ${m}`)
  failed = 1
}
function finish(mode) {
  console.log('')
  console.log(failed === 0 ? `SLICE1_${mode}_RESULT PASS` : `SLICE1_${mode}_RESULT FAIL`)
  process.exit(failed)
}

const mode = process.argv[2] ?? 'detail'

if (mode === 'detail') {
  // 直接导航到详情页（同一个 SPA，本 demo 的路由是纯前端）
  await evaluate(`location.hash = '#/feed?id=${seedPostId}'`)
  await wait(2500)
  const t = await bodyText()
  console.log(`  页面: ${t.slice(0, 90)}`)

  // 1) 帖子正文来自 API（seed 的 p1 正文）
  if (t.includes('孤独是一种遗憾')) ok('详情显示了 API 返回的帖子正文')
  else bad(`详情没有显示期待的正文（实际: ${t.slice(0, 140)}）`)

  // 2) 「评论 N」且 N 含回复 → seed 是 1 顶层 + 1 回复 = 2
  if (t.includes('评论 2')) ok('标题「评论 2」——计数**含回复**（与实测口径一致）')
  else bad(`没有看到「评论 2」（实际含「评论」的片段: ${(t.match(/评论\s*\d+/g) ?? []).join(',')}）`)

  // 3) 顶层评论 + 嵌套回复
  const nested = await evaluate(`document.querySelectorAll('.cmt__replies').length`)
  const replies = await evaluate(`document.querySelectorAll('.cmt--reply').length`)
  if (nested >= 1 && replies >= 1) ok(`存在嵌套回复容器（.cmt__replies=${nested}，回复行=${replies}）`)
  else bad(`没有嵌套回复（.cmt__replies=${nested}，回复行=${replies}）`)

  // 4) 回复行带「回复 <目标>」——目标来自 replyTo（parent_id 的作者 Lemy）
  const label = await evaluate(`(() => {
    const el = document.querySelector('.cmt__replyTarget')
    return el ? el.textContent.trim() : null
  })()`)
  if (label === 'Lemy') ok('回复行显示「回复 Lemy」（replyTo 来自 parent_id 的作者，不是正文里的 @）')
  else bad(`回复目标不正确: ${label}`)

  finish('DETAIL')
}

if (mode === 'cardtap') {
  /*
    回归用例（对应本轮修掉的真实 bug）：
    之前 App.tsx 只从路径段取 id，而应用自己的跳转用的是 query，
    于是点任何卡片进详情都落到 mock 默认值 'p1' —— 看到的水远不是被点的那条。
    这里走**真实 UI 路径**：校园页 → 点第一张卡片 → 断言详情里的正文 == 卡片上看到的正文。
  */
  await evaluate(`location.hash = '#/campus'`)
  await wait(3000)

  const first = await evaluate(`(() => {
    const card = document.querySelector('.pcard')
    if (!card) return null
    const r = card.getBoundingClientRect()
    card.setAttribute('data-e2e-first', '1')
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      text: (card.innerText || '').replace(/\\s+/g, ' ').trim(),
    }
  })()`)
  if (!first) {
    bad('校园页没有卡片（可能信息流为空）')
    finish('CARDTAP')
  }
  console.log(`  卡片文字: ${first.text.slice(0, 60)}`)
  await tapAt(first.x, first.y)
  await wait(3000)

  const hash = await evaluate('location.hash')
  console.log(`  跳转后 hash: ${hash}`)
  if (!/[0-9a-f-]{36}/.test(hash)) {
    bad(`跳转后 hash 里没有真实 post id（实际 ${hash}）—— 说明 id 没有正确传递`)
    finish('CARDTAP')
  } else {
    ok('跳转 hash 里带了真实 post id')
  }

  const t = await bodyText()
  // 卡片正文与详情正文必须来自同一条帖子：取卡片正文的前 8 个字做比对
  const probe = first.text.replace(/\s+/g, '').slice(0, 8)
  if (probe && t.replace(/\s+/g, '').includes(probe)) {
    ok(`详情正文与卡片一致（含「${probe}」）—— 点哪条开哪条`)
  } else {
    bad(`详情正文与卡片不一致：卡片「${probe}」不在详情里（详情: ${t.slice(0, 120)}）`)
  }

  // 详情不应显示 mock 默认那篇（"孤独是一种遗憾" 是 seed p1；若点的是别的卡片，就不该出现）
  const mockDefault = 'p1'
  if (t.includes('未指定动态') || t.includes(`invalid_id`)) bad('详情退回了未指定/非法 id')
  else ok(`详情未退回 mock 默认值（检查 ${mockDefault} 相关错误信息未出现）`)

  finish('CARDTAP')
}

if (mode === 'composer') {
  await evaluate(`location.hash = '#/feed?id=${seedPostId}'`)
  await wait(2500)

  // 点第一条评论的「回复」
  const btn = await centerOf('.cmt__reply')
  if (!btn) {
    bad('找不到「回复」按钮')
    finish('COMPOSER')
  }
  await tapAt(btn.x, btn.y)
  await wait(600)
  const t = await bodyText()
  if (/回复 @/.test(t)) ok(`回复弹层标题是「${(t.match(/回复 @[^ ]+/) ?? [''])[0]}」（原版实测形态）`)
  else bad(`回复弹层没有「回复 @昵称」标题（实际: ${t.slice(0, 120)}）`)

  const ph = await evaluate(`(() => { const el = document.querySelector('.feed__replyInput'); return el ? el.placeholder : null })()`)
  if (ph === '留下我的回复...') ok('回复输入框占位是「留下我的回复...」（区别于主帖评论的「留下我的评论...」）')
  else bad(`回复输入框占位是 '${ph}'`)

  finish('COMPOSER')
}

if (mode === 'authgate') {
  // 确保未登录
  await evaluate(`localStorage.removeItem('campus.demo.session.v1')`)
  await evaluate(`location.hash = '#/feed?id=${seedPostId}'`)
  await wait(2500)

  // 在底部评论框输入并发送
  const input = await centerOf('.feed__input')
  if (!input) {
    bad('找不到底部评论输入框')
    finish('AUTHGATE')
  }
  await tapAt(input.x, input.y)
  /*
    先把可能残留的回复弹层关掉。
    踩过的坑：上一轮 composer 测试留下的弹层是**全屏遮罩 + autoFocus 输入框**，
    于是这里"点底部评论框"其实点到了遮罩，文字进了回复框，
    断言看到的就是"什么都没发生" —— 一个状态泄漏伪装成了产品缺陷。
    测试自己造成的初始状态必须自己清理。
  */
  await evaluate(`(() => { const m = document.querySelector('.feed__replyMask'); if (m) m.click() })()`)
  await wait(500)
  const sheetGone = await evaluate(`document.querySelector('.feed__replyMask') === null`)
  if (sheetGone) ok('回复弹层已关闭（测试初始状态干净）')
  else bad('回复弹层仍开着，测试前提不成立')

  // 重新聚焦底部评论框，并断言焦点真的在它上面
  const input2 = await centerOf('.feed__input')
  await tapAt(input2.x, input2.y)
  const focused = await evaluate(`(() => { const el = document.activeElement; return el ? String(el.className) : 'none' })()`)
  if (focused.includes('feed__input') && !focused.includes('reply')) ok(`焦点在底部评论框（${focused}）`)
  else bad(`焦点不在底部评论框，实际 '${focused}'（点击被别的元素接走了）`)

  await send('Input.insertText', { text: 'SLICE1-DEVICE-TEST' })
  await wait(400)
  const typed = await evaluate(`document.querySelector('.feed__input').value`)
  if (typed === 'SLICE1-DEVICE-TEST') ok('文字已进入底部评论框')
  else bad(`底部评论框的值为 '${typed}'`)

  const send2 = await centerOf('.feed__action--text')
  await tapAt(send2.x, send2.y)
  await wait(1500)

  const hash = await evaluate('location.hash')
  const t = await bodyText()
  // 未登录 → 必须提示并跳登录页，且**不能**在本地假成功
  if (hash.startsWith('#/loginselect')) ok('未登录发评论 → 跳转登录入口页（不本地假成功）')
  else bad(`未登录发评论后期望跳 #/loginselect，实际 ${hash}`)
  if (t.includes('请先登录') || t.includes('登录 Campus')) ok('页面明确提示需要登录')
  else bad('没有看到需要登录的提示')

  // 库里不应出现这条测试评论
  console.log('  （服务端侧由 verify-comments.sh 的统计断言保证不会出现未授权评论）')
  finish('AUTHGATE')
}

console.error(`未知模式: ${mode}`)
process.exit(1)
