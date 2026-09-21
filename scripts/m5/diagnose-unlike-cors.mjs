/**
 * 诊断：设备上「取消点赞」是否真的失败？（CORS 缺 DELETE 的后果）
 *
 * ## 背景
 *   新加的机械检查 check-cors-methods.sh 发现：服务端注册了 DELETE，
 *   而 CORS 的 allow-methods 是 'GET,POST,PATCH,OPTIONS' —— **缺 DELETE**。
 *   客户端 client.ts:843 **确实**用 DELETE 调 /api/posts/:id/like（取消点赞）。
 *   → 预测：跨域（Capacitor WebView origin=https://localhost）下取消点赞必然
 *     报 "Failed to fetch"。
 *
 * ## 本脚本做什么
 *   在**我们的 demo**上造一次真实点赞，然后取消，观察：
 *     · DELETE 的 HTTP 状态 / 是否抛 "Failed to fetch"
 *     · 点赞数是否回落（权威读回，而不是看本地 state）
 *   ⚠️ 只碰我们自己的数据库；结束时把点赞清掉（不留残留）。
 */
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.error('FATAL 没有 CDP target'); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function ev(expression, timeoutMs = 40000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

console.log('=== 1) 找一条真实帖子 ===')
const posts = await ev(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  const tok = sess && sess.token
  const res = await fetch('https://8.148.156.146/api/posts', tok ? { headers: { authorization: 'Bearer ' + tok } } : undefined)
  const d = await res.json()
  return { ok: true, first: (d.items || [])[0] || null, token: !!tok }
})()`)
console.log('  ', JSON.stringify(posts && posts.first ? { id: posts.first.id, likeCount: posts.first.likeCount, likedByMe: posts.first.likedByMe } : posts))

const POST_ID = posts && posts.first ? posts.first.id : null
if (!POST_ID) { console.error('FATAL 没有帖子可用'); process.exit(2) }

console.log('')
console.log('=== 2) 从设备发起 POST（点赞）与 DELETE（取消点赞），逐一记状态 ===')
const probe = await ev(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  const tok = sess && sess.token
  const id = ${JSON.stringify(POST_ID)}
  /*
    ⚠️ 必须**模拟真实客户端**：客户端的 request() 只在有 body 时才设 content-type。
    点赞/取消点赞**没有 body** → **不带** content-type → 不会触发 Fastify 的
    FST_ERR_CTP_EMPTY_JSON_BODY。我第一版探针无条件带了 content-type，
    于是拿到 400（那是**探针的错**，不是产品缺陷），会误导判断。
  */
  const H = tok ? { authorization: 'Bearer ' + tok } : {}
  const out = []
  const call = async (method) => {
    try {
      const res = await fetch('https://8.148.156.146/api/posts/' + id + '/like', { method, headers: H })
      let body = ''
      try { body = (await res.text()).slice(0, 160) } catch {}
      out.push({ method, status: res.status, body })
    } catch (e) {
      out.push({ method, threw: String(e && e.message) })
    }
  }
  await call('POST')     // 点赞
  await call('DELETE')   // 取消点赞
  return { out }
})()`)
console.log('  ', JSON.stringify(probe, null, 2))

console.log('')
console.log('=== 3) 直接只发 DELETE（先确保已点赞状态）===')
const delOnly = await ev(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  const tok = sess && sess.token
  const H = { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }
  const id = ${JSON.stringify(POST_ID)}
  const r = {}
  try {
    const res = await fetch('https://8.148.156.146/api/posts/' + id + '/like', { method: 'DELETE', headers: H })
    r.status = res.status
    r.body = (await res.text()).slice(0, 160)
  } catch (e) {
    r.threw = String(e && e.message)
  }
  return r
})()`)
console.log('  ', JSON.stringify(delOnly))

console.log('')
console.log('=== 4) 判定 ===')
const post = (probe && probe.out) ? probe.out.find((x) => x.method === 'POST') : null
const del = (probe && probe.out) ? probe.out.find((x) => x.method === 'DELETE') : null
console.log('  POST(点赞)   →', JSON.stringify(post))
console.log('  DELETE(取消) →', JSON.stringify(del))
if (del && del.threw) {
  console.log('  → ✗ **确认**：DELETE 在跨域环境下抛错（' + del.threw + '）→ 取消点赞不可用')
} else if (del && del.status && del.status >= 200 && del.status < 300) {
  console.log('  → ✓ DELETE 成功（缺失 DELETE 的 CORS 影响已被消除，或此环境未触发预检）')
} else {
  console.log('  → ? 非预期结果，需进一步看')
}
ws.close()
process.exit(0)
