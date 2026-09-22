/**
 * 受控突变：把 CommentsScreen **恢复成 WO#17 之前的历史实现**
 * （mock 数据源 + `posts.find(...) ?? posts[0]` 静默兜底）
 * —— 用来证明 WO#17 的门禁断言**真的能红**
 *
 * ## 为什么这样突变（而不是随便伪造）
 *   审核 59/60/62 一贯要求：敏感度要证明 Gate 能抓出**"接错数据源 / 丢失实体身份"这个原因**，
 *   而不是"对空值敏感"。所以这里**逐字复现**那三行历史代码的语义：
 *     ```
 *     import { comments, posts } from '../data/mock'
 *     const post = posts.find((p) => p.id === id) ?? posts[0]   ← 身份篡改
 *     const list = comments                                      ← mock 评论（**非空**）
 *     ```
 *
 * ## 预计打红哪几条
 *   `MISSING_ID_NO_ENTITY_LEAK_COMMENTS`  —— `?? posts[0]` 在 id 不存在时会显示 mock 第一条
 *   `SAME_IDENTITY_ACROSS_SCREENS`        —— 显示的是 mock 作者而非服务端作者
 *   `COMMENTS_COUNT_FROM_AUTHORITY`       —— 「评论 N」来自 mock 数组长度
 *   `NO_MOCK_COMMENT_CONTENT`             —— mock 评论非空 ⇒ 0 评论的动态也渲染出评论行
 *   ⭐ 而 `MISSING_ID_NO_ENTITY_LEAK_FEED` 应**仍 PASS**（突变的只有 CommentsScreen）
 *      ⇒ **归因清晰**：突变只打红它该打红的键。
 *
 * ## ⚠️ 实现要点（第一版踩过两个坑，已修）
 *   ① **必须保持 `const r` 的类型形状**：第一版把注入块放在 `resolvePostAndComments` 之前
 *      并提前 `return`，结果下游 `r.state === 'ready'` 的**类型收窄被破坏** ⇒ tsc 报
 *      `Property 'post' does not exist on type '{ state: "not_found"; }'` ⇒ 构建失败。
 *      而"构建失败"会让自测变成**验构建会不会崩**，而不是**验断言能不能红**（我已踩过同类）。
 *      ⇒ 现在改为**替换 `resolvePostAndComments(id)` 这个表达式本身**，
 *        返回一个 `PostResolution` 形状的对象 ⇒ 下游代码一行都不用改。
 *   ② **必须把 mock 的 `comments` 数据加回来**：WO#17 已把它从生产 mock.ts 移出
 *      （→ scripts/m5/fixtures/legacy-comments.json）。所以注入时要重新导出它。
 *      第一版没做这件事（且我的幂等判断写错了）⇒ `legacyMockPosts` 找不到 ⇒ tsc 失败。
 *
 * 用法：node scripts/m5/mutate-wo17-comments-mock.mjs inject|restore
 *       MUT_TARGET="app/src/screens/CommentsScreen.tsx app/src/data/mock.ts"
 */
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'

const SCREEN = 'G:\\demo map\\app\\src\\screens\\CommentsScreen.tsx'
const MOCK = 'G:\\demo map\\app\\src\\data\\mock.ts'
const TARGETS = [SCREEN, MOCK]
const BACKUPS = TARGETS.map((p) => 'G:\\demo map\\tools\\tmp\\' + p.split('\\').pop() + '.orig17.txt')
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
  if (any) console.log(quiet ? '  （回滚）已还原两个源文件' : '  已还原 CommentsScreen.tsx 与 mock.ts')
  return any
}

/** 历史 mock 数据（形状与 mock.ts 的 `Comment` 一致，且**非空** —— 这点对敏感度很关键） */
const LEGACY = `
/* [突变] WO#17 之前的历史 mock 评论数据（现已移出生产 → scripts/m5/fixtures/legacy-comments.json） */
export const legacyComments: { id: string; authorName: string; text: string }[] = [
  { id: 'lc1', authorName: '历史mock甲', text: '这是被移除的 mock 评论一' },
  { id: 'lc2', authorName: '历史mock乙', text: '这是被移除的 mock 评论二' },
]
export const legacyMockPosts: { id: string; authorName: string; body: string }[] = [
  { id: 'lp1', authorName: '历史mock作者', body: '这是被移除的 mock 动态正文' },
]
`

if (mode === 'inject') {
  try {
    TARGETS.forEach((t, i) => {
      if (!existsSync(BACKUPS[i])) copyFileSync(t, BACKUPS[i])
    })

    // ① mock.ts：加回历史 mock 数据导出
    {
      const [src, eol] = norm(readFileSync(MOCK, 'utf8'))
      if (src.includes('export const legacyComments')) throw new Error('mock.ts 已含突变数据（请先 restore）')
      writeFileSync(MOCK, denorm(src.trimEnd() + '\n' + LEGACY, eol), 'utf8')
    }

    // ② CommentsScreen：把**数据源表达式**换成 mock 版本（保持 PostResolution 形状）
    {
      let [src, eol] = norm(readFileSync(SCREEN, 'utf8'))

      const call = 'await resolvePostAndComments(id)'
      if (!src.includes(call)) throw new Error('找不到 resolvePostAndComments 调用')

      const mutated = `await (async (): Promise<PostResolution> => {
      /* [突变] 复现历史 bug：找不到就静默用第一条（identity corruption） + mock 评论 */
      const legacyPost = legacyMockPosts.find((p) => p.id === id) ?? legacyMockPosts[0]
      return {
        state: 'ready',
        post: { id, author: legacyPost.authorName, body: legacyPost.body } as never,
        comments: legacyComments.map((c) => ({
          id: c.id,
          body: c.text,
          authorId: null,
          author: c.authorName,
          createdAt: '2026-09-02T00:00:00.000Z',
          parentId: null,
          replyTo: null,
          replies: [],
        })) as never,
        total: legacyComments.length,
        fromSnapshot: false,
      }
    })()`
      src = src.replace(call, mutated)

      /*
        ⚠️ 需要 `PostResolution` 类型 + mock 数据；**并且必须把 `resolvePostAndComments` 从
           import 里去掉** —— 突变替换掉了它唯一的调用点，留着会触发 TS6133（未使用）
           ⇒ 构建失败 ⇒ 自测会变成"验构建会不会崩"而不是"验断言能不能红"。
           （这正是我在 WO#16 的突变里踩过的**同一类**问题。）
      */
      if (!src.includes('type PostResolution')) {
        src = src.replace(
          "import { resolvePostAndComments } from '../data/postIdentity'",
          "/* [突变] 不再使用共享解析（本突变就是要把数据源换掉） */\nimport type { PostResolution } from '../data/postIdentity'\nimport { legacyComments, legacyMockPosts } from '../data/mock'",
        )
      }
      writeFileSync(SCREEN, denorm(src, eol), 'utf8')
    }

    console.log('  已注入突变：CommentsScreen **数据源接回 mock** + 复现 `?? posts[0]`（渲染结构未动）')
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
  console.error('用法：node mutate-wo17-comments-mock.mjs inject|restore')
  process.exit(2)
}
