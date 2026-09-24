// 探测 2：实际尝试 getUserMedia 采集麦克风（不改产品、不写服务端、不装东西）
// 目的：确认"未声明 RECORD_AUDIO"时的失败形态，以及失败后是否需要处理系统弹窗
const listRes = await fetch('http://127.0.0.1:9222/json')
const list = await listRes.json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.log('NO_PAGE_TARGET'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
function send(method, params) {
  return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
}
async function evaluate(expression, timeoutMs = 20000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

console.log('--- D) 实际尝试 getUserMedia({audio:true}) ---')
const got = await evaluate(`(async () => {
  const t0 = Date.now()
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    const tracks = s.getAudioTracks().map(t => ({ label: t.label, enabled: t.enabled, settings: t.getSettings() }))
    s.getTracks().forEach(t => t.stop())
    return { ok: true, ms: Date.now() - t0, tracks }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, name: e.name, message: e.message }
  }
})()`, 30000)
console.log(JSON.stringify(got, null, 2))

console.log('--- E) 若授予：MediaRecorder 能否真正产出数据（仅当 D 成功时才有意义）---')
if (got && got.ok) {
  const rec = await evaluate(`(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(s, { mimeType: 'audio/webm' })
      const chunks = []
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data.size) }
      const done = new Promise(r => { mr.onstop = r })
      mr.start()
      await new Promise(r => setTimeout(r, 1500))
      mr.stop(); await done
      s.getTracks().forEach(t => t.stop())
      return { ok: true, chunks, totalBytes: chunks.reduce((a,b)=>a+b,0) }
    } catch (e) { return { ok: false, name: e.name, message: e.message } }
  })()`, 30000)
  console.log(JSON.stringify(rec, null, 2))
} else {
  console.log('  跳过（D 未成功，无需测）')
}

ws.close()
