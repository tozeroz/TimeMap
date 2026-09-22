/**
 * WO#19 配套：把 `gate-wo17-post-identity.mjs` 的**评论侧断言**从已删除的
 * `#/comments` **迁到 FeedDetail 的真实评论表面**（审核 64/65 明确要求）
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么必须迁（而不是删掉那几条断言）
 * ════════════════════════════════════════════════════════════════════
 *   审核 64："若 #/comments 只是 Gate/调试为了方便直接打开页面，可以把**测试方式迁到
 *   FeedDetail 的真实 comment surface**；**不要为了测试方便永久保留一个原版不存在的
 *   产品页面**。"
 *   审核 65："Gate 改到真实 FeedDetail comment surface。"
 *
 * ⚠️ 且 WO#17 的不变量**必须继续被断言**（审核 64："这些修复仍然完全有效"）：
 *   ① 不存在的 id ⇒ 页面上**不得出现任何真实动态正文**（identity corruption）
 *   ② 同一 id ⇒ 页面显示的实体与 API 一致
 *   ③ 「评论 N」== API 的权威评论总数
 *   ④ 0 评论 ⇒ 空态（不渲染任何评论行）
 *
 * ════════════════════════════════════════════════════════════════════
 * 迁法（key 名与语义都保留，只换**观测表面**）
 * ════════════════════════════════════════════════════════════════════
 *   `MISSING_ID_NO_ENTITY_LEAK_COMMENTS` → `MISSING_ID_NO_ENTITY_LEAK_FEED_COMMENTS`
 *       仍在"不存在的 id"下测，但观测点改为 **FeedDetail 的评论区**
 *       （`#/feed?id=<不存在>` 时整页不得出现任何真实动态正文 —— 含评论区）
 *   `SAME_IDENTITY_ACROSS_SCREENS` → **删除**（只剩一个屏，"两屏一致"不再有意义）
 *       ⚠️ 但换成一条**更有意义**的新断言：
 *       `COMMENTS_INLINE_IN_FEED`：评论区**就在 FeedDetail 同一页**（同 hash、同 .screen）
 *   `COMMENTS_COUNT_FROM_AUTHORITY` → 观测点改为 FeedDetail 的「评论 N」
 *   `NO_MOCK_COMMENT_CONTENT` → 仍在 FeedDetail 的评论区测（0 评论 ⇒ 空态、0 行）
 *
 * 用法：node scripts/m5/retarget-wo17-gate-to-feed.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'

const FILE = 'G:\\demo map\\scripts\\m5\\gate-wo17-post-identity.mjs'
const BACKUP = 'G:\\demo map\\tools\\tmp\\gate-wo17.before-wo19.txt'

let src = readFileSync(FILE, 'utf8')
if (!existsSync(BACKUP)) copyFileSync(FILE, BACKUP)

if (!src.includes("goto(`#/comments")) {
  console.log('  已无 #/comments 引用（幂等）')
  process.exit(0)
}

function replaceOnce(from, to, label) {
  const n = src.split(from).length - 1
  if (n !== 1) {
    console.error(`FAIL [${label}] 命中 ${n} 次（要求恰好 1 次）`)
    process.exit(1)
  }
  src = src.replace(from, to)
  console.log('    · ' + label)
}

// ① 段 1：不存在的 id → 观测 FeedDetail（含其评论区）
replaceOnce(
  "console.log('=== 1) #/comments?id=<不存在>：不得出现任何真实动态正文 ⭐ ===')\nconst commentsMissing = await goto(`#/comments?id=${MISSING}`)",
  `/*
  ⭐ WO#19：本段原为 #/comments（该产品路由已按审核 65 删除）。
    现在观测 **FeedDetail 的真实评论表面** —— 因为评论区**内联在 #/feed 里**。
    ⚠️ 判据不变：不存在的 id 下，**整页（含评论区）不得出现任何真实动态正文**。
*/
console.log('=== 1) #/feed?id=<不存在>：整页（含内联评论区）不得出现任何真实动态正文 ⭐ ===')
const commentsMissing = await goto(\`#/feed?id=\${MISSING}\`)`,
  '段1 观测点迁到 FeedDetail',
)

// ② 段 3：有效 id → 观测 FeedDetail（评论区就在同页）
replaceOnce(
  '  commentsReal = await goto(`#/comments?id=${exp.items[0].id}`)\n  feedReal = await goto(`#/feed?id=${exp.items[0].id}`)',
  `  /*
    ⭐ WO#19：原来这里分别打开 #/comments 与 #/feed 两屏做"身份一致"比较。
      独立评论页已删除 ⇒ 只在 **FeedDetail 一屏**上观测（评论区内联在内）。
  */
  feedReal = await goto(\`#/feed?id=\${exp.items[0].id}\`)
  commentsReal = feedReal`,
  '段3 观测点迁到 FeedDetail',
)

// ③ 段 5：0 评论 → 观测 FeedDetail 的评论区
replaceOnce(
  '        const view = await goto(`#/comments?id=${zeroComment.id}`)',
  '        const view = await goto(`#/feed?id=${zeroComment.id}`)',
  '段5 观测点迁到 FeedDetail',
)

// ④ 断言变更：SAME_IDENTITY_ACROSS_SCREENS → COMMENTS_INLINE_IN_FEED
replaceOnce(
  `  /**
   * 同一 id 下两屏显示**同一实体**。
   * ⚠️ 用**文本推导**（拿服务端该 id 的作者名去页面里找）而不是依赖 \`data-cd-author\`
   *    —— 见 noLeakVerdict 上方对"断言口径错"的说明。
   */
  SAME_IDENTITY_ACROSS_SCREENS: (() => {
    if (!commentsReal || !feedReal || !exp) return 'INCONCLUSIVE'
    const apiAuthor = exp.items[0].author
    const inComments = displayedAuthorFromText(commentsReal, apiAuthor) || commentsReal.author
    const inFeed = displayedAuthorFromText(feedReal, apiAuthor)
    if (!inComments || !inFeed) return 'FAIL'
    return inComments === inFeed && inFeed === apiAuthor ? 'PASS' : 'FAIL'
  })(),`,
  `  /**
   * ⭐ WO#19 取代 \`SAME_IDENTITY_ACROSS_SCREENS\`：
   *   独立评论页已删 ⇒ "两屏一致"不再有意义（只有一个屏）。
   *   改为断言**评论区内联在 FeedDetail 同一页**（这正是本 WO 的结构目标）：
   *     · URL 仍是 \`#/feed?id=...\`（没有跳到独立评论路由）
   *     · 同一页上同时出现：动态正文 + 「评论 N」+（0 评论时空态文字）
   *   ⚠️ 判据取自**权威**：N 与 API 的 total 比较（见下一条），此处只看"在同一页"。
   */
  COMMENTS_INLINE_IN_FEED: (() => {
    if (!feedReal || !exp) return 'INCONCLUSIVE'
    const t = String(feedReal.text || '')
    const samePage = /^#\\/feed\\?id=/.test(String(feedReal.hash || ''))
    const hasPostBody = t.includes(String(exp.items[0].body).slice(0, 10))
    const hasCommentTitle = /评论\\s*\\d+/.test(t)
    return samePage && hasPostBody && hasCommentTitle ? 'PASS' : 'FAIL'
  })(),`,
  '断言 SAME_IDENTITY_ACROSS_SCREENS → COMMENTS_INLINE_IN_FEED',
)

// ⑤ KEYS 同步
src = src.replace("  'MISSING_ID_NO_ENTITY_LEAK_COMMENTS',", "  'MISSING_ID_NO_ENTITY_LEAK_FEED_COMMENTS',")
src = src.replace("  'SAME_IDENTITY_ACROSS_SCREENS',", "  'COMMENTS_INLINE_IN_FEED',")

// ⑥ 键名同步（第一键改名 + 注释）
src = src.replace(
  `  MISSING_ID_NO_ENTITY_LEAK_COMMENTS: noLeakVerdict(commentsMissing, leakC),`,
  `  /* ⭐ WO#19：本键观测点已迁到 FeedDetail 的**内联评论区**（原 #/comments 已删） */
  MISSING_ID_NO_ENTITY_LEAK_FEED_COMMENTS: noLeakVerdict(commentsMissing, leakC),`,
)
src = src.replace(
  ' *   MISSING_ID_NO_ENTITY_LEAK_COMMENTS  #/comments?id=<不存在> ⇒ 不出现任何真实动态正文',
  ' *   MISSING_ID_NO_ENTITY_LEAK_FEED_COMMENTS  #/feed?id=<不存在> ⇒ 整页（含内联评论区）不出现任何真实动态正文',
)
src = src.replace(
  ' *   SAME_IDENTITY_ACROSS_SCREENS        同一有效 id ⇒ 两屏显示**同一实体**',
  ' *   COMMENTS_INLINE_IN_FEED             ⭐ WO#19：评论区**内联在 FeedDetail 同一页**（取代原"两屏一致"）',
)

writeFileSync(FILE, src, 'utf8')
console.log('  已写回 gate-wo17-post-identity.mjs（备份：tools/tmp/gate-wo17.before-wo19.txt）')
