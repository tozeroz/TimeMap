#!/usr/bin/env node
/**
 * UI → 数据源清单：**机械生成** + **漂移检查**（`UI_DATA_SOURCE_INVENTORY`）
 *
 * ## 为什么要把它机械化
 *   本项目已有一份 `docs/m5/UI-DATA-SOURCE-INVENTORY.md`（审核记录 44 要求建立），
 *   它的用途是"**挑下一个工作单时，优先看高频页面仍是 mock 的条目**"。
 *   但它写在"WO#8 之后"，之后 WO#11/12/13/14/15 已经把其中**多屏从 mock 改成了权威**，
 *   而文档**没有同步** —— 于是它现在会**误导下一个工作单的选择**
 *   （例如它仍把 MapScreen / FeedListScreen / UserProfileScreen / ProfileEditScreen
 *     列为"纯 mock"，而这几屏**都已经接线完成**）。
 *
 *   ⚠️ 这正是本会话反复吃到的同一个坑：**引用了过期的来源**。
 *      文档自身也写了维护规则（"新增屏幕必须登记"），但**规则是手动的** ⇒ 必然漂移。
 *
 * ## 本脚本做什么
 *   ① 扫 `app/src/screens/*.tsx`，对每屏提取：
 *        · 从 `../data/mock` 导入的**符号名**（比"有没有 import"信息量大得多 ——
 *          一屏可能只 import 一个静态标签，也可能整屏数据都是 mock）
 *        · 从 `../api/*` 导入的**符号名**
 *   ② 分类：
 *        `api-only`    只引 api
 *        `mock+api`    两者都引（混合，需要人看具体符号）
 *        `mock-only`   只引 mock（**最可疑**：整屏数据可能都是假的）
 *        `none`        两者都不引（静态页）
 *   ③ `--check`：与 `docs/m5/UI-DATA-SOURCE-INVENTORY.md` 里记录的**快照**比对，
 *      不一致就报告"文档已过期"并列出差异（机械可查 ⇒ 规则不再靠自觉）
 *   ④ `--write`：把当前状态写回文档的"机器可读快照"区块（**只改那一段**，
 *      不动人写的历史与结论 —— 与"保留历史"的纪律一致）
 *
 * ## ⚠️ 边界（不夸大）
 *   · 它只做**静态 import 分析**，**不判断"这个符号是不是业务数据"**。
 *     例如一屏 import 了 mock 只为了拿一个静态标题，也会被算作 `mock-only`。
 *     ⇒ 所以它是**线索排序工具**，不是结论。真正的判定要读符号用法。
 *   · 它不覆盖 `app/src/components/*`（组件也可能 import mock）。
 *     若要做全量，应把扫描范围扩到整个 `app/src`（本脚本留了 `--all` 开关）。
 *
 * 用法：
 *   node scripts/m5/ui-data-source-inventory.mjs            # 打印当前状态
 *   node scripts/m5/ui-data-source-inventory.mjs --check    # 与文档快照比对
 *   node scripts/m5/ui-data-source-inventory.mjs --write    # 写回文档快照区块
 *   node scripts/m5/ui-data-source-inventory.mjs --all      # 扫描 app/src 全部（不只 screens/）
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'app/src/screens'
const DOC = 'docs/m5/UI-DATA-SOURCE-INVENTORY.md'
const MARK_BEGIN = '<!-- BEGIN:MACHINE-SNAPSHOT -->'
const MARK_END = '<!-- END:MACHINE-SNAPSHOT -->'

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const WRITE = argv.includes('--write')
const ALL = argv.includes('--all')

/**
 * 提取某文件里 `from '<mod>'` 的**具名导入**，并区分 **type-only** 与 **值导入**
 *
 * ## ⭐ 为什么必须区分（这一区分让清单从"线索"变成"可判定"）
 *   第一版只统计"有没有从 mock 导入"。结果显示 `MapScreen` / `FeedListScreen` /
 *   `UserProfileScreen` 都是 `mock+api` —— 看起来"仍在用 mock 数据"。
 *   但实际读源码后发现它们导的是 **类型**：
 *     `import type { MapMarker } from '../data/mock'`（WO#15 我自己写的）
 *     `import { FeedPost } from '../data/mock'`（类型别名 FeedPost）
 *   **类型在运行时不存在**，不构成"用假数据"。若不区分，就会把"已经接完权威的屏"
 *   标成"仍在用 mock"，从而**误导下一个工作单的选择** —— 恰好是这份清单存在的目的。
 *   ⇒ 所以：`type` 前缀的导入单独记一列，且**不计入**"有 mock 数据"的判定。
 *
 * 返回 { values: [...], types: [...] }
 */
function namedImports(src, modPattern) {
  const values = []
  const types = []
  /*
    ⚠️⚠️ 两个正则都锚在**行首**（`^[ \t]*` + `m` 标志）—— 这是第一版一个**真实 bug 的修复**：
      第一版用 `import\s+...from\s*'...'` **全文匹配**，于是把**注释里**写的 import 也算了进去：
        · `MessageScreen.tsx` 注释里写着「此前是 import { users, type User } from '../data/mock'」
          → 被误判成"仍在导入 mock"
        · `FeedListScreen.tsx` 注释里写着「整页读 mock（import { posts } from '../data/mock'）」
          → 被误判成"仍在导入 mock 的 posts"
      核对真实 `^import ` 行后确认：**这两屏都没有 mock 值导入**
      （MessageScreen 完全没有；FeedListScreen 只有 `import type { FeedPost }`）。
      ⇒ 这个 bug 会把"**已经接完权威的屏**"报成"仍在用 mock"，
        而本清单的**唯一用途**正是"挑下一个工作单时先看还在用 mock 的屏" ⇒ **会选错单**。
      为什么用"行首锚定"而不是"剥注释"：剥注释要正确处理字符串里的 `//`（如 `https://`），
      容易引入新 bug；而本仓库真实 import **一律在行首**（已核对）。
    ⚠️ 同类问题本会话出现**四次**，全都是"分析/书写文本时把非代码内容当成了代码"：
      ① JSDoc 里写 `screens/*` + `/baseline.json` ⇒ 其中的"星号加斜杠"提前结束注释；
      ② SQL 注释里用反引号 ⇒ 提前结束外层模板字面量；
      ③ 注释里写的 import 语句被当成真 import（本脚本第一版）；
      ④ ⭐ **就在写这段注释时**：我在注释里"引用"了第 ① 条要避免的那个字符组合，
         结果它**又一次提前结束了本块注释** —— 我在解释这个坑的注释里踩了同一个坑。
      ⇒ 纪律：**在注释/字符串里"引用"会导致提前结束的字符序列时，
        必须改写描述方式**（说"星号加斜杠"而不要真的写出来）。这不是"小心一点"能覆盖的，
        因为它**在语法层面静默成立**、只在别处报错（本次 Node 把错误报到了后面的正则那一行）。
  */
  // import type { A, B } from '...'
  const reType = new RegExp(`^[ \\t]*import\\s+type\\s+\\{([^}]*)\\}\\s*from\\s*'${modPattern}'`, 'gm')
  let m
  while ((m = reType.exec(src))) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim()
      if (name) types.push(name)
    }
  }
  // import { A, type B } from '...'   —— 混合形式，逐项判断（同样只认行首）
  const reMixed = new RegExp(`^[ \\t]*import\\s+\\{([^}]*)\\}\\s*from\\s*'${modPattern}'`, 'gm')
  while ((m = reMixed.exec(src))) {
    for (const raw of m[1].split(',')) {
      const item = raw.trim()
      if (!item) continue
      const isType = /^type\s+/.test(item)
      const name = item.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (!name) continue
      ;(isType ? types : values).push(name)
    }
  }
  return { values: [...new Set(values)].sort(), types: [...new Set(types)].sort() }
}

/** 默认导入 / 命名空间导入（`import x from`、`import * as x from`）也要算上 */
function defaultImports(src, modPattern) {
  const out = []
  const re = new RegExp(`import\\s+(?:type\\s+)?([A-Za-z_$][\\w$]*|\\*\\s+as\\s+[A-Za-z_$][\\w$]*)\\s+from\\s*'${modPattern}'`, 'g')
  let m
  while ((m = re.exec(src))) out.push(m[1].replace(/\*\s+as\s+/, '* as ').trim())
  return [...new Set(out)].sort()
}

function scanDir(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .sort()
    .map((f) => {
      const p = join(dir, f)
      const src = readFileSync(p, 'utf8')
      const mockN = namedImports(src, '\\.\\./data/mock')
      const apiN = namedImports(src, '\\.\\./api/[a-zA-Z]+')
      const mockDef = defaultImports(src, '\\.\\./data/mock')
      const apiDef = defaultImports(src, '\\.\\./api/[a-zA-Z]+')
      const mockValues = [...new Set([...mockN.values, ...mockDef])].sort()
      const mockTypes = mockN.types
      const apiValues = [...new Set([...apiN.values, ...apiDef])].sort()

      /*
        分类**只看值导入**：
          api-only   只引 api 值（或只引 mock 的**类型**）
          mock+api   既引 api 值、也引 mock 值
          mock-only  只引 mock 值
          none       两者都没有
        ⚠️ `mock-types` 单独标出来：它表示"这一屏**不依赖 mock 数据**，
           但**把 mock 里的类型当类型用**" —— 那可能是架构上的绑定（例如组件 props
           用了 mock 的类型），值得将来清理，但**不是"假数据"**。
      */
      let kind
      if (mockValues.length && apiValues.length) kind = 'mock+api'
      else if (mockValues.length) kind = 'mock-only'
      else if (apiValues.length) kind = 'api-only'
      else if (mockTypes.length) kind = 'types-only'
      else kind = 'none'
      return { file: f, kind, mockValues, mockTypes, apiValues }
    })
}

const rows = ALL ? scanDir(join('app/src', 'screens')).concat(scanDir(join('app/src', 'components'))) : scanDir(ROOT)

const counts = { 'api-only': 0, 'mock+api': 0, 'mock-only': 0, 'types-only': 0, none: 0 }
for (const r of rows) counts[r.kind]++

/** 机器可读快照：稳定的文本形式（便于 diff） */
function snapshotText() {
  const lines = []
  lines.push(`扫描范围：${ALL ? 'app/src/{screens,components}' : ROOT}（${rows.length} 个文件）`)
  lines.push(`统计：api-only=${counts['api-only']} ／ mock+api=${counts['mock+api']} ／ mock-only=${counts['mock-only']} ／ types-only=${counts['types-only']} ／ none=${counts.none}`)
  lines.push('')
  for (const r of rows) {
    lines.push(`| ${r.file} | ${r.kind} | ${r.mockValues.join(', ') || '—'} | ${r.mockTypes.join(', ') || '—'} | ${r.apiValues.join(', ') || '—'} |`)
  }
  return lines.join('\n')
}

const snap = snapshotText()

console.log('=== UI 数据源盘点（机械生成）===')
console.log(snap)

if (CHECK) {
  console.log()
  console.log('=== --check：与文档快照比对 ===')
  if (!existsSync(DOC)) {
    console.log(`  **FAIL** 找不到 ${DOC}`)
    process.exit(1)
  }
  const doc = readFileSync(DOC, 'utf8')
  const b = doc.indexOf(MARK_BEGIN)
  const e = doc.indexOf(MARK_END)
  if (b < 0 || e < 0) {
    console.log(`  **FAIL** 文档里没有机器快照区块（${MARK_BEGIN} … ${MARK_END}）`)
    console.log('  ⇒ 无法机械比对。请先用 --write 建立该区块。')
    process.exit(1)
  }
  const inDoc = doc.slice(b + MARK_BEGIN.length, e).trim()
  if (inDoc === snap.trim()) {
    console.log('  PASS 文档快照与当前源码一致')
    process.exit(0)
  }
  console.log('  **FAIL** 文档快照**已过期** —— 下面列出差异（- 文档里 / + 现在）')
  const a1 = inDoc.split('\n')
  const a2 = snap.trim().split('\n')
  const setDiff = (x, y) => x.filter((l) => !y.includes(l))
  for (const l of setDiff(a1, a2)) console.log('    - ' + l)
  for (const l of setDiff(a2, a1)) console.log('    + ' + l)
  console.log()
  console.log('  ⇒ 修法：node scripts/m5/ui-data-source-inventory.mjs --write')
  process.exit(1)
}

if (WRITE) {
  console.log()
  if (!existsSync(DOC)) {
    console.log(`  **FAIL** 找不到 ${DOC}`)
    process.exit(1)
  }
  let doc = readFileSync(DOC, 'utf8')
  let b = doc.indexOf(MARK_BEGIN)
  let e = doc.indexOf(MARK_END)
  if (b < 0 || e < 0) {
    // 没有区块 → 追加到文末（**不动**既有的人写内容）
    doc = doc.trimEnd() + `\n\n## 五、机器可读快照（由 scripts/m5/ui-data-source-inventory.mjs --write 生成）\n\n${MARK_BEGIN}\n${snap}\n${MARK_END}\n`
  } else {
    doc = doc.slice(0, b + MARK_BEGIN.length) + '\n' + snap + '\n' + doc.slice(e)
  }
  writeFileSync(DOC, doc, 'utf8')
  console.log(`  已写回 ${DOC}（只改机器快照区块，人写内容保持不动）`)
}
