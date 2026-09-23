/**
 * 把已捕获的会话注入**网页端**的 localStorage，并刷新页面
 *
 * 为什么这样可以（而不用改短信配置）：
 *   会话是 bearer token，**与来源无关** —— 服务端只看 Authorization 头。
 *   所以把模拟器 App 里那个仍然有效的 token 写到网页端 origin 的
 *   localStorage（同一个键名）即可，服务端认可。
 *   ⇒ 对真实用户零影响（不需要临时关短信）。
 *
 * ⚠️ 只读 tools/tmp/ 下的会话文件，绝不打印完整 token。
 */
import { readFileSync, existsSync } from 'node:fs'

const PORT = process.env.CDP_PORT ?? 9222
const SESSION_FILE = process.env.SESSION_IN ?? 'G:/demo map/tools/tmp/web-session.json'
const EXPECT_ORIGIN = process.env.WEB_ORIGIN ?? 'https://8.148.156.146'

if (!existsSync(SESSION_FILE)) { console.error('FATAL 找不到会话文件', SESSION_FILE); process.exit(1) }
const s = JSON.parse(readFileSync(SESSION_FILE, 'utf8'))
if (!s.token) { console.error('FATAL 会话文件里没有 token'); process.exit(1) }

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
async function ev(expr, t = 15000) {
  const p = send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), t))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ⚠️ 先校验目标 origin，避免把 token 注入到错误的站点（例：模拟器的 localhost）
// ⚠️ 刚启动的 Chrome 页签可能还在 about:blank ⇒ **先导航到网页端**再注入，
//    而不是直接放弃（初版就是这样，表现为 origin: null 直接 FATAL）。
let origin = await ev(`location.origin`)
if (!String(origin).startsWith(EXPECT_ORIGIN)) {
  console.log(`  当前 origin=${origin} 不是网页端 ⇒ 先导航到 ${EXPECT_ORIGIN}/`)
  await send('Page.enable')
  await send('Page.navigate', { url: EXPECT_ORIGIN + '/' })
  await sleep(7000)
  origin = await ev(`location.origin`)
  console.log('  导航后 origin:', origin)
}
if (!String(origin).startsWith(EXPECT_ORIGIN)) {
  console.error(`FATAL 仍不在网页端（origin=${origin}）⇒ 拒绝注入`)
  process.exit(1)
}
console.log('  ✓ origin 校验通过:', origin)

// 注入（键名必须与 app/src/api/session.ts 的 KEY 一致）
const payload = JSON.stringify(s)
const res = await ev(`(() => {
  try { localStorage.setItem('campus.demo.session.v1', ${JSON.stringify(payload)}); return 'ok' }
  catch (e) { return 'ERR ' + e }
})()`)
console.log('  注入结果:', res)
if (res !== 'ok') process.exit(1)

// 刷新以让应用读取会话
await send('Page.enable')
await send('Page.reload', { ignoreCache: false })
await sleep(6000)

const after = await ev(`(() => {
  const raw = localStorage.getItem('campus.demo.session.v1')
  let u = null
  try { u = JSON.parse(raw).user } catch {}
  return { hash: location.hash, loggedInUser: u ? u.displayName + ' / ' + u.handle : null, text: (document.body.innerText||'').replace(/\\s+/g,' ').trim().slice(0,120) }
})()`)
console.log('  刷新后:', JSON.stringify(after))
ws.close()
