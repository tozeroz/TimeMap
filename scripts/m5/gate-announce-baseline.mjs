/**
 * A5 门禁：群公告屏（`announce`）对齐基线 observed + **无编造内容**
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么有这一单（A5 机械切片的第一刀就抓到它）
 * ════════════════════════════════════════════════════════════════════
 *   原版基线（observed）：
 *   ```
 *     interactions = ["顶部标题「校园活动」+ 左上返回", "**内容区为空**"]
 *     navigation   = ["返回 → 上一页"]
 *   ```
 *   改前我们：标题「校园公告」＋渲染 **3 条编造的公告**（含正文与时间，全部无出处）。
 *   ⚠️ 这条偏差**从未被核对过** —— Round 261 的忠实度审计只逐条核对了 4 个屏。
 *
 * ════════════════════════════════════════════════════════════════════
 * Fixture 依赖
 * ════════════════════════════════════════════════════════════════════
 *   Device：本轮构建（依赖 data-announce-empty 钩子）
 *   导航：真实入口（MoreScreen「校园公告」）+ 直接路由兜底
 *   DB/session/permission：**不依赖** ／ 顺序：**不依赖**
 *
 * 断言（4 键）：
 *   ANNOUNCE_TITLE_MATCHES_BASELINE   顶部标题为「校园活动」（不是「校园公告」）
 *   ANNOUNCE_NO_FABRICATED_CONTENT    ⭐ 不出现那 3 条编造公告的**任何**特征串
 *   ANNOUNCE_EMPTY_STATE_PRESENT      显示如实空态（与 observed"内容区为空"一致）
 *   ANNOUNCE_BACK_LEFT               左上仍是"返回"（基线："左上返回"）
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\announce-gate.json'

/** 那 3 条**编造公告**的特征串（出现任一即说明没清干净） */
const FABRICATED = [
  '校园广场内容规范更新',
  '图书馆四楼自习区开放时间调整',
  '新生校园卡领取提醒',
  '请勿发布与校园生活无关的营销内容',
  '学生服务中心 2 号窗口',
]

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
  const bar = q('.topbar') || q('.screen')
  return {
    hash: location.hash,
    center: q('.topbar__center') ? q('.topbar__center').innerText.replace(/\\s+/g,' ').trim() : null,
    barText: bar ? bar.innerText.replace(/\\s+/g,' ').trim().slice(0, 200) : '',
    hasEmptyHook: !!q('[data-announce-empty]'),
    /* 编造公告会渲染成 .ann__item；结算时用它判"还有没有列表" */
    itemCount: document.querySelectorAll('.ann__item').length,
    backLabel: q('button[aria-label="返回"]') ? '返回' : q('button[aria-label="关闭"]') ? '关闭' : null,
    text: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 400),
  }
})()`

console.log('=== 1) 进入群公告屏（真实入口：更多 → 校园公告）===')
await evaluate(`location.hash = '#/more'`)
await sleep(2000)
const clicked = await evaluate(`(() => {
  const hit = [...document.querySelectorAll('button, a, li')].find((n) => (n.innerText || '').includes('校园公告'))
  if (hit) { hit.click(); return true }
  return false
})()`)
await sleep(2500)
let view = await evaluate(READ)
log('NAV_BY_ENTRY', { clicked, view })
if (!view || !view.hash.includes('announce')) {
  /* 兜底：直接路由（但记录"入口没走通"这一事实） */
  await evaluate(`location.hash = '#/announce'`)
  await sleep(2200)
  view = await evaluate(READ)
  log('NAV_BY_ROUTE', { view })
}
log('ANNOUNCE_PAGE', view)

const v = {
  ANNOUNCE_TITLE_MATCHES_BASELINE:
    view && String(view.center || '').includes('校园活动') ? 'PASS' : 'FAIL',

  /** ⭐ 编造内容必须全部消失（同时看 DOM 条数与文本） */
  ANNOUNCE_NO_FABRICATED_CONTENT: (() => {
    if (!view) return 'INCONCLUSIVE'
    const t = String(view.text || '')
    return FABRICATED.some((s) => t.includes(s)) || view.itemCount > 0 ? 'FAIL' : 'PASS'
  })(),

  ANNOUNCE_EMPTY_STATE_PRESENT: view && view.hasEmptyHook ? 'PASS' : 'FAIL',

  ANNOUNCE_BACK_LEFT: view && view.backLabel === '返回' ? 'PASS' : 'FAIL',

  detail: { view, fabricatedChecked: FABRICATED },
  fixture_dependencies: {
    device: '本轮构建（依赖 data-announce-empty 钩子）',
    navigation: '真实入口 MoreScreen「校园公告」；失败时用直接路由兜底并**记录**',
    db: '**不依赖**',
    session: '**不依赖**',
    permission: '**不依赖**',
    order: '**不依赖**',
  },
}

const KEYS = [
  'ANNOUNCE_TITLE_MATCHES_BASELINE',
  'ANNOUNCE_NO_FABRICATED_CONTENT',
  'ANNOUNCE_EMPTY_STATE_PRESENT',
  'ANNOUNCE_BACK_LEFT',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.ANNOUNCE_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
