// WO#5 第二轮探针（P2–P10）：真实麦克风采集可行性
// 与 PowerShell 侧并行：本脚本发起 getUserMedia 并写状态到文件，PowerShell 侧轮询系统授权 UI。
// 注意：沙箱禁止 Node 用管道捕获子进程输出 → 本脚本**不 spawn adb**，只写文件。
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\probe-p2p10.json'
const state = { startedAt: new Date().toISOString(), steps: [] }
function save() { writeFileSync(OUT, JSON.stringify(state, null, 2), 'utf8') }
function log(k, v) { state.steps.push({ at: new Date().toISOString(), k, v }); save(); console.log(k, '=', JSON.stringify(v)) }
save()

const listRes = await fetch('http://127.0.0.1:9222/json')
const list = await listRes.json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { log('ERROR', 'NO_PAGE_TARGET'); process.exit(1) }
log('PAGE', page.url)

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
async function evaluate(expression, timeoutMs = 120000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true, timeoutMs }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

// P2：调用 getUserMedia（会阻塞直到用户决定/系统拒绝）
// 期间 PowerShell 侧轮询是否出现系统授权 UI（P3）
log('P2_FIRING_AT', new Date().toISOString())
const got = await evaluate(`(async () => {
  const t0 = Date.now()
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    const tracks = s.getAudioTracks().map(t => ({ label: t.label, enabled: t.enabled, readyState: t.readyState, settings: t.getSettings() }))
    window.__PROBE_STREAM__ = s
    return { ok: true, ms: Date.now() - t0, trackCount: tracks.length, tracks }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, name: e.name, message: e.message }
  }
})()`)
log('P2_RESULT', got)
if (!got || !got.ok) {
  log('VERDICT', 'P4_FAIL_NO_STREAM')
  ws.close()
  process.exit(0)
}

// P5–P8：录音 3 秒，检查 blob
const rec = await evaluate(`(async () => {
  const s = window.__PROBE_STREAM__
  const out = { p5_started: false, p6_seconds: 3, p7_blobSize: 0, p8_recorderMime: null, p8_blobType: null }
  try {
    const mr = new MediaRecorder(s, { mimeType: 'audio/webm' })
    out.p8_recorderMime = mr.mimeType
    const chunks = []
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    const stopped = new Promise(r => { mr.onstop = r })
    mr.start(); out.p5_started = true
    await new Promise(r => setTimeout(r, 3000))
    mr.stop(); await stopped
    const blob = new Blob(chunks, { type: out.p8_recorderMime })
    out.p7_blobSize = blob.size
    out.p8_blobType = blob.type
    out.chunkCount = chunks.length
    // P9：用 <audio> 解码
    const url = URL.createObjectURL(blob)
    out.p9 = await new Promise((resolve) => {
      const a = document.createElement('audio')
      a.preload = 'metadata'
      a.onloadedmetadata = () => resolve({ ok: true, duration: a.duration })
      a.onerror = () => resolve({ ok: false, error: a.error ? a.error.code : 'unknown' })
      setTimeout(() => resolve({ ok: false, error: 'timeout' }), 8000)
      a.src = url
    })
    out.p10_duration = (out.p9 && out.p9.ok) ? out.p9.duration : null
    URL.revokeObjectURL(url)
    s.getTracks().forEach(t => t.stop())
    window.__PROBE_STREAM__ = null
    return out
  } catch (e) { out.error = e.name + ': ' + e.message; return out }
})()`, 60000)
log('P5_P10_RESULT', rec)

const verdict = []
verdict.push(['P4_stream', got.ok ? 'PASS' : 'FAIL'])
verdict.push(['P5_started', rec && rec.p5_started ? 'PASS' : 'FAIL'])
verdict.push(['P7_blobSize>0', rec && rec.p7_blobSize > 0 ? 'PASS' : 'FAIL'])
verdict.push(['P8_mimeType', rec && rec.p8_recorderMime ? 'PASS(' + rec.p8_recorderMime + ')' : 'FAIL'])
verdict.push(['P9_audioDecode', rec && rec.p9 && rec.p9.ok ? 'PASS' : 'FAIL'])
verdict.push(['P10_duration>0', rec && rec.p10_duration > 0 ? 'PASS(' + rec.p10_duration + ')' : 'FAIL'])
log('VERDICT', verdict)
ws.close()
