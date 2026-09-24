/**
 * 冻结 manifest 的一致性检查器（审核记录 52 建议的落地）
 *
 * ## 它解决什么问题
 *   同一份 `docs/original-baseline/screens/<screen>/baseline.json` 会被**不同工作单重复人工解释**，
 *   于是结论可能漂移（同一个事实这次判 MATCH、下次判 DEVIATION）。
 *   做法：把每次解释**冻结**在 `scripts/m5/fixtures/baseline-manifest.json`，
 *   之后 Gate 只检查"当前实现是否违反这份冻结 manifest"，只有**出现新证据**时才更新 manifest。
 *
 * ## 本脚本检查什么（文档级一致性 + 词汇合法性）
 *   ① 每个 claim 必含 id / claim / evidence / status / implementation_impact
 *   ② status 必须来自冻结词表
 *   ③ status ∈ {DEVIATION_DELIBERATE} 的 claim **必须**有 deviation_id，
 *      且该 id 必须真实存在于 docs/m5/KNOWN-DEVIATIONS.md（防悬空引用）
 *   ④ status === 'DEVIATION_PENDING_FIX' 的 claim **必须**有 work_order（否则没人认领）
 *   ⑤ deviation_id 引用的 L-xxx / D-xxx 必须能在 KNOWN-DEVIATIONS.md 里找到
 *   ⑥ 屏幕级：baseline_file 必须真实存在（防引用一个不存在的基线）
 *   ⑦ claim id 全局唯一（防同一屏里写重、或跨屏撞名造成解释漂移）
 *
 * ## 为什么先做"文档级"而不是一上来做"设备级"
 *   设备级校验（例如"标题是否真是校园圈"）依赖具体页面可被驱动，
 *   属于各 WO 自己的 Gate；而"manifest 自身是否自洽、引用是否悬空"
 *   是所有 WO 共用的**地基** —— 地基先机械校验，才能保证上层结论不漂移。
 *
 * ## 用法
 *   node scripts/m5/check-baseline-manifest.mjs
 * 退出码 0 = 一致；1 = 发现问题
 */
import { readFileSync, existsSync } from 'node:fs'

const ROOT = 'G:\\demo map'
const MANIFEST = `${ROOT}\\scripts\\m5\\fixtures\\baseline-manifest.json`
const DEVIATIONS = `${ROOT}\\docs\\m5\\KNOWN-DEVIATIONS.md`

const VOCAB = new Set([
  'MATCH',
  'DEVIATION',
  'DEVIATION_DELIBERATE',
  'DEVIATION_PENDING_FIX',
  'NOT_EVALUATED',
  'UNCHANGED',
])

const problems = []
const notes = []
const bad = (m) => problems.push(m)
const say = (m) => notes.push(m)

if (!existsSync(MANIFEST)) {
  console.error(`FATAL 找不到 manifest: ${MANIFEST}`)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

// 从 KNOWN-DEVIATIONS.md 里抽出已登记的编号（D-xxx / L-xxx）
const devText = existsSync(DEVIATIONS) ? readFileSync(DEVIATIONS, 'utf8') : ''
const registeredIds = new Set()
for (const m of devText.matchAll(/\b([DL]-\d{3})\b/g)) registeredIds.add(m[1])
say(`KNOWN-DEVIATIONS.md 中登记了 ${registeredIds.size} 个编号: ${[...registeredIds].sort().join(', ')}`)

const screens = manifest.screens || {}
const allClaimIds = new Map() // id -> "screen/…"（用于查重）
let claimCount = 0
const byStatus = {}

for (const [screen, def] of Object.entries(screens)) {
  // ⑥ baseline_file 必须存在（若声明了）
  if (def.baseline_file) {
    const p = `${ROOT}\\${def.baseline_file.replace(/\//g, '\\')}`
    if (!existsSync(p)) bad(`[${screen}] baseline_file 不存在: ${def.baseline_file}`)
  }

  const claims = def.claims || []
  if (!Array.isArray(claims) || claims.length === 0) {
    bad(`[${screen}] 没有任何 claims —— 空 manifest 等于没解释，不允许`)
    continue
  }

  for (const c of claims) {
    claimCount++
    const where = `[${screen}/${c.id ?? '(缺 id)'}]`

    // ① 必填字段
    for (const k of ['id', 'claim', 'evidence', 'status', 'implementation_impact']) {
      if (!c[k] || String(c[k]).trim() === '') bad(`${where} 缺字段 ${k}`)
    }

    // ② 词汇合法
    if (c.status && !VOCAB.has(c.status)) {
      bad(`${where} status 不在冻结词表内: ${c.status}（合法值: ${[...VOCAB].join('/')}）`)
    }
    if (c.status) byStatus[c.status] = (byStatus[c.status] || 0) + 1

    // ③ DELIBERATE 必须有 deviation_id 且真实存在
    if (c.status === 'DEVIATION_DELIBERATE') {
      if (!c.deviation_id) {
        bad(`${where} status=DEVIATION_DELIBERATE 但缺 deviation_id（有意后撤必须登记到 KNOWN-DEVIATIONS.md）`)
      } else if (!registeredIds.has(c.deviation_id)) {
        bad(`${where} deviation_id=${c.deviation_id} 在 KNOWN-DEVIATIONS.md 里**找不到**（悬空引用）`)
      }
    }

    // ④ PENDING_FIX 必须有 work_order
    if (c.status === 'DEVIATION_PENDING_FIX' && !c.work_order) {
      bad(`${where} status=DEVIATION_PENDING_FIX 但缺 work_order（没人认领的偏差会被忘掉）`)
    }

    // ⑤ 任何 deviation_id 引用都要真实存在
    if (c.deviation_id && !registeredIds.has(c.deviation_id)) {
      bad(`${where} deviation_id=${c.deviation_id} 引用悬空`)
    }

    // ⑦ claim id 全局唯一
    if (c.id) {
      if (allClaimIds.has(c.id)) {
        bad(`${where} claim id 重复（已出现于 ${allClaimIds.get(c.id)}）—— 重复 id 会让解释漂移`)
      } else {
        allClaimIds.set(c.id, `${screen}/${c.id}`)
      }
    }

    // ⚠️ 一致性提醒：MATCH 不应同时带 deviation_id（那自相矛盾）
    if (c.status === 'MATCH' && c.deviation_id) {
      bad(`${where} status=MATCH 却带 deviation_id=${c.deviation_id}（自相矛盾）`)
    }
  }
}

// 反向检查：KNOWN-DEVIATIONS.md 里登记的编号是否都被 manifest 引用
// （不强制：L/D 编号也可能被别的文档引用；这里只作提示）
const referenced = new Set()
for (const s of Object.values(screens)) {
  for (const c of s.claims || []) if (c.deviation_id) referenced.add(c.deviation_id)
}
for (const id of [...registeredIds].sort()) {
  if (!referenced.has(id)) say(`提示：${id} 已在 KNOWN-DEVIATIONS.md 登记，但 manifest 里没有 claim 引用它`)
  else say(`引用一致：${id}`)
}

console.log('=== 冻结 manifest 一致性检查 ===')
console.log(`  屏幕数: ${Object.keys(screens).length}`)
console.log(`  claim 总数: ${claimCount}`)
console.log('  按状态统计:')
for (const [k, v] of Object.entries(byStatus).sort()) console.log(`    ${k.padEnd(24)} ${v}`)
console.log('')
for (const n of notes) console.log(`  info ${n}`)
console.log('')
if (problems.length) {
  console.log('  FAIL 发现以下问题：')
  for (const p of problems) console.log(`    - ${p}`)
  console.log('')
  console.log(`BASELINE_MANIFEST_CONSISTENCY: FAIL（${problems.length} 个问题）`)
  process.exit(1)
} else {
  console.log('BASELINE_MANIFEST_CONSISTENCY: PASS（字段齐全／词汇合法／引用无悬空／claim id 唯一）')
  process.exit(0)
}
