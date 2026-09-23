/**
 * 从**模拟器 App**（已登录）读出会话 JSON，写到本地文件供网页端注入
 *
 * ⚠️ 读出的是**bearer token 明文** ⇒ 只写到 tools/tmp/（.gitignore 已忽略），
 *    绝不写进仓库、绝不打印完整 token。
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const PORT = process.env.CDP_PORT ?? 9222
const OUT = process.env.SESSION_OUT ?? 'G:/demo map/tools/tmp/web-session.json'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.error('FATAL 没有 page target'); process.exit(2) }
console.log('  来源 url:', page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
async function ev(expr, t = 15000) {
  const p = new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })) })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), t))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

const raw = await ev(`localStorage.getItem('campus.demo.session.v1')`)
if (!raw || typeof raw !== 'string') {
  console.error('FATAL 来源里没有会话（campus.demo.session.v1 为空）⇒ 这个 App 没登录')
  process.exit(1)
}
let s
try { s = JSON.parse(raw) } catch (e) { console.error('FATAL 会话不是合法 JSON'); process.exit(1) }
if (!s.token) { console.error('FATAL 会话里没有 token'); process.exit(1) }

mkdirSync('G:/demo map/tools/tmp', { recursive: true })
writeFileSync(OUT, JSON.stringify(s), 'utf8')
const masked = s.token.slice(0, 6) + '…(len ' + s.token.length + ')'
console.log('  ✓ 已保存会话到', OUT)
console.log('    token:', masked)
console.log('    expiresAt:', s.expiresAt)
console.log('    user:', JSON.stringify(s.user))
ws.close()
