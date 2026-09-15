// 分析 DSH 会话日志（session.jsonl.zstd）。
// DSH 写的是「多帧拼接」的 zstd，node 的 zstdDecompressSync 只吃第一帧，
// 所以这里按 zstd frame magic (28 B5 2F FD) 切分后逐帧解压。
import { readFileSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const src = process.argv[2]
if (!src) {
  console.error('usage: node inspect-session.mjs <session.jsonl.zstd> [--grep kw] [--tail n] [--dump]')
  process.exit(2)
}

const buf = readFileSync(src)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

const offsets = []
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i)
}

const parts = []
let frameCount = 0
let cursor = 0
let pendingStart = offsets.length ? offsets[0] : 0
let idx = 0
while (idx < offsets.length) {
  const start = offsets[idx]
  const end = idx + 1 < offsets.length ? offsets[idx + 1] : buf.length
  try {
    parts.push(zstdDecompressSync(buf.subarray(start, end)))
    frameCount++
    idx++
  } catch {
    // 误判的 magic：把它并进下一帧
    idx++
    if (idx >= offsets.length) {
      try { parts.push(zstdDecompressSync(buf.subarray(start, buf.length))) ; frameCount++ } catch { }
    }
  }
}
if (offsets.length === 0) {
  parts.push(zstdDecompressSync(buf))
  frameCount = 1
}
void cursor
void pendingStart

const text = Buffer.concat(parts).toString('utf8')
const lines = text.split('\n').filter(Boolean)

console.error(`raw bytes: ${buf.length}`)
console.error(`zstd frames decoded: ${frameCount}`)
console.error(`decompressed bytes: ${Buffer.concat(parts).length}`)
console.error(`jsonl lines: ${lines.length}`)

const args = process.argv.slice(3)
const grep = args.includes('--grep') ? args[args.indexOf('--grep') + 1] : null
const tail = args.includes('--tail') ? Number(args[args.indexOf('--tail') + 1]) : 0
if (args.includes('--dump')) {
  const out = src.replace(/\.zstd$/, '.decoded.jsonl')
  writeFileSync(out, text)
  console.error(`decoded copy written: ${out}`)
}

const byType = new Map()
const errLines = []
const picked = []
for (let i = 0; i < lines.length; i++) {
  const s = lines[i]
  let obj = null
  try { obj = JSON.parse(s) } catch { }
  const type = obj?.type ?? obj?.kind ?? obj?.event ?? 'unparsed'
  byType.set(type, (byType.get(type) ?? 0) + 1)
  if (/"(error|failed|failure|abort|limit|exceeded|timeout)"\s*:/i.test(s)) errLines.push({ n: i + 1, type, s: s.slice(0, 500) })
  if (grep && s.includes(grep)) picked.push({ n: i + 1, s: s.slice(0, 800) })
}
if (tail > 0) for (let i = Math.max(0, lines.length - tail); i < lines.length; i++) picked.push({ n: i + 1, s: lines[i].slice(0, 900) })

console.log('=== event type counts ===')
for (const [k, v] of [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${String(v).padStart(7)}  ${k}`)
console.log(`\n=== error-like records: ${errLines.length} (last 20) ===`)
for (const e of errLines.slice(-20)) console.log(`#${e.n} [${e.type}] ${e.s}`)
if (picked.length) {
  console.log('\n=== selected ===')
  for (const o of picked) console.log(`#${o.n} ${o.s}`)
}
