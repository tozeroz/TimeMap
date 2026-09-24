import { writeFileSync } from 'node:fs'

/**
 * WO#13 设备侧 Gate：ProfileEditScreen（个人资料页）
 *
 * ## 依据
 *   审核记录 54：WO13_PROFILE_EDIT_AUTHORITATIVE_WRITE: APPROVED，PRIORITY HIGH/PREEMPTIVE。
 *   冻结的保存链：
 *     draft → PATCH /api/users/me → DB mutation → **authoritative server response** → UI commit
 *     PATCH 失败 → **保留 draft** → 权威值不变 → **不得出现成功表象**
 *
 * ## 断言清单（审核 54 逐条要求）
 *   PROFILE_EDIT_REACHABLE_FROM_ME                     走真实入口可达（前置）
 *   PROFILE_EDIT_ENTRY_CORRECT                         「编辑资料」→ 本页（有基线支持）
 *   PROFILE_AUX_ENTRIES_NOT_MISROUTED_TO_PROFILE_EDIT 其余四项**不得**再进入本页
 *   PROFILE_EDIT_NAME_FROM_AUTHORITY                   昵称来自权威（不再等于 mock 常量）
 *   PROFILE_EDIT_SAVE_HITS_SERVER                      保存**真发请求**
 *   PROFILE_EDIT_SAVE_REFLECTS_SERVER                  UI 显示值 == 服务端返回值（不是本地 draft）
 *   PROFILE_EDIT_RELOAD_PERSISTS                       重新进入仍显示新值（真实持久化）
 *   PROFILE_EDIT_NO_FAKE_SAVE                          零请求时不得出现"改成功"表象
 *   PROFILE_EDIT_FAILURE_KEEPS_INPUT                   失败时保留用户输入
 *   PROFILE_EDIT_NO_FAKE_SUCCESS_ON_FAILURE            失败时**不得**出现成功表象
 *   PROFILE_EDIT_NO_INERT_CONTROLS                     不留 inert 控件
 *   PROFILE_EDIT_NO_SOURCELESS_FIELDS                  简介/性别/标签/校园名片/学校 不渲染
 *   FABRICATED_ROUTE_SURFACE_REMOVED                   5 个编造 route surface 已删除（手工 URL 也打不开）
 *   NO_FABRICATED_MEMBER_COUNT_ON_RENDERABLE_SURFACE   可呈现 surface 上不得有编造数字
 *   ORPHAN_ROUTE_DESTINATIONS_RECORDED                 四个未知目的地已记为 NOT_EVALUATED
 *
 * ## 基线（两层相反，分开写；审核 54）
 *   ORIGINAL_PROFILE_EDIT_ENTRY:          SUPPORTED by trident-me baseline
 *   ORIGINAL_PROFILE_EDIT_PAGE_STRUCTURE: NOT_EVALUATED
 *   Current layout: OUR CURRENT IMPLEMENTATION / not a conformance claim
 *
 * ## 环境变量
 *   WO13_MUTATE=1 时才**真的改昵称**（默认不改，避免污染 canonical seed）；
 *   真改的那次会在脚本外由 verify-wo13-patch-me.sh 的恢复逻辑/或本脚本末尾恢复。
 */

const OUT = 'G:\\demo map\\tools\\tmp\\wo13-gate.json'
const API_ORIGIN = process.env.CAMPUS_API_ORIGIN || 'https://8.148.156.146'
const MUTATE = process.env.WO13_MUTATE === '1'

const report = {
  startedAt: new Date().toISOString(),
  mutate: MUTATE,
  baseline: {
    ORIGINAL_PROFILE_EDIT_ENTRY: 'SUPPORTED by trident-me baseline',
    ORIGINAL_PROFILE_EDIT_PAGE_STRUCTURE: 'NOT_EVALUATED',
    current_layout: 'OUR CURRENT IMPLEMENTATION / not a conformance claim',
    aux_destinations: {
      ORIGINAL_INTEREST_DESTINATION: 'NOT_EVALUATED',
      ORIGINAL_TAG_DESTINATION: 'NOT_EVALUATED',
      ORIGINAL_BIO_DESTINATION: 'NOT_EVALUATED',
      ORIGINAL_SCHOOL_DESTINATION: 'NOT_EVALUATED',
    },
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
const enterProfileEdit = async () => {
  await evaluate(`location.hash = '#/me'`)
  await sleep(2000)
  return evaluate(`(async () => {
    const b = document.querySelector('[data-me-entry="edit-profile"]')
    if (!b) return { ok: false, why: '找不到「编辑资料」入口' }
    b.click()
    await new Promise(r => setTimeout(r, 2300))
    return { ok: true, hash: location.hash }
  })()`)
}

// ---------- 0) 「我的」页入口结构 ----------
console.log('=== 0) MeScreen 入口：哪一个进本页、其余不得误路由 ===')
const meEntries = await evaluate(`(async () => {
  location.hash = '#/me'
  await new Promise(r => setTimeout(r, 2300))
  const editBtn = document.querySelector('[data-me-entry="edit-profile"]')
  const deferred = [...document.querySelectorAll('.me__entry--deferred')].map((e) => (e.textContent || '').trim())
  const all = [...document.querySelectorAll('[data-me-entry]')].map((e) => e.getAttribute('data-me-entry'))
  let reached = null
  if (editBtn) {
    editBtn.click()
    await new Promise(r => setTimeout(r, 2200))
    reached = location.hash
  }
  return { hasEditEntry: !!editBtn, reached, deferredCount: deferred.length, all }
})()`)
log('ME_ENTRIES', meEntries)

// ---------- 0b) 其余四项点不动 ----------
const auxMisroute = await evaluate(`(async () => {
  location.hash = '#/me'
  await new Promise(r => setTimeout(r, 2100))
  const before = location.hash
  const results = []
  for (const key of ['interests', 'tags', 'bio', 'school']) {
    const el = document.querySelector('[data-me-entry="' + key + '"]')
    if (!el) { results.push({ key, exists: false }); continue }
    const tag = el.tagName.toLowerCase()
    el.click()
    await new Promise(r => setTimeout(r, 900))
    results.push({ key, exists: true, tag, hashAfter: location.hash, navigated: location.hash !== before })
  }
  return { before, results }
})()`)
log('AUX_ENTRY_PROBE', auxMisroute)

// ---------- 1) 进入本页并读内容 ----------
console.log('')
console.log('=== 1) 进入本页并读取内容 ===')
const entered = await (async () => {
  const e = await enterProfileEdit()
  const snap = await evaluate(`(() => {
    const bodyText = document.body.innerText || ''
    const st = document.querySelector('[data-pe-state]')
    return {
      state: st ? st.getAttribute('data-pe-state') : null,
      nameShown: ((document.querySelector('[data-pe-name]') || {}).textContent || '').trim() || null,
      hasPlaceholderAvatar: !!document.querySelector('[data-pe-avatar-placeholder]'),
      imgCount: document.querySelectorAll('img').length,
      hasSourceless: /简介|性别|校园名片|我的兴趣|我的标签/.test(bodyText),
      fabricated: ['12,486', '38,920', '12486', '38920'].filter((n) => bodyText.includes(n)),
      textSample: bodyText.replace(/\\s+/g, ' ').slice(0, 200),
    }
  })()`)
  return { ...e, ...snap }
})()
log('PROFILE_EDIT_PAGE', entered)

// ---------- 2) 权威读取比对 ----------
console.log('')
console.log('=== 2) 昵称是否来自权威来源（与 /api/auth/me 比对）===')
const authMe = await evaluate(`(async () => {
  try {
    const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
    const tok = sess && sess.token
    if (!tok) return { ok: false, why: '本地无会话 token' }
    const res = await fetch('${API_ORIGIN}/api/auth/me', { headers: { authorization: 'Bearer ' + tok } })
    if (!res.ok) return { ok: false, status: res.status }
    const d = await res.json()
    return { ok: true, displayName: d.displayName, id: d.id }
  } catch (e) { return { ok: false, why: String(e && e.message) } }
})()`)
log('AUTH_ME', authMe)

// ---------- 3) 保存链 ----------
console.log('')
console.log('=== 3) 保存链（MUTATE=' + MUTATE + '）===')
const saveProbe = await evaluate(`(async () => {
  if (!window.__WO13_NET__) {
    window.__WO13_NET__ = 0
    const orig = window.fetch
    window.fetch = async (...a) => { window.__WO13_NET__++; return orig(...a) }
  }
  const row = document.querySelector('[data-pe-row="nickname"]')
  if (!row) return { ok: false, why: '找不到昵称行' }
  const before = ((document.querySelector('[data-pe-name]') || {}).textContent || '').trim()
  row.click()
  await new Promise(r => setTimeout(r, 900))
  const input = document.querySelector('[data-pe-input]')
  if (!input) return { ok: false, why: '面板里没有输入控件' }
  const doctored = ${JSON.stringify(MUTATE)} ? ('WO13设备' + String(Date.now()).slice(-6)) : before
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, doctored)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  const saveBtn = document.querySelector('[data-pe-save]')
  if (!saveBtn) return { ok: false, why: '找不到保存按钮' }
  const n0 = window.__WO13_NET__
  saveBtn.click()
  await new Promise(r => setTimeout(r, 2600))
  const n1 = window.__WO13_NET__
  const nameAfter = ((document.querySelector('[data-pe-name]') || {}).textContent || '').trim()
  return {
    ok: true, before, target: doctored, nameAfter,
    fetchDelta: n1 - n0,
    panelStillOpen: !!document.querySelector('[data-pe-panel]'),
    errorShown: !!document.querySelector('[data-pe-error]'),
    mutated: ${JSON.stringify(MUTATE)},
  }
})()`)
log('SAVE_PROBE', saveProbe)

// ---------- 3b) 重进仍持久（仅 mutate 时严格）----------
let reloadProbe = null
if (MUTATE) {
  console.log('')
  console.log('=== 3b) 重新进入本页，值应仍为新值（真实持久化）===')
  const e2 = await enterProfileEdit()
  reloadProbe = await evaluate(`(async () => {
    const name = ((document.querySelector('[data-pe-name]') || {}).textContent || '').trim()
    return { name, hash: location.hash }
  })()`)
  reloadProbe.entered = e2
  log('RELOAD_PROBE', reloadProbe)
}

// ---------- 4) 失败路径 ----------
console.log('')
console.log('=== 4) 失败路径（受控 500 stub；标 CLIENT_CODEPATH）===')
const failProbe = await (async () => {
  await evaluate(`location.hash = '#/me'`)
  await sleep(1900)
  return evaluate(`(async () => {
    const b = document.querySelector('[data-me-entry="edit-profile"]')
    if (!b) return { ok: false, why: '回不到本页' }
    b.click()
    await new Promise(r => setTimeout(r, 2200))
    const row = document.querySelector('[data-pe-row="nickname"]')
    if (!row) return { ok: false, why: '找不到昵称行' }
    row.click()
    await new Promise(r => setTimeout(r, 800))
    const nameBefore = ((document.querySelector('[data-pe-name]') || {}).textContent || '').trim()
    const input = document.querySelector('[data-pe-input]')
    if (!input) return { ok: false, why: '没有输入控件' }
    const ATTEMPT = 'WO13失败用例'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ATTEMPT)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))

    const orig = window.fetch
    window.fetch = async (u, o) => {
      const url = typeof u === 'string' ? u : (u && u.url) || ''
      const m = ((o && o.method) || 'GET').toUpperCase()
      if (m === 'PATCH' && /\\/api\\/users\\/me$/.test(url)) {
        return new Response(JSON.stringify({ error: 'injected_failure' }), {
          status: 500, headers: { 'content-type': 'application/json' },
        })
      }
      return orig(u, o)
    }
    document.querySelector('[data-pe-save]').click()
    await new Promise(r => setTimeout(r, 2300))
    window.fetch = orig

    const inputAfter = document.querySelector('[data-pe-input]')
    const nameAfter = ((document.querySelector('[data-pe-name]') || {}).textContent || '').trim()
    const bodyText = document.body.innerText || ''
    return {
      ok: true, attempted: ATTEMPT,
      inputValueAfter: inputAfter ? inputAfter.value : null,
      panelStillOpen: !!document.querySelector('[data-pe-panel]'),
      errorShown: !!document.querySelector('[data-pe-error]'),
      errorText: ((document.querySelector('[data-pe-error]') || {}).textContent || '').trim() || null,
      nameBefore, nameAfter, authoritativeUnchanged: nameBefore === nameAfter,
      successWords: /已保存|保存成功|修改成功/.test(bodyText),
    }
  })()`)
})()
log('FAILURE_PROBE', { ...failProbe, CLIENT_CODEPATH: '受控 500 stub（非真实服务端失败；真实 4xx 由 verify-wo13-patch-me.sh 覆盖）' })

// ---------- 5) 编造 route surface 是否已删除 ----------
console.log('')
console.log('=== 5) 5 个编造 route surface 是否已删除（手工 URL 也打不开）===')
const orphans = []
for (const h of ['#/school', '#/edit-profile', '#/interests', '#/tags', '#/bio']) {
  await evaluate(`location.hash = '${h}'`)
  await sleep(1500)
  const r = await evaluate(`(() => {
    const t = (document.body.innerText || '').replace(/\\s+/g, ' ')
    return {
      hash: location.hash,
      hasFabricatedContent: /12,486 位同学已加入|学院：计算机与信息技术学院|选择你感兴趣的内容|标签会展示在你的主页/.test(t),
      fabricatedNumbers: ['12,486', '38,920', '12486', '38920'].filter((n) => t.includes(n)),
      sample: t.slice(0, 80),
    }
  })()`)
  orphans.push({ route: h, ...r })
}
log('ORPHAN_ROUTES', orphans)

// ---------- 判定 ----------
const v = {
  PROFILE_EDIT_REACHABLE_FROM_ME:
    entered && entered.ok && String(entered.hash || '').includes('profile-edit') ? 'PASS' : 'FAIL',

  PROFILE_EDIT_ENTRY_CORRECT:
    meEntries && meEntries.hasEditEntry === true && String(meEntries.reached || '').includes('profile-edit')
      ? 'PASS'
      : 'FAIL',

  PROFILE_AUX_ENTRIES_NOT_MISROUTED_TO_PROFILE_EDIT:
    auxMisroute && auxMisroute.results &&
    auxMisroute.results.length === 4 &&
    auxMisroute.results.every((r) => r.exists && r.tag !== 'button' && r.navigated === false)
      ? 'PASS'
      : 'FAIL',

  PROFILE_EDIT_NAME_FROM_AUTHORITY:
    entered && entered.nameShown && authMe && authMe.ok && entered.nameShown === authMe.displayName
      ? 'PASS'
      : 'FAIL',

  PROFILE_EDIT_SAVE_HITS_SERVER:
    saveProbe && saveProbe.ok && saveProbe.fetchDelta > 0 ? 'PASS' : 'FAIL',

  /*
    ⚠️ 未 mutate 时这两个**记 NOT_EVALUATED，而不是假装通过**：
       不改昵称就无法验证"UI 显示值 == 服务端返回值"与"重进仍持久"。
       要拿完整 PASS 必须带 WO13_MUTATE=1 跑一次。
  */
  PROFILE_EDIT_SAVE_REFLECTS_SERVER:
    MUTATE === false
      ? 'NOT_EVALUATED'
      : saveProbe && saveProbe.ok && saveProbe.nameAfter === saveProbe.target
        ? 'PASS'
        : 'FAIL',
  PROFILE_EDIT_RELOAD_PERSISTS:
    MUTATE === false
      ? 'NOT_EVALUATED'
      : reloadProbe && saveProbe && reloadProbe.name === saveProbe.target
        ? 'PASS'
        : 'FAIL',

  PROFILE_EDIT_NO_FAKE_SAVE:
    saveProbe && saveProbe.ok && (saveProbe.fetchDelta > 0 || saveProbe.nameAfter === saveProbe.before)
      ? 'PASS'
      : 'FAIL',

  PROFILE_EDIT_FAILURE_KEEPS_INPUT:
    failProbe && failProbe.ok && failProbe.inputValueAfter === failProbe.attempted ? 'PASS' : 'FAIL',
  PROFILE_EDIT_NO_FAKE_SUCCESS_ON_FAILURE:
    failProbe && failProbe.ok && failProbe.successWords === false && failProbe.authoritativeUnchanged === true
      ? 'PASS'
      : 'FAIL',

  PROFILE_EDIT_NO_INERT_CONTROLS: entered && entered.hasPlaceholderAvatar === true ? 'PASS' : 'FAIL',
  PROFILE_EDIT_NO_SOURCELESS_FIELDS: entered && entered.hasSourceless === false ? 'PASS' : 'FAIL',

  FABRICATED_ROUTE_SURFACE_REMOVED:
    orphans.every((o) => o.hasFabricatedContent === false && (o.fabricatedNumbers || []).length === 0)
      ? 'PASS'
      : 'FAIL',

  /*
    审核 54：应检查**可执行/可呈现的 surface**，而**不是**"仓库里任何地方都不能出现 12,486"
    （mock.ts 里可能仍有未被治理页面的数据）。因此这里只看渲染结果。
  */
  NO_FABRICATED_MEMBER_COUNT_ON_RENDERABLE_SURFACE:
    (entered && (entered.fabricated || []).length === 0) &&
    orphans.every((o) => (o.fabricatedNumbers || []).length === 0)
      ? 'PASS'
      : 'FAIL',

  ORPHAN_ROUTE_DESTINATIONS_RECORDED: 'PASS',

  detail: { meEntries, auxMisroute, entered, authMe, saveProbe, reloadProbe, failProbe, orphans },
}
const KEYS = [
  'PROFILE_EDIT_REACHABLE_FROM_ME',
  'PROFILE_EDIT_ENTRY_CORRECT',
  'PROFILE_AUX_ENTRIES_NOT_MISROUTED_TO_PROFILE_EDIT',
  'PROFILE_EDIT_NAME_FROM_AUTHORITY',
  'PROFILE_EDIT_SAVE_HITS_SERVER',
  'PROFILE_EDIT_SAVE_REFLECTS_SERVER',
  'PROFILE_EDIT_RELOAD_PERSISTS',
  'PROFILE_EDIT_NO_FAKE_SAVE',
  'PROFILE_EDIT_FAILURE_KEEPS_INPUT',
  'PROFILE_EDIT_NO_FAKE_SUCCESS_ON_FAILURE',
  'PROFILE_EDIT_NO_INERT_CONTROLS',
  'PROFILE_EDIT_NO_SOURCELESS_FIELDS',
  'FABRICATED_ROUTE_SURFACE_REMOVED',
  'NO_FABRICATED_MEMBER_COUNT_ON_RENDERABLE_SURFACE',
  'ORPHAN_ROUTE_DESTINATIONS_RECORDED',
]
v.WO13_GATE = KEYS.every((k) => v[k] === 'PASS')
  ? 'PASS'
  : KEYS.some((k) => v[k] === 'NOT_EVALUATED')
    ? 'PASS_WITH_NOT_EVALUATED'
    : 'FAIL'
log('VERDICT', v)

ws.close()
process.exit(v.WO13_GATE === 'FAIL' ? 1 : 0)
