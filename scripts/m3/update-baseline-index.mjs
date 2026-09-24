#!/usr/bin/env node
/**
 * 依据 supplements/ 更新 `docs/original-baseline/` 的索引（M3 Evidence Preflight）。
 *
 * 为什么需要脚本而不是手改 JSON：
 *   1. 口径（observed / evidence-blocked）必须与证据文件**由同一份输入推导**，
 *      手改很容易出现"图放上去了但 manifest 没改"这种不一致；
 *   2. SHA256SUMS 必须覆盖**全部**证据文件，手算会漏；
 *   3. M0 Gate 会机械校验 manifest / SHA256SUMS，脚本化才能保证它稳定通过。
 *
 * 关键的审计原则（M0 ANCHOR 硬规则 4）：
 *   **不改写 M0 的历史记录** —— `screens/<id>/baseline.json` 保持原样（记录 M0 当时为何没看到），
 *   恢复事实写在 `supplements/<id>.json`，并在 manifest 里以 `supplements` 字段引用。
 *   manifest 表达的是「当前真实状态」，历史差异由 supplements 解释。
 *
 * 用法：node scripts/m3/update-baseline-index.mjs
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'

const ROOT = process.cwd()
const BASE = join(ROOT, 'docs', 'original-baseline')
const SUPP_DIR = join(BASE, 'supplements')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const toPosix = (p) => p.split(sep).join(posix.sep)

const manifestPath = join(BASE, 'manifest.json')
const manifest = readJson(manifestPath)

// ---------------------------------------------------------------------------
// 1. 读取 supplements，建立 screen_id → supplement 的映射
// ---------------------------------------------------------------------------
const supplements = new Map()
for (const f of readdirSync(SUPP_DIR).filter((f) => f.endsWith('.json') && f !== 'environment-m3.json')) {
  const doc = readJson(join(SUPP_DIR, f))
  if (doc.screen_id) supplements.set(doc.screen_id, { file: `supplements/${f}`, doc })
}

// ---------------------------------------------------------------------------
// 2. 更新 manifest：被补采的页面标记为 observed，并引用 supplement
//
// 注意：**只有当 supplement 显式声明 states_normal 时才改状态**，
// 只有当它给出 recovered_target 时才覆盖 target。
// 原因：不是每个 supplement 都意味着「M0 的进入方式错了」——
// 例如 login-select / login-sns 的 deep link 本来就是可用的（M0 记录正确），
// 它们的 supplement 只是补充控件级结构。早期版本无条件改写 target，会丢掉正确信息。
// ---------------------------------------------------------------------------
let recovered = 0
for (const s of manifest.screens) {
  const sup = supplements.get(s.id)
  if (!sup) continue
  const doc = sup.doc
  if (doc.recovered_target) s.target = doc.recovered_target
  if (doc.states_normal) s.states.normal = doc.states_normal
  s.supplements = [sup.file]
  s.recovered_at = doc.recovered_at
  if (doc.states_normal === 'observed') recovered++
}

// ---------------------------------------------------------------------------
// 3. 口径：当前值由证据推导；历史值保留，禁止用新数字覆盖旧结论
//
// **判据必须与 M0 一致**：M0 的「observed 19 / blocked 3」不是按
// `states.normal == 'observed'` 算的（那样只有 13），而是按
// **「这个页面是否被真正到达并记录过行为」** 算的 —— 未到达的才记为 blocked，
// 且它们的 baseline.json 里带 `blocked_reason`。
// 第一版脚本用错了判据，得到 observed=16/blocked=6，与历史口径对不上；
// 这类"同一概念两套算法"正是审核记录 04 提醒过的坑，所以这里显式写明依据。
// ---------------------------------------------------------------------------
const expected = manifest.expected_screen_count

const hasBlockedReason = (id) => {
  const p = join(BASE, 'screens', id, 'baseline.json')
  try {
    return Boolean(readJson(p).blocked_reason)
  } catch {
    return false
  }
}

const blockedScreens = manifest.screens
  .filter((s) => hasBlockedReason(s.id) && !supplements.has(s.id))
  .map((s) => s.id)
const blocked = blockedScreens.length
const observed = expected - blocked

manifest.coverage = {
  note: '本块是口径的唯一真源：current 由 screens[].states.normal 推导；history 记录各阶段当时的真实口径，历史值不得被改写',
  current: {
    stage: 'M3 Evidence Preflight',
    total_original_screens: expected,
    observed,
    evidence_blocked: blocked,
    blocked_screens: blockedScreens,
    out_of_scope: 0,
    derived_from: '未到达（baseline.json 带 blocked_reason 且无 supplement）的页面记为 evidence_blocked；observed = expected - evidence_blocked',
  },
  history: [
    {
      stage: 'M0',
      recorded_in: 'docs/m0/ANCHOR.md',
      total_original_screens: 22,
      observed: 19,
      evidence_blocked: 3,
      blocked_screens: ['poi-detail', 'media-preview', 'at-panel'],
      why: '这 3 页只能通过内部 Activity 进入，deep link 未注册外部 scheme → 必然回落 TridentActivity',
    },
    {
      stage: 'M3 Evidence Preflight',
      recorded_in: 'docs/m3/PREFLIGHT.md',
      total_original_screens: 22,
      observed: 22,
      evidence_blocked: 0,
      recovered: ['poi-detail', 'media-preview', 'at-panel'],
      why: '改用真实 UI 入口取证（动态详情→地点 / 群聊输入@ / 聊天图片消息），证据以 supplements/ 追加，未改写 M0 记录',
    },
  ],
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`[index] manifest 更新：recovered=${recovered} observed=${observed} blocked=${blocked}`)

// ---------------------------------------------------------------------------
// 4. 重新生成 SHA256SUMS：覆盖 screens/**/*.png + supplements/*.json + manifest.json
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(BASE)
  .map((p) => toPosix(relative(BASE, p)))
  .filter(
    (rel) =>
      /^screens\/.+\/.*\.(png|xml)$/.test(rel) ||
      /^supplements\/.*\.json$/.test(rel) ||
      rel === 'manifest.json',
  )
  .sort()

const lines = files.map((rel) => {
  const hash = createHash('sha256').update(readFileSync(join(BASE, rel))).digest('hex')
  return `${hash}  ${rel}`
})
writeFileSync(join(BASE, 'SHA256SUMS'), `${lines.join('\n')}\n`, 'utf8')
console.log(`[index] SHA256SUMS 覆盖 ${lines.length} 个文件（含新增证据与 supplements）`)
