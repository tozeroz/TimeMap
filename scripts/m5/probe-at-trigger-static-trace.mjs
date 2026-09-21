/**
 * AT 面板**触发方式**的静态 binding trace（**有明确预算上限**）
 *
 * 审核记录 48 要求：
 *   把它作为一次"有明确预算的 probe"：
 *     AT_TRIGGER_STATIC_TRACE: FOUND | UNRESOLVED_AFTER_LOW_COST_TRACE
 *   如果追不到就**停止**，不要继续深挖；随后记为
 *     AT_PANEL_TRIGGER: OUR_DESIGN_CHOICE / ORIGINAL_NOT_EVALUATED
 *
 * ## 预算（写死，超了就停）
 *   · 只做**字符串池 + 布局资源**两层的检索（不做反汇编、不改 APK）
 *   · 只查审核列出的那几类线索：AT 面板的 Activity/类名、startActivity、'@'、
 *     composer 控件、相关 resource id
 *   · 最多 6 组关键词
 *
 * ## 为什么只做这两层
 *   本项目已验证过的证据分层（审核 42）：
 *     resource/layout declaration（最弱） < 静态 binding/code evidence < runtime rendered
 *   字符串池属于"binding/code symbols"这一档 —— 它能证明"存在这样的符号"，
 *   但**读不到方法体**，因此**不能**证明"点谁触发"。这正是要把结论限制在 FOUND/UNRESOLVED 的原因。
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\at-trigger-static-trace.json'
const DEXDIR = 'G:\\demo map\\tools\\tmp\\apk-dex'
const DEXFILES = ['classes.dex', 'classes2.dex', 'classes3.dex', 'classes4.dex', 'classes5.dex']

/** 预算：最多这几组关键词（审核列出的线索类别） */
const GROUPS = [
  { name: 'AT 面板类/Activity 名', keys: ['AtPanel', 'AtPanelActivity', 'GroupAtPanel', 'at_panel', 'atPanel'] },
  { name: '面板相关标识', keys: ['atPanelList', 'atPanelTitle', 'at_all', 'atAll', 'mentionAll'] },
  { name: '启动面板的调用', keys: ['startActivityForResult', 'startActivity', 'showAtPanel', 'openAtPanel'] },
  { name: 'composer 里的 @ 线索', keys: ['atBtn', 'atIcon', 'atEntry', 'inputAt', 'atView'] },
  { name: '群成员列表模型', keys: ['AtPanelMember', 'AtMember', 'atPanelAdapter', 'sectionHeader'] },
  { name: '资源 id 名（字符串池里可能出现）', keys: ['activity_group_at_panel', 'item_at_panel_at_all', 'item_at_panel_member'] },
]

const report = { startedAt: new Date().toISOString(), budget: '字符串池 + 布局资源两层；最多 6 组关键词；不反汇编', groups: {}, verdict: null }
const hits = []
for (const d of DEXFILES) {
  const p = `${DEXDIR}\\${d}`
  if (!existsSync(p)) continue
  const s = readFileSync(p).toString('latin1')
  for (const g of GROUPS) {
    for (const k of g.keys) {
      const n = s.split(k).length - 1
      if (n > 0) hits.push({ dex: d, group: g.name, key: k, count: n })
    }
  }
}

for (const g of GROUPS) {
  const h = hits.filter((x) => x.group === g.name)
  report.groups[g.name] = { keysSearched: g.keys.length, hits: h }
  console.log(`  [${g.name}]`)
  if (h.length === 0) {
    console.log('    （无命中）')
  } else {
    for (const x of h) console.log(`    ${x.key}  ×${x.count}  @${x.dex}`)
  }
}

/*
  判定口径（写清楚，避免过度解读）：
    FOUND   —— 追到"面板类名 + 某种启动线索"同时存在，足以支撑"确实有一个面板 Activity/组件"
    UNRESOLVED —— 只有零散命中或只有布局名，**读不到方法体**，因此无法证明"谁触发它"
  无论哪种结论，都**不能**升级 AT_PANEL_TRIGGER 为 conformance ——
  因为字符串池只能证明"符号存在"，不能证明"交互关系"。
*/
const hasPanelClass = hits.some((x) => ['AtPanel', 'AtPanelActivity', 'GroupAtPanel'].includes(x.key))
const hasLaunchCall = hits.some((x) => ['startActivity', 'startActivityForResult', 'showAtPanel', 'openAtPanel'].includes(x.key))
const hasTriggerSpecific = hits.some((x) => ['showAtPanel', 'openAtPanel', 'atBtn', 'atIcon', 'atEntry'].includes(x.key))
report.verdict = hasPanelClass && hasTriggerSpecific ? 'FOUND' : 'UNRESOLVED_AFTER_LOW_COST_TRACE'
report.reasoning = {
  hasPanelClass,
  hasLaunchCall,
  hasTriggerSpecific,
  note:
    'startActivity 是泛化符号（任何页面跳转都有），**不能**据此推断"它启动了 AT 面板"；' +
    '要建立"谁触发 AT 面板"必须有方法体级别证据（反汇编），超出本次预算。',
}
writeFileSync(OUT, JSON.stringify({ ...report, hits }, null, 2), 'utf8')

console.log('')
console.log(`  AT_TRIGGER_STATIC_TRACE: ${report.verdict}`)
console.log(`    hasPanelClass=${hasPanelClass} hasLaunchCall=${hasLaunchCall} hasTriggerSpecific=${hasTriggerSpecific}`)
console.log('')
console.log('  ⚠️ 无论 FOUND 还是 UNRESOLVED，都**不**把 AT_PANEL_TRIGGER 升级为 conformance：')
console.log('     字符串池只能证明"符号存在"，证明不了"交互关系"（读不到方法体）。')
console.log('  → 随后仍记为 AT_PANEL_TRIGGER: OUR_DESIGN_CHOICE / ORIGINAL_NOT_EVALUATED')
console.log(`\n  报告: ${OUT}`)
process.exit(0)
