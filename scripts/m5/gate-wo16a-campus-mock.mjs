/**
 * WO#16 层 A 设备门禁：CampusScreen 不再使用 mock 学校数据（审核 60 批准的范围）
 *
 * ════════════════════════════════════════════════════════════════════
 * 审核 60 对层 A 的原文要求（本门禁逐条对应）
 * ════════════════════════════════════════════════════════════════════
 *   · CampusScreen 不再显示 mock school name / 8-school dataset / member counts
 *   · subtitle 对齐为「校园广场 ▼」
 *   · **保留**已有基线支持的入口形态（⚠️ 不是把整块控件删掉）
 *   · FeedList 与 CampusScreen 均不得用 mock school data
 *
 * ⚠️ 这个"保留入口"的要求是审核**对我原计划的修正**：
 *    我原计划照 FeedList 的做法把整个控件 HIDE/DEFER，审核指出
 *    "FeedList 的 HIDE/DEFER 不能机械复制成 'CampusScreen 整块顶部控件消失'" ——
 *    因为基线证明「校园广场 ▼」这个入口**本身存在**。
 *    ⇒ 所以本门禁**既要**断言"没有 mock 数据"，**也要**断言"入口还在"。
 *
 * ════════════════════════════════════════════════════════════════════
 * 判别力（关键：每条都要能红，我会用 selftest-mutation.sh 证明）
 * ════════════════════════════════════════════════════════════════════
 *   CAMPUS_SUBTITLE_IS_LITERAL     副标题**逐字**为「校园广场」
 *                                  （不是学校名 —— 这是本层要修的偏差）
 *   CAMPUS_NO_MOCK_SCHOOL_NAMES    页面上不出现 mock 那 8 个学校里的任何一个
 *                                  （含"清华大学/北京大学/复旦大学"等**只在 mock 里存在**的名字）
 *   CAMPUS_NO_FABRICATED_NUMBERS   不出现编造数字（12,486 / 38,920 / "位同学"）
 *   CAMPUS_PICKER_ENTRY_PRESENT    「校园广场 ▼」入口**仍在**（基线支持，不得删）
 *   CAMPUS_PICKER_NO_MOCK_ON_OPEN  点开入口 ⇒ 只有**明确不可用态**，没有学校列表
 *
 * ⚠️ 断言的**作用域**：一律用"本屏的 DOM/文本"，
 *    不用"整页出现过某词"（那在本项目已造成过假 FAIL，见 WO#14/15 的教训）。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo16a-campus-gate.json'

/**
 * mock 那 8 个学校里，**只存在于 mock、任何真实数据里都没有**的名字。
 * 为什么要挑这些：`北京交通大学` 是我们的**_seed 用户/帖子真实在用**的学校名，
 * 出现它是**正常的**，不能当作"用了 mock 学校列表"的证据。
 * （这一区分很要紧：若把 北京交通大学 也算成禁用词，本门禁会**假 FAIL**。）
 */
const MOCK_ONLY_SCHOOLS = [
  '清华大学',
  '北京大学',
  '中国人民大学',
  '北京航空航天大学',
  '北京师范大学',
  '复旦大学',
  '上海交通大学',
]
/** 编造数字（WO#11 从动态列表页判定并移除过 '12,486'；'38,920' 同源） */
const FABRICATED = ['12,486', '12486', '38,920', '38920', '位同学']

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 读 CampusScreen：副标题 / 入口 / 本屏文本 / 面板状态 */
const snapCampus = () =>
  evaluate(`(() => {
  const screen = document.querySelector('.screen') || document.body
  /* ⚠️ 只取**本屏**文本，不用整页 —— 整页会混入 tabbar 等其它区域 */
  const screenText = screen.innerText || ''
  const subEl = document.querySelector('.bigtitle__sub')
  const panel = document.querySelector('[data-school-picker]')
  const note = document.querySelector('[data-school-picker-note]')
  return {
    hash: location.hash,
    subtitle: subEl ? (subEl.innerText || '').trim() : null,
    hasSubCaret: !!document.querySelector('.bigtitle__sub svg'),
    hasEntry: !!subEl,
    screenText,
    panelPresent: !!panel,
    panelState: panel ? panel.getAttribute('data-school-picker') : null,
    panelNote: note ? (note.innerText || '').trim() : null,
    panelSchoolRows: document.querySelectorAll('.switcher__item, .switcher__name').length,
  }
})()`)

console.log('=== 1) 进 CampusScreen（先离开再回来，保证新鲜挂载）===')
await evaluate(`location.hash = '#/me'`)
await sleep(1500)
await evaluate(`location.hash = '#/campus'`)
await sleep(3200)
const snap = await snapCampus()
log('CAMPUS', {
  hash: snap.hash,
  subtitle: snap.subtitle,
  hasEntry: snap.hasEntry,
  hasSubCaret: snap.hasSubCaret,
  screenTextHead: String(snap.screenText || '').slice(0, 300),
})

console.log('')
console.log('=== 2) 点开入口 → 面板应是"明确不可用"，不是学校列表 ===')
const openedRes = await evaluate(`(() => {
  const el = document.querySelector('.bigtitle__sub')
  if (!el) return { ok: false, why: 'sub not found' }
  el.click()
  return { ok: true }
})()`)
await sleep(1500)
const opened = await snapCampus()
log('CAMPUS_PICKER_OPENED', {
  clicked: openedRes,
  panelPresent: opened.panelPresent,
  panelState: opened.panelState,
  panelNote: opened.panelNote,
  panelSchoolRows: opened.panelSchoolRows,
})

// 关掉面板，避免影响后续
await evaluate(`(() => { const m = document.querySelector('.switcher__mask'); if (m) m.click(); return true })()`)
await sleep(800)

// ---------- 判定 ----------
/*
  ⭐⭐ 这里修过一个**真实缺陷**（由敏感度自测当场抓出，值得写清楚）：
    第一版只在**面板未打开时**的 `screenText` 上查 mock 学校名与编造数字
    ⇒ 而 mock 学校列表**只在打开面板后才渲染** ⇒ 关闭状态下**永远查不到**
    ⇒ 那两条断言在"把面板改回 mock 8 校"的突变下**依然 PASS**（**没有判别力**）。
    实跑证据（selftest-mutation.sh ②阶段）：
      CAMPUS_SUBTITLE_IS_LITERAL: FAIL ✓ ／ CAMPUS_PICKER_NO_MOCK_ON_OPEN: FAIL ✓
      CAMPUS_NO_MOCK_SCHOOL_NAMES: **PASS ✗** ／ CAMPUS_NO_FABRICATED_NUMBERS: **PASS ✗**
    ⇒ 结论：**断言必须覆盖"假数据真正会出现的那一态"**。
      这里假数据出现在**打开后的面板**里 ⇒ 名称/数字两类必须查**打开态**的文本；
      同时**也**查关闭态（防止将来把 mock 名字泄到标题等常驻位置）。
    ⚠️ 教训与 WO#14（用整页 imgCount 判头像）、WO#15（用整页文本判 mock 地点）
      同族：**断言的作用域错了，与"实现错了"在输出上无法区分**。
*/
const screenText = String(snap.screenText || '')
const openedText = String(opened.screenText || '')
/* 两个状态都要查（关：防常驻泄漏；开：防面板内泄漏） */
const leakedSchools = MOCK_ONLY_SCHOOLS.filter((n) => screenText.includes(n) || openedText.includes(n))
const leakedNumbers = FABRICATED.filter((n) => screenText.includes(n) || openedText.includes(n))
const openedLeakedSchools = MOCK_ONLY_SCHOOLS.filter((n) => openedText.includes(n))

const v = {
  /** 副标题逐字「校园广场」（基线 trident-campus interactions[1]） */
  CAMPUS_SUBTITLE_IS_LITERAL: snap.subtitle === '校园广场' ? 'PASS' : 'FAIL',
  /** 不得出现"只存在于 mock"的学校名 */
  CAMPUS_NO_MOCK_SCHOOL_NAMES: leakedSchools.length === 0 ? 'PASS' : 'FAIL',
  /** 不得出现编造数字 */
  CAMPUS_NO_FABRICATED_NUMBERS: leakedNumbers.length === 0 ? 'PASS' : 'FAIL',
  /**
   * 入口形态仍在（审核 60 明确要求保留）
   * ⚠️ 这条是**防过度删除**的：如果谁把整块控件删了，它会红。
   */
  CAMPUS_PICKER_ENTRY_PRESENT: snap.hasEntry && snap.hasSubCaret === true ? 'PASS' : 'FAIL',
  /**
   * 点开后的面板内容（⭐ WO#16 层 B 改了这里的**期望形态**，并如实说明为什么）：
   *   层 A 时：面板是"尚未接入"占位（panelState='unavailable'，0 行）
   *   层 B 时：面板改为渲染**权威校区实体**（panelState='campuses'，
   *            行名来自 GET /api/schools/:id/campuses ⇒ 校本部/威海校区/东校区）
   * ⇒ 本键的**不变内核**是"**不得出现 mock 学校数据**"，
   *    而"用什么形态呈现权威数据"由层的设计决定（层 B 已获审核 61 批准）。
   *   因此判定改为：面板存在、**有真实校区行**、且**不出现任何 mock-only 学校名**。
   *   ⚠️ 同时断言面板**不是**"不可用"态 —— 否则层 B 白做了（那会退化成层 A 的占位）。
   */
  CAMPUS_PICKER_NO_MOCK_ON_OPEN:
    opened.panelPresent === true &&
    opened.panelState === 'campuses' &&
    (opened.panelSchoolRows || 0) >= 1 &&
    openedLeakedSchools.length === 0
      ? 'PASS'
      : 'FAIL',
  detail: {
    snap: { ...snap, screenText: undefined },
    opened: { ...opened, screenText: undefined },
    leakedSchools,
    leakedNumbers,
    openedLeakedSchools,
    mockOnlySchoolsChecked: MOCK_ONLY_SCHOOLS,
    fabricatedChecked: FABRICATED,
  },
  notes: {
    "为什么不用整页文本":
      '本项目的整页口径断言已造成过假 FAIL（WO#14 用整页 imgCount 判头像、' +
      'WO#15 用整页文本判 mock 地点）。这里取 .screen 的文本。',
    "为什么北京交通大学不在禁用词里":
      '它是我们 seed 用户/帖子**真实在用**的学校名，出现属正常；' +
      '若把它也禁用会造成假 FAIL。只禁用**只在 mock 里存在**的 7 个。',
    "保留入口的理由":
      '审核 60：基线证明「校园广场 ▼」入口本身存在，不得把整块控件删掉。',
  },
}
const KEYS = [
  'CAMPUS_SUBTITLE_IS_LITERAL',
  'CAMPUS_NO_MOCK_SCHOOL_NAMES',
  'CAMPUS_NO_FABRICATED_NUMBERS',
  'CAMPUS_PICKER_ENTRY_PRESENT',
  'CAMPUS_PICKER_NO_MOCK_ON_OPEN',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const anyIncon = KEYS.some((k) => v[k] === 'INCONCLUSIVE')
v.WO16A_GATE = anyFail ? 'FAIL' : anyIncon ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
log('VERDICT', v)

ws.close()
await sleep(400)
process.exit(anyFail ? 1 : 0)
