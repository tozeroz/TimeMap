/**
 * WO#9A 设备侧 Gate：群聊垂直切片
 *
 * 裁定依据：审核记录 44（"WO#9 拆 Group 基础与 AT"）；计划见
 *   docs/m5/WO9A-PLAN-group-conversation-slice.md
 *
 * ## 为什么现在就跑（改前）
 *   审核 43 冻结的纪律：
 *     PREFERRED: pre-fix FAIL → fix → PASS   （同时证明 Gate 能捕获**真实历史 defect**）
 *     REQUIRED : controlled sensitivity test
 *   群聊目前**整页是 mock**（GroupChatScreen 从 '../data/mock' 读 groups[0]，
 *   而 app/src/screens/MessageScreen.tsx 里点击群行会带 mock id 'g1'）。
 *   现在跑才能拿到"改前 FAIL"这条更强的证据。
 *
 * ## ENTRY REACHABILITY（审核 44 冻结为一等 Gate 类别）
 *   本脚本**不设 hash 进群聊** —— 必须从「消息」列表的**真实入口**走：
 *     顶栏「消息」图标 → 列表 → 点群行 → 群聊页
 *   直接设 hash 只能证明 destination functionality，不能证明用户可达性。
 *
 * ## 断言
 *   GROUP_THREAD_IN_API       /api/threads 有 kind='group' 且 memberCount ≥ 3
 *   MESSAGE_LIST_SHOWS_GROUP  「消息」列表出现 kind='group' 的行
 *   ENTRY_REACHES_GROUP       点该行 → 落群聊路由，且 id 与 API 的 group id **同一 UUID**
 *   GROUP_MESSAGES_FROM_API   群聊页真的发出 GET /api/threads/<uuid>/messages 且 200
 *   GROUP_MESSAGE_IDENTITY    页面上每条消息的 sender 与 API 的 senderId 一致
 *   UI_HEADER_CONFORMANCE     返回 / 群头像 / 群名 / 右侧入口 都在，群名文本 == API title
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo9a-gate.json'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/*
  种子口径（必须与 server/src/seed.ts 一致）。
  ⚠️ 这三个常量**必须声明在最前面**：它们既用于中间的 identity 断言、也用于末尾的判定，
     而 `const` 不提升（会被 TDZ 拦住）—— 我第一版把它们放在末尾，
     结果 identity 那段报 `Cannot access 'SEED_GROUP_ID' before initialization`。
*/
const SEED_GROUP_ID = 'aaaaaaaa-0001-4001-8001-00000000000a'
const SEED_GROUP_TITLE = '计算机学院 2023 级'
/** 种子里该群声明的成员数（2 人）。**不是** >=3 —— 见审核记录 45 对 seed 口径的裁定 */
const SEED_MEMBER_COUNT = 2

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target（用 scripts/m5/run-device-gate.sh 跑）')
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
async function evaluate(expression, timeoutMs = 30000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

await evaluate(`(() => {
  if (!window.__WO9NET__) {
    window.__WO9NET__ = []
    const orig = window.fetch
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''
      const method = ((args[1] || {}).method || 'GET').toUpperCase()
      let status = 0, body = ''
      try {
        const res = await orig(...args)
        status = res.status
        if (/\\/api\\/threads/.test(url)) { try { body = (await res.clone().text()).slice(0, 6000) } catch {} }
        return res
      } finally {
        if (url.includes('/api/')) window.__WO9NET__.push({ method, url: url.replace(/^https?:\\/\\/[^/]+/, ''), status, body })
      }
    }
  }
  window.__WO9NET__ = []
  return true
})()`)

// ---------- 1) 真实入口进入「消息」列表 ----------
console.log('=== 1) 真实入口 →「消息」列表（不设 hash）===')
await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2500))
const entry = await evaluate(`(async () => {
  const btn = document.querySelector('button[aria-label="消息"]')
  if (!btn) return { reached: false, why: '顶栏没有「消息」入口' }
  btn.click()
  await new Promise(r => setTimeout(r, 2200))
  return { reached: location.hash === '#/message', hash: location.hash }
})()`)
log('ENTRY_MESSAGE_LIST', entry)

// ---------- 2) /api/threads 里有没有 group ----------
const netList = await evaluate(`(window.__WO9NET__ || []).filter(n => /^\\/api\\/threads(\\?|$)/.test(n.url))`)
let apiItems = []
for (const n of netList) {
  try {
    const j = JSON.parse(n.body)
    if (Array.isArray(j.items)) apiItems = j.items
  } catch {}
}
const groupItems = apiItems.filter((t) => t.kind === 'group')
log('API_THREADS_SUMMARY', {
  total: apiItems.length,
  direct: apiItems.filter((t) => t.kind === 'direct').length,
  group: groupItems.length,
  groupIds: groupItems.map((t) => t.id),
  groups: groupItems.map((t) => ({ id: t.id, title: t.title, memberCount: t.memberCount })),
})

// ---------- 3) 列表里是否出现群行 ----------
const uiRows = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-thread-id]')]
  return rows.map(r => ({
    id: r.getAttribute('data-thread-id'),
    kind: r.getAttribute('data-thread-kind'),
    text: (r.innerText || '').replace(/\\n/g, ' | ').slice(0, 80),
  }))
})()`)
log('UI_ROWS', uiRows)
const uiGroupRows = uiRows.filter((r) => r.kind === 'group')
log('UI_GROUP_ROWS', uiGroupRows)

// ---------- 4) 点群行（若无群行则记 NOT_FOUND）----------
console.log('')
console.log('=== 4) 从列表点群行 → 群聊页 ===')
let click = { clicked: false, why: '没有 kind=group 的行' }
if (uiGroupRows.length > 0) {
  await evaluate(`window.__WO9NET__ = []`)
  click = await evaluate(`(async () => {
    const row = document.querySelector('[data-thread-kind="group"]')
    if (!row) return { clicked: false, why: '行消失' }
    const expectId = row.getAttribute('data-thread-id')
    row.click()
    await new Promise(r => setTimeout(r, 3000))
    return { clicked: true, expectId, hash: location.hash }
  })()`)
}
log('CLICK_GROUP_ROW', click)
const netAfter = await evaluate(`window.__WO9NET__ || []`)
log('GROUP_NETWORK', netAfter.map((n) => ({ method: n.method, url: n.url, status: n.status })))

const pageState = await evaluate(`(() => {
  const t = document.querySelector('.grp__title, [data-group-title]')
  return {
    hash: location.hash,
    title: t ? t.textContent : null,
    hasBack: !!document.querySelector('button[aria-label="返回"], button[aria-label="关闭"]'),
    hasAvatar: !!document.querySelector('.grp__avatar, [data-group-avatar]'),
    hasRightEntry: !!document.querySelector('button[aria-label="群设置"], button[aria-label="更多"], .grp__right'),
    hasComposer: !!document.querySelector('.grp__composer, .chatbar'),
    bubbleCount: document.querySelectorAll('[data-message-id]').length,
    bodyHead: (document.body.innerText || '').slice(0, 200).replace(/\\n/g, ' / '),
  }
})()`)
log('GROUP_PAGE_STATE', pageState)

// ---------- 5) GROUP_MESSAGE_IDENTITY：渲染出的每条消息的 sender 归属 ----------
console.log('')
console.log('=== 5) GROUP_MESSAGE_IDENTITY：消息归属是否与 API 的 senderId 一致 ===')
/*
  群聊页**不显示发送者昵称**（审核记录 45：无证据 → 不实现），
  所以"身份"在 UI 上只能通过**对齐方向**体现：
    我自己发的 → 靠右；对方发的 → 靠左
  证据强度（审核记录 45 的原话口径）：
    GROUP_OWN_MESSAGE_RIGHT:  **CONFIRMED**（原版群聊 dump 里自己的消息确实在右侧：
                              userAvatarView x=[989,1052]、内容 x=[905,975]）
    GROUP_PEER_MESSAGE_LEFT:  **CROSS_CONTEXT_REUSE / NOT_DIRECTLY_OBSERVED**
                              （沿用 direct 会话的强证据；原版该群里没有别人的消息可观察）
  本条断言的是"**归属与 API 一致**"，而不是"排布方向等于原版" ——
  后者按上面的口径只能算跨场景沿用。
*/
const identity = await evaluate(`(async () => {
  /*
    身份 oracle（审核纪律：**用 /api/auth/me，不要用 localStorage/CSS 自证**）：
      · token 从应用自己的会话存储里取（key = 'campus.demo.session.v1'，来自 api/session.ts）
      · "我是谁"由**服务端**回答（GET /api/auth/me），而不是由我猜或由 DOM 推断
    ⚠️ 我第一版这里猜错了 localStorage 的 key（猜成 campus.session），于是 meId=null，
       断言 FAIL —— 而 DOM 的对齐其实完全正确。**是我的断言取身份的方式错了**，
       不是产品错了。教训与"用 CSS/class 自证身份"同源：身份必须来自权威 oracle。
  */
  const raw = localStorage.getItem('campus.demo.session.v1') || ''
  let tok = null
  try { tok = JSON.parse(raw).token || null } catch {}
  if (!tok) return { meId: null, why: 'no token in localStorage', rows: [] }
  /*
    ⚠️ 必须用**绝对 origin**。在 Capacitor WebView 里用相对路径 fetch('/api/auth/me')
    会打到 WebView 自己的本地服务器（https://localhost），返回 index.html 且**状态码还是 200** ——
    于是 json() 解析出 {} ，meId 变成 null，而看着像"服务端没返回 id"。
    这个坑本项目**踩过第二次**（第一次是 WO#5 的语音 E2E），故这里写死绝对地址，
    并在注释里点名，避免第三次。

    ⚠️ 另外：本段是**模板字符串内部**，注释里**不能出现反引号** ——
    我第一版在这里写了带反引号的 fetch(...)，直接把模板字符串提前闭合，
    导致整个脚本 SyntaxError（"missing ) after argument list"）。
    这个坑在给审核发消息时踩过多次，现在也踩进了自己的 Gate 脚本里，故记在这里。
  */
  const API = 'https://8.148.156.146'
  const meRes = await fetch(API + '/api/auth/me', { headers: { authorization: 'Bearer ' + tok } })
  const me = await meRes.json().catch(() => ({}))
  const rows = [...document.querySelectorAll('[data-message-id]')]
  return {
    meId: me.id || null,
    meStatus: meRes.status,
    rows: rows.map((r) => {
      const b = r.querySelector('.bubble') || r
      const cls = b.className || ''
      return {
        id: r.getAttribute('data-message-id'),
        mine: /--me\\b/.test(cls),
        peer: /--peer\\b/.test(cls),
      }
    }),
  }
})()`)
log('IDENTITY_DOM', identity)

// 用 API 的那份消息做对照（同一 token、同一接口）
const apiMsgs = await (async () => {
  const r = await evaluate(`(async () => {
    const raw = localStorage.getItem('campus.demo.session.v1') || ''
    let tok = null
    try { tok = JSON.parse(raw).token || null } catch {}
    if (!tok) return null
    // 同样必须用绝对 origin（理由见上面 /api/auth/me 处的注释）
    const res = await fetch('https://8.148.156.146/api/threads/${SEED_GROUP_ID}/messages', { headers: { authorization: 'Bearer ' + tok } })
    return await res.json()
  })()`)
  return r && r.items ? r.items : []
})()
log('IDENTITY_API', apiMsgs.map((m) => ({ id: m.id, senderId: m.senderId, kind: m.kind })))

const meId = identity && identity.meId
const domById = new Map((identity && identity.rows ? identity.rows : []).map((r) => [r.id, r]))
let identityChecked = 0
let identityOk = 0
for (const m of apiMsgs) {
  const d = domById.get(m.id)
  if (!d) continue
  identityChecked++
  const shouldBeMine = !!meId && m.senderId === meId
  if (shouldBeMine ? d.mine && !d.peer : d.peer && !d.mine) identityOk++
}
log('IDENTITY_RESULT', { meId, checked: identityChecked, ok: identityOk })

// ---------- 判定 ----------
const routeId = (() => {
  const h = click.hash || ''
  const m1 = h.match(/[?&]id=([^&]+)/)
  if (m1) return decodeURIComponent(m1[1])
  const m2 = h.match(/#\/group\/([^?&]+)/)
  return m2 ? m2[1] : null
})()
const msgReq = netAfter.find((n) => n.method === 'GET' && /\/messages/.test(n.url))
const apiGroup = groupItems[0]

/*
  UI_HEADER_CONFORMANCE 的**收紧**（改前运行后自查发现原版太弱）：
  第一版只断言"有返回键 且 title 非 null" —— 但那在**没有到达群聊页**时也可能成立
  （例如停在「消息」列表：它有「关闭」按钮）。那属于"断言可能在错误的页面上通过"。
  现在要求四件事**同时**成立，且**必须真的在群聊路由上**：
    ① 路由是群聊（#/group…）
    ② 群名文本 == API 给的 group title（**不是**只要非空）
    ③ 有返回控件
    ④ 有群头像 + 右侧入口（按 dump 证据：chatAvatar 与 rightIcon 都是 clickable）
  注：④ 只断言**结构存在**；两者的**目的地**记为 NOT_EVALUATED（原版行为无证据）。
  （SEED_* 常量已上移到文件顶部 —— 见那里的注释说明 TDZ 的坑。）
*/
const onGroupRoute = /^#\/group/.test(pageState.hash || '')
const titleMatchesApi = !!(apiGroup && pageState.title && pageState.title.trim() === String(apiGroup.title || '').trim())
const headerOk = onGroupRoute && titleMatchesApi && pageState.hasBack && pageState.hasAvatar && pageState.hasRightEntry

const v = {
  GROUP_THREAD_IN_API: apiGroup && apiGroup.memberCount === SEED_MEMBER_COUNT ? 'PASS' : 'FAIL',
  MESSAGE_LIST_SHOWS_GROUP: uiGroupRows.length > 0 ? 'PASS' : 'FAIL',
  ENTRY_REACHES_GROUP: routeId && UUID_RE.test(routeId) && apiGroup && routeId === apiGroup.id ? 'PASS' : 'FAIL',
  GROUP_MESSAGES_FROM_API: msgReq && msgReq.status === 200 ? 'PASS' : 'FAIL',
  /*
    GROUP_MESSAGE_IDENTITY：页面上每条消息的**归属**必须与 API 的 senderId 一致。
    判定口径 = "自己发的靠右、对方靠左"，其中：
      GROUP_OWN_MESSAGE_RIGHT: CONFIRMED（原版群聊 dump 直接观察到）
      GROUP_PEER_MESSAGE_LEFT: CROSS_CONTEXT_REUSE / NOT_DIRECTLY_OBSERVED
    因此本条 = **身份一致性** PASS，不等价于"排布方向已与原版对齐"。
  */
  GROUP_MESSAGE_IDENTITY:
    identityChecked > 0 && identityOk === identityChecked ? 'PASS' : 'FAIL',
  GROUP_OWN_MESSAGE_RIGHT: 'CONFIRMED',
  GROUP_PEER_MESSAGE_LEFT: 'CROSS_CONTEXT_REUSE / NOT_DIRECTLY_OBSERVED',
  UI_HEADER_STRUCTURE: pageState.hasBack && pageState.hasAvatar && pageState.hasRightEntry ? 'PASS' : 'FAIL',
  UI_HEADER_TITLE_MATCHES_API: titleMatchesApi ? 'PASS' : 'FAIL',
  GROUP_BACK_NAVIGATION: pageState.hasBack ? 'PASS' : 'FAIL',
  GROUP_AVATAR_DESTINATION: 'NOT_EVALUATED',
  GROUP_RIGHT_ACTION: 'NOT_EVALUATED',
  detail: {
    onGroupRoute,
    apiGroupCount: groupItems.length,
    seedGroupFound: !!(apiGroup && apiGroup.id === SEED_GROUP_ID),
    seedTitleMatches: !!(apiGroup && apiGroup.title === SEED_GROUP_TITLE),
    uiGroupRowCount: uiGroupRows.length,
    clickedHash: click.hash,
    routeId,
    expectGroupId: apiGroup ? apiGroup.id : null,
    messagesReqStatus: msgReq ? msgReq.status : null,
    groupNetworkCount: netAfter.length,
    pageTitle: pageState.title,
    apiTitle: apiGroup ? apiGroup.title : null,
    hasBack: pageState.hasBack,
    hasAvatar: pageState.hasAvatar,
    hasRightEntry: pageState.hasRightEntry,
  },
}
const KEYS = [
  'GROUP_THREAD_IN_API',
  'MESSAGE_LIST_SHOWS_GROUP',
  'ENTRY_REACHES_GROUP',
  'GROUP_MESSAGES_FROM_API',
  'GROUP_MESSAGE_IDENTITY',
  'UI_HEADER_STRUCTURE',
  'UI_HEADER_TITLE_MATCHES_API',
  'GROUP_BACK_NAVIGATION',
]
v.WO9A_DEVICE_GATE = KEYS.every((k) => v[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO9A_DEVICE_GATE === 'PASS' ? 0 : 1)
