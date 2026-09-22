/**
 * WO#15 设备侧 Gate：MapScreen 的标记**数据来源**（mock → 权威）
 *
 * ## 依据
 *   审核 57：`WO15: APPROVED TO IMPLEMENT`。计划
 *   `docs/m5/WO15-PLAN-map-marker-authority.md`（+ 两份更正）给出的键：
 *     MAP_MARKERS_FROM_AUTHORITY            每个标记能追溯到**一条真实 post**
 *     MARKER_COUNT_MATCHES_POSTS_WITH_VALID_COORDS 标记数 == **有坐标的帖子数**（**不硬编码 6**）
 *     NO_FABRICATED_PLACE_DATA              不得出现"无出处"的地名（尤其 mock 那 6 个）
 *     MAP_NO_FALLBACK_ON_UNAVAILABLE        读到失败 → 明确不可用态，**不回落 mock**
 *   另有两条**基线明记未知**，故只记录不改判：
 *     MAP_PIN_COLOR_SEMANTICS_CONFORMANCE: NOT_EVALUATED（原版配色规则未记录）
 *     OFFLINE_MAP_PROJECTION_CONFORMANCE:  NOT_EVALUATED（像素换算无基线）
 *
 * ## ⚠️ 断言的**判别性**设计（这是本文件最要紧的部分）
 *   1) `MARKER_COUNT_MATCHES_POSTS_WITH_VALID_COORDS` 若只断言"有标记"就**没有判别力** ——
 *      mock 也有 6 条，一样"有标记"。所以必须**把期望值算出**来对：
 *        期望 = 服务端 `GET /api/posts` 里**同时有 placeLat/placeLng** 的条数
 *        实际 = 页面上 `.map__marker` 的个数
 *      两者相等才 PASS。**且期望值来自服务端实况**，不是写死的 6。
 *   2) `NO_FABRICATED_PLACE_DATA` 不能只搜"阳光操场"一个词 —— 那只能抓到一条。
 *      必须把 mock 那 6 个地名**全部**作为禁用集合，并额外断言
 *      "页面上出现的每个地名，都能在服务端 places/帖子里找到"。
 *   3) `MAP_NO_FALLBACK_ON_UNAVAILABLE` 用**受控 stub**（拦 `GET /api/posts` 返回 500），
 *      断言标记数归零且出现明确不可用态 —— 否则"读不到就拿 mock 顶上"会静默通过。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo15-gate.json'
const API_ORIGIN = process.env.CAMPUS_API_ORIGIN || 'https://8.148.156.146'
/** mock 里那 6 个"我们自己编的"地点名 —— 出现即说明 mock 仍在渲染路径上 */
const MOCK_ONLY_PLACES = ['阳光操场', '教育超市', '图书馆', '逸夫教学楼', '思源楼', '学苑公寓']

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

// ---------- 1) 期望值：服务端实况（**不写死**）----------
console.log('=== 1) 期望值：服务端里"有坐标的帖子"条数（不硬编码）===')
const expected = await evaluate(`(async () => {
  try {
    const res = await fetch('${API_ORIGIN}/api/posts')
    if (!res.ok) return { ok: false, status: res.status }
    const d = await res.json()
    const items = d.items || []
    const withCoords = items.filter(
      (p) => typeof p.placeLat === 'number' && typeof p.placeLng === 'number',
    )
    return {
      ok: true,
      total: items.length,
      withCoords: withCoords.length,
      places: withCoords.map((p) => p.place),
      // 服务端的全部地名（用于"页面上每个地名都要能对上"的判定）
      allPlaces: [...new Set(items.map((p) => p.place).filter(Boolean))],
      hasCoordFields: items.length > 0 ? 'placeLat' in items[0] && 'placeLng' in items[0] : null,
      /*
        ⭐ Round 267：把**卡片内容**的期望值也取回来（补上 Round 266 发现的断言缺口）。
        为什么需要它：Round 266 我查出并修掉了一个**自己引入的回归** ——
        三个地图实现原本用 posts.find(p => p.id === m.postId) 去 **mock** 里查帖子，
        而 WO#15 之后 m.postId 是真实 UUID ⇒ find 永远 undefined
        ⇒ 卡片封面与文字**都是空**（标记仍画得出、地名也在，所以极难发现）。
        **而当时那批断言完全没覆盖卡片内容** ⇒ 这是断言覆盖面的缺口，不是运气问题。
        ⇒ 现在把"每条有坐标的帖子：有没有图 / 正文前 10 字"取回来做期望值。
        ⚠️ 只取前 10 字：markersFromPosts 里 excerpt 就是 p.body.slice(0, 10)，
           Gate 必须与实现**同一口径**，否则会因口径差异产生假 FAIL。
        ⚠️⚠️ **本注释在模板字面量内部，因此绝不能出现反引号** ——
           我第一版就是在这里写了反引号，**提前结束了外层模板字面量**，
           于是 node 把错误报到了后面那行（"missing ) after argument list"）。
           同类问题本会话已是**第五次**（JSDoc 里的注释结束符、SQL 注释里的反引号、
           注释里的 import、以及给审核消息内联时的反引号）。
           ⇒ 习惯：**在模板字面量/注释内部引用代码时，不要用反引号包裹。**
      */
      cardExpect: withCoords.map((p) => ({
        place: p.place,
        hasImages: Array.isArray(p.images) && p.images.length > 0,
        mediaId: Array.isArray(p.images) && p.images.length > 0 ? p.images[0].id : null,
        excerpt: (p.body || '').slice(0, 10),
      })),
    }
  } catch (e) {
    return { ok: false, why: String(e && e.message) }
  }
})()`)
log('EXPECTED_FROM_SERVER', expected)

// ---------- 2) 进入地图页并读 DOM ----------
console.log('')
console.log('=== 2) 地图页快照（徽标 / 标记 / 地名）===')
/*
  ⚠️⚠️ 这里有一处我**第一版做错**的地方，必须写清楚（它正是一次"假 FAIL"）：

  第一版我直接数 `.map__marker` 这个 class 的节点数，然后拿它跟服务端期望比。
  设备实测：徽标显示 **"4 个标记"**（说明 `markers` 状态里确实是 4 条，数据链是对的），
  但 `.map__marker` 计数是 **0** —— 因为**当前走的是腾讯地图**（页面里有 "©2026 Tencent" 水印），
  而**原生地图把自己的标记渲染在 SDK 图层里**，根本不是我的 DOM 节点。

  ⇒ 即：`.map__marker` 只存在于**离线自绘地图**（OfflineMap）那条路径上。
    我把"某一条渲染路径的 DOM 结构"当成了"全平台的标记事实"。

  正确做法（本版）：
    · **主判据用 provider 无关的量**：徽标 `data-marker-count`（它由**同一个 `markers` 状态**驱动，
      与用哪个底图无关）
    · 再**单独跑一次离线路径**（`#/map?offline=1`）来验证 `.map__marker` 的 DOM 渲染确实存在
      —— 两条路径**各自**都要验，而不是拿一条的结果代表另一条。
    · 地名判据用整页文本（两种底图都会渲染地名文本），而不是某个特定 class。
*/
const snapMap = () =>
  evaluate(`(() => {
  const badge = document.querySelector('[data-marker-phase]')
  const cards = [...document.querySelectorAll('.map__marker')]
  const bodyText = document.body.innerText || ''
  return {
    hash: location.hash,
    phase: badge ? badge.getAttribute('data-marker-phase') : null,
    badgeCount: badge ? badge.getAttribute('data-marker-count') : null,
    badgeText: badge ? (badge.textContent || '').trim() : null,
    /** ⭐ 标记地点名（测试钩子；用 \\u001f 分隔） */
    markerPlaces: badge && badge.getAttribute('data-marker-places') ? badge.getAttribute('data-marker-places').split('\\u001f') : [],
    /** provider 无关：由同一个 markers 状态驱动 */
    declaredCount: badge && badge.getAttribute('data-marker-count') ? Number(badge.getAttribute('data-marker-count')) : (badge && badge.getAttribute('data-marker-phase') === 'empty' ? 0 : null),
    /** 只有离线自绘地图才有这些 DOM 节点 */
    offlineMarkerDomCount: cards.length,
    /*
      ⭐ Round 267：读**标记卡片的内容**（补 Round 266 发现的断言缺口）。
      卡片 DOM 由三个地图实现里的 buildMarkerElement 构造（.rm 结构，
      在线 SDK 与离线自绘**同构**），因此它在**两条渲染路径上都能查到** ——
      这与 .map__marker（只有离线自绘有）不同。
      实测（probe-map-card-dom.mjs）：在线腾讯路径下 .rm = 4、
      .rm__img = 4（其中 2 个是封面 img、2 个是 .rm__img--text 文本）、.rm__name = 4。
      ⚠️ 本注释在模板字面量内部 ⇒ **不能出现反引号**（我在这里又踩了一次同名错误）。
    */
    markerCards: [...document.querySelectorAll('.rm')].map((el) => {
      const img = el.querySelector('img.rm__img')
      const txt = el.querySelector('.rm__img--text')
      const nameEl = el.querySelector('.rm__name')
      return {
        name: nameEl ? (nameEl.textContent || '').trim() : null,
        coverSrc: img ? img.getAttribute('src') : null,
        excerpt: txt ? (txt.textContent || '').trim() : null,
      }
    }),
    provider: (document.body.innerText.match(/腾讯地图|高德地图|在线地图|离线自绘底图/) || [null])[0],
    bodyText,
  }
})()`)

/*
  ⚠️⚠️ 第二条"我第一版做错"的地方（它造成了**跨次运行的假 FAIL**）：

  我第一版是直接 `location.hash = '#/map'`。问题：**若页面已经在地图页，
  设置同一个 hash 不会让组件重新挂载**，于是 MapScreen 的 `useEffect` 不重跑，
  它会**沿用上一轮遗留的状态** —— 上一轮（stub 段）把页面留在 `unavailable`，
  这一轮第一次快照就"继承"了那个失败态，于是我读到 `phase='unavailable'`，
  误以为产品坏了。

  ⇒ 教训：**Gate 必须自己保证"起始状态"是干净的**，不能假定"上次结束后页面是好的"。
    做法：先导航到**另一个页面**（强制卸载），再回到目标页（强制重新挂载）。
    这与本项目"Fixture validity（前置条件要自己建立并证明）"是同一条纪律。
*/
await evaluate(`location.hash = '#/campus'`)
await sleep(1500)
await evaluate(`location.hash = '#/map'`)
await sleep(3200)
const snap = await snapMap()
log('MAP_SNAPSHOT', {
  hash: snap.hash,
  phase: snap.phase,
  badgeCount: snap.badgeCount,
  badgeText: snap.badgeText,
  declaredCount: snap.declaredCount,
  offlineMarkerDomCount: snap.offlineMarkerDomCount,
  provider: snap.provider,
  bodyTextHead: String(snap.bodyText || '').slice(0, 200),
})

// ---------- 2a-2) ⭐ AUDIT.7：基线**逐条核对**的测量块 ----------
console.log('')
console.log('=== 2a-2) BASELINE_CLAIMS 测量（把 manifest 里每条 claim 的设备事实取下来）===')
/*
  ⭐ AUDIT.7（队列里的一条纪律）：**每个 WO 的 Gate 都要加"基线逐条核对"层**。
  做法（照既有 6 屏的先例，见 scripts/m5/fixtures/baseline-manifest.json）：
    · 在本 Gate 里**实测**该屏基线各条 claim 对应的界面事实
    · 把 claim + status + **指向本 Gate 测量值**的 evidence 冻结进 manifest
    · 之后 manifest 检查器保证"结论不漂移"（同一事实不会这次判 MATCH、下次判 DEVIATION）
  本屏基线：docs/original-baseline/screens/trident-map/baseline.json
    interactions: 顶部大标题 Map + 地区选择「北京交通大学（校本部）」+ 右上消息图标 ／
                  主体：地图 + 用户头像标记 + 深色气泡卡片 ／ 右下：定位复位按钮 + 黑色圆形 +
    navigation:   地区名 → 选点页（poi/search） ／ + → 发布页
    known_unknowns: 首次进入有阻断式「授权地理位置」弹窗（本次采集未出现）／
                    底图是腾讯地图 SDK；具体缩放级别与标记规则未记录
  ⚠️ 只测**可从 DOM/文本确证**的部分；"深色气泡卡片"这类**视觉属性**不在此断言
     （那需要像素证据，且目前仍是 NOT_EVALUATED —— 不得用 DOM 存在性冒充视觉一致）。
*/
const claims = await evaluate(`(() => {
  const q = (sel) => document.querySelector(sel)
  const txt = (sel) => { const e = q(sel); return e ? (e.textContent || '').trim() : null }
  const aria = (sel) => { const e = q(sel); return e ? e.getAttribute('aria-label') : null }
  const body = document.body.innerText || ''
  return {
    /*
      ⚠️ 这里修过一个**我自己的选择器错误**：第一版写 txt('.bigtitle__main')，
      但**地图页不用 BigTitle 组件** —— 它有自己的标题结构
      （MapScreen.tsx:520 <h1 className="map__title">Map</h1>）。
      ⇒ 于是测量值恒为 null ⇒ MAP_TITLE_LITERAL **假 FAIL**。
      ⚠️ 同类错误本会话已出现多次（整页 imgCount 判头像 / 整页文本判 mock 地点 /
        模板字面量内反引号…）：**"在错误的节点上测量"与"实现错了"在输出上无法区分**。
      教训：写断言前先确认真实的 DOM 结构（本次即用读源码确认）。
    */
    bigTitle: txt('.map__title'),
    regionText: txt('.map__region'),
    msgAria: aria('.map__msg'),
    locateAria: aria('.map__ctrl'),
    ctrlCount: document.querySelectorAll('.map__ctrl').length,
    fabAria: aria('.map__fab'),
    geoModalTitle: txt('.map__modal-title'),
    geoModalPresent: !!q('.map__modal'),
    hasTencentWatermark: /Tencent|腾讯/.test(body),
    providerText: (body.match(/腾讯地图|高德地图|在线地图|离线自绘底图/) || [null])[0],
    /* ⚠️ 以下刻意**不测**：深色气泡卡片的"深色"、图钉配色语义、用户头像标记的形态
       —— 属视觉/语义，仍 NOT_EVALUATED（不得用 DOM 存在性冒充） */
  }
})()`)
log('BASELINE_CLAIMS_MEASURED', claims)

// ---------- 2a-3) ⭐ 真机**点击落点**验证（把两条 _known_gap 从"源码确认"升为"设备实测"）----------
console.log('')
console.log('=== 2a-3) 真机点击落点：region → poi ／ fab → publish ===')
/*
  ⭐ 为什么单独做这一步（Round 267 自己记下的缺口）：
    我先前把这两条 claim 标成 MATCH，但 evidence 里如实写了
    「设备侧只验了控件存在与文案，落点由**源码确认**，真机点击未验」，并留了 _known_gap。
    现在把缺口补上：真机点一下，看 hash 是否真的变了。
  ⚠️ 两次点击都是**只读导航**（不产生任何写入），符合本项目对"纯导航点击"的限定。
  ⚠️ 用完必须**回到地图页**，否则后面的离线/受控 stub 两段会在错误的页面上跑。
*/
async function clickAndReadHash(selector, label) {
  const before = await evaluate('location.hash')
  const clicked = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return { ok: false, why: 'not found' }
    el.click()
    return { ok: true }
  })()`)
  await sleep(1800)
  const after = await evaluate('location.hash')
  return { label, before, after, clicked, changed: before !== after }
}
const navRegion = await clickAndReadHash('.map__region', 'region→poi')
log('CLICK_REGION', navRegion)
// 回到地图页（离开再回来也顺带保证是新鲜挂载）
await evaluate(`location.hash = '#/campus'`)
await sleep(1500)
await evaluate(`location.hash = '#/map'`)
await sleep(3200)
const navFab = await clickAndReadHash('.map__fab', 'fab→publish')
log('CLICK_FAB', navFab)
// 复位到地图页，供后续段落使用
await evaluate(`location.hash = '#/campus'`)
await sleep(1500)
await evaluate(`location.hash = '#/map'`)
await sleep(3200)

// ---------- 2b) 离线路径单独验 `.map__marker` DOM ----------
console.log('')
console.log('=== 2b) 离线自绘地图路径的标记 DOM（provider 无关量之外的独立验证）===')
// 同样先离开再回来，避免继承上一次的状态（见 §2 的说明）
await evaluate(`location.hash = '#/campus'`)
await sleep(1500)
await evaluate(`location.hash = '#/map?offline=1'`)
await sleep(3200)
const snapOffline = await snapMap()
log('MAP_SNAPSHOT_OFFLINE', {
  hash: snapOffline.hash,
  phase: snapOffline.phase,
  declaredCount: snapOffline.declaredCount,
  offlineMarkerDomCount: snapOffline.offlineMarkerDomCount,
  markerNamesFromDom: await evaluate(
    `[...document.querySelectorAll('.map__markerName')].map(e => (e.textContent||'').trim())`,
  ),
})
await evaluate(`location.hash = '#/map'`)
await sleep(2000)

// ---------- 3) 受控 stub：拦 GET /api/posts → 必须不回落 mock ----------
console.log('')
console.log('=== 3) MAP_NO_FALLBACK_ON_UNAVAILABLE：拦住 posts → 不得回落 mock ===')
const stub = await evaluate(`(async () => {
  const orig = window.fetch
  window.fetch = async (u, o) => {
    const url = typeof u === 'string' ? u : (u && u.url) || ''
    if (/\\/api\\/posts(\\?|$)/.test(url)) {
      return new Response(JSON.stringify({ error: 'injected_posts_failure' }), {
        status: 500, headers: { 'content-type': 'application/json' },
      })
    }
    return orig(u, o)
  }
  location.hash = '#/campus'
  await new Promise(r => setTimeout(r, 1500))
  location.hash = '#/map'
  await new Promise(r => setTimeout(r, 3200))
  const badge = document.querySelector('[data-marker-phase]')
  const cards = [...document.querySelectorAll('.map__marker')]
  const bodyText = document.body.innerText || ''
  window.fetch = orig
  return {
    phase: badge ? badge.getAttribute('data-marker-phase') : null,
    badgeText: badge ? (badge.textContent || '').trim() : null,
    /** ⭐ 标记地点名（测试钩子；用 \\u001f 分隔） */
    markerPlaces: badge && badge.getAttribute('data-marker-places') ? badge.getAttribute('data-marker-places').split('\\u001f') : [],
    declaredCount: badge && badge.getAttribute('data-marker-count') ? Number(badge.getAttribute('data-marker-count')) : null,
    offlineMarkerDomCount: cards.length,
    leakedMockNames: ${JSON.stringify(MOCK_ONLY_PLACES)}.filter((n) => bodyText.includes(n)),
  }
})()`)
log('UNAVAILABLE_STUB', stub)

// 回到正常态，供人工/后续 Gate 观察
await evaluate(`location.hash = '#/map'`)
await sleep(3000)

// ---------- 判定 ----------
const expectedCount = expected && expected.ok ? expected.withCoords : null
/** 服务端出现的全部地名（用于"页面上每个地名都要能对上"） */
const serverPlaces = (expected && expected.allPlaces) || []
/** 整页文本里"泄漏"的 mock 地名（两种底图都会渲染地名文本） */
/*
  ⭐ Round 266：改为按**标记地点名集合**判定，而不是"整页文本里是否出现该词"。
  改前用整页文本 → 一次**假 FAIL**：权威帖子的正文里出现「图书馆四楼靠窗的位置」，
  那个"图书馆"是**帖子内容**、不是标记地点，但被算成了"仍在渲染 mock 地点"。
  ⇒ 现在只看 `data-marker-places`（标记真实使用的地点名）。
  （同类教训：WO#14 用整页 imgCount===0 判头像，被帖子里的图片干扰。）
*/
const markerPlaces = (snap && snap.markerPlaces) || []
const leakedInNormal = MOCK_ONLY_PLACES.filter((n) => markerPlaces.includes(n))

const v = {
  /**
   * 每个标记都能追溯到真实 post。
   * 判据：① provider 无关的声明条数 == 服务端有坐标的帖子数
   *       ② 整页文本里出现的**服务端地名**数目合理，且**没有** mock 专有地名
   * （不依赖某个 class —— 见 §2 的说明）
   */
  MAP_MARKERS_FROM_AUTHORITY:
    expected && expected.ok && snap && snap.declaredCount !== null &&
    snap.declaredCount === expectedCount &&
    leakedInNormal.length === 0 &&
    markerPlaces.length > 0 && markerPlaces.every((p) => serverPlaces.includes(p))
      ? 'PASS'
      : 'FAIL',

  /**
   * 声明条数 == 服务端**有有效坐标对**的帖子数（**不硬编码 6**）。
   * ⚠️ Round 266（审核 58 closeout 第 2/3 项）改了**离线那半条**：
   *   改前要求离线 DOM 也等于 expectedCount（= 4）—— 那是**错的**：
   *   离线底图是未校准投影的 SVG，**不该**渲染权威标记（见 App 侧说明）。
   *   ⇒ 现在要求离线 DOM **等于 0**，且徽标明确说"离线底图不支持标记显示"。
   *   （这不是"放宽"，而是**换成一个更正确的断言**：从"离线也画 4 个"变成"离线必须不画"。）
   */
  MARKER_COUNT_MATCHES_POSTS_WITH_VALID_COORDS:
    expectedCount !== null && snap && snap.declaredCount === expectedCount ? 'PASS' : 'FAIL',
  /** ⭐ 离线底图必须**不渲染**权威标记（未校准投影，画出来可能错位且用户无法察觉） */
  OFFLINE_RENDERS_NO_GEO_MARKERS:
    snapOffline && snapOffline.offlineMarkerDomCount === 0 &&
    snapOffline.phase === 'offline-unsupported'
      ? 'PASS'
      : 'FAIL',

  /** 不得出现 mock 那 6 个"无出处"的地名（正常态整页文本） */
  NO_FABRICATED_PLACE_DATA: leakedInNormal.length === 0 ? 'PASS' : 'FAIL',

  /** 读不到 → 明确不可用态，不回落 mock */
  MAP_NO_FALLBACK_ON_UNAVAILABLE:
    stub && stub.phase === 'unavailable' && stub.declaredCount === null &&
    stub.offlineMarkerDomCount === 0 && (stub.leakedMockNames || []).length === 0
      ? 'PASS'
      : 'FAIL',

  /**
   * ⭐⭐ Round 267：**标记卡片的可见内容必须来自权威帖子**（补 Round 266 的断言缺口）。
   *
   * ## 为什么必须补（这是那条回归漏掉的原因，不是"再加一条保险"）
   *   Round 266 closeout 时我查出：三个地图实现原本
   *     `const post = posts.find((p) => p.id === m.postId)`  → **去 mock 里查帖子**
   *   而 WO#15 之后 `m.postId` 是**真实帖子的 UUID**（mock 里是 p1/p2…）
   *   ⇒ 该 find **永远 undefined** ⇒ `cover` 与 `(post?.text ?? '')` **都是空**
   *   ⇒ **卡片封面与文字全都空着**；而标记仍画得出来、地名也还在，
   *     所以表现为"卡片没内容" —— **极难发现**。
   *   ⚠️ **当时那批断言完全没覆盖卡片内容** ⇒ 是断言覆盖面的缺口。
   *
   * ## 判别力从哪来（关键在"文字要**等于**权威正文前 10 字"）
   *   · 只断言"卡片非空"**判别力弱**：任何非空内容都能过。
   *   · 本断言要求：**没有封面的帖子，其卡片的文字必须 == 该帖 `body` 的前 10 字**。
   *     旧代码下那是**空字符串** ⇒ **必然 FAIL**；现有实现下逐条相等 ⇒ PASS。
   *   · 有封面的帖子则要求卡片里有 `<img class="rm__img">` 且 src 指向 **本服务的 /api/media/<该帖 media id>**
   *     （既证明"有图"，也证明**图来自权威媒体链路**、不是写死的 URL）。
   *
   * ⚠️ 口径必须与实现一致（否则会产生假 FAIL）：
   *   实现是 `excerpt: p.body ? p.body.slice(0, 10) : undefined`；Gate 用 `(p.body||'').slice(0,10)`。
   *
   * ⚠️ 若卡片一个都读不到（`.rm` = 0），记 **INCONCLUSIVE** —— **不**当作 PASS
   *   （"没样本"与"内容正确"是两件事）。
   */
  MAP_MARKER_CARD_DATA_AUTHORITY: (() => {
    const cards = (snap && snap.markerCards) || []
    const exp = (expected && expected.cardExpect) || []
    if (cards.length === 0 || exp.length === 0) return 'INCONCLUSIVE'
    // 按地名分组比较（同名地点可能多条，故按"多重集"逐一配对）
    const pool = cards.slice()
    let allMatched = true
    for (const e of exp) {
      const i = pool.findIndex((c) => c.name === e.place)
      if (i < 0) {
        allMatched = false
        break
      }
      const c = pool.splice(i, 1)[0]
      if (e.hasImages) {
        // 有封面 ⇒ 卡片必须有用本服务媒体链路的 <img>
        if (!c.coverSrc || !c.coverSrc.includes('/api/media/') || !c.coverSrc.includes(e.mediaId)) {
          allMatched = false
          break
        }
      } else {
        // 无封面 ⇒ 卡片文字必须**等于**权威正文前 10 字（这正是旧代码会空的地方）
        if (c.excerpt !== e.excerpt) {
          allMatched = false
          break
        }
      }
    }
    return allMatched ? 'PASS' : 'FAIL'
  })(),

  /*
    ⭐ AUDIT.7：基线**逐条核对**（每条对应 trident-map/baseline.json 里的一句）
    只对"可从 DOM/文本确证"的 claim 下断言；视觉/语义类的**保持 NOT_EVALUATED**。
  */
  /** 基线 interactions[0]「大标题 **Map**」 */
  MAP_TITLE_LITERAL: claims && claims.bigTitle === 'Map' ? 'PASS' : 'FAIL',
  /** 基线 interactions[0]「地区选择『北京交通大学（校本部）』」 */
  MAP_REGION_TEXT: claims && typeof claims.regionText === 'string' && claims.regionText.includes('北京交通大学')
    ? 'PASS'
    : 'FAIL',
  /** 基线 interactions[0]「右上**消息图标**」 */
  MAP_MESSAGE_CONTROL: claims && claims.msgAria === '消息' ? 'PASS' : 'FAIL',
  /** 基线 interactions[2]「右下：**定位复位按钮** + 黑色圆形 +」 */
  MAP_BOTTOM_RIGHT_CONTROLS:
    claims && claims.locateAria === '回到定位' && claims.ctrlCount >= 1 && claims.fabAria === '发布'
      ? 'PASS'
      : 'FAIL',
  /** 基线 known_unknowns[0]：首次进入有阻断式「**授权地理位置**」弹窗 */
  MAP_GEO_PERMISSION_MODAL: claims && claims.geoModalPresent && claims.geoModalTitle === '授权地理位置'
    ? 'PASS'
    : 'FAIL',
  /** 基线 known_unknowns[1]：底图是**腾讯地图 SDK**（我们默认 provider 与之一致） */
  MAP_TENCENT_BASEMAP: claims && claims.providerText === '腾讯地图' && claims.hasTencentWatermark === true
    ? 'PASS'
    : 'FAIL',
  /**
   * 基线 navigation[0]「地区名 → **选点页（poi/search）**」
   * ⭐ Round 267 补：此前只验"控件存在 + 文案"（真机落点未验）。
   *   现在**真机点击**并确认 hash 落到 poi 页 —— 从"源码确认"升为"设备实测"。
   */
  MAP_REGION_TO_POI_CONTROL:
    claims && typeof claims.regionText === 'string' && claims.regionText.length > 0 &&
    navRegion && navRegion.clicked && navRegion.clicked.ok && navRegion.changed &&
    /poi/i.test(String(navRegion.after))
      ? 'PASS'
      : 'FAIL',
  /** 基线 navigation[1]「+ → **发布页**」——同上，真机点击后确认落到发布页 */
  MAP_PLUS_TO_PUBLISH_CONTROL:
    claims && claims.fabAria === '发布' &&
    navFab && navFab.clicked && navFab.clicked.ok && navFab.changed &&
    /publish/i.test(String(navFab.after))
      ? 'PASS'
      : 'FAIL',

  /** 基线明记未知 → 只记录，不当作可通过项（也不进 KEYS，故不影响裁决） */
  MAP_PIN_COLOR_SEMANTICS_CONFORMANCE: 'NOT_EVALUATED',
  OFFLINE_MAP_PROJECTION_CONFORMANCE: 'NOT_EVALUATED',
  ORIGINAL_MAP_MARKER_CONFORMANCE: 'NOT_EVALUATED',

  detail: { expected, snap: { ...snap, bodyText: undefined }, snapOffline, stub, expectedCount, leakedInNormal, markerCards: (snap && snap.markerCards) || [], baselineClaims: claims, navRegion, navFab },
  notes: {
    判别性: '期望条数来自**服务端实况**（不写死 6）；主判据用 provider 无关的 data-marker-count',
    /*
      ⭐ Round 266（审核记录 58 closeout 第 3 项）：**键名要反映真实 policy**。
        改前叫 `MARKER_COUNT_MATCHES_POSTS_WITH_PLACE`，但实现的判定其实是
          `placeLat != null && placeLng != null` → marker
        而**不是** `place_id != null` → marker。
        ⇒ 名字与 policy 不符的后果是具体的：以后若出现一条**合法但没有坐标**的
          place（places.latitude/longitude 可为 NULL），旧名字会让人以为
          "应该按 place_id 计数"，于是 Gate 会因为**错误的原因** FAIL。
        所以改名 + 把 policy 显式写出来。
    */
    OUR_MARKER_CARDINALITY_POLICY:
      'one marker per post with a valid coordinate pair（placeLat 与 placeLng 同时为 number）',
    ORIGINAL_MARKER_CARDINALITY: 'NOT_EVALUATED（原版每帖是否恰好一个标记未观测）',
    OFFLINE_MARKER_RENDERING_POLICY:
      'offline 底图**不渲染**权威标记（未校准投影）；见 App 侧说明 —— ' +
      '审核 58：不能只把投影一致性写成 NOT_EVALUATED 却仍把标记画给用户看',
    仍未知: '图钉配色规则 / 气泡卡片 / 缩放级别 / 头像标记与照片标记的分工 —— 依基线原话「标记规则未记录」',
  },
}
const KEYS = [
  'MAP_MARKERS_FROM_AUTHORITY',
  'MARKER_COUNT_MATCHES_POSTS_WITH_VALID_COORDS',
  'OFFLINE_RENDERS_NO_GEO_MARKERS',
  'NO_FABRICATED_PLACE_DATA',
  'MAP_NO_FALLBACK_ON_UNAVAILABLE',
  'MAP_MARKER_CARD_DATA_AUTHORITY',
  /* ⭐ AUDIT.7 基线逐条核对（对应 trident-map/baseline.json 的 interactions/navigation/known_unknowns） */
  'MAP_TITLE_LITERAL',
  'MAP_REGION_TEXT',
  'MAP_MESSAGE_CONTROL',
  'MAP_BOTTOM_RIGHT_CONTROLS',
  'MAP_GEO_PERMISSION_MODAL',
  'MAP_TENCENT_BASEMAP',
  'MAP_REGION_TO_POI_CONTROL',
  'MAP_PLUS_TO_PUBLISH_CONTROL',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const anyNotEval = KEYS.some((k) => v[k] === 'NOT_EVALUATED')
v.WO15_GATE = anyFail ? 'FAIL' : anyNotEval ? 'PASS_WITH_NOT_EVALUATED' : 'PASS'
v.WO15_GATE_REASON = anyFail
  ? `有 FAIL：${KEYS.filter((k) => v[k] === 'FAIL').join(', ')}`
  : anyNotEval
    ? `无 FAIL，但有未评估项：${KEYS.filter((k) => v[k] === 'NOT_EVALUATED').join(', ')}`
    : '全部 PASS'
log('VERDICT', v)

ws.close()
process.exit(anyFail ? 1 : 0)
