/**
 * WO#19 敏感度暴露的缺陷修复：三条断言的 **INCONCLUSIVE / FAIL 边界搞错了**
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ 敏感度当场抓出的事实（这是它存在的意义）
 * ════════════════════════════════════════════════════════════════════
 *   突变（把 FeedDetail 的评论区退回"mock 数据 + 平铺回复 + 无「评论 N」标题"）后：
 *     COMMENTS_INLINE_IN_FEED:          FAIL ✓ 能红
 *     REPLIES_NESTED_IN_PARENT:         **没红** ✗
 *     COMMENTS_COUNT_FROM_AUTHORITY:    **没红** ✗
 *     NO_MOCK_COMMENT_CONTENT:          **没红** ✗
 *
 * ════════════════════════════════════════════════════════════════════
 * 根因：三条都把**"预期节点不存在"误判成 INCONCLUSIVE**
 * ════════════════════════════════════════════════════════════════════
 *   · `REPLIES_NESTED_IN_PARENT`：`containers === 0` ⇒ 我返回 INCONCLUSIVE（当作"没样本"）。
 *     但**API 已经告诉我这条动态有回复**（它就是从 `postsWithReplies` 里选出来的）
 *     ⇒ "该有容器却没有" 应是 **FAIL**，不是"没样本"。
 *   · `COMMENTS_COUNT_FROM_AUTHORITY`：`countText === null` ⇒ INCONCLUSIVE。
 *     但 API 给了 `total` ⇒ "该有「评论 N」却没有" 应是 **FAIL**。
 *   · `NO_MOCK_COMMENT_CONTENT`：`hasNewHooks` 为 false ⇒ INCONCLUSIVE ——
 *     同样把"整个评论区结构消失"误判成"没样本"。
 *
 * ⭐ **正确原则（值得记进纪律）**：
 *   当 **API/基线已经给出基准**时，"**应有的结构缺失**" = **FAIL**；
 *   `INCONCLUSIVE` 只应用于**基准本身拿不到**的情况（API 取不到、确实没有样本）。
 *   ⚠️ 否则断言会在"实现整个坏掉"时照样报 PASS/INCONCLUSIVE —— 那就是**恒真断言**，
 *      正是 WO#16 那次踩过的同一类问题（断言的作用域错了，与实现错了在输出上无法区分）。
 *
 * ⚠️ 本脚本只改判定逻辑，不改观测点。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'

const FILE = 'G:\\demo map\\scripts\\m5\\gate-wo17-post-identity.mjs'
const BACKUP = 'G:\\demo map\\tools\\tmp\\gate-wo17.before-incon-fix.txt'

let src = readFileSync(FILE, 'utf8')
if (!existsSync(BACKUP)) copyFileSync(FILE, BACKUP)

function replaceOnce(from, to, label) {
  const n = src.split(from).length - 1
  if (n !== 1) {
    console.error(`FAIL [${label}] 命中 ${n} 次（要求恰好 1 次）`)
    process.exit(1)
  }
  src = src.replace(from, to)
  console.log('    · ' + label)
}

// ① REPLIES_NESTED_IN_PARENT：API 说该有回复 ⇒ 容器缺失即 FAIL
replaceOnce(
  `    const view = replyPostView
    if (!view || !view.nested) return 'INCONCLUSIVE'
    const n = view.nested
    if (n.containers === 0 || n.allReplies === 0) {
      // 服务端确实没有任何回复样本 ⇒ 不假装通过
      return 'INCONCLUSIVE'
    }
    return n.flat === 0 && n.nested === n.allReplies ? 'PASS' : 'FAIL'`,
  `    /*
      ⚠️ 本键修过一次"判别力"缺陷（敏感度抓出）：第一版把 containers===0 当作
         "没样本" ⇒ INCONCLUSIVE。但**我们能走到这里，就说明 API 已确认该动态有回复**
         （它选自 exp.postsWithReplies）⇒ "该有嵌套结构却没有" 必须是 **FAIL**。
      ⇒ 只有"服务端确实没有任何带回复的动态可选"时才是 INCONCLUSIVE（此时 view 为 null）。
    */
    const view = replyPostView
    if (!view || !view.nested) return 'INCONCLUSIVE' // 连页面都没取到
    const n = view.nested
    /* API 既然给了带回复的动态（replyPostId 存在）⇒ 页面必须真有嵌套结构 */
    const apiSaidHasReplies = !!replyPostId
    if (n.containers === 0 || n.allReplies === 0) {
      return apiSaidHasReplies ? 'FAIL' : 'INCONCLUSIVE'
    }
    return n.flat === 0 && n.nested === n.allReplies ? 'PASS' : 'FAIL'`,
  'REPLIES_NESTED_IN_PARENT 的 INCONCLUSIVE/FAIL 边界',
)

// ② COMMENTS_COUNT_FROM_AUTHORITY：API 给了 total ⇒ 页面无计数文本即 FAIL
replaceOnce(
  `  COMMENTS_COUNT_FROM_AUTHORITY: (() => {
    const view = feedReal || commentsReal
    if (!view || !exp || !view.countText) return 'INCONCLUSIVE'
    const shown = Number(String(view.countText).replace(/[^0-9]/g, ''))
    return shown === Number(exp.items[0].total) ? 'PASS' : 'FAIL'
  })(),`,
  `  COMMENTS_COUNT_FROM_AUTHORITY: (() => {
    /*
      ⚠️ 本键也修过判别力缺陷：第一版 countText===null 就 INCONCLUSIVE，
         于是"「评论 N」整块消失"反而被判成"没样本"。
      ⇒ API 明确给了 total（是个数）⇒ 页面**必须**有可解析的计数文本，否则 **FAIL**。
    */
    const view = feedReal || commentsReal
    if (!view || !exp) return 'INCONCLUSIVE' // 页面/期望都没拿到
    const apiTotal = Number(exp.items[0].total)
    if (!Number.isFinite(apiTotal)) return 'INCONCLUSIVE'
    if (!view.countText) return 'FAIL' // API 有基准，页面却没有计数文本
    const shown = Number(String(view.countText).replace(/[^0-9]/g, ''))
    return shown === apiTotal ? 'PASS' : 'FAIL'
  })(),`,
  'COMMENTS_COUNT_FROM_AUTHORITY 的 INCONCLUSIVE/FAIL 边界',
)

// ③ NO_MOCK_COMMENT_CONTENT：不再依赖"钩子存在"，而依赖 API 基准
replaceOnce(
  `  NO_MOCK_COMMENT_CONTENT: !zeroComment || !hasNewHooks
    ? 'INCONCLUSIVE'
    : await (async () => {`,
  `  /*
    ⚠️ 本键修过判别力缺陷：第一版要求 \`hasNewHooks\`（钩子存在），
       而突变把整个评论区换掉后钩子全没了 ⇒ hasNewHooks=false ⇒ INCONCLUSIVE
       ⇒ **"评论区被换成 mock"这种最该抓的情况反而没被抓住**。
    ⇒ 改为：只要 **API 给出了 0 评论的动态**，页面就**必须**满足
       「评论 0」+ 空态 + 零评论行；任一不满足即 FAIL。
  */
  NO_MOCK_COMMENT_CONTENT: !zeroComment
    ? 'INCONCLUSIVE'
    : await (async () => {`,
  'NO_MOCK_COMMENT_CONTENT 改为依赖 API 基准',
)

writeFileSync(FILE, src, 'utf8')
console.log('  已写回（备份：tools/tmp/gate-wo17.before-incon-fix.txt）')
