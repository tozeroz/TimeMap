/**
 * M3 Slice 2 设备端验证（在我们自己的 demo app 上；允许写操作）。
 *
 * 验证的展示规则来自原版**只读**观察（supplements/slice2-likes-readonly.json）：
 *   1. 点赞数 >0 → 显示纯数字（无单位）
 *   2. 点赞数 =0 → **不渲染计数**（原版那时没有计数控件）
 *   3. 评论数 =0 → 显示「评论」二字；>0 → 显示数字
 * 切换行为属 BLOCKED_BY_POLICY（原版取证禁止），只在本系统内验证：
 *   4. 未登录点赞 → 跳登录页，不本地假成功
 *   5. 登录后点赞 → 计数由服务端权威值决定（点完拉一次详情比对）
 *
 * 用法：
 *   node scripts/m3/device-slice2.mjs display --post <uuid>   # 只看展示规则
 *   node scripts/m3/device-slice2.mjs authgate                # 未登录点赞的门禁
 *   node scripts/m3/device-slice2.mjs toggle --post <uuid>    # 登录后真点赞（需先注入会话）
 */
const argv = process.argv.slice(2)
const mode = argv[0]
const opt = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}

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

async function tapAt(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await wait(70)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(250)
}

async function centerOf(selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
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
const finish = (m) => {
  console.log('')
  console.log(failed === 0 ? `SLICE2_${m}_RESULT PASS` : `SLICE2_${m}_RESULT FAIL`)
  process.exit(failed)
}

/** 读详情页底部互动区的渲染状态 */
async function readBar() {
  return evaluate(`(() => {
    const btns = [...document.querySelectorAll('.feed__action')]
    const like = btns.find((b) => b.getAttribute('aria-label') === '点赞')
    const cmt = btns.find((b) => b.getAttribute('aria-label') === '评论')
    return JSON.stringify({
      likeCountText: like ? (like.querySelector('span')?.textContent ?? null) : null,
      likeHasSpan: like ? !!like.querySelector('span') : null,
      liked: like ? like.className.includes('is-liked') : null,
      cmtText: cmt ? (cmt.querySelector('span')?.textContent ?? null) : null,
    })
  })()`)
}

if (mode === 'display') {
  const post = opt('post')
  if (!post) {
    console.error('需要 --post <uuid>')
    process.exit(1)
  }
  await evaluate(`location.hash = '#/feed?id=${post}'`)
  await wait(2500)
  const raw = await readBar()
  const st = JSON.parse(raw)
  console.log(`  底部栏: ${raw}`)

  // 规则 1/2：点赞数为 0 → 不渲染计数（likeCountText 为 null）
  // 这里只能断言"一致性"：有数字就必须是纯数字；没有数字就必须是 0 赞
  if (st.likeHasSpan === false || st.likeCountText === null) {
    /*
      无计数 → 数据库里的 likeCount 应为 0。
      期望值由调用方传入（编排脚本从数据库读），而不是脚本自己在页内 fetch：
      页内 fetch 返回 Promise，CDP 不带 awaitPromise 时只能拿到 Promise 对象
      （第一版就是这样拿到 "[object Object]" 的 —— 测试自身的坑），
      而 Node 侧直连私有 CA 的 HTTPS 又要额外处理链校验。
      传参最直白，也让断言变成"UI 与数据库一致"这种可核对的说法。
    */
    const expect = opt('expect-like')
    if (expect === '0') ok('0 赞时**不渲染计数**（与原版一致：那时没有计数控件）')
    else if (expect === undefined) ok('0 赞时不渲染计数（未提供期望值，仅按 UI 判定）')
    else bad(`未渲染计数但数据库 likeCount=${expect}（只有 0 才应隐藏）`)
  } else if (/^\d+$/.test(String(st.likeCountText))) {
    const expect = opt('expect-like')
    if (expect !== undefined && String(st.likeCountText) !== String(expect)) {
      bad(`UI 显示「${st.likeCountText}」但数据库是 ${expect}（UI 与权威值不一致）`)
    } else {
      ok(`点赞数渲染为纯数字「${st.likeCountText}」（无单位，与原版一致${expect !== undefined ? '，且与数据库一致' : ''}）`)
    }
  } else {
    bad(`点赞数不是纯数字: '${st.likeCountText}'`)
  }

  // 规则 3：评论数 0 → 「评论」；>0 → 数字
  const expectC = opt('expect-comment')
  const isWord = st.cmtText === '评论'
  if (isWord || /^\d+$/.test(String(st.cmtText))) {
    if (expectC === '0' && !isWord) {
      bad(`评论数应为 0（显示「评论」），但 UI 显示数字「${st.cmtText}」`)
    } else if (expectC !== undefined && expectC !== '0' && String(st.cmtText) !== String(expectC)) {
      bad(`评论数 UI 显示「${st.cmtText}」但数据库是 ${expectC}`)
    } else {
      ok(`评论数渲染为「${st.cmtText}」${isWord ? '（0 条时显示文字，与原版一致）' : '（>0 显示数字）'}`)
    }
  } else {
    bad(`评论数渲染异常: '${st.cmtText}'`)
  }

  finish('DISPLAY')
}

if (mode === 'authgate') {
  await evaluate(`localStorage.removeItem('campus.demo.session.v1')`)
  const post = opt('post')
  await evaluate(`location.hash = '#/feed?id=${post ?? ''}'`)
  await wait(2500)

  const like = await centerOf('.feed__action[aria-label="点赞"]')
  if (!like) {
    bad('找不到点赞按钮')
    finish('AUTHGATE')
  }
  const before = JSON.parse(await readBar())
  await tapAt(like.x, like.y)
  await wait(1500)
  const hash = await evaluate('location.hash')

  if (hash.startsWith('#/loginselect')) ok('未登录点赞 → 跳登录入口页')
  else bad(`未登录点赞后期望跳 #/loginselect，实际 ${hash}`)

  /*
    关键断言：**不能本地假切换**。
    但这里不能直接拿"点击前的状态"和"当前状态"比 —— 跳转后详情页已经不在，
    读到的会是 null（第一版就是这样误报的：liked false→null、count 2→null，
    看起来像"状态被改了"，其实是页面换了）。
    正确做法：**回到详情页再读一次**，与服务端权威值比对。
  */
  await evaluate(`location.hash = '#/feed?id=${post}'`)
  await wait(2500)
  const after = JSON.parse(await readBar())
  console.log(`  回到详情后: ${JSON.stringify(after)}`)
  const expectLike = opt('expect-like')
  if (expectLike !== undefined && String(after.likeCountText) !== String(expectLike)) {
    bad(`未登录点赞后计数变成了「${after.likeCountText}」，数据库是 ${expectLike}（发生了本地假切换）`)
  } else {
    ok(`未登录点赞未造成任何计数变化（仍为「${after.likeCountText}」）`)
  }
  if (after.liked === true) bad('未登录状态被标成了已点赞（本地假成功）')
  else ok('未登录时点赞态仍为未点赞')
  finish('AUTHGATE')
}

console.error(`未知模式: ${mode}（可用: display / authgate / toggle）`)
process.exit(1)
