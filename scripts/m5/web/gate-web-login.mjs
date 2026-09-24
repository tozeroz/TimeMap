/**
 * 网页端门禁：**登录流程**（补一个真实的覆盖缺口）
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 为什么需要它（这是覆盖率分析发现的缺口）
 * ════════════════════════════════════════════════════════════════════════════
 *   把前端**路由清单**与门禁覆盖对照后发现：board/campus/chat/feed/group/map/me/
 *   message/more/poi/profile-edit/publish/schools/upgrade/user 都有门禁覆盖，
 *   而 **login / loginselect 一个门禁都没有** —— 可登录恰恰是网页端用户的**第一道功能**。
 *   （我之前建立测试会话时是直接注入 token 绕过了登录 UI，所以这个缺口一直没暴露。）
 *   ⚠️ 结论：不能因为"门禁全绿"就说"所有功能都测过了"；必须**按功能清单核对覆盖**。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 怎么在**零成本、无需真验证码**的前提下验证真实调用链
 * ════════════════════════════════════════════════════════════════════════════
 *   真实登录要收短信验证码 ⇒ 自动化既读不到、又会**花钱并把短信发给真实号码**。
 *   而如果只测"按钮能不能点"，就证明不了 UI 真的接了后端。
 *
 *   ⇒ 用 CDP 的 **Fetch 域拦截** /api/auth/request-code：
 *       · 正向：注入一个成功响应 ⇒ 断言 UI **确实发起了这个请求**并推进到验证码步骤
 *       · 反向：注入一个失败响应 ⇒ 断言 UI **如实报错、不假装成功**（不进入下一步）
 *     全程**不发短信**、不需要真验证码，但验的是真实的前端代码路径与状态机。
 *
 * ⚠️ 真正"发短信 + 收码 + 建会话"的那一段**不在本门禁**内：它由 `gate-sms-login.sh`
 *    负责，且遵守其既有策略 —— **只在你提供自己的测试号（SMS_GATE_TEST_PHONE）时才判定**，
 *    否则如实记 INCONCLUSIVE。本门禁对那一段也记 INCONCLUSIVE，不假装覆盖。
 */
const PORT = process.env.CDP_PORT ?? 9222
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'https://8.148.156.146'
// 入口路径（默认 `/`）—— 与其它网页端门禁一致，供敏感度验证指向"故意坏的"子路径。
// ⚠️ 若改用 WEB_ORIGIN 去指向坏页面，origin 断言会一起失败 ⇒ 归因错误的假敏感度。
const WEB_ENTRY_PATH = process.env.WEB_ENTRY_PATH ?? '/'
const TEST_PHONE = process.env.WEB_LOGIN_GATE_PHONE ?? '13800000001' // 仅用于"格式合法"，不发送

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.error('FATAL 没有 page target'); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })

let id = 0
const pending = new Map()
const authRequests = []
let interceptMode = null // null | 'ok' | 'fail'
let intercepted = 0

ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Fetch.requestPaused') {
    const reqId = m.params.requestId
    authRequests.push(m.params.request.url)
    if (interceptMode === null) {
      await send('Fetch.continueRequest', { requestId: reqId }).catch(() => {})
    } else {
      intercepted++
      const body = interceptMode === 'ok'
        ? { ok: true, delivery: 'sms', sms_sender: '（测试拦截）' }
        : { error: 'rate_limited', message: '测试用失败响应' }
      await send('Fetch.fulfillRequest', {
        requestId: reqId,
        responseCode: interceptMode === 'ok' ? 200 : 429,
        responseHeaders: [
          { name: 'content-type', value: 'application/json' },
          { name: 'access-control-allow-origin', value: WEB_ORIGIN },
        ],
        body: Buffer.from(JSON.stringify(body), 'utf8').toString('base64'),
      }).catch(() => {})
    }
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
function send(method, params = {}) {
  return new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
}
async function ev(expr, t = 20000) {
  const p = send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), t))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SNAP = `(() => {
  const t = (document.body.innerText || '').replace(/\\s+/g,' ').trim()
  const b = [...document.querySelectorAll('button')].map(x => ({ t:(x.innerText||'').trim().slice(0,18), cls:x.className, dis:x.disabled, aria:x.getAttribute('aria-label') }))
  return { hash: location.hash, text: t.slice(0,300), btns: b, inputVal: (document.querySelector('.login__input')||{}).value ?? null,
           submitDisabled: (() => { const s=document.querySelector('.login__submit'); return s ? s.disabled : null })() }
})()`
// ⚠️⚠️ 每个场景都必须拿到**干净的初始状态**。
//   这里修过一次"测错东西"的缺陷（本轮第三次同类）：
//   初版用 `Page.navigate` 到 `${WEB}/#/login` 就算切场景，但**同源同路径只改 hash、
//   不会重新加载页面** ⇒ 应用状态是上一个场景残留的。
//   实测后果：注入"发送成功"之后，UI 处于「验证码已发送 / 倒计时」状态（按钮变成"登录"、
//   手机号仍是上一次的值），于是后面"非法号码"那两条断言量的根本不是非法号码场景，
//   得到 SUBMIT_DISABLED_FOR_INVALID_PHONE=false / NO_API_CALL_FOR_INVALID_PHONE=false，
//   看起来像功能缺陷，其实是**我的测试状态没重置**。
//   ⇒ 任何依赖"初始状态"的断言前，必须先 reload 拿到干净页面。
async function freshLoad(hash, settleMs = 3000) {
  await send('Page.navigate', { url: `${WEB_ORIGIN}${WEB_ENTRY_PATH}${hash}` })
  const d1 = Date.now() + 20000
  while (Date.now() < d1) {
    const st = await ev(`(() => ({ rs: document.readyState, org: location.origin }))()`)
    if (st && st.rs === 'complete' && String(st.org || '').startsWith(WEB_ORIGIN)) break
    await sleep(400)
  }
  // 关键：硬重载，让应用回到初始状态（清掉上一场景的手机号/倒计时/已发送态）
  await send('Page.reload', { ignoreCache: true })
  const d2 = Date.now() + 20000
  while (Date.now() < d2) {
    const st = await ev(`(() => ({ rs: document.readyState, hash: location.hash, hasInput: !!document.querySelector('.login__input') || !!document.querySelector('.ls__login') }))()`)
    if (st && st.rs === 'complete' && st.hasInput) break
    await sleep(400)
  }
  await sleep(settleMs)
}

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/auth/request-code*' }] })

const checks = {}
const detail = {}

// ── A) 协议门禁是真的（干净状态）───────────────────────────────────────
await freshLoad('#/loginselect')
const beforeAgree = await ev(SNAP)

// ⚠️⚠️ 前置断言：登录界面**确实存在**。
//   为什么必须有它：下面几条是**"否定式"断言**（"没有跳到 #/login"、"没有推进"），
//   而这类断言在"页面整个坏掉、什么都没发生"时**天然为真** ⇒ 会**空虚通过**。
//   实测证据：敏感度验证把本门禁指向一个"缺 #root 的坏页面"时，
//   LOGINSELECT_REQUIRES_AGREEMENT 仍然是 true —— 因为页面根本没渲染，自然没跳转。
//   ⇒ 先断言前置存在，再断言行为；这样"应用坏了"就一定会红。
checks.LOGINSELECT_SCREEN_PRESENT =
  beforeAgree.btns.some((b) => /ls__login/.test(b.cls)) &&
  beforeAgree.btns.some((b) => (b.aria || '') === '同意协议')
detail.loginSelectScreen = { text: beforeAgree.text.slice(0, 120), btns: beforeAgree.btns.map((b) => b.cls) }

// 确保未勾选（可能有 localStorage 记忆）
await ev(`(() => { const c=document.querySelector('.ls__check'); if(c && c.className.includes('is-on')) c.click(); return true })()`)
await sleep(600)
await ev(`(() => { const b=document.querySelector('.ls__login'); if(b) b.click(); return true })()`)
await sleep(1800)
const afterNoAgree = await ev(SNAP)
// ⚠️ 与前置联动：只有"界面存在"时，这几条才有判别力
checks.LOGINSELECT_REQUIRES_AGREEMENT =
  checks.LOGINSELECT_SCREEN_PRESENT === true && afterNoAgree.hash !== '#/login'
checks.AGREEMENT_BLOCK_IS_EXPLICIT =
  checks.LOGINSELECT_SCREEN_PRESENT === true && /请阅读并同意|同意并继续/.test(afterNoAgree.text)
detail.noAgree = { hash: afterNoAgree.hash, text: afterNoAgree.text.slice(0, 160) }

// 勾选后应能进入
await ev(`(() => { const c=document.querySelector('.ls__check'); if(c && !c.className.includes('is-on')) c.click(); return true })()`)
await sleep(700)
await ev(`(() => { const b=document.querySelector('.ls__login'); if(b) b.click(); return true })()`)
await sleep(2200)
const afterAgree = await ev(SNAP)
checks.AGREEMENT_ALLOWS_LOGIN = afterAgree.hash === '#/login'
detail.afterAgree = { hash: afterAgree.hash }

// ── B) 手机号校验（空 / 非法）—— 干净状态 ─────────────────────────────
await freshLoad('#/login')
const empty = await ev(SNAP)
// 前置断言（同 A 段的道理）：登录输入界面确实存在，否则下面的断言会空虚为真
checks.LOGIN_SCREEN_PRESENT =
  empty.hash === '#/login' && empty.inputVal !== null && empty.submitDisabled !== null
checks.SUBMIT_DISABLED_WHEN_EMPTY = checks.LOGIN_SCREEN_PRESENT === true && empty.submitDisabled === true

await ev(`(() => { const i=document.querySelector('.login__input'); if(!i) return false; i.focus(); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i,'123'); i.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
await sleep(1200)
const invalid = await ev(SNAP)

// ⚠️ 这里把判据从"我偏好的实现"改成"**行为是否诚实**"。
//   初版断言 `SUBMIT_DISABLED_FOR_INVALID_PHONE`（非法号码必须禁用按钮）——
//   但那是**一种设计选择**，不是必然正确的行为：
//     · 设计A：客户端按格式校验、非法时禁用按钮
//     · 设计B：客户端只做非空校验，格式交给**服务端**判定，并把服务端错误如实呈现
//   两者都合理。若把断言写成"必须禁用"，就是在用测试固化我的偏好，
//   而且会在设计B（同样正确）下报假缺陷。
//   ⇒ 真正必须成立的是：**既不静默无反应、也不假装成功**：
//      要么按钮就不可用；要么它真的打了接口、且把失败如实呈现出来。
authRequests.length = 0
await ev(`(() => { const s=document.querySelector('.login__submit'); if(s && !s.disabled) s.click(); return true })()`)
await sleep(3000)
const invalidAfterClick = await ev(SNAP)
const invalidDisabled = invalid.submitDisabled === true
const invalidCalledApi = authRequests.length > 0
checks.INVALID_PHONE_IS_HANDLED_HONESTLY =
  checks.LOGIN_SCREEN_PRESENT === true && (invalidDisabled || (invalidCalledApi && invalidAfterClick.hash === '#/login'))
// ⚠️ 必须与前置联动：否则"页面坏了、什么都没发生"也会让这条（否定式）断言空虚为真
checks.INVALID_PHONE_NEVER_ADVANCES =
  checks.LOGIN_SCREEN_PRESENT === true && invalidAfterClick.hash === '#/login'
detail.invalidPhone = {
  typed: '123',
  submitDisabled: invalid.submitDisabled,
  calledApi: invalidCalledApi,
  apiCalls: authRequests.slice(),
  hashAfterClick: invalidAfterClick.hash,
  textAfterClick: invalidAfterClick.text.slice(0, 200),
}

// ── C) 正向：合法格式 ⇒ UI 真的调用真实端点，并在成功响应后推进（干净状态）──
await freshLoad('#/login')
interceptMode = 'ok'
intercepted = 0
authRequests.length = 0
await ev(`(() => { const i=document.querySelector('.login__input'); if(!i) return false; const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i,${JSON.stringify(TEST_PHONE)}); i.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
await sleep(1200)
const valid = await ev(SNAP)
checks.SUBMIT_ENABLED_FOR_VALID_PHONE = valid.submitDisabled === false

await ev(`(() => { const s=document.querySelector('.login__submit'); if(s && !s.disabled) s.click(); return true })()`)
await sleep(4000)
const afterOk = await ev(SNAP)
checks.UI_CALLS_REQUEST_CODE_ENDPOINT = authRequests.some((u) => /\/api\/auth\/request-code/.test(u))
checks.ADVANCES_AFTER_SUCCESS = afterOk.hash !== '#/login' || /验证码/.test(afterOk.text)
detail.afterOk = { hash: afterOk.hash, text: afterOk.text.slice(0, 200), apiCalls: authRequests.slice() }

// ── D) 反向：失败响应 ⇒ 如实报错、**不假装成功**（干净状态）──────────────
await freshLoad('#/login')
interceptMode = 'fail'
await ev(`(() => { const i=document.querySelector('.login__input'); if(!i) return false; const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i,${JSON.stringify(TEST_PHONE)}); i.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
await sleep(1200)
authRequests.length = 0
await ev(`(() => { const s=document.querySelector('.login__submit'); if(s && !s.disabled) s.click(); return true })()`)
await sleep(4000)
const afterFail = await ev(SNAP)
checks.FAILURE_DOES_NOT_FAKE_SUCCESS = checks.LOGIN_SCREEN_PRESENT === true && afterFail.hash === '#/login'
// 失败必须**可感知**：要么给出错误文案，要么至少不能出现"已发送"这类成功措辞
const saysSent = /已发送/.test(afterFail.text)
checks.FAILURE_IS_SURFACED = authRequests.length > 0 && (!saysSent)
detail.afterFail = {
  hash: afterFail.hash,
  text: afterFail.text.slice(0, 260),
  apiCalls: authRequests.slice(),
  saysSentMisleadingly: saysSent,
}

// ── E) 真正发短信那一段：如实记 INCONCLUSIVE ───────────────────────────
const hasTestPhone = !!process.env.SMS_GATE_TEST_PHONE
checks.REAL_SMS_AND_SESSION = 'INCONCLUSIVE'
detail.realSmsNote = hasTestPhone
  ? '本次未在本门禁内执行（由 gate-sms-login.sh 负责，它会真的发短信）'
  : '未提供 SMS_GATE_TEST_PHONE ⇒ 不发送真实短信；该段由 gate-sms-login.sh 负责'

await send('Fetch.disable').catch(() => {})

const hardFail = Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k)
const incon = Object.entries(checks).filter(([, v]) => v === 'INCONCLUSIVE').map(([k]) => k)
console.log('VERDICT = ' + JSON.stringify({ ...checks, detail }))
ws.close()
process.exit(hardFail.length ? 1 : 0)
