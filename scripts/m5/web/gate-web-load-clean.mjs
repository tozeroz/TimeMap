/**
 * 网页端专属门禁：**加载是干净的**（无失败请求、无控制台错误、无 404）
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 为什么需要（它同样是被真实问题逼出来的）
 * ════════════════════════════════════════════════════════════════════════════
 *   网页端第一次跑起来时，控制台有一条 404 ——
 *   根因是 index.html **完全没有图标声明**，浏览器就去探测 `/favicon.ico` 拿到 404。
 *   这类问题**不影响功能**，所以任何"功能断言"都不会发现它；
 *   但它（a）是真实缺陷，(b) 会在控制台留噪声，掩盖以后真正的错误。
 *
 *   而原生端**不会有这个问题**（WebView 不发 favicon 请求）
 *   ⇒ 它是**网页端专属**的判据，必须由网页端门禁来守。
 *
 * ⚠️ 判据的取舍（避免做出一个"永远红"的门禁）：
 *   · 只把 **4xx/5xx 的静态资源请求** 与 **页面级 JS 异常** 判为失败；
 *   · 允许**业务上预期的非 2xx**（例如 401 未登录、404 资源不存在等由应用显式处理的接口
 *     调用）—— 这些是应用的正常分支，不是缺陷。
 *     本门禁通过"**排除应用自己发起的 XHR/fetch**"来做到这一点，
 *     只看**文档与静态资源**（document/script/stylesheet/image/font）的加载结果。
 */
const PORT = process.env.CDP_PORT ?? 9222
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'https://8.148.156.146'
// 入口路径（默认 `/`）—— 与 gate-web-app-mount 同理：敏感度验证要能指向一个
// **故意坏的**子路径，而不是改 WEB_ORIGIN（那会让 origin 断言一起失败、归因错误）。
const WEB_ENTRY_PATH = process.env.WEB_ENTRY_PATH ?? '/'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.error('FATAL 没有 page target'); process.exit(2) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })

let id = 0
const pending = new Map()
const staticResponses = []   // 文档与静态资源
const failed = []            // 加载失败的请求
const consoleErrors = []
const pageExceptions = []

const STATIC_TYPES = new Set(['Document', 'Script', 'Stylesheet', 'Image', 'Font', 'Manifest', 'Other'])

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Network.responseReceived') {
    const { type, response } = m.params
    const u = response.url || ''
    // 只看我们自己的 origin 的文档/静态资源
    if (STATIC_TYPES.has(type) && u.startsWith(WEB_ORIGIN)) {
      staticResponses.push({ type, status: response.status, url: u.replace(WEB_ORIGIN, '') })
    }
  }
  if (m.method === 'Network.loadingFailed') {
    const u = (m.params.requestId && '') || ''
    // 只关心未被 cancel 的真实失败
    if (m.params.errorText !== 'net::ERR_ABORTED' && !m.params.canceled) {
      failed.push({ type: m.params.type, error: m.params.errorText, blocked: m.params.blockedReason ?? null, url: u })
    }
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 200))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    pageExceptions.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 300))
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
function send(method, params = {}) {
  return new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
await send('Network.enable')
await send('Page.enable')

// 从干净状态加载（用户打开时会经历的就是这个）
await send('Page.navigate', { url: `${WEB_ORIGIN}${WEB_ENTRY_PATH}` })
await sleep(8000)

const checks = {}
const detail = {}

// ① 静态资源不能有 4xx/5xx（favicon 404 就是这一类）
const badStatic = staticResponses.filter((r) => r.status >= 400)
detail.staticResponses = staticResponses
detail.badStatic = badStatic
checks.NO_FAILED_STATIC_RESOURCES = badStatic.length === 0

// ② 不能有加载失败的请求
detail.failedRequests = failed
checks.NO_LOADING_FAILURES = failed.length === 0

// ③ 不能有页面级未捕获异常
detail.exceptions = pageExceptions.slice(0, 3)
checks.NO_PAGE_EXCEPTIONS = pageExceptions.length === 0

// ④ 控制台不应有 error 级输出
detail.consoleErrors = consoleErrors.slice(0, 5)
checks.NO_CONSOLE_ERRORS = consoleErrors.length === 0

// ⑤ 应当在预期的路由上（刷新后仍停在网页端地址，说明 SPA 正常）
const href = await (async () => {
  const p = new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: 'location.href', returnByValue: true } })) })
  const r = await p
  return r.result && r.result.result ? r.result.result.value : null
})()
detail.href = href
checks.ON_WEB_ORIGIN = String(href || '').startsWith(WEB_ORIGIN)

const fail = Object.entries(checks).filter(([, ok]) => ok !== true).map(([k]) => k)
console.log('VERDICT = ' + JSON.stringify({ ...checks, detail }))
ws.close()
process.exit(fail.length ? 1 : 0)
