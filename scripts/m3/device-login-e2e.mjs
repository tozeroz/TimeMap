/**
 * M3 Slice 0B：设备端登录 E2E（**不注入任何 session 夹具**）。
 *
 * 审核记录 08 明确要求：Slice 0B 的主路径不得再用 injected session fixture，
 * 必须证明「真实 UI 登录 → 服务端会话 → 已认证动作」这条闭环。
 *
 * 拆成三段，因为中间需要"运维从 dev sink 取本次随机验证码"这一步（本项目没有短信通道）：
 *
 *   node scripts/m3/device-login-e2e.mjs prepare   --phone 13800000001
 *      冷启动、清掉本地会话 → login-select → 未勾选协议点登录 → 断言弹窗
 *      → 同意并继续 → 手机号页 → 输号 → 点「获取验证码」→ 退出（等待运维取码）
 *
 *   node scripts/m3/device-login-e2e.mjs complete  --phone 13800000001 --code 123456
 *      输入验证码 → 点「登录」→ 断言：本地已存会话、/api/auth/me 返回该手机号
 *
 *   node scripts/m3/device-login-e2e.mjs restart
 *      重启 App → 断言会话仍在、me 仍可用
 *
 * 前置：adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const mode = argv[0]
const opt = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const phone = opt('phone')
const code = opt('code')

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('no debuggable page')
  process.exit(1)
}

let ws
let msgId = 0
let pending = new Map()

/**
 * 连接（或重连）WebView 的调试目标。
 *
 * **重连是必须的**：`location.reload()` 或 App 重启都会销毁旧的执行上下文，
 * 旧 WebSocket 上的 Runtime.evaluate 会静默返回 null ——
 * 表现就是"页面明明在，读取到的正文却是空字符串"。
 * 第一版脚本就踩了这个坑（prepare 阶段一直读到空页面）。
 */
async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!target) throw new Error('找不到可调试页面（adb forward 还在吗？）')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  pending = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result ?? msg.error)
      pending.delete(msg.id)
    }
  })

  /**
   * 连上之后先探一次：**"WebSocket open" 不等于"这条调试会话可用"**。
   * App 刚重启时页面目标往往短暂存在但还不能执行脚本，此时请求会超时，
   * 表现成"页面明明是空的"（第一版就是被这个坑住的）。所以这里探测到能执行才返回。
   */
  for (let i = 0; i < 20; i++) {
    const probe = await send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    })
    if (probe && !probe.timeout && probe.result?.value) return
    await wait(400)
  }
  throw new Error('调试会话连接后仍无法执行脚本（页面目标不可用）')
}
await connect()

function send(method, params) {
  const id = ++msgId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve({ timeout: true })
      }
    }, 20000)
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 执行一段表达式并取回值。
 *
 * **不传 awaitPromise**：这个 WebView 的 CDP 不接受该参数（会回 error），
 * 而错误被静默解析成 null 之后，表现就是"页面明明是好的，读出来却是空" ——
 * 这个坑排查了好几轮。所以现在**错误一律抛出**，绝不静默变 null。
 * 需要 Promise 的场景由调用方自己包成 IIFE + 用 `Promise` 兼容写法（见下）。
 */
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (!r || r.timeout) throw new Error(`CDP 请求超时: ${expression.slice(0, 80)}`)
  if (r.exceptionDetails) {
    throw new Error(`页面异常: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`)
  }
  if (r.result?.subtype === 'error') {
    throw new Error(`求值错误: ${JSON.stringify(r.result).slice(0, 300)}`)
  }
  const v = r.result?.value
  return v === undefined ? null : v
}

/**
 * 输入文本。逐级回退，并且**如实记录用了哪一种**。
 *
 * 为什么要回退：这个 WebView 上 `Input.insertText` 有时不生效（元素已聚焦但值为空），
 * 而"真实键盘输入"和"直接改 value"在证据强度上是有区别的，不能悄悄换成后者。
 * 所以：优先真实输入事件；退到直接改 value 时，在输出里明确标注 INPUT_FALLBACK。
 */
async function typeInto(selector, text, nth) {
  const pick = (sel, n) =>
    `(() => { const a = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${n === undefined ? 'a[0]' : `a[a.length-1]`}; return el ? {value: el.value ?? ''} : null })()`

  // 1) 真实输入事件
  await send('Input.insertText', { text })
  await wait(350)
  let got = (await evaluate(pick(selector, nth)))?.value ?? ''
  if (got === text) return { ok: true, how: 'Input.insertText' }

  // 2) 逐字符按键事件
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await wait(40)
  }
  await wait(300)
  got = (await evaluate(pick(selector, nth)))?.value ?? ''
  if (got === text) return { ok: true, how: 'dispatchKeyEvent' }

  // 3) 回退：用 React 能识别的原生 setter 改值（会标注为回退路径）
  await evaluate(`(() => {
    const a = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const el = ${nth === undefined ? 'a[0]' : 'a[a.length-1]'}
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, ${JSON.stringify(text)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await wait(300)
  got = (await evaluate(pick(selector, nth)))?.value ?? ''
  if (got === text) return { ok: true, how: 'INPUT_FALLBACK(native setter)' }

  return { ok: false, how: 'none', got }
}
async function evaluateAsync(bodyExpr, timeoutMs = 15000) {
  const key = `__e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  await evaluate(`window.${key} = {done:false}; (async () => { try { window.${key}.value = await (${bodyExpr}) } catch (e) { window.${key}.err = String(e) } finally { window.${key}.done = true } })(); 'started'`)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const s = await evaluate(`JSON.stringify({done: window.${key}.done, value: window.${key}.value ?? null, err: window.${key}.err ?? null})`)
    const parsed = JSON.parse(s)
    if (parsed.done) {
      await evaluate(`delete window.${key}`)
      if (parsed.err) throw new Error(`异步求值失败: ${parsed.err}`)
      return parsed.value
    }
    await wait(150)
  }
  throw new Error('异步求值超时')
}

async function centerOf(selector, textMatch) {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})]
    const el = ${textMatch ? `nodes.find((n) => n.textContent.trim() === ${JSON.stringify(textMatch)}) ?? nodes[0]` : 'nodes[0]'}
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
}

async function tapAt(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await wait(70)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(200)
}

async function tapSelector(selector, label, textMatch) {
  const c = await centerOf(selector, textMatch)
  if (!c) throw new Error(`找不到可点元素: ${selector}（${label}）`)
  await tapAt(c.x, c.y)
  return c
}

const hash = () => evaluate('location.hash')

/**
 * 取页面正文。
 * 注意：reload 之后新的 document 还没就绪时 document.body 可能是 null，
 * 表达式会抛错而 evaluate 返回 null —— 调用方如果直接 .includes 就会崩。
 * 统一返回字符串，并先用 waitForBody() 等文档就绪。
 */
async function bodyText() {
  const v = await evaluate(`(document.body ? (document.body.innerText || '') : '').replace(/\\s+/g, ' ')`)
  return typeof v === 'string' ? v : ''
}

/** 等文档就绪且正文非空（reload / 路由跳转后都要用） */
async function waitForBody(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const t = await bodyText()
    if (t.length > 0) return t
    await wait(200)
  }
  return ''
}

async function waitHash(expected, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await hash()) === expected) return true
    await wait(150)
  }
  return false
}

const steps = []
function record(name, detail) {
  steps.push(`${name}: ${detail}`)
  console.log(`  ${name}: ${detail}`)
}
function fail(msg) {
  console.error(`  FAIL ${msg}`)
  console.log(`\nDEVICE_LOGIN_RESULT FAIL`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// reset：只清本地存储，不 reload。
//
// 为什么拆出来：本脚本第一版让 prepare 自己做 `location.reload()` 来"冷启动"，
// 结果 reload 后重连到的是**还不能执行脚本的目标**，所有读取都超时空值，
// 于是"页面明明是登录页却断言失败"。现在把冷启动交给编排脚本用 adb 做**真正的进程重启**，
// 本脚本只负责在稳定连接上驱动 UI 与断言。
if (mode === 'reset') {
  await evaluate(`localStorage.clear(); sessionStorage.clear()`)
  await wait(500)
  // 读回校验：页面可能因为存储变化而重渲染，单次读取可能拿到 null（上下文切换），
  // 所以这里重试几次，只有**明确读到非 0** 才算失败。
  let left = null
  for (let i = 0; i < 10; i++) {
    const v = await evaluate(`Object.keys(localStorage).length`)
    if (typeof v === 'number') {
      left = v
      if (v === 0) break
      await evaluate(`localStorage.clear()`)
    }
    await wait(300)
  }
  if (left === null) fail('无法确认本地存储是否已清空（读取始终失败）')
  if (left !== 0) fail(`本地存储未清空，仍有 ${left} 项`)
  record('清理本地存储', '已清空（会话前提：无 session）')
  console.log('\nDEVICE_LOGIN_RESET OK')
  process.exit(0)
}

if (mode === 'nav') {
  // 把应用导航到指定路由（不发 reload；调用方负责在冷启动后再调用）
  const to = opt('to') ?? 'loginselect'
  await evaluate(`location.hash = '#/${to}'`)
  await wait(600)
  const h = await hash()
  if (h !== `#/${to}`) fail(`导航到 #/${to} 失败，当前 ${h}`)
  record('导航', `#/${to}`)
  console.log('\nDEVICE_LOGIN_NAV OK')
  process.exit(0)
}

if (mode === 'dump') {
  console.log(await bodyText())
  process.exit(0)
}

// ---------------------------------------------------------------------------
if (mode === 'prepare') {
  if (!phone) fail('prepare 需要 --phone')

  // 前置由编排脚本保证：进程刚重启 + 本地存储已清空。
  // 这里先确认"无 session"这个前提真的成立，再确认我们在登录入口页。
  const hasSession = await evaluate(`localStorage.getItem('campus.demo.session.v1') !== null`)
  if (hasSession) fail('本地仍存在会话 —— 主路径不允许带着已注入的 session 跑')
  record('无 session 前提', '已确认本地没有会话')

  let text = await waitForBody(8000)
  record('冷启动落地页', text.slice(0, 40))

  /**
   * 走**真实 UI 路径**进入登录页（审核记录 08：不得用改 hash 或注入会话代替）。
   * 原版不登录也能浏览（M0 基线里个人页是本地默认账号、没有登录提示），
   * 所以登录入口放在个人页，而不是冷启动就拦。
   */
  const tab = await centerOf('.tabbar__item', undefined)
  if (!tab) fail('找不到底部导航')
  await tapAt(tab.x, tab.y)
  await wait(900)
  text = await bodyText()
  if (!text.includes('未登录')) fail(`个人页未显示「未登录」，实际: ${text.slice(0, 160)}`)
  record('个人页', '显示「未登录」+ 登录入口')

  await tapSelector('.me__authBtn', '登录 Campus（个人页入口）')
  await wait(1000)
  text = await bodyText()
  if (!text.includes('登录 Campus')) fail(`点登录入口后没有进入登录页，实际: ${text.slice(0, 160)}`)
  record('登录入口页', '已通过真实点击进入')

  // 未勾选协议点「登录 Campus」→ 必须出现同意弹窗（M0 的 known_unknown，本轮已用证据解决）
  await tapSelector('button.ls__login', '登录 Campus')
  await wait(600)
  text = await bodyText()
  if (!text.includes('请阅读并同意以下条款') || !text.includes('同意并继续')) {
    fail(`未勾选协议时应弹出同意弹窗，实际页面: ${text.slice(0, 160)}`)
  }
  record('协议弹窗', '出现「请阅读并同意以下条款」+「同意并继续」')

  // 同意并继续 → 应进入手机号页
  await tapSelector('button.ls__dialogBtn', '同意并继续')
  if (!(await waitHash('#/login', 6000))) fail(`点「同意并继续」后未进入手机号页，当前 ${await hash()}`)
  await wait(500)
  text = await bodyText()
  if (!text.includes('输入手机号')) fail(`手机号页缺少「输入手机号」标题，实际: ${text.slice(0, 120)}`)
  record('手机号页', '#/login 已加载')

  // 输入手机号（先真实触摸聚焦，再输入）
  await tapSelector('input.login__input', '手机号输入框')
  const typedRes = await typeInto('input.login__input', phone)
  if (!typedRes.ok) fail(`手机号未正确输入（方式=${typedRes.how}，实际='${typedRes.got}'）`)
  record('输入手机号', `${phone.length} 位（输入方式: ${typedRes.how}）`)

  // 点「获取验证码」
  await tapSelector('button.login__submit', '获取验证码')
  await wait(2500)
  // 注意：**不能用"正文里有没有『请输入验证码』"来判断** —— 那是占位符，
  // 占位符不会出现在 innerText 里（这里踩过）。要断言元素与按钮状态。
  const codeState = await evaluate(`JSON.stringify({
    inputs: document.querySelectorAll('input.login__input').length,
    submit: (document.querySelector('button.login__submit') || {}).textContent || '',
    resend: (document.querySelector('button.login__resend') || {}).textContent || '',
    body: (document.body.innerText || '')
  })`)
  const cs = JSON.parse(codeState)
  if (cs.inputs < 2) fail(`点「获取验证码」后没有出现第二个输入框（当前 ${cs.inputs} 个）`)
  if (!cs.submit.includes('登录')) fail(`按钮文案未变成「登录」，实际 '${cs.submit}'`)
  record('请求验证码', `已发出（出现验证码输入框；主按钮='${cs.submit.trim()}'；重发倒计时='${cs.resend.trim()}'）`)
  record('请求验证码', '已发出，验证码输入框已出现')

  console.log(`\nDEVICE_LOGIN_PREPARE OK  (phone=${phone})`)
  process.exit(0)
}
if (mode === 'complete') {
  if (!phone || !code) fail('complete 需要 --phone 与 --code')

  // 验证码行是**第二个** input（第一个是已填好的手机号，且已 disabled）
  const rect = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input.login__input')]
    const el = inputs[inputs.length - 1]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: el.disabled }
  })()`)
  if (!rect) fail('找不到验证码输入框')
  if (rect.disabled) fail('验证码输入框是 disabled 状态')
  await tapAt(rect.x, rect.y)
  await wait(400)

  /**
   * 点击之后必须确认"焦点真的落在这个输入框上"。
   *
   * 为什么需要：上一轮 prepare 里打过手机号，软键盘弹起会让**视觉视口**偏移，
   * 于是按布局坐标点下去可能没落到元素上 —— 表现就是"输入框在、但打字打不进去"。
   * 真实触摸仍然先做；只有在它没把焦点给到目标时，才用 JS focus 兜底，并如实记录。
   */
  const focusState = await evaluate(`(() => {
    const inputs = [...document.querySelectorAll('input.login__input')]
    const el = inputs[inputs.length - 1]
    const active = document.activeElement
    const at = document.elementFromPoint(${rect.x}, ${rect.y})
    return JSON.stringify({
      focusedTarget: active === el,
      activeTag: active ? active.tagName + (active.className ? '.' + String(active.className).split(' ')[0] : '') : 'none',
      hitIsTarget: at === el,
      scrollY: window.scrollY,
      visualOffset: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
    })
  })()`)
  const fs = JSON.parse(focusState)
  record('验证码框焦点', `touch→focused=${fs.focusedTarget} hit=${fs.hitIsTarget} active=${fs.activeTag} scrollY=${fs.scrollY} visualOffset=${fs.visualOffset}`)

  if (!fs.focusedTarget) {
    await evaluate(`(() => { const i = [...document.querySelectorAll('input.login__input')]; i[i.length-1].focus() })()`)
    await wait(200)
    const nowFocused = await evaluate(`(() => { const i = [...document.querySelectorAll('input.login__input')]; return document.activeElement === i[i.length-1] })()`)
    if (!nowFocused) fail('无法把焦点放到验证码输入框（真实触摸与 JS focus 都失败）')
    record('验证码框焦点', '真实触摸未聚焦 → 已用 INPUT_FALLBACK(js focus) 兜底')
  }

  const codeRes = await typeInto('input.login__input', code, 'last')
  if (!codeRes.ok) fail(`验证码未正确输入（方式=${codeRes.how}，实际='${codeRes.got}'）`)
  record('输入验证码', `${code.length} 位（输入方式: ${codeRes.how}）`)

  await tapSelector('button.login__submit', '登录')
  await wait(3000)
  const h = await hash()
  if (h !== '#/campus') fail(`登录后未进入校园页，当前 ${h}`)
  record('点击登录', '已回到校园页')

  const sess = await evaluate(`localStorage.getItem('campus.demo.session.v1')`)
  if (!sess) fail('登录后本地没有会话')
  const parsed = JSON.parse(sess)
  record('本地会话', `user=${parsed.user?.displayName} phone=${parsed.user?.phone}`)

  // 用会话真实调用 /api/auth/me，确认服务端认可这个身份
  const me = await evaluateAsync(`(async () => {
    const s = JSON.parse(localStorage.getItem('campus.demo.session.v1'))
    const r = await fetch('https://8.148.156.146/api/auth/me', { headers: { authorization: 'Bearer ' + s.token } })
    return { status: r.status, body: await r.text() }
  })()`)
  if (me.status !== 200) fail(`/api/auth/me 期望 200，实际 ${me.status}: ${me.body}`)
  if (!me.body.includes(`+86${phone}`)) fail(`me 返回的身份不是 ${phone}: ${me.body}`)
  record('服务端身份', `/api/auth/me → 200，身份含 +86${phone}`)

  console.log(`\nDEVICE_LOGIN_COMPLETE OK`)
  process.exit(0)
}

if (mode === 'restart') {
  const before = await evaluate(`localStorage.getItem('campus.demo.session.v1')`)
  if (!before) fail('重启前本地没有会话')
  const me = await evaluateAsync(`(async () => {
    const s = JSON.parse(localStorage.getItem('campus.demo.session.v1'))
    const r = await fetch('https://8.148.156.146/api/auth/me', { headers: { authorization: 'Bearer ' + s.token } })
    return { status: r.status, body: await r.text() }
  })()`)
  if (me.status !== 200) fail(`重启后 /api/auth/me 期望 200，实际 ${me.status}`)
  record('重启后会话', `/api/auth/me → 200（${me.body.slice(0, 80)}）`)
  console.log(`\nDEVICE_LOGIN_RESTART OK`)
  process.exit(0)
}

if (mode === 'logout') {
  // 先记下当前 token，退出后要用它验证"旧 token 必须 401"
  const token = await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('campus.demo.session.v1') || 'null'); return s ? s.token : null })()`)
  if (!token) fail('本地没有会话，无法验证退出登录')

  // 真实 UI 路径：个人 tab → 退出登录
  const tab = await centerOf('.tabbar__item', undefined)
  if (!tab) fail('找不到底部导航')
  await tapAt(tab.x, tab.y)
  await wait(900)
  const text = await bodyText()
  if (!text.includes('退出登录')) fail(`个人页没有「退出登录」，实际: ${text.slice(0, 140)}`)
  await tapSelector('.me__authBtn', '退出登录')
  await wait(1500)

  const left = await evaluate(`localStorage.getItem('campus.demo.session.v1')`)
  if (left !== null) fail('退出登录后本地仍残留会话')
  record('退出登录', '本地会话已清空')

  // 旧 token 必须被服务端拒绝
  const res = await evaluateAsync(`(async () => {
    const r = await fetch('https://8.148.156.146/api/auth/me', { headers: { authorization: 'Bearer ${token}' } })
    return { status: r.status }
  })()`)
  if (res.status !== 401) fail(`退出后旧 token 期望 401，实际 ${res.status}`)
  record('旧 token', `/api/auth/me → 401（会话已在服务端撤销）`)

  console.log('\nDEVICE_LOGIN_LOGOUT OK')
  process.exit(0)
}

fail(`未知模式: ${mode}（可用: reset / nav / dump / prepare / complete / restart / logout）`)
