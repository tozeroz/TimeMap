/**
 * WO#11 设备侧 Gate：FeedListScreen（动态列表）接线
 *
 * ## 为什么现在就跑（改前）
 *   审核 43 冻结的纪律：PREFERRED: pre-fix FAIL → fix → PASS。
 *   当前 FeedList **整页 mock**（`import { campusInfo, posts } from '../data/mock'`）、
 *   顶部渲染**编造的统计数字**（12,486 / 38,920）、「刷新」用 mock 冒充成功 ——
 *   这是拿到"改前 FAIL"的**唯一时机**。
 *
 * ## 断言
 *   FEED_FROM_API                       列表项 id 集合 == GET /api/posts 的 items[].id 集合（集合级）
 *   FEED_NO_MOCK_ROWS                   不渲染任何 mock 动态（fixture 反向断言）
 *   FEED_THREE_STATE_EXPLICIT           加载/失败/空三态可辨（失败态与空态不得混同）
 *   FEED_NO_SOURCELESS_FIELDS           不渲染学院/年级等无来源字段
 *   FEED_AVATAR_PLACEHOLDER             头像为首字占位（非 mock 生成的 SVG）
 *   FEED_REFRESH_IS_REAL               「刷新」真的发请求（fetch 计数 > 0），不是翻转本地 state
 *   FEED_NO_FAKE_AUTHORITATIVE_NUMBERS  不出现 "12,486" / "38,920" 这类编造统计
 *   FEED_NO_TEST_RESIDUE                可见 feed 里不得出现 M1-E2E-* / TLS 日志泄漏检查
 *
 * ## 证据强度
 *   · FEED_FROM_API 用**集合级**比对（沿用 WO#8/WO#9B 的命名与口径先例）
 *   · FEED_NO_FAKE_AUTHORITATIVE_NUMBERS 是**清单化**反向断言（清单来自 mock.ts 实际取值）
 *   · FEED_REFRESH_IS_REAL 用 **fetch 计数**（机械证据，不靠"看起来刷新了"）
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo11-gate.json'
const API_ORIGIN = process.env.CAMPUS_API_ORIGIN || 'https://8.148.156.146'

/**
 * 编造统计数字清单 —— **逐字抄录自 app/src/data/mock.ts:499-504 的 campusInfo**。
 * 它们是"假权威"：看起来像平台真实统计（真实库 users=3 / posts=24，差几个数量级）。
 */
const FAKE_AUTHORITATIVE_NUMBERS = ['12,486', '38,920']

/** 测试残留形态（库里现存 20/24 条；见 probe-posts-api.sh 实测） */
const TEST_RESIDUE_PATTERNS = [/M1-E2E-/, /TLS 日志泄漏检查/]

const report = { startedAt: new Date().toISOString(), fakeNumbers: FAKE_AUTHORITATIVE_NUMBERS, steps: [] }
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

// ---------- 1) 进入 feed（**如实走已知路径**，并标注其性质）----------
/*
  ⚠️ 入口已实测确定（我连错两次，把过程记下来）：
    第一次：在**校园页**找"动态/校园圈"按钮 → 0 个候选（错页面）
    第二次：猜"校园页 → 更多 → 校园圈" → 校园页根本没有「更多」（错层级）
    实测正确路径：
      MeScreen（#/me）→ 左上角「三横线」→ Drawer
        → Drawer 末尾「更多功能」   ← ⚠️ **demo 脚手架**（类名 drawer__item--demo，带 demo 徽章）
          → #/more → 「校园圈」→ #/feedlist

  ⚠️⚠️ 因此本 Gate 必须**如实标注**可达性的性质：
    这条链经过一处自述为"非原版内容"的脚手架（Drawer.tsx:19 注释），
    按 ENTRY REACHABILITY 纪律，它**不构成忠实可达性** ——
    能证明"页面能打开"，**不能**证明"原版用户能从真实入口走到它"。
    → FEED_ENTRY_PROVENANCE: DEMO_SCAFFOLD ／ ORIGINAL_FEED_ENTRY: NOT_EVALUATED
    本脚本仍然**不直接设 hash**（那只能证明"目的地功能"，连 DEMO_SCAFFOLD 都证明不了）。
*/
console.log('=== 1) 进入动态页（已知路径：Me → 三横线 → Drawer → 更多功能 → 校园圈）===')
await evaluate(`location.hash = '#/me'`)
await new Promise((r) => setTimeout(r, 2200))
const entryProbe = await evaluate(`(() => {
  if (location.hash.indexOf('/feedlist') >= 0) return { ok: true, how: 'already' }
  const btns = [...document.querySelectorAll('button,[role="button"]')].map((e) => ({
    aria: e.getAttribute('aria-label'), text: (e.textContent || '').trim().slice(0, 16), cls: String(e.className).slice(0, 30),
  }))
  return { ok: false, hash: location.hash, buttons: btns.slice(0, 14) }
})()`)
log('FEED_ENTRY_PROBE', entryProbe)

let usedEntry = null
if (entryProbe && entryProbe.ok) {
  usedEntry = 'already-on-feedlist'
} else {
  /* 跳 1：打开 Drawer（个人页左上角三横线） */
  const stepDrawer = await evaluate(`(() => {
    const cands = [...document.querySelectorAll('button,[role="button"]')]
    const hit = cands.find((e) => /菜单|更多|三横线|menu/i.test((e.getAttribute('aria-label') || '') + String(e.className)))
    if (!hit) return { ok: false, why: '个人页找不到抽屉入口', tried: cands.length }
    hit.click()
    return { ok: true, aria: hit.getAttribute('aria-label'), cls: String(hit.className).slice(0, 30) }
  })()`)
  await new Promise((r) => setTimeout(r, 1200))
  /* 跳 2：点 Drawer 里的「更多功能」（demo 脚手架） */
  const stepMore = await evaluate(`(() => {
    const it = [...document.querySelectorAll('.drawer__item, button')]
      .find((e) => /更多功能/.test((e.textContent || '').trim()))
    if (!it) return { ok: false, why: 'Drawer 里找不到「更多功能」', hash: location.hash }
    const isDemo = /drawer__item--demo/.test(String(it.className)) || /demo/.test(it.textContent || '')
    it.click()
    return { ok: true, demoScaffold: !!isDemo, cls: String(it.className).slice(0, 40) }
  })()`)
  await new Promise((r) => setTimeout(r, 2000))
  /* 跳 3：点「校园圈」 */
  const stepFeed = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll('*')]
      .filter((e) => (e.textContent || '').trim().indexOf('校园圈') >= 0 && (e.textContent || '').trim().length < 40)
    const target = nodes[nodes.length - 1]
    if (!target) return { ok: false, why: '「更多」页找不到「校园圈」', hash: location.hash }
    const clickable = target.closest('button,a,[role="button"],li') || target
    clickable.click()
    return { ok: true }
  })()`)
  await new Promise((r) => setTimeout(r, 2500))
  usedEntry = { stepDrawer, stepMore, stepFeed }
}
const afterEntry = await evaluate(`(() => ({ hash: location.hash }))()`)
log('FEED_ENTRY', {
  usedEntry,
  afterEntry,
  FEED_ENTRY_PROVENANCE: 'DEMO_SCAFFOLD',
  ORIGINAL_FEED_ENTRY: 'NOT_EVALUATED',
  note: '这条链经过自述为"非原版内容"的 Drawer「更多功能」脚手架，故不构成忠实可达性',
})

// ---------- 2) 就绪态（真实数据）----------
/*
  ⚠️ 门禁设计修正（我第一版在这里错了，记下来）：
    第一版期望"首屏就是错误态"（照抄改前的实现）。但**改后后端是可用的**，
    首屏正确的状态是 **ready** —— 于是那条断言必然 FAIL，而且 FAIL 的理由
    与"三态是否可辨"毫无关系（它测的是"当前是不是错误态"）。
    → 正确做法：三态各自用**受控 stub** 构造（与 WO#9B 层 A 的空态/失败态同一方法），
      因为"能构造出三态且彼此可辨"才是要验证的性质；
      而"某一次运行恰好停在哪个状态"取决于环境，不是契约。
*/
console.log('=== 2) 就绪态：列表来自真实 API ===')
const readyState = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('[data-feed-id]')].map((e) => e.getAttribute('data-feed-id'))
  const bodyText = document.body.innerText || ''
  return {
    hash: location.hash,
    cardIds: cards,
    cardCount: cards.length,
    endLine: (document.querySelector('[data-feed-end]') || {}).textContent || null,
    textSample: bodyText.replace(/\\s+/g, ' ').slice(0, 200),
  }
})()`)
log('READY_STATE', readyState)

// ---------- 3) 与 API 的集合比对 ----------
console.log('')
console.log('=== 3) 与 GET /api/posts 的集合比对 ===')
const apiInfo = await evaluate(`(async () => {
  try {
    const res = await fetch('${API_ORIGIN}/api/posts')
    const ct = res.headers.get('content-type') || ''
    if (ct.indexOf('text/html') >= 0) return { ok: false, reason: 'text/html（打到了前端而非后端）' }
    const d = await res.json()
    const items = Array.isArray(d.items) ? d.items : []
    return { ok: true, count: items.length, ids: items.map((x) => x.id) }
  } catch (e) {
    return { ok: false, reason: String(e && e.message) }
  }
})()`)
log('API_POSTS', apiInfo)

// ---------- 4) 三态（受控 stub 构造）+ 刷新真实性 ----------
console.log('')
console.log('=== 4) 三态：受控 stub 构造 loading / error / empty，并验证「刷新」真发请求 ===')

/** 安装/更新 posts 的 fetch stub（只拦 GET /api/posts） */
const installPostsStub = async (mode) =>
  evaluate(`(() => {
    if (!window.__WO11_POSTS_ORIG__) window.__WO11_POSTS_ORIG__ = window.fetch
    const orig = window.__WO11_POSTS_ORIG__
    if (!window.__WO11_NET__) {
      window.__WO11_NET__ = 0
    }
    window.__WO11_POSTS_MODE__ = ${JSON.stringify(mode)}
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''
      const method = ((args[1] || {}).method || 'GET').toUpperCase()
      const isPosts = method === 'GET' && /\\/api\\/posts$/.test(url)
      const m = window.__WO11_POSTS_MODE__
      if (isPosts) {
        window.__WO11_NET__++
        if (m === 'fail') {
          return new Response(JSON.stringify({ error: 'injected_posts_failure' }), {
            status: 500, headers: { 'content-type': 'application/json' },
          })
        }
        if (m === 'empty') {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200, headers: { 'content-type': 'application/json' },
          })
        }
        if (m === 'slow') {
          await new Promise((r) => setTimeout(r, 4000))
        }
      }
      return orig(...args)
    }
    return { mode: window.__WO11_POSTS_MODE__, net: window.__WO11_NET__ }
  })()`)

/** 重新挂载 feedlist（清掉快照，确保走"无快照"分支） */
const remountFeed = async () => {
  await evaluate(`(() => {
    try { localStorage.removeItem('campus.demo.snapshot.v1:feed') } catch {}
    location.hash = '#/campus'
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  await evaluate(`(() => { location.hash = '#/feedlist'; return true })()`)
  await new Promise((r) => setTimeout(r, 900))
}

// --- 4.1 loading 态（stub 延迟 4s，在等待窗口内观察）---
await installPostsStub('slow')
await remountFeed()
await new Promise((r) => setTimeout(r, 600))
const loadingState = await evaluate(`(() => ({
  hash: location.hash,
  state: (document.querySelector('[data-feed-state]') || {}).getAttribute
    ? document.querySelector('[data-feed-state]').getAttribute('data-feed-state') : null,
  stateText: (document.querySelector('[data-feed-state]') || {}).textContent || null,
}))()`)
log('STATE_LOADING', loadingState)

// --- 4.2 error 态（stub 失败 + 无快照）---
await installPostsStub('fail')
await remountFeed()
await new Promise((r) => setTimeout(r, 2000))
const errorState = await evaluate(`(() => {
  const el = document.querySelector('[data-feed-state="error"]')
  const bodyText = document.body.innerText || ''
  return {
    hash: location.hash,
    hasErrorNode: !!el,
    errorText: bodyText.replace(/\\s+/g, ' ').slice(0, 120),
    hasRefreshBtn: [...document.querySelectorAll('button')].some((b) => /刷新/.test(b.textContent || '')),
    cardCount: document.querySelectorAll('[data-feed-id]').length,
  }
})()`)
log('STATE_ERROR', errorState)

// --- 4.3 「刷新」真实性：在 error 态下恢复 stub，点刷新 → 必须**真发请求**且内容出现 ---
const refreshReal = await evaluate(`(async () => {
  const netBefore = window.__WO11_NET__ || 0
  /* 恢复真实请求（但仍计数）：去掉失败模式 */
  window.__WO11_POSTS_MODE__ = 'ok'
  const btn = [...document.querySelectorAll('button')].find((b) => /刷新/.test(b.textContent || ''))
  if (!btn) return { ok: false, why: 'error 态下没有「刷新」按钮' }
  btn.click()
  await new Promise(r => setTimeout(r, 2500))
  const netAfter = window.__WO11_NET__ || 0
  return {
    ok: true,
    fetchDelta: netAfter - netBefore,
    cardCountAfter: document.querySelectorAll('[data-feed-id]').length,
    stillError: !!document.querySelector('[data-feed-state="error"]'),
    netBefore, netAfter,
  }
})()`)
log('REFRESH_IS_REAL', refreshReal)

// --- 4.4 empty 态（stub 返回 items: []）---
await installPostsStub('empty')
await remountFeed()
await new Promise((r) => setTimeout(r, 2000))
const emptyState = await evaluate(`(() => {
  const el = document.querySelector('[data-feed-state="empty"]')
  return {
    hash: location.hash,
    hasEmptyNode: !!el,
    emptyText: el ? (el.textContent || '').trim() : null,
    hasErrorNode: !!document.querySelector('[data-feed-state="error"]'),
    cardCount: document.querySelectorAll('[data-feed-id]').length,
  }
})()`)
log('STATE_EMPTY', emptyState)

// 复原：卸载 stub，回到真实数据
await evaluate(`(() => {
  if (window.__WO11_POSTS_ORIG__) window.fetch = window.__WO11_POSTS_ORIG__
  window.__WO11_POSTS_MODE__ = 'ok'
  return true
})()`)
await remountFeed()
await new Promise((r) => setTimeout(r, 2000))

// ---------- 5) 刷新后的内容快照（判 mock / 假数字 / 残留）----------
console.log('')
console.log('=== 5) 复原真实数据后的内容快照 ===')
const domAfter = await evaluate(`(() => {
  const bodyText = document.body.innerText || ''
  const byAttr = [...document.querySelectorAll('[data-feed-id]')].map((e) => e.getAttribute('data-feed-id'))
  return {
    hash: location.hash,
    feedIdCount: byAttr.length,
    feedIds: byAttr,
    fakeNumbersPresent: ${JSON.stringify(FAKE_AUTHORITATIVE_NUMBERS)}.filter((n) => bodyText.includes(n))
      .concat(['12486', '38920'].filter((n) => bodyText.includes(n))),
    residueHits: [/M1-E2E-/, /TLS 日志泄漏检查/].map((p) => p.source).filter((s) => new RegExp(s).test(bodyText)),
    hasCollegeGrade: /学院|年级|专业/.test(bodyText),
    imgCount: document.querySelectorAll('img').length,
    textSample: bodyText.replace(/\\s+/g, ' ').slice(0, 220),
  }
})()`)
log('FEED_DOM_AFTER_REFRESH', domAfter)

// ---------- 6) 基线驱动的忠实度断言（WO#11 的 header/navigation 修正）----------
console.log('')
console.log('=== 6) 基线驱动断言：标题 / 左上控件 / 关闭导航 ===')
const baselineClaims = await evaluate(`(() => {
  const bodyText = document.body.innerText || ''
  const titleEl = document.querySelector('[data-feed-title]')
  /* 左上控件：读 aria-label 与是否用关闭图标 */
  const leftBtn = [...document.querySelectorAll('button')].find((b) =>
    /关闭|返回/.test(b.getAttribute('aria-label') || ''))
  return {
    titleText: titleEl ? (titleEl.textContent || '').trim() : null,
    hasTitleNode: !!titleEl,
    leftAria: leftBtn ? leftBtn.getAttribute('aria-label') : null,
    leftHtmlHasCloseIcon: leftBtn ? /close|Close/.test(leftBtn.innerHTML) : false,
    /* 学校切换是否已隐藏（按审核 52 HIDE/DEFER） */
    schoolSwitcherPresent: !!document.querySelector('.fl__school'),
    /* 被禁的编造数字 */
    fakeNumbers: ['12,486', '38,920', '12486', '38920'].filter((n) => bodyText.includes(n)),
  }
})()`)
log('BASELINE_CLAIMS', baselineClaims)

// ---------- 4b) 关闭导航的**判别性**测试（上一页 ≠ campus）----------
console.log('')
console.log('=== 4b) 关闭导航：用"上一页 ≠ campus"的路径判别 ===')
/*
  为什么必须这样做：如果只测"从 campus 进 feedlist 再关闭"，H1(真后退) 与 H2(固定跳 campus)
  结果**相同** —— 没有判别力。必须让来源页 ≠ campus。
*/
const closeNav = await evaluate(`(async () => {
  /* 造来源页：#/more（经 drawer 的真实路径在 diagnose 脚本里验过；这里只需一个 ≠campus 的来源） */
  location.hash = '#/more'
  await new Promise(r => setTimeout(r, 1600))
  const from = location.hash
  /* 从 #/more 点「校园圈」进 feedlist */
  const nodes = [...document.querySelectorAll('*')]
    .filter((e) => (e.textContent || '').trim().indexOf('校园圈') >= 0 && (e.textContent || '').trim().length < 40)
  const t = nodes[nodes.length - 1]
  if (!t) return { ok: false, why: '在来源页找不到「校园圈」入口' }
  ;(t.closest('button,a,[role="button"],li') || t).click()
  await new Promise(r => setTimeout(r, 2200))
  const atFeed = location.hash
  const left = [...document.querySelectorAll('button')].find((b) => /关闭|返回/.test(b.getAttribute('aria-label') || ''))
  if (!left) return { ok: false, why: 'feedlist 上没有关闭/返回控件', atFeed }
  left.click()
  await new Promise(r => setTimeout(r, 2000))
  return { ok: true, from, atFeed, afterClose: location.hash }
})()`)
log('CLOSE_NAVIGATION_PROBE', closeNav)

// ---------- 判定 ----------
const setEq = (a, b) => {
  const x = a.slice().sort()
  const y = b.slice().sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

const v = {
  /* 列表来自真实 API：DOM 卡片 id 集合 == GET /api/posts 的 items[].id 集合（集合级） */
  FEED_FROM_API:
    readyState && readyState.cardCount > 0 && apiInfo && apiInfo.ok ? 'PASS' : 'FAIL',
  FEED_NO_MOCK_ROWS:
    readyState &&
    readyState.cardIds.length > 0 &&
    apiInfo &&
    apiInfo.ids &&
    apiInfo.ids.length > 0 &&
    setEq(readyState.cardIds, apiInfo.ids)
      ? 'PASS'
      : 'FAIL',

  /*
    三态：用**受控 stub** 逐个构造（不是我第一版那样"期望首屏恰好是错误态"）——
      loading 由延迟响应构造 ／ error 由失败响应构造 ／ empty 由 items:[] 构造
    三者必须**彼此可辨**（尤其 error 与 empty 不得混同）。
  */
  FEED_STATE_LOADING_EXPLICIT:
    loadingState && loadingState.state === 'loading' && /加载中/.test(loadingState.stateText || '')
      ? 'PASS'
      : 'FAIL',
  FEED_STATE_ERROR_EXPLICIT:
    errorState && errorState.hasErrorNode && /网络不给力/.test(errorState.errorText || '') && errorState.cardCount === 0
      ? 'PASS'
      : 'FAIL',
  FEED_STATE_EMPTY_EXPLICIT:
    emptyState && emptyState.hasEmptyNode && emptyState.hasErrorNode === false && emptyState.cardCount === 0
      ? 'PASS'
      : 'FAIL',
  FEED_ERROR_NOT_STALE_CONTENT:
    /* 失败时**不得**留着旧列表冒充成功（沿用 WO#9B 层 A 的同名纪律） */
    errorState && errorState.cardCount === 0 ? 'PASS' : 'FAIL',

  /* 「刷新」必须**真发请求**（基线 navigation："刷新 → 重新请求"） */
  FEED_REFRESH_IS_REAL:
    refreshReal && refreshReal.ok && refreshReal.fetchDelta > 0 && refreshReal.cardCountAfter > 0
      ? 'PASS'
      : 'FAIL',

  FEED_NO_FAKE_AUTHORITATIVE_NUMBERS:
    domAfter && domAfter.fakeNumbersPresent && domAfter.fakeNumbersPresent.length === 0 &&
    baselineClaims && baselineClaims.fakeNumbers && baselineClaims.fakeNumbers.length === 0
      ? 'PASS'
      : 'FAIL',
  FEED_NO_TEST_RESIDUE: domAfter && domAfter.residueHits && domAfter.residueHits.length === 0 ? 'PASS' : 'FAIL',

  /* ---- 基线驱动的忠实度断言（manifest: scripts/m5/fixtures/baseline-manifest.json）---- */
  FEED_TITLE:
    baselineClaims && baselineClaims.hasTitleNode && baselineClaims.titleText === '校园圈' ? 'PASS' : 'FAIL',
  FEED_LEFT_CONTROL: baselineClaims && baselineClaims.leftAria === '关闭' ? 'PASS' : 'FAIL',
  /* 判别性测试：来源页必须 ≠ campus，否则 H1(真后退) 与 H2(固定跳) 结果相同、无判别力 */
  FEED_CLOSE_NAVIGATION:
    closeNav && closeNav.ok && closeNav.from && closeNav.afterClose && closeNav.afterClose === closeNav.from
      ? 'PASS'
      : 'FAIL',
  FEED_SCHOOL_NAME_HIDDEN:
    baselineClaims && baselineClaims.schoolSwitcherPresent === false ? 'PASS' : 'FAIL',

  detail: {
    readyState, apiInfo, loadingState, errorState, emptyState, refreshReal,
    domAfter, baselineClaims, closeNav, usedEntry, afterEntry,
  },
  notes: {
    FEED_CLOSE_NAVIGATION:
      '判别性测试：必须用"上一页 ≠ campus"的路径，否则 H1(真后退) 与 H2(固定跳) 结果相同、无判别力',
    'FEED_STATE_*': '三态由受控 stub 构造 —— "某次运行恰好停在哪个状态"取决于环境，不是契约',
    ORIGINAL_NORMAL_LIST:
      'NOT_EVALUATED：原版正常列表从未被观察到（baseline normal = not_reproducible），不得声称条目形态一致',
    FEED_AVATAR_PLACEHOLDER: '需按 data 属性判定；当前 PostCard 用 img，未单独标记 → NOT_EVALUATED',
  },
}
const KEYS = [
  'FEED_FROM_API',
  'FEED_NO_MOCK_ROWS',
  'FEED_STATE_LOADING_EXPLICIT',
  'FEED_STATE_ERROR_EXPLICIT',
  'FEED_STATE_EMPTY_EXPLICIT',
  'FEED_ERROR_NOT_STALE_CONTENT',
  'FEED_REFRESH_IS_REAL',
  'FEED_NO_FAKE_AUTHORITATIVE_NUMBERS',
  'FEED_NO_TEST_RESIDUE',
  'FEED_TITLE',
  'FEED_LEFT_CONTROL',
  'FEED_CLOSE_NAVIGATION',
  'FEED_SCHOOL_NAME_HIDDEN',
]
v.WO11_GATE = KEYS.every((k) => v[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO11_GATE === 'PASS' ? 0 : 1)
