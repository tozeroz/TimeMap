/**
 * I1 核实：`app/src/components/icons.tsx` 的 pathData 是否**逐字复制自原版 APK**
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么做这个（I1 队列第 5 条）
 * ════════════════════════════════════════════════════════════════════
 *   I1 原文列了 5 类"逐字复制自第三方 APK"的资产，其中第 5 类是：
 *     "`app/src/**` **其它**『按原版截图/资源复刻』的图标（**需逐个核对来源**）"
 *   而实测：
 *     · `icons-send.tsx`  **有** `ASSET_ORIGIN: COPIED_FROM_THIRD_PARTY_APK` 标记
 *     · `icons.tsx`（268 行，主图标集）**既无该标记、也未声明自绘** ← **待核实的对象**
 *
 * ════════════════════════════════════════════════════════════════════
 * 方法（机械比对，不靠肉眼）
 * ════════════════════════════════════════════════════════════════════
 *   本地有原版 APK 副本 `.mumu-capture/apk/target.apk`（176MB）
 *   ⇒ ① 从 APK 里取出**所有 vector drawable XML**（res 目录下的 xml 中带 `<path ... pathData=` 的）
 *     ⚠️ 写这段注释时我踩过一次坑：原本写的是"res 下**任意深度**的 xml"那种 glob 写法，
 *        里面的 ** 紧跟 / 构成了 星号+斜杠 序列 ⇒ **提前结束块注释** ⇒ 整段变代码。
 *        （本项目已多次踩过这类"注释里的星号斜杠序列"，故此处刻意用文字描述而非写出该 glob。）
 *      ② 规范化 pathData（去空白/统一大小写分隔）
 *      ③ 与 icons.tsx 里提取的每条 path 数据比对
 *   ⚠️ 只输出**匹配/不匹配的事实**，不下"抄了/没抄"的法律结论 —— 那是 Owner 的判断。
 *   ⚠️ 也不把 APK 解包到仓库里（避免把第三方资源落盘）：
 *      只读 zip 内条目，写出的**只有比对结果 JSON**。
 *
 * 用法：node scripts/m5/i1-icon-provenance-check.mjs [--limit N]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const APK = 'G:\\demo map\\.mumu-capture\\apk\\target.apk'
const ICONS = 'G:\\demo map\\app\\src\\components\\icons.tsx'
const ICONS_SEND = 'G:\\demo map\\app\\src\\components\\icons-send.tsx'
const OUT = 'G:\\demo map\\tools\\tmp\\i1-icon-provenance.json'

if (!existsSync(APK)) {
  console.error('FATAL 找不到原版 APK 副本：' + APK)
  process.exit(2)
}

// ── ① 列出 APK 里的 xml 条目（只列名，不解包）──────────────────────
console.log('=== ① 列出 APK 内的 xml 条目 ===')
let listing = ''
try {
  listing = execFileSync('C:\\Program Files\\Git\\usr\\bin\\unzip.exe', ['-Z1', APK], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (e) {
  console.error('FATAL unzip 失败：' + String(e && e.message))
  process.exit(2)
}
const xmlEntries = listing.split('\n').map((s) => s.trim()).filter((s) => s.toLowerCase().endsWith('.xml'))
console.log(`  APK 内 xml 条目 ${xmlEntries.length} 个`)

// ── ② 逐个取出含 pathData 的条目 ─────────────────────────────────
console.log('')
console.log('=== ② 提取 vector drawable 的 pathData（可能较慢）===')
const norm = (s) =>
  String(s)
    .replace(/[,\s]+/g, ' ')
    .replace(/\s*([a-zA-Z])\s*/g, '$1')
    .trim()
    .toLowerCase()

const apkPaths = new Map() // normalized pathData -> [entry names]
let scanned = 0
let withPath = 0
const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0
for (const entry of xmlEntries) {
  if (LIMIT && scanned >= LIMIT) break
  scanned++
  /* 只看 res/ 下的（drawable 资源都在那儿），跳过 manifest/资源表等 */
  if (!/^res\//i.test(entry)) continue
  let content = ''
  try {
    content = execFileSync('C:\\Program Files\\Git\\usr\\bin\\unzip.exe', ['-p', APK, entry], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch {
    continue
  }
  if (!content.includes('pathData')) continue
  withPath++
  for (const m of content.matchAll(/pathData\s*=\s*"([^"]+)"/g)) {
    const k = norm(m[1])
    if (k.length < 12) continue // 太短的无区分力
    if (!apkPaths.has(k)) apkPaths.set(k, [])
    if (apkPaths.get(k).length < 3) apkPaths.get(k).push(entry)
  }
}
console.log(`  扫描 ${scanned} 个条目；含 pathData 的 ${withPath} 个；收集到**去重后** pathData ${apkPaths.size} 条`)

// ── ③ 与我们的两个图标文件比对 ───────────────────────────────────
console.log('')
console.log('=== ③ 与我们的图标文件比对 ===')
function checkIcons(file, label) {
  if (!existsSync(file)) return { label, exists: false }
  const src = readFileSync(file, 'utf8')
  /* 我们的写法通常是把 path 数据放在 `d="..."` 或常量里；两种都抓 */
  const cands = new Set()
  for (const m of src.matchAll(/d\s*[:=]\s*['"`]([^'"`]{12,})['"`]/g)) cands.add(norm(m[1]))
  for (const m of src.matchAll(/['"`]([Mm][^'"`]{20,})['"`]/g)) cands.add(norm(m[1]))
  const hits = []
  for (const c of cands) if (apkPaths.has(c)) hits.push({ path: c.slice(0, 60) + '…', apkEntries: apkPaths.get(c) })
  return { label, exists: true, candidates: cands.size, matched: hits.length, hits }
}

const r1 = checkIcons(ICONS, 'icons.tsx')
const r2 = checkIcons(ICONS_SEND, 'icons-send.tsx')
for (const r of [r1, r2]) {
  if (!r.exists) {
    console.log(`  · ${r.label}: 文件不存在`)
    continue
  }
  console.log(`  · ${r.label}: 提取候选 path ${r.candidates} 条；**与原版 APK 逐字相同** ${r.matched} 条`)
  for (const h of r.hits.slice(0, 6)) console.log(`      ↳ ${h.path}\n        APK 条目: ${h.apkEntries.join(', ')}`)
}

const result = {
  methodology:
    '从原版 APK 副本内联提取所有 res/**/*.xml 里的 pathData，规范化后与我们图标文件的 path 数据逐字比对。只报告事实，不下法律结论。',
  apk: { path: APK.replace('G:\\demo map\\', ''), xmlEntries: xmlEntries.length, withPathData: withPath, uniquePathData: apkPaths.size },
  icons: r1,
  iconsSend: r2,
  limits: [
    '规范化会忽略空白/逗号差异 ⇒ "相同"= 几何写法一致，不保证字节一致',
    '只覆盖 <path pathData=...>；PNG/WebP 类位图资源不在本比对内',
    '我们若用 CSS/SVG 之外的画法（canvas 等）也不在覆盖内',
  ],
  writtenAt: new Date().toISOString(),
}
writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)
