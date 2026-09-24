/**
 * ⭐ WO#17 门禁：动态**身份完整性**（审核 62 定为第一优先的 A1）
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐ Fixture 依赖声明（审核 61 的硬要求："新增或修改 Gate 时，必须声明它依赖哪些
 *    session / permission / DB / device state，并自行建立这些 fixture"）
 * ════════════════════════════════════════════════════════════════════
 *   依赖项                        本 Gate 如何**自行建立/验证**
 *   ───────────────────────────  ──────────────────────────────────────────────
 *   DB：**种子动态的正文**（4 条）  ① 通过真实 API 取 `GET /api/posts` 作为
 *                                  "什么算一条真实动态"的**期望**（不硬编码正文）
 *                                  ⚠️ 取不到 ⇒ 记 INCONCLUSIVE，**不**假装通过
 *   网络可达                      ② 同上（取不到就是 INCONCLUSIVE）
 *   Device：WO#17 构建            ③ 断言要求出现 `data-cd-state` / `data-cd-author`
 *                                  等**新加的钩子**；旧包没有 ⇒ 必然 FAIL
 *                                  （不会"用旧包假装通过"）
 *   session / permission          ④ **不依赖**（/api/posts 与 /api/posts/:id 均匿名可读）
 *   导航起始状态                  ⑤ 每次断言前先导航到 `#/campus` 再进目标页，
 *                                  强制新鲜挂载（本项目已两度因"同 hash 不重挂载"出假结果）
 *   order                         ⑥ 各段各自显式导航，**不依赖**上一段留下的页面
 *
 * ════════════════════════════════════════════════════════════════════
 * 核心判据（审核 62 给的定义，原文）
 * ════════════════════════════════════════════════════════════════════
 *   > "**请求/点击的是 post A，页面显示的是 post B** ⇒ 属于 identity corruption。"
 *   ⇒ 所以判据是：**目标 id 不存在时，页面上不得出现任何其它动态的内容**。
 *     改前 `posts.find(p => p.id === id) ?? posts[0]` 会显示 mock 第一条 —— 会被抓到。
 *
 * ════════════════════════════════════════════════════════════════════
 * 断言（5 键）
 * ════════════════════════════════════════════════════════════════════
 *   MISSING_ID_NO_ENTITY_LEAK_FEED_COMMENTS  #/feed?id=<不存在> ⇒ 整页（含内联评论区）不出现任何真实动态正文
 *   MISSING_ID_NO_ENTITY_LEAK_FEED      #/feed?id=<不存在>     ⇒ 同上
 *   SAME_IDENTITY_ACROSS_SCREENS        同一有效 id ⇒ 两屏作者**一致**（同一实体）
 *   COMMENTS_COUNT_FROM_AUTHORITY       评论屏的「评论 N」== 该动态在**API** 的评论总数
 *   NO_MOCK_COMMENT_CONTENT             0 评论的动态 ⇒ 必须显示空态
 *                                       （mock 的 comments 是非空的 ⇒ 仍读 mock 就会露出行）
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo17-gate.json'
const API = 'https://8.148.156.146'
const MISSING = 'deadbeef-0000-4000-8000-000000000000'

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

/** 读页面：含本次新增的钩子（旧包没有 ⇒ 必然 FAIL） */
const READ = `(() => {
  const q = (s) => document.querySelector(s)
  const el = q('[data-cd-state]')
  const txt = (q('.screen') || document.body).innerText
  /*
    ⭐ WO#19：评论区的观测点已迁到 **FeedDetail 的真实评论表面** ——
      它的 markup 是 .feed__comments-title（「评论 N」）与 .feed__noComments（空态），
      **不是** 我为旧 CommentsScreen 加的 data-cd-* 钩子。
      ⚠️ 这里修过我上一版的疏漏：上一版只把**导航**迁到了 #/feed，
        却仍读旧屏的 data-cd-count ⇒ 两条断言 INCONCLUSIVE（读不到值＝等于没在测）。
        INCONCLUSIVE 而不是 PASS 说明没伪装成通过，但**必须补完**：
        **迁观测点时要一并迁"读取的具体节点"**。
  */
  const ft = q('.feed__comments-title')
  const fn = q('.feed__noComments')
  const legacyCount = q('[data-cd-count]')
  return {
    hash: location.hash,
    cdState: el ? el.getAttribute('data-cd-state') : fn ? 'empty' : null,
    author: q('[data-cd-author]') ? q('[data-cd-author]').getAttribute('data-cd-author') : null,
    countText: (ft || legacyCount) ? (ft || legacyCount).innerText.replace(/\\s+/g,' ').trim() : null,
    hasCommentTitle: !!ft,
    hasNoCommentsText: !!fn,
    cmtBodies: [...document.querySelectorAll('.cmt[data-comment-id]')].map((n) => (n.querySelector('.cmt__text')||{}).innerText || ''),
    repliesOf: [...document.querySelectorAll('[data-replies-of]')].map((n) => n.getAttribute('data-replies-of')),
    /*
      ⭐ WO#19：回复的**嵌套归属关系**（不只看"有没有容器"，而是看 DOM 包含关系）。
      flatReplies = 有 .cmt--reply 但**不在**任何 [data-replies-of] 容器内的那些
        ⇒ 非空即说明"回复被平铺到顶层"，应判 FAIL。
    */
    nested: (() => {
      const containers = [...document.querySelectorAll('[data-replies-of]')]
      const allReplies = [...document.querySelectorAll('.cmt--reply')]
      const nestedReplies = allReplies.filter((r) => containers.some((c) => c.contains(r)))
      const flatReplies = allReplies.filter((r) => !containers.some((c) => c.contains(r)))
      return { containers: containers.length, allReplies: allReplies.length, nested: nestedReplies.length, flat: flatReplies.length }
    })(),
    text: txt.replace(/\\s+/g,' ').trim().slice(0, 600),
    hasHooks: !!q('[data-cd-state]') || !!q('[data-cd-count]') || !!q('[data-cd-author]') || !!ft,
  }
})()`

async function goto(hash) {
  await evaluate(`location.hash = '#/campus'`)
  await sleep(1200)
  await evaluate(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(3200)
  return evaluate(READ)
}

// ── 段 0：期望值来自服务端 ───────────────────────────────────────────
console.log('=== 0) 期望值来自服务端（不硬编码正文/计数）===')
const expected = await evaluate(`(async () => {
  try {
    const r = await fetch('${API}/api/posts')
    if (!r.ok) return { ok: false, why: 'posts http ' + r.status }
    const j = await r.json()
    const items = j.items || []
    const out = []
    for (const p of items.slice(0, 6)) {
      const cr = await fetch('${API}/api/posts/' + encodeURIComponent(p.id) + '/comments')
      const cj = cr.ok ? await cr.json() : { total: null }
      out.push({ id: p.id, author: p.author, body: p.body, total: cj.total })
    }
    /*
      ⭐ WO#19：额外找出**确实带回复**的动态（用于嵌套断言）。
        判据来自**服务端**：该动态的评论里存在 parentId 非空者 ⇒ 有嵌套可测。
        ⚠️ 不硬编码 id —— 换种子后本段仍然有效。
    */
    const postsWithReplies = []
    for (const p of out) {
      const cr = await fetch('${API}/api/posts/' + encodeURIComponent(p.id) + '/comments')
      if (!cr.ok) continue
      const cj = await cr.json()
      const hasReply = (cj.items || []).some((c) => (c.replies || []).length > 0)
      if (hasReply) postsWithReplies.push(p.id)
    }
    return { ok: true, items: out, postsWithReplies }
  } catch (e) { return { ok: false, why: String(e && e.message) } }
})()`)
log('EXPECTED_FROM_SERVER', expected)

const exp = expected && expected.ok ? expected : null
const realBodies = exp ? exp.items.map((p) => String(p.body)) : []
/** 页面上是否出现了**某条真实动态**的正文前 12 字 */
function leakedBodies(view) {
  if (!view || !view.text) return []
  const t = String(view.text)
  return realBodies.filter((b) => b.length >= 6 && t.includes(b.slice(0, 12)))
}

// ── 段 1：不存在的 id（两屏）────────────────────────────────────────
console.log('')
/*
  ⭐ WO#19：本段原为 #/comments（该产品路由已按审核 65 删除）。
    现在观测 **FeedDetail 的真实评论表面** —— 因为评论区**内联在 #/feed 里**。
    ⚠️ 判据不变：不存在的 id 下，**整页（含评论区）不得出现任何真实动态正文**。
*/
console.log('=== 1) #/feed?id=<不存在>：整页（含内联评论区）不得出现任何真实动态正文 ⭐ ===')
const commentsMissing = await goto(`#/feed?id=${MISSING}`)
log('COMMENTS_MISSING', commentsMissing)
const leakC = leakedBodies(commentsMissing)

console.log('')
console.log('=== 2) #/feed?id=<不存在>：同上 ===')
const feedMissing = await goto(`#/feed?id=${MISSING}`)
log('FEED_MISSING', feedMissing)
const leakF = leakedBodies(feedMissing)

// ── 段 3~5：有效 id ────────────────────────────────────────────────
console.log('')
console.log('=== 3) 有效 id：两屏作者应一致（同一实体）===')
let commentsReal = null
let feedReal = null
const zeroComment = exp ? exp.items.find((p) => p.total === 0) : null
if (exp && exp.items[0]) {
  /*
    ⭐ WO#19：原来这里分别打开 #/comments 与 #/feed 两屏做"身份一致"比较。
      独立评论页已删除 ⇒ 只在 **FeedDetail 一屏**上观测（评论区内联在内）。
  */
  feedReal = await goto(`#/feed?id=${exp.items[0].id}`)
  commentsReal = feedReal
  log('COMMENTS_REAL', commentsReal)
  log('FEED_REAL', feedReal)
}
/*
  ⭐ WO#19：为"带回复的动态"单独取一次页面（嵌套断言的观测样本）。
    若服务端没有这样的样本 ⇒ replyPostView 为 null ⇒ 该键 INCONCLUSIVE。
*/
let replyPostView = null
const replyPostId = exp && exp.postsWithReplies ? exp.postsWithReplies[0] : null
if (replyPostId) {
  replyPostView = await goto(`#/feed?id=${replyPostId}`)
  log('FEED_WITH_REPLIES', replyPostView)
}
if (zeroComment) {
  console.log('  （0 评论的动态：' + zeroComment.id.slice(0, 8) + ' / total=' + zeroComment.total + '）')
}

// ── 判定 ───────────────────────────────────────────────────────────
const hasNewHooks = !!(commentsMissing && commentsMissing.hasHooks) || !!(commentsReal && commentsReal.hasHooks)

/**
 * 不存在的 id ⇒ 应处于明确的"无实体"态，且**不泄漏任何真实动态正文**。
 *
 * ⚠️ 这里修过我自己的**断言口径错**（本 Gate 首跑就抓到）：
 *    第一版要求 `view.hasHooks`（即存在 `data-cd-*` 钩子）—— 但那些钩子当时只加在
 *    **CommentsScreen** 上，FeedDetailScreen 没有 ⇒ feed 侧两条断言**必然 FAIL**，
 *    而实际实现是对的（feed 侧文本确实是"这条动态不存在…"，且零泄漏）。
 *    ⇒ 断言写成了"依赖某个屏专有的钩子"，而不是"检验身份契约本身"。
 *    现在改为**与实现无关**：只看
 *      ① 页面里有没有出现任何真实动态的正文（⇒ 泄漏）
 *      ② 有没有给出**明确**的"无此内容/加载失败"状态（不能白屏）
 *    钩子缺失**只降级为证据强度信息**（记进 detail），不再当 FAIL。
 */
function noLeakVerdict(view, leak) {
  if (!view || !view.hash) return 'INCONCLUSIVE'
  if (leak.length > 0) return 'FAIL' // 泄漏了别的实体 —— 正是被修的漏洞
  const explicitState =
    view.cdState === 'not_found' ||
    view.cdState === 'error' ||
    /不存在|加载失败|网络错误|重试|刷新/.test(String(view.text))
  return explicitState ? 'PASS' : 'FAIL' // 没泄漏也**必须**给出明确状态，不能白屏
}

/**
 * 从**页面文本**推导"这一屏正在显示谁"（与实现无关：不依赖任何钩子）。
 * 做法：拿该 id 在服务端的**作者名**去页面文本里找 —— 找到即认为显示了该实体。
 * ⚠️ 这是"用服务端事实做期望"的一贯做法，不硬编码。
 */
function displayedAuthorFromText(view, apiAuthor) {
  if (!view || !view.text || !apiAuthor) return null
  return String(view.text).includes(apiAuthor) ? apiAuthor : null
}

const v = {
  /* ⭐ WO#19：本键观测点已迁到 FeedDetail 的**内联评论区**（原 #/comments 已删） */
  MISSING_ID_NO_ENTITY_LEAK_FEED_COMMENTS: noLeakVerdict(commentsMissing, leakC),
  MISSING_ID_NO_ENTITY_LEAK_FEED: noLeakVerdict(feedMissing, leakF),
  /**
   * ⭐ WO#19 取代 `SAME_IDENTITY_ACROSS_SCREENS`：
   *   独立评论页已删 ⇒ "两屏一致"不再有意义（只有一个屏）。
   *   改为断言**评论区内联在 FeedDetail 同一页**（这正是本 WO 的结构目标）：
   *     · URL 仍是 `#/feed?id=...`（没有跳到独立评论路由）
   *     · 同一页上同时出现：动态正文 + 「评论 N」+（0 评论时空态文字）
   *   ⚠️ 判据取自**权威**：N 与 API 的 total 比较（见下一条），此处只看"在同一页"。
   */
  COMMENTS_INLINE_IN_FEED: (() => {
    if (!feedReal || !exp) return 'INCONCLUSIVE'
    const t = String(feedReal.text || '')
    const samePage = /^#\/feed\?id=/.test(String(feedReal.hash || ''))
    const hasPostBody = t.includes(String(exp.items[0].body).slice(0, 10))
    const hasCommentTitle = /评论\s*\d+/.test(t)
    return samePage && hasPostBody && hasCommentTitle ? 'PASS' : 'FAIL'
  })(),
  /**
   * ⭐ WO#19：**回复必须嵌套在父评论内部**（M3 的"决定性证据"）。
   *   判据：存在 [data-replies-of] 容器，且其中的回复行**确实**是该容器的后代
   *        （父评论行 .cmt 之内），**且不得**有"不在任何容器内"的回复行。
   *   ⚠️ 这比"有嵌套容器"更强：平铺实现可能渲染空容器或把回复放在容器外。
   *   ⚠️ 需要**有回复的样本**；没有样本 ⇒ INCONCLUSIVE（不假装通过）。
   */
  REPLIES_NESTED_IN_PARENT: (() => {
    /*
      ⭐ 观测点改为**确实带回复**的那条动态（从 API 推导，不硬编码）。
      ⚠️ 上一版绑在 feedReal（= exp.items[0]，实测 total=0）⇒ 没样本 ⇒ INCONCLUSIVE。
    */
    /*
      ⚠️ 本键修过一次"判别力"缺陷（敏感度抓出）：第一版把 containers===0 当作
         "没样本" ⇒ INCONCLUSIVE。但**我们能走到这里，就说明 API 已确认该动态有回复**
         （它选自 exp.postsWithReplies）⇒ "该有嵌套结构却没有" 必须是 **FAIL**。
      ⇒ 只有"服务端确实没有任何带回复的动态可选"时才是 INCONCLUSIVE（此时 view 为 null）。
    */
    const view = replyPostView
    if (!view || !view.nested) return 'INCONCLUSIVE' // 连页面都没取到
    const n = view.nested
    /* API 既然给了带回复的动态（replyPostId 存在）⇒ 页面必须真有嵌套结构 */
    const apiSaidHasReplies = !!replyPostId
    if (n.containers === 0 || n.allReplies === 0) {
      return apiSaidHasReplies ? 'FAIL' : 'INCONCLUSIVE'
    }
    return n.flat === 0 && n.nested === n.allReplies ? 'PASS' : 'FAIL'
  })(),
  /**
   * 评论区的「评论 N」== API 的评论总数（不读 mock）。
   * ⭐ WO#19：观测点 = **FeedDetail 的** .feed__comments-title（旧屏已删）。
   */
  COMMENTS_COUNT_FROM_AUTHORITY: (() => {
    /*
      ⚠️ 本键也修过判别力缺陷：第一版 countText===null 就 INCONCLUSIVE，
         于是"「评论 N」整块消失"反而被判成"没样本"。
      ⇒ API 明确给了 total（是个数）⇒ 页面**必须**有可解析的计数文本，否则 **FAIL**。
    */
    const view = feedReal || commentsReal
    if (!view || !exp) return 'INCONCLUSIVE' // 页面/期望都没拿到
    const apiTotal = Number(exp.items[0].total)
    if (!Number.isFinite(apiTotal)) return 'INCONCLUSIVE'
    if (!view.countText) return 'FAIL' // API 有基准，页面却没有计数文本
    const shown = Number(String(view.countText).replace(/[^0-9]/g, ''))
    return shown === apiTotal ? 'PASS' : 'FAIL'
  })(),
  /**
   * ⭐ 0 评论的动态必须显示**空态**。
   *   为什么这条有判别力：mock 的 `comments` 数组是**非空**的 ⇒
   *   若实现仍读 mock，这里会渲染出评论行而不是空态。
   * ⭐ WO#19：空态与"零评论行"都改在 **FeedDetail 的真实评论表面**上判：
   *   `.feed__noComments` 存在，且 `.cmt[data-comment-id]` 行数为 0。
   */
  /*
    ⚠️ 本键修过判别力缺陷：第一版要求 `hasNewHooks`（钩子存在），
       而突变把整个评论区换掉后钩子全没了 ⇒ hasNewHooks=false ⇒ INCONCLUSIVE
       ⇒ **"评论区被换成 mock"这种最该抓的情况反而没被抓住**。
    ⇒ 改为：只要 **API 给出了 0 评论的动态**，页面就**必须**满足
       「评论 0」+ 空态 + 零评论行；任一不满足即 FAIL。
  */
  NO_MOCK_COMMENT_CONTENT: !zeroComment
    ? 'INCONCLUSIVE'
    : await (async () => {
        const view = await goto(`#/feed?id=${zeroComment.id}`)
        log('COMMENTS_ZERO_COMMENT_POST', view)
        const countOk = /评论\s*0/.test(String(view.countText || ''))
        const emptyOk =
          view.hasNoCommentsText === true || /还没有评论|留下你的评论吧/.test(String(view.text))
        const noRows = (view.cmtBodies || []).length === 0
        return countOk && emptyOk && noRows ? 'PASS' : 'FAIL'
      })(),
  detail: {
    expected: exp,
    commentsMissing,
    feedMissing,
    leakC,
    leakF,
    commentsReal,
    feedReal,
    zeroComment: zeroComment ? { id: zeroComment.id, total: zeroComment.total } : null,
    replyPostId: replyPostId || null,
    replyPostView: replyPostView || null,
    /** 钩子可用性：只作**证据强度**信息，不作判定依据（见 noLeakVerdict 上方说明） */
    hookAvailability: {
      comments: !!(commentsReal && commentsReal.hasHooks),
      feed: !!(feedReal && feedReal.hasHooks),
    },
  },
  fixture_dependencies: {
    DB: '种子动态正文（4 条）—— 通过真实 API 取作期望；取不到 ⇒ INCONCLUSIVE',
    device: 'WO#17 构建（依赖 data-cd-state / data-cd-author / data-cd-count / data-cmt-body 等新钩子）',
    session: '**不依赖**（/api/posts 与 /api/posts/:id 匿名可读）',
    permission: '**不依赖**',
    navigation: '每段各自显式导航（先 #/campus），强制新鲜挂载',
    order: '**不依赖**上一段留下的页面状态',
  },
}

const KEYS = [
  'MISSING_ID_NO_ENTITY_LEAK_FEED_COMMENTS',
  'MISSING_ID_NO_ENTITY_LEAK_FEED',
  'COMMENTS_INLINE_IN_FEED',
  'REPLIES_NESTED_IN_PARENT',
  'COMMENTS_COUNT_FROM_AUTHORITY',
  'NO_MOCK_COMMENT_CONTENT',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO17_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
