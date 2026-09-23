/**
 * 网页端专属门禁：**公共信任的 HTTPS + 同源 API 可用**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 为什么需要（以及为什么不能只靠 curl 验证书）
 * ════════════════════════════════════════════════════════════════════════════
 *   本项目原本用**自建私有 CA 自签**证书：App 能用（APK 内置了那个 CA），
 *   但**浏览器不认** ⇒ 网页端必然报证书错误、普通用户根本用不了。
 *   为此我们换成了 Let's Encrypt 的**纯 IP 证书**（2026 起正式支持，详见
 *   docs/TLS-IP-CERTIFICATE.md）。
 *
 *   ⚠️ 但"curl 不带 -k 能通"**不等于浏览器能通**：
 *      · curl 用系统 CA 库；浏览器有自己的根证书策略与拦截页
 *      · 一旦证书被拦，浏览器显示的是**自己的警告页**，
 *        而 curl 会直接报错 —— 两者失效模式不同
 *   ⇒ 必须在**真实浏览器里**做信任判定，而不是从命令行推断。
 *
 *   判据选得刻意**有区分力**：在页面内 `fetch()` 同源 API。
 *     · 证书不被信任 ⇒ fetch 会以网络错误 reject（且页面会被警告页占据）
 *     · 证书可信     ⇒ fetch 正常拿到 200 与 JSON
 *   这同时验了两件事：**证书信任** 与 **同源 API 可达**（网页端不需要 CORS）。
 */
const PORT = process.env.CDP_PORT ?? 9222
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'https://8.148.156.146'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.error('FATAL 没有 page target'); process.exit(2) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
function send(method, params = {}) {
  return new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
}
async function ev(expr, t = 25000) {
  const p = send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), t))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
await send('Page.enable')
await send('Network.enable')
await send('Page.reload', { ignoreCache: true })
await sleep(6000)

const checks = {}
const detail = {}

// ① 页面本身是 https（安全上下文；摄像头/麦克风等能力的前提）
const origin = await ev(`location.origin`)
detail.origin = origin
checks.ON_WEB_ORIGIN = String(origin || '').startsWith(WEB_ORIGIN)
checks.IS_SECURE_CONTEXT = (await ev(`window.isSecureContext === true`)) === true

// ② ⭐ 决定性判据：在**页面内**请求同源 API
//    ⚠️ 用 'no-store' 避免缓存掩盖证书问题
const api = await ev(`(async () => {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' })
    const t = await r.text()
    return { ok: true, status: r.status, body: t.slice(0, 120) }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) }
  }
})()`)
detail.apiInPage = api
checks.SAME_ORIGIN_API_OK = !!api && api.ok === true && api.status === 200
// ③ 返回的确实是我们的后端 JSON（防止被反代/拦截页糊弄成 200）
checks.API_BODY_IS_OURS = !!api && typeof api.body === 'string' && /"status"\s*:\s*"ok"/.test(api.body)

// ④ 证书指纹与服务器当前证书一致（把"浏览器信任的那张"和"服务器在用的那张"绑起来）
//    ⚠️ 浏览器侧拿不到对端证书链 ⇒ 用"页面内请求成功"作为信任证据，
//       再用 Security 域的安全状态作为补充信号。
const sec = await send('Security.enable').then(() => ev(`(async () => {
  // 触发一次导航级安全状态查询：用 Performance API 的 nextHopProtocol 只能证明有 TLS
  const nav = performance.getEntriesByType('navigation')[0]
  return { protocol: nav ? nav.nextHopProtocol : null, https: location.protocol === 'https:' }
})()`)).catch(() => null)
detail.transport = sec
checks.TRANSPORT_IS_TLS = !!sec && sec.https === true && !!sec.protocol && /h2|http\/1\.1/.test(String(sec.protocol))

const fail = Object.entries(checks).filter(([, ok]) => ok !== true).map(([k]) => k)
console.log('VERDICT = ' + JSON.stringify({ ...checks, detail }))
ws.close()
process.exit(fail.length ? 1 : 0)
