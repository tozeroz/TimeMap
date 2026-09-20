/**
 * M1 设备端 E2E（真机路径，不是"调用 API 看返回"）：
 *
 *   1. 回到校园页，读出当前信息流
 *   2. 用**真实触摸**点右下角「+」进入发布页
 *   3. 切到「文字」模式，往输入框插入文字
 *   4. 用**真实触摸**点「发布」
 *   5. 等回到校园页，断言这条帖子出现在信息流里
 *   6. 把标记打印出来（外层脚本会拿它去查 PostgreSQL）
 *
 * 为什么坚持用 Input.dispatchTouchEvent 而不是 element.click()：
 * element.click() 绕过浏览器命中测试 —— 按钮被别的透明层盖住时它照样"成功"，
 * 这个坑在 Map 的 Tencent GL 图层上已经踩过一次（弹窗看得见点不动）。
 *
 * 用法：node scripts/m1/device-e2e.mjs [标记文本]
 * 前置：adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 */

const marker = process.argv[2] || `M1-真机 DEV-${Date.now()}`
const BODY = `${marker} 设备端发布页真实触摸写入`

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('no debuggable page')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let msgId = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error)
    pending.delete(msg.id)
  }
})

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
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (r?.exceptionDetails) throw new Error(`页面异常: ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`)
  if (r?.result?.exceptionDetails) {
    throw new Error(`页面异常: ${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`)
  }
  return r?.result?.result?.value ?? r?.result?.value ?? null
}

/** 取元素中心的 CSS 坐标（CDP 的触摸事件用的是 CSS 像素，不是设备像素） */
async function centerOf(selector) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  })()`)
}

/** 真实单击：touchStart → 短暂间隔 → touchEnd，走浏览器命中测试 */
async function tapAt(x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await wait(70)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(120)
}

async function tapSelector(selector, label) {
  const c = await centerOf(selector)
  if (!c) throw new Error(`找不到可点元素: ${selector}（${label}）`)
  await tapAt(c.x, c.y)
  return c
}

const hash = () => evaluate('location.hash')

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

// ---------------------------------------------------------------------------
console.log(`标记: ${marker}`)

// 0. 回到校园页
await evaluate(`location.hash = '#/campus'`)
await wait(1200)
record('起始页面', await hash())

// 1. 真实触摸点「+」进发布页
const fab = await tapSelector('.tabbar__fab', '发布 FAB')
record('点发布FAB', `(${fab.x.toFixed(0)},${fab.y.toFixed(0)})`)
if (!(await waitHash('#/publish'))) throw new Error(`未进入发布页，当前 ${await hash()}`)
record('进入发布页', '#/publish')

// 2. 切到「文字」模式（真实触摸）
const textTab = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('.pub__mode')]
  const i = btns.findIndex((b) => b.textContent.trim() === '文字')
  if (i < 0) return null
  const r = btns[i].getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`)
if (!textTab) throw new Error('找不到「文字」模式按钮')
await tapAt(textTab.x, textTab.y)
await wait(300)
const mode = await evaluate(`document.querySelector('.pub__textarea') ? '文字' : 'not-文字'`)
if (mode !== '文字') throw new Error('切换文字模式失败')
record('切到文字模式', 'ok')

// 3. 往输入框插字：先真实点一下聚焦，再 insertText（等价于输入法上屏）
const ta = await tapSelector('.pub__textarea', '文字输入框')
await send('Input.insertText', { text: BODY })
await wait(250)
const typed = await evaluate(`document.querySelector('.pub__textarea').value`)
if (typed !== BODY) throw new Error(`输入框内容不符: ${JSON.stringify(typed).slice(0, 120)}`)
record('输入正文', `${typed.length} 字`)

// 4. 真实触摸点「发布」
const pubBtn = await centerOf('.pub__publish')
if (!pubBtn) throw new Error('找不到发布按钮')
const disabled = await evaluate(`document.querySelector('.pub__publish').disabled`)
if (disabled) throw new Error('发布按钮仍是 disabled（正文没被识别）')
await tapAt(pubBtn.x, pubBtn.y)
record('点发布', `(${pubBtn.x.toFixed(0)},${pubBtn.y.toFixed(0)})`)

// 5. 回到校园页并断言帖子出现
if (!(await waitHash('#/campus', 12000))) throw new Error(`发布后没回到校园页，当前 ${await hash()}`)
await wait(1500)
const feedText = await evaluate(`(document.querySelector('.campus__grid')?.innerText || '').replace(/\\s+/g, ' ')`)
const appeared = feedText.includes(marker)
record('信息流出现该帖', appeared ? 'YES' : 'NO')
console.log(`  信息流片段: ${feedText.slice(0, 160)}`)

console.log(`\nDEVICE_E2E ${appeared ? 'PASS' : 'FAIL'}`)
console.log(`MARKER ${marker}`)
process.exit(appeared ? 0 : 1)
