/**
 * 受控突变：把"标记卡片的**数据来源**"重新接错到 **mock**，重现 Round 266 那个真实回归
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么突变要**忠实重现历史 bug**，而不是随便把值弄空
 * ════════════════════════════════════════════════════════════════════
 *   审核 59 的原话要求是：
 *     "做 sensitivity，证明以后把卡片**重新接错到 mock 或错误 post** 时 Gate 必然会红。"
 *   ⇒ 所以要突变的**不是"值变空"这个结果**，而是**"数据来源接错"这个原因**。
 *     只把值弄空能证明"断言对空值敏感"，但证明不了"断言能抓出接错源" ——
 *     而后者才是真正要防的（将来有人可能又写 posts.find(...) 去 mock 里查）。
 *
 *   本突变把实现**逐字还原成改前那段代码**：
 *     · 加回 import { posts } from '../data/mock'
 *     · const cover = m.coverUrl  →  const post = posts.find((p) => p.id === m.postId) + const cover = post?.images[0]
 *     · (m.excerpt ?? '').slice(0, 10)  →  (post?.text ?? '').slice(0, 10)
 *   因为 m.postId 现在是**真实帖子的 UUID**，而 mock 里的 id 是 p1/p2…，
 *   那个 find **必然 undefined** ⇒ 卡片封面与文字都空 ⇒ 断言必须变红。
 *
 * ════════════════════════════════════════════════════════════════════
 * 用法
 * ════════════════════════════════════════════════════════════════════
 *   node scripts/m5/mutate-card-content.mjs inject    # 注入（会先备份）
 *   node scripts/m5/mutate-card-content.mjs restore   # 还原（并删除备份）
 *
 * ⚠️ 突变必须保证**语法有效**：我第一版生成过 span.textContent = '')（多一个右括号），
 *    ⇒ tsc 失败 ⇒ 构建失败 ⇒ 自测在②阶段中断。
 *    那会让自测验的是"构建会不会崩"，而**不是**"断言能不能红" —— 两件完全不同的事。
 *    所以本脚本对每一处替换都断言"确实发生了"（未命中即报错退出，不静默什么都不改）。
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'

const FILE = 'G:\\demo map\\app\\src\\native\\TencentMap.tsx'
const ORIG = 'G:\\demo map\\tools\\tmp\\TencentMap.orig.txt'
const mode = process.argv[2]

/** 逐条替换；任何一条没命中就报错退出（避免"静默什么都没改"却当成突变成功） */
function replaceAll(src, pairs) {
  let out = src
  const missed = []
  for (const [from, to] of pairs) {
    if (!out.includes(from)) {
      missed.push(from)
      continue
    }
    out = out.replace(from, to)
  }
  if (missed.length) {
    console.error('FAIL 以下目标字符串未命中（说明实现已变化，需先确认）：')
    for (const m of missed) console.error('   · ' + m)
    process.exit(1)
  }
  return out
}

if (mode === 'inject') {
  const src = readFileSync(FILE, 'utf8')
  if (!existsSync(ORIG)) writeFileSync(ORIG, src, 'utf8')

  const out = replaceAll(src, [
    // ① 重新引入 mock 依赖 —— 这一步是"接错源"的本体
    [
      "import { hasTencentKey, TENCENT_MAP_KEY } from './keys'",
      "import { hasTencentKey, TENCENT_MAP_KEY } from './keys'\nimport { posts } from '../data/mock'",
    ],
    // ② 把封面的权威来源换成"去 mock 里查帖子"
    [
      'const cover = m.coverUrl',
      'const post = posts.find((p) => p.id === m.postId)\n  const cover = post?.images[0]',
    ],
    // ③ 把正文片段的权威来源也换成 mock 帖子
    ["span.textContent = (m.excerpt ?? '').slice(0, 10)", "span.textContent = (post?.text ?? '').slice(0, 10)"],
  ])
  writeFileSync(FILE, out, 'utf8')
  console.log('  已注入突变：卡片数据来源**重新接错到 mock**（还原成改前那段代码）')
} else if (mode === 'restore') {
  if (!existsSync(ORIG)) {
    console.error('FAIL 没有备份文件，无法还原')
    process.exit(1)
  }
  writeFileSync(FILE, readFileSync(ORIG, 'utf8'), 'utf8')
  /*
    ⚠️ 还原后**顺手删掉备份**：否则 tools/tmp 里会留一个"看起来像源码"的副本，
    下次可能有人把它当成真实文件。本项目对"残留物被后来的人当真"已有多次教训
    （mock 数据被当成真实地点、旧快照被当成权威索引、mock 自己身份被渲染到界面…）。
  */
  rmSync(ORIG, { force: true })
  console.log('  已从备份还原 TencentMap.tsx，并删除备份文件')
} else {
  console.error('用法：node mutate-card-content.mjs inject|restore')
  process.exit(2)
}
