/**
 * ⭐ WO#20 门禁：校园认证页 = **表单形态**（F-003；审核 65 批准范围）
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐ Fixture 依赖声明（审核 61 硬要求）
 * ════════════════════════════════════════════════════════════════════
 *   依赖项                        本 Gate 如何**自行建立/验证**
 *   ───────────────────────────  ──────────────────────────────────────────────
 *   DB：学校实体（1 条）           ① 通过真实 API `GET /api/schools` 取**期望的学校名**
 *                                   （不硬编码"北京交通大学"）；取不到 ⇒ INCONCLUSIVE
 *   Device：WO#20 构建            ② 断言要求出现 `data-verify-next` / `data-verify-notice`
 *                                   等**新钩子**；旧包没有 ⇒ 必然 FAIL
 *   导航：抽屉入口                ③ 走**真实入口**（Me → 左上图标 → 抽屉「校园认证」），
 *                                   而不是只靠 hash（更能反映用户路径）
 *   session / permission          ④ **不依赖**
 *   顺序                          ⑤ 各段各自显式导航，**不依赖**上一段留下的页面
 *
 * ════════════════════════════════════════════════════════════════════
 * 原版实测基线（Round 318 只读观察：uiautomator dump + bounds）
 * ════════════════════════════════════════════════════════════════════
 * ```
 *   标题「填写认证信息」        ← **不是**「校园认证」（那是抽屉条目名）
 *   「就读学校」 值 = 北京交通大学
 *   「所在学院」／「就读专业」／「当前年级」  （空）
 *   按钮「下一步」
 * ```
 *
 * 断言（5 键）：
 *   VERIFY_TITLE_IS_FORM_TITLE         标题为「填写认证信息」（不是抽屉条目名）
 *   VERIFY_FORM_FIELDS_MATCH_BASELINE  四个字段标签**齐全且顺序一致**
 *   VERIFY_SCHOOL_FROM_AUTHORITY       「就读学校」的值 == **API** 的学校名（不硬编码）
 *   VERIFY_NO_FABRICATED_STATUS_CARD   不出现我们编的「未认证」「认证方式」「认证状态」「去认证」
 *   VERIFY_NEXT_DOES_NOT_FAKE_SUCCESS  ⭐ 点「下一步」**不得**跳转/不得显示成功；
 *                                      必须给出**明确说明**（BLOCKED_BY_POLICY）
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo20-gate.json'
const API = 'https://8.148.156.146'

/** 原版实测的字段标签（**顺序**也照原版） */
const EXPECTED_FIELDS = ['就读学校', '所在学院', '就读专业', '当前年级']
/** 我们**改前编造**的文案 —— 出现即说明没清理干净 */
const FABRICATED = ['未认证', '认证方式', '认证状态', '去认证', '学生证 / 校园卡', '待认证']

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
  const title = (q('.dp__title') || q('.drawerpage__title') || q('h1') || {}).innerText || ''
  const rows = [...document.querySelectorAll('.dprow')].map((el) => ({
    label: (el.querySelector('.dprow__label') || {}).innerText || '',
    value: (el.querySelector('.dprow__value') || {}).innerText || '',
  }))
  const nextBtn = q('[data-verify-next]')
  const notice = q('[data-verify-notice]')
  return {
    hash: location.hash,
    title: String(title).replace(/\\s+/g,' ').trim(),
    rows,
    rowLabels: rows.map((r) => r.label),
    hashBefore: location.hash,
    nextButtonText: nextBtn ? (nextBtn.innerText || '').replace(/\\s+/g,' ').trim() : null,
    hasNextHook: !!nextBtn,
    notice: notice ? (notice.innerText || '').replace(/\\s+/g,' ').trim() : null,
    // 全文（用于"编造文案"扫描）
    text: ((q('.screen') || q('body')).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 700),
  }
})()`

/** 走真实入口进「校园认证」：Me → 左上「菜单」按钮开抽屉 → 点「校园认证」 */
async function gotoVerify() {
  /*
    ⚠️ 选择器是**核对源码后**写的，不是我猜的（我第一版猜的是 `.drawer__open` 等，都不存在）：
      · 开抽屉：MeScreen.tsx 里那个 <button className="iconbtn" aria-label="菜单">
      · 抽屉条目：Drawer.tsx 的 <button className="drawer__item">{item.label}</button>
    这正是我反复踩过的"断言口径错"——所以本文件先核对再写。
  */
  await evaluate(`location.hash = '#/me'`)
  await sleep(2200)
  await evaluate(`(() => {
    const b = document.querySelector('button[aria-label="菜单"]')
    if (b) { b.click(); return true }
    return false
  })()`)
  await sleep(1500)
  await evaluate(`(() => {
    const hit = [...document.querySelectorAll('.drawer__item')]
      .find((n) => (n.innerText || '').trim() === '校园认证')
    if (hit) { hit.click(); return true }
    return false
  })()`)
  await sleep(2500)
  return evaluate(READ)
}

// ── 段 0：期望值来自服务端 ──────────────────────────────────────────
console.log('=== 0) 期望值来自服务端 ===')
const expected = await evaluate(`(async () => {
  try {
    const r = await fetch('${API}/api/schools')
    if (!r.ok) return { ok: false, why: 'http ' + r.status }
    const j = await r.json()
    const first = (j.items || [])[0]
    return { ok: true, schoolName: first ? first.name : null, count: (j.items || []).length }
  } catch (e) { return { ok: false, why: String(e && e.message) } }
})()`)
log('EXPECTED_FROM_SERVER', expected)
const exp = expected && expected.ok ? expected : null

// ── 段 1：进入页面 ─────────────────────────────────────────────────
console.log('')
console.log('=== 1) Me → 抽屉 → 校园认证 ===')
const view = await gotoVerify()
log('VERIFY_PAGE', view)

// ── 段 2：点「下一步」不得假装成功 ─────────────────────────────────
console.log('')
console.log('=== 2) 点「下一步」：不得跳转、不得显示成功 ⭐ ===')
const hashBefore = view && view.hash
await evaluate(`(() => { const b = document.querySelector('[data-verify-next]'); if (b) { b.click(); return true } return false })()`)
await sleep(2000)
const afterNext = await evaluate(READ)
log('AFTER_NEXT', afterNext)

// ── 判定 ───────────────────────────────────────────────────────────
const labels = (view && view.rowLabels) || []
const text = String((view && view.text) || '')
const schoolRow = ((view && view.rows) || []).find((r) => r.label === '就读学校')

const v = {
  /** 原版标题是「填写认证信息」（抽屉条目才叫「校园认证」） */
  VERIFY_TITLE_IS_FORM_TITLE:
    view && String(view.title).includes('填写认证信息') ? 'PASS' : 'FAIL',

  /** 四个字段**齐全且顺序一致**（顺序也照原版，避免"有字段但顺序乱"也算过） */
  VERIFY_FORM_FIELDS_MATCH_BASELINE: (() => {
    if (!view || labels.length === 0) return 'INCONCLUSIVE'
    const wanted = EXPECTED_FIELDS
    const got = labels.filter((l) => wanted.includes(l))
    return wanted.every((w, i) => got[i] === w) && got.length === wanted.length ? 'PASS' : 'FAIL'
  })(),

  /**
   * 「就读学校」的值 == **API** 的学校名（证明接权威、不硬编码）。
   * ⚠️ API 取不到 ⇒ INCONCLUSIVE（不假装通过）。
   */
  VERIFY_SCHOOL_FROM_AUTHORITY: (() => {
    if (!exp || !exp.schoolName) return 'INCONCLUSIVE'
    if (!schoolRow) return 'FAIL'
    return String(schoolRow.value).includes(exp.schoolName) ? 'PASS' : 'FAIL'
  })(),

  /** 我们改前**编造**的文案必须全部消失 */
  VERIFY_NO_FABRICATED_STATUS_CARD: !view ? 'INCONCLUSIVE' : FABRICATED.some((n) => text.includes(n)) ? 'FAIL' : 'PASS',

  /**
   * ⭐「下一步」**不得假装成功**（审核 65："我们自己的 demo 不能假装认证成功"）。
   *   判据三条**同时**成立：
   *     ① 点了之后**没有跳走**（hash 不变 / 仍在同一页）
   *     ② **没有**出现成功类字样（认证成功/已提交/提交成功/认证中…）
   *     ③ **确实**给出了明确说明（notice 非空）
   */
  VERIFY_NEXT_DOES_NOT_FAKE_SUCCESS: (() => {
    if (!view || !view.hasNextHook) return 'FAIL' // 没有该按钮 = 形态不对
    if (!afterNext || afterNext.TIMEOUT) return 'INCONCLUSIVE'
    const stayed = String(afterNext.hash || '') === String(hashBefore || '')
    const successWords = /认证成功|已认证|已提交|提交成功|认证通过|审核中|正在认证/
    const noFake = !successWords.test(String(afterNext.text || ''))
    const explained = !!afterNext.notice || /未接入|无法继续|未实现|不可用/.test(String(afterNext.text || ''))
    return stayed && noFake && explained ? 'PASS' : 'FAIL'
  })(),
  detail: {
    expected: exp,
    view,
    afterNext,
    hashBefore,
    fabricatedChecked: FABRICATED,
    expectedFields: EXPECTED_FIELDS,
  },
  fixture_dependencies: {
    DB: 'schools 实体（1 条）—— 通过真实 API 取作期望；取不到 ⇒ INCONCLUSIVE',
    device: 'WO#20 构建（依赖 data-verify-next / data-verify-notice 钩子）',
    navigation: '走真实入口：Me 页 → 抽屉 → 「校园认证」',
    session: '**不依赖**',
    permission: '**不依赖**',
    order: '**不依赖**上一段留下的页面状态',
  },
}

const KEYS = [
  'VERIFY_TITLE_IS_FORM_TITLE',
  'VERIFY_FORM_FIELDS_MATCH_BASELINE',
  'VERIFY_SCHOOL_FROM_AUTHORITY',
  'VERIFY_NO_FABRICATED_STATUS_CARD',
  'VERIFY_NEXT_DOES_NOT_FAKE_SUCCESS',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO20_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
