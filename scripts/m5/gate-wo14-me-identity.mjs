/**
 * WO#14 设备侧 Gate：MeScreen 的**权威自身身份**
 *
 * ## 为什么现在就跑（改前）
 *   审核 43/54/55 一贯的纪律：PREFERRED = **改前 FAIL → 改后 PASS**。
 *   当前该页：中心大字来自 mock、登录行来自 session 缓存（且 PATCH 后不更新）——
 *   这是拿"改前 FAIL"的**唯一时机**（实现之后就拿不到了）。
 *
 * ## 键名（审核记录 55 指定 + 一条同源补充）
 *   ME_IDENTITY_FROM_SESSION          中心显示名 == GET /api/auth/me 的 displayName（权威）
 *   ME_DISPLAY_NAME_CONSISTENCY       **同屏两处身份必须一致**（中心大字与登录行逐字相符）
 *   PROFILE_EDIT_TO_ME_CONTINUITY     ProfileEdit 改昵称 → 回「我的」**两处都跟随**
 *   ME_AVATAR_PLACEHOLDER             头像是首字占位（不是 mock 生成的 <img>）
 *   NO_MOCK_SELF_IDENTITY             不得出现 mock 专有昵称
 *   ME_NO_FALLBACK_ON_UNAVAILABLE     未登录/读到失败 → 明确不可用态，**不回落 mock**
 *                                     （与 WO#12 冻结的 identity 安全原则同源）
 *   基线：ORIGINAL_ME_SELF_IDENTITY_CONFORMANCE: NOT_EVALUATED
 *         （trident-me 只记了入口文案与位置，**未记**个人页自身上显示什么名字）
 *
 * ## ⚠️ 本 Gate 会**改一次昵称**（用 WO#13 已批准的 PATCH），结束**精确恢复**
 *   这是 PROFILE_EDIT_TO_ME_CONTINUITY 唯一可验证的形态：必须走真实写入路径。
 *   恢复用独立脚本 `restore-seed-nicknames.sh` 的同款做法（也是真实 PATCH）。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo14-gate.json'
const API_ORIGIN = process.env.CAMPUS_API_ORIGIN || 'https://8.148.156.146'
/** 恢复用的 canonical 昵称（与 seed 一致） */
const CANON_NAME = process.env.WO14_CANON_NAME || 'Lemy'
/** mock 里"自画像"用的名字 —— 出现它即说明中心名仍来自 mock */
const MOCK_SELF_NAME = '自定义名称6'

const report = {
  startedAt: new Date().toISOString(),
  baseline: {
    ORIGINAL_ME_SELF_IDENTITY_CONFORMANCE: 'NOT_EVALUATED',
    why: 'trident-me/baseline.json 只记了入口文案与位置，未记个人页自身上显示什么名字',
  },
  steps: [],
}
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

/** 读「我的」页的两处身份 + 头像形态 */
const snapMe = () =>
  evaluate(`(() => {
  const name = (document.querySelector('.me__name') || {}).textContent || null
  const who = (document.querySelector('.me__authWho') || {}).textContent || null
  const av = document.querySelector('.me__avatar')
  const bodyText = document.body.innerText || ''
  const placeholder = !!document.querySelector('[data-me-avatar-placeholder]')
  return {
    hash: location.hash,
    centerName: name ? name.trim() : null,
    authWho: who ? who.replace(/\\s+/g, ' ').trim() : null,
    avatarTag: av ? av.tagName.toLowerCase() : null,
    avatarIsImg: !!(av && av.tagName.toLowerCase() === 'img'),
    avatarSrcHead: av ? String(av.getAttribute('src') || '').slice(0, 20) : null,
    avatarPlaceholder: placeholder,
    hasMockSelfName: bodyText.includes(${JSON.stringify(MOCK_SELF_NAME)}),
  }
})()`)

// ---------- 1) 权威来源（GET /api/auth/me）----------
console.log('=== 1) 先取权威值：GET /api/auth/me ===')
const authMe = await evaluate(`(async () => {
  try {
    const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
    if (!sess.token) return { ok: false, why: '本地无会话 token（未登录）' }
    const res = await fetch('${API_ORIGIN}/api/auth/me', { headers: { authorization: 'Bearer ' + sess.token } })
    if (!res.ok) return { ok: false, status: res.status }
    const d = await res.json()
    return { ok: true, displayName: d.displayName, id: d.id }
  } catch (e) { return { ok: false, why: String(e && e.message) } }
})()`)
log('AUTH_ME', authMe)

// ---------- 2) 「我的」页快照（改前）----------
console.log('')
console.log('=== 2) 「我的」页两处身份 + 头像（改前快照）===')
await evaluate(`location.hash = '#/me'`)
await sleep(2600)
const before = await snapMe()
log('ME_BEFORE', before)

// ---------- 3) 走真实路径改昵称，看是否连续 ----------
console.log('')
console.log('=== 3) PROFILE_EDIT_TO_ME_CONTINUITY：改昵称 → 回「我的」 ===')
const TARGET = 'WO14门禁' + String(Date.now()).slice(-5)
const continuity = await evaluate(`(async () => {
  location.hash = '#/me'
  await new Promise(r => setTimeout(r, 1800))
  const b = document.querySelector('[data-me-entry="edit-profile"]')
  if (!b) return { ok: false, why: '找不到「编辑资料」入口' }
  b.click()
  await new Promise(r => setTimeout(r, 2300))
  const row = document.querySelector('[data-pe-row="nickname"]')
  if (!row) return { ok: false, why: '找不到昵称行' }
  row.click()
  await new Promise(r => setTimeout(r, 800))
  const input = document.querySelector('[data-pe-input]')
  if (!input) return { ok: false, why: '没有输入控件' }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(TARGET)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  document.querySelector('[data-pe-save]').click()
  await new Promise(r => setTimeout(r, 2600))
  const savedShown = ((document.querySelector('[data-pe-name]') || {}).textContent || '').trim()
  return { ok: true, target: ${JSON.stringify(TARGET)}, profileEditShows: savedShown, savedOk: savedShown === ${JSON.stringify(TARGET)} }
})()`)
log('PROFILE_EDIT_SAVE', continuity)

// 回「我的」页
await evaluate(`location.hash = '#/me'`)
await sleep(2600)
const after = await snapMe()
log('ME_AFTER_EDIT', after)

// ---------- 4) 未登录态是否回落 mock（不破坏会话：只读 DOM 断言，不改 session）----------
console.log('')
console.log('=== 4) ME_NO_FALLBACK_ON_UNAVAILABLE（结构性检查）===')
/*
  ⚠️ 这里**不**清 session（那会破坏后续断言与用户体验）。
  「未登录时是否回落 mock」用**源码结构**判定更合适；在运行时这里只做一条**弱断言**：
  记录"当前已登录时是否出现 mock 自称名"，作为 NO_MOCK_SELF_IDENTITY 的证据之一。
  真正的"无回落"实现后，应由**实现层**保证（未读到权威值 → 明确不可用态）。
  本 Gate 如实标注它为 NOT_EVALUATED（**不假装验过**）。
*/
const fallbackProbe = { note: '未登录态需要清 session，会破坏后续断言；本轮记 NOT_EVALUATED（不假装验过）' }
log('ME_FALLBACK_PROBE', fallbackProbe)

// ---------- 5) 恢复原昵称（不污染 seed）----------
console.log('')
console.log('=== 5) 恢复 canonical 昵称 ===')
const restore = await evaluate(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  if (!sess.token) return { ok: false, why: '无 token' }
  const res = await fetch('${API_ORIGIN}/api/users/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sess.token },
    body: JSON.stringify({ displayName: ${JSON.stringify(CANON_NAME)} }),
  })
  const d = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, displayName: d.displayName }
})()`)
log('RESTORE', restore)

// ---------- 判定 ----------
const v = {
  /** 中心显示名是否等于权威 displayName */
  ME_IDENTITY_FROM_SESSION:
    before && before.centerName && authMe && authMe.ok && before.centerName === authMe.displayName
      ? 'PASS'
      : 'FAIL',

  /** 同屏两处身份必须一致：中心大字 vs 登录行里的名字 */
  ME_DISPLAY_NAME_CONSISTENCY:
    before && before.centerName && before.authWho && before.authWho.includes(before.centerName)
      ? 'PASS'
      : 'FAIL',

  /** 改昵称后回「我的」：中心与登录行**都**要跟随 */
  PROFILE_EDIT_TO_ME_CONTINUITY:
    continuity && continuity.ok && continuity.savedOk && after &&
    after.centerName === TARGET && after.authWho && after.authWho.includes(TARGET)
      ? 'PASS'
      : 'FAIL',

  /** 头像必须是首字占位（不是 mock 生成的 <img>） */
  ME_AVATAR_PLACEHOLDER: before && before.avatarPlaceholder === true && before.avatarIsImg === false ? 'PASS' : 'FAIL',

  /** 不得出现 mock 自称名 */
  NO_MOCK_SELF_IDENTITY: before && before.hasMockSelfName === false ? 'PASS' : 'FAIL',

  /** 未登录不回落：本轮未能在不破坏断言的前提下验证 → NOT_EVALUATED（不假装验过） */
  ME_NO_FALLBACK_ON_UNAVAILABLE: 'NOT_EVALUATED',

  detail: { authMe, before, continuity, after, fallbackProbe, restore, target: TARGET },
  notes: {
    ORIGINAL_ME_SELF_IDENTITY_CONFORMANCE:
      'NOT_EVALUATED —— 该屏自身无基线（trident-me 只记了入口文案与位置）。' +
      '故即使全部 PASS，也只能声称"身份来自权威/不撒谎/连续性成立"，**不得**声称与原版一致。',
    ME_DISPLAY_NAME_CONSISTENCY:
      '判别性：断言的是**同屏两处**是否指向同一个人；只断言"显示了某个名字"没有判别力',
  },
}
const KEYS = [
  'ME_IDENTITY_FROM_SESSION',
  'ME_DISPLAY_NAME_CONSISTENCY',
  'PROFILE_EDIT_TO_ME_CONTINUITY',
  'ME_AVATAR_PLACEHOLDER',
  'NO_MOCK_SELF_IDENTITY',
  'ME_NO_FALLBACK_ON_UNAVAILABLE',
]
/*
  ⚠️⭐ 判定顺序**必须先看 FAIL**（这里我第一版写错了，而且错得很危险，记下来）：

  我第一版是：
      KEYS.every(PASS) ? 'PASS'
        : KEYS.some(NOT_EVALUATED) ? 'PASS_WITH_NOT_EVALUATED'
        : 'FAIL'

  它有个致命后果：只要**存在任一项 NOT_EVALUATED**，三元就会走到中间那支 →
  即使**其它 5 项全是 FAIL**，也会输出 `PASS_WITH_NOT_EVALUATED`、**exit 0**！
  （实测就是这样：5 条 FAIL + 1 条 NOT_EVALUATED → 设备门禁退出码 0。）

  → 这是"**判定被更弱的分支遮蔽**"这一类缺陷的另一形态（同类：CORS 门禁里
    "逐项赋值导致最后一项赢"、把'跳过'当成 PASS）。
    → 正确顺序：**先 FAIL → 再 NOT_EVALUATED → 最后才是全 PASS**。
      `NOT_EVALUATED` 只能降级"全绿"的说法，**绝不能**把 FAIL 洗成绿。
*/
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const anyNotEval = KEYS.some((k) => v[k] === 'NOT_EVALUATED')
v.WO14_GATE = anyFail ? 'FAIL' : anyNotEval ? 'PASS_WITH_NOT_EVALUATED' : 'PASS'
v.WO14_GATE_REASON = anyFail
  ? `有 ${KEYS.filter((k) => v[k] === 'FAIL').length} 条 FAIL：${KEYS.filter((k) => v[k] === 'FAIL').join(', ')}`
  : anyNotEval
    ? `无 FAIL，但有未评估项：${KEYS.filter((k) => v[k] === 'NOT_EVALUATED').join(', ')}`
    : '全部 PASS'
log('VERDICT', v)

ws.close()
// ⚠️ 只有真的 FAIL 才返回 1；PASS_WITH_NOT_EVALUATED 允许为 0（它明说"有未评估项"），
//    但**不允许**它掩盖 FAIL —— 上面已按 FAIL 优先的顺序算过。
process.exit(anyFail ? 1 : 0)
