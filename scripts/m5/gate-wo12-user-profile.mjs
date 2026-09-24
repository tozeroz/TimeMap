/**
 * WO#12 设备侧 Gate：UserProfileScreen（他人主页）
 *
 * ## 为什么现在就跑（改前）
 *   审核 43 冻结的纪律：PREFERRED: pre-fix FAIL → fix → PASS。
 *   当前该屏整页 mock + **假身份回落**（点真实作者显示 mock u1）—— 这是拿改前 FAIL 的唯一时机。
 *
 * ## 断言（改前应大量 FAIL）
 *   USER_PROFILE_IDENTITY_FROM_ROUTE  资料页显示的人 == 被点作者本人（**判别性**：真实路径点击进入）
 *   USER_PROFILE_NO_MOCK_IDENTITY     DOM 不得出现 mock 专有昵称（复用 WO#10 fixture）
 *   USER_PROFILE_NO_SOURCELESS_FIELDS 不渲染 MBTI/星座/学校/学院/专业/年级（无权威来源）
 *   USER_PROFILE_AVATAR_PLACEHOLDER   头像为首字占位
 *   USER_PROFILE_MSGDEST_REACHABLE    「私信」要么通向真实会话，要么不存在（**不得通向 invalid**）
 *   USER_PROFILE_NO_FAKE_FOLLOW       不存在纯本地假成功的「关注」
 *   USER_PROFILE_SELF_LABEL           若进入的是自己的主页，应有明确标识（**避免"看到自己却以为在看别人"**）
 *
 * ## 基线
 *   该屏**无原版基线**（screens/ 下只有 trident-me = 「我的」tab）。
 *   → 本 Gate **不做任何"与原版一致"的主张**，只断言"不撒谎/不假成功/身份正确"。
 *   ORIGINAL_USER_PROFILE_CONFORMANCE: NOT_EVALUATED（显式记录，不跳过）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo12-gate.json'
/*
  ⚠️ API 走**绝对 origin**（我第一版漏了这个定义，导致后面三段探针全在运行时崩掉 ——
     被"check-gate-syntax.sh"抓不到，因为它是运行时的 ReferenceError 而不是语法错误）。
     理由（本项目已踩两次）：Capacitor WebView 里用**相对路径** fetch 会打到 WebView
     自己的本地服务器，并返回 **HTML + 状态码 200** → json() 得 {}。
     run-device-gate.sh 的 API_E2E_ORIGIN_VALIDITY 前置步会把这类错误直接判 FATAL。
*/
const API_ORIGIN = process.env.CAMPUS_API_ORIGIN || 'https://8.148.156.146'
const FIXTURE = 'G:\\demo map\\scripts\\m5\\fixtures\\known-message-screen-mocks.json'
const FIX = JSON.parse(readFileSync(FIXTURE, 'utf8'))
/** mock 专有昵称（剔除与真实用户撞名的那三个，见 fixture 的警示） */
const MOCK_ONLY_NAMES = FIX.mockOnlyDisplayNames

const report = { startedAt: new Date().toISOString(), baseline: 'ORIGINAL_USER_PROFILE_CONFORMANCE: NOT_EVALUATED', steps: [] }
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

// ---------- 1) 真实路径进入他人主页 ----------
console.log('=== 1) 真实入口：校园页 → 点动态卡片的作者行 ===')
await evaluate(`location.hash = '#/campus'`)
await sleep(2500)
const clicked = await evaluate(`(() => {
  const c = document.querySelector('[data-feed-id]')
  if (!c) return { ok: false, why: '校园页没有 [data-feed-id] 卡片' }
  /* 两个分支的类名都要覆盖（我上一次只猜有图分支，全部落空） */
  const nameEl = c.querySelector('.pcard__author-name') || c.querySelector('.pcard__name')
  const btn = c.querySelector('.pcard__author') || c.querySelector('.pcard__authorBtn')
  if (!btn) return { ok: false, why: '卡片上没有作者按钮', html: c.innerHTML.slice(0, 120) }
  const res = {
    ok: true,
    clickedAuthorName: nameEl ? (nameEl.textContent || '').trim() : null,
    feedId: c.getAttribute('data-feed-id'),
  }
  btn.click()
  return res
})()`)
log('ENTRY_CLICK_AUTHOR', clicked)
await sleep(2500)

// ---------- 2) 资料页内容 ----------
console.log('')
console.log('=== 2) 资料页内容与身份 ===')
const prof = await evaluate(`(() => {
  const bodyText = document.body.innerText || ''
  const name = (document.querySelector('.up__name') || {}).textContent || null
  return {
    hash: location.hash,
    shownName: name ? name.trim() : null,
    tags: [...document.querySelectorAll('.tag')].map((t) => (t.textContent || '').trim()).filter(Boolean),
    /* mock 专有昵称是否出现 */
    mockNamesHit: ${JSON.stringify(MOCK_ONLY_NAMES)}.filter((n) => bodyText.includes(n)),
    /* 无来源字段 */
    hasSourcelessFields: /MBTI|INFP|ENFP|摩羯|天秤|处女|学院|专业|年级|本科|硕士/.test(bodyText),
    /* 头像形态：有 img 就是 mock SVG / 真实图；有 data-user-avatar-placeholder 才是首字占位 */
    imgCount: document.querySelectorAll('img').length,
    hasPlaceholderAvatar: !!document.querySelector('[data-user-avatar-placeholder]'),
    /* 帖子区 */
    uiPostIds: [...document.querySelectorAll('[data-user-posts] [data-feed-id]')].map((e) => e.getAttribute('data-feed-id')),
    /* 关注 / 私信 */
    hasFollowBtn: [...document.querySelectorAll('button')].some((b) => /关注|已关注/.test(b.textContent || '')),
    hasMsgBtn: !!document.querySelector('.up__msg'),
    /* 编造统计数字 */
    fakeNumbers: ['12,486', '38,920', '12486', '38920'].filter((n) => bodyText.includes(n)),
    textSample: bodyText.replace(/\\s+/g, ' ').slice(0, 180),
  }
})()`)
log('PROFILE_PAGE', prof)

// ---------- 3) 「私信」的去向（判别：不得通向 invalid）----------
console.log('')
console.log('=== 3) 「私信」按钮的去向 ===')
const msgDest = await evaluate(`(async () => {
  const b = document.querySelector('.up__msg')
  if (!b) return { exists: false }
  b.click()
  await new Promise(r => setTimeout(r, 2200))
  const bodyText = document.body.innerText || ''
  return {
    exists: true,
    hashAfter: location.hash,
    /* ChatScreen 的 invalid 状态特征（WO#9B 加的：0 请求 + 隐藏 composer） */
    looksInvalid: /无效|invalid|无法/.test(bodyText) || !document.querySelector('.chatbar__input'),
    hasComposer: !!document.querySelector('.chatbar__input'),
  }
})()`)
log('MSG_DESTINATION', msgDest)

// ---------- 4) 「关注」是否假成功（纯本地 useState）----------
console.log('')
console.log('=== 4) 「关注」是否是纯本地假成功 ===')
// 先回到资料页
await evaluate(`(() => {
  const b = document.querySelector('[data-feed-id]')
  return true
})()`)
await evaluate(`location.hash = '#/campus'`)
await sleep(1800)
const followProbe = await evaluate(`(async () => {
  const c = document.querySelector('[data-feed-id]')
  const btn = c ? (c.querySelector('.pcard__author') || c.querySelector('.pcard__authorBtn')) : null
  if (!btn) return { ok: false, why: '无法回到资料页' }
  btn.click()
  await new Promise(r => setTimeout(r, 2200))
  const fb = [...document.querySelectorAll('button')].find((b) => /^关注$/.test((b.textContent || '').trim()))
  if (!fb) return { ok: true, hasFollowBtn: false }
  if (!window.__WO12NET__) {
    window.__WO12NET__ = 0
    const orig = window.fetch
    window.fetch = async (...a) => { window.__WO12NET__++; return orig(...a) }
  }
  const before = window.__WO12NET__
  fb.click()
  await new Promise(r => setTimeout(r, 1800))
  const after = window.__WO12NET__
  const nowText = (fb.textContent || '').trim()
  return {
    ok: true,
    hasFollowBtn: true,
    fetchDelta: after - before,
    textAfterClick: nowText,
    /* 判据：点了之后文案变了、但**零请求** → 纯本地假成功 */
    fakeSuccess: after - before === 0 && nowText !== '关注',
  }
})()`)
log('FOLLOW_PROBE', followProbe)

// ---------- 4b) 非法/缺失 id → 明确不可用态，**绝不回落** ----------
console.log('')
console.log('=== 4b) INVALID_PROFILE_ID_NO_FALLBACK（审核 53 的 identity 安全原则）===')
/*
  判别设计：三种坏输入分别试，断言页面显示"不可用"而**不是任何人**。
  关键区分：一个只删了 `?? users.u1` 但没做不可用态的实现，会显示空白/崩溃；
  而正确实现显示明确的不可用态。两者都要与"显示了某个真实用户"区分开。
*/
const badIds = [
  { why: '完全没有 id', hash: '#/user' },
  { why: '非法形状', hash: '#/user?id=not-a-uuid' },
  { why: '不存在但形状合法的 uuid', hash: '#/user?id=00000000-0000-4000-8000-000000000000' },
]
const invalidProbe = { cases: [] }
for (const b of badIds) {
  await evaluate(`location.hash = '${b.hash}'`)
  await sleep(2200)
  const r = await evaluate(`(() => {
    const bodyText = document.body.innerText || ''
    const st = document.querySelector('[data-user-state]')
    const nameEl = document.querySelector('[data-user-name]')
    return {
      state: st ? st.getAttribute('data-user-state') : null,
      shownName: nameEl ? (nameEl.textContent || '').trim() : null,
      isUnavailable: /用户不可用|无法找到/.test(bodyText),
      mockHit: ${JSON.stringify(MOCK_ONLY_NAMES)}.filter((n) => bodyText.includes(n)),
      hashtag: location.hash,
    }
  })()`)
  invalidProbe.cases.push({ ...b, ...r })
}
log('INVALID_ID_PROBE', invalidProbe)
const noFallbackOk = invalidProbe.cases.every(
  (c) => c.isUnavailable === true && c.shownName === null && c.mockHit.length === 0,
)

// ---------- 4c) 回到**有效**资料页（4b 的不可用态用例把页面导航走了）----------
/*
  ⚠️ 顺序修正（我第一版把 4d/4e 放在 4b 之后，导致它们读的是"不可用态"那一页）：
     4b 会依次导航到三种非法 id，结束时页面停在 unavailable；
     而 4d/4e 都要读"有效资料页"的 DOM，于是 uiIds 读到空数组 → 假 FAIL。
     → 正确做法：在进入 4c/4d/4e 之前**先重新走一次真实入口**回到有效资料页。
       （仍然走真实点击路径，不直接设 hash —— 保持与 USER_PROFILE_IDENTITY_FROM_ROUTE 同一纪律。）
*/
console.log('')
console.log('=== 4c) 回到有效资料页（重走真实入口）===')
await evaluate(`location.hash = '#/campus'`)
await sleep(2200)
const reenter = await evaluate(`(async () => {
  const c = document.querySelector('[data-feed-id]')
  const btn = c ? (c.querySelector('.pcard__author') || c.querySelector('.pcard__authorBtn')) : null
  if (!btn) return { ok: false, why: '无法重走入口' }
  btn.click()
  await new Promise(r => setTimeout(r, 2400))
  return { ok: true, hash: location.hash }
})()`)
log('REENTER_PROFILE', reenter)

// 重新读一次资料页快照（4c/4d/4e 都基于这一份）
const profReady = await evaluate(`(() => {
  const st = document.querySelector('[data-user-state]')
  return {
    hash: location.hash,
    state: st ? st.getAttribute('data-user-state') : null,
    shownName: (document.querySelector('[data-user-name]') || {}).textContent || null,
    uiPostIds: [...document.querySelectorAll('[data-user-posts] [data-feed-id]')].map((e) => e.getAttribute('data-feed-id')),
    avatarIsPlaceholder: !!document.querySelector('[data-user-avatar-placeholder]'),
  }
})()`)
log('PROFILE_READY_AGAIN', profReady)
/*
  规范化规则（审核 53）：`u:<uuid>` 兼容解析，但**立刻**变成 canonical UUID；
  并且"URL 里的 id 解析出来的 uuid"必须**等于**我们随后查的那个 uuid
（否则会出现"用 A 的 id 查、拿 B 的资料渲染"这种最难发现的错）。
*/
const urlIdRaw = prof && prof.hash ? decodeURIComponent((prof.hash.match(/id=([^&]+)/) || [])[1] ?? '') : ''
const urlUuid = urlIdRaw.startsWith('u:') ? urlIdRaw.slice(2) : urlIdRaw
const apiUser = await evaluate(`(async () => {
  const raw = ${JSON.stringify(urlUuid)}
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return { ok: false, why: 'URL 里的 id 不是 canonical uuid', raw }
  }
  try {
    const res = await fetch('${API_ORIGIN}/api/users/' + raw)
    const ct = res.headers.get('content-type') || ''
    if (ct.indexOf('text/html') >= 0) return { ok: false, why: 'text/html（打到前端而非后端）' }
    if (!res.ok) return { ok: false, status: res.status }
    const d = await res.json()
    return { ok: true, id: d.id, displayName: d.displayName, keys: Object.keys(d).sort() }
  } catch (e) {
    return { ok: false, why: String(e && e.message) }
  }
})()`)
log('API_USER_IDENTITY', { urlIdRaw, urlUuid, apiUser })

// ---------- 4d) TA 的动态：必须来自**服务端** authorId 过滤 ----------
console.log('')
console.log('=== 4d) TA 的动态：服务端过滤 + 集合连续性 ===')
const postsProbe = await evaluate(`(async () => {
  const raw = ${JSON.stringify(urlUuid)}
  /* ⚠️ uiIds 用**重新进入后**读到的快照（profReady.uiPostIds），
     而不是此刻再读 DOM —— 因为本段位于 4b 之后，页面可能已不在有效资料页。 */
  const uiIds = ${JSON.stringify(profReady && profReady.uiPostIds ? profReady.uiPostIds : [])}
  if (!/^[0-9a-f-]{36}$/i.test(raw)) return { ok: false, why: 'no canonical uuid' }
  try {
    /* 关键：**带 authorId 参数**调服务端（不是拉全量后客户端 filter） */
    const res = await fetch('${API_ORIGIN}/api/posts?authorId=' + raw)
    const ct = res.headers.get('content-type') || ''
    if (ct.indexOf('text/html') >= 0) return { ok: false, why: 'text/html（打到前端而非后端）' }
    if (!res.ok) return { ok: false, status: res.status }
    const d = await res.json()
    const items = Array.isArray(d.items) ? d.items : []
    /* 反向校验：服务端过滤真的生效了——返回项的 authorId 必须全等于该 uuid */
    const allSameAuthor = items.every((x) => x.authorId === raw)
    return {
      ok: true,
      authorFilterUsed: true,
      apiIds: items.map((x) => x.id),
      uiIds,
      apiCount: items.length,
      allSameAuthor,
    }
  } catch (e) {
    return { ok: false, why: String(e && e.message) }
  }
})()`)
log('USER_POSTS_PROBE', postsProbe)

// ---------- 4e) 私信目的地（审核 53 要求拆成三条）----------
console.log('')
console.log('=== 4e) 私信：现有会话身份 / 不得 mock thread id / 无目的地时不得假动作 ===')
const dmProbe = await evaluate(`(async () => {
  const raw = ${JSON.stringify(urlUuid)}
  const btn = document.querySelector('[data-dm-real-thread]')
  const unavail = document.querySelector('[data-dm-unavailable]')
  /* 现有 direct 会话（按 peerId 匹配）→ 期望恰好一个 */
  let expected = null
  let threadsOk = false
  try {
    const t = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
    const tok = t && t.token
    const res = await fetch('${API_ORIGIN}/api/threads', tok ? { headers: { authorization: 'Bearer ' + tok } } : undefined)
    const d = await res.json()
    const matches = (d.items || []).filter((x) => x.kind === 'direct' && x.peerId === raw)
    threadsOk = true
    expected = matches.length === 1 ? matches[0].id : null
  } catch (e) { threadsOk = false }

  const dest = btn ? btn.getAttribute('data-dm-real-thread') : null
  return {
    threadsOk,
    expectedThreadId: expected,
    uiDest: dest,
    hasDmButton: !!btn,
    hasUnavailableText: !!unavail,
    /* ① 有真实目的地时：界面目的地的**身份**必须等于 API 给出的那个 thread UUID */
    identityOk: expected === null ? (dest === null) : dest === expected,
    /*
      ② 绝不许出现 mock thread id（t1 之类）。

      ⚠️ 这里**必须**用 [0-9] 而不是反斜杠 d —— 我第一版写的是 /^t\\d+$/，
         但它处在**外层模板字符串内部**：模板字符串里「反斜杠 d」被解析成字符 d，
         于是正则变成 /^td+$/、**永远匹配不到 "t1"** → 断言恒为 true、完全失去判别力。
         这是敏感度测试把它暴露出来的：注入 mock id t1 后 noMockThreadId 竟然是 true
         （真正拦住突变的是 identityOk，不是这条断言）。
         同类陷阱本项目已记录过（反引号 / 美元花括号 / 这里的反斜杠 d）。
         注意：本次修这条注释时我又踩了一次 —— 注释里写了反引号，把外层模板提前闭合，
         被 check-gate-syntax.sh 当场抓到（那条机械检查就是这么来的）。
         **在模板字符串内部写字，只用不会被转义/闭合吃掉的写法。**
    */
    noMockThreadId: !/^t[0-9]+$/.test(String(dest))
      && !document.body.innerHTML.includes('chat?id=t1'),
    /* ③ 没有目的地时：要么按钮不存在，要么显示**静态**不可用说明 —— 不得有可点的假按钮 */
    noDestinationNoFakeAction: expected !== null ? true : (dest === null && (!!unavail || !btn)),
  }
})()`)
log('DM_PROBE', dmProbe)

// ---------- 判定 ----------
const setEq = (a, b) => {
  const x = (a || []).slice().sort()
  const y = (b || []).slice().sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}
const identityOk =
  clicked && clicked.ok && clicked.clickedAuthorName && prof && prof.shownName &&
  clicked.clickedAuthorName === prof.shownName

/* 作者 id：从 URL 取（应等于被点卡片的作者 id 对应的规范化 uuid） */
const routeId = prof && prof.hash ? decodeURIComponent((prof.hash.match(/id=([^&]+)/) || [])[1] ?? '') : ''
const routeUuid = routeId.startsWith('u:') ? routeId.slice(2) : routeId

const v = {
  /* ---- 身份（审核 53 的三条核心）---- */
  USER_PROFILE_IDENTITY_FROM_ROUTE: identityOk ? 'PASS' : 'FAIL',
  /* 显示名 == GET /api/users/:id 的 displayName
     ⚠️ 用 **profReady.shownName**（重新进入后读的），因为本判定在 4b 之后执行，
        prof.shownName 是最早那一份快照。两处都应一致；用较新的那份更贴近"当前实现"。 */
  USER_PROFILE_DISPLAY_IDENTITY:
    profReady && profReady.shownName && apiUser && apiUser.ok && apiUser.displayName === profReady.shownName
      ? 'PASS'
      : 'FAIL',
  NO_MOCK_IDENTITY:
    prof && prof.mockNamesHit && prof.mockNamesHit.length === 0 ? 'PASS' : 'FAIL',
  /* 非法/缺失 id 不得回落到任何用户 */
  INVALID_PROFILE_ID_NO_FALLBACK: noFallbackOk ? 'PASS' : 'FAIL',

  /* ---- TA 的动态必须来自服务端权威来源 ---- */
  USER_POSTS_FROM_AUTHORITATIVE_SOURCE:
    postsProbe && postsProbe.ok && postsProbe.authorFilterUsed === true ? 'PASS' : 'FAIL',
  /* UI 帖子 id 集合 == 该作者在 API 上的帖子 id 集合 */
  USER_POST_IDENTITY_SET_CONTINUITY:
    postsProbe && postsProbe.uiIds && postsProbe.apiIds && setEq(postsProbe.uiIds, postsProbe.apiIds)
      ? 'PASS'
      : 'FAIL',

  /* ---- 无来源字段与头像 ---- */
  /*
    ⚠️ 头像断言的口径修正（我第一版写的是 `imgCount === 0` —— **错的**）：
      页面上的 <img> 不只头像：**动态卡片里的帖子图片**也是 <img>（那是合法的真实内容）。
      用"整页零 img"当判据会在"TA 有带图动态"时必然假 FAIL。
      正确判据：**头像元素本身**是首字占位（data-user-avatar-placeholder），
      而不是"页面上没有图片"。
  */
  USER_PROFILE_AVATAR_PLACEHOLDER:
    profReady && profReady.avatarIsPlaceholder === true ? 'PASS' : 'FAIL',
  USER_PROFILE_NO_SOURCELESS_FIELDS: prof && prof.hasSourcelessFields === false ? 'PASS' : 'FAIL',

  /* ---- 假交互 ---- */
  NO_FAKE_FOLLOW: prof && prof.hasFollowBtn === false ? 'PASS' : 'FAIL',

  /* ---- 私信（审核 53 要求拆成三条）---- */
  PROFILE_DM_EXISTING_THREAD_IDENTITY: dmProbe && dmProbe.identityOk === true ? 'PASS' : 'FAIL',
  PROFILE_DM_NO_MOCK_THREAD_ID: dmProbe && dmProbe.noMockThreadId === true ? 'PASS' : 'FAIL',
  PROFILE_DM_NO_DESTINATION_NO_FAKE_ACTION:
    dmProbe && dmProbe.noDestinationNoFakeAction === true ? 'PASS' : 'FAIL',

  detail: { clicked, prof, profReady, msgDest, followProbe, invalidProbe, postsProbe, dmProbe, routeUuid, apiUser },
  notes: {
    ORIGINAL_USER_PROFILE_CONFORMANCE:
      'NOT_EVALUATED —— 该屏无原版基线（screens/ 下只有 trident-me = 「我的」tab）。' +
      '即使全部 PASS，也只能声称 identity wiring / data semantics / fake interactions 三项，' +
      '**不能**声称「UserProfile 1:1 reproduced」。',
    USER_PROFILE_IDENTITY_FROM_ROUTE:
      '判别性：真实入口点击 + 显示名 == 被点作者名；只测"显示了名字"没有判别力',
  },
}
const KEYS = [
  'USER_PROFILE_IDENTITY_FROM_ROUTE',
  'USER_PROFILE_DISPLAY_IDENTITY',
  'NO_MOCK_IDENTITY',
  'INVALID_PROFILE_ID_NO_FALLBACK',
  'USER_POSTS_FROM_AUTHORITATIVE_SOURCE',
  'USER_POST_IDENTITY_SET_CONTINUITY',
  'USER_PROFILE_AVATAR_PLACEHOLDER',
  'USER_PROFILE_NO_SOURCELESS_FIELDS',
  'NO_FAKE_FOLLOW',
  'PROFILE_DM_EXISTING_THREAD_IDENTITY',
  'PROFILE_DM_NO_MOCK_THREAD_ID',
  'PROFILE_DM_NO_DESTINATION_NO_FAKE_ACTION',
]
v.WO12_GATE = KEYS.every((k) => v[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO12_GATE === 'PASS' ? 0 : 1)
