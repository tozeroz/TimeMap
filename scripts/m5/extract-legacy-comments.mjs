/**
 * WO#17 收尾：把 mock.ts 里**已无人使用**的 `export const comments` 移出生产代码
 * （→ `scripts/m5/fixtures/legacy-comments.json`），并留下指向说明
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么必须**移出**而不是只去掉 import（审核 60/61/62 的一贯要求）
 * ════════════════════════════════════════════════════════════════════
 *   WO#16 的先例（审核 60 批准）：我把 `campusInfo` / `schools` 从生产 mock.ts **移出**，
 *   理由是"**注释挡不住重新 import**" —— 只要数据还在生产模块里，
 *   下一个人（或未来的我）`import` 一下就又回到了"一真一假"。
 *   审核 62 对 A1 的要求正是："**不再保留**'一真一假'的双数据源"。
 *   ⇒ 所以"不保留"要落到**数据本身**，不能只删调用点。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️ 保留 `Comment` **接口**（它仍被 `FeedPost.replies?: Comment[]` 使用）
 * ════════════════════════════════════════════════════════════════════
 *   只移除 `export const comments` 这个**数据导出**；
 *   类型定义留着（`FeedPost` 的 `replies` 字段依赖它）。
 *
 * 用法：node scripts/m5/extract-legacy-comments.mjs
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'

const MOCK = 'G:\\demo map\\app\\src\\data\\mock.ts'
const FIXTURE = 'G:\\demo map\\scripts\\m5\\fixtures\\legacy-comments.json'
const BACKUP = 'G:\\demo map\\tools\\tmp\\mock.ts.before-legacy-comments.txt'

let src = readFileSync(MOCK, 'utf8')
if (!existsSync(BACKUP)) copyFileSync(MOCK, BACKUP)

const START = 'export const comments: Comment[] = ['
const i = src.indexOf(START)
if (i < 0) {
  console.log('  已无 `export const comments`（幂等）')
  process.exit(0)
}
// 找该数组的结束 `]`（行首的 `]` 后跟换行）
const endIdx = src.indexOf('\n]\n', i)
if (endIdx < 0) {
  console.error('FAIL 找不到 comments 数组的结束位置')
  process.exit(1)
}
const block = src.slice(i, endIdx + 3) // 含结尾的 "]\n"

// ① 落盘为 fixture（附 provenance 与"为何不得在生产使用"）
const fixture = {
  _provenance: {
    source: 'app/src/data/mock.ts（WO#17 之前）',
    extracted_at: new Date().toISOString(),
    extracted_by: 'scripts/m5/extract-legacy-comments.mjs',
    reason:
      'WO#17（审核 62 的 A1）要求"不再保留一真一假的双数据源"。' +
      '这份 mock 评论数据在 WO#17 之后**已无任何生产引用**，' +
      '但它对应的正是原版 CommentDetailActivity 的评论内容。',
    why_must_not_be_used:
      '⚠️ 它**不是**权威数据：内容与作者均为编造，且与 FeedDetailScreen 使用的' +
      '真实 /api/posts/:id/comments 会形成"同一实体两种内容"。' +
      '只可用于对照 WO#17 的敏感度（突变把它接回去 ⇒ 门禁必须变红）。',
    original_ts_source: block,
  },
}
writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + '\n', 'utf8')

// ② 在生产 mock.ts 里替换为指向说明
const replacement =
  '/*\n' +
  '  WO#17（审核 62 的 A1）：`export const comments` 这个**数据导出已移出生产代码**。\n' +
  '\n' +
  '  ⚠️ 为什么移出而不是留在这里加注释：审核 60 在 WO#16 已确立 ——\n' +
  '     "**注释挡不住重新 import**"。只要数据还在生产模块里，\n' +
  '     重新 import 一下就会再次形成"同一实体两种内容"（一真一假）。\n' +
  '     审核 62 对 A1 的要求原文："**不再保留**\'一真一假\'的双数据源"。\n' +
  '\n' +
  '  ⚠️ 它**不是**权威数据：内容与作者均为编造，\n' +
  '     与 FeedDetailScreen 用的真实 /api/posts/:id/comments 会冲突。\n' +
  '\n' +
  '  → 已移出至 scripts/m5/fixtures/legacy-comments.json（附 provenance 与"为何不得使用"）\n' +
  '  ⚠️ `Comment` 接口**保留** —— FeedPost.replies 仍依赖它。\n' +
  '  ⚠️ 对照：CommentsScreen 现在与 FeedDetailScreen 共用\n' +
  '     `app/src/data/postIdentity.ts` 的 resolvePostAndComments（**唯一**实现）。\n' +
  '*/\n'

src = src.slice(0, i) + replacement + src.slice(endIdx + 3)
writeFileSync(MOCK, src, 'utf8')

console.log('  已移出 `export const comments` → scripts/m5/fixtures/legacy-comments.json')
console.log('  行数变化：原 ' + block.split('\n').length + ' 行 → 说明 ' + replacement.split('\n').length + ' 行')
console.log('  备份：tools/tmp/mock.ts.before-legacy-comments.txt')
