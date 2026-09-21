/**
 * M5：会话页「自己发的消息靠右」真机验证（断言**实际渲染几何**，不是类名）。
 *
 * 背景 / 判定：
 *   docs/m5/CHAT-SENDER-PRESENTATION-CONFIRMED.md
 *   原版会话页里**自己发的那条**气泡落在右半（x=[625,975]，屏宽 1080）、头像贴最右（x=[989,1052]）；
 *   我们此前把**所有**消息硬编码为 `--peer`（靠左）→ 真实偏差。
 *
 * 为什么不能只断言"类名加上了"：
 *   `className` 对了但 CSS 没生效（选择器写错、被覆盖、flex 容器没撑满）是这类改动
 *   **最常见**的失败形态 —— 那时 DOM 看起来正确、界面依旧全左。
 *   所以这里一律以 `getBoundingClientRect()` 的**实际像素**为准，
 *   并额外记录行内 `flex-direction` / 气泡底色作为旁证（旁证不参与判定）。
 *
 * 为什么发送者身份从**服务端**取：
 *   如果按我们自己刚加的类名来判断"哪条是我的"，那就是自证循环 ——
 *   类名算错了也照样"通过"。所以先用会话 token 调 GET /api/threads/:id/messages，
 *   拿到每条消息的 `senderId`，与 `/api/auth/me` 的本人 id 比较，得到
 *   **与渲染无关**的 ground truth，再把 `data-message-id` 与它对应起来。
 *
 * 用法：
 *   node scripts/m5/device-chat-sender-align.mjs [--thread=<会话uuid>] [--shot=<本地png路径>] [--post]
 *   --post：先让当前登录用户在会话里**真发一条**（走我们自己的后端），再验证它靠右；
 *           新消息的 id 会打印出来，供清理时按 id 精确删除。
 *
 * 前置：
 *   adb -s 127.0.0.1:16384 forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   设备已登录（scripts/m3/device-login-helper.ps1）
 */
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const argOf = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? ''
const API = 'https://8.148.156.146'

const threadArg = argOf('thread')
const shot = argOf('shot')
const doPost = argv.includes('--post')

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((x) => x.type === 'page')
if (!target) {
  console.error('找不到可调试页面（forward 掉了？App 冷启动过？）')
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
    }, 20000)
  })
/** ⚠ 必须带 awaitPromise:true：下面大量用 async IIFE（否则拿到的是一个 Promise 对象而非值） */
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r?.timeout) return { __err: 'CDP 超时' }
  if (r?.result?.exceptionDetails) {
    return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 300) }
  }
  return r?.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
const ok = (m) => console.log(`  PASS ${m}`)
const bad = (m) => {
  console.log(`  FAIL ${m}`)
  failed = 1
}
const info = (m) => console.log(`  ·  ${m}`)

/** 页面里读一次当前状态：视口 + 每行的实际几何 */
const PROBE = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight
  const rows = [...document.querySelectorAll('.chat__row')].map((r) => {
    const b = r.querySelector('.bubble')
    const rr = r.getBoundingClientRect()
    const br = b ? b.getBoundingClientRect() : null
    const cs = getComputedStyle(r)
    const bcs = b ? getComputedStyle(b) : null
    return {
      messageId: r.getAttribute('data-message-id'),
      rowClass: r.className,
      bubbleClass: b ? b.className : null,
      text: (b ? b.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 24),
      row: { left: +rr.left.toFixed(1), right: +rr.right.toFixed(1), width: +rr.width.toFixed(1) },
      bubble: br ? { left: +br.left.toFixed(1), right: +br.right.toFixed(1), width: +br.width.toFixed(1) } : null,
      rowFlexDirection: cs.flexDirection,
      rowJustifyContent: cs.justifyContent,
      bubbleBg: bcs ? bcs.backgroundColor : null,
      bubbleColor: bcs ? bcs.color : null,
    }
  })
  return JSON.stringify({ vw, vh, dpr: devicePixelRatio, rows })
})()`

const probe = async () => {
  const raw = await ev(PROBE)
  if (raw && raw.__err) throw new Error(`探针失败：${raw.__err}`)
  const v = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!v) throw new Error('探针返回空')
  return v
}

/** 用设备上的会话 token 调我们自己的后端 */
const api = async (path, init) => {
  const raw = await ev(`(async () => {
    const s = JSON.parse(localStorage.getItem('campus.demo.session.v1') || 'null')
    if (!s) return JSON.stringify({ __noSession: true })
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)}, Object.assign({
      headers: { authorization: 'Bearer ' + s.token, 'content-type': 'application/json' }
    }, ${JSON.stringify(init ?? {})}))
    return JSON.stringify({ status: r.status, body: (await r.text()).slice(0, 8000) })
  })()`)
  if (raw && raw.__err) throw new Error(`API ${path} 求值失败：${raw.__err}`)
  const v = JSON.parse(raw)
  if (v.__noSession) throw new Error('设备未登录（localStorage 里没有会话）')
  return v
}

// ---------------------------------------------------------------------------
console.log('=== 0. 前置：设备身份 ===')
const meRaw = await api('/api/auth/me', { method: 'GET' })
if (meRaw.status !== 200) {
  bad(`/api/auth/me → ${meRaw.status}（设备未登录或 token 失效）`)
  console.log('DEVICE_CHAT_SENDER_ALIGN FAIL')
  process.exit(1)
}
const me = JSON.parse(meRaw.body)
ok(`设备已登录：${me.displayName}（id=${me.id}）`)

// 会话 id 从服务端取，不写死
let threadId = threadArg
if (!threadId) {
  const tr = await api('/api/threads', { method: 'GET' })
  if (tr.status !== 200) {
    bad(`GET /api/threads → ${tr.status}`)
    console.log('DEVICE_CHAT_SENDER_ALIGN FAIL')
    process.exit(1)
  }
  const items = JSON.parse(tr.body).items ?? []
  /*
    选会话的判据：**同时**有"我发的"和"对方发的"消息。
    为什么必须两边都有：如果只有我发的消息，那么"靠右"完全可能来自
    "所有消息都靠右"这种同样错误的实现 —— 只有**两者共存且方向相反**，
    才证明这次改动真的在按发送者区分。
  */
  let best = null
  for (const th of items) {
    const mr = await api(`/api/threads/${th.id}/messages`, { method: 'GET' })
    if (mr.status !== 200) continue
    const msgs = JSON.parse(mr.body).items ?? []
    const mine = msgs.filter((m) => m.senderId === me.id).length
    const peer = msgs.filter((m) => m.senderId && m.senderId !== me.id).length
    if (mine > 0 && peer > 0) {
      best = { id: th.id, mine, peer, total: msgs.length }
      break
    }
    if (!best && mine > 0) best = { id: th.id, mine, peer, total: msgs.length, noPeer: true }
  }
  if (!best) {
    bad('该账号没有任何"我发过消息"的会话 —— 无法验证靠右')
    console.log('DEVICE_CHAT_SENDER_ALIGN FAIL')
    process.exit(1)
  }
  threadId = best.id
  info(`服务端选定会话 ${threadId}（我发的 ${best.mine} 条 / 对方 ${best.peer} 条 / 共 ${best.total} 条）`)
  if (best.noPeer) info('⚠ 该会话里没有对方的消息样本 —— 左侧断言会在下面标为未覆盖')
} else {
  info(`沿用命令行指定的会话：${threadId}`)
}

// ---------------------------------------------------------------------------
console.log('')
console.log('=== 1. 进入会话页 ===')
await ev(`location.hash = '#/chat/${threadId}'`)
for (let i = 0; i < 40; i++) {
  const s = await ev(`JSON.stringify({
    state: document.querySelector('.chat__state')?.innerText ?? '',
    rows: document.querySelectorAll('.chat__row').length,
    hash: location.hash,
  })`)
  const p = typeof s === 'string' ? JSON.parse(s) : {}
  if (p.rows > 0) break
  if (p.state && !p.state.includes('加载中')) break
  await wait(400)
}
info(`当前路由 ${await ev('location.hash')}`)

// 可选的"真发一条"：证明**新发出**的消息也走同一条渲染路径
let newMsgId = null
if (doPost) {
  console.log('')
  console.log('=== 1b. 以当前用户身份真发一条（走我们自己的后端）===')
  const posted = await api(`/api/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: 'M5 发送方呈现验证（临时）', kind: 'text' }),
  })
  info(`POST /api/threads/:id/messages → ${posted.status}`)
  if (posted.status !== 201) {
    bad(`真发一条失败：${posted.status} ${posted.body.slice(0, 200)}`)
  } else {
    const pj = JSON.parse(posted.body)
    newMsgId = pj.id ?? pj.message?.id ?? null
    ok(`已发出，新消息 id=${newMsgId}（**清理时按此 id 精确删除**）`)
  }
}

// ---------------------------------------------------------------------------
console.log('')
console.log('=== 2. ground truth：服务端返回的每条消息属于谁 ===')
// 重进一次会话页，让列表包含刚发的那条（页面只在挂载时拉一次）
await ev(`location.hash = '#/campus'`)
await wait(400)
await ev(`location.hash = '#/chat/${threadId}'`)
await wait(2500)

const mres = await api(`/api/threads/${threadId}/messages`, { method: 'GET' })
if (mres.status !== 200) {
  bad(`GET messages → ${mres.status}`)
  console.log('DEVICE_CHAT_SENDER_ALIGN FAIL')
  process.exit(1)
}
const msgs = JSON.parse(mres.body).items ?? []
const expectMine = msgs.filter((m) => m.senderId === me.id)
const expectPeer = msgs.filter((m) => m.senderId && m.senderId !== me.id)
info(`服务端共 ${msgs.length} 条：我发的 ${expectMine.length} 条、对方 ${expectPeer.length} 条`)

const p = await probe()
console.log('')
console.log(`=== 3. 实际渲染几何（视口 ${p.vw}×${p.vh} CSS px，dpr=${p.dpr}）===`)
console.log(`  判定门槛：自己发的气泡 left > 0.4×视口宽 = ${(0.4 * p.vw).toFixed(1)}`)
console.log('')
for (const r of p.rows) {
  const who = msgs.find((m) => m.id === r.messageId)
  const mine = who ? who.senderId === me.id : null
  console.log(
    `    ${mine === true ? '[我 ]' : mine === false ? '[对方]' : '[未知]'} ` +
      `id=${String(r.messageId).slice(0, 8)} ` +
      `bubble.left=${r.bubble ? r.bubble.left : 'n/a'} bubble.right=${r.bubble ? r.bubble.right : 'n/a'} ` +
      `flex=${r.rowFlexDirection} cls=${r.rowClass} "${r.text}"`,
  )
}

// ---------------------------------------------------------------------------
console.log('')
console.log('=== 4. 断言 ===')

const byId = new Map(p.rows.map((r) => [r.messageId, r]))

if (p.rows.length === 0) bad('页面上没有任何 .chat__row（会话页没渲染出来）')

// 4a. 每一条"我发的"都必须靠右 —— 用实际像素
let mineChecked = 0
for (const m of expectMine) {
  const r = byId.get(m.id)
  if (!r) {
    bad(`服务端有我发的消息 ${m.id.slice(0, 8)}（"${String(m.body).slice(0, 16)}"）但页面上没有对应行`)
    continue
  }
  mineChecked++
  if (!r.bubble) {
    bad(`我发的 ${m.id.slice(0, 8)} 那一行里没有 .bubble`)
    continue
  }
  const leftRatio = r.bubble.left / p.vw
  leftRatio > 0.4
    ? ok(
        `**我发的消息靠右**：气泡 getBoundingClientRect().left=${r.bubble.left} = 视口宽的 ${(leftRatio * 100).toFixed(1)}%（>40%），右边界 ${r.bubble.right}（视口宽 ${p.vw}）—— "${r.text}"`,
      )
    : bad(
        `我发的消息**没有**靠右：left=${r.bubble.left} 只占视口宽的 ${(leftRatio * 100).toFixed(1)}%（要求 >40%）—— 类名是 ${r.rowClass}，CSS 可能没生效`,
      )
  r.rowFlexDirection === 'row-reverse'
    ? info(`旁证：该行 flex-direction=row-reverse`)
    : info(`旁证（不参与判定）：该行 flex-direction=${r.rowFlexDirection}`)
}
if (expectMine.length === 0) bad('服务端说这个会话里没有我发的消息，靠右无从验证')
else if (mineChecked === 0) bad('我发的消息一条都没在页面上找到')

// 4b. 每一条"对方发的"仍必须在左侧 —— 这是**本次不改的行为**，用来证明没有把所有人当"我"
let peerChecked = 0
for (const m of expectPeer) {
  const r = byId.get(m.id)
  if (!r || !r.bubble) continue
  peerChecked++
  const leftRatio = r.bubble.left / p.vw
  leftRatio <= 0.4
    ? ok(
        `**对方的消息仍在左侧**：left=${r.bubble.left}（视口宽的 ${(leftRatio * 100).toFixed(1)}%）—— "${r.text}"`,
      )
    : bad(`对方的消息跑到右侧了（left=${r.bubble.left}，占 ${(leftRatio * 100).toFixed(1)}%）—— 可能把所有人都当成了"我"`)
}
if (expectPeer.length === 0) {
  info('⚠ 本会话没有对方的消息样本 → **左半部分未被覆盖**（不据此判 PASS）')
}

// 4c. 我自己发的那条 = 刚 POST 的那条（如果本次真发了）
if (newMsgId) {
  const r = byId.get(newMsgId)
  if (!r) {
    bad(`刚发出的消息 ${newMsgId} 没有出现在页面上`)
  } else if (!r.bubble || r.bubble.left / p.vw <= 0.4) {
    bad(`刚发出的消息没有靠右（left=${r.bubble ? r.bubble.left : 'n/a'}）`)
  } else {
    ok(`**刚发出的那条也靠右**（left=${r.bubble.left}，占视口宽 ${((r.bubble.left / p.vw) * 100).toFixed(1)}%）`)
  }
}

// 4d. 类名与几何必须一致（防止"类名对了/几何没变"或反之）
for (const r of p.rows) {
  const who = msgs.find((m) => m.id === r.messageId)
  if (!who) continue
  const mine = who.senderId === me.id
  const clsRight = r.rowClass.includes('chat__row--me') && r.bubbleClass.includes('bubble--me')
  const geoRight = r.bubble ? r.bubble.left / p.vw > 0.4 : false
  if (mine !== clsRight) bad(`消息 ${String(r.messageId).slice(0, 8)} 的类名与实际归属不符（mine=${mine} clsRight=${clsRight}）`)
  if (clsRight !== geoRight) {
    bad(
      `消息 ${String(r.messageId).slice(0, 8)} **类名与几何不一致**（类名靠右=${clsRight} 实际靠右=${geoRight}）` +
        ` —— 这正是"类名加上了但 CSS 没生效"的形态`,
    )
  }
}

// 4e. 降级路径：拿不到 meId 时必须全部回落到 --peer（不许把所有人当成"我"）
//
// ⚠ 这一步**必须 reload 页面**，不能只清 localStorage：
//    `getSession()` 在模块级有 cache（api/session.ts），同一个页面生命周期内
//    它才是唯一真相。只删 localStorage 而模块还活着时，缓存里仍有会话 ——
//    那测的是"外部篡改存储"，不是真实的"未登录"场景（第一版就是这么误报 FAIL 的）。
//    真实场景是「冷启动时本来就没有会话」→ 模块重新求值 → getSession() 返回 null。
//    产品内的"退出登录"走 clearSession()，它同时清缓存，行为与此一致。
console.log('')
console.log('=== 5. 降级路径：冷启动且无会话时，必须回落成"对方" ===')
const saved = await ev(`localStorage.getItem('campus.demo.session.v1')`)
await ev(`localStorage.removeItem('campus.demo.session.v1')`)
// hash 会被 reload 保留，所以先把路由落在会话页上，再 reload
await ev(`location.hash = '#/chat/${threadId}'`)
await wait(400)
await ev(`location.reload()`)
await wait(3500)
const deg = await ev(`JSON.stringify({
  hash: location.hash,
  meRows: document.querySelectorAll('.chat__row--me').length,
  peerRows: document.querySelectorAll('.chat__row--peer').length,
  rows: document.querySelectorAll('.chat__row').length,
  state: (document.querySelector('.chat__state')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 60),
})`)
const d = JSON.parse(deg)
// 恢复会话（后续步骤还要用）
await ev(`localStorage.setItem('campus.demo.session.v1', ${JSON.stringify(saved)})`)
await ev(`location.reload()`)
await wait(3500)
if (d.rows === 0) {
  info(
    `未登录时会话页根本不渲染消息（路由 ${d.hash}，state="${d.state}"）→ ` +
      `**降级路径在真机上不可达**。该分支由源码保证（meId===null → mine 恒为 false），` +
      `本轮**未在真机上覆盖**，如实记为未覆盖。`,
  )
} else if (d.meRows === 0) {
  ok(`未登录时 ${d.rows} 行全部是 --peer（meRows=0）—— 没有把所有人当成"我"`)
} else {
  bad(`未登录时仍有 ${d.meRows} 行被渲染成 --me —— 拿不到 meId 时没有降级`)
}

// ---------------------------------------------------------------------------
if (shot) {
  console.log('')
  console.log('=== 6. 截图（供与原版并排比对）===')
  // 先回到有会话的正常状态
  await ev(`location.hash = '#/campus'`)
  await wait(400)
  await ev(`location.hash = '#/chat/${threadId}'`)
  await wait(2500)
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const data = s?.result?.data
  if (data) {
    writeFileSync(shot, Buffer.from(data, 'base64'))
    ok(`已保存截图：${shot}`)
  } else {
    bad('Page.captureScreenshot 没有返回数据')
  }
}

console.log('')
console.log(failed === 0 ? 'DEVICE_CHAT_SENDER_ALIGN PASS' : 'DEVICE_CHAT_SENDER_ALIGN FAIL')
try {
  ws.close()
} catch {
  /* 已关 */
}
process.exit(failed)
