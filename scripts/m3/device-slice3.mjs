/**
 * M3 Slice 3 设备端驱动（在我们自己的 demo app 上；允许写操作）。
 *
 * 只做"点 UI"，不做业务断言 —— 断言放在编排脚本里（verify-device-publish.ps1），
 * 因为那里能同时看到数据库与会话身份。
 *
 * 模式：
 *   publish --text <正文>   走发布页 UI 发一条（文字模式）
 *   feed                    读校园信息流正文（用于断言新帖与作者名出现）
 *   whoami                  读当前会话的展示名（用于断言作者归属）
 */
const argv = process.argv.slice(2)
const mode = argv[0]
const opt = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!target) {
  console.error('no debuggable page')
  process.exit(1)
}

let ws
let msgId = 0
let pending = new Map()

async function connect() {
  const l = await (await fetch('http://127.0.0.1:9222/json')).json()
  const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
  if (!t) throw new Error('找不到可调试页面')
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  })
  for (let i = 0; i < 20; i++) {
    const p = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
    if (p && !p.timeout && p.result?.result?.value) return
    await wait(400)
  }
  throw new Error('调试会话不可用')
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

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (!r || r.timeout) throw new Error(`CDP 超时: ${expression.slice(0, 60)}`)
  if (r.result?.exceptionDetails) throw new Error(`页面异常: ${JSON.stringify(r.result.exceptionDetails).slice(0, 200)}`)
  const v = r.result?.result?.value
  return v === undefined ? null : v
}

/** 退出路径必须**同步**（异步退出会让代码继续往下跑，撞到未知模式分支） */
function shutdown(code) {
  try {
    ws.close()
  } catch {
    /* 已关闭 */
  }
  process.exit(code)
}

const bodyText = async () => {
  const v = await evaluate(`(document.body ? document.body.innerText : '').replace(/\\s+/g, ' ')`)
  return typeof v === 'string' ? v : ''
}

async function tapAt(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await wait(70)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(250)
}

async function centerOf(selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: !!el.disabled }
  })()`)
}

/** 聚焦元素并输入文本；优先真实输入事件，失败再退到原生 setter（并如实标注） */
async function typeInto(selector, text) {
  const el = await centerOf(selector)
  if (!el) throw new Error(`找不到输入元素 ${selector}`)
  await tapAt(el.x, el.y)
  const focused = await evaluate(`(() => document.activeElement && document.activeElement.matches(${JSON.stringify(selector)}))()`)
  if (!focused) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
    await wait(200)
  }
  await send('Input.insertText', { text })
  await wait(350)
  let got = await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`)
  if (got === text) return 'Input.insertText'
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(text)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await wait(300)
  got = await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`)
  if (got === text) return 'INPUT_FALLBACK(native setter)'
  throw new Error(`文本未进入输入框（实际 '${got}'）`)
}

if (mode === 'whoami') {
  const raw = await evaluate(`localStorage.getItem('campus.demo.session.v1')`)
  const s = raw ? JSON.parse(raw) : null
  console.log(JSON.stringify({ DisplayName: s?.user?.displayName ?? null, Phone: s?.user?.phone ?? null }))
  shutdown(0)
}

if (mode === 'feed') {
  await evaluate(`location.hash = '#/campus'`)
  await wait(3000)
  const t = await bodyText()
  console.log(`FEED_TEXT ${t}`)
  shutdown(0)
}

if (mode === 'publish') {
  const text = opt('text')
  if (!text) {
    console.error('需要 --text')
    shutdown(1)
  }
  await evaluate(`location.hash = '#/publish'`)
  await wait(2500)
  let t = await bodyText()
  if (!/发布|拍摄|文字/.test(t)) {
    console.log(`PUBLISH_UI_MISSING ${t.slice(0, 120)}`)
    shutdown(1)
  }

  /*
    必须**先切到「文字」模式**：发布页的编辑器是条件渲染的
    （`mode === '文字'` 才有 .pub__editor / .pub__textarea），
    默认模式是拍摄。第一版直接找 .pub__textarea，当然找不到 —— 这是"没看清 UI 结构"
    而不是产品缺陷。
  */
  const modeTab = await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.pub__mode')]
    const el = tabs.find((n) => (n.textContent || '').trim() === '文字')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!modeTab) {
    console.log(`PUBLISH_MODE_TAB_MISSING ${(await bodyText()).slice(0, 160)}`)
    shutdown(1)
  }
  await tapAt(modeTab.x, modeTab.y)
  await wait(800)
  console.log('  已切到「文字」模式')

  const how = await typeInto('.pub__textarea', text)
  console.log(`  输入方式: ${how}`)

  // 发布按钮：优先用右上角那颗（canPublish 为真时带 is-on）
  let btn = await centerOf('.pub__publish')
  if (!btn || btn.disabled) btn = await centerOf('.pub__send')
  if (!btn) {
    console.log('PUBLISH_BUTTON_MISSING')
    shutdown(1)
  }
  await tapAt(btn.x, btn.y)
  await wait(3500)

  const hash = await evaluate('location.hash')
  t = await bodyText()
  // 发布失败时页面会显示提示；把页面文字带回去，让编排脚本能诊断
  console.log(`  hash=${hash}`)
  console.log(`PUBLISH_RESULT_TEXT ${t.slice(0, 300)}`)
  // 明确的成功标记：编排脚本据此判断，避免"点了按钮"被当成"发布成功"
  console.log('DEVICE_PUBLISH_DRIVE OK')
  shutdown(0)
}

console.error(`未知模式: ${mode}（可用: publish / feed / whoami）`)
shutdown(1)
