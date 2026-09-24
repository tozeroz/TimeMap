/**
 * WO#18 收尾：把 mock.ts 里**已无人使用**的 `export const pois` 移出生产代码
 * （→ `scripts/m5/fixtures/legacy-pois.json`），并留下指向说明
 *
 * 与 WO#17 对 `comments`、WO#16 对 `campusInfo`/`schools` 的处置**同一纪律**：
 *   "**注释挡不住重新 import**" —— 只要假数据还在生产模块里，
 *   重新 import 一下就会再次形成"同一实体两种来源"（审核 62：**不再保留**双数据源）。
 *
 * ⚠️ 保留 `Poi` **接口**（先核对是否仍被引用；若不再被引用也一并移出）。
 *
 * 用法：node scripts/m5/extract-legacy-pois.mjs
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'

const MOCK = 'G:\\demo map\\app\\src\\data\\mock.ts'
const FIXTURE = 'G:\\demo map\\scripts\\m5\\fixtures\\legacy-pois.json'
const BACKUP = 'G:\\demo map\\tools\\tmp\\mock.ts.before-legacy-pois.txt'

let src = readFileSync(MOCK, 'utf8')
if (!existsSync(BACKUP)) copyFileSync(MOCK, BACKUP)

const START = 'export const pois: Poi[] = ['
const i = src.indexOf(START)
if (i < 0) {
  console.log('  已无 `export const pois`（幂等）')
  process.exit(0)
}
const endIdx = src.indexOf('\n]\n', i)
if (endIdx < 0) {
  console.error('FAIL 找不到 pois 数组的结束位置')
  process.exit(1)
}
const block = src.slice(i, endIdx + 3)

const fixture = {
  _provenance: {
    source: 'app/src/data/mock.ts（WO#18 之前）',
    extracted_at: new Date().toISOString(),
    extracted_by: 'scripts/m5/extract-legacy-pois.mjs',
    reason:
      'WO#18（审核 62 的 A2）要求 PoiSearchScreen 接权威数据源。' +
      '这份 mock 地点数据在 WO#18 之后**已无任何生产引用**。',
    why_must_not_be_used:
      '⚠️ 它**不是**权威数据：其中 `posts` 字段（如 1284 / 143 / 143）是**无出处的编造数字**；' +
      '`address` 与真实行**不一致**（mock 多出「北京市海淀区」前缀，而权威行是「西直门外上园村3号」，' +
      '后者与基线实例更接近）；`distance` 是硬编码的固定文案，与用户实际位置无关。' +
      '只可用于对照 WO#18 的敏感度（突变把它接回去 ⇒ 门禁必须变红）。',
    original_ts_source: block,
  },
}
writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + '\n', 'utf8')

const replacement =
  '/*\n' +
  '  WO#18（审核 62 的 A2）：`export const pois` 这个**数据导出已移出生产代码**。\n' +
  '\n' +
  '  ⚠️ 为什么移出而不是留在这里加注释：WO#16/WO#17 已两次确认的纪律 ——\n' +
  '     "**注释挡不住重新 import**"。只要数据还在生产模块里，\n' +
  '     重新 import 一下就会再次形成"同一实体两种来源"。\n' +
  '\n' +
  '  ⚠️ 它不是权威数据：\n' +
  '     · `posts`（1284 / 143 / …）是**无出处的编造数字**\n' +
  '     · `address` 与真实行不一致（mock 多「北京市海淀区」前缀）\n' +
  '     · `distance` 是硬编码固定文案，与用户位置无关\n' +
  '\n' +
  '  → 已移出至 scripts/m5/fixtures/legacy-pois.json（附 provenance 与"为何不得使用"）\n' +
  '  ⚠️ PoiSearchScreen 现在读 `GET /api/places`（WO#18 新增）；\n' +
  '     PoiDetailScreen 早已读 `GET /api/places/:id` ⇒ 两者同源。\n' +
  '*/\n'

src = src.slice(0, i) + replacement + src.slice(endIdx + 3)
writeFileSync(MOCK, src, 'utf8')

// 核对 `Poi` 接口是否仍被引用（引号内的命中不算引用）
const usesOfType = (src.match(/\bPoi\b/g) || []).length
console.log('  已移出 `export const pois` → scripts/m5/fixtures/legacy-pois.json')
console.log('  ⚠️ `Poi` 类型在本文件剩余出现次数 = ' + usesOfType + '（含其自身定义）—— 请人工确认是否还需保留')
console.log('  备份：tools/tmp/mock.ts.before-legacy-pois.txt')
