/**
 * WO#9B 层 A 设备侧 Gate：AT 面板 / mention selection UI
 *
 * ## 为什么现在就跑（改前）
 *   审核 43 冻结的纪律：
 *     PREFERRED: pre-fix FAIL → fix → PASS（同时证明 Gate 能捕获**真实历史 defect**）
 *     REQUIRED : controlled sensitivity test
 *   当前**没有任何 AT 面板** —— 这是拿到"改前 FAIL"的**唯一时机**。
 *
 * ## 两层分离（审核记录 47 要求）
 *   本脚本只覆盖 **层 A：AT_PANEL / mention selection UI**。
 *   层 B（mentions_all 持久化与消息语义）由服务器侧脚本单独断言 ——
 *   **两层的状态键互不掩盖**（UI 层 P 不等于权限/语义 conformance）。
 *
 * ## ENTRY REACHABILITY
 *   不设 hash 进群聊 —— 必须从「消息」列表的**真实入口**走到群聊页，再打开 AT 面板。
 *
 * ## 断言
 *   AT_PANEL_ENTRY_REACHABLE      真实入口可达面板
 *   AT_PANEL_KIND                 是**底部弹层**（按 dump 的 constraintBottom_to_BottomOf=parent）
 *   AT_PANEL_TITLE                标题逐字 == "选择提醒的人"
 *   AT_PANEL_CLOSE_CONTROL        存在 accessible name 为「关闭」的控件
 *   AT_ALL_ITEM_PRESENT           面板中存在「所有人」项
 *   AT_ALL_ITEM_GEOMETRY          行高/图标/字号与声明值一致（设备实测，**单位冻结 CSS px**）
 *   AT_PANEL_EMPTY_STATE          空群显示"暂无群成员"（**client code-path PASS**：网络 stub）
 *   AT_PANEL_NO_INVENTED_GROUPING **反向断言**：不得渲染无依据的分组标题
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo9b-layerA-gate.json'
const GROUP_ID = 'aaaaaaaa-0001-4001-8001-00000000000a'

/* 原版声明值（来自 res/KW.xml / res/XZ.xml，经 dp→CSS px 换算：本设备 dp 与 CSS px 同值） */
const EXPECT = {
  title: '选择提醒的人',
  atAllLabel: '所有人',
  atAllRowHeightCss: 88,
  atAllIconCss: 56,
  atAllLabelFontCss: 16,
  atAllIconGapCss: 12,
}

const report = { startedAt: new Date().toISOString(), expect: EXPECT, steps: [] }
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

/*
  ENTRY REACHABILITY：从**真实入口**走到群聊页
    顶栏「消息」图标（aria-label="消息"）→ 列表 → 点「群」行（data-thread-kind="group"）
  ⚠️ 不设 hash；且按审核 47 的测试原则：**按稳定业务语义选择**（data-thread-kind），
     不按"第一行"。
*/
console.log('=== 1) ENTRY REACHABILITY：真实入口 → 群聊页 ===')
/*
  ⚠️ 两点实现注意（我第一版就是在这里错的，记录下来避免再犯）：
   ① **点击与取结果必须分成两次 evaluate**：点群行会触发路由切换 →
      Runtime.evaluate 的执行上下文被销毁，同一个 evaluate 里 await 之后的代码
      会以 "Uncaught" 失败（我第一版就得到 {"ERROR":"Uncaught"}）。
      正确做法：一次调用只做"点"，另一次调用（等页面稳定后）取结果。
   ② 断言要在**语义目标**上做（data-thread-kind="group"），不是"第一行"（审核 47 的原则）。
*/
await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2500))
const entered = await evaluate(`(() => {
  const msgBtn = document.querySelector('button[aria-label="消息"]')
  if (!msgBtn) return { ok: false, why: '顶栏没有「消息」入口' }
  msgBtn.click()
  return { ok: true, step: 'clicked message entry' }
})()`)
await new Promise((r) => setTimeout(r, 2200))
const groupHit = await evaluate(`(() => {
  const groupRow = document.querySelector('[data-thread-kind="group"][data-thread-id]')
  if (!groupRow) return { ok: false, why: '消息列表里没有群行（data-thread-kind=group）', hash: location.hash }
  const gid = groupRow.getAttribute('data-thread-id')
  groupRow.click()
  return { ok: true, gid }
})()`)
await new Promise((r) => setTimeout(r, 2600))
const entry = await evaluate(`(() => ({ hash: location.hash, isGroupRoute: /^#\\/group/.test(location.hash) }))()`)
/*
  ⚠️ 命名冲突（我第一版就是在这里错的）：
    我先把"是否到达群聊页"算出来存进 `entry`，随后又把 `entry` **重新赋值**成
    第三次 evaluate 的结果（只有 {hash, isGroupRoute}）→ 断言里的 `entry.reached` 变成 undefined
    → **该断言改后也永远不会 PASS**（断言本身坏了，而不是产品坏了）。
  修正：用**独立且不可复用**的变量名保存这个结论（entryReachedIfAny），
    并让所有断言只读它。
*/
const entryReachedIfAny = !!(entered && entered.ok && groupHit && groupHit.ok && entry && entry.isGroupRoute)
log('ENTRY_TO_GROUP', {
  entered,
  groupHit,
  entry,
  reached: entryReachedIfAny,
})

/*
  打开 AT 面板。
  ⚠️ **触发方式未取证**（AT_PANEL_TRIGGER: NOT_EVALUATED）—— 本脚本**不去猜**某个具体控件，
     而是按"我们实现的入口应当有稳定的无障碍名/语义"来探测。
     改前这里必然找不到任何入口 → 断言 FAIL（这正是要采集的改前证据）。
*/
console.log('')
console.log('=== 2) 打开 AT 面板（探测可达入口）===')
const open = await evaluate(`(async () => {
  const cands = [
    '[data-at-panel-entry]',
    'button[aria-label="提醒的人"]',
    'button[aria-label="@"]',
    'button[aria-label="提及"]',
    'button[aria-label="提醒"]',
  ]
  let el = null, used = null
  for (const s of cands) { const e = document.querySelector(s); if (e) { el = e; used = s; break } }
  if (!el) return { opened: false, why: '没有任何 AT 面板入口（改前预期如此）', triedSelectors: cands }
  el.click()
  await new Promise(r => setTimeout(r, 1200))
  return { opened: !!document.querySelector('[data-at-panel]'), used }
})()`)
log('OPEN_AT_PANEL', open)

console.log('')
console.log('=== 3) 面板结构与几何 ===')
const panel = await evaluate(`(() => {
  const p = document.querySelector('[data-at-panel]')
  const host = p || document.querySelector('[data-at-panel-host]')
  const dpr = window.devicePixelRatio
  const toCss = (r) => ({ w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10 })
  const out = { dpr, viewportCss: { w: window.innerWidth, h: window.innerHeight }, found: !!host }
  if (!host) return out
  const hr = host.getBoundingClientRect()
  out.hostBox = toCss(hr)
  /* 底部弹层判据：面板容器贴着视口底部（bottom ≈ 视口高），且未占满全屏高度 */
  out.isBottomSheet = Math.abs(hr.bottom - window.innerHeight) <= 2 && hr.height < window.innerHeight * 0.95
  const titleEl = host.querySelector('[data-at-panel-title]')
  out.title = titleEl ? titleEl.textContent : null
  out.titleStyle = titleEl ? { fontSize: getComputedStyle(titleEl).fontSize, fontWeight: getComputedStyle(titleEl).fontWeight, textAlign: getComputedStyle(titleEl).textAlign } : null
  out.hasCloseControl = !!(host.querySelector('[data-at-panel-close]') || host.querySelector('button[aria-label="关闭"]'))
  const atAll = host.querySelector('[data-at-all-item]')
  out.hasAtAll = !!atAll
  if (atAll) {
    const ar = atAll.getBoundingClientRect()
    out.atAllBox = toCss(ar)
    out.atAllText = atAll.textContent
    const icon = atAll.querySelector('[data-at-all-icon]')
    const label = atAll.querySelector('[data-at-all-label]')
    if (icon) {
      const ir = icon.getBoundingClientRect()
      out.atAllIconCss = { w: Math.round(ir.width * 10) / 10, h: Math.round(ir.height * 10) / 10 }
    }
    if (label) {
      out.atAllLabelFontCss = getComputedStyle(label).fontSize
      const lr = label.getBoundingClientRect()
      if (icon) out.atAllIconGapCss = Math.round((lr.left - icon.getBoundingClientRect().right) * 10) / 10
    }
  }
  out.sectionHeaderCount = host.querySelectorAll('[data-at-section-header]').length
  out.itemCount = host.querySelectorAll('[data-at-panel-item]').length
  /* 成员行的**业务身份**（blocker ① 需要）：按稳定语义属性取，不按"第几行"（审核 47 原则） */
  out.memberIds = [...host.querySelectorAll('[data-member-id]')].map((e) => e.getAttribute('data-member-id'))
  out.memberNames = [...host.querySelectorAll('[data-member-id]')].map((e) => (e.textContent || '').trim().slice(0, 24))
  return out
})()`)
log('AT_PANEL', panel)

// ---------- BLOCKER ①：成员来源权威性（审核 48）----------
console.log('')
console.log('=== 4) AT_MEMBER_SOURCE_AUTHORITY（blocker ①）===')
/*
  权威来源 = **服务端** GET /api/threads/:id 的 members[]。
  ⚠️ 必须用**绝对 origin**（相对路径在 WebView 里会打到 Capacitor 本地服务器，
      返回 HTML 200 —— 本项目已踩两次；run-device-gate.sh 的 4/7 步已把它做成机械前置）。
  ⚠️ 面板一侧只读 DOM 的 `data-member-id`，**不**从 seed / 消息 sender / mock 反推成员。
*/
const memberSource = await evaluate(`(async () => {
  const raw = localStorage.getItem('campus.demo.session.v1') || ''
  let tok = null
  try { tok = JSON.parse(raw).token || null } catch {}
  if (!tok) return { ok: false, why: 'no token in localStorage' }
  const res = await fetch('https://8.148.156.146/api/threads/${GROUP_ID}', { headers: { authorization: 'Bearer ' + tok } })
  const ct = res.headers.get('content-type') || ''
  let body = null
  try { body = await res.json() } catch (e) { body = null }
  return {
    ok: res.ok,
    status: res.status,
    contentType: ct,
    /* 契约（§二）：members: [{id, displayName}]。改前该字段不存在 → 这里就是 undefined */
    members: body && Array.isArray(body.members) ? body.members : null,
    hasMembersField: !!(body && Array.isArray(body.members)),
    memberCount: body && body.memberCount,
    kind: body && body.kind,
    title: body && body.title,
  }
})()`)
console.log('  MEMBER_SOURCE_PROBE =', JSON.stringify(memberSource))
const apiMemberIds = Array.isArray(memberSource && memberSource.members)
  ? memberSource.members.map((m) => String(m.id))
  : []
const panelMemberIds = panel && panel.memberIds ? panel.memberIds.map(String) : []
const setEq = (a, b) => {
  const x = a.slice().sort()
  const y = b.slice().sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}
const memberSourceOk = apiMemberIds.length > 0 && setEq(apiMemberIds, panelMemberIds)
log('AT_MEMBER_SOURCE_AUTHORITY_DETAIL', {
  apiStatus: memberSource && memberSource.status,
  apiContentType: memberSource && memberSource.contentType,
  hasMembersField: memberSource && memberSource.hasMembersField,
  apiMemberIds,
  panelMemberIds,
  note:
    '权威来源 = 服务端 members[]（契约 §二）。改前该字段不存在 → apiMemberIds 为空 → 必然 FAIL' +
    '（这是**真实检查**，不是恒失败的占位；契约落地后它能真的 PASS）。',
})

// ---------- 层 A 判定（改前应全 FAIL）----------
const num = (s) => (typeof s === 'string' ? Number.parseFloat(s) : NaN)
const titleOk = panel && panel.title && panel.title.trim() === EXPECT.title
const geomOk =
  panel &&
  panel.atAllBox &&
  Math.abs(panel.atAllBox.h - EXPECT.atAllRowHeightCss) <= 2 &&
  panel.atAllIconCss &&
  Math.abs(panel.atAllIconCss.w - EXPECT.atAllIconCss) <= 2 &&
  Math.abs(panel.atAllIconCss.h - EXPECT.atAllIconCss) <= 2 &&
  Math.abs(num(panel.atAllLabelFontCss) - EXPECT.atAllLabelFontCss) <= 1 &&
  (panel.atAllIconGapCss === undefined || Math.abs(panel.atAllIconGapCss - EXPECT.atAllIconGapCss) <= 2)

const v = {
  AT_PANEL_ENTRY_REACHABLE: entryReachedIfAny && open && open.opened ? 'PASS' : 'FAIL',
  AT_PANEL_KIND: panel && panel.isBottomSheet ? 'PASS' : 'FAIL',
  AT_PANEL_TITLE: titleOk ? 'PASS' : 'FAIL',
  AT_PANEL_CLOSE_CONTROL: panel && panel.hasCloseControl ? 'PASS' : 'FAIL',
  AT_ALL_ITEM_PRESENT: panel && panel.hasAtAll ? 'PASS' : 'FAIL',
  AT_ALL_ITEM_GEOMETRY: geomOk ? 'PASS' : 'FAIL',
  /*
    ⚠️ 这条断言的口径必须写清楚（我第一版写成恒 FAIL，属于"因为错误的原因失败"）：
      它检验的是"**面板里**不得出现无依据的分组标题"。
      面板**根本不存在**时，这个属性**无从判断** → 记 NOT_EVALUATED，
      由 AT_PANEL_ENTRY_REACHABLE / AT_ALL_ITEM_PRESENT 等去承担"面板不存在"这件事。
      否则会出现两种坏情况：
        · 改前：它以一个"面板没渲染"的无关原因 FAIL（噪声）；
        · 改后：若面板渲染失败但仍判 PASS，就变成**空过**（更危险）。
      因此：只有当 panel.found === true 时才判定，否则 NOT_EVALUATED。
  */
  AT_PANEL_NO_INVENTED_GROUPING:
    panel && panel.found ? (panel.sectionHeaderCount === 0 ? 'PASS' : 'FAIL') : 'NOT_EVALUATED',
  /*
    键名与口径按审核记录 48 冻结的最终清单：
      · 空态/失败态都标 **_CODEPATH** —— 它们由**受控 stub** 验证，
        **不得**被写成"真实服务器故障/空账号 E2E"（当前种子群非空，也不为此再造空账号）。
      · AT_MEMBER_SOURCE_AUTHORITY 与 AT_ALL_SELECTION_* 是审核 48 的**两个 blocker**，
        未实现时必须是 FAIL（不能因为"面板不存在"就 NOT_EVALUATED ——
        它们本身就是 blocker 要证明的东西）。
  */
  AT_PANEL_EMPTY_STATE_CODEPATH: 'NOT_EVALUATED', // 需受控 stub；与面板存在与否无关，故单独实现后再判
  AT_PANEL_FAILURE_STATE_CODEPATH: 'NOT_EVALUATED',
  /*
    ★ BLOCKER ①（审核 48）：面板成员必须来自**权威来源**。
    判据：面板里每个成员行的 data-member-id 集合 == **同一次** GET /api/threads/:id 的 members[].id 集合
          （不漏、不多、**不得有 mock identity**）
    ⚠️ 我第一版这里写成 `panel && panel.found ? 'FAIL' : 'FAIL'` —— 一个**恒 FAIL 的同义反复**，
       它看起来"改前 FAIL 正确"，但**改后也永远不会 PASS**，属于坏断言（与我在层 A 修过的命名冲突同类）。
       现在改成真正的集合比对：面板不存在 → memberSource 为空 → 必然 FAIL（正确的改前结果）；
       面板存在后就是真实的 authority 检查。
  */
  AT_MEMBER_SOURCE_AUTHORITY: memberSourceOk ? 'PASS' : 'FAIL',
  AT_ALL_SELECTION_VISIBLE: 'FAIL', // 未实现 → FAIL（blocker ②；实现后按可见标记判定）
  AT_ALL_SELECTION_STATE_MATCHES_PAYLOAD: 'FAIL', // 未实现 → FAIL（blocker ②）
  AT_PANEL_TRIGGER: 'OUR_DESIGN_CHOICE / ORIGINAL_NOT_EVALUATED',
  AT_TRIGGER_STATIC_TRACE: 'FOUND',
  AT_PANEL_GROUPING_RULE: 'NOT_EVALUATED',
  detail: {
    entryReached: entryReachedIfAny,
    panelOpened: !!(open && open.opened),
    panelFound: !!(panel && panel.found),
    panelTitle: panel ? panel.title : null,
    isBottomSheet: panel ? panel.isBottomSheet : null,
    hasAtAll: panel ? panel.hasAtAll : null,
    atAllBox: panel ? panel.atAllBox : null,
    atAllIconCss: panel ? panel.atAllIconCss : null,
    atAllLabelFontCss: panel ? panel.atAllLabelFontCss : null,
    atAllIconGapCss: panel ? panel.atAllIconGapCss : null,
    sectionHeaderCount: panel ? panel.sectionHeaderCount : null,
  },
}
const KEYS = [
  'AT_PANEL_ENTRY_REACHABLE',
  'AT_PANEL_KIND',
  'AT_PANEL_TITLE',
  'AT_PANEL_CLOSE_CONTROL',
  'AT_ALL_ITEM_PRESENT',
  'AT_ALL_ITEM_GEOMETRY',
]
/* 注意：AT_PANEL_NO_INVENTED_GROUPING 不在"必须 PASS"列表里 ——
   它在面板存在时才有意义（见上面注释），面板存在时若违规会单独报 FAIL 并在 detail 里可见。 */
v.WO9B_LAYER_A_GATE = KEYS.every((k) => v[k] === 'PASS') && v.AT_PANEL_NO_INVENTED_GROUPING !== 'FAIL' ? 'PASS' : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO9B_LAYER_A_GATE === 'PASS' ? 0 : 1)
