/**
 * WO#19 配套：给门禁加一条**回复嵌套**断言（M3 的"决定性证据"）
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么需要这条（审核 65 的要求）
 * ════════════════════════════════════════════════════════════════════
 *   审核 65 说 WO#19 要"保持 parent/reply 嵌套"；
 *   而 M3 证据里 `recovered-m3-nested-reply.png` 被称为"**决定性证据：回复渲染在父评论内部**"。
 *   ⇒ 如果只断言"评论区在 FeedDetail"，无法抓出"回复被**平铺**到顶层"这种退化
 *     —— 而那恰恰是原版与"普通评论列表"的关键区别。
 *
 * ════════════════════════════════════════════════════════════════════
 * 断言怎么做到**可判别**（关键设计）
 * ════════════════════════════════════════════════════════════════════
 *   不仅看"有没有嵌套容器"，而是看**DOM 归属关系**：
 *     每条回复行 `.cmt--reply` 必须**在**其父评论的 `.cmt__replies[data-replies-of=<父id>]`
 *     的**子树内**（用 `parentEl.contains(replyEl)` 判定），
 *     且**不得**出现在该容器之外（否则就是平铺）。
 *   ⚠️ 只数"有没有 replies 容器"是不够的 —— 平铺实现照样可以渲染一个空容器或把回复放在别处。
 *   ⇒ 本断言同时要求：**存在** replies 容器 **且** 其内部确有属于它的回复行。
 *
 * ⚠️ 前置：需要该动态**确实有带回复的评论**，否则记 INCONCLUSIVE（不假装通过）。
 *   本夹具需要一条 **total>0 且有 replies** 的动态 —— 若当前没有，本键会 INCONCLUSIVE 并
 *   在 detail 里说明"缺少样本"，由人判断是否需要造数（我们自己的库里造数是被允许的）。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'

const FILE = 'G:\\demo map\\scripts\\m5\\gate-wo17-post-identity.mjs'
const BACKUP = 'G:\\demo map\\tools\\tmp\\gate-wo17.before-nested-assert.txt'

let src = readFileSync(FILE, 'utf8')
if (!existsSync(BACKUP)) copyFileSync(FILE, BACKUP)

if (src.includes('REPLIES_NESTED_IN_PARENT')) {
  console.log('  已存在 REPLIES_NESTED_IN_PARENT（幂等）')
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

// ① READ：额外采集"回复行是否真的在其父评论容器内"的 DOM 归属关系
replaceOnce(
  "    repliesOf: [...document.querySelectorAll('[data-replies-of]')].map((n) => n.getAttribute('data-replies-of')),",
  `    repliesOf: [...document.querySelectorAll('[data-replies-of]')].map((n) => n.getAttribute('data-replies-of')),
    /*
      ⭐ WO#19：回复的**嵌套归属关系**（不只看"有没有容器"，而是看 DOM 包含关系）。
      flatReplies = 有 .cmt--reply 但**不在**任何 [data-replies-of] 容器内的那些
        ⇒ 非空即说明"回复被平铺到顶层"，应判 FAIL。
    */
    nested: (() => {
      const containers = [...document.querySelectorAll('[data-replies-of]')]
      const allReplies = [...document.querySelectorAll('.cmt--reply')]
      const nestedReplies = allReplies.filter((r) => containers.some((c) => c.contains(r)))
      const flatReplies = allReplies.filter((r) => !containers.some((c) => c.contains(r)))
      return { containers: containers.length, allReplies: allReplies.length, nested: nestedReplies.length, flat: flatReplies.length }
    })(),`,
  'READ 采集回复的嵌套归属关系',
)

// ② 新断言：插在 COMMENTS_COUNT_FROM_AUTHORITY 之前
replaceOnce(
  `  /**
   * 评论区的「评论 N」== API 的评论总数（不读 mock）。`,
  `  /**
   * ⭐ WO#19：**回复必须嵌套在父评论内部**（M3 的"决定性证据"）。
   *   判据：存在 [data-replies-of] 容器，且其中的回复行**确实**是该容器的后代
   *        （父评论行 .cmt 之内），**且不得**有"不在任何容器内"的回复行。
   *   ⚠️ 这比"有嵌套容器"更强：平铺实现可能渲染空容器或把回复放在容器外。
   *   ⚠️ 需要**有回复的样本**；没有样本 ⇒ INCONCLUSIVE（不假装通过）。
   */
  REPLIES_NESTED_IN_PARENT: (() => {
    const view = feedReal || commentsReal
    if (!view || !view.nested) return 'INCONCLUSIVE'
    const n = view.nested
    if (n.containers === 0 || n.allReplies === 0) {
      // 该动态没有"带回复的评论" ⇒ 本夹具无样本，不假装通过
      return 'INCONCLUSIVE'
    }
    return n.flat === 0 && n.nested === n.allReplies ? 'PASS' : 'FAIL'
  })(),
  /**
   * 评论区的「评论 N」== API 的评论总数（不读 mock）。`,
  '新增 REPLIES_NESTED_IN_PARENT 断言',
)

// ③ 进 KEYS
replaceOnce(
  "  'COMMENTS_INLINE_IN_FEED',",
  "  'COMMENTS_INLINE_IN_FEED',\n  'REPLIES_NESTED_IN_PARENT',",
  'KEYS 加 REPLIES_NESTED_IN_PARENT',
)

// ④ 文档注释同步：改由 edit 工具单独补（本脚本不再处理）

writeFileSync(FILE, src, 'utf8')
console.log('  已写回 gate-wo17-post-identity.mjs（备份：tools/tmp/gate-wo17.before-nested-assert.txt）')