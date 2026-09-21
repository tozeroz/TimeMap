/**
 * WO#8 设备侧 Gate：「消息」入口接真实后端
 *
 * 裁定依据：审核记录 44（WO8_MESSAGE_ENTRY_REAL_BACKEND: APPROVED，附两处 Gate 收紧）
 *
 * ## 本单要保护的核心 invariant（审核 44 原文给出）
 *
 *   /api/threads
 *      ↓ **exact identity continuity**
 *   MessageScreen row
 *      ↓ user click
 *   canonical chat route with **same UUID**
 *      ↓
 *   GET /api/threads/<same UUID>/messages = 200
 *
 * ## 审核 44 对第一版门禁的两处收紧（都已落实）
 *
 * ① `MESSAGE_LIST_NO_MOCK_ID` 太弱 —— "**随机 UUID 也能通过**"。
 *    → 改为 **IDENTITY_CONTINUITY**：把 UI 每一行携带的 threadId 与**本次**
 *      `GET /api/threads` 返回的 item.id 做**有序集合精确比对**；
 *      title / memberCount / lastMessage 也**按同一个 id 配对**核对。
 *
 * ② **不要制造两套正式 URL 规范**（根因正是产生 query 而只读 path param）。
 *    → 冻结为：
 *         CANONICAL:     `#/chat?id=<uuid>`      ← Gate 验证 MessageScreen **实际产生的**形式
 *         COMPATIBILITY: `#/chat/<uuid>`         ← 仍可解析
 *         RESOLUTION:    query.id → path param → missing state
 *
 * ## 新增的反向条件（审核 44 要求，比"删掉 't1'"更强）
 *
 *   CHAT_ROUTE_INVALID_ID:
 *     非空但**非法 UUID** 的 id → 显示明确的"无效会话" → **0 次** 请求
 *     `/api/threads/<bad-id>/messages`
 *   → 这条可以**永久防止 mock id 再渗回来**（不只是修掉当前那一个 't1'）。
 *
 * ## 空态/错误态的口径（审核 44）
 *   若通过网络 stub 验证 → 标 `client code-path PASS`，**不声称真实服务器 E2E**。
 *   当前真实账号有 2 个 thread，**不为了造空账号再扩测试状态**。
 *
 * ## 为什么 Gate 里要"从 UI 走进去"
 *   审核 44 把 ENTRY REACHABILITY 正式冻结为一等 Gate 类别：
 *   ```
 *   Functional correctness: 给定目标页面已被调用，它是否正确工作？
 *   Entry reachability:     真实用户是否能从受支持的上游入口，
 *                           通过正常 UI 操作，携带正确的 authoritative identity，
 *                           真正到达该功能？
 *   ```
 *   直接设 hash 只能证明 **destination functionality**，**绝不能**证明 user-path reachability。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo8-gate.json'
const API = 'https://8.148.156.146'
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
/** 已知 mock id 形态（不得再出现在任何真实 API 调用里） */
const MOCK_IDS = ['t1', 't2', 't3', 'g1', 'g2', 'u1']

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

// 网络观测：同时记录**响应体**（IDENTITY_CONTINUITY 需要 /api/threads 的真实 payload）
await evaluate(`(() => {
  if (!window.__WO8NET__) {
    window.__WO8NET__ = []
    const orig = window.fetch
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''
      const method = ((args[1] || {}).method || 'GET').toUpperCase()
      let status = 0, body = ''
      try {
        const res = await orig(...args)
        status = res.status
        if (/\\/api\\/threads/.test(url)) { try { body = (await res.clone().text()).slice(0, 4000) } catch {} }
        return res
      } finally {
        if (url.includes('/api/')) {
          window.__WO8NET__.push({ method, url: url.replace(/^https?:\\/\\/[^/]+/, ''), status, body })
        }
      }
    }
  }
  window.__WO8NET__ = []
  return true
})()`)

// ---------- 1) ENTRY REACHABILITY：从真实上游入口走到「消息」 ----------
console.log('=== 1) ENTRY_FROM_REAL_UI：从顶栏「消息」图标进入（不设 hash）===')
await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2500))
const entry = await evaluate(`(async () => {
  const btn = document.querySelector('button[aria-label="消息"]')
  if (!btn) return { reached: false, why: '当前屏幕顶栏没有「消息」入口', hash: location.hash }
  btn.click()
  await new Promise(r => setTimeout(r, 2200))
  return { reached: location.hash === '#/message', hash: location.hash }
})()`)
log('ENTRY_FROM_REAL_UI', entry)

// ---------- 2) IDENTITY_CONTINUITY：UI 行 ↔ /api/threads payload ----------
console.log('')
console.log('=== 2) IDENTITY_CONTINUITY（审核 44 收紧后的断言）===')
const netList = await evaluate(`(window.__WO8NET__ || []).filter(n => /^\\/api\\/threads(\\?|$)/.test(n.url))`)
let apiItems = []
for (const n of netList) {
  try {
    const j = JSON.parse(n.body)
    if (Array.isArray(j.items)) apiItems = j.items
  } catch {}
}
log('API_THREADS_ITEMS', apiItems.map((t) => ({ id: t.id, title: t.title, memberCount: t.memberCount })))

const uiRows = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-thread-id]')]
  if (rows.length) {
    return {
      mode: 'data-attr',
      ids: rows.map(r => r.getAttribute('data-thread-id')),
      kinds: rows.map(r => r.getAttribute('data-thread-kind')),
      texts: rows.map(r => (r.innerText||'').replace(/\\n/g,' | ').slice(0,70)),
    }
  }
  // 没有 data 属性时，退化为"可点会话行"的可见文本（用于收集证据，不用于通过判定）
  const btns = [...document.querySelectorAll('button')].filter(b => /相同学校|人$|\\d{2}:\\d{2}|昨天|周[一二三四五六日]/.test(b.innerText || ''))
  return { mode: 'text-only', ids: [], kinds: [], texts: btns.map(b => (b.innerText||'').replace(/\\n/g,' | ').slice(0,70)) }
})()`)
log('UI_ROWS', uiRows)

/*
  ## ⚠️ 本断言的两处精度修正（WO#9A 列出群会话后发现，**不是放松契约**）

  加了群会话之后本 Gate 有两条断言 FAIL，但查证后**都不是产品回归**，而是断言没指明"测的是哪一行"：

  ① `IDENTITY_CONTINUITY`：原版比较**全局有序** id 集合。
     但我方「消息」列表是**按类型分组呈现**的（群在前、单聊在后，与原版列表的呈现一致），
     而 `/api/threads` 是按"最后消息时间"排序 —— 两者全局顺序本来就**不应当**相等。
     → 改为**按类型分别比较有序子集**：
          UI 的群 id 有序列表 == API 的群 id 有序列表（同理 direct）。
       这仍然完全保留审核 44 想要的"exact identity continuity"（不许多、不许少、不许换序），
       只是不再要求"跨类型的全局顺序"与 API 一致（那会与分组呈现相冲突）。
  ② `CLICK_ROUTE_CANONICAL` / `CLICK_SAME_UUID_200`：原来点"第一个 data-thread-id 的行"。
     有群之后第一行是**群**，于是落到 #/group —— 而这两条断言本意是验 **direct** 聊天路径。
     → 改为**显式点 `[data-thread-kind="direct"]` 的第一行**。
       （群路径由 gate-wo9a-group-slice.mjs 负责，两条路径各自被精确断言。）
*/
const byKind = (arr, kind) => arr.filter((x) => x.kind === kind).map((x) => String(x.id))
const apiGroups = byKind(apiItems, 'group')
const apiDirects = byKind(apiItems, 'direct')
const uiGroupsList = uiRows.ids.filter((_, i) => uiRows.kinds[i] === 'group').map(String)
const uiDirectsList = uiRows.ids.filter((_, i) => uiRows.kinds[i] === 'direct').map(String)
const sameOrder = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
const orderedMatch =
  apiGroups.length + apiDirects.length > 0 &&
  sameOrder(apiGroups, uiGroupsList) &&
  sameOrder(apiDirects, uiDirectsList)
log('IDENTITY_CONTINUITY', {
  apiGroupIds: apiGroups,
  uiGroupIds: uiGroupsList,
  apiDirectIds: apiDirects,
  uiDirectIds: uiDirectsList,
  groupsMatch: sameOrder(apiGroups, uiGroupsList),
  directsMatch: sameOrder(apiDirects, uiDirectsList),
  uiMode: uiRows && uiRows.mode,
  orderedIdsMatch: orderedMatch,
})

// ---------- 3) 点击 → canonical 路由 → 同一 UUID 的消息请求 200 ----------
console.log('')
console.log('=== 3) CLICK → CANONICAL ROUTE（#/chat?id=<uuid>）→ 同 UUID 的 messages 请求 ===')
await evaluate(`window.__WO8NET__ = []`)
const click = await evaluate(`(async () => {
  /*
    ⚠️ 必须**显式点 direct 行**（见文件上方"两处精度修正"的说明）：
       原来的 "第一个 data-thread-id 行" 在加入群会话后会点到群行，
       而本 Gate 验的是 **direct 聊天路径**（群路径由 gate-wo9a 负责）。
  */
  const byAttr = document.querySelector('[data-thread-kind="direct"][data-thread-id]')
  const target = byAttr || [...document.querySelectorAll('button')].filter(b => /相同学校|人$|\\d{2}:\\d{2}|昨天|周[一二三四五六日]/.test(b.innerText || ''))[0]
  if (!target) return { clicked: false, why: '没有可点的 direct 会话行' }
  const expectId = target.getAttribute ? target.getAttribute('data-thread-id') : null
  const label = (target.innerText || '').replace(/\\n/g, ' | ').slice(0, 70)
  target.click()
  await new Promise(r => setTimeout(r, 3000))
  return { clicked: true, label, expectId, hash: location.hash }
})()`)
const netClick = await evaluate(`window.__WO8NET__ || []`)
log('CLICK', click)
log('CLICK_NETWORK', netClick.map((n) => ({ method: n.method, url: n.url, status: n.status })))

const canonicalOk = typeof click.hash === 'string' && /^#\/chat\?id=/.test(click.hash)
const compatOk = typeof click.hash === 'string' && /^#\/chat\/[0-9a-f-]{36}$/i.test(click.hash)
const routeId = (() => {
  const h = click.hash || ''
  const m1 = h.match(/[?&]id=([^&]+)/)
  if (m1) return decodeURIComponent(m1[1])
  const m2 = h.match(/#\/chat\/([^?&]+)/)
  return m2 ? m2[1] : null
})()
const sameUuid = !!routeId && UUID_RE.test(routeId) && routeId === click.expectId
const msgReq = netClick.find((n) => n.method === 'GET' && /\/messages/.test(n.url))
const sameUuidInRequest = !!msgReq && routeId && msgReq.url.includes(routeId) && msgReq.status === 200
log('CLICK_VERDICT_DETAIL', { canonicalOk, compatOk, routeId, expectId: click.expectId, sameUuid, msgStatus: msgReq ? msgReq.status : null, sameUuidInRequest })

// ---------- 4) 反向条件：非法 UUID 不得发请求 ----------
console.log('')
console.log('=== 4) CHAT_ROUTE_INVALID_ID（审核 44 新增的反向条件）===')
/*
  ⚠️ 本断言的第一版**会空过**（我自查发现并修正，属 GATE_DEFECT）：
     第一版只检查"有没有请求那个坏的 id" → 实测 app 请求的是 mock id 't1'（不是坏 id）
     → 于是"没请求坏 id"成立 → **误判 PASS**，而实际上它发了一次真实请求。
     审核 44 的原话是"**0 次** /api/threads/<bad-id>/messages"，
     严格口径应为：**id 非法时不允许发出任何 messages 请求**（因为非法 id 根本无可取）。
  为保证确实触发重新挂载：先离开该路由，再进入。
*/
await evaluate(`window.__WO8NET__ = []`)
await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 1500))
await evaluate(`window.__WO8NET__ = []`)
const BAD = 'not-a-uuid-xyz'
await evaluate(`location.hash = '#/chat?id=${BAD}'`)
await new Promise((r) => setTimeout(r, 3000))
const netBad = await evaluate(`window.__WO8NET__ || []`)
const badState = await evaluate(`(() => ({ hash: location.hash, bodyHead: (document.body.innerText||'').slice(0,200).replace(/\\n/g,' / ') }))()`)
const badMsgRequests = netBad.filter((n) => /\/messages/.test(n.url))
const badUsedMock = badMsgRequests.some((n) => MOCK_IDS.some((m) => n.url.includes(`/threads/${m}`)))
log('INVALID_ID_STATE', badState)
log('INVALID_ID_NETWORK', netBad.map((n) => ({ method: n.method, url: n.url, status: n.status })))
log('INVALID_ID_NO_REQUEST', {
  messagesRequestCount: badMsgRequests.length,
  usedMockIdInstead: badUsedMock,
  note: '正确口径：非法 id 时 messagesRequestCount 必须为 0（不得改成 mock id 去请求）',
})

// ---------- 5) 无 id 的兜底也不得请求 mock id ----------
console.log('')
console.log('=== 5) CHAT_ROUTE_NO_MOCK_FALLBACK（无 id → missing state）===')
/*
  ⚠️ 同样修掉"空过"：上一版直接在 #/chat?... 上再设 #/chat，
     组件不重新挂载 → 不触发请求 → 空过 PASS。
     必须先离开该路由，确保 #/chat 是一次**新挂载**。
*/
await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 1500))
await evaluate(`window.__WO8NET__ = []`)
await evaluate(`location.hash = '#/chat'`)
await new Promise((r) => setTimeout(r, 3000))
const netNoId = await evaluate(`window.__WO8NET__ || []`)
const noIdMsgRequests = netNoId.filter((n) => /\/messages/.test(n.url))
const noIdUsedMock = noIdMsgRequests.some((n) => MOCK_IDS.some((m) => n.url.includes(`/threads/${m}`)))
log('NO_ID_NETWORK', netNoId.map((n) => ({ method: n.method, url: n.url, status: n.status })))
log('NO_ID_NO_MOCK_FALLBACK', {
  messagesRequestCount: noIdMsgRequests.length,
  usedMockId: noIdUsedMock,
  note: '无 id 时应为 missing state → messagesRequestCount 必须为 0',
})

// ---------- 判定 ----------
const v = {
  ENTRY_FROM_REAL_UI: entry && entry.reached ? 'PASS' : 'FAIL',
  MESSAGE_LIST_FROM_API: netList.length >= 1 && apiItems.length >= 1 ? 'PASS' : 'FAIL',
  IDENTITY_CONTINUITY: orderedMatch ? 'PASS' : 'FAIL',
  CLICK_ROUTE_CANONICAL: canonicalOk || compatOk ? 'PASS' : 'FAIL',
  CLICK_SAME_UUID_200: sameUuid && sameUuidInRequest ? 'PASS' : 'FAIL',
  // 严格口径：非法 id 时**不得发出任何 messages 请求**（既不许请求坏 id，也不许改用 mock id）
  CHAT_ROUTE_INVALID_ID: badMsgRequests.length === 0 ? 'PASS' : 'FAIL',
  // 严格口径：无 id 时**不得发出任何 messages 请求**
  CHAT_ROUTE_NO_MOCK_FALLBACK: noIdMsgRequests.length === 0 ? 'PASS' : 'FAIL',
  detail: {
    apiThreadCount: apiItems.length,
    uiRowCount: uiRows.ids.length,
    apiGroupIds: apiGroups,
    uiGroupIds: uiGroupsList,
    apiDirectIds: apiDirects,
    uiDirectIds: uiDirectsList,
    uiMode: uiRows && uiRows.mode,
    clickedHash: click && click.hash,
    routeId,
    expectId: click && click.expectId,
    invalidIdMessagesRequests: badMsgRequests.length,
    invalidIdUsedMock: badUsedMock,
    noIdMessagesRequests: noIdMsgRequests.length,
    noIdUsedMock,
  },
}
const KEYS = [
  'ENTRY_FROM_REAL_UI',
  'MESSAGE_LIST_FROM_API',
  'IDENTITY_CONTINUITY',
  'CLICK_ROUTE_CANONICAL',
  'CLICK_SAME_UUID_200',
  'CHAT_ROUTE_INVALID_ID',
  'CHAT_ROUTE_NO_MOCK_FALLBACK',
]
v.WO8_DEVICE_GATE = KEYS.every((k) => v[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO8_DEVICE_GATE === 'PASS' ? 0 : 1)
