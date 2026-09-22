#!/usr/bin/env node
/**
 * 基线全貌清单（`BASELINE_INVENTORY`）—— 防止"读错来源 / 窄搜索 → 假结论"的**机械前置**
 *
 * ## 它为什么存在（本会话已踩过多次的同一类错误，逐条记下）
 *   ① `Select-String -Path 'app\src\**\*.tsx'` —— **PowerShell 目录通配不递归** → 假零命中
 *      → 我错误地把一个活页面判成死代码。
 *   ② 用 solution 配置跑 `tsc --noEmit` → **0 错误**，而它其实**一个文件都没检查**。
 *   ③ WO#15 计划里"mock 6 个地点只有阳光操场有基线证据" —— 依据是**搜 6 个地名串**；
 *      而 `docs/original-baseline/` 下有**结构化基线**（trident-map / poi-search / supplies）。
 *   ④ ⭐ **本工具第一版自己就犯了这个错**：它只枚举 `screens/<id>/baseline.json`（**更早的快照**），
 *      于是把 6 屏报成 "blocked / 未观测"，让我发出**过度警报**：
 *        「6 屏状态已被补采取代 ⇒ 既有结论可能过期」。
 *      而权威索引 `manifest.json` 里这些屏早已是 `observed`；
 *      `docs/m3/EVIDENCE-PROVENANCE-AUDIT.md:98` 也早写明
 *        「baseline coverage：**22 observed / 0 evidence-blocked**，已由 Preflight 定案、不再变」。
 *      ⇒ 真相是：**`screens/<id>/baseline.json` 是更早的快照，权威状态在
 *        `manifest.json`（索引）+ `supplements/` 下的 JSON（恢复记录）**。我读错了文件。
 *
 *   ⇒ 统一纪律：**下"没有/未知/BLOCKED"这类否定结论之前，必须先证明
 *     （a）搜索范围完整、（b）读的是**权威**来源、（c）没有更新的记录取代它。**
 *
 * ## 因此本工具的做法
 *   · **主表来自权威索引 `manifest.json`**（含 `expected_screen_count`）
 *   · 同时读每屏 `baseline.json`，**逐状态对比**；不一致就标 **MISMATCH**
 *     —— 这才是真正有价值的信号（= 存在一份过期快照），而不是"又发现了一堆 blocked"
 *   · 追踪 `supplements/` 下的 JSON 的 `supersedes`（解释快照为何过期）
 *   · `--grep <词>`：在**全部 JSON** 里全文检索并**打印分母**（让"零命中"有分母）
 *
 * ## ⚠️ 边界（必须声明，否则又会造出"看起来完整其实不完整"的东西）
 *   · 只覆盖 `docs/original-baseline/**`。其他目录（手写观察笔记 docs/*.md、docs/m5 等）**不在内** ——
 *     "清单里没有"**不等于**"全仓库没有"。
 *   · **不做视觉核对**：截图存在 ≠ 看过。凡视觉细节仍需 `NOT_EVALUATED`，除非另有可用图像通道。
 *
 * 用法：
 *   node scripts/m5/baseline-inventory.mjs
 *   node scripts/m5/baseline-inventory.mjs --grep 标记
 *   node scripts/m5/baseline-inventory.mjs --files
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

/** 固定宽度表格行（中日韩字符按 2 宽估算，仅用于对齐） */
function printfRow(cols, widths) {
  const out = cols.map((c, i) => {
    let len = 0
    for (const ch of String(c)) {
      len += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1
    }
    let s = String(c)
    while (len < widths[i]) { s += ' '; len++ }
    return s
  })
  console.log('  ' + out.join(' '))
}

// ---------- 权威索引 ----------
const MANIFEST_PATH = join(ROOT, 'manifest.json')
const manifest = existsSync(MANIFEST_PATH) ? readJson(MANIFEST_PATH) : null
if (!manifest || !Array.isArray(manifest.screens)) {
  console.error(`FATAL 找不到可用的 ${MANIFEST_PATH}（权威索引）—— 本工具拒绝在缺少权威来源时给出状态`)
  process.exit(2)
}
const auth = new Map(manifest.screens.map((s) => [s.id, s]))

// ---------- 目录（用于发现"索引里没有/多出来"的屏） ----------
const dirs = readdirSync(SCREENS).filter((n) => statSync(join(SCREENS, n)).isDirectory()).sort()
const suppFiles = existsSync(SUPPS) ? readdirSync(SUPPS).filter((f) => f.endsWith('.json')).sort() : []

// ---------- supersedes 追踪 ----------
const supMap = new Map()
for (const f of suppFiles) {
  const j = readJson(join(SUPPS, f))
  const s = j && j.supersedes
  if (!s || !s.file) continue
  const m = String(s.file).match(/^screens\/([^/]+)\//)
  const key = m ? m[1] : String(s.file)
  if (!supMap.has(key)) supMap.set(key, [])
  supMap.get(key).push({ supplement: f, field: s.field, from: s.from, to: s.to })
}

console.log('=== 基线全貌（BASELINE_INVENTORY）===')
console.log(`权威索引：${MANIFEST_PATH}  expected_screen_count=${manifest.expected_screen_count}`)
console.log(`目录：${SCREENS}/*（${dirs.length} 个） ／ ${SUPPS}/*.json（${suppFiles.length} 个补采）`)
console.log('⚠️ 边界：只覆盖 ' + ROOT + '/**（"清单里没有"≠"全仓库没有"）；本工具**不做视觉核对**。')
console.log()

// ---------- 主表：以权威索引为准 ----------
console.log('--- 以**权威索引**为准的每屏状态（并与屏内 baseline.json 对比）---')
printfRow(['screen_id', 'observed(权威)', 'blocked?', 'superseded', '快照一致?'], [20, 22, 8, 22, 10])
let mismatchCount = 0
for (const s of manifest.screens) {
  const dir = join(SCREENS, s.id)
  const bjPath = join(dir, 'baseline.json')
  let snapMatch = '（无快照）'
  if (existsSync(bjPath)) {
    const bj = readJson(bjPath)
    const bjStates = bj && bj.states ? bj.states : null
    if (!bjStates) snapMatch = '（快照不可解析）'
    else {
      // 逐状态对比权威索引
      const diffs = []
      for (const [k, v] of Object.entries(s.states || {})) {
        const local = bjStates[k] && bjStates[k].status
        if (local !== undefined && local !== v) diffs.push(`${k}: ${local}≠${v}`)
      }
      if (diffs.length) { snapMatch = '**MISMATCH**'; mismatchCount++ }
      else snapMatch = 'ok'
    }
  }
  const observed = Object.entries(s.states || {})
    .filter(([, v]) => v === 'observed')
    .map(([k]) => k)
  const blocked = existsSync(bjPath) && readJson(bjPath).blocked_reason ? 'YES(旧)' : ''
  const sup = supMap.get(s.id)
  printfRow(
    [s.id, observed.join(',') || '（无）', blocked, sup ? sup.map((x) => x.supplement).join(',') : '', snapMatch],
    [20, 22, 8, 22, 10],
  )
}

console.log()
console.log(`--- 快照一致性小结：**${mismatchCount} 个屏**的 baseline.json 与权威索引不一致 ---`)
console.log('  ⚠️ 不一致**不是**项目缺陷：`screens/<id>/baseline.json` 是**更早的快照**，')
console.log('     权威状态在 `manifest.json`；恢复过程记在 `supplements/` 下的 JSON。')
console.log('     但**引用旧快照的状态标签**就是错误来源 —— 这正是本工具第一版犯过的错。')

console.log()
console.log('--- 索引 vs 目录（发现"漏登记/多出来"）---')
const dirSet = new Set(dirs)
const authSet = new Set(manifest.screens.map((s) => s.id))
const onlyDir = dirs.filter((d) => !authSet.has(d))
const onlyAuth = [...authSet].filter((a) => !dirSet.has(a))
console.log(`  只在目录里（未登记进权威索引）：${onlyDir.length ? onlyDir.join(', ') : '（无）'}`)
console.log(`  只在索引里（没有目录）：        ${onlyAuth.length ? onlyAuth.join(', ') : '（无）'}`)
console.log('  ⚠️ 注意： original-chat / original-sweep 这类只有 INDEX.md 的目录**不是** baseline 屏；')
console.log(`     而 expected_screen_count=${manifest.expected_screen_count} 才是权威的屏数口径。`)

console.log()
console.log('--- supersedes 关系（解释"快照为何过期"）---')
if (supMap.size === 0) console.log('  （无）')
else {
  for (const [screen, list] of [...supMap.entries()].sort()) {
    for (const x of list) {
      console.log(`  ${screen}  ← ${x.supplement}`)
      if (x.field) console.log(`      字段 ${x.field}: ${x.from ?? '?'} → **${x.to ?? '?'}**`)
    }
  }
}

console.log()
console.log('--- 结构化补采（supplements）---')
for (const f of suppFiles) {
  const j = readJson(join(SUPPS, f))
  const verdict = j.verdict ? ` verdict=${j.verdict}` : ''
  const extra = j.additional_finding ? ` + ${String(j.additional_finding).slice(0, 50)}` : ''
  const pol = j.policy_violation ? '  ⚠️EVIDENCE_OBTAINED_BY_POLICY_VIOLATION' : ''
  console.log(`  ${f}${verdict}${extra}${pol}`)
}

if (SHOW_FILES) {
  console.log()
  console.log('--- 每个屏目录的文件 ---')
  for (const d of dirs) {
    const abs = join(SCREENS, d)
    console.log(`  ${d}/: ${readdirSync(abs).sort().join(', ')}`)
  }
  console.log(`  supplements/: ${suppFiles.join(', ')}`)
}

if (GREP) {
  console.log()
  console.log(`=== --grep "${GREP}" 全文检索（**关键：同时报告分母**）===`)
  const targets = []
  for (const d of dirs) {
    const abs = join(SCREENS, d)
    for (const f of readdirSync(abs)) if (f.endsWith('.json')) targets.push(join(abs, f))
  }
  targets.push(MANIFEST_PATH)
  for (const f of suppFiles) targets.push(join(SUPPS, f))

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
  console.log(`  扫过 ${scanned} 个 JSON（分母）｜命中 ${hitFiles} 文件 / ${hitLines} 行`)
  if (hitFiles === 0) {
    console.log(`  ⚠️ 零命中**只能**得出"在这 ${scanned} 个 JSON 里没有"；`)
    console.log('     不能得出"原版没有这件事" —— 手写笔记与截图内容都不在本次范围内。')
  }
}
