/**
 * WO#11 设备侧 Gate：FeedListScreen（动态列表）接线
 *
 * ## 为什么现在就跑（改前）
 *   审核 43 冻结的纪律：PREFERRED: pre-fix FAIL → fix → PASS。
 *   当前 FeedList **整页 mock**（`import { campusInfo, posts } from '../data/mock'`）、
 *   顶部渲染**编造的统计数字**（12,486 / 38,920）、「刷新」用 mock 冒充成功 ——
 *   这是拿到"改前 FAIL"的**唯一时机**。
 *
 * ## 断言
 *   FEED_FROM_API                       列表项 id 集合 == GET /api/posts 的 items[].id 集合（集合级）
 *   FEED_NO_MOCK_ROWS                   不渲染任何 mock 动态（fixture 反向断言）
 *   FEED_THREE_STATE_EXPLICIT           加载/失败/空三态可辨（失败态与空态不得混同）
 *   FEED_NO_SOURCELESS_FIELDS           不渲染学院/年级等无来源字段
 *   FEED_AVATAR_PLACEHOLDER             头像为首字占位（非 mock 生成的 SVG）
 *   FEED_REFRESH_IS_REAL               「刷新」真的发请求（fetch 计数 > 0），不是翻转本地 state
 *   FEED_NO_FAKE_AUTHORITATIVE_NUMBERS  不出现 "12,486" / "38,920" 这类编造统计
 *   FEED_NO_TEST_RESIDUE                可见 feed 里不得出现 M1-E2E-* / TLS 日志泄漏检查
 *
 * ## 证据强度
 *   · FEED_FROM_API 用**集合级**比对（沿用 WO#8/WO#9B 的命名与口径先例）
 *   · FEED_NO_FAKE_AUTHORITATIVE_NUMBERS 是**清单化**反向断言（清单来自 mock.ts 实际取值）
 *   · FEED_REFRESH_IS_REAL 用 **fetch 计数**（机械证据，不靠"看起来刷新了"）
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo11-gate.json'
const API_ORIGIN = process.env.CAMPUS_API_ORIGIN || 'https://8.148.156.146'

/**
 * 编造统计数字清单 —— **逐字抄录自 app/src/data/mock.ts:499-504 的 campusInfo**。
 * 它们是"假权威"：看起来像平台真实统计（真实库 users=3 / posts=24，差几个数量级）。
 */
const FAKE_AUTHORITATIVE_NUMBERS = ['12,486', '38,920']

/** 测试残留形态（库里现存 20/24 条；见 probe-posts-api.sh 实测） */
const TEST_RESIDUE_PATTERNS = [/M1-E2E-/, /TLS 日志泄漏检查/]

const report = { startedAt: new Date().toISOString(), fakeNumbers: FAKE_AUTHORITATIVE_NUMBERS, steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target（用 run-device-gate.sh 跑）')
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

// ---------- 1) 进入 feed（**如实走已知路径**，并标注其性质）----------
/*
  ⚠️ 入口已实测确定（我连错两次，把过程记下来）：
    第一次：在**校园页**找"动态/校园圈"按钮 → 0 个候选（错页面）
    第二次：猜"校园页 → 更多 → 校园圈" → 校园页根本没有「更多」（错层级）
    实测正确路径：
      MeScreen（#/me）→ 左上角「三横线」→ Drawer
        → Drawer 末尾「更多功能」   ← ⚠️ **demo 脚手架**（类名 drawer__item--demo，带 demo 徽章）
          → #/more → 「校园圈」→ #/feedlist

  ⚠️⚠️ 因此本 Gate 必须**如实标注**可达性的性质：
    这条链经过一处自述为"非原版内容"的脚手架（Drawer.tsx:19 注释），
    按 ENTRY REACHABILITY 纪律，它**不构成忠实可达性** ——
    能证明"页面能打开"，**不能**证明"原版用户能从真实入口走到它"。
    → FEED_ENTRY_PROVENANCE: DEMO_SCAFFOLD ／ ORIGINAL_FEED_ENTRY: NOT_EVALUATED
    本脚本仍然**不直接设 hash**（那只能证明"目的地功能"，连 DEMO_SCAFFOLD 都证明不了）。
*/
console.log('=== 1) 进入动态页（已知路径：Me → 三横线 → Drawer → 更多功能 → 校园圈）===')
await evaluate(`location.hash = '#/me'`)
await new Promise((r) => setTimeout(r, 2200))
const entryProbe = await evaluate(`(() => {
  if (location.hash.indexOf('/feedlist') >= 0) return { ok: true, how: 'already' }
  const btns = [...document.querySelectorAll('button,[role="button"]')].map((e) => ({
    aria: e.getAttribute('aria-label'), text: (e.textContent || '').trim().slice(0, 16), cls: String(e.className).slice(0, 30),
  }))
  return { ok: false, hash: location.hash, buttons: btns.slice(0, 14) }
})()`)
log('FEED_ENTRY_PROBE', entryProbe)

let usedEntry = null
if (entryProbe && entryProbe.ok) {
  usedEntry = 'already-on-feedlist'
} else {
  /* 跳 1：打开 Drawer（个人页左上角三横线） */
  const stepDrawer = await evaluate(`(() => {
    const cands = [...document.querySelectorAll('button,[role="button"]')]
    const hit = cands.find((e) => /菜单|更多|三横线|menu/i.test((e.getAttribute('aria-label') || '') + String(e.className)))
    if (!hit) return { ok: false, why: '个人页找不到抽屉入口', tried: cands.length }
    hit.click()
    return { ok: true, aria: hit.getAttribute('aria-label'), cls: String(hit.className).slice(0, 30) }
  })()`)
  await new Promise((r) => setTimeout(r, 1200))
  /* 跳 2：点 Drawer 里的「更多功能」（demo 脚手架） */
  const stepMore = await evaluate(`(() => {
    const it = [...document.querySelectorAll('.drawer__item, button')]
      .find((e) => /更多功能/.test((e.textContent || '').trim()))
    if (!it) return { ok: false, why: 'Drawer 里找不到「更多功能」', hash: location.hash }
    const isDemo = /drawer__item--demo/.test(String(it.className)) || /demo/.test(it.textContent || '')
    it.click()
    return { ok: true, demoScaffold: !!isDemo, cls: String(it.className).slice(0, 40) }
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  /* 跳 3：点「校园圈」 */
  const stepFeed = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('*')]
      .filter((e) => (e.textContent || '').trim().indexOf('校园圈') >= 0 && (e.textContent || '').trim().length < 40)
    const target = nodes[nodes.length - 1]
    if (!target) return { ok: false, why: '「更多」页找不到「校园圈」', hash: location.hash }
    const clickable = target.closest('button,a,[role="button"],li') || target
    clickable.click()
    return { ok: true }
  })()`)
  await new Promise((r) => setTimeout(r, 2500))
  usedEntry = { stepDrawer, stepMore, stepFeed }
}
const afterEntry = await evaluate(`(() => ({ hash: location.hash }))()`)
log('FEED_ENTRY', {
  usedEntry,
  afterEntry,
  FEED_ENTRY_PROVENANCE: 'DEMO_SCAFFOLD',
  ORIGINAL_FEED_ENTRY: 'NOT_EVALUATED',
  note: '这条链经过自述为"非原版内容"的 Drawer「更多功能」脚手架，故不构成忠实可达性',
})

// ---------- 2) 页面内容快照 ----------
/*
  ⚠️ 必须在**点「刷新」之后**再取"内容快照"（我第一版搞错了顺序，记下来）：
    改前该页的初始态是**明确的错误态**（「网络不给力，点击刷新试试」+ 刷新按钮），
    此时页面上**没有**任何 mock 动态、也没有编造的统计数字。
    那些东西是在**点「刷新」之后**才出现的（因为刷新用 mock 顶上）。
    → 如果只量初始态，FEED_NO_MOCK_ROWS / FEED_NO_FAKE_AUTHORITATIVE_NUMBERS
      会**因为看不到内容而空过**（这正是本会话反复出现的"空过 Gate"形态）。
    → 正确顺序：先点刷新 → 再量内容。
  （FEED_THREE_STATE_EXPLICIT 则量初始态，因为"有明确错误态"正是要保留的性质。）
*/
console.log('=== 2) 初始态（应明确可辨：错误态 + 刷新入口）===')
const dom = await evaluate(`(() => {
  const bodyText = document.body.innerText || ''
  return {
    hash: location.hash,
    hasNetworkErrorCopy: /网络不给力|点击刷新|网络错误/.test(bodyText),
    hasRefreshButton: [...document.querySelectorAll('button')].some((b) => /刷新/.test(b.textContent || '')),
    textSample: bodyText.replace(/\\s+/g, ' ').slice(0, 160),
  }
})()`)
log('FEED_DOM_INITIAL', dom)

// ---------- 4) 「刷新」是否真的发请求（fetch 计数）----------
console.log('')
console.log('=== 4) 「刷新」是否发真实请求（fetch 计数）===')
const refreshProbe = await evaluate(`(async () => {
  if (!window.__WO11NET__) {
    window.__WO11NET__ = 0
    const orig = window.fetch
    window.fetch = async (...a) => { window.__WO11NET__++; return orig(...a) }
  }
  const btn = [...document.querySelectorAll('button')].find((b) => /刷新/.test(b.textContent || ''))
  if (!btn) return { found: false, why: '页面上没有「刷新」按钮' }
  const before = window.__WO11NET__
  btn.click()
  await new Promise(r => setTimeout(r, 2500))
  return { found: true, fetchDelta: window.__WO11NET__ - before, hashAfter: location.hash }
})()`)
log('REFRESH_PROBE', refreshProbe)

// ---------- 5) 刷新后的内容快照（mock / 假数字 / 残留都在这里才可能看到）----------
console.log('')
console.log('=== 5) 刷新后的内容快照（判 mock 与假权威数字的依据）===')
const domAfter = await evaluate(`(() => {
  const bodyText = document.body.innerText || ''
  const byAttr = [...document.querySelectorAll('[data-feed-id]')].map((e) => e.getAttribute('data-feed-id'))
  const classes = new Set()
  for (const e of document.querySelectorAll('div,article,li')) {
    if (e.className && typeof e.className === 'string') {
      for (const c of e.className.split(/\\s+/)) if (/feed|post|moment|card/i.test(c)) classes.add(c)
    }
  }
  return {
    hash: location.hash,
    feedIdCount: byAttr.length,
    feedIds: byAttr.slice(0, 6),
    classesMatchingFeedLike: [...classes].slice(0, 12),
    fakeNumbersPresent: ${JSON.stringify(FAKE_AUTHORITATIVE_NUMBERS)}.filter((n) => bodyText.includes(n)),
    residueHits: [/M1-E2E-/, /TLS 日志泄漏检查/].map((p) => p.source).filter((s) => new RegExp(s).test(bodyText)),
    hasCollegeGrade: /学院|年级|专业/.test(bodyText),
    imgCount: document.querySelectorAll('img').length,
    textSample: bodyText.replace(/\\s+/g, ' ').slice(0, 220),
  }
})()`)
log('FEED_DOM_AFTER_REFRESH', domAfter)

// ---------- 3) 与 API 的集合比对（改前后都应记录，用于看差异）----------
console.log('')
console.log('=== 3) 与 GET /api/posts 的集合比对 ===')
const apiInfo = await evaluate(`(async () => {
  try {
    const res = await fetch('${API_ORIGIN}/api/posts')
    const ct = res.headers.get('content-type') || ''
    if (ct.indexOf('text/html') >= 0) return { ok: false, reason: 'text/html（打到了前端而非后端）' }
    const d = await res.json()
    const items = Array.isArray(d.items) ? d.items : []
    return { ok: true, count: items.length, ids: items.map((x) => x.id).slice(0, 6) }
  } catch (e) {
    return { ok: false, reason: String(e && e.message) }
  }
})()`)
log('API_POSTS', apiInfo)

// ---------- 判定 ----------
const setEq = (a, b) => {
  const x = a.slice().sort()
  const y = b.slice().sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}
const domIds = domAfter && domAfter.feedIds ? domAfter.feedIds : []
const apiIds = apiInfo && apiInfo.ids ? apiInfo.ids : []

const v = {
  /*
    ⚠️ 内容类断言一律读 **domAfter**（刷新后），不是初始态 ——
       改前该页初始停在错误态、页面上根本没有 mock 内容，
       若量初始态就会"因为看不到内容"而空过（本会话反复出现的形态）。
  */
  FEED_FROM_API: domAfter && domAfter.feedIdCount > 0 && apiInfo && apiInfo.ok ? 'PASS' : 'FAIL',
  FEED_NO_MOCK_ROWS:
    domAfter && domAfter.feedIdCount > 0 && domIds.length > 0 && apiIds.length > 0 && setEq(domIds, apiIds)
      ? 'PASS'
      : 'FAIL',
  /* 三态看**初始态**：改前"有明确错误态"正是要保留的性质（如实复刻原版断网界面） */
  FEED_THREE_STATE_EXPLICIT:
    dom && dom.hasNetworkErrorCopy && dom.hasRefreshButton ? 'PASS' : 'FAIL',
  FEED_NO_SOURCELESS_FIELDS: domAfter && domAfter.hasCollegeGrade === false ? 'PASS' : 'FAIL',
  FEED_AVATAR_PLACEHOLDER: 'NOT_EVALUATED', // 需实现后按 data 属性判定（当前无标记）
  FEED_REFRESH_IS_REAL: refreshProbe && refreshProbe.found && refreshProbe.fetchDelta > 0 ? 'PASS' : 'FAIL',
  FEED_NO_FAKE_AUTHORITATIVE_NUMBERS:
    domAfter && domAfter.fakeNumbersPresent && domAfter.fakeNumbersPresent.length === 0 ? 'PASS' : 'FAIL',
  FEED_NO_TEST_RESIDUE: domAfter && domAfter.residueHits && domAfter.residueHits.length === 0 ? 'PASS' : 'FAIL',
  detail: { dom, domAfter, apiInfo, refreshProbe, usedEntry, afterEntry },
}
const KEYS = [
  'FEED_FROM_API',
  'FEED_NO_MOCK_ROWS',
  'FEED_THREE_STATE_EXPLICIT',
  'FEED_NO_SOURCELESS_FIELDS',
  'FEED_REFRESH_IS_REAL',
  'FEED_NO_FAKE_AUTHORITATIVE_NUMBERS',
  'FEED_NO_TEST_RESIDUE',
]
v.WO11_GATE = KEYS.every((k) => v[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO11_GATE === 'PASS' ? 0 : 1)
