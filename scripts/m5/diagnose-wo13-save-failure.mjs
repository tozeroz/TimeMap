/**
 * 诊断：WO#13 保存为什么失败？
 *   SAVE_PROBE 显示 fetchDelta=1（请求发了）但 nameAfter 未变且 errorShown=true。
 *   我的客户端在非 401 失败时给的是通用文案，所以拿不到根因 —— 直接复现这次请求看响应。
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
async function ev(expression, timeoutMs = 30000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

console.log('=== 1) 客户端实际用的 API_ORIGIN 与 token 状态 ===')
const ctx = await ev(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  return {
    hasToken: !!sess.token,
    tokenLen: (sess.token || '').length,
    userDisplayName: sess.user ? sess.user.displayName : null,
    location: location.href,
  }
})()`)
console.log('  ', JSON.stringify(ctx))

console.log('')
console.log('=== 2) 从设备直接 PATCH（用相对路径，模拟客户端可能的行为）===')
const rel = await ev(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  try {
    const res = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(sess.token ? { authorization: 'Bearer ' + sess.token } : {}) },
      body: JSON.stringify({ displayName: 'WO13诊断A' }),
    })
    const ct = res.headers.get('content-type') || ''
    const text = await res.text()
    return { status: res.status, ct, bodyHead: text.slice(0, 200) }
  } catch (e) { return { threw: String(e && e.message) } }
})()`)
console.log('  相对路径 /api/users/me →', JSON.stringify(rel))

console.log('')
console.log('=== 3) 用绝对 origin（与 gate 的 authMe 探针一致）===')
const abs = await ev(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  try {
    const res = await fetch('https://8.148.156.146/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...(sess.token ? { authorization: 'Bearer ' + sess.token } : {}) },
      body: JSON.stringify({ displayName: 'WO13诊断B' }),
    })
    const ct = res.headers.get('content-type') || ''
    const text = await res.text()
    return { status: res.status, ct, bodyHead: text.slice(0, 240) }
  } catch (e) { return { threw: String(e && e.message) } }
})()`)
console.log('  绝对 origin →', JSON.stringify(abs))

console.log('')
console.log('=== 4) 客户端源码里的 API_ORIGIN 到底是什么 ===')
const origin = await ev(`(() => {
  /* 从打包产物里读不出来，改为：用一次 GET 观察客户端自己的请求去哪 */
  return { hint: '见下一步' }
})()`)
console.log('  ', JSON.stringify(origin))

console.log('')
console.log('=== 5) 关键：观察客户端真实 PATCH 的目标 URL 与响应 ===')
const spy = await ev(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  const log = []
  const orig = window.fetch
  window.fetch = async (u, o) => {
    const url = typeof u === 'string' ? u : (u && u.url) || ''
    const m = ((o && o.method) || 'GET').toUpperCase()
    const res = await orig(u, o)
    if (m === 'PATCH' || /users\\/me/.test(url)) {
      let body = ''
      try { body = (await res.clone().text()).slice(0, 200) } catch {}
      log.push({ url, method: m, status: res.status, ct: res.headers.get('content-type'), body })
    }
    return res
  }
  /* 触发一次真实保存：走 UI */
  location.hash = '#/me'
  await new Promise(r => setTimeout(r, 2000))
  const b = document.querySelector('[data-me-entry="edit-profile"]')
  if (b) { b.click(); await new Promise(r => setTimeout(r, 2200)) }
  const row = document.querySelector('[data-pe-row="nickname"]')
  if (row) { row.click(); await new Promise(r => setTimeout(r, 800)) }
  const input = document.querySelector('[data-pe-input]')
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'WO13诊断C')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
    const sb = document.querySelector('[data-pe-save]')
    if (sb) { sb.click(); await new Promise(r => setTimeout(r, 2600)) }
  }
  window.fetch = orig
  return { logged: log, errorText: ((document.querySelector('[data-pe-error]') || {}).textContent || '').trim() || null, nameShown: ((document.querySelector('[data-pe-name]') || {}).textContent || '').trim() }
})()`)
console.log('  ', JSON.stringify(spy, null, 2))

ws.close()
process.exit(0)
