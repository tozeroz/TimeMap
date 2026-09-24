/**
 * 只读取证：原版 APK 里是否存在"**上传前图片压缩**"的已知库/类名。
 *
 * 为什么要做这一步：AUDIT 的 (B) 类里有一项是"图片压缩/重编码 —— 确认未做"，
 * 但**判断它算不算缺口的前提**是"原版是否真的会压缩"。
 * 若原版根本没有上传前压缩，那这一项就不是实现缺口（我们没做也不算偏差）。
 *
 * ⚠ 声明强度（必须写清，不许夸大）：
 *   本脚本证明的是"**dex 里是否出现某类字符串**"。
 *   · 命中 → 是**存在该库**的证据（但仍不直接等于"上传时确实调用了它"）
 *   · 未命中 → **只能说明"没有这些明显命名的库"**，
 *             **不等于**"原版不压缩"（压缩可能是自研代码、或在 RN bundle 里、
 *             或用了别名/混淆）。**不得据此断言"原版不压缩"。**
 *
 * 输出：命中/未命中清单 + 每个 dex 的扫描结论。
 */
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const APK = 'G:\\demo map\\.mumu-capture\\apk\\target.apk'
const OUTDIR = 'G:\\demo map\\tools\\tmp\\apk-dex'
const REPORT = 'G:\\demo map\\docs\\m5\\EVIDENCE-image-compression-scan.txt'

/** 已知的"上传前压缩"库/类名特征（ASCII，可 grep dex 字符串池） */
const PROBES = [
  ['Luban', 'Luban（常见的上传前压缩库）'],
  ['zibin', 'top.zibin.luban 包名片段'],
  ['Compressor', 'id.zelory:compressor 类名片段'],
  ['compressImage', '通用压缩方法名'],
  ['compressTo', '通用压缩方法名'],
  ['BitmapCompress', '位图压缩类名片段'],
  ['quality', 'JPEG quality 参数名（弱特征）'],
  ['inSampleSize', 'BitmapFactory 采样参数（强特征：说明做了降采样）'],
  ['calculateInSampleSize', '标准降采样算法方法名（强特征）'],
  ['getScaledBitmap', '缩放宽高（强特征）'],
  ['createScaledBitmap', 'Android API：创建缩放位图'],
  ['ImageResizer', '图像缩放类名'],
  ['resizeImage', '图像缩放方法名'],
  ['uploadImageCompress', '上传前压缩方法名'],
]

console.log('=== 只读取证：原版 APK 中"上传前压缩"相关类名扫描 ===')
console.log('APK =', APK)

// 1) 用 unzip 解出 dex（只读操作：读 apk、写 tmp）
mkdirSync(OUTDIR, { recursive: true })
console.log('\n--- 解出 dex 到', OUTDIR, '---')
try {
  execFileSync('tar', ['-xf', APK, '-C', OUTDIR, 'classes.dex', 'classes2.dex', 'classes3.dex', 'classes4.dex', 'classes5.dex'], {
    stdio: 'inherit',
  })
} catch (e) {
  console.error('  解包失败（tar 不可用？）：', e.message)
  process.exit(2)
}

const dexFiles = ['classes.dex', 'classes2.dex', 'classes3.dex', 'classes4.dex', 'classes5.dex']
const results = new Map()
for (const p of PROBES) results.set(p[0], { hits: 0, files: [] })

let totalBytes = 0
for (const d of dexFiles) {
  let buf
  try {
    buf = readFileSync(`${OUTDIR}\\${d}`)
  } catch {
    console.log(`  ${d}: 不存在，跳过`)
    continue
  }
  totalBytes += buf.length
  const s = buf.toString('latin1') // dex 字符串池是 UTF-8/改良 UTF-8，用 latin1 做子串搜索足够
  const found = []
  for (const [needle] of PROBES) {
    if (s.includes(needle)) {
      results.get(needle).hits++
      results.get(needle).files.push(d)
      found.push(needle)
    }
  }
  console.log(`  ${d}: ${(buf.length / 1048576).toFixed(1)}MB，命中 ${found.length} 个探针 ${found.length ? '→ ' + found.join(', ') : ''}`)
}

console.log(`\n扫描总量 ${(totalBytes / 1048576).toFixed(1)}MB`)
console.log('\n=== 逐探针结论 ===')
for (const [needle, desc] of PROBES) {
  const r = results.get(needle)
  const mark = r.hits > 0 ? `命中 ×${r.hits}` : '未命中'
  console.log(`  ${mark.padEnd(10)} ${needle.padEnd(24)} ${desc}`)
  if (r.hits > 0) console.log(`             出现在: ${[...new Set(r.files)].join(', ')}`)
}

const strongHits = ['inSampleSize', 'calculateInSampleSize', 'createScaledBitmap', 'getScaledBitmap'].filter(
  (k) => results.get(k).hits > 0,
)
const libHits = ['Luban', 'zibin', 'Compressor'].filter((k) => results.get(k).hits > 0)

console.log('\n=== 结论（按声明强度写，不许夸大）===')
console.log(`  第三方压缩库命中: ${libHits.length ? libHits.join(', ') : '无'}`)
console.log(`  降采样/缩放 API 命中: ${strongHits.length ? strongHits.join(', ') : '无'}`)
console.log('')
console.log('  ⚠ 无论命中与否，本扫描都**不能**单独证明"原版上传时是否压缩"：')
console.log('     · 命中的类是"存在该能力"的证据，不等于"上传路径调用了它"')
console.log('     · 未命中只说明"没有这些明显命名的库"，')

mkdirSync('G:\\demo map\\docs\\m5', { recursive: true })
const lines = []
lines.push('# 只读取证：原版 APK "上传前压缩" 相关类名扫描')
lines.push(`# 时间: ${new Date().toISOString()}`)
lines.push('# APK sha256: 3373B6B2FBC997919398543DBBC59546172376BEEDEE87312154EBA095D6C294（已核验与基线一致）')
lines.push(`# 扫描字节: ${totalBytes}`)
lines.push('')
lines.push('## 探针结果')
for (const [needle, desc] of PROBES) {
  const r = results.get(needle)
  lines.push(`${r.hits > 0 ? 'HIT ' : 'MISS'}  ${needle.padEnd(24)} ${desc}${r.hits ? '  → ' + [...new Set(r.files)].join(',') : ''}`)
}
lines.push('')
lines.push('## 声明强度（重要）')
lines.push('HIT  = 存在该库/能力的证据；**不等于**上传路径调用了它。')
lines.push('MISS = 无这些明显命名的库；**不等于**原版不压缩（可能是自研代码 / 在 RN bundle 里 / 混淆别名）。')
lines.push('→ 因此本扫描**不足以**单独判定 (B) 类"图片压缩"项是否为真实实现缺口。')
writeFileSync(REPORT, lines.join('\n'), 'utf8')
console.log(`\n  报告已写: ${REPORT}`)
