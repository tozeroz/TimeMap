/**
 * NATIVE_FILE_PICKER_INTERACTION 真机验证：**点 App 里真实的"选图"入口 → 系统选择器 → 选图 → 产品链路跑完**。
 *
 * 与 device-chat-image-check.mjs 的区别（两者结论**永久分列**，不得互相冒充）：
 *   - device-chat-image-check.mjs 走的是 `DOM.setFileInputFiles`（CDP 直接把文件塞进
 *     `<input type=file>`），产出结论 `FILE_INPUT_POST_SELECTION_E2E`。
 *   - 本脚本**不碰 DOM.setFileInputFiles**：它用 `Input.dispatchTouchEvent` 在真实坐标上
 *     按下真实触摸事件，让 WebView 自己去弹**系统原生选择器**
 *     （com.android.documentsui/.picker.PickActivity），再由 `adb shell input tap`
 *     在 picker 里点图片，产出结论 `NATIVE_FILE_PICKER_INTERACTION`。
 *
 * 分工（为什么是两段）：
 *   本脚本只做 CDP 侧（点击前的准备 / 点击 / 点击后的断言）；
 *   "picker 是否真的出现""dump 到什么""点了哪个节点"由 PowerShell 侧用 adb 完成并落盘。
 *   两侧通过 .tmp-m5-picker/ 下的 marker / report 文件交接。
 *
 * 用法：
 *   node scripts/m5/native-picker-e2e.mjs --image-name=<文件名> [--out=<报告路径>] [--timeout=180000]
 * 前置：
 *   & scripts/m5/cdp-forward.ps1       （App 冷启动后 pid 变，forward 必须重建）
 *   设备已登录（本脚本会断言 localStorage 里有会话，没有就明确失败）
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const argv = process.argv.slice(2)
const argOf = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? ''
const imageName = argOf('image-name')
const threadArg = argOf('thread')
const outPath = argOf('out') || '.tmp-m5-picker/report.json'
const timeoutMs = Number(argOf('timeout') || 180000)
const API_ORIGIN = 'https://8.148.156.146'

if (!imageName) {
  console.log('FAIL 缺少 --image-name（要在 picker 里点的那张图的文件名）')
  process.exit(2)
}

const t0 = Date.now()
const log = (m) => console.log(`  · ${m} [${((Date.now() - t0) / 1000).toFixed(1)}s]`)
const marker = (obj) => {
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath.replace(/report\.json$/, 'report.partial.json'), JSON.stringify({ ...obj, at: new Date().toISOString() }, null, 2))
}

// --- CDP 连接 ---------------------------------------------------------------
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((x) => x.type === 'page')
if (!target) {
  console.log('FAIL 没有可调试页面（forward 掉了？先跑 scripts/m5/cdp-forward.ps1）')
  process.exit(2)
}
log(`CDP 目标：${target.url.slice(0, 80)}`)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})

let id = 0
const pending = new Map()
const events = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  } else if (m.method) {
    events.push(m)
  }
})
/**
 * 发一条 CDP 命令。
 * ⚠ 必须带超时：picker 在前台时 WebView 会被 onPause 挂起，
 *   此时 Runtime.evaluate **永远不返回** —— 没有超时的话脚本会静默卡死
 *   （前一个执行者卡 17 分钟没结果，很可能就是这类"等一个不会来的响应"）。
 */
const send = (method, params, ms = 8000) =>
  new Promise((r) => {
    const i = ++id
    const timer = setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i)
        r({ timeout: true })
      }
    }, ms)
    pending.set(i, (m) => {
      clearTimeout(timer)
      r(m)
    })
    ws.send(JSON.stringify({ id: i, method, params }))
  })

let rendererBusy = false
const ev = async (expr, ms = 8000) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms)
  if (r.timeout) {
    rendererBusy = true
    return 'TIMEOUT'
  }
  rendererBusy = false
  if (r?.result?.exceptionDetails) return `ERR:${JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`
  return r?.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Network.enable')
await send('Runtime.enable')

// --- 0. 前置：登录 + 会话页 -------------------------------------------------
const state = await ev(`(() => {
  const raw = localStorage.getItem('campus.demo.session.v1')
  let s = null; try { s = raw ? JSON.parse(raw) : null } catch {}
  return { session: !!raw, name: s?.user?.displayName ?? null, phone: s?.user?.phone ?? null, hash: location.hash }
})()`)
if (typeof state !== 'object' || state === null) {
  console.log(`FAIL 读不到页面状态：${JSON.stringify(state)}`)
  process.exit(2)
}
if (!state.session) {
  console.log('FAIL 设备未登录（localStorage 无会话）—— 先用 scripts/m3/device-login-helper.ps1 以种子用户 Lemy 登录')
  process.exit(2)
}
log(`已登录：${state.name}（${state.phone}） hash=${state.hash}`)

const m = /^#\/chat\/([0-9a-f-]{36})$/.exec(state.hash || '')
let threadId = ''
if (m) {
  threadId = m[1]
  log(`会话 id（沿用当前页面）：${threadId}`)
} else if (threadArg) {
  threadId = threadArg
  log(`当前不在会话页（hash=${state.hash}）→ 导航到命令行指定的会话 ${threadId}`)
} else {
  // 不猜、不写死 fixture id：让**服务端**告诉我们这个账号有哪些会话
  const raw = await ev(`(async () => {
    const s = JSON.parse(localStorage.getItem('campus.demo.session.v1'))
    const r = await fetch(${JSON.stringify(API_ORIGIN)} + '/api/threads', { headers: { authorization: 'Bearer ' + s.token } })
    return JSON.stringify({ status: r.status, body: (await r.text()).slice(0, 4000) })
  })()`)
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { parsed = null }
  const items = parsed?.status === 200 ? (JSON.parse(parsed.body).items ?? []) : []
  if (items.length === 0) {
    console.log(`FAIL 该账号没有可用会话（hash=${state.hash}，取会话列表=${parsed?.status ?? raw}）`)
    process.exit(2)
  }
  threadId = items[0].id
  log(`当前不在会话页（hash=${state.hash}）→ 服务端返回 ${items.length} 个会话，用第一个 ${threadId}`)
}
if (!m) {
  await ev(`location.hash = '#/chat/' + ${JSON.stringify(threadId)}`)
  await wait(3000)
  const after = await ev(`location.hash`)
  if (after !== `#/chat/${threadId}`) {
    console.log(`FAIL 导航到会话页失败：期望 #/chat/${threadId}，实际 ${after}`)
    process.exit(2)
  }
  log(`已导航到会话页：${after}`)
}

/** 页面快照（只读 DOM，不注入任何桩） */
const snap = async (ms = 8000) => {
  const raw = await ev(
    `(() => {
      const rows = [...document.querySelectorAll('.chat__row')]
      const last = rows.length ? rows[rows.length - 1] : null
      const imgs = last ? [...last.querySelectorAll('img.bubble__media')] : []
      return JSON.stringify({
        bubbles: document.querySelectorAll('.bubble').length,
        rows: rows.map(r => r.getAttribute('data-message-id')),
        media: document.querySelectorAll('img.bubble__media').length,
        lastBubbleImgs: imgs.length,
        lastBubbleOk: imgs.filter(i => i.naturalWidth > 0).length,
        lastBubbleNaturalWidth: imgs.map(i => i.naturalWidth),
        lastBubbleText: last ? (last.innerText || '').replace(/\\s+/g,' ').slice(0, 60) : '',
        status: document.querySelector('.chatbar__status')?.textContent ?? '',
        error: document.querySelector('.chatbar__error')?.textContent ?? '',
        pickLeft: document.querySelector('.chatbar__file')?.files?.length ?? -1,
        picked: window.__m5pick ? JSON.stringify(window.__m5pick) : null,
      })
    })()`,
    ms,
  )
  if (raw === 'TIMEOUT') return { timeout: true }
  try {
    return JSON.parse(raw)
  } catch {
    return { parseError: String(raw).slice(0, 200) }
  }
}

const beforeSnap = await snap()
if (beforeSnap.timeout || beforeSnap.parseError) {
  console.log(`FAIL 会话页快照失败：${JSON.stringify(beforeSnap)}`)
  process.exit(2)
}
log(`点击前：气泡 ${beforeSnap.bubbles} 个、图片 ${beforeSnap.media} 张`)

// --- 1. 定位真实"选图"入口并取坐标 ------------------------------------------
/*
  入口就是 <label class="chatbar__pick"> 里那个铺满（opacity:0 + inset:0）的
  <input type="file" class="chatbar__file">。取它的 rect 中心 = 用户手指会落到的位置。
  不直接用 label 的 rect：label 会被 CSS 影响，而"用户点到的是 input 本体"是 ChatScreen.tsx
  里写明的设计（注释：「input 用 CSS 铺满并透明 → 用户点图标时点到的是 input 本体」）。
*/
const entry = await ev(`(() => {
  const i = document.querySelector('.chatbar__file')
  if (!i) return JSON.stringify({ found: false })
  const r = i.getBoundingClientRect()
  return JSON.stringify({
    found: true,
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    accept: i.getAttribute('accept'),
    disabled: i.disabled,
    dpr: window.devicePixelRatio,
    vw: window.innerWidth, vh: window.innerHeight,
  })
})()`)
let entryObj = null
try {
  entryObj = JSON.parse(entry)
} catch {
  entryObj = null
}
if (!entryObj?.found) {
  console.log(`FAIL 页面上找不到选图入口（.chatbar__file）：${JSON.stringify(entry)}`)
  process.exit(2)
}
log(`选图入口 rect=${JSON.stringify(entryObj.rect)} → 点击坐标 (${entryObj.x}, ${entryObj.y})，accept=${entryObj.accept} disabled=${entryObj.disabled} dpr=${entryObj.dpr} viewport=${entryObj.vw}x${entryObj.vh}`)

// 装一个捕获阶段的一次性监听器：证明"input 真的收到了 picker 交回来的文件"。
// （产品的 onChange 会立刻清空 input，所以必须在 change 之后、且抢在产品处理器之前记下来。）
const armed = await ev(`(() => {
  window.__m5pick = null
  const i = document.querySelector('.chatbar__file')
  if (!i) return false
  i.addEventListener('change', () => {
    const f = i.files && i.files[0]
    window.__m5pick = f ? { name: f.name, size: f.size, type: f.type } : { name: null }
  }, { once: true, capture: true })
  return true
})()`)
log(`change 探针已装：${armed}`)

// --- 2. 派发真实触摸事件（CDP 坐标点击）-------------------------------------
marker({ phase: 'clicking', entry: entryObj, threadId, bubblesBefore: beforeSnap.bubbles })
const tStart = await send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: entryObj.x, y: entryObj.y, radiusX: 8, radiusY: 8, force: 1 }],
})
await wait(80)
const tEnd = await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
log(`touchStart=${tStart.timeout ? 'TIMEOUT' : 'ok'} touchEnd=${tEnd.timeout ? 'TIMEOUT' : 'ok'}`)
marker({ phase: 'clicked', entry: entryObj, threadId, bubblesBefore: beforeSnap.bubbles, touchedAt: new Date().toISOString() })
console.log('CLICK_DISPATCHED')
console.log(JSON.stringify({ x: entryObj.x, y: entryObj.y, rect: entryObj.rect }))

// --- 3. 等产品链路跑完（picker 在前台时渲染器被挂起，evaluate 会超时，属正常）---
const reqs = new Map() // requestId -> {method,url}
for (const e of events) {
  if (e.method === 'Network.requestWillBeSent') {
    reqs.set(e.params.requestId, { method: e.params.request?.method, url: e.params.request?.url })
  }
}
const posts = new Map() // "method url" -> {status, mime, body}
const bodies = new Map()
const deadline = Date.now() + timeoutMs
let lastSnap = beforeSnap
let sawPickerPause = false

for (;;) {
  // 收集新到的响应
  for (const e of events) {
    if (e.method === 'Network.requestWillBeSent') {
      reqs.set(e.params.requestId, { method: e.params.request?.method, url: e.params.request?.url })
    }
    if (e.method !== 'Network.responseReceived') continue
    const r = e.params?.response
    if (!r?.url || !/\/api\/media|\/messages/.test(r.url)) continue
    const req = reqs.get(e.params.requestId)
    if (!req) continue
    const key = `${req.method} ${r.url}`
    if (posts.has(key)) continue
    posts.set(key, { method: req.method, url: r.url, status: r.status, mime: r.mimeType })
    const rb = await send('Network.getResponseBody', { requestId: e.params.requestId }, 5000)
    if (rb?.result?.body) bodies.set(key, String(rb.result.body).slice(0, 4000))
  }

  const doneMedia = [...posts.values()].some((r) => r.method === 'POST' && /\/api\/media$/.test(r.url) && r.status === 201)
  const doneMsg = [...posts.values()].some((r) => r.method === 'POST' && /messages$/.test(r.url) && r.status === 201)
  if (doneMedia && doneMsg) {
    log('两个 201 都到了，等界面渲染')
    await wait(2500)
    lastSnap = await snap(10000)
    break
  }
  if (Date.now() >= deadline) {
    log(`超时（${timeoutMs}ms）—— 没等到 POST /api/media + POST /messages 双 201`)
    lastSnap = await snap(10000)
    break
  }
  // 轻量探活：渲染器被 picker 挂起时这里会返回 timeout，正好是"picker 还在前台"的旁证
  const probe = await ev(`document.visibilityState`, 3000)
  if (probe === 'TIMEOUT') {
    if (!sawPickerPause) {
      sawPickerPause = true
      log('WebView 渲染器无响应（picker 在前台时的正常表现）')
    }
  } else if (sawPickerPause) {
    log(`渲染器恢复响应：visibilityState=${probe}`)
    sawPickerPause = false
  }
  await wait(1200)
}

// --- 4. 报告 ---------------------------------------------------------------
const final = lastSnap
const report = {
  verdict: 'NATIVE_FILE_PICKER_INTERACTION',
  at: new Date().toISOString(),
  apkIndependent: true,
  threadId,
  entry: entryObj,
  bubblesBefore: beforeSnap.bubbles,
  bubblesAfter: final?.bubbles ?? null,
  bubblesDelta: final && final.bubbles != null ? final.bubbles - beforeSnap.bubbles : null,
  mediaBefore: beforeSnap.media,
  mediaAfter: final?.media ?? null,
  lastBubbleImgs: final?.lastBubbleImgs ?? null,
  lastBubbleOk: final?.lastBubbleOk ?? null,
  lastBubbleNaturalWidth: final?.lastBubbleNaturalWidth ?? null,
  lastBubbleText: final?.lastBubbleText ?? null,
  pickLeft: final?.pickLeft ?? null,
  picked: final?.picked ?? null,
  pageError: final?.error ?? '',
  pageStatus: final?.status ?? '',
  rowIds: final?.rows ?? [],
  network: [...posts.values()],
  bodies: Object.fromEntries(bodies),
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(report, null, 2))

const fails = []
const media201 = report.network.find((r) => r.method === 'POST' && /\/api\/media$/.test(r.url))
const msg201 = report.network.find((r) => r.method === 'POST' && /messages$/.test(r.url))
media201?.status === 201 ? log('POST /api/media → 201') : fails.push(`POST /api/media 不是 201：${JSON.stringify(media201)}`)
msg201?.status === 201 ? log('POST /api/threads/:id/messages → 201') : fails.push(`POST /messages 不是 201：${JSON.stringify(msg201)}`)
if (report.bubblesDelta == null || report.bubblesDelta < 1) fails.push(`气泡数没有增加（${report.bubblesBefore} → ${report.bubblesAfter}）`)
if (!(report.lastBubbleOk > 0)) fails.push(`新气泡里没有渲染成功的图片（lastBubbleNaturalWidth=${JSON.stringify(report.lastBubbleNaturalWidth)}）`)
if (report.picked == null) fails.push('input 没有收到 picker 交回的文件（change 未带 file）')
else {
  let p = null
  try { p = JSON.parse(report.picked) } catch { p = null }
  p?.name === imageName
    ? log(`input 收到的文件正是我们点的那张：${p.name}（${p.size} 字节，${p.type}）`)
    : fails.push(`input 收到的文件名不是我们在 picker 里点的那张：收到 ${p?.name}，期望 ${imageName}`)
}
if (report.pageError) fails.push(`页面显示了发送失败：${report.pageError}`)

console.log('')
for (const f of fails) console.log(`  FAIL ${f}`)
console.log(fails.length === 0 ? 'NATIVE_PICKER_E2E PASS' : 'NATIVE_PICKER_E2E FAIL')
console.log(`REPORT ${outPath}`)
try { ws.close() } catch { /* 已关 */ }
process.exit(fails.length === 0 ? 0 : 1)
