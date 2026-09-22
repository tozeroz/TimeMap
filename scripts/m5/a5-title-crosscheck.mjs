/**
 * A5 机械切片：把**每个基线屏的 title** 与我们实现里的渲染标题做逐条核对
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么从 `title` 开始（不是随意选的）
 * ════════════════════════════════════════════════════════════════════
 *   Round 261 的 `FIDELITY-GAP-AUDIT-closed-screens-vs-baseline.md` 逐条核对了 4 个屏
 *   （feed-list / message / group / at-panel），**第一个查出的偏差就是"标题缺失"**
 *   （原版顶部有「校园圈」，我们当时没渲染）。
 *   ⇒ 而那份审计**只覆盖了 4/24 个屏** ⇒ 其余 20 个屏从未做过这种逐条核对。
 *   ⇒ `title` 是基线的**逐字记录**、也是最容易机械核对的字段 ⇒ 作为 A5 的**第一刀**。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️ 本脚本的判据与其**边界**（避免把"没搜到字符串"当成"实现错了"）
 * ════════════════════════════════════════════════════════════════════
 *   它做的是：在 `app/src` 里搜基线 title 的**字符串是否出现**。
 *   ⇒ 因此：
 *     · **命中** ⇒ 只能说明"该字符串在源码里存在"，**不等于**"渲染在正确位置/样式"
 *       （那是像素/布局层的事，需要截图比对）
 *     · **未命中** ⇒ 是**值得人工核对的线索**，但**不等于** DEVIATION
 *       （标题可能来自 API、来自常量表、或由变量拼接）
 *   ⇒ 所以本脚本输出的是 **CLUE / OK / NEEDS_HUMAN**，**不**直接下 DEVIATION 结论。
 *     这与项目纪律一致：**测量不等于解释**（pixel analyzer 的同一原则）。
 *
 * 用法：node scripts/m5/a5-title-crosscheck.mjs [--json out.json]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'

const BASE = 'G:\\demo map\\docs\\original-baseline\\screens'
const SRC = 'G:\\demo map\\app\\src'
const OUT = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : 'G:\\demo map\\tools\\tmp\\a5-title-crosscheck.json'

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = dir + '\\' + e
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(e)) acc.push(p)
  }
  return acc
}
const files = walk(SRC)
const sources = files.map((f) => ({ path: f.replace(SRC, 'src').replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }))

const rows = []
for (const d of readdirSync(BASE)) {
  const dir = BASE + '\\' + d
  if (!statSync(dir).isDirectory()) continue
  const jp = dir + '\\baseline.json'
  if (!existsSync(jp)) continue
  let j
  try {
    j = JSON.parse(readFileSync(jp, 'utf8'))
  } catch {
    rows.push({ screen: d, status: 'JSON_PARSE_ERROR' })
    continue
  }
  const title = typeof j.title === 'string' ? j.title.trim() : null
  const route = j.target_route || null
  if (!title) {
    rows.push({ screen: d, route, title: null, status: 'NO_TITLE_IN_BASELINE' })
    continue
  }
  /* 在源码里找该标题字符串（含常见变体：'标题' / "标题" / >标题<） */
  const hits = sources.filter((s) => s.text.includes(title)).map((s) => s.path)
  /* 因为「公告」这类短标题容易撞词，额外区分"作为独立字符串出现" */
  const quoted = sources.filter(
    (s) => s.text.includes(`'${title}'`) || s.text.includes(`"${title}"`) || s.text.includes(`>${title}<`) || s.text.includes(`>${title}\n`),
  ).map((s) => s.path)
  rows.push({
    screen: d,
    route,
    title,
    anyHit: hits.length > 0,
    quotedHit: quoted.length > 0,
    hitFiles: hits.slice(0, 5),
    quotedFiles: quoted.slice(0, 5),
    status: quoted.length > 0 ? 'OK（标题以独立字符串出现）' : hits.length > 0 ? 'CLUE（仅子串命中，需人工看是否真渲染）' : 'NEEDS_HUMAN（源码里没搜到该标题）',
  })
}

const summary = {
  total: rows.length,
  ok: rows.filter((r) => r.status.startsWith('OK')).length,
  clue: rows.filter((r) => r.status.startsWith('CLUE')).length,
  needsHuman: rows.filter((r) => r.status.startsWith('NEEDS_HUMAN')).length,
  noTitle: rows.filter((r) => r.status === 'NO_TITLE_IN_BASELINE').length,
  parseErr: rows.filter((r) => r.status === 'JSON_PARSE_ERROR').length,
}

console.log('=== 基线屏 title 逐条核对（A5 机械切片）===')
console.log(`  基线目录 ${summary.total} 个：OK ${summary.ok} ／ CLUE ${summary.clue} ／ NEEDS_HUMAN ${summary.needsHuman} ／ 基线无 title ${summary.noTitle}`)
console.log('')
for (const r of rows) {
  const mark = r.status.startsWith('OK') ? '✅' : r.status.startsWith('CLUE') ? '🔎' : r.status.startsWith('NEEDS_HUMAN') ? '⚠️' : '·'
  const t = r.title ? `「${r.title}」` : '(无)'
  console.log(`  ${mark} ${r.screen.padEnd(18)} ${t.padEnd(14)} ${r.status}`)
  if (r.status.startsWith('NEEDS_HUMAN') && r.anyHit) console.log(`        （仅子串命中：${r.hitFiles.join(', ')}）`)
}
console.log('')
console.log('⚠️ 边界：本脚本只做**字符串搜索** —— 命中 ≠ 渲染在正确位置；未命中 ≠ 一定是偏差（可能来自 API/拼接）。')
console.log('   NEEDS_HUMAN 是**待人工核对的线索**，不是 DEVIATION 结论。')

writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)
