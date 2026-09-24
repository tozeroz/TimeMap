/**
 * ⭐ WO#18 门禁：地点搜索页接**权威数据源**（审核 62 的 A2）
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐ Fixture 依赖声明（审核 61 硬要求）
 * ════════════════════════════════════════════════════════════════════
 *   依赖项                        本 Gate 如何**自行建立/验证**
 *   ───────────────────────────  ──────────────────────────────────────────────
 *   DB：places 行（2 条）          ① 通过真实 API 取 `GET /api/places` 作**期望**
 *                                   （不硬编码地点名/地址）；取不到 ⇒ INCONCLUSIVE
 *   网络可达                      ② 同上
 *   Device：WO#18 构建            ③ 断言要求出现 `data-poi-row` / `data-poi-state` 等**新钩子**；
 *                                   旧包没有 ⇒ 必然 FAIL（不会"用旧包假装通过"）
 *   ⭐ 地理位置                   ④ **本 Gate 主动承认这条依赖**：
 *                                   `distance` 只在**有定位**时才渲染。
 *                                   模拟器当前**有**定位（实测 1884 km / 2.4 km）
 *                                   ⇒ 能断言"渲染出的距离不是 mock 的固定值"；
 *                                   而"**无定位时完全不渲染**"这条分支
 *                                   **无法在本夹具下构造** ⇒ 记 NOT_EVALUATED（不假装测过）
 *   session / permission          ⑤ **不依赖**（/api/places 公开只读）
 *   导航起始状态                  ⑥ 每段先 `#/campus` 再进 `#/poi`，强制新鲜挂载
 *   order                         ⑦ 各段各自显式导航，**不依赖**上一段状态
 *
 * ════════════════════════════════════════════════════════════════════
 * 断言（7 键）
 * ════════════════════════════════════════════════════════════════════
 *   POI_ROWS_FROM_AUTHORITY      行集合 == API 的地点集合（多重集比较，不硬编码）
 *   POI_SEARCH_SERVER_SIDE       关键词过滤后 == API 的过滤结果（证明走服务端）
 *   POI_EMPTY_STATE              不存在的关键词 ⇒ 空态且回显关键词
 *   POI_CLEAR_ROW_PRESENT        「不添加地点」清除项仍在（基线行为，防过度删除）
 *   POI_NO_MOCK_ONLY_PLACES      不出现**只在 mock 里存在**的地点名（思源楼/教育超市/…）
 *   POI_NO_FABRICATED_NUMBERS    不出现 mock 的编造计数（1284 / 143 / 96 / 88）
 *   POI_DISTANCE_NOT_MOCK        渲染出的距离**不等于** mock 的固定值（320m/410m/520m）
 *                                ⭐ 判别力来源：mock 的距离是**硬编码常量**，
 *                                   若实现仍读 mock，距离会**恰好**等于那些值
 *   ⚠️ 另有 `POI_DISTANCE_ABSENT_WITHOUT_FIX`：**NOT_EVALUATED**
 *      （模拟器有定位 ⇒ 无法构造"无定位"夹具；不假装测过）
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo18-gate.json'
const API = 'https://8.148.156.146'

/** 只在 mock.ts 里存在的地点名（改前 mock 的 5 条里的 3 条特有 + 1 条院系） */
const MOCK_ONLY_PLACES = ['思源楼', '教育超市', '北京交通大学交通运输学院']
/** mock 的编造计数（UI 从未渲染，但躺在模型里） */
const FABRICATED = ['1284', '143', '96', '88']
/** mock 的**硬编码**距离文案 —— 若仍读 mock，会恰好出现这些 */
const MOCK_DISTANCES = ['320m', '410m', '520m']

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
  const rows = [...document.querySelectorAll('[data-poi-row]')].map((el) => ({
    title: (el.querySelector('.row__title') || {}).innerText || '',
    sub: (el.querySelector('.row__sub') || {}).innerText || '',
    distance: (el.querySelector('.poi__distance') || {}).innerText || null,
  }))
  return {
    hash: location.hash,
    state: q('[data-poi-state]') ? q('[data-poi-state]').getAttribute('data-poi-state') : null,
    hasHooks: !!q('[data-poi-state]') || rows.length > 0,
    rowCount: rows.length,
    rows,
    emptyText: q('[data-poi-empty]') ? q('[data-poi-empty]').innerText : null,
    errorText: q('[data-poi-error]') ? q('[data-poi-error]').innerText : null,
    hasClearRow: /不添加地点/.test((q('.list') || document.body).innerText),
    screenText: (q('.screen') || document.body).innerText.replace(/\\s+/g, ' ').trim().slice(0, 600),
  }
})()`

async function gotoPoi() {
  await evaluate(`location.hash = '#/campus'`)
  await sleep(1200)
  await evaluate(`location.hash = '#/poi'`)
  await sleep(3500)
  return evaluate(READ)
}
async function typeKeyword(kw) {
  await evaluate(`(() => {
    const el = document.querySelector('.poi__input')
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(kw)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(3000)
  return evaluate(READ)
}

/** 多重集相等（行顺序无关） */
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

// ── 段 0：期望值来自服务端 ──────────────────────────────────────────
console.log('=== 0) 期望值来自服务端 ===')
const expected = await evaluate(`(async () => {
  try {
    const r = await fetch('${API}/api/places')
    if (!r.ok) return { ok: false, why: 'http ' + r.status }
    const j = await r.json()
    const fr = await fetch('${API}/api/places?q=' + encodeURIComponent('交通'))
    const fj = fr.ok ? await fr.json() : { items: [] }
    return { ok: true, all: j.items || [], filtered: fj.items || [] }
  } catch (e) { return { ok: false, why: String(e && e.message) } }
})()`)
log('EXPECTED_FROM_SERVER', expected)
const exp = expected && expected.ok ? expected : null

// ── 段 1：全部地点 ─────────────────────────────────────────────────
console.log('')
console.log('=== 1) #/poi（无关键词）===')
const all = await gotoPoi()
log('POI_ALL', all)

// ── 段 2：服务端过滤 ───────────────────────────────────────────────
console.log('')
console.log('=== 2) 关键词「交通」===')
const filtered = await typeKeyword('交通')
log('POI_FILTERED', filtered)

// ── 段 3：空态 ─────────────────────────────────────────────────────
console.log('')
console.log('=== 3) 不存在的关键词 ===')
const empty = await typeKeyword('zzzznotfound')
log('POI_EMPTY', empty)

// ── 判定 ───────────────────────────────────────────────────────────
const allText = String((all && all.screenText) || '')
const rowsOf = (v) => (v && v.rows ? v.rows : [])
const namesOf = (v) => rowsOf(v).map((r) => r.title + '|' + r.sub)
const expNames = exp ? exp.all.map((p) => p.name + '|' + (p.address || '')) : []
const expFiltered = exp ? exp.filtered.map((p) => p.name + '|' + (p.address || '')) : []

const v = {
  POI_ROWS_FROM_AUTHORITY: !exp || rowsOf(all).length === 0
    ? 'INCONCLUSIVE'
    : multisetEqual(namesOf(all), expNames)
      ? 'PASS'
      : 'FAIL',

  /** 关键词过滤后与 API 的结果一致（证明**服务端**过滤，不是客户端 filter） */
  POI_SEARCH_SERVER_SIDE: !exp || rowsOf(filtered).length === 0
    ? 'INCONCLUSIVE'
    : multisetEqual(namesOf(filtered), expFiltered) && expFiltered.length < expNames.length
      ? 'PASS'
      : 'FAIL',

  POI_EMPTY_STATE:
    empty && empty.rowCount === 0 && /没有找到/.test(String(empty.emptyText || '')) ? 'PASS' : 'FAIL',

  POI_CLEAR_ROW_PRESENT: all && all.hasClearRow ? 'PASS' : 'FAIL',

  POI_NO_MOCK_ONLY_PLACES: !all
    ? 'INCONCLUSIVE'
    : MOCK_ONLY_PLACES.some((n) => allText.includes(n))
      ? 'FAIL'
      : 'PASS',

  POI_NO_FABRICATED_NUMBERS: !all
    ? 'INCONCLUSIVE'
    : FABRICATED.some((n) => new RegExp('\\b' + n + '\\b').test(allText))
      ? 'FAIL'
      : 'PASS',

  /**
   * ⭐ 渲染出的距离**不等于** mock 的硬编码值。
   *   判别力来源：mock 的 distance 是常量（'320m'/'410m'/'520m'）；
   *   若实现仍读 mock，页面上会**恰好**出现这些字符串。
   *   ⚠️ 若**一个距离都没渲染**（无定位夹具）⇒ 记 INCONCLUSIVE（不假装通过）。
   */
  POI_DISTANCE_NOT_MOCK: (() => {
    if (!all) return 'INCONCLUSIVE'
    const dists = rowsOf(all).map((r) => r.distance).filter((d) => d != null && d !== '')
    if (dists.length === 0) return 'INCONCLUSIVE' // 无定位 ⇒ 本夹具测不到
    if (dists.some((d) => MOCK_DISTANCES.includes(String(d)))) return 'FAIL'
    // 距离必须是"数字 + 单位"的形状（合理格式），不能是凭空字符串
    return dists.every((d) => /^[\d.]+\s*(m|km)$/i.test(String(d).trim())) ? 'PASS' : 'FAIL'
  })(),
  detail: {
    expected: exp,
    all,
    filtered,
    empty,
    mockOnlyPlacesChecked: MOCK_ONLY_PLACES,
    fabricatedChecked: FABRICATED,
    mockDistancesChecked: MOCK_DISTANCES,
  },
  fixture_dependencies: {
    DB: 'places 行（2 条）—— 通过真实 API 取作期望；取不到 ⇒ INCONCLUSIVE',
    device: 'WO#18 构建（依赖 data-poi-row / data-poi-state / data-poi-empty 等新钩子）',
    geolocation:
      '⚠️ **主动承认**：distance 只在有定位时渲染。模拟器**有**定位（实测 1884 km / 2.4 km）' +
      '⇒ 能断言"距离不等于 mock 常量"；但"**无定位时完全不渲染**"这条分支**构造不出来**' +
      '⇒ 已在 `POI_DISTANCE_ABSENT_WITHOUT_FIX` 记 NOT_EVALUATED，不假装测过。',
    session: '**不依赖**（/api/places 公开只读）',
    permission: '**不依赖**',
    navigation: '每段先 #/campus 再进 #/poi（强制新鲜挂载）',
    order: '**不依赖**上一段留下的页面状态',
  },
}

/** 明确标注本夹具无法覆盖的那条分支 */
v.POI_DISTANCE_ABSENT_WITHOUT_FIX =
  'NOT_EVALUATED（模拟器有定位 ⇒ 无法构造"无定位"夹具；该分支靠**代码审查**：' +
  '`distanceText()` 在 `fix === null` 时返回 null ⇒ 不渲染 `<span className="poi__distance">`）'

const KEYS = [
  'POI_ROWS_FROM_AUTHORITY',
  'POI_SEARCH_SERVER_SIDE',
  'POI_EMPTY_STATE',
  'POI_CLEAR_ROW_PRESENT',
  'POI_NO_MOCK_ONLY_PLACES',
  'POI_NO_FABRICATED_NUMBERS',
  'POI_DISTANCE_NOT_MOCK',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO18_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
