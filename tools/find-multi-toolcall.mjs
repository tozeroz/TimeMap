// 扫描会话日志中「一条 assistant 消息里并发 >=2 个 tool call」的步骤。
// 这是触发 DeepSeekEyes 裁剪孤儿 tool-result 的前提条件。
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const src = process.argv[2]
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

let multi = 0
const rows = []
for (const line of lines) {
  let o
  try { o = JSON.parse(line) } catch { continue }
  if (o.type !== 'assistant/message') continue
  const calls = (o.data?.message?.content ?? []).filter((b) => b.type === 'tool-call')
  if (calls.length >= 2) {
    multi++
    rows.push({
      seq: o.seq,
      turn: o.data.turn,
      step: o.data.step,
      count: calls.length,
      names: calls.map((c) => c.name).join(' + '),
      time: new Date(o.time).toLocaleTimeString('zh-CN', { hour12: false }),
    })
  }
}

console.log(`并发 >=2 tool call 的 assistant 消息数: ${multi}`)
for (const r of rows) {
  console.log(`  turn ${String(r.turn).padStart(2)} step ${String(r.step).padStart(2)}  ${r.time}  ×${r.count}  ${r.names}`)
}
