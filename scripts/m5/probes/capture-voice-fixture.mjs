/**
 * 采集一份**真机 MediaRecorder 产出的真实 audio/webm** 作为测试 fixture。
 *
 * 为什么必须用真机产出的文件（而不是手工拼一个 WebM 头）：
 *   我此前在负向断言里手工拼过一个"最小 WebM"，因为长度 vint 编码写错（0x88 应为 0x84），
 *   服务端把它判成"不认识的文件类型"，导致断言**因错误的原因通过**。
 *   真机文件才能真实覆盖容器探测、时长校验、GC、备份屏障这些路径。
 *
 * 为什么用 CDP 在 WebView 里录（而不是走产品的上传路径再下载）：
 *   本脚本**完全不碰服务器与 DB**：录完把 blob 以 base64 交回 Node 侧落盘即可，
 *   因此不会产生任何 media 行、盘上文件或消息残留，也不需要登录态。
 *
 * 产物：scripts/m5/fixtures/voice-sample.webm（入库，供后续 gate 复用）
 * 用法：node tools/tmp/capture-voice-fixture.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const OUT_DIR = 'G:\\demo map\\scripts\\m5\\fixtures'
const OUT = `${OUT_DIR}\\voice-sample.webm`
const HOLD_MS = 2500

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target（先做 adb forward tcp:9222 …）')
  process.exit(2)
}
console.log('PAGE =', page.url)

const ws = new WebSocket(page.webSocketDebuggerUrl)
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
  })
async function evaluate(expression, timeoutMs = 60000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

const res = await evaluate(
  `(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = (typeof MediaRecorder.isTypeSupported === 'function' &&
                    MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) ? 'audio/webm;codecs=opus' : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const chunks = []
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
      const stopped = new Promise((r) => { rec.onstop = r })
      rec.start()
      await new Promise((r) => setTimeout(r, ${HOLD_MS}))
      rec.stop()
      await stopped
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: rec.mimeType || mime })
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      const CH = 0x8000
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH))
      }
      return { ok: true, size: blob.size, mime: blob.type, b64: btoa(bin) }
    } catch (e) {
      return { ok: false, name: e && e.name, message: e && e.message }
    }
  })()`,
  90000,
)

if (!res || res.ok !== true) {
  console.error('FATAL 采集失败：', JSON.stringify(res))
  process.exit(1)
}

const bytes = Buffer.from(res.b64, 'base64')
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, bytes)

console.log('  采集成功')
console.log('  mime  =', res.mime)
console.log('  size  =', res.size, '字节（base64 解码后', bytes.length, '字节）')
console.log('  前 8 字节 =', [...bytes.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' '))
console.log('    （EBML 魔数应为 1a 45 df a3）')
console.log('  落盘 →', OUT)

// 自查：必须是合法 EBML/WebM 头，否则拒绝作为 fixture（防"坏 fixture 导致假通过"）
const magic = bytes.subarray(0, 4)
const isEbml = magic[0] === 0x1a && magic[1] === 0x45 && magic[2] === 0xdf && magic[3] === 0xa3
const hasWebm = bytes.subarray(0, 64).includes(Buffer.from('webm', 'ascii'))
console.log('  自查 EBML 魔数:', isEbml ? 'OK' : '**不合法**')
console.log('  自查 DocType=webm:', hasWebm ? 'OK' : '**未找到**')
if (!isEbml || !hasWebm) {
  console.error('FATAL 采集到的文件不是合法 WebM，拒绝作为 fixture')
  process.exit(1)
}
ws.close()
