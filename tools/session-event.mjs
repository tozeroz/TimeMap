// 打印指定 seq 的原始 JSON（完整）。
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const src = process.argv[2]
const want = new Set(process.argv.slice(3).map(Number))

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
  if (!want.has(o.seq)) continue
  console.log(`===== seq ${o.seq} (${o.type}) =====`)
  console.log(JSON.stringify(o, null, 2).slice(0, 4000))
  console.log()
}
