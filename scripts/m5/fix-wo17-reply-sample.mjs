/**
 * WO#19 配套（补样本）：让 `REPLIES_NESTED_IN_PARENT` 指向**确实有回复**的那条动态
 *
 * ════════════════════════════════════════════════════════════════════
 * 问题（我自己造成的）
 * ════════════════════════════════════════════════════════════════════
 *   上一版把嵌套断言绑在 `feedReal` 上，而 `feedReal` 用的是 `exp.items[0]`。
 *   实测数据：
 *     aaaaaaaa-0001-…-0001  total=2, replies=1   ← **唯一带回复的样本**
 *     aaaaaaaa-0002/0003/0004  total=0, replies=0
 *   而 `exp.items[0]` 是 `…0004`（API 按 created_at desc 排序）⇒ **total=0**
 *   ⇒ 嵌套断言没有样本 ⇒ INCONCLUSIVE（诚实，但等于没测）
 *
 * ════════════════════════════════════════════════════════════════════
 * 修法
 * ════════════════════════════════════════════════════════════════════
 *   ① 期望值阶段**额外找出"有回复的动态"**（从 API 推导：拉每条动态的评论，
 *      看是否存在 parentId 非空的回复）—— 不硬编码 id。
 *   ② 嵌套断言改为在**那条动态**的页面上观测。
 *   ③ 若服务端确实没有任何回复样本 ⇒ 保留 INCONCLUSIVE 并在 detail 说明
 *      （**不**假装通过）；我们自己的库允许造数，但这里先如实标注。
 *
 * ⚠️ 这也顺带让断言更贴合"真实场景"：0 评论的动态本来就不该有嵌套可测。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'

const FILE = 'G:\\demo map\\scripts\\m5\\gate-wo17-post-identity.mjs'
const BACKUP = 'G:\\demo map\\tools\\tmp\\gate-wo17.before-reply-sample.txt'

let src = readFileSync(FILE, 'utf8')
if (!existsSync(BACKUP)) copyFileSync(FILE, BACKUP)

if (src.includes('postsWithReplies')) {
  console.log('  已存在 postsWithReplies（幂等）')
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

// ① 期望值阶段：额外找出"有回复的动态"
replaceOnce(
  '    return { ok: true, items: out }',
  `    /*
      ⭐ WO#19：额外找出**确实带回复**的动态（用于嵌套断言）。
        判据来自**服务端**：该动态的评论里存在 parentId 非空者 ⇒ 有嵌套可测。
        ⚠️ 不硬编码 id —— 换种子后本段仍然有效。
    */
    const postsWithReplies = []
    for (const p of out) {
      const cr = await fetch('\${API}/api/posts/' + encodeURIComponent(p.id) + '/comments')
      if (!cr.ok) continue
      const cj = await cr.json()
      const hasReply = (cj.items || []).some((c) => (c.replies || []).length > 0)
      if (hasReply) postsWithReplies.push(p.id)
    }
    return { ok: true, items: out, postsWithReplies }`,
  '期望值阶段补 postsWithReplies',
)

// ② 嵌套断言改用带回复的动态
replaceOnce(
  `  REPLIES_NESTED_IN_PARENT: (() => {
    const view = feedReal || commentsReal
    if (!view || !view.nested) return 'INCONCLUSIVE'
    const n = view.nested
    if (n.containers === 0 || n.allReplies === 0) {
      // 该动态没有"带回复的评论" ⇒ 本夹具无样本，不假装通过
      return 'INCONCLUSIVE'
    }
    return n.flat === 0 && n.nested === n.allReplies ? 'PASS' : 'FAIL'
  })(),`,
  `  REPLIES_NESTED_IN_PARENT: (() => {
    /*
      ⭐ 观测点改为**确实带回复**的那条动态（从 API 推导，不硬编码）。
      ⚠️ 上一版绑在 feedReal（= exp.items[0]，实测 total=0）⇒ 没样本 ⇒ INCONCLUSIVE。
    */
    const view = replyPostView
    if (!view || !view.nested) return 'INCONCLUSIVE'
    const n = view.nested
    if (n.containers === 0 || n.allReplies === 0) {
      // 服务端确实没有任何回复样本 ⇒ 不假装通过
      return 'INCONCLUSIVE'
    }
    return n.flat === 0 && n.nested === n.allReplies ? 'PASS' : 'FAIL'
  })(),`,
  '嵌套断言改用带回复的动态',
)

// ③ 采集：为带回复的动态单独取一次页面
replaceOnce(
  'if (zeroComment) {',
  `/*
  ⭐ WO#19：为"带回复的动态"单独取一次页面（嵌套断言的观测样本）。
    若服务端没有这样的样本 ⇒ replyPostView 为 null ⇒ 该键 INCONCLUSIVE。
*/
let replyPostView = null
const replyPostId = exp && exp.postsWithReplies ? exp.postsWithReplies[0] : null
if (replyPostId) {
  replyPostView = await goto(\`#/feed?id=\${replyPostId}\`)
  log('FEED_WITH_REPLIES', replyPostView)
}
if (zeroComment) {`,
  '采集带回复动态的页面',
)

// ④ detail 里记录样本情况
replaceOnce(
  '    zeroComment: zeroComment ? { id: zeroComment.id, total: zeroComment.total } : null,',
  `    zeroComment: zeroComment ? { id: zeroComment.id, total: zeroComment.total } : null,
    replyPostId: replyPostId || null,
    replyPostView: replyPostView || null,`,
  'detail 记录回复样本',
)

writeFileSync(FILE, src, 'utf8')
console.log('  已写回（备份：tools/tmp/gate-wo17.before-reply-sample.txt）')
