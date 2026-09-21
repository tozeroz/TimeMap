// 只读探测：我方 App 的 WebView（com.campusx.demo）里，录音相关 API 是否可用。
// 复用 scripts/m5/cdp-eval.mjs 的方式：Node 内置 WebSocket，不依赖第三方模块。
// 纯探测：不写入、不安装、不改产品。
const listRes = await fetch('http://127.0.0.1:9222/json')
const list = await listRes.json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.log('NO_PAGE_TARGET'); process.exit(1) }
console.log('target url =', page.url)

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
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

const api = await evaluate(`(() => {
  const o = {}
  o.hasMediaDevices     = !!(navigator.mediaDevices)
  o.hasGetUserMedia     = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  o.hasEnumerateDevices = !!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)
  o.hasMediaRecorder    = typeof MediaRecorder !== 'undefined'
  o.supportedMimes      = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported)
    ? ['audio/webm','audio/webm;codecs=opus','audio/mp4','audio/aac','audio/ogg;codecs=opus','audio/3gpp']
        .filter((m) => { try { return MediaRecorder.isTypeSupported(m) } catch (e) { return false } })
    : null
  o.isSecureContext     = window.isSecureContext
  o.origin              = location.origin
  o.hasAudioContext     = typeof AudioContext !== 'undefined'
  o.hasPermissionsAPI   = !!(navigator.permissions && navigator.permissions.query)
  return o
})()`)
console.log('--- A) WebView 录音 API 可用性 ---')
console.log(JSON.stringify(api, null, 2))

const perm = await evaluate(`(async () => {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return { perm: 'no-permissions-api' }
    const st = await navigator.permissions.query({ name: 'microphone' })
    return { perm: st.state }
  } catch (e) { return { perm: 'error: ' + e.message } }
})()`)
console.log('--- B) 麦克风权限状态（查询不弹窗）---')
console.log(JSON.stringify(perm, null, 2))

const devices = await evaluate(`(async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { devices: 'unsupported' }
    const ds = await navigator.mediaDevices.enumerateDevices()
    return { audioInputs: ds.filter(d => d.kind === 'audioinput').map(d => ({ label: d.label || '(未授权时为空)', id: d.deviceId.slice(0,8) })) }
  } catch (e) { return { devices: 'error: ' + e.message } }
})()`)
console.log('--- C) 音频输入设备（enumerateDevices）---')
console.log(JSON.stringify(devices, null, 2))

ws.close()
