/**
 * 决定性实验：前端 POST 是否因为**缺少 Content-Type** 导致服务端拿到空 body。
 *
 * 背景：设备端留言板点「留言」后，服务端稳定返回 400（响应体 20 字节），
 * 而 curl 版的 verify-board-notes.sh 全部通过 —— 两者唯一的差别之一是
 * curl 显式带了 `Content-Type: application/json`，而 app/src/api/client.ts 里
 * **没有任何 Content-Type**（grep 确认）。
 *
 * 本脚本在页面环境里用**同一个 session token** 发两次完全相同的 POST：
 *   A. 不带 Content-Type
 *   B. 带 Content-Type: application/json
 * 比较状态码即可判定。
 *
 * ⚠ 安全：两次都发到我们**自己的 demo 后端**（8.148.156.146），
 * 内容是一个测试串；完成后由本脚本的输出决定是否清理。
 */
const peerId = process.argv[2] ?? '22222222-2222-4222-8222-222222222222'
const MARK = `DIAG${Date.now() % 100000}`

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
  if (r?.result?.exceptionDetails) return `ERR:${JSON.stringify(r.result.exceptionDetails).slice(0, 200)}`
  return r?.result?.result?.value
}

const out = await ev(`(async () => {
  const raw = localStorage.getItem('campus.demo.session.v1')
  const sess = raw ? JSON.parse(raw) : null
  if (!sess?.token) return JSON.stringify({ error: 'no session in page' })
  const url = 'https://8.148.156.146/api/board-notes/${peerId}'
  const auth = { Authorization: 'Bearer ' + sess.token }
  const res = {}
  // A. 不带 Content-Type（与前端现状一致）
  try {
    const r1 = await fetch(url, { method: 'POST', headers: auth, body: JSON.stringify({ body: '${MARK}A' }) })
    res.noContentType = { status: r1.status, text: (await r1.text()).slice(0, 60) }
  } catch (e) { res.noContentType = { err: String(e) } }
  // B. 带 Content-Type: application/json
  try {
    const r2 = await fetch(url, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ body: '${MARK}B' }) })
    res.withContentType = { status: r2.status, text: (await r2.text()).slice(0, 60) }
  } catch (e) { res.withContentType = { err: String(e) } }
  return JSON.stringify(res)
})()`)

console.log('页面内实验结果:', typeof out === 'string' ? out : JSON.stringify(out))
console.log('')
console.log('标记串（用于清理）:', MARK)
try {
  ws.close()
} catch {
  /* 已关闭 */
}
process.exit(0)
