/**
 * WO#10 设备侧 Gate：MessageScreen 剩余 mock（「更多同学」推荐区 + 邀请分享面板）
 *
 * ## 为什么现在就跑（改前）
 *   审核 43 冻结的纪律：
 *     PREFERRED: pre-fix FAIL → fix → PASS
 *     REQUIRED : controlled sensitivity test
 *   当前「更多同学」仍渲染 9 个写死的 mock 用户、分享面板仍有 5 个假按钮 ——
 *   这是拿到"改前 FAIL"的**唯一时机**。
 *
 * ## 断言
 *   SUGGEST_NO_MOCK_ROWS            推荐区不渲染任何 mock 用户行
 *   SUGGEST_EMPTY_STATE_EXPLICIT    推荐区显示明确空态（不装作有内容）
 *   NO_FAKE_SHARE_TARGETS           邀请面板不再有"点了没反应"的分享目标
 *   NO_FAKE_SUCCESS_PATH            「添加」不再能进入"已申请"假成功状态
 *   反向断言（防悄悄回退）：
 *   NO_MOCK_USER_IDS_IN_DOM         DOM 里不得出现 mock 用户 id（u1..u11）
 *   NO_MOCK_USER_NAMES_IN_DOM       DOM 里不得出现 mock 专有昵称
 *   SESSION_NAME_CONSISTENCY        同一屏内 tab 栏与邀请卡对当前用户的显示名必须一致
 *
 * ## 证据强度标注
 *   「不含 mock 昵称」是**清单化**检查（词表来自 app/src/data/mock.ts 的写入值）。
 *   该词表是**我方 mock 的既有取值**，不是"原版契约" —— 它的作用是防止
 *   "把 mock 数据当真实数据展示"，而不是断言原版没有这些词。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo10-gate.json'

/**
 * mock 专有昵称（**逐行抄录自 app/src/data/mock.ts 的实际取值**，非推测）。
 *
 * ⚠️⚠️ 这里有一个**必须说清的设计判断**（我第一版就差点做错）：
 *   mock.ts 里 u2='anmoss'、u4='Lemy'、u5='Azur冰弦' —— 这三个**同时也是
 *   真实种子用户的 display_name**（见 DB: users 表三个账号）。
 *   如果把它们放进黑名单、并对**整页 DOM** 检查，就会在会话列表/群聊里
 *   把**合法的真实数据**误判成 mock（典型假阳性）。
 *   → 因此：
 *     ① 黑名单**只收 mock 专有**昵称（剔除那三个真实姓名）；
 *     ② 检查范围**限定在推荐区内**（[data-mock-region="suggestions"]），
 *        而不是整页 —— 因为"推荐区之外出现某昵称"本身不代表它是 mock。
 *   这也符合本项目的测量纪律：**先确定坐标框/语义框，再比较**。
 */
const MOCK_ONLY_NAMES = [
  '蒸柿煮捞呆', // u1
  '又又', // u6
  '辣椒面', // u7
  '苏苏', // u8
  'eveee', // u9
  '小支', // u10
  '禾桉涵', // u11
  '小熊汉堡', // u12（当前不在推荐数组里，一并登记以防将来加入）
  '自定义名称6', // me（mock 的"我"；WO#8 已改为真实 session 名）
]
/*
  ⚠️ 直接抄录**推荐数组的定义**（MessageScreen.tsx 行 66-76）：
     useState<User[]>([users.u5, u6, u7, u8, u9, u10, u11, u1, u2])  ← **硬编码 9 项**
  这是 WO#10 要消除的对象；上面的词表就是把它展开成名字（已逐个核对 mock.ts）。
*/
/** mock 用户 id 形态（mock.ts 用 'u1'…'u11'；真实后端只发 UUID，不会撞） */
const MOCK_ID_RE = /^u\d{1,2}$/

const report = { startedAt: new Date().toISOString(), mockOnlyNames: MOCK_ONLY_NAMES, steps: [] }
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

// ---------- 1) 从真实入口进「消息」页 ----------
console.log('=== 1) 真实入口进「消息」页（不设 hash）===')
await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2500))
const entered = await evaluate(`(() => {
  const b = document.querySelector('button[aria-label="消息"]')
  if (!b) return { ok: false, why: '顶栏没有「消息」入口' }
  b.click()
  return { ok: true }
})()`)
await new Promise((r) => setTimeout(r, 2500))
const onMessages = await evaluate(`(() => ({
  hash: location.hash,
  hasSuggest: !!document.querySelector('[data-mock-region="suggestions"]'),
  hasInviteBtn: !!document.querySelector('.invite__btn'),
}))()`)
log('ENTRY', { entered, onMessages })

// ---------- 2) 推荐区：mock 行 / 空态 ----------
console.log('')
console.log('=== 2) 「更多同学」推荐区 ===')
const suggest = await evaluate(`(() => {
  const sec = document.querySelector('[data-mock-region="suggestions"]')
  if (!sec) return { found: false }
  const text = sec.textContent || ''
  /* 逐行取：mock.ts 里每行是 avatar + 昵称 + 标签 + 添加/移除 */
  const rows = [...sec.querySelectorAll('*')].filter((e) => {
    const t = (e.textContent || '').trim()
    return e.children.length >= 2 && /添加|移除/.test(t) && t.length < 80
  })
  /* 更稳的做法：找所有带"添加"文案的按钮，取它们的祖先行 */
  const addBtns = [...sec.querySelectorAll('button')].filter((b) => /添加|移除/.test((b.textContent || '').trim()))
  const rowTexts = addBtns.map((b) => {
    let p = b.parentElement
    for (let i = 0; i < 4 && p; i++) {
      const t = (p.textContent || '').trim()
      if (t.length > (b.textContent || '').length + 2) return t.slice(0, 60)
      p = p.parentElement
    }
    return ''
  })
  return {
    found: true,
    hasEmptyNode: !!sec.querySelector('.suggest__empty'),
    emptyText: (sec.querySelector('.suggest__empty') || {}).textContent || null,
    addRemoveButtonCount: addBtns.length,
    rowTexts,
    sectionText: text.replace(/\\s+/g, ' ').trim().slice(0, 200),
  }
})()`)
log('SUGGEST_SECTION', suggest)

// ---------- 3) DOM 里的 mock 身份（反向断言） ----------
console.log('')
console.log('=== 3) 反向断言：推荐区里是否混入 mock 身份（**范围限定**，不是整页）===')
const mockIdentity = await evaluate(`(() => {
  const sec = document.querySelector('[data-mock-region="suggestions"]')
  if (!sec) return { found: false, hitNames: [], hitIds: [], note: '推荐区不存在（可能已被移除）' }
  /*
    ⚠️ 范围限定在推荐区内：推荐区**之外**出现某昵称不代表它是 mock ——
       例如 anmoss / Lemy / Azur冰弦 既是 mock 取值、也是真实用户显示名，
       在会话列表/群聊里合法出现。对整个 DOM 做昵称黑名单会产生假阳性。
  */
  const text = sec.innerText || sec.textContent || ''
  const names = ${JSON.stringify(MOCK_ONLY_NAMES)}
  const hitNames = names.filter((n) => text.includes(n))
  const attrs = []
  for (const el of sec.querySelectorAll('*')) {
    for (const a of ['data-user-id', 'data-id', 'data-suggest-user', 'data-thread-id']) {
      const v = el.getAttribute && el.getAttribute(a)
      if (v) attrs.push(v)
    }
  }
  const hitIds = [...new Set(attrs.filter((v) => /^u\\d{1,2}$/.test(String(v).trim())))]
  return { found: true, hitNames, hitIds, attrsSample: attrs.slice(0, 10) }
})()`)
log('MOCK_IDENTITY_IN_SUGGEST', mockIdentity)

// ---------- 4) 分享面板的假目标 ----------
console.log('')
console.log('=== 4) 邀请分享面板 ===')
const share = await evaluate(`(async () => {
  const btn = document.querySelector('.invite__btn')
  if (!btn) return { opened: false, why: 'no invite button' }
  btn.click()
  await new Promise(r => setTimeout(r, 900))
  const sheet = document.querySelector('.dialog__sheet')
  if (!sheet) return { opened: false, why: 'no sheet' }
  const targets = [...sheet.querySelectorAll('.dialog__target')].map((t) => (t.textContent || '').trim())
  return { opened: true, targets, targetCount: targets.length }
})()`)
log('SHARE_SHEET', share)
// 关掉面板（避免影响后续）
await evaluate(`(() => {
  const m = document.querySelector('.dialog__mask')
  if (m) m.click()
  return true
})()`)
await new Promise((r) => setTimeout(r, 600))

// ---------- 5) 「添加」假成功路径 ----------
console.log('')
console.log('=== 5) 「添加」是否产生假成功状态 ===')
const fakeSuccess = await evaluate(`(async () => {
  const sec = document.querySelector('[data-mock-region="suggestions"]')
  if (!sec) return { found: false }
  const addBtn = [...sec.querySelectorAll('button')].find((b) => (b.textContent || '').includes('添加'))
  if (!addBtn) return { found: true, hasAddButton: false }
  addBtn.click()
  await new Promise(r => setTimeout(r, 800))
  const dlg = document.querySelector('.dialog__title')
  const dlgText = dlg ? (dlg.textContent || '') : null
  /* 「发送」按钮：点了之后是否出现"已申请"这类状态而没有真实请求 */
  const sendBtn = [...document.querySelectorAll('.dialog__btn--primary')][0]
  let afterSend = null
  if (sendBtn) {
    /* 观察是否发出任何网络请求：挂一个计数器 */
    if (!window.__WO10NET__) {
      window.__WO10NET__ = 0
      const orig = window.fetch
      window.fetch = async (...a) => { window.__WO10NET__++; return orig(...a) }
    }
    const before = window.__WO10NET__
    sendBtn.click()
    await new Promise(r => setTimeout(r, 1200))
    afterSend = { fetchCountDelta: window.__WO10NET__ - before }
  }
  const body = document.body.innerText || ''
  return {
    found: true,
    hasAddButton: true,
    dialogOpened: !!dlg,
    dialogTitle: dlgText,
    afterSend,
    showsAppliedState: /已申请|已发送|申请成功/.test(body),
  }
})()`)
log('FAKE_SUCCESS_CHECK', fakeSuccess)

// ---------- 6) 会话名一致性 ----------
console.log('')
console.log('=== 6) SESSION_NAME_CONSISTENCY（tab 栏 vs 邀请卡）===')
const nameConsistency = await evaluate(`(() => {
  const card = document.querySelector('[data-me-name]')
  const cardName = card ? (card.textContent || '').trim() : null
  const raw = localStorage.getItem('campus.demo.session.v1') || ''
  let sessName = null
  try { sessName = JSON.parse(raw).user?.displayName || null } catch {}
  return { cardName, sessName, match: !!(cardName && sessName && cardName === sessName) }
})()`)
log('SESSION_NAME_CONSISTENCY', nameConsistency)

// ---------- 判定 ----------
const verdict = {
  SUGGEST_NO_MOCK_ROWS: suggest && suggest.found && suggest.addRemoveButtonCount === 0 ? 'PASS' : 'FAIL',
  SUGGEST_EMPTY_STATE_EXPLICIT:
    suggest && suggest.found && suggest.addRemoveButtonCount === 0 && suggest.hasEmptyNode ? 'PASS' : 'FAIL',
  NO_FAKE_SHARE_TARGETS: share && share.opened === false ? 'PASS' : share && share.targetCount === 0 ? 'PASS' : 'FAIL',
  NO_FAKE_SUCCESS_PATH: fakeSuccess && fakeSuccess.hasAddButton === false ? 'PASS' : 'FAIL',
  NO_MOCK_USER_IDS_IN_DOM: mockIdentity && mockIdentity.hitIds && mockIdentity.hitIds.length === 0 ? 'PASS' : 'FAIL',
  /*
    名字级检查才是当前**有约束力**的那条（改前实测命中 5 个 mock 专有昵称 → FAIL）。
    ⚠️ 如实标注一个弱点：`NO_MOCK_USER_IDS_IN_DOM` 在当前 DOM 下是**空过**的 ——
       推荐行**不带任何 id 属性**（实测 attrsSample=[]），所以它必然 PASS。
       保留它的理由是防**将来**的回归（有人给 mock 行加 data-suggest-user="u5"），
       而不是声称它现在证明了什么。这符合本项目"不作废断言、但如实标注其当前判别力"的做法。
  */
  NO_MOCK_USER_NAMES_IN_DOM:
    mockIdentity && mockIdentity.hitNames && mockIdentity.hitNames.length === 0 ? 'PASS' : 'FAIL',
  SESSION_NAME_CONSISTENCY: nameConsistency && nameConsistency.match ? 'PASS' : 'FAIL',
  detail: { suggest, share, fakeSuccess, mockIdentity, nameConsistency },
  notes: {
    NO_MOCK_USER_IDS_IN_DOM: '当前空过（推荐行无 id 属性）；保留以捕捉未来回归',
    NO_MOCK_USER_NAMES_IN_DOM: '当前有约束力（改前实测命中 mock 专有昵称）',
    range: 'mock 身份检查范围限定在 [data-mock-region="suggestions"] 内，不是整页',
  },
}
const KEYS = [
  'SUGGEST_NO_MOCK_ROWS',
  'SUGGEST_EMPTY_STATE_EXPLICIT',
  'NO_FAKE_SHARE_TARGETS',
  'NO_FAKE_SUCCESS_PATH',
  'NO_MOCK_USER_IDS_IN_DOM',
  'NO_MOCK_USER_NAMES_IN_DOM',
  'SESSION_NAME_CONSISTENCY',
]
verdict.WO10_GATE = KEYS.every((k) => verdict[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', verdict)
ws.close()
process.exit(verdict.WO10_GATE === 'PASS' ? 0 : 1)
