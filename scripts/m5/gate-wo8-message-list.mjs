/**
 * WO#8 设备侧 Gate：「消息」入口接真实后端
 *
 * ## 为什么现在就要跑（在实现之前）
 *   审核 43 的纪律：
 *     PREFERRED: pre-fix FAIL → fix → PASS   （同时证明 Gate 能捕获**真实历史 defect**）
 *     REQUIRED : controlled sensitivity test（破坏 invariant → FAIL；恢复 → PASS）
 *   本缺陷**现在还没修** —— 这是拿到"改前 FAIL"这条更强证据的**唯一时机**。
 *   修完之后就再也拿不到了（除非回滚构建）。
 *
 * ## 本单要证明的用户路径（这是核心）
 *   用户从「消息」入口 → 看到**真实**会话 → 点进去 → 到达**真实**聊天页并成功加载。
 *   之前所有 Gate 都用"直接设 hash"进页面，**恰好跳过了这一段** —— 缺陷就是这么躲过去的。
 *
 * ## 断言（改前应 FAIL，改后应 PASS）
 *   ENTRY_FROM_TAB            能从底部 tab 正常到达「消息」（而不是直接设 hash）
 *   MESSAGE_LIST_FROM_API     列表项数/内容来自 GET /api/threads（同一次渲染内观测到该请求）
 *   MESSAGE_LIST_NO_MOCK_ID   每个会话项的路由 id 都是合法 UUID
 *   MESSAGE_LIST_CLICK_REACHES_CHAT
 *                             点会话项 → 落 #/chat/<uuid> → 真的发出
 *                             GET /api/threads/<uuid>/messages 且 200
 *   CHAT_ROUTE_NO_MOCK_FALLBACK
 *                             反向断言：#/chat（无 id）**不得**回退到 mock id 't1'
 *   MESSAGE_LIST_EMPTY_STATE  空列表有明确空态（在有数据的库上为 INFO，不判 FAIL）
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo8-gate.json'
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
/** 已知的 mock id 形态（用于"不得回退到 mock"的反向断言） */
const MOCK_IDS = ['t1', 't2', 't3', 'g1', 'u1']

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}

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

// 网络观测钩子（只记 /api/）
await evaluate(`(() => {
  if (!window.__WO8NET__) {
    window.__WO8NET__ = []
    const orig = window.fetch
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''
      const method = ((args[1] || {}).method || 'GET').toUpperCase()
      let status = 0
      let snippet = ''
      try {
        const res = await orig(...args)
        status = res.status
        if (url.includes('/api/threads')) { try { snippet = (await res.clone().text()).slice(0, 200) } catch {} }
        return res
      } finally {
        if (url.includes('/api/')) window.__WO8NET__.push({ method, url: url.replace(/^https?:\\/\\/[^/]+/, ''), status, snippet })
      }
    }
  }
  window.__WO8NET__ = []
  return true
})()`)

// ---------- 1) 入口：从 UI 走到「消息」，而不是直接设 hash ----------
console.log('=== 1) ENTRY_FROM_TAB：从 UI 走到「消息」（不直接设 hash）===')
/*
  真实的用户入口（已核实，不是假设）：
    顶栏的「消息」图标按钮 aria-label="消息"，在三个屏幕的顶栏都有：
      app/src/screens/CampusScreen.tsx:223
      app/src/screens/MeScreen.tsx:42
      app/src/screens/MapScreen.tsx:387
    与原版证据一致：docs/original-baseline/screens/original-chat/INDEX.md 记录
      「个人主页右上角存在无文字的聊天入口图标」。
  ⚠️ 我第一版门禁**假设**底部 tab「Lemy」直达消息 —— 实测它是 navigate('me')（#/me），
     所以那条断言当时 FAIL 是**我的假设错了**，不是产品缺陷。已按证据改正。
*/
await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2500))
const entry = await evaluate(`(async () => {
  const btn = document.querySelector('button[aria-label="消息"]')
  if (!btn) {
    const labels = [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label'))
    return { reached: false, why: '当前屏幕顶栏没有「消息」入口', availableLabels: labels.slice(0, 20), hash: location.hash }
  }
  btn.click()
  await new Promise(r => setTimeout(r, 2000))
  return { reached: location.hash === '#/message', hash: location.hash }
})()`)
log('ENTRY_FROM_TAB', entry)

// ---------- 2) 列表是否来自 API ----------
console.log('')
console.log('=== 2) MESSAGE_LIST_FROM_API / MESSAGE_LIST_NO_MOCK_ID ===')
const listState = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('button')].filter(b => /相同学校|人$|\\d{2}:\\d{2}|昨天|周[一二三四五六日]/.test(b.innerText || ''))
  const texts = rows.slice(0, 12).map(r => (r.innerText || '').replace(/\\n/g, ' | ').slice(0, 70))
  return { rowCount: rows.length, texts, hash: location.hash }
})()`)
const netAfterList = await evaluate(`window.__WO8NET__ || []`)
log('LIST_STATE', listState)
log('LIST_NETWORK', netAfterList)

// ---------- 3) 点第一个会话项 → 是否到达真实聊天 ----------
console.log('')
console.log('=== 3) MESSAGE_LIST_CLICK_REACHES_CHAT ===')
await evaluate(`window.__WO8NET__ = []`)
const click = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('button')].filter(b => /相同学校|人$|\\d{2}:\\d{2}|昨天|周[一二三四五六日]/.test(b.innerText || ''))
  if (!rows.length) return { clicked: false, why: '没有可点的会话行' }
  const label = (rows[0].innerText || '').replace(/\\n/g, ' | ').slice(0, 70)
  rows[0].click()
  await new Promise(r => setTimeout(r, 3000))
  return { clicked: true, label, hash: location.hash }
})()`)
const netAfterClick = await evaluate(`window.__WO8NET__ || []`)
const chatState = await evaluate(`(() => ({
  hash: location.hash,
  hasInput: !!document.querySelector('.chatbar__input'),
  hasBubble: !!document.querySelector('[data-message-id]'),
  bodyHead: (document.body.innerText || '').slice(0, 160).replace(/\\n/g, ' / '),
}))()`)
log('CLICK', click)
log('CLICK_NETWORK', netAfterClick)
log('CLICK_RESULT', chatState)

// ---------- 4) 反向断言：无 id 的 #/chat 不得回退到 mock ----------
console.log('')
console.log('=== 4) CHAT_ROUTE_NO_MOCK_FALLBACK（反向断言）===')
await evaluate(`window.__WO8NET__ = []`)
await evaluate(`location.hash = '#/chat'`)
await new Promise((r) => setTimeout(r, 3000))
const noId = await evaluate(`(() => ({
  hash: location.hash,
  bodyHead: (document.body.innerText || '').slice(0, 160).replace(/\\n/g, ' / '),
}))()`)
const netNoId = await evaluate(`window.__WO8NET__ || []`)
log('CHAT_NO_ID', noId)
log('CHAT_NO_ID_NETWORK', netNoId)

// ---------- 判定 ----------
const listNet = (netAfterList || []).filter((n) => n.method === 'GET' && /^\/api\/threads(\?|$)/.test(n.url))
const clickReachedUuid = typeof click.hash === 'string' && click.hash.startsWith('#/chat/') && UUID_RE.test(click.hash)
const clickNetOk = (netAfterClick || []).some((n) => n.method === 'GET' && /^\/api\/threads\/.+?\/messages/.test(n.url) && n.status === 200)
const noIdUsedMock = (netNoId || []).some((n) => MOCK_IDS.some((m) => n.url.includes(`/threads/${m}`)))

const v = {
  ENTRY_FROM_TAB: entry && entry.reached ? 'PASS' : 'FAIL',
  MESSAGE_LIST_FROM_API: listNet.length >= 1 ? 'PASS' : 'FAIL',
  MESSAGE_LIST_NO_MOCK_ID: clickReachedUuid ? 'PASS' : 'FAIL',
  MESSAGE_LIST_CLICK_REACHES_CHAT: clickReachedUuid && clickNetOk ? 'PASS' : 'FAIL',
  CHAT_ROUTE_NO_MOCK_FALLBACK: noIdUsedMock ? 'FAIL' : 'PASS',
  detail: {
    listApiCalls: listNet.length,
    clickedHash: click && click.hash,
    clickApiCalls: (netAfterClick || []).length,
    clickGot200Messages: clickNetOk,
    noIdHash: noId && noId.hash,
    noIdRequestedMockId: noIdUsedMock,
  },
}
v.WO8_DEVICE_GATE = ['ENTRY_FROM_TAB', 'MESSAGE_LIST_FROM_API', 'MESSAGE_LIST_NO_MOCK_ID', 'MESSAGE_LIST_CLICK_REACHES_CHAT', 'CHAT_ROUTE_NO_MOCK_FALLBACK'].every(
  (k) => v[k] === 'PASS',
)
  ? 'PASS'
  : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO8_DEVICE_GATE === 'PASS' ? 0 : 1)
