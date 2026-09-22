#!/usr/bin/env node
/**
 * 基线全貌清单（`BASELINE_INVENTORY`）—— 防止"窄搜索 → 假结论"的**机械前置**
 *
 * ## 为什么需要它（本会话已踩两次的同一类错误）
 *   ① 我用 `Select-String -Path 'app\src\**\*.tsx'` 搜"谁引用了 ProfileEditScreen" ——
 *      **PowerShell 的目录通配不递归**，得到"零命中"，于是**错误地**判断该页面是死代码。
 *   ② 我在 WO#15 计划里写"mock 6 个地点里只有阳光操场有基线证据" ——
 *      依据是**搜这 6 个地名串**的命中数。而 `docs/original-baseline/` 下其实有
 *      `trident-map/`、`poi-search/`、`poi-detail/`、`supplements/schools.json` 等**结构化基线**，
 *      只是**地名串没出现在里面**（我需要读的是"地图页基线有什么"，而不是"这些串在哪"）。
 *
 *   ⇒ 纪律：**零/稀缺命中只有在"搜索范围被证明完整"之后才有证据价值。**
 *     本脚本的作用就是**把搜索范围本身摆出来**：先告诉你"基线一共有哪些"，
 *     再让你去下"有/没有"的结论。
 *
 * ## 它做什么
 *   1. 枚举 `docs/original-baseline/screens/*`：屏幕 id、标题、各 state 的 status、
 *      证据文件（标注**是否存在**）、是否有 blocked_reason
 *   2. 枚举 `docs/original-baseline/supplements/*.json`
 *   3. 支持 `--grep <关键词>`：在**全部**基线 JSON 的**全文**里搜（而不是只搜文件名或某几个串），
 *      并**同时报告"扫过了几个文件"** —— 让"零命中"有明确的分母
 *   4. 支持 `--files`：列出每个屏幕目录下的所有文件（截图也在内，便于知道"有图可看"）
 *
 * ⚠️ 边界（必须声明，避免又造出"看起来完整其实不完整"的东西）：
 *   · 它只覆盖 `docs/original-baseline/` 这一处；其他目录（如 docs/*.md 的手写观察笔记、
 *     docs/m5/*）**不在**本清单内。所以"清单里没有"**不等于**"全仓库没有"。
 *   · 它不做视觉核对 —— 截图是否存在 ≠ 是否被看过。
 *
 * 用法：
 *   node scripts/m5/baseline-inventory.mjs
 *   node scripts/m5/baseline-inventory.mjs --grep 标记
 *   node scripts/m5/baseline-inventory.mjs --files
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const ROOT = 'docs/original-baseline'
const SCREENS = join(ROOT, 'screens')
const SUPPS = join(ROOT, 'supplements')

const argv = process.argv.slice(2)
const grepIdx = argv.indexOf('--grep')
const GREP = grepIdx >= 0 ? argv[grepIdx + 1] : null
const SHOW_FILES = argv.includes('--files')

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    return { __parse_error: String(e && e.message) }
  }
}

if (!existsSync(SCREENS)) {
  console.error(`FATAL 找不到 ${SCREENS}（请在仓库根目录运行）`)
  process.exit(2)
}

/** 固定宽度的表格行（中文字符按 2 显示宽度估算，仅用于对齐可读性） */
function printfRow(a, b, c, d, e, f = '') {
  const w = (s, n) => {
    let len = 0
    for (const ch of String(s)) len += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1
    let out = String(s)
    while (len < n) { out += ' '; len++ }
    return out.slice(0, Math.max(0, out.length))
  }
  console.log(`  ${w(a, 20)} ${w(b, 26)} ${w(c, 24)} ${w(d, 3)} ${w(e, 8)} ${f}`)
}

/** 收集所有屏幕（含非 baseline.json 的目录，如 INDEX.md 那种） */
const screenDirs = readdirSync(SCREENS)
  .filter((n) => statSync(join(SCREENS, n)).isDirectory())
  .sort()

const rows = []
const allFiles = []
for (const dir of screenDirs) {
  const abs = join(SCREENS, dir)
  const files = readdirSync(abs).sort()
  for (const f of files) allFiles.push(join(abs, f))
  const bj = files.includes('baseline.json') ? readJson(join(abs, 'baseline.json')) : null
  const states = bj && bj.states ? bj.states : {}
  const observed = Object.entries(states)
    .filter(([, v]) => v && v.status === 'observed')
    .map(([k]) => k)
  const notRepro = Object.entries(states)
    .filter(([, v]) => v && v.status === 'not_reproducible')
    .map(([k]) => k)
  rows.push({
    dir,
    title: bj && bj.title ? bj.title : '(无 baseline.json)',
    route: bj && bj.target_route ? bj.target_route : '',
    observed,
    notRepro,
    blocked: bj && bj.blocked_reason ? bj.blocked_reason : null,
    jsonOk: !!bj && !bj.__parse_error,
    files,
  })
}

const suppFiles = existsSync(SUPPS) ? readdirSync(SUPPS).filter((f) => f.endsWith('.json')).sort() : []

/*
  ⭐ 追踪 `supersedes`（这是本工具的**第二个关键作用**）

  ## 为什么必须有
    我在 WO#15 里犯了本回合第三次同族错误：
      只读 `screens/poi-detail/baseline.json`（写着 states 全部 not_reproducible + blocked_reason），
      就下结论 `ORIGINAL_POI_DETAIL_STRUCTURE: BLOCKED`；
      而 `supplements/poi-detail.json` **明确 supersedes 它**（normal: not_reproducible → observed）。
    ⇒ 所以"清单"不能只列每份 baseline.json 自己的话，**必须把"谁被谁取代了"也摆出来**。
      否则工具本身会复现我的错误 —— 一个"看起来完整"的清单比没有清单更危险。

  ## 实现
    · 扫 supplements/*.json 的 `supersedes.file`（形如 "screens/poi-detail/baseline.json"）
    · 反向映射：screen_id → 取代它的 supplement 文件名 + from/to 状态变更
    · 在屏幕表里加一列 SUPERSEDED，并在末尾单独列出所有取代关系
*/
const supMap = new Map()
for (const f of suppFiles) {
  const j = readJson(join(SUPPS, f))
  const s = j && j.supersedes
  if (!s || !s.file) continue
  // "screens/poi-detail/baseline.json" → "poi-detail"
  const m = String(s.file).match(/^screens\/([^/]+)\//)
  const key = m ? m[1] : String(s.file)
  if (!supMap.has(key)) supMap.set(key, [])
  supMap.get(key).push({ supplement: f, field: s.field, from: s.from, to: s.to })
}

console.log('=== 基线全貌（BASELINE_INVENTORY）===')
console.log(`扫描范围：${SCREENS}/*（${screenDirs.length} 个屏幕目录） + ${SUPPS}/*.json（${suppFiles.length} 个补采）`)
console.log(`⚠️ 边界：本清单**只覆盖 ${ROOT}/**。其他目录（手写观察笔记、docs/m5 等）不在内 ——`)
console.log(`   "清单里没有"**不等于**"全仓库没有"。`)
console.log()

console.log('--- 屏幕（title / 已观测态 / 证据文件数 / blocked / ⭐是否被取代）---')
printfRow('screen_id', 'title', 'observed', 'ev', 'blocked?', 'SUPERSEDED')
for (const r of rows) {
  const evCount = r.files.filter((f) => /\.(png|jpg|jpeg)$/i.test(f)).length
  const sup = supMap.get(r.dir)
  printfRow(
    r.dir,
    r.title.slice(0, 26),
    r.observed.join(',') || '（无 observed）',
    String(evCount),
    r.blocked ? 'YES' : '',
    sup ? `← ${sup.map((x) => x.supplement).join(',')}` : '',
  )
}

console.log()
console.log('--- ⭐ supersedes 关系（**不要把被取代的 baseline.json 当现状**）---')
if (supMap.size === 0) {
  console.log('  （无）')
} else {
  for (const [screen, list] of [...supMap.entries()].sort()) {
    for (const x of list) {
      console.log(`  ${screen}  ← ${x.supplement}`)
      if (x.field) console.log(`      字段 ${x.field}: ${x.from ?? '?'} → **${x.to ?? '?'}**`)
    }
  }
  console.log('  ⚠️ 结论：上表中被取代的屏幕，其「已观测态 / blocked」列**只是旧值**；')
  console.log('     必须以上面的 from → to 为准。（这正是我先前误判 poi-detail 为 BLOCKED 的原因。）')
}

console.log()
console.log('--- 结构化补采（supplements）---')
for (const f of suppFiles) {
  const j = readJson(join(SUPPS, f))
  const verdict = j.verdict ? ` verdict=${j.verdict}` : ''
  const extra = j.additional_finding ? ` + ${String(j.additional_finding).slice(0, 50)}` : ''
  console.log(`  ${f}${verdict}${extra}`)
}

if (SHOW_FILES) {
  console.log()
  console.log('--- 每个屏幕目录的文件 ---')
  for (const r of rows) console.log(`  ${r.dir}/: ${r.files.join(', ')}`)
  console.log(`  supplements/: ${suppFiles.join(', ')}`)
}

if (GREP) {
  console.log()
  console.log(`=== --grep "${GREP}" 全文检索（**关键：同时报告分母**）===`)
  const targets = [
    ...allFiles.filter((f) => f.endsWith('.json')),
    ...suppFiles.map((f) => join(SUPPS, f)),
  ]
  let scanned = 0
  let hitFiles = 0
  let hitLines = 0
  for (const f of targets) {
    if (!existsSync(f)) continue
    scanned++
    const text = readFileSync(f, 'utf8')
    if (!text.includes(GREP)) continue
    hitFiles++
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(GREP)) {
        hitLines++
        console.log(`  ${f}:${i + 1}: ${lines[i].trim().slice(0, 110)}`)
      }
    }
  }
  console.log()
  console.log(`  扫过 ${scanned} 个 JSON 文件（分母）｜命中 ${hitFiles} 个文件 / ${hitLines} 行`)
  console.log('  ⚠️ 若命中为 0：只能得出"**在这 %d 个 JSON 里**没有"，', scanned)
  console.log('     不能得出"原版没有这件事" —— 截图内容（未做视觉核对）与手写笔记都不在本次范围内。')
}
