/**
 * M5 工作单 #2 真机验证：**会话里选一张图 → 上传 → 发出去 → 渲染出来**。
 *
 * 为什么用脚本：真机上"选文件"会弹系统原生选择器，CDP 点不到它。
 * 但 CDP 可以把"用户已经选好了文件"这一步**照原样**交给页面，之后的一切
 * （multipart 上传、发消息、重拉列表、blob 渲染）都是**产品代码在跑，没有任何桩**：
 *   方式 A：DOM.setFileInputFiles —— 走浏览器自己的 file-chooser 管线（最接近真实选择）
 *   方式 B：DataTransfer + 派发 change —— 页面内造一个真实 PNG File 塞进 input.files
 * A 不可用时自动降级到 B，输出里**明确标注用的是哪一种**：
 * 不能把"合成 file 选择"说成"手点系统选择器成功"。
 *
 * 用法：
 *   node scripts/m5/device-chat-image-check.mjs [--image=<设备上的图片路径>] [--thread=<会话uuid>]
 *   node scripts/m5/device-chat-image-check.mjs --expect-fail=<设备上的非图片文件>   # 只验"失败可见"
 * 前置：
 *   adb -s 127.0.0.1:16384 forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   设备已登录（否则先跑 scripts/m3/device-login-helper.ps1 -SelfTest）
 *   服务端 /api/ready 是 ready（刚重启时会 503 not_ready，等一会儿再跑）
 *
 * ⚠ 参数用 `--key=value` 而不是位置参数：PowerShell 会把空字符串参数**丢掉**，
 *   位置参数会整体前移一位（实测踩到：图片路径被当成了 threadId）。
 */

const argv = process.argv.slice(2)
const argOf = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''

const threadArg = argOf('thread')
/** 设备上真实存在的图片路径；给了就走方式 A，否则只能走方式 B */
const deviceImage = argOf('image')
/**
 * 「失败要可见」专用：给一个**非图片**文件的设备路径（例如 .txt）。
 * 服务端按内容判类型会回 400 not_an_image，界面必须显示"发送失败"而不是静默。
 */
const expectFail = argOf('expect-fail')
/** App 自己的 API origin（与 app/src/api/client.ts 的 DEFAULT_API_ORIGIN 一致） */
const API_ORIGIN = 'https://8.148.156.146'

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((x) => x.type === 'page')
if (!target) {
  console.error('找不到可调试页面（forward 是否还在？设备是否重启过？）')
  process.exit(1)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let id = 0
const pending = new Map()
/** 收集 CDP 事件（抓请求方法 + 响应状态，证明"上传/发消息真的到了服务端"） */
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
const send = (method, params) =>
  new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i)
        r({ timeout: true })
      }
    }, 20000)
  })
/** ⚠ 必须带 awaitPromise:true：下面大量用 async IIFE */
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r?.result?.exceptionDetails) {
    return `ERR:${JSON.stringify(r.result.exceptionDetails).slice(0, 200)}`
  }
  return r?.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
const ok = (m) => console.log(`  PASS ${m}`)
const bad = (m) => {
  console.log(`  FAIL ${m}`)
  failed = 1
}
const info = (m) => console.log(`  ·  ${m}`)

/** 等某件事发生（返回最后一次快照） */
async function until(fn, timeoutMs, stepMs = 250) {
  const deadline = Date.now() + timeoutMs
  let last = null
  for (;;) {
    last = await snap()
    if (fn(last) || Date.now() >= deadline) return last
    await wait(stepMs)
  }
}

/** 当前页面的一次快照 */
const snap = async () => {
  const raw = await ev(`(() => {
    const rows = [...document.querySelectorAll('.chat__row')]
    const last = rows.length ? rows[rows.length - 1] : null
    const lastImgs = last ? [...last.querySelectorAll('img.bubble__media')] : []
    return JSON.stringify({
      bubbles: document.querySelectorAll('.bubble').length,
      media: document.querySelectorAll('img.bubble__media').length,
      mediaOk: Array.from(document.querySelectorAll('img.bubble__media')).filter(i => i.naturalWidth > 0).length,
      blobSrc: Array.from(document.querySelectorAll('img.bubble__media')).filter(i => (i.getAttribute('src')||'').startsWith('blob:')).length,
      lastBubbleImgs: lastImgs.length,
      lastBubbleOk: lastImgs.filter(i => i.naturalWidth > 0).length,
      lastBubbleBlob: lastImgs.filter(i => (i.getAttribute('src')||'').startsWith('blob:')).length,
      lastBubbleText: last ? (last.innerText || '').replace(/\\s+/g,' ').slice(0, 60) : '',
      status: document.querySelector('.chatbar__status')?.textContent ?? '',
      error: document.querySelector('.chatbar__error')?.textContent ?? '',
      pickLeft: document.querySelector('.chatbar__file')?.files?.length ?? -1,
      state: document.querySelector('.chat__state')?.textContent ?? '',
      picked: window.__m5pick ? JSON.stringify(window.__m5pick) : null,
    })
  })()`)
  try {
    return JSON.parse(raw)
  } catch {
    return { parseError: String(raw).slice(0, 200) }
  }
}

/**
 * 在 input 上装一个**捕获阶段**的一次性监听器。
 * 为什么需要它：产品的 onChange 会**立刻清空 input**（这是本单要求的"同一张图能再选一次"），
 * 所以在 change 之后再读 `input.files` 永远是 0 —— 必须抢在产品处理器之前把文件记下来。
 * 这也顺便证明了"input 真的收到了文件"，而不是"我们以为点了"。
 */
const armPickProbe = async () => {
  const r = await ev(`(() => {
    window.__m5pick = null
    const i = document.querySelector('.chatbar__file')
    if (!i) return false
    i.addEventListener('change', () => {
      const f = i.files && i.files[0]
      window.__m5pick = f ? { name: f.name, size: f.size, type: f.type } : { name: null }
    }, { once: true, capture: true })
    return true
  })()`)
  return r === true
}
const dispatchChange = () =>
  ev(`(() => { const i = document.querySelector('.chatbar__file'); i.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)

/** 把文件放进 input（方式 A：走浏览器自己的 file-chooser 管线） */
const placeViaFileChooser = async (filePath) => {
  const doc = await send('DOM.getDocument', { depth: -1 })
  const q = await send('DOM.querySelector', {
    nodeId: doc?.result?.root?.nodeId ?? 0,
    selector: '.chatbar__file',
  })
  const nodeId = q?.result?.nodeId ?? 0
  if (!nodeId) return '拿不到 input 节点'
  const res = await send('DOM.setFileInputFiles', { nodeId, files: [filePath] })
  return res?.error ? JSON.stringify(res.error).slice(0, 120) : ''
}

await send('Network.enable')
await send('DOM.enable')

// ---------------------------------------------------------------------------
console.log('=== 0. 前置：设备上的会话与线程 ===')
const sessionRaw = await ev(`localStorage.getItem('campus.demo.session.v1')`)
if (!sessionRaw || String(sessionRaw).startsWith('ERR')) {
  bad('设备未登录（localStorage 里没有会话）—— 先跑 scripts/m3/device-login-helper.ps1 -SelfTest')
  console.log('DEVICE_CHAT_IMAGE_RESULT FAIL')
  process.exit(1)
}
let session = null
try {
  session = JSON.parse(sessionRaw)
} catch {
  session = null
}
session?.user?.displayName
  ? ok(`已登录：${session.user.displayName}（${session.user.id}）`)
  : bad(`会话结构异常：${String(sessionRaw).slice(0, 120)}`)

/**
 * 线程 id 从**服务端**取（用 App 自己的 token 调 /api/threads），
 * 不猜 fixture、不写死 —— 写死的 id 会让"验证通过"变成"恰好那个 id 能通过"。
 */
let threadId = threadArg
if (!threadId) {
  const raw = await ev(`(async () => {
    const s = JSON.parse(localStorage.getItem('campus.demo.session.v1'))
    const r = await fetch(${JSON.stringify(API_ORIGIN)} + '/api/threads', { headers: { authorization: 'Bearer ' + s.token } })
    return JSON.stringify({ status: r.status, body: (await r.text()).slice(0, 4000) })
  })()`)
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  if (!parsed || parsed.status !== 200) {
    bad(`取会话列表失败：${String(raw).slice(0, 300)}`)
    console.log('DEVICE_CHAT_IMAGE_RESULT FAIL')
    process.exit(1)
  }
  const items = JSON.parse(parsed.body).items ?? []
  if (items.length === 0) {
    bad('该账号没有任何会话 —— 需要先造一个会话 fixture 才能验证发图')
    console.log('DEVICE_CHAT_IMAGE_RESULT FAIL')
    process.exit(1)
  }
  threadId = items[0].id
  info(`服务端返回 ${items.length} 个会话，用第一个：${threadId}`)
} else {
  info(`沿用命令行指定的会话：${threadId}`)
}

// ---------------------------------------------------------------------------
console.log('')
console.log('=== 1. 进入会话页 ===')
const goChat = async () => {
  await ev(`location.hash = '#/chat/${threadId}'`)
  // 等页面出结果（.chat 或错误态），不要靠固定 sleep
  await until((s) => s.parseError === undefined && s.state !== '加载中…', 15000, 500)
}
await goChat()
const before = await snap()
if (before.parseError) bad(`页面快照解析失败：${before.parseError}`)
else info(`进入前：气泡 ${before.bubbles} 个、已渲染图片 ${before.media} 张；state=${before.state || '（列表已就绪）'}`)
if (before.state) {
  bad(`会话页没加载成功：${before.state}`)
  console.log('DEVICE_CHAT_IMAGE_RESULT FAIL')
  process.exit(1)
}
ok(`会话页加载成功（GET /api/threads/:id/messages 通了），当前 ${before.bubbles} 条消息`)

const hasPick = await ev(`!!document.querySelector('.chatbar__file')`)
if (hasPick !== true) {
  bad('页面上找不到选图 input（.chatbar__file）—— 路由没落到会话页，或 input 没渲染')
  console.log('DEVICE_CHAT_IMAGE_RESULT FAIL')
  process.exit(1)
}
ok('选图入口存在（<input type="file" class="chatbar__file">）')
const accept = await ev(`document.querySelector('.chatbar__file')?.getAttribute('accept') ?? ''`)
accept === 'image/*' ? ok('accept="image/*"') : bad(`accept 不是 image/*：${accept}`)

// ---------------------------------------------------------------------------
/*
  「失败要可见」的独立检查（--expect-fail=<设备上的非图片文件>）。
  为什么要单独验：上传失败是**最容易被做成静默**的一条路径 ——
  图没发出去、界面却恢复原样，用户会以为发出去了。
  这里让服务端真的回 400（按内容判类型，不是按扩展名），然后断言界面上出现了失败文案。
*/
if (expectFail) {
  console.log('')
  console.log('=== F. 上传失败必须可见（--expect-fail 模式）===')
  const mark = await snap()
  await armPickProbe()
  const placeErr = await placeViaFileChooser(expectFail)
  if (placeErr) bad(`setFileInputFiles 失败：${placeErr}`)
  const statuses = new Set()
  const deadline = Date.now() + 25000
  let last = mark
  for (;;) {
    last = await snap()
    if (last.status) statuses.add(last.status)
    if (last.error || last.bubbles > mark.bubbles || Date.now() >= deadline) break
    await wait(80)
  }
  info(`input 收到：${last.picked}`)
  info(`期间状态行：${JSON.stringify([...statuses])}`)
  last.error
    ? ok(`**失败在界面上可见**：${last.error}`)
    : bad('上传非图片失败了，但页面上没有任何失败提示（静默失败）')
  String(last.error).includes('发送失败')
    ? ok('失败文案是"发送失败…"（与产品语义一致）')
    : bad(`失败文案不含"发送失败"：${last.error}`)
  last.bubbles === mark.bubbles
    ? ok(`没有产生幽灵消息（气泡数仍为 ${mark.bubbles}）`)
    : bad(`失败却多了消息（${mark.bubbles} → ${last.bubbles}）`)
  last.pickLeft === 0
    ? ok('失败后 input 也已清空（可以立刻重选一张）')
    : bad(`失败后 input 里仍留着 ${last.pickLeft} 个文件`)
  console.log('')
  console.log(failed === 0 ? 'DEVICE_CHAT_IMAGE_FAILPATH PASS' : 'DEVICE_CHAT_IMAGE_FAILPATH FAIL')
  try {
    ws.close()
  } catch {
    /* 已关闭 */
  }
  process.exit(failed)
}

console.log('')
console.log('=== 2. 把一张图交给 input（模拟"用户选好文件"）===')

/** 选一次文件并等结果 */
async function pickAndWait(how, timeoutMs) {
  const mark = await snap()
  const statuses = new Set()
  await armPickProbe()

  // ① 放文件
  if (how === 'A') {
    const err = await placeViaFileChooser(deviceImage)
    if (err) return { how, reason: err, statuses, snap: mark, ok: false }
  } else {
    const b = await ev(`(async () => {
      const c = document.createElement('canvas')
      c.width = 96; c.height = 64
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#2f6df6'; ctx.fillRect(0, 0, 96, 64)
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('M5', 22, 42)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const file = new File([blob], 'm5-wo2.png', { type: 'image/png' })
      const dt = new DataTransfer(); dt.items.add(file)
      const input = document.querySelector('.chatbar__file')
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return JSON.stringify({ size: file.size, type: file.type })
    })()`)
    let bp = null
    try {
      bp = JSON.parse(b)
    } catch {
      bp = null
    }
    if (!bp) return { how, reason: String(b).slice(0, 120), statuses, snap: mark, ok: false }
  }

  /*
    ② 高频采样（80ms）。
    为什么不能先 sleep 再采样：真机上传+发消息只花约 1 秒，
    "图片上传中…/发送中…"只存在几百毫秒 —— 第一版先等了 2 秒再采样，
    于是状态行**从来没被采到**，被误报成"页面上没有状态"（实际有）。
    采样必须紧跟放文件之后立刻开始。
  */
  const t0 = Date.now()
  const deadline = t0 + timeoutMs
  let last = mark
  let resent = false
  for (;;) {
    last = await snap()
    if (last.status) statuses.add(last.status)
    if (last.error || last.bubbles > mark.bubbles || Date.now() >= deadline) break
    // 有的 WebView 不会因 setFileInputFiles 自动派发 change：2.5s 还没反应就补一次
    if (how === 'A' && !resent && Date.now() - t0 > 2500 && last.picked === null) {
      await dispatchChange()
      resent = true
      info('方式 A 没自动派发 change → 手动补一次')
    }
    await wait(80)
  }

  const settled = await snap()
  if (settled.picked === null) {
    return { how, reason: 'input 没有收到文件（change 没带上 file）', statuses, snap: settled, ok: false }
  }
  info(`input 收到文件：${settled.picked}`)
  return {
    how,
    reason: '',
    statuses,
    snap: settled,
    ok: settled.bubbles > mark.bubbles && !settled.error,
  }
}

let method
let attempt = null
if (deviceImage) {
  const a = await pickAndWait('A', 25000)
  if (a.ok) {
    method = 'A（DOM.setFileInputFiles，走浏览器自己的 file-chooser 管线）'
    attempt = a
  } else {
    info(`方式 A 没成功：${a.reason}；页面错误=${a.snap.error || '无'}`)
    method = null
  }
}
if (!method) {
  if (deviceImage) {
    info('→ 降级到方式 B（页面内合成 File）；先重新加载页面清掉半途状态')
    await ev(`location.reload()`)
    await wait(3500)
    await goChat()
  }
  const b = await pickAndWait('B', 30000)
  attempt = b
  method = b.ok ? 'B（DataTransfer 合成 File 后派发 change）' : `B 也失败了（${b.reason}）`
}
console.log(`  ⚠ 本次"选文件"的方式：${method}`)
console.log('     （不是手点系统选择器；之后的上传/发送/重拉/渲染全部是产品代码，没有任何桩）')

// ---------------------------------------------------------------------------
console.log('')
console.log('=== 3. 上传中要有可见状态 ===')
if (attempt.statuses.size > 0) {
  ok(`上传/发送期间页面显示了状态：${JSON.stringify([...attempt.statuses])}`)
} else {
  bad('整个过程没看到任何状态行（用户会以为点了没反应）')
}

// ---------------------------------------------------------------------------
console.log('')
console.log('=== 4. 结果：消息发出去 + 图片渲染出来 ===')
await wait(1500)
const final = await snap()
if (final.error) bad(`页面显示了发送失败：${final.error}`)
else ok('页面上没有"发送失败"')
final.bubbles > before.bubbles
  ? ok(`气泡数 ${before.bubbles} → ${final.bubbles}（发完图重新拉了消息列表）`)
  : bad(`气泡数没有增加（${before.bubbles} → ${final.bubbles}）`)
/*
  注意：本会话里**可能本来就有图片消息**（M4 Slice A 的 fixture 就是一条图片消息），
  所以"页面上有图"本身不构成证据。必须证明**新加的那一条**（最后一条气泡）
  自己带了一张渲染成功的 blob 图，并且图片总数比发送前多。
*/
final.media > before.media
  ? ok(`图片元素数 ${before.media} → ${final.media}（新增了一张图）`)
  : bad(`图片元素数没有增加（${before.media} → ${final.media}）`)
final.lastBubbleOk > 0
  ? ok(`**新发的那条气泡里的图片真的渲染出来了**：${final.lastBubbleOk} 张 naturalWidth>0，其中 ${final.lastBubbleBlob} 张是 blob: URL（气泡文字："${final.lastBubbleText}"）`)
  : bad(`最后一条气泡里没有渲染成功的图片（lastBubbleImgs=${final.lastBubbleImgs}，ok=${final.lastBubbleOk}，text="${final.lastBubbleText}"）`)
final.pickLeft === 0
  ? ok('发送后 input 已清空（同一张图可以再选一次）')
  : bad(`input 里还留着 ${final.pickLeft} 个文件 —— 同一张图再选不会触发 change`)

// ---------------------------------------------------------------------------
console.log('')
console.log('=== 5. 网络证据（服务端真的收下了）===')
/** 把每个请求的方法记下来：multipart POST 会先发一个 OPTIONS 预检（204），
 *  只看响应会对预检误判，所以必须按 requestId 关联方法与响应。 */
const methods = new Map()
for (const e of events) {
  if (e.method === 'Network.requestWillBeSent') {
    methods.set(e.params.requestId, { method: e.params.request?.method, url: e.params.request?.url })
  }
}
const seen = new Map()
for (const e of events) {
  if (e.method !== 'Network.responseReceived') continue
  const r = e.params?.response
  if (!r?.url || !/\/api\/media|\/messages/.test(r.url)) continue
  const m = methods.get(e.params.requestId)?.method ?? '?'
  seen.set(`${m} ${r.url}`, { method: m, url: r.url, status: r.status, mime: r.mimeType })
}
const reqs = [...seen.values()].filter((r) => r.method !== 'OPTIONS')
if (reqs.length === 0) {
  bad('没抓到任何 /api/media 或 /messages 的真实请求（请求可能根本没发出）')
} else {
  for (const r of reqs) {
    console.log(`       ${r.status} ${r.method} ${r.url.replace(API_ORIGIN, '')}  [${r.mime}]`)
    // ⚠ 必须同时看**方法**：GET /api/threads/:id/messages 也匹配 /messages，
    //   只按 URL 判断会把"读消息列表 200"误报成"发消息 200"（第一版就是这样误判的）
    if (r.method === 'POST' && /\/api\/media$/.test(r.url)) {
      r.status === 201 ? ok('POST /api/media → 201（上传成功）') : bad(`POST /api/media → ${r.status}`)
    } else if (r.method === 'POST' && /\/messages$/.test(r.url)) {
      r.status === 201
        ? ok('POST /api/threads/:id/messages → 201（消息发出）')
        : bad(`POST /messages → ${r.status}`)
    }
  }
  const gets = reqs.filter((r) => r.method === 'GET' && /\/api\/media\//.test(r.url))
  gets.some((r) => r.status === 200)
    ? ok('GET /api/media/:id → 200（私有图能取到，说明会话成员可见性判定通过）')
    : bad('没有看到成功的 GET /api/media/:id')
}
if (seen.size > reqs.length) info(`（另有 ${seen.size - reqs.length} 个 OPTIONS 预检响应，已按方法过滤掉）`)

// ---------------------------------------------------------------------------
console.log('')
console.log('=== 6. 重新加载后图片仍在（证明落在服务端，不是本地状态）===')
await ev(`location.reload()`)
await wait(3500)
await goChat()
const reloaded = await snap()
reloaded.lastBubbleOk > 0
  ? ok(`**重载后最后一条气泡的图仍渲染成功**（${reloaded.lastBubbleOk} 张 naturalWidth>0）—— 消息与私有媒体都写进了服务端`)
  : bad(`重载后最后一条气泡没有图片（media=${reloaded.media}，ok=${reloaded.mediaOk}，state=${reloaded.state}）`)

// ---------------------------------------------------------------------------
console.log('')
console.log(failed === 0 ? 'DEVICE_CHAT_IMAGE_RESULT PASS' : 'DEVICE_CHAT_IMAGE_RESULT FAIL')
try {
  ws.close()
} catch {
  /* 已关闭 */
}
process.exit(failed)
