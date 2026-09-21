/**
 * WO#13 设备侧 Gate：ProfileEditScreen（个人资料页）
 *
 * ## 为什么现在就跑（改前）
 *   审核 43 冻结的纪律：PREFERRED: pre-fix FAIL → fix → PASS。
 *   当前该页：saveEdit() 只 setState（**零网络请求**）但界面显示新值 = **假写成功**；
 *   「更换头像」无 onClick（inert 控件）；昵称/简介/性别/标签全来自 mock。
 *   —— 这是拿改前 FAIL 的唯一时机。
 *
 * ## 可达性（先证明它**不是**死代码，否则这些断言没有产品意义）
 *   MeScreen 有 **5 个入口** navigate('profile-edit')：我的兴趣/我的标签/编辑资料/介绍一下自己～/我的学校。
 *   本 Gate 必须**走真实入口**进入，不直接设 hash（同一纪律：证明"用户路径可达"）。
 *
 * ## 断言（改前应大量 FAIL）
 *   PROFILE_EDIT_REACHABLE_FROM_ME      从「我的」页点入口能到达该页（可达性前置）
 *   PROFILE_EDIT_NAME_FROM_AUTHORITY    昵称不是 mock 常量，而是权威来源（当前 me.name → FAIL）
 *   PROFILE_EDIT_SAVE_HITS_SERVER        点「保存」必须**真发请求**（当前 fetchDelta=0 → FAIL）
 *   PROFILE_EDIT_NO_FAKE_SAVE            零请求时**不得**出现"改成功"的表象（当前值会变 → FAIL）
 *   PROFILE_EDIT_NO_INERT_CONTROLS       「更换头像」等控件必须有行为或不存在（当前 inert → FAIL）
 *   PROFILE_EDIT_NO_SOURCELESS_FIELDS    不渲染无来源字段（简介/性别/标签/学校/校园名片）
 *   NO_FABRICATED_MEMBER_COUNT          不得出现编造数字（12,486 / 38,920）—— 含孤儿路由
 *   ORPHAN_PROFILE_ROUTES_DISPOSED      App.tsx 的 5 个孤儿路由已处置（改前：无人导航但仍在）
 *
 * ## 基线（两个层次相反，必须分开写）
 *   ORIGINAL_PROFILE_EDIT_ENTRY: OBSERVED        （trident-me/baseline.json:38/:42 有入口与文案）
 *   ORIGINAL_PROFILE_EDIT_CONFORMANCE: NOT_EVALUATED（页面内容层**无**基线，26 个屏目录里没有它）
 */

import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo13-gate.json'

const report = {
  startedAt: new Date().toISOString(),
  baseline: {
    ORIGINAL_PROFILE_EDIT_ENTRY: 'OBSERVED',
    ORIGINAL_PROFILE_EDIT_CONFORMANCE: 'NOT_EVALUATED',
    why: 'trident-me/baseline.json:38/:42 记录了入口与 5 个入口文案；但 screens/ 下没有本页的内容基线',
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

// ---------- 1) 走真实入口进入（证明可达，不直接设 hash）----------
console.log('=== 1) 真实入口：我的 → 点「编辑资料」 ===')
await evaluate(`location.hash = '#/me'`)
await sleep(2500)
const entry = await evaluate(`(async () => {
  const bodyText = document.body.innerText || ''
  /* 「编辑资料」按钮（MeScreen.tsx:66 的 .me__edit） */
  const btn = document.querySelector('.me__edit')
    || [...document.querySelectorAll('button')].find((b) => /编辑资料/.test(b.textContent || ''))
  if (!btn) return { ok: false, why: '「我的」页找不到「编辑资料」入口', textSample: bodyText.replace(/\\s+/g, ' ').slice(0, 120) }
  btn.click()
  await new Promise(r => setTimeout(r, 2200))
  return { ok: true, hashAfter: location.hash, clickedLabel: (btn.textContent || '').trim() }
})()`)
log('ENTRY_FROM_ME', entry)

// ---------- 2) 页面内容（先取快照）----------
console.log('')
console.log('=== 2) 页面内容与无来源字段 ===')
const pageSnap = await evaluate(`(() => {
  const bodyText = document.body.innerText || ''
  const camBtn = document.querySelector('.pe__camera')
  return {
    hash: location.hash,
    title: (document.querySelector('.topbar__center') || {}).textContent || null,
    /* 昵称当前值（改前应为 mock 的 me.name） */
    nameShown: (document.querySelector('.pe__row .pe__value') || {}).textContent || null,
    rowCount: document.querySelectorAll('.pe__row').length,
    /* inert 控件：有按钮但没有 onclick/onClick 绑定 —— 用"点了之后有无变化"间接测（见下） */
    hasCameraBtn: !!camBtn,
    /* 无来源字段 */
    hasSourceless: /简介|性别|校园名片|我的兴趣|我的标签/.test(bodyText),
    /** 编造数字 */
    fabricated: ['12,486', '38,920', '12486', '38920'].filter((n) => bodyText.includes(n)),
    textSample: bodyText.replace(/\\s+/g, ' ').slice(0, 220),
  }
})()`)
log('PROFILE_EDIT_PAGE', pageSnap)

// ---------- 3) ⭐ 假写成功：改昵称 → 点保存 → 看是否真发请求 ----------
console.log('')
console.log('=== 3) ⭐ 假写成功检测：改昵称 → 保存 → fetch 计数 + 界面是否显示成功 ===')
const fakeSave = await evaluate(`(async () => {
  /* 计数 fetch（只装一次） */
  if (!window.__WO13_NET__) {
    window.__WO13_NET__ = 0
    const orig = window.fetch
    window.fetch = async (...a) => { window.__WO13_NET__++; return orig(...a) }
  }
  /* 打开昵称编辑面板 */
  const row = [...document.querySelectorAll('.pe__row')].find((r) => /昵称/.test(r.textContent || ''))
  if (!row) return { ok: false, why: '找不到昵称行' }
  const before = (row.querySelector('.pe__value') || {}).textContent || ''
  row.click()
  await new Promise(r => setTimeout(r, 900))

  /* 面板里的输入框（.pe__panel 里的 input/textarea） */
  const input = document.querySelector('.pe__panel input, .pe__panel textarea, .pe__panelInput')
  if (!input) {
    return { ok: false, why: '编辑面板里没有输入控件', panelHtml: (document.querySelector('.pe__panel') || {}).outerHTML?.slice(0, 160) }
  }
  const NEW_NAME = 'WO13门禁用例' + Date.now().toString().slice(-4)
  /* React 受控输入：必须派发 input 事件，否则 setState 不更新 */
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(input, NEW_NAME)
  else input.value = NEW_NAME
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 500))

  /* 点「保存」 */
  const saveBtn = [...document.querySelectorAll('button')].find((b) => /^保存$/.test((b.textContent || '').trim()))
  if (!saveBtn) return { ok: false, why: '找不到「保存」按钮' }
  const netBefore = window.__WO13_NET__
  saveBtn.click()
  await new Promise(r => setTimeout(r, 2000))
  const netAfter = window.__WO13_NET__

  const rowAfter = [...document.querySelectorAll('.pe__row')].find((r) => /昵称/.test(r.textContent || ''))
  const after = (rowAfter.querySelector('.pe__value') || {}).textContent || ''
  return {
    ok: true,
    before, attempted: NEW_NAME, after,
    fetchDelta: netAfter - netBefore,
    /** ⭐ 判据：界面值变了但请求数为 0 → **假写成功** */
    fakeSuccess: (netAfter - netBefore) === 0 && after === NEW_NAME,
    panelStillOpen: !!document.querySelector('.pe__panel'),
  }
})()`)
log('FAKE_SAVE_PROBE', fakeSave)

// ---------- 4) inert 控件检测：点「更换头像」是否有任何反应 ----------
console.log('')
console.log('=== 4) inert 控件：点「更换头像」 ===')
const inert = await evaluate(`(async () => {
  const btn = document.querySelector('.pe__camera')
  if (!btn) return { exists: false }
  const hashBefore = location.hash
  const htmlBefore = document.body.innerHTML.length
  const textBefore = document.body.innerText || ''
  const fileBefore = document.querySelectorAll('input[type=file]').length
  const dialogSel = '[role=dialog], .sheet, .modal, .pe__panel'
  const dialogBefore = document.querySelectorAll(dialogSel).length
  btn.click()
  await new Promise(r => setTimeout(r, 1500))
  const textAfter = document.body.innerText || ''
  return {
    exists: true,
    hashChanged: location.hash !== hashBefore,
    bodyLenDelta: document.body.innerHTML.length - htmlBefore,
    fileDelta: document.querySelectorAll('input[type=file]').length - fileBefore,
    dialogDelta: document.querySelectorAll(dialogSel).length - dialogBefore,
    textChanged: textAfter !== textBefore,
    /* ⚠️ 判据必须用**点击前后的差集**，不能用"页面上是否含某些字"。
       我第一版用的是 选择|上传|相册 的正则 —— 而页面上**本来就**有「选择标签」，
       于是 anyDialog 恒为 true、本断言**恒 PASS**（把"恰好有这些字"当成"点击产生了弹层"）。
       这正是本项目反复出现过的"空过断言"：**断言测的对象不是它声称的那个东西**。
       正确判据：点击后是否**新增**了文件选择器 / 弹层 / 路由变化，或文本实质变化。 */
    reacted:
      location.hash !== hashBefore ||
      document.querySelectorAll('input[type=file]').length !== fileBefore ||
      document.querySelectorAll(dialogSel).length !== dialogBefore ||
      textAfter !== textBefore,
  }
})()`)
log('INERT_CONTROL_PROBE', inert)

// ---------- 5) 编造数字（含孤儿路由）----------
console.log('')
console.log('=== 5) 编造数字：本页 + 5 个孤儿路由（App.tsx 的静态页）===')
const fabricated = { here: pageSnap ? pageSnap.fabricated : [], orphan: [] }
for (const h of ['#/school', '#/edit-profile', '#/interests', '#/tags', '#/bio']) {
  await evaluate(`location.hash = '${h}'`)
  await sleep(1400)
  const r = await evaluate(`(() => {
    const t = document.body.innerText || ''
    return {
      hash: location.hash,
      nonEmpty: t.trim().length > 0,
      fabricated: ['12,486', '38,920', '12486', '38920'].filter((n) => t.includes(n)),
      sample: t.replace(/\\s+/g, ' ').slice(0, 90),
    }
  })()`)
  fabricated.orphan.push({ route: h, ...r })
}
log('FABRICATED_NUMBERS', fabricated)

// ---------- 判定 ----------
const v = {
  /* 可达性前置：走真实入口能到达 */
  PROFILE_EDIT_REACHABLE_FROM_ME:
    entry && entry.ok && String(entry.hashAfter || '').includes('profile-edit') ? 'PASS' : 'FAIL',

  /* 昵称必须来自权威来源（改前是 mock 的 me.name）—— 改前无法直接断言"来源"，
     因此用"当前显示值是否等于 mock 常量"来证伪：等于即 FAIL。
     权威实现后该值应等于服务端 displayName（改后门禁会换成与 /api/auth/me 比对）。 */
  PROFILE_EDIT_NAME_FROM_AUTHORITY:
    pageSnap && pageSnap.nameShown && /自定义名称|蒸柿煮捞呆|校园用户/.test(pageSnap.nameShown) ? 'FAIL' : 'PASS',

  /* ⭐ 核心：保存必须真发请求 */
  PROFILE_EDIT_SAVE_HITS_SERVER:
    fakeSave && fakeSave.ok && fakeSave.fetchDelta > 0 ? 'PASS' : 'FAIL',

  /* ⭐ 核心：零请求时不得出现"改成功"的表象 */
  PROFILE_EDIT_NO_FAKE_SAVE:
    fakeSave && fakeSave.ok && fakeSave.fakeSuccess === false ? 'PASS' : 'FAIL',

  /* inert 控件：点了任何反应都没有 → FAIL（有 file input / 弹层 / 路由变化才算有行为） */
  /* inert 控件：点了**任何反应都没有** → FAIL。判据用点击前后差集（reacted），
     不用"页面上是否含某些字"—— 那种写法会被页面上已有的文案误触发（我已踩过）。 */
  PROFILE_EDIT_NO_INERT_CONTROLS:
    inert && inert.exists === true && inert.reacted === false ? 'FAIL' : 'PASS',

  /* 无来源字段：不应渲染简介/性别/校园名片等（改前渲染了 → FAIL） */
  PROFILE_EDIT_NO_SOURCELESS_FIELDS: pageSnap && pageSnap.hasSourceless === true ? 'FAIL' : 'PASS',

  /* 编造数字：本页与孤儿路由都不得有 */
  NO_FABRICATED_MEMBER_COUNT:
    (fabricated.here || []).length === 0 &&
    fabricated.orphan.every((o) => (o.fabricated || []).length === 0)
      ? 'PASS'
      : 'FAIL',

  /* 孤儿路由是否已处置：改前它们仍在且内容非空 → FAIL */
  ORPHAN_PROFILE_ROUTES_DISPOSED:
    fabricated.orphan.every((o) => o.nonEmpty === false) ? 'PASS' : 'FAIL',

  detail: { entry, pageSnap, fakeSave, inert, fabricated },
  notes: {
    ORIGINAL_PROFILE_EDIT_ENTRY: 'OBSERVED（trident-me/baseline.json:38/:42 有入口与文案）',
    ORIGINAL_PROFILE_EDIT_CONFORMANCE:
      'NOT_EVALUATED —— 页面内容层无基线（screens/ 下 26 个目录没有资料编辑页）。' +
      '即使全部 PASS，也**不得**声称本页 1:1 复现。',
    PROFILE_EDIT_NO_INERT_CONTROLS:
      '判据来自 WO#10/WO#12 的既定处置：不留"点了没反应"的控件；有 file input/弹层/路由变化才算有行为',
  },
}
const KEYS = [
  'PROFILE_EDIT_REACHABLE_FROM_ME',
  'PROFILE_EDIT_NAME_FROM_AUTHORITY',
  'PROFILE_EDIT_SAVE_HITS_SERVER',
  'PROFILE_EDIT_NO_FAKE_SAVE',
  'PROFILE_EDIT_NO_INERT_CONTROLS',
  'PROFILE_EDIT_NO_SOURCELESS_FIELDS',
  'NO_FABRICATED_MEMBER_COUNT',
  'ORPHAN_PROFILE_ROUTES_DISPOSED',
]
v.WO13_GATE = KEYS.every((k) => v[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', v)

ws.close()
process.exit(v.WO13_GATE === 'PASS' ? 0 : 1)
