/**
 * ⭐ F-004 / F-006 门禁：认证页「所在学院」是**真正的 picker**（审核 67 的 BLOCKER）
 *
 * ════════════════════════════════════════════════════════════════════
 * 依据（审核 67 原话）
 * ════════════════════════════════════════════════════════════════════
 *   > "F-004 「所在学院」原版 picker、当前文本 Row：**阻塞**。这是**交互方式**，不是视觉。
 *   >   ……用户操作能力不同。"
 *   > "F-006 原版有学院实体，我们没有 ⇒ **EXPERIENCE CAPABILITY BLOCKER**。
 *   >   但修复范围**必须非常小**……可以像学校/校区一样 seed a small baseline-supported
 *   >   set of colleges → **picker can actually select**。"
 *   > "把 F-004 + F-006 合成一个**非常小的**最终 closeout item，不要再重开完整 WO#20。"
 *
 * ════════════════════════════════════════════════════════════════════
 * 原版对照（Round 319 只读 dump，可复算）
 * ════════════════════════════════════════════════════════════════════
 *   点「所在学院」后面板内容：
 *     ["取消", "所在学院", "确认", "在职专业学位中心", "软件学院", "语言与传播学院",
 *      "网络空间安全学院", "威海国际学院/威海校区", "没有我的学院？"]
 *
 * ════════════════════════════════════════════════════════════════════
 * Fixture 依赖声明
 * ════════════════════════════════════════════════════════════════════
 *   DB：schools(1) + colleges(5，迁移 013 种子) —— 期望值**从真实 API 取**，取不到 ⇒ INCONCLUSIVE
 *   Device：本轮构建（依赖 data-verify-college / data-verify-college-picker 等钩子）
 *   导航：真实入口（Me → 「菜单」→ 抽屉「校园认证」）
 *   session/permission：**不依赖** ／ 顺序：各段各自显式导航
 *   ⚠️ 本门禁**会修改我们自己的表单状态**（选一个学院）—— 那是**允许的**：
 *      审核 63/用户要求 2 明确"需要读写上下文的证据，改在我们自己的 demo 里造数"。
 *      它**不**触碰原版 app，也**不**写服务端（认证表单本身没有提交接口）。
 *
 * 断言（6 键）：
 *   VERIFY_COLLEGE_ROW_TAPPABLE              「所在学院」行可点（有 data-verify-college 钩子）
 *   COLLEGE_PICKER_OPENS_AND_MATCHES_DUMP    面板元素与 dump 一致（取消/所在学院/确认/没有我的学院？）
 *   COLLEGE_LIST_FROM_AUTHORITY              ⭐ 列表 == API 的学院（不硬编码）
 *   COLLEGE_SELECT_AND_CONFIRM_WORKS         ⭐ 选一个 + 确认 ⇒ 该行显示所选学院
 *   COLLEGE_NO_FABRICATED_OPTIONS            面板里不得出现 API 之外的学院名
 *   VERIFY_MAJOR_YEAR_NOT_INVENTED           就读专业/当前年级**没有被发明 picker**
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\f004-gate.json'
const API = 'https://8.148.156.146'
const SCHOOL_ID = 'b0000000-0000-4000-8000-000000000001'

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

const READ = `(() => {
  const q = (s) => document.querySelector(s)
  const panel = q('[data-verify-college-picker]')
  const rowBtn = q('[data-verify-college]')
  const rows = [...document.querySelectorAll('.dprow')].map((el) => ({
    label: (el.querySelector('.dprow__label') || {}).innerText || '',
    value: (el.querySelector('.dprow__value') || {}).innerText || '',
    hasCollegeHook: el.hasAttribute('data-verify-college'),
  }))
  return {
    hash: location.hash,
    rows,
    collegeRowValue: (rows.find((r) => r.label === '所在学院') || {}).value || '',
    rowIsTappable: !!rowBtn,
    panelOpen: !!panel,
    panelText: panel ? panel.innerText.replace(/\\s+/g,' ').trim() : null,
    panelItems: panel ? [...panel.querySelectorAll('.vpick__item')].map((n) => n.innerText.trim()) : [],
    hasCancel: panel ? !![...panel.querySelectorAll('.vpick__btn')].find((b) => b.innerText.trim() === '取消') : false,
    hasConfirm: !!q('[data-verify-college-confirm]'),
    hasMissing: !!q('[data-verify-college-missing]'),
    pageText: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 500),
  }
})()`

/** 真实入口进认证页 */
async function gotoVerify() {
  await evaluate(`location.hash = '#/me'`)
  await sleep(2200)
  await evaluate(`(() => { const b = document.querySelector('button[aria-label="菜单"]'); if (b) { b.click(); return true } return false })()`)
  await sleep(1500)
  await evaluate(`(() => {
    const hit = [...document.querySelectorAll('.drawer__item')].find((n) => (n.innerText || '').trim() === '校园认证')
    if (hit) { hit.click(); return true }
    return false
  })()`)
  await sleep(2800)
  return evaluate(READ)
}

// ── 段 0：期望值来自服务端 ──────────────────────────────────────────
console.log('=== 0) 期望值来自服务端（学院列表）===')
const expected = await evaluate(`(async () => {
  try {
    const r = await fetch('${API}/api/schools/${SCHOOL_ID}/colleges')
    if (!r.ok) return { ok: false, why: 'http ' + r.status }
    const j = await r.json()
    return { ok: true, names: (j.items || []).map((c) => c.name), completeness: j.completeness }
  } catch (e) { return { ok: false, why: String(e && e.message) } }
})()`)
log('EXPECTED_FROM_SERVER', expected)
const expNames = expected && expected.ok ? expected.names : null

// ── 段 1：进入认证页（基线：未选学院）────────────────────────────────
console.log('')
console.log('=== 1) 认证页基线状态 ===')
const base = await gotoVerify()
log('VERIFY_BASE', base)

// ── 段 2：点「所在学院」→ 面板 ──────────────────────────────────────
console.log('')
console.log('=== 2) 点「所在学院」⇒ 面板元素应与 dump 一致 ⭐ ===')
await evaluate(`(() => { const b = document.querySelector('[data-verify-college]'); if (b) { b.click(); return true } return false })()`)
await sleep(1600)
const opened = await evaluate(READ)
log('PICKER_OPEN', opened)

// ── 段 3：选第一个 + 确认 ⇒ 该行应显示所选值 ⭐ ─────────────────────
console.log('')
console.log('=== 3) 选第一个学院 + 「确认」⇒ 该行显示所选值 ⭐ ===')
const firstOption = (opened && opened.panelItems && opened.panelItems[0]) || null
if (firstOption) {
  await evaluate(`(() => {
    const it = [...document.querySelectorAll('.vpick__item')].find((n) => n.innerText.trim() === ${JSON.stringify(firstOption)})
    if (it) { it.click(); return true }
    return false
  })()`)
  await sleep(700)
  await evaluate(`(() => { const b = document.querySelector('[data-verify-college-confirm]'); if (b) { b.click(); return true } return false })()`)
  await sleep(1400)
}
const afterConfirm = await evaluate(READ)
log('AFTER_CONFIRM', afterConfirm)

// ── 判定 ───────────────────────────────────────────────────────────
const baseLabels = ((base && base.rows) || []).map((r) => r.label)
const hasMajorYear = baseLabels.includes('就读专业') && baseLabels.includes('当前年级')
/** dump 里的三个 UI 元素（原版面板确实有） */
const DUMP_UI = ['取消', '所在学院', '确认']

const v = {
  VERIFY_COLLEGE_ROW_TAPPABLE: base && base.rowIsTappable ? 'PASS' : 'FAIL',

  /** 面板元素与 dump 一致（取消 / 所在学院 / 确认 / 没有我的学院？） */
  COLLEGE_PICKER_OPENS_AND_MATCHES_DUMP: (() => {
    if (!opened) return 'INCONCLUSIVE'
    if (!opened.panelOpen) return 'FAIL'
    const t = String(opened.panelText || '')
    const uiOk = opened.hasCancel && opened.hasConfirm && opened.hasMissing && t.includes('所在学院')
    return uiOk ? 'PASS' : 'FAIL'
  })(),

  /** ⭐ 列表内容 == API（证明接权威、不硬编码） */
  COLLEGE_LIST_FROM_AUTHORITY: (() => {
    if (!expNames || expNames.length === 0) return 'INCONCLUSIVE'
    if (!opened || !opened.panelItems) return 'INCONCLUSIVE'
    const got = opened.panelItems.filter((x) => x !== '没有我的学院？')
    return got.length === expNames.length && expNames.every((n) => got.includes(n)) ? 'PASS' : 'FAIL'
  })(),

  /**
   * ⭐ 选一个 + 确认 ⇒ 行值更新（证明 picker **真的能选**，不是空面板）。
   *
   * ⚠️ 本键修过一次**判别力**缺陷（敏感度抓出）：
   *    第一版写 `if (!firstOption) return 'INCONCLUSIVE'`，于是"根本没有面板/没有选项"时
   *    它报 INCONCLUSIVE 而不是 FAIL —— 而**我们走到这里就说明 API 已给出学院基准**
   *    ⇒ "应有的可选项缺失" 必须是 **FAIL**。
   *    （与 WO#17 那次同一原则：**API 已给基准时，结构缺失 = FAIL**。）
   */
  COLLEGE_SELECT_AND_CONFIRM_WORKS: (() => {
    if (!expNames || expNames.length === 0) return 'INCONCLUSIVE' // API 都没有基准
    if (!firstOption) return 'FAIL' // API 有基准，面板却没有可选项
    if (!afterConfirm) return 'INCONCLUSIVE'
    return afterConfirm.collegeRowValue === firstOption ? 'PASS' : 'FAIL'
  })(),

  /**
   * 面板里不得出现 API 之外的学院名（防编造选项）。
   *
   * ⚠️ 本键修过一次**恒真断言**缺陷（敏感度抓出）：
   *    第一版在"面板为空数组"时，`[].filter(...).length === 0` ⇒ **PASS** ——
   *    即"**没有选项**"被当成了"**没有编造选项**"，这是**真空通过**。
   *    ⚠️ 空数组在 JS 里是 truthy，所以 `if (!opened.panelItems)` 也拦不住它。
   *    ⇒ 现在要求**先真的有选项**（数量与 API 一致）才判"无编造"；
   *      API 有基准而面板无选项 ⇒ **FAIL**。
   */
  COLLEGE_NO_FABRICATED_OPTIONS: (() => {
    if (!expNames || expNames.length === 0) return 'INCONCLUSIVE'
    if (!opened || !Array.isArray(opened.panelItems)) return 'INCONCLUSIVE'
    const opts = opened.panelItems.filter((x) => x !== '没有我的学院？')
    if (opts.length === 0) return 'FAIL' // API 有基准却没有可选项 ⇒ 不能真空通过
    const extra = opts.filter((x) => !expNames.includes(x))
    return extra.length === 0 ? 'PASS' : 'FAIL'
  })(),

  /**
   * ⭐ 就读专业 / 当前年级**没有被发明 picker**（F-005 是 NOT_EVALUATED，
   *   审核 67 明确"不需要继续考古" ⇒ 不得凭空造交互）。
   *   判据：这两行的**行为**应与「所在学院」不同（即不打开 picker）。
   */
  VERIFY_MAJOR_YEAR_NOT_INVENTED: (() => {
    if (!base || !hasMajorYear) return 'FAIL'
    const collegeRow = (base.rows || []).find((r) => r.label === '所在学院')
    const majorRow = (base.rows || []).find((r) => r.label === '就读专业')
    const yearRow = (base.rows || []).find((r) => r.label === '当前年级')
    /* 只有「所在学院」带 hook（可点开 picker）；专业/年级不得带同类钩子 */
    return collegeRow && collegeRow.hasCollegeHook && majorRow && !majorRow.hasCollegeHook && yearRow && !yearRow.hasCollegeHook
      ? 'PASS'
      : 'FAIL'
  })(),

  detail: { expected, base, opened, afterConfirm, firstOption, dumpUiElements: DUMP_UI },
  fixture_dependencies: {
    DB: 'schools(1) + colleges(5；迁移 013) —— 期望从**真实 API** 取；取不到 ⇒ INCONCLUSIVE',
    device: '本轮构建（data-verify-college / -picker / -confirm / -missing 钩子）',
    navigation: '真实入口：Me → button[aria-label="菜单"] → 抽屉「校园认证」',
    session: '**不依赖**',
    permission: '**不依赖**',
    order: '各段各自显式导航',
  },
  notes: {
    自写操作: '本门禁会在**我们自己的** demo 里选一个学院（表单状态）—— 审核 63/用户要求 2 明确允许；不触碰原版、不写服务端。',
    学院数据限度: '5 条学院名逐字来自 Round 319 对原版 picker 的只读 dump；该面板可能可滚动 ⇒ ORIGINAL_COLLEGE_LIST_COMPLETE: NOT_EVALUATED。',
  },
}

const KEYS = [
  'VERIFY_COLLEGE_ROW_TAPPABLE',
  'COLLEGE_PICKER_OPENS_AND_MATCHES_DUMP',
  'COLLEGE_LIST_FROM_AUTHORITY',
  'COLLEGE_SELECT_AND_CONFIRM_WORKS',
  'COLLEGE_NO_FABRICATED_OPTIONS',
  'VERIFY_MAJOR_YEAR_NOT_INVENTED',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.F004_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
