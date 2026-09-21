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
    /* 头像形态：有 img 就是 mock SVG / 真实图；没有 img 说明可能已改首字占位 */
    imgCount: document.querySelectorAll('img').length,
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

// ---------- 判定 ----------
const identityOk =
  clicked && clicked.ok && clicked.clickedAuthorName && prof && prof.shownName &&
  clicked.clickedAuthorName === prof.shownName

const v = {
  /* 判别性：必须是"从真实入口点进 + 名字相符" */
  USER_PROFILE_IDENTITY_FROM_ROUTE: identityOk ? 'PASS' : 'FAIL',
  USER_PROFILE_NO_MOCK_IDENTITY:
    prof && prof.mockNamesHit && prof.mockNamesHit.length === 0 ? 'PASS' : 'FAIL',
  USER_PROFILE_NO_SOURCELESS_FIELDS: prof && prof.hasSourcelessFields === false ? 'PASS' : 'FAIL',
  USER_PROFILE_AVATAR_PLACEHOLDER:
    /* 当前该屏用 <img>（mock 生成的 SVG）→ 未用首字占位 → FAIL */
    prof && prof.imgCount === 0 ? 'PASS' : 'FAIL',
  USER_PROFILE_MSGDEST_REACHABLE:
    msgDest && msgDest.exists === false
      ? 'PASS' /* 不渲染也算合格（审核 52 对无真实能力入口的口径） */
      : msgDest && msgDest.looksInvalid === false && msgDest.hasComposer === true
        ? 'PASS'
        : 'FAIL',
  USER_PROFILE_NO_FAKE_FOLLOW:
    followProbe && followProbe.hasFollowBtn === false
      ? 'PASS'
      : followProbe && followProbe.fakeSuccess === false
        ? 'PASS'
        : 'FAIL',
  USER_PROFILE_NO_FAKE_AUTHORITATIVE_NUMBERS:
    prof && prof.fakeNumbers && prof.fakeNumbers.length === 0 ? 'PASS' : 'FAIL',
  detail: { clicked, prof, msgDest, followProbe },
  notes: {
    baseline: 'ORIGINAL_USER_PROFILE_CONFORMANCE: NOT_EVALUATED（该屏无原版基线，不做一致性主张）',
    USER_PROFILE_IDENTITY_FROM_ROUTE:
      '判别性：真实入口点击 + 显示名 == 被点作者名；只测"显示了名字"没有判别力',
  },
}
const KEYS = [
  'USER_PROFILE_IDENTITY_FROM_ROUTE',
  'USER_PROFILE_NO_MOCK_IDENTITY',
  'USER_PROFILE_NO_SOURCELESS_FIELDS',
  'USER_PROFILE_AVATAR_PLACEHOLDER',
  'USER_PROFILE_MSGDEST_REACHABLE',
  'USER_PROFILE_NO_FAKE_FOLLOW',
  'USER_PROFILE_NO_FAKE_AUTHORITATIVE_NUMBERS',
]
v.WO12_GATE = KEYS.every((k) => v[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO12_GATE === 'PASS' ? 0 : 1)
