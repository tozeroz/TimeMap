/**
 * I1 核实（正解版）：用 **aapt2** 把原版 APK 里所有 vector 的 pathData 解出来，
 * 与我们图标文件里的 path 数据做逐字比对
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么有这一版（前一版**方法失败**，这是修正）
 * ════════════════════════════════════════════════════════════════════
 *   前一版用 unzip + 明文正则抓 `pathData="…"` ⇒ "1136 个文件含该串，**0 条值可取**"。
 *   根因：APK 里 vector drawable 是 **AXML 二进制**（值走字符串池 + 索引引用）。
 *   ⇒ 那个"0 匹配"是**仪器没工作**，绝不能读成"我们干净"。
 *   正解：`aapt2 dump xmltree`（该方法就写在 `icons-send.tsx` 的来源注释里）。
 *   ⚠️ 环境里 aapt2 的位置：`G:\android-sdk\build-tools\35.0.0\aapt2.exe`
 *      （从 `app/android/local.properties` 的 `sdk.dir` 找到 —— 我一开始没找到是因为
 *        只在 PATH/环境变量里搜，**忘了 Gradle 用的是 sdk.dir**。）
 *
 * ════════════════════════════════════════════════════════════════════
 * 方法
 * ════════════════════════════════════════════════════════════════════
 *   ① `aapt2 dump resources <apk>` 拿到**资源表**（含每个 drawable 的 res 路径）
 *   ② 对每个 xml 资源跑 `aapt2 dump xmltree --file <path> <apk>`，抓 pathData 值
 *   ③ 规范化后与我们图标文件里的 path 数据逐字比对
 *   ⚠️ 只报告**事实**（哪条命中、命中哪个资源），**不**下法律结论 —— 那是 Owner 的判断。
 *   ⚠️ 不把第三方资源落盘进仓库：只写比对结果 JSON 到 tools/tmp。
 *
 * 用法：node scripts/m5/i1-icon-provenance-aapt2.mjs [--max N]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const APK = 'G:\\demo map\\.mumu-capture\\apk\\target.apk'
const AAPT2 = 'G:\\android-sdk\\build-tools\\35.0.0\\aapt2.exe'
const FILES = [
  { label: 'icons.tsx', path: 'G:\\demo map\\app\\src\\components\\icons.tsx' },
  { label: 'icons-send.tsx', path: 'G:\\demo map\\app\\src\\components\\icons-send.tsx' },
]
const OUT = 'G:\\demo map\\tools\\tmp\\i1-icon-provenance-aapt2.json'

for (const p of [APK, AAPT2]) {
  if (!existsSync(p)) {
    console.error('FATAL 缺少 ' + p)
    process.exit(2)
  }
}

const norm = (s) =>
  String(s)
    .replace(/[,\s]+/g, ' ')
    .replace(/\s*([a-zA-Z])\s*/g, '$1')
    .trim()
    .toLowerCase()

// ── ① 资源表：找出所有 xml drawable ────────────────────────────────
console.log('=== ① aapt2 dump resources（取资源路径）===')
let resOut = ''
try {
  resOut = execFileSync(AAPT2, ['dump', 'resources', APK], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
} catch (e) {
  console.error('FATAL aapt2 dump resources 失败：' + String(e && e.message))
  process.exit(2)
}
const resPaths = new Set()
/*
  ⚠️ 这里修过一次**真实的解析 bug**（自检抓出来的）：
    我原以为资源表里是 `-> res/xxx.xml` 的形式，于是写了 /->\s*(res\/[^\s]+\.xml)/g
    ⇒ 命中 **0** 个 ⇒ 整条比对链空转 ⇒ "0 匹配"（**又一次"仪器没工作"**）。
    幸亏我加的第 ④ 步自检（"icons-send 已知是复制的 ⇒ 必须 ≥1 命中"）把它抓出来了。
  真实格式（实测）：        () (file) res/vp1.xml type=XML
*/
for (const m of resOut.matchAll(/\(file\)\s+(res\/[^\s]+\.xml)/g)) resPaths.add(m[1])
console.log(`  资源表里 xml 条目 ${resPaths.size} 个`)

// ── ② 逐个 dump xmltree，抓 pathData ──────────────────────────────
console.log('')
console.log('=== ② aapt2 dump xmltree（逐个解 vector）===')
const MAX = process.argv.includes('--max') ? Number(process.argv[process.argv.indexOf('--max') + 1]) : 0
const apkPaths = new Map() // normalized pathData -> [res paths]
let done = 0
let withPath = 0
const targets = [...resPaths].sort()
for (const rp of targets) {
  if (MAX && done >= MAX) break
  done++
  let out = ''
  try {
    out = execFileSync(AAPT2, ['dump', 'xmltree', '--file', rp, APK], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  } catch {
    continue
  }
  if (!out.includes('pathData')) continue
  withPath++
  /* xmltree 的形态： A: ...:pathData(0x01010405)="M18,0L38,0…" (Raw: "…") */
  for (const m of out.matchAll(/:pathData\([^)]*\)="([^"]+)"/g)) {
    const k = norm(m[1])
    if (k.length < 12) continue
    if (!apkPaths.has(k)) apkPaths.set(k, [])
    if (apkPaths.get(k).length < 3) apkPaths.get(k).push(rp)
  }
  if (done % 200 === 0) console.log(`    …已处理 ${done}/${targets.length}`)
}
console.log(`  处理 ${done} 个 xml 资源；含 pathData 的 ${withPath} 个；去重后 pathData **${apkPaths.size}** 条`)

// ── ③ 与我们图标文件比对 ─────────────────────────────────────────
console.log('')
console.log('=== ③ 与我们的图标文件逐字比对 ===')
function checkOne(file) {
  if (!existsSync(file.path)) return { label: file.label, exists: false }
  const src = readFileSync(file.path, 'utf8')
  const cands = new Set()
  for (const m of src.matchAll(/d\s*[:=]\s*['"`]([^'"`]{12,})['"`]/g)) cands.add(norm(m[1]))
  for (const m of src.matchAll(/['"`]([Mm][^'"`]{20,})['"`]/g)) cands.add(norm(m[1]))
  const hits = []
  for (const c of cands) if (apkPaths.has(c)) hits.push({ path: c, apkResources: apkPaths.get(c) })
  return { label: file.label, exists: true, candidates: cands.size, matched: hits.length, hits }
}
const results = FILES.map(checkOne)
for (const r of results) {
  if (!r.exists) {
    console.log(`  · ${r.label}: 文件不存在`)
    continue
  }
  console.log(`  · ${r.label}: 候选 path ${r.candidates} 条；**与原版 APK 逐字相同** ${r.matched} 条`)
  for (const h of r.hits.slice(0, 8)) {
    console.log(`      ↳ ${h.path.slice(0, 56)}…`)
    console.log(`        APK 资源: ${h.apkResources.join(', ')}`)
  }
}

// ── ④ 自检：icons-send 的已知事实必须命中（否则说明方法仍不对）────
console.log('')
console.log('=== ④ ⭐ 方法自检（防止"仪器没工作"重演）===')
const known = norm('M18,0L38,0A18,18 0,0 1,56 18L18,0L38,0A18,18 0,0 1,56 18')
const send = results.find((r) => r.label === 'icons-send.tsx')
const sendHits = send && send.exists ? send.matched : 0
console.log(`  icons-send.tsx 命中数 = ${sendHits}（**已知它逐字复制自 res/JA.xml ⇒ 必须 ≥ 1**）`)
const selfCheck = sendHits >= 1 ? 'PASS' : 'FAIL'
console.log(`  ⇒ 方法自检: **${selfCheck}**`)

const result = {
  methodology:
    'aapt2 dump resources 取资源路径 → aapt2 dump xmltree 逐个数 pathData → 规范化后与我们图标文件逐字比对。只报事实，不下法律结论。',
  aapt2: AAPT2.replace('G:\\', 'G:/'),
  apk: { path: APK.replace('G:\\demo map\\', ''), xmlResources: resPaths.size, withPathData: withPath, uniquePathData: apkPaths.size },
  results,
  selfCheck: { iconsSendMustMatch: true, iconsSendMatched: sendHits, verdict: selfCheck },
  limits: [
    '规范化忽略空白/逗号 ⇒ "相同"= 几何写法一致，不保证字节一致',
    '只覆盖 <path pathData=...>；位图资源（PNG/WebP）不在内',
    '我们若用非 SVG 画法（canvas 等）不在覆盖内',
  ],
  writtenAt: new Date().toISOString(),
}
writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)
