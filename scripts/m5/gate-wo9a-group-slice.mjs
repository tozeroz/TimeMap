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
*/
const onGroupRoute = /^#\/group/.test(pageState.hash || '')
const titleMatchesApi = !!(apiGroup && pageState.title && pageState.title.trim() === String(apiGroup.title || '').trim())
const headerOk = onGroupRoute && titleMatchesApi && pageState.hasBack && pageState.hasAvatar && pageState.hasRightEntry

const v = {
  GROUP_THREAD_IN_API: apiGroup && apiGroup.memberCount >= 3 ? 'PASS' : 'FAIL',
  MESSAGE_LIST_SHOWS_GROUP: uiGroupRows.length > 0 ? 'PASS' : 'FAIL',
  ENTRY_REACHES_GROUP: routeId && UUID_RE.test(routeId) && apiGroup && routeId === apiGroup.id ? 'PASS' : 'FAIL',
  GROUP_MESSAGES_FROM_API: msgReq && msgReq.status === 200 ? 'PASS' : 'FAIL',
  GROUP_MESSAGE_IDENTITY: 'NOT_EVALUATED', // 需要页面渲染出 sender 才有意义；改后重评
  UI_HEADER_CONFORMANCE: headerOk ? 'PASS' : 'FAIL',
  detail: {
    apiGroupCount: groupItems.length,
    uiGroupRowCount: uiGroupRows.length,
    clickedHash: click.hash,
    routeId,
    expectGroupId: apiGroup ? apiGroup.id : null,
    messagesReqStatus: msgReq ? msgReq.status : null,
    groupNetworkCount: netAfter.length,
    onGroupRoute,
    pageTitle: pageState.title,
    apiTitle: apiGroup ? apiGroup.title : null,
    titleMatchesApi,
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
  'UI_HEADER_CONFORMANCE',
]
v.WO9A_DEVICE_GATE = KEYS.every((k) => v[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO9A_DEVICE_GATE === 'PASS' ? 0 : 1)
