/**
 * A5 机械切片（**第二版**，判据更精确）：从 `interactions` 里提取**屏上文字**声明并核对
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️ 为什么推翻第一版判据（如实记录一次自我纠正）
 * ════════════════════════════════════════════════════════════════════
 *   第一版拿基线的 `title` 字段去搜源码，得到 11 个 `NEEDS_HUMAN`。
 *   ⇒ 但复核后发现：**`title` 很多是"屏幕的描述"，不是"屏上文字"** ——
 *     例如「校园广场（主容器默认 tab）」「地图页（底部 tab 3）」「登录（选择方式）」
 *     「发布（相机）」「新手引导（昵称）」…… 这些**本来就不该在屏上出现**。
 *   ⇒ 所以那 11 个里大部分是**我的判据错**，不是实现错。
 *     这与项目里反复出现的教训同型：**"我最初的判断"不是证据**。
 *
 * ════════════════════════════════════════════════════════════════════
 * 第二版的判据（更贴近证据）
 * ════════════════════════════════════════════════════════════════════
 *   基线里**真正的屏上文字声明**出现在 `interactions`／`navigation` 的描述里，
 *   形如：
 *     "顶部「校园圈」+「北京交通大学 ▼」+ 左上关闭"
 *     "中央：网络错误图标 + 「网络不给力，点击刷新试试」+ 刷新按钮"
 *     "弹窗叠在校园广场上：标题 + 版本说明 +「取消」「立即更新」"
 *   ⇒ 本脚本用「」/ “” 引号把**被明确引用的字符串**抽出来，逐个搜源码。
 *     ⚠️ 仍然只是**字符串搜索**：
 *        · 命中 ⇒ 该文字在源码里存在（**不等于**渲染位置/样式正确）
 *        · 未命中 ⇒ **待人工核对的线索**（可能来自 API、常量表、或拼接）
 *   ⇒ 输出 `FOUND / CLUE / NEEDS_HUMAN`，**不**直接下 DEVIATION 结论。
 *
 * 用法：node scripts/m5/a5-quoted-text-crosscheck.mjs [--json out.json]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'

const BASE = 'G:\\demo map\\docs\\original-baseline\\screens'
const SRC = 'G:\\demo map\\app\\src'
const OUT = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : 'G:\\demo map\\tools\\tmp\\a5-quoted-crosscheck.json'

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = dir + '\\' + e
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(e)) acc.push(p)
  }
  return acc
}
const sources = walk(SRC).map((f) => ({
  path: f.replace(SRC, 'src').replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}))

/** 抽取「」里的字符串（项目基线里屏上文字都用「」引用） */
function quoted(str) {
  const out = []
  for (const m of String(str).matchAll(/「([^」]+)」/g)) {
    const s = m[1].trim()
    if (s) out.push(s)
  }
  return out
}

/**
 * ⚠️ 过滤掉**明显不是屏上文字**的引用（避免又犯第一版那种判据错）：
 *   · 含"（"或"／"或"/"的描述性括注，如「校园广场（主容器默认 tab）」
 *   · 纯动作短语里常见的"左上关闭""底部 tab"等
 *   · 长度 > 12 且含"、" 的描述句
 */
function looksLikeUiText(s) {
  if (/[（(]/.test(s)) return false
  if (s.length > 14) return false
  if (/tab\s*\d|左上|右上|底部|顶部|点击|进入|返回上一页/.test(s) && s.length > 6) return false
  return true
}

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
    continue
  }
  const declared = new Set()
  for (const k of ['interactions', 'navigation']) {
    const v = j[k]
    for (const s of Array.isArray(v) ? v : v ? [v] : []) {
      for (const q of quoted(s)) if (looksLikeUiText(q)) declared.add(q)
    }
  }
  const checks = [...declared].map((text) => {
    const quotedHit = sources.filter(
      (s) => s.text.includes(`'${text}'`) || s.text.includes(`"${text}"`) || s.text.includes(`>${text}<`),
    ).map((s) => s.path)
    const anyHit = sources.filter((s) => s.text.includes(text)).map((s) => s.path)
    return {
      text,
      status: quotedHit.length > 0 ? 'FOUND' : anyHit.length > 0 ? 'CLUE' : 'NEEDS_HUMAN',
      files: (quotedHit.length ? quotedHit : anyHit).slice(0, 3),
    }
  })
  rows.push({ screen: d, route: j.target_route || null, checks })
}

const all = rows.flatMap((r) => r.checks)
const summary = {
  screens: rows.length,
  declaredTexts: all.length,
  found: all.filter((c) => c.status === 'FOUND').length,
  clue: all.filter((c) => c.status === 'CLUE').length,
  needsHuman: all.filter((c) => c.status === 'NEEDS_HUMAN').length,
}

console.log('=== A5 机械切片 v2：`interactions`/`navigation` 里**被明确引用**的屏上文字 vs 源码 ===')
console.log(
  `  基线屏 ${summary.screens} 个｜抽到屏上文字 ${summary.declaredTexts} 条：FOUND ${summary.found} ／ CLUE ${summary.clue} ／ NEEDS_HUMAN ${summary.needsHuman}`,
)
console.log('')
for (const r of rows) {
  if (r.checks.length === 0) continue
  console.log(`  ── ${r.screen} ──`)
  for (const c of r.checks) {
    const mark = c.status === 'FOUND' ? '✅' : c.status === 'CLUE' ? '🔎' : '⚠️'
    console.log(`    ${mark} 「${c.text}」 ${c.status}${c.files.length ? '  ' + c.files.join(', ') : ''}`)
  }
}
console.log('')
console.log('⚠️ 边界（必须随结论一起引用）：')
console.log('   · 只做**字符串搜索** —— FOUND ≠ 渲染位置/样式正确；NEEDS_HUMAN ≠ 一定是偏差')
console.log('   · 「」抽取依赖基线作者的引用习惯；未被「」引用的屏上文字**不在**本切片覆盖内')
console.log('   · 本切片**只覆盖**可机械化的"文字是否存在"这一类；布局/颜色/间距**不在此列**')

writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2), 'utf8')
console.log('')
console.log('  已写出 ' + OUT)
