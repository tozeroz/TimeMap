/**
 * 敏感度实验辅助：把"标记卡片内容"改回**空**，模拟 Round 266 那个回归
 *
 * 目的（这是本次实验的核心）：证明我新加的断言
 *   `MARKER_CARD_CONTENT_FROM_AUTHORITY` **真的能红** ——
 *   即：把卡片内容退化回"空"时，它必须 FAIL。
 * 若它在这种情况下仍然 PASS，那它就是一条**没有判别力**的断言
 * （本项目已多次强调：断言必须被证明能红）。
 *
 * 用法：node tools/tmp/mutate-card-content.mjs inject   # 注入突变
 *       node tools/tmp/mutate-card-content.mjs restore  # 还原（从 .orig 备份）
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'

const FILE = 'G:\\demo map\\app\\src\\native\\TencentMap.tsx'
const ORIG = 'G:\\demo map\\tools\\tmp\\TencentMap.orig.txt'
const mode = process.argv[2]

if (mode === 'inject') {
  const src = readFileSync(FILE, 'utf8')
  if (!existsSync(ORIG)) writeFileSync(ORIG, src, 'utf8')
  // ① 封面 → undefined（等价于"mock 里查不到帖子"）
  let out = src.replace('const cover = m.coverUrl', 'const cover = undefined')
  // ② 正文片段 → 空串（旧代码是 (post?.text ?? '')，帖子查不到时就是空串）
  //    ⚠️ 我第一版写成 `"''')"`（多了一个右括号）→ 生成 `span.textContent = '')`
  //       ⇒ tsc 报 TS1005 ⇒ 构建失败 ⇒ 自测在②阶段就中断。
  //       教训：**突变本身也要保证语法有效** —— 否则验的不是"断言能不能红"，
  //       而是"构建会不会崩"，两者是完全不同的问题。
  const before = out
  out = out.replace("(m.excerpt ?? '').slice(0, 10)", "''")
  if (out === before) {
    console.error('FAIL 文本片段那一处没有替换成功（目标字符串变了？）')
    process.exit(1)
  }
  if (out === src) {
    console.error('FAIL 没有发生任何替换 —— 说明目标字符串不在文件里（先确认实现）')
    process.exit(1)
  }
  writeFileSync(FILE, out, 'utf8')
  console.log('  已注入突变：cover=undefined ／ excerpt 片段=空串')
} else if (mode === 'restore') {
  if (!existsSync(ORIG)) {
    console.error('FAIL 没有备份文件，无法还原')
    process.exit(1)
  }
  writeFileSync(FILE, readFileSync(ORIG, 'utf8'), 'utf8')
  /*
    ⚠️ 还原后**顺手删掉备份**：否则 tools/tmp 里会留一个"看起来像源码"的副本，
    下次可能有人把它当成真实文件。本项目对"残留物被后来的人当真"已有多次教训
    （例如 mock 数据被当成真实地点、旧快照被当成权威索引）。
  */
  rmSync(ORIG, { force: true })
  console.log('  已从备份还原 TencentMap.tsx，并删除备份文件')
} else {
  console.error('用法：node mutate-card-content.mjs inject|restore')
  process.exit(2)
}
