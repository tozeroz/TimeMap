/**
 * M4 Slice A 诊断：在 WebView 内**逐步**执行私有图加载链路，把每一步的真实结果打出来。
 *
 * 为什么要逐步：上一轮出现了"服务端 200 + 8 字节（Nginx 日志）"但"页面显示图片不可用"
 * 的矛盾，而 UI 只渲染了一句「图片不可用」，把失败原因丢了 —— 所以拿不到判断依据。
 * 本脚本直接在页面里复现链路，每一步都取回真实值：
 *   1. 会话里有没有 token
 *   2. fetch 的 status / response.type / content-length
 *   3. blob.size / blob.type
 *   4. URL.createObjectURL 是否抛错
 *   5. <img src=blob:> 能否解码（naturalWidth）
 *
 * 用法：node scripts/m4/diag-private-image.mjs <mediaId>
 */
const mediaId = process.argv[2]
if (!mediaId) {
  console.error('用法: node diag-private-image.mjs <mediaId>')
  process.exit(2)
}
const origin = 'https://8.148.156.146'

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((x) => x.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
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
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i)
        r({ timeout: true })
      }
    }, 20000)
  })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.result?.exceptionDetails) {
    return { exception: JSON.stringify(r.result.exceptionDetails).slice(0, 300) }
  }
  return r?.result?.result?.value
}

const step = await ev(`(async () => {
  const out = {}
  try {
    const raw = localStorage.getItem('campus.demo.session.v1')
    const sess = raw ? JSON.parse(raw) : null
    out.hasSession = !!sess
    out.tokenLen = sess?.token ? sess.token.length : 0
  } catch (e) { out.sessionErr = String(e) }

  const url = ${JSON.stringify(origin)} + '/api/media/' + ${JSON.stringify(mediaId)}
  out.url = url
  try {
    const raw = localStorage.getItem('campus.demo.session.v1')
    const sess = raw ? JSON.parse(raw) : null
    const t0 = Date.now()
    const res = await fetch(url, { headers: sess?.token ? { Authorization: 'Bearer ' + sess.token } : {} })
    out.fetchMs = Date.now() - t0
    out.status = res.status
    out.resType = res.type
    out.contentType = res.headers.get('content-type')
    out.contentLength = res.headers.get('content-length')
    out.cacheControl = res.headers.get('cache-control')
    if (!res.ok) { out.note = 'fetch 非 2xx'; return JSON.stringify(out) }
    const blob = await res.blob()
    out.blobSize = blob.size
    out.blobType = blob.type
    try {
      const blobUrl = URL.createObjectURL(blob)
      out.blobUrlPrefix = blobUrl.split(':')[0]
      out.created = true
      // 试解码
      const img = new Image()
      const okDecoded = await new Promise((r) => {
        img.onload = () => r(true)
        img.onerror = (e) => r('onerror:' + String(e?.type || ''))
        setTimeout(() => r('timeout'), 8000)
        img.src = blobUrl
      })
      out.decode = okDecoded
      out.naturalWidth = img.naturalWidth
      out.naturalHeight = img.naturalHeight
      URL.revokeObjectURL(blobUrl)
    } catch (e) {
      out.createObjectURLErr = String(e)
    }
  } catch (e) {
    out.fetchErr = String(e)
  }
  return JSON.stringify(out)
})()`)

console.log(typeof step === 'string' ? step : JSON.stringify(step))

// 另外看一眼 CSP：blob: 若被 img-src 挡住，<img src=blob:> 会 onerror
const csp = await ev(`(document.querySelector('meta[http-equiv="Content-Security-Policy"]')||{}).content || '(no meta CSP)'`)
console.log('CSP:', typeof csp === 'string' ? csp.slice(0, 200) : JSON.stringify(csp))

try {
  ws.close()
} catch {
  /* 已关闭 */
}
process.exit(0)
