/**
 * 受控突变（WO#19 重定向版）：把 **FeedDetailScreen 的评论区**退回"历史 topology"
 * —— 用来证明 WO#17/WO#19 的门禁断言**真的能红**
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么必须重定向（上一版已失效）
 * ════════════════════════════════════════════════════════════════════
 *   上一版 `mutate-wo17-comments-mock.mjs` 突变的是 `CommentsScreen.tsx` ——
 *   而那个文件已按审核 65 在 WO#19 里**删除** ⇒ 旧突变**必然失败**。
 *   ⇒ 现在改为在 **FeedDetailScreen** 上复现当时那三处缺陷（它们正是门禁要守的东西）。
 *
 * ════════════════════════════════════════════════════════════════════
 * 复现的三处缺陷（与历史形态一致）
 * ════════════════════════════════════════════════════════════════════
 *   ① **数据源接回 mock**：评论列表改读 mock（mock 的 comments 是**非空**的）
 *      ⇒ `NO_MOCK_COMMENT_CONTENT`（0 评论动态应显示空态）应变红
 *      ⇒ `COMMENTS_COUNT_FROM_AUTHORITY`（「评论 N」== API 总数）应变红
 *   ② **回复平铺**：把回复渲染到 `[data-replies-of]` 容器**之外**（顶层）
 *      ⇒ `REPLIES_NESTED_IN_PARENT` 应变红（其判据是 **DOM 归属**，不是"有没有容器"）
 *   ③ **「评论 N」标题消失**：评论区不再渲染 `.feed__comments-title`
 *      ⇒ `COMMENTS_INLINE_IN_FEED`（要求同页出现动态正文 + 「评论 N」）应变红
 *   ⭐ 而 `MISSING_ID_NO_ENTITY_LEAK_*`（不存在的 id 不得显示真实动态正文）**预计仍 PASS**
 *      —— 因为本突变**没有**动"按 id 取动态"的路径（那是 WO#17 已修好的）。
 *      **归因清晰**：突变只打红它该打红的键。
 *
 * ════════════════════════════════════════════════════════════════════
 * 实现要点（前几版踩过的坑都规避）
 * ════════════════════════════════════════════════════════════════════
 *   · **只换数据源/渲染归属，不改整体结构** ⇒ "红"精确归因到本 WO 守的东西
 *   · 注入后**必须通过 tsc**（否则验的是"构建会不会崩"，不是"断言能不能红"）
 *     ⇒ 用 `void` 显式引用因突变而变未使用的变量（避免 TS6133）
 *   · 失败**先回滚再退出**；锚点全部命中才写回
 *
 * 用法：node scripts/m5/mutate-wo19-comments-topology.mjs inject|restore
 *       MUT_TARGET="app/src/screens/FeedDetailScreen.tsx app/src/data/mock.ts"
 */
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'

const SCREEN = 'G:\\demo map\\app\\src\\screens\\FeedDetailScreen.tsx'
const MOCK = 'G:\\demo map\\app\\src\\data\\mock.ts'
const TARGETS = [SCREEN, MOCK]
const BACKUPS = TARGETS.map((p) => 'G:\\demo map\\tools\\tmp\\' + p.split('\\').pop() + '.orig19.txt')
const mode = process.argv[2]

function norm(text) {
  const crlf = text.includes('\r\n')
  return [crlf ? text.replace(/\r\n/g, '\n') : text, crlf ? '\r\n' : '\n']
}
function denorm(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}
function restoreAll(quiet) {
  let any = false
  TARGETS.forEach((t, i) => {
    if (existsSync(BACKUPS[i])) {
      writeFileSync(t, readFileSync(BACKUPS[i], 'utf8'), 'utf8')
      rmSync(BACKUPS[i], { force: true })
      any = true
    }
  })
  if (any) console.log(quiet ? '  （回滚）已还原两个源文件' : '  已还原 FeedDetailScreen.tsx 与 mock.ts')
  return any
}

/** 历史 mock 评论（**非空** —— 这点对 `NO_MOCK_COMMENT_CONTENT` 的判别力很关键） */
const LEGACY = `
/* [突变] WO#19 之前的历史 mock 评论数据（现已移出生产 → scripts/m5/fixtures/legacy-comments.json） */
export const legacyCommentsForMut: { id: string; authorName: string; text: string }[] = [
  { id: 'lc1', authorName: '历史mock甲', text: '这是被移除的 mock 评论一' },
  { id: 'lc2', authorName: '历史mock乙', text: '这是被移除的 mock 评论二' },
]
`

if (mode === 'inject') {
  try {
    TARGETS.forEach((t, i) => {
      if (!existsSync(BACKUPS[i])) copyFileSync(t, BACKUPS[i])
    })

    // ① mock.ts：加回历史 mock 评论
    {
      const [src, eol] = norm(readFileSync(MOCK, 'utf8'))
      if (src.includes('legacyCommentsForMut')) throw new Error('mock.ts 已含突变数据（请先 restore）')
      writeFileSync(MOCK, denorm(src.trimEnd() + '\n' + LEGACY, eol), 'utf8')
    }

    // ② FeedDetailScreen：复现三处缺陷
    {
      let [src, eol] = norm(readFileSync(SCREEN, 'utf8'))

      // 2a 导入 mock 数据
      const impAnchor = "import { resolvePostAndComments } from '../data/postIdentity'"
      if (!src.includes(impAnchor)) throw new Error('找不到 postIdentity import 锚点')
      src = src.replace(
        impAnchor,
        "/* [突变] 接回历史 mock 数据源 */\nimport { legacyCommentsForMut } from '../data/mock'\n" + impAnchor,
      )

      // 2b 评论列表改为 mock（②「评论 N」标题消失 + ① 数据源接回 mock）
      const secStart = '      <section className="feed__comments">'
      const i = src.indexOf(secStart)
      if (i < 0) throw new Error('找不到 feed__comments 段')
      // 该 section 的结束：其后第一个 "      </section>"
      const j = src.indexOf('      </section>', i)
      if (j < 0) throw new Error('找不到 feed__comments 段的结束')
      const newSection = `      {/* [突变] 复现历史 topology：不再内联渲染真评论区 */}
      <section className="feed__comments" data-mutated-comments>
        {legacyCommentsForMut.map((c) => (
          <div key={c.id} className="cmt">
            <div className="cmt__body">
              <div className="cmt__name">{c.authorName}</div>
              <p className="cmt__text">{c.text}</p>
            </div>
          </div>
        ))}
        {/* [突变] 回复被**平铺**到顶层（不在任何 [data-replies-of] 容器内） */}
        <div className="cmt cmt--reply">
          <div className="cmt__body">
            <p className="cmt__text">这是被平铺的历史 mock 回复</p>
          </div>
        </div>
      </section>`
      src = src.slice(0, i) + newSection + src.slice(j + '      </section>'.length)

      // 2c `void` 引用因突变而未使用的变量（保持"注入后能过 tsc"）
      /*
        ⚠️ 锚点必须**确定存在**：第一版我用 `const count = `，而文件里没有它 ⇒ 没插入
           ⇒ 注入后 TS6133（comments/total 未使用）⇒ 构建失败。
           而"构建失败"会让自测变成**验构建会不会崩**，不是**验断言能不能红**。
        ⇒ 改用状态声明块里**必然存在**的一行作锚点。
      */
      const stateAnchor = "  const [replyDraft, setReplyDraft] = useState('')"
      const k = src.indexOf(stateAnchor)
      if (k < 0) throw new Error('找不到插入 void 引用的锚点（replyDraft 声明）')
      src =
        src.slice(0, k + stateAnchor.length) +
        "\n\n  /* [突变] 以下变量在本突变下不再被渲染分支使用，显式引用以过 tsc */\n  void comments\n  void total\n  void replyTo\n  void replyDraft" +
        src.slice(k + stateAnchor.length)

      writeFileSync(SCREEN, denorm(src, eol), 'utf8')
    }

    console.log('  已注入突变：FeedDetail 评论区退回历史 topology（mock 数据 + 平铺回复 + 无「评论 N」标题）')
  } catch (err) {
    console.error('FAIL ' + String(err && err.message))
    restoreAll(true)
    process.exit(1)
  }
} else if (mode === 'restore') {
  if (!restoreAll(false)) {
    console.error('FAIL 没有备份文件，无法还原')
    process.exit(1)
  }
} else {
  console.error('用法：node mutate-wo19-comments-topology.mjs inject|restore')
  process.exit(2)
}
