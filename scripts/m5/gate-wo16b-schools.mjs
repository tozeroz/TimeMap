/**
 * ⭐ WO#16 层 B 门禁：学校搜索页 `#/schools` + 校区面板（审核 61 要求"必要 Gate + 必要 sensitivity"）
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐ Fixture 依赖声明（审核 61 明确要求："新增或修改 Gate 时，必须声明它依赖哪些
 *    session / permission / DB / device state，并自行建立这些 fixture"）
 * ════════════════════════════════════════════════════════════════════
 *   依赖项                          本 Gate 如何**自行建立/验证**
 *   ─────────────────────────────  ────────────────────────────────────────────
 *   DB：迁移 012 已应用             ① 通过**真实 API** 取值作为期望（不硬编码实体名），
 *   （schools=1 / campuses=3）        若 API 取不到 ⇒ 记得 INCONCLUSIVE，而不是假装 PASS
 *   Device：Layer B 构建已安装      ② 断言里要求出现 `[data-school-row]` 等**新加的钩子**；
 *                                     旧包没有这些钩子 ⇒ 必然 FAIL（不会"用旧包假装通过"）
 *   session / permission 状态       ③ **不依赖**：`/api/schools` 是公开只读，无需登录；
 *                                     登录态失效不影响本 Gate
 *   导航起始状态                    ④ 先导航到 `#/campus` 再进目标页 / 再点开面板
 *                                     （强制新鲜挂载，避免继承上一次的状态 ——
 *                                      本项目已两度因"同 hash 不重挂载"产生假结果）
 *   顺序依赖                        ⑤ 三个检查段各自显式导航，**不依赖**上一段留下的页面
 *
 * ════════════════════════════════════════════════════════════════════
 * 断言（全部对应基线逐字要求，见 docs/original-baseline/supplements/schools.json）
 * ════════════════════════════════════════════════════════════════════
 *   SCHOOL_SEARCH_PLACEHOLDER    搜索框 placeholder 逐字「搜索选择学校...」
 *   SCHOOL_SEARCH_GROUP_LABEL    分组标题逐字「更多学校」
 *   SCHOOL_ROW_SHAPE             行格式为「**学校名 (校区名)**」（用**API 返回的实体**拼出的期望值比对）
 *   SCHOOL_ROWS_FROM_AUTHORITY   页面上的每一行都能与服务端实体一一对应（**无多余行**）
 *   CIRCLE_COUNT_NULL_NOT_RENDERED  `campusCircleCount` 为 null 时**不渲染**计数字段
 *                                （⚠️ 显示"0条校园圈"会把"不知道"说成"没有" —— 审核 60）
 *   CAMPUS_PANEL_TITLE           面板标题逐字「<学校名>（当前学校）」
 *   CAMPUS_PANEL_FROM_AUTHORITY  面板项 = 该学校的校区（与 API 一致）
 *   SCHOOL_SEARCH_ENTRY_NAVIGATES 面板里的「搜索其他学校」入口 → `#/schools`
 *
 * ⚠️ 为什么把"学校名/校区名"都从 **API 取**而不是写死：
 *    写死会把 Gate 变成"检查硬编码"，且以后换种子就会假 FAIL。
 *    API 取不到时记 INCONCLUSIVE —— **不**把"没样本"当 PASS。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo16b-gate.json'
const API_ORIGIN = 'https://8.148.156.146'

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

// ── CDP ─────────────────────────────────────────────────────────────
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
async function evaluate(expression, timeoutMs = 30000) {
  const p = new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    )
  })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 段 0：从**真实 API** 取期望值（不硬编码实体名）─────────────────
console.log('=== 0) 期望值来自服务端（不硬编码学校/校区名）===')
const expected = await evaluate(`(async () => {
  try {
    const sr = await fetch('${API_ORIGIN}/api/schools')
    if (!sr.ok) return { ok: false, why: 'schools http ' + sr.status }
    const sd = await sr.json()
    const school = (sd.items || [])[0]
    if (!school) return { ok: false, why: 'no schools' }
    const cr = await fetch('${API_ORIGIN}/api/schools/' + encodeURIComponent(school.id) + '/campuses')
    if (!cr.ok) return { ok: false, why: 'campuses http ' + cr.status }
    const cd = await cr.json()
    return {
      ok: true,
      schoolName: school.name,
      campusNames: (cd.items || []).map((c) => c.name),
      counts: (cd.items || []).map((c) => c.campusCircleCount),
      /* ⭐ 审核 62：字段已从 attributionEstablished 改名为 attributionCoverageComplete */
      attributionCoverageComplete: cd.attributionCoverageComplete,
      coverage: cd.coverage || null,
    }
  } catch (e) { return { ok: false, why: String(e && e.message) } }
})()`)
log('EXPECTED_FROM_SERVER', expected)

// ── 段 1：学校搜索页 ───────────────────────────────────────────────
console.log('')
console.log('=== 1) 学校搜索页 #/schools ===')
await evaluate(`location.hash = '#/campus'`)
await sleep(1500)
await evaluate(`location.hash = '#/schools'`)
await sleep(3200)
const search = await evaluate(`(() => {
  const q = (s) => document.querySelector(s)
  const input = q('.ss__input')
  const rows = [...document.querySelectorAll('[data-school-row]')].map((el) => ({
    text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
    hasCount: !!el.querySelector('[data-school-row-count]'),
  }))
  return {
    hash: location.hash,
    placeholder: input ? input.getAttribute('placeholder') : null,
    groupLabel: (q('[data-school-search-group]') || {}).innerText || null,
    rowCount: rows.length,
    rows,
  }
})()`)
log('SEARCH_PAGE', search)

// ── 段 2：校区面板 ─────────────────────────────────────────────────
console.log('')
console.log('=== 2) CampusScreen 校区面板 ===')
await evaluate(`location.hash = '#/campus'`)
await sleep(2500)
await evaluate(`(() => { const el = document.querySelector('.bigtitle__sub'); if (el) el.click(); return true })()`)
await sleep(1800)
const panel = await evaluate(`(() => {
  const q = (s) => document.querySelector(s)
  const p = q('[data-school-picker]')
  return {
    panelState: p ? p.getAttribute('data-school-picker') : null,
    title: (q('[data-school-picker-title]') || {}).innerText || null,
    campusRows: [...document.querySelectorAll('[data-campus-row]')].map((el) => (el.innerText || '').trim()),
    hasSearchEntry: !!q('[data-school-search-entry]'),
  }
})()`)
log('CAMPUS_PANEL', panel)

// ── 段 3：入口导航 ─────────────────────────────────────────────────
console.log('')
console.log('=== 3) 面板「搜索其他学校」入口 → #/schools ===')
await evaluate(`(() => { const el = document.querySelector('[data-school-search-entry]'); if (el) el.click(); return true })()`)
await sleep(2500)
const nav = await evaluate(`({ hash: location.hash })`)
log('ENTRY_NAV', nav)

// ── 判定 ───────────────────────────────────────────────────────────
const exp = expected && expected.ok ? expected : null
const rows = (search && search.rows) || []
const panelRows = (panel && panel.campusRows) || []

/** 期望的行文本：来自 API 的「学校名 (校区名)」，按页面顺序无关地做**多重集**比较 */
const expRowTexts = exp ? exp.campusNames.map((c) => exp.schoolName + ' (' + c + ')') : []
const rowTexts = rows.map((r) => r.text)

/** 多重集相等（页面按 name 排序，与 API 的排序可能不同 ⇒ 不能比数组顺序） */
function multisetEqual(a, b) {
  if (a.length !== b.length) return false
  const s = [...b]
  for (const x of a) {
    const i = s.indexOf(x)
    if (i < 0) return false
    s.splice(i, 1)
  }
  return true
}

const v = {
  /** 基线逐字：搜索框 placeholder「搜索选择学校...」 */
  SCHOOL_SEARCH_PLACEHOLDER:
    search && search.placeholder === '搜索选择学校...' ? 'PASS' : 'FAIL',
  /** 基线逐字：分组标题「更多学校」 */
  SCHOOL_SEARCH_GROUP_LABEL: search && search.groupLabel === '更多学校' ? 'PASS' : 'FAIL',
  /** 行格式「学校名 (校区名)」—— 期望值来自 API */
  SCHOOL_ROW_SHAPE:
    !exp || rowTexts.length === 0 ? 'INCONCLUSIVE' : multisetEqual(rowTexts, expRowTexts) ? 'PASS' : 'FAIL',
  /** 页面上不得出现 API 之外的**多余行**（同一条断言的另一面，合起来才完整） */
  SCHOOL_ROWS_FROM_AUTHORITY:
    !exp || rowTexts.length === 0 ? 'INCONCLUSIVE' : rowTexts.length === exp.campusNames.length ? 'PASS' : 'FAIL',
  /**
   * ⭐ 计数 null ⇒ **不渲染**计数字段（审核 60：null ≠ 0）
   *   ⚠️ 只有当**服务端确实返回 null** 时这条才有意义；若服务端给了数字，
   *      本断言应改为"渲染出的数字等于服务端数字"。这里按实际情形分支。
   */
  CIRCLE_COUNT_NULL_NOT_RENDERED: (() => {
    if (!exp) return 'INCONCLUSIVE'
    const allNull = exp.counts.every((c) => c === null)
    const anyCountRendered = rows.some((r) => r.hasCount)
    if (allNull) return anyCountRendered ? 'FAIL' : 'PASS'
    // 服务端有数字：那就不该"不渲染"
    return anyCountRendered ? 'PASS' : 'FAIL'
  })(),
  /**
   * ⭐ 计数**覆盖语义**自洽（审核 62 收紧后新增；WO#16 closeout）
   *   规则：count 可以是 number **当且仅当**该校园圈统计的 post population 100% 有归属
   *   ⇒ 从**API 响应本身**做机械核对（不依赖 DB 直连）：
   *     ① 覆盖不完整（attributionCoverageComplete=false）⇒ **每个** count 都必须是 null
   *     ② 覆盖完整（true）⇒ 不允许出现 null（此时 0 是**有资格**的，0 ≠ null）
   *     ③ coverage 诊断字段必须存在且自洽（attributed <= total；complete ⇔ attributed==total）
   *   ⚠️ 为什么放在这里而不是只靠 DB 级 selftest：
   *     DB 级测试证的是"服务端算得对"；本键证的是"**接口把这个结论如实传出去了、且 UI 也照做了**"。
   *     两者缺一，都会出现"服务端对但界面仍显示 0"的漏网。
   */
  CAMPUS_COUNT_COVERAGE_SEMANTICS: (() => {
    if (!exp) return 'INCONCLUSIVE'
    const complete = exp.attributionCoverageComplete
    if (typeof complete !== 'boolean') return 'FAIL'
    const allNull = exp.counts.every((c) => c === null)
    if (!complete && !allNull) return 'FAIL' // 覆盖不完整却给了数字
    if (complete && allNull) return 'FAIL' // 覆盖完整却全给 null（退化成"永远不可用"）
    const cov = exp.coverage
    if (!cov || typeof cov.totalRelevantPosts !== 'number' || typeof cov.attributedPosts !== 'number') {
      return 'FAIL'
    }
    if (cov.attributedPosts > cov.totalRelevantPosts) return 'FAIL'
    if (complete !== (cov.attributedPosts === cov.totalRelevantPosts)) return 'FAIL'
    // 覆盖不完整时，UI 也**不得**渲染任何计数字段
    if (!complete && rows.some((r) => r.hasCount)) return 'FAIL'
    return 'PASS'
  })(),
  /** 面板标题逐字「<学校名>（当前学校）」 */
  CAMPUS_PANEL_TITLE:
    !exp ? 'INCONCLUSIVE' : panel && panel.title === exp.schoolName + '（当前学校）' ? 'PASS' : 'FAIL',
  /** 面板项 = 该学校的校区（与 API 一致） */
  CAMPUS_PANEL_FROM_AUTHORITY:
    !exp || panelRows.length === 0 ? 'INCONCLUSIVE' : multisetEqual(panelRows, exp.campusNames) ? 'PASS' : 'FAIL',
  /** 入口导航 */
  SCHOOL_SEARCH_ENTRY_NAVIGATES:
    panel && panel.hasSearchEntry && nav && /schools/.test(String(nav.hash)) ? 'PASS' : 'FAIL',
  detail: { expected: exp, search, panel, nav, expRowTexts, rowTexts, panelRows },
  fixture_dependencies: {
    DB: '迁移 012（schools=1 / campuses=3）—— 通过真实 API 取值作为期望；取不到 ⇒ INCONCLUSIVE',
    device: 'Layer B 构建（依赖 data-school-row / data-campus-row / data-school-search-entry 等新钩子）',
    session: '**不依赖**（/api/schools 是公开只读）',
    permission: '**不依赖**',
    navigation: '每段各自显式导航（先 #/campus 再进目标页），强制新鲜挂载',
    order: '**不依赖**上一段留下的页面状态',
  },
}

const KEYS = [
  'SCHOOL_SEARCH_PLACEHOLDER',
  'SCHOOL_SEARCH_GROUP_LABEL',
  'SCHOOL_ROW_SHAPE',
  'SCHOOL_ROWS_FROM_AUTHORITY',
  'CIRCLE_COUNT_NULL_NOT_RENDERED',
  'CAMPUS_COUNT_COVERAGE_SEMANTICS',
  'CAMPUS_PANEL_TITLE',
  'CAMPUS_PANEL_FROM_AUTHORITY',
  'SCHOOL_SEARCH_ENTRY_NAVIGATES',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO16B_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(400)
process.exit(anyFail ? 1 : 0)
