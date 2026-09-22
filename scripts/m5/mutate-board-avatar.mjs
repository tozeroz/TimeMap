/**
 * 受控突变：把留言板头像**还原成历史实现的"每条都用 mock 自称身份的头像"**
 *
 * ## 为什么必须做（这是补我自己最新门禁的纪律缺口）
 *   `scripts/m5/gate-wo16-board-avatar.mjs`（Round 266 新增，4 键）当时**只跑了 PASS/INCONCLUSIVE，
 *   从未做过敏感度** —— 也就是说它是否"能红"**完全没有被证明**。
 *   而本项目反复强调：**断言必须被证明能红**（否则一条恒真断言也会 PASS）。
 *   我在别处一直执行这条纪律，却漏了自己最新的那个门禁 ⇒ 本文件补上。
 *
 * ## 突变内容（**忠实还原历史 bug**，而不是伪造结果）
 *   改前 BoardScreen 写的是：
 *     <img className="note__avatar" src={me.avatar} alt="" />      ← 每条留言都用**同一个** mock 头像
 *   现在改成了按"该条留言显示的名字"取首字的占位。突变把它**逐字改回去**：
 *     ① 重新加回 `import { boardEmojis, me } from '../data/mock'`
 *     ② 把 <span className="note__avatar note__avatar--ph" …>…</span> 换回 <img className="note__avatar" src={me.avatar} alt="" />
 *   ⇒ 于是"不再有 mock 生成的 img"与"首字占位"两条都应 FAIL。
 *
 * 用法：node scripts/m5/mutate-board-avatar.mjs inject|restore
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'

const FILE = 'G:\\demo map\\app\\src\\screens\\BoardScreen.tsx'
const ORIG = 'G:\\demo map\\tools\\tmp\\BoardScreen.orig.txt'
const mode = process.argv[2]

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
    console.error('FAIL 以下目标字符串未命中（实现已变化，需先确认）：')
    for (const m of missed) console.error('   · ' + m.split('\n')[0])
    process.exit(1)
  }
  return out
}

const AVATAR_SPAN = `<span className="note__avatar note__avatar--ph" aria-hidden data-note-avatar-placeholder>
                  {(n.fromName ?? (n.mine ? '我' : '同学')).trim().slice(0, 1)}
                </span>`

if (mode === 'inject') {
  const src = readFileSync(FILE, 'utf8')
  if (!existsSync(ORIG)) writeFileSync(ORIG, src, 'utf8')
  const out = replaceAll(src, [
    // ① 重新引入 mock 的 me（正是 WO#14 在 MeScreen 修掉的那个编造身份）
    ["import { boardEmojis } from '../data/mock'", "import { boardEmojis, me } from '../data/mock'"],
    // ② 逐字还原改前那段
    [AVATAR_SPAN, '<img className="note__avatar" src={me.avatar} alt="" />'],
  ])
  writeFileSync(FILE, out, 'utf8')
  console.log('  已注入突变：留言板头像**还原成"每条都用 mock 自称身份"**（逐字改回历史实现）')
} else if (mode === 'restore') {
  if (!existsSync(ORIG)) {
    console.error('FAIL 没有备份文件，无法还原')
    process.exit(1)
  }
  writeFileSync(FILE, readFileSync(ORIG, 'utf8'), 'utf8')
  rmSync(ORIG, { force: true })
  console.log('  已从备份还原 BoardScreen.tsx，并删除备份文件')
} else {
  console.error('用法：node mutate-board-avatar.mjs inject|restore')
  process.exit(2)
}
