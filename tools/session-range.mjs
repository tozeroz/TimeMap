// 打印指定 seq 范围内的会话事件（紧凑格式），用于定位异常停止前后的消息序列。
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const src = process.argv[2]
const from = Number(process.argv[3])
const to = Number(process.argv[4])

const buf = readFileSync(src)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i)
}
const parts = []
for (let k = 0; k < offsets.length; k++) {
  const start = offsets[k]
  const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length
  try { parts.push(zstdDecompressSync(buf.subarray(start, end))) } catch { }
}
const lines = Buffer.concat(parts).toString('utf8').split('\n').filter(Boolean)

for (const line of lines) {
  let o
  try { o = JSON.parse(line) } catch { continue }
  const seq = o.seq
  if (typeof seq !== 'number' || seq < from || seq > to) continue

  let detail = ''
  const d = o.data ?? {}
  switch (o.type) {
    case 'tool/call':
      detail = `callId=${d.callId ?? d.message?.content?.[0]?.toolCallId} name=${d.name ?? d.message?.content?.[0]?.toolName} args=${JSON.stringify(d.args ?? d.message?.content?.[0]?.args ?? {}).slice(0, 120)}`
      break
    case 'tool/result':
      detail = `callId=${d.message?.content?.[0]?.toolCallId} err=${!!d.error} text=${JSON.stringify(d.message?.content?.[0]?.content?.[0]?.text ?? '').slice(0, 160)}`
      break
    case 'assistant/message': {
      const c = d.message?.content ?? []
      detail = `blocks=[${c.map((b) => b.type + (b.type === 'tool-call' ? `:${b.toolCallId}:${b.toolName}` : '')).join(', ')}]`
      break
    }
    case 'user/message': {
      const c = d.message?.content ?? []
      detail = `role=${d.message?.role} blocks=[${c.map((b) => b.type + (b.type === 'tool-result' ? `:${b.toolCallId}` : '')).join(', ')}] text=${JSON.stringify(c.find((b) => b.type === 'text')?.text ?? '').slice(0, 90)}`
      break
    }
    case 'turn/end':
    case 'turn/start':
      detail = JSON.stringify(d).slice(0, 300)
      break
    case 'assistant/chunk': {
      const ch = d.chunk ?? {}
      detail = ch.type === 'finish' ? `finish=${JSON.stringify(ch.reason).slice(0, 300)}` : ch.type
      break
    }
    default:
      detail = JSON.stringify(d).slice(0, 200)
  }
  console.log(`#${seq} ${o.type} ${detail}`)
}
