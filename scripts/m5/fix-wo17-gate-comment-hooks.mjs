/**
 * WO#19 配套（补完）：把门禁里那两条**仍读旧屏钩子**的断言，改成读
 * **FeedDetail 真实评论表面的 markup**
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么上一版重定向后会 INCONCLUSIVE（这是我自己的疏漏，如实说明）
 * ════════════════════════════════════════════════════════════════════
 *   上一版我把这两条的**导航**迁到了 `#/feed`，但它们仍读：
 *     `[data-cd-count]`（「评论 N」）与 `[data-cd-state]`（空态）
 *   —— 那些 `data-cd-*` 钩子是我当初为 **CommentsScreen** 加的。
 *   FeedDetail 的评论表面用的是**它自己的** markup：
 *     `<h3 className="feed__comments-title">评论 {total}</h3>`
 *     `<p className="feed__noComments">还没有评论，来说点什么吧</p>`
 *   ⇒ 于是两条断言读不到值 ⇒ INCONCLUSIVE（**诚实**，不是假 PASS）。
 *   ⚠️ 教训（与本项目反复出现的同一类）：**迁观测点时，必须一并迁"读取的具体节点"** ——
 *      只迁 URL 不迁选择器，就会得到"看似迁移完成、实则读不到"的结果。
 *      INCONCLUSIVE 而不是 PASS，说明这次至少没有伪装成通过。
 *
 * 用途：让 WO#17 的四条不变量在**新表面**上都能被判为 PASS/FAIL，而不是读不到。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'

const FILE = 'G:\\demo map\\scripts\\m5\\gate-wo17-post-identity.mjs'
const BACKUP = 'G:\\demo map\\tools\\tmp\\gate-wo17.before-hookfix.txt'

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

// ① READ：补上 FeedDetail 真实评论表面的读取（保留旧钩子以向后兼容）
replaceOnce(
  `  return {
    hash: location.hash,
    cdState: el ? el.getAttribute('data-cd-state') : null,
    author: q('[data-cd-author]') ? q('[data-cd-author]').getAttribute('data-cd-author') : null,
    countText: q('[data-cd-count]') ? q('[data-cd-count]').innerText.replace(/\\s+/g,' ').trim() : null,
    cmtBodies: [...document.querySelectorAll('[data-cmt-body]')].map(e=>e.getAttribute('data-cmt-body')),
    text: txt.replace(/\\s+/g,' ').trim().slice(0, 600),
    hasHooks: !!q('[data-cd-state]') || !!q('[data-cd-count]') || !!q('[data-cd-author]'),
  }`,
  `  /*
    ⭐ WO#19：评论区的观测点已迁到 **FeedDetail 的真实评论表面** ——
      它的 markup 是 feed__comments-title（「评论 N」）与 feed__noComments（空态），
      **不是** 我为旧 CommentsScreen 加的 data-cd-* 钩子。
      ⚠️ 两类都读，按优先级取：FeedDetail 的真实节点优先，旧钩子作后备。
  */
  const ft = q('.feed__comments-title')
  const fn = q('.feed__noComments')
  const legacyCount = q('[data-cd-count]')
  return {
    hash: location.hash,
    cdState: el ? el.getAttribute('data-cd-state') : fn ? 'empty' : null,
    author: q('[data-cd-author]') ? q('[data-cd-author]').getAttribute('data-cd-author') : null,
    countText: (ft || legacyCount) ? (ft || legacyCount).innerText.replace(/\\s+/g,' ').trim() : null,
    hasCommentTitle: !!ft,
    hasNoCommentsText: !!fn,
    cmtBodies: [...document.querySelectorAll('.cmt[data-comment-id]')].map((n) => (n.querySelector('.cmt__text')||{}).innerText || ''),
    repliesOf: [...document.querySelectorAll('[data-replies-of]')].map((n) => n.getAttribute('data-replies-of')),
    text: txt.replace(/\\s+/g,' ').trim().slice(0, 600),
    hasHooks: !!q('[data-cd-state]') || !!q('[data-cd-count]') || !!q('[data-cd-author]') || !!ft,
  }`,
  'READ 补上 FeedDetail 评论表面的读取',
)

// ② COMMENTS_COUNT_FROM_AUTHORITY：改为在 feedReal 上判（不再用已删的 commentsReal 语义）
replaceOnce(
  `  COMMENTS_COUNT_FROM_AUTHORITY:
    !commentsReal || !exp || !commentsReal.countText
      ? 'INCONCLUSIVE'
      : Number(String(commentsReal.countText).replace(/[^0-9]/g, '')) ===
          Number(exp.items[0].total)
        ? 'PASS'
        : 'FAIL',`,
  `  /**
   * ⭐ WO#19：观测点 = **FeedDetail 的**「评论 N」（.feed__comments-title）。
   *   ⚠️ 这里修过我上一版的疏漏：上一版仍读旧屏的 data-cd-count ⇒ INCONCLUSIVE。
   *     迁观测点时**必须一并迁读取的具体节点**（只迁 URL 是不够的）。
   */
  COMMENTS_COUNT_FROM_AUTHORITY: (() => {
    const view = feedReal || commentsReal
    if (!view || !exp || !view.countText) return 'INCONCLUSIVE'
    const shown = Number(String(view.countText).replace(/[^0-9]/g, ''))
    return shown === Number(exp.items[0].total) ? 'PASS' : 'FAIL'
  })(),`,
  'COMMENTS_COUNT_FROM_AUTHORITY 改读 FeedDetail 的评论标题',
)

// ③ NO_MOCK_COMMENT_CONTENT：空态判定改用 feed__noComments / .cmt 行数为 0
replaceOnce(
  `        const countOk = String(view.countText || '').includes('评论 0')
        const emptyOk = view.cdState === 'empty' || /留下你的评论吧/.test(String(view.text))
        const noRows = (view.cmtBodies || []).length === 0
        return countOk && emptyOk && noRows ? 'PASS' : 'FAIL'`,
  `        /* ⭐ WO#19：空态与"零评论行"都改在 **FeedDetail 的真实评论表面**上判 */
        const countOk = /评论\\s*0/.test(String(view.countText || ''))
        const emptyOk =
          view.hasNoCommentsText === true || /还没有评论|留下你的评论吧/.test(String(view.text))
        const noRows = (view.cmtBodies || []).length === 0
        return countOk && emptyOk && noRows ? 'PASS' : 'FAIL'`,
  'NO_MOCK_COMMENT_CONTENT 改读 FeedDetail 的空态与零评论行',
)

writeFileSync(FILE, src, 'utf8')
console.log('  已写回（备份：tools/tmp/gate-wo17.before-hookfix.txt）')
