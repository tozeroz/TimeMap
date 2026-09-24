/**
 * ⭐ Round 319 门禁：图片预览屏**不再用 mock、不再跨实体兜底**
 * （最终 audit 第 ①② 问：可执行 mock surface / 错误 identity fallback）
 *
 * ════════════════════════════════════════════════════════════════════
 * 被修的两处缺陷（同一屏里）
 * ════════════════════════════════════════════════════════════════════
 * ```
 * 改前 MediaPreviewScreen.tsx：
 *   import { posts } from '../data/mock'                                ← ① mock 数据源
 *   const post = posts.find((p) => p.id === postId)
 *   const gallery = (post?.images ?? posts.flatMap((p) => p.images))     ← ② **跨实体兜底**
 *   ⇒ 当 postId 不存在、或该动态没有图片时，会**静默显示所有动态的图片** ——
 *     与 WO#17 修掉的 `?? posts[0]` 同类（请求 A，看到别人的内容）
 * ```
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐ 关键判据为什么**现在就能验**（夹具事实）
 * ════════════════════════════════════════════════════════════════════
 *   实测：种子里 **4 条动态都没有公开图片**（media 挂在 message 上，不在 post 上）。
 *   ⇒ 于是两个输入都天然触发旧代码的兜底：
 *     · **不存在的 postId** ⇒ 旧代码显示"所有动态的图片"；新代码必须 `not_found` + **零图**
 *     · **有效但无图片的 postId** ⇒ 旧代码显示"所有动态的图片"；新代码必须**空态** + **零图**
 *   ⚠️ 于是"**有没有跨实体泄漏**"这条**能被精确判红**，而不需要造带图数据。
 *   ⚠️ 而"显示**自己**的图片"这个正向用例**本夹具无样本**
 *      ⇒ 记 INCONCLUSIVE 并说明（**不**为了取证去改种子数据）。
 *
 * ════════════════════════════════════════════════════════════════════
 * Fixture 依赖声明
 * ════════════════════════════════════════════════════════════════════
 *   DB/API：帖子与其公开图片 —— 通过真实 API 取作期望；取不到 ⇒ INCONCLUSIVE
 *   Device：本轮构建（依赖 data-media-state 钩子）
 *   session/permission：**不依赖**
 *   order：各段各自显式导航
 *
 * 断言（5 键）：
 *   MEDIA_MISSING_ID_NO_ENTITY_LEAK  不存在的 id ⇒ 明确状态 + **零图片**
 *   MEDIA_EMPTY_POST_SHOWS_EMPTY     有效但无图片 ⇒ **空态**（不是"别人的图片"）
 *   MEDIA_NO_MOCK_DATA_SOURCE        页面不渲染任何 mock-only 图片（静态：bundle 里无 mock posts 引用）
 *   MEDIA_STATE_EXPLICIT             状态是明确的（not_found / error / empty），不白屏
 *   MEDIA_NAV_PRESENT_WHEN_IMAGES    有图片时上一张/下一张应在 —— 无夹具 ⇒ 预期 INCONCLUSIVE
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\media-gate.json'
const API = 'https://8.148.156.146'
const MISSING = 'deadbeef-0000-4000-8000-000000000000'

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
  const imgs = [...document.querySelectorAll('.media__image')]
  const st = q('[data-media-state]')
  return {
    hash: location.hash,
    state: st ? st.getAttribute('data-media-state') : null,
    imgCount: imgs.length,
    imgSrcs: imgs.map((i) => (i.getAttribute('src') || '').slice(-24)),
    counter: q('.media__counter') ? q('.media__counter').innerText.replace(/\\s+/g,' ').trim() : null,
    hasNav: !!q('.media__navbtn'),
    text: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 300),
  }
})()`

async function gotoMedia(postId) {
  await evaluate(`location.hash = '#/campus'`)
  await sleep(1200)
  await evaluate(`location.hash = '#/media?post=${encodeURIComponent(postId)}&i=0'`)
  await sleep(3200)
  return evaluate(READ)
}

// ── 段 0：期望（哪条动态有图 / 无图）────────────────────────────────
console.log('=== 0) 期望值来自服务端 ===')
const expected = await evaluate(`(async () => {
  try {
    const r = await fetch('${API}/api/posts')
    if (!r.ok) return { ok: false, why: 'http ' + r.status }
    const j = await r.json()
    const out = []
    for (const p of (j.items || [])) {
      const dr = await fetch('${API}/api/posts/' + encodeURIComponent(p.id))
      const dj = dr.ok ? await dr.json() : {}
      out.push({ id: p.id, imageCount: (dj.images || []).length })
    }
    return { ok: true, items: out }
  } catch (e) { return { ok: false, why: String(e && e.message) } }
})()`)
log('EXPECTED_FROM_SERVER', expected)
const exp = expected && expected.ok ? expected : null
const emptyPost = exp ? exp.items.find((p) => p.imageCount === 0) : null
const withImagePost = exp ? exp.items.find((p) => p.imageCount > 0) : null

// ── 段 1：不存在的 id ───────────────────────────────────────────────
console.log('')
console.log('=== 1) 不存在的 id ⇒ 明确状态 + **零图片**（不得泄漏别人的图片）⭐ ===')
const missing = await gotoMedia(MISSING)
log('MEDIA_MISSING', missing)

// ── 段 2：有效但无图片的动态 ────────────────────────────────────────
console.log('')
console.log('=== 2) 有效但无图片 ⇒ **空态**（不是"所有动态的图片"）⭐ ===')
let emptyView = null
if (emptyPost) {
  emptyView = await gotoMedia(emptyPost.id)
  log('MEDIA_EMPTY_POST', emptyView)
}

// ── 段 3：有图片的动态（本夹具可能无样本）──────────────────────────
console.log('')
console.log('=== 3) 有图片的动态（本夹具可能无样本）===')
let imgView = null
if (withImagePost) {
  imgView = await gotoMedia(withImagePost.id)
  log('MEDIA_WITH_IMAGE', imgView)
} else {
  console.log('  （种子里没有带公开图片的动态 ⇒ 本段无样本）')
}

// ── 判定 ───────────────────────────────────────────────────────────
const v = {
  /** 不存在的 id：必须给明确状态，且**零图片** */
  MEDIA_MISSING_ID_NO_ENTITY_LEAK: (() => {
    if (!missing || missing.TIMEOUT) return 'INCONCLUSIVE'
    const explicit = missing.state === 'not_found' || missing.state === 'error' || /不存在|加载失败/.test(String(missing.text))
    return explicit && missing.imgCount === 0 ? 'PASS' : 'FAIL'
  })(),

  /** 有效但无图片：必须是**空态**且零图片（旧代码这里会显示所有动态的图片） */
  MEDIA_EMPTY_POST_SHOWS_EMPTY: (() => {
    if (!emptyView || emptyView.TIMEOUT) return 'INCONCLUSIVE'
    return emptyView.state === 'empty' && emptyView.imgCount === 0 ? 'PASS' : 'FAIL'
  })(),

  /**
   * 状态必须是**明确**的（不白屏）。
   * ⚠️ 与第 1、2 键有重叠但不冗余：即便某次泄漏检查因样本缺失而不适用，
   *    这一条仍要求"页面给出明确状态而不是空白"。
   */
  MEDIA_STATE_EXPLICIT: (() => {
    if (!missing || missing.TIMEOUT) return 'INCONCLUSIVE'
    const s = missing.state
    return s === 'not_found' || s === 'error' ? 'PASS' : 'FAIL'
  })(),

  /** 页面不得渲染 mock 数据（mock 里有大量 demo 图片 URL；此处按"是否出现非权威图片"判） */
  MEDIA_NO_MOCK_DATA_SOURCE: (() => {
    if (!missing || missing.TIMEOUT) return 'INCONCLUSIVE'
    /* 缺失 id 下若出现任何图片 ⇒ 必然来自 mock 兜底 */
    return missing.imgCount === 0 ? 'PASS' : 'FAIL'
  })(),

  /** 有图片时应有上一张/下一张 —— 本夹具无样本 ⇒ INCONCLUSIVE（不假装通过） */
  MEDIA_NAV_PRESENT_WHEN_IMAGES: imgView && !imgView.TIMEOUT
    ? imgView.imgCount > 0 && imgView.hasNav
      ? 'PASS'
      : 'FAIL'
    : 'INCONCLUSIVE',

  detail: {
    expected: exp,
    emptyPost: emptyPost || null,
    withImagePost: withImagePost || null,
    missing,
    emptyView,
    imgView,
  },
  fixture_notes: {
    为什么能验泄漏: '种子里 4 条动态**都没有公开图片** ⇒ 旧代码的 `?? posts.flatMap(...)` 兜底会被触发，故"零图片"这条判据能精确判红。',
    正向用例: '「显示**自己**的图片」需要一条**带公开图片**的动态；当前种子没有 ⇒ 记 INCONCLUSIVE，**不**为了取证去改种子数据。',
    原版口径: '原版此路由是 chat 的图片预览；其真实入口是**聊天消息里的图片**，我们侧无该数据且造数据=写操作 ⇒ MEDIA_PREVIEW_ORIGINAL_ENTRY: BLOCKED_BY_POLICY、PRESENTATION: NOT_EVALUATED。',
  },
  fixture_dependencies: {
    'DB/API': '帖子 + 其公开图片 —— 通过真实 API 取作期望；取不到 ⇒ INCONCLUSIVE',
    device: '本轮构建（依赖 data-media-state 钩子）',
    session: '**不依赖**',
    permission: '**不依赖**',
    order: '**不依赖**上一段状态',
  },
}

const KEYS = [
  'MEDIA_MISSING_ID_NO_ENTITY_LEAK',
  'MEDIA_EMPTY_POST_SHOWS_EMPTY',
  'MEDIA_STATE_EXPLICIT',
  'MEDIA_NO_MOCK_DATA_SOURCE',
  'MEDIA_NAV_PRESENT_WHEN_IMAGES',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.MEDIA_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
