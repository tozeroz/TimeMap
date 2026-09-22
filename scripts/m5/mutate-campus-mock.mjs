/**
 * 受控突变：把 CampusScreen 的"mock 学校切换面板"**还原成历史实现**
 * （用来证明 WO#16 层 A 的门禁断言**真的能红**）
 *
 * ## 为什么突变要"忠实还原历史 bug"，而不是随便伪造
 *   审核 59/60 都强调过：敏感度要证明的是**Gate 能抓出"接错数据源/用了假数据"这个原因**，
 *   而不是"对空值敏感"。所以这里把三处**逐字改回**改前形态：
 *     ① mock.ts 里把已移出的 `campusInfo` / `schools` **加回去**
 *     ② 副标题 → 改回 mock 的学校名（`campusInfo.name`）
 *     ③ 面板   → 改回渲染 `mock.schools` 的 8 个学校（含 region 与 members）
 *     ④ 底部说明 → 改回显示 mock 学校名
 *   预计打红：CAMPUS_SUBTITLE_IS_LITERAL ／ CAMPUS_NO_MOCK_SCHOOL_NAMES ／
 *             CAMPUS_NO_FABRICATED_NUMBERS ／ CAMPUS_PICKER_NO_MOCK_ON_OPEN
 *   ⚠️ 而 CAMPUS_PICKER_ENTRY_PRESENT 应**仍 PASS**（入口本来就在）——
 *      这就是"归因清晰"：突变只打红它该打红的键。
 *
 * ## ⚠️ 本脚本修掉了自己的两个**真实缺陷**（第一版踩的）
 *   ① **换行符**：`CampusScreen.tsx` 是 **CRLF**（实测 305 CRLF / 0 LF），
 *      而 `mock.ts` 是 **LF**。我的多行目标串用 LF 书写 ⇒ 对 CRLF 文件**匹配 0 次**，
 *      于是"面板 → mock 8 校列表"那一步失败。
 *      ⇒ 现在做法：**先把内容统一成 LF 匹配**，替换后再按原文件的换行风格写回。
 *      （同类问题本项目已多次遇到：BOM、CRLF、GBK 控制台——都是"文本层面的隐式差异"）
 *   ② **失败不还原**：第一版在"某处未命中"时直接 `process.exit(1)`，
 *      把工作区留在**半突变状态**（mock.ts 已改、CampusScreen 部分改）。
 *      ⇒ 现在：任何一处失败都会**先尝试还原再退出**，并把"已还原"打出来。
 *
 * 用法：node scripts/m5/mutate-campus-mock.mjs inject|restore
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'

const FILE = 'G:\\demo map\\app\\src\\screens\\CampusScreen.tsx'
const MOCK = 'G:\\demo map\\app\\src\\data\\mock.ts'
const ORIG = 'G:\\demo map\\tools\\tmp\\CampusScreen.before-mut.txt'
const ORIG_MOCK = 'G:\\demo map\\tools\\tmp\\mock.before-mut.txt'
const mode = process.argv[2]

/** 统一成 LF 便于匹配；返回 [normalized, 原文用的换行符] */
function normalized(text) {
  const usesCRLF = text.includes('\r\n')
  return [usesCRLF ? text.replace(/\r\n/g, '\n') : text, usesCRLF ? '\r\n' : '\n']
}
/** 按原换行风格写回 */
function denormalized(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}

const edits = []
function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1
  if (n !== 1) {
    throw new Error(`[${label}] 命中 ${n} 次（要求恰好 1 次）`)
  }
  edits.push(label)
  return src.replace(from, to)
}

function doRestore(quiet) {
  if (!existsSync(ORIG)) {
    if (!quiet) console.error('FAIL 没有备份文件，无法还原')
    return false
  }
  writeFileSync(FILE, readFileSync(ORIG, 'utf8'), 'utf8')
  if (existsSync(ORIG_MOCK)) writeFileSync(MOCK, readFileSync(ORIG_MOCK, 'utf8'), 'utf8')
  rmSync(ORIG, { force: true })
  rmSync(ORIG_MOCK, { force: true })
  if (!quiet) console.log('  已从备份还原 CampusScreen.tsx 与 mock.ts，并删除备份')
  else console.log('  （失败回滚）已还原 CampusScreen.tsx 与 mock.ts')
  return true
}

const LEGACY_PANEL = `function SchoolPickerUnavailable({ onClose }: { onClose: () => void }) {
  return (
    <div className="switcher" data-school-picker="unavailable">
      <div className="switcher__mask" onClick={onClose} />
      <div className="switcher__panel">
        <p className="switcher__empty" data-school-picker-note>
          学校与校区数据尚未接入
        </p>
      </div>
    </div>
  )
}`

const LEGACY_PANEL_MUTATED = `function SchoolPickerUnavailable({ onClose }: { onClose: () => void }) {
  return (
    <div className="switcher">
      <div className="switcher__mask" onClick={onClose} />
      <div className="switcher__panel">
        <ul className="switcher__list no-scrollbar">
          {schools.map((s) => (
            <li key={s.id}>
              <button className="switcher__item" onClick={onClose}>
                <span className="switcher__name">{s.name}</span>
                <span className="switcher__meta">
                  {s.region} · {s.members} 位同学
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}`

if (mode === 'inject') {
  try {
    // 备份（原始字节，不做换行转换）
    if (!existsSync(ORIG)) writeFileSync(ORIG, readFileSync(FILE, 'utf8'), 'utf8')
    if (!existsSync(ORIG_MOCK)) writeFileSync(ORIG_MOCK, readFileSync(MOCK, 'utf8'), 'utf8')

    // ── mock.ts（LF）──
    let [mock, mockEol] = normalized(readFileSync(MOCK, 'utf8'))
    if (!mock.includes('export const schools')) {
      mock = replaceOnce(
        mock,
        '/* schools 8 条已移出（同上的完整说明见上方 campusInfo 处的注释块）→ scripts/m5/fixtures/legacy-schools.json */',
        `export const campusInfo = { name: '北京交通大学', region: '北京市·海淀区', members: '12,486', posts: '38,920' }
export const schools = [
  { id: 's1', name: '北京交通大学', region: '北京市·海淀区', members: '12,486' },
  { id: 's2', name: '清华大学', region: '北京市·海淀区', members: '38,021' },
  { id: 's3', name: '北京大学', region: '北京市·海淀区', members: '42,138' },
  { id: 's4', name: '中国人民大学', region: '北京市·海淀区', members: '28,905' },
  { id: 's5', name: '北京航空航天大学', region: '北京市·海淀区', members: '31,672' },
  { id: 's6', name: '北京师范大学', region: '北京市·海淀区', members: '26,410' },
  { id: 's7', name: '复旦大学', region: '上海市·杨浦区', members: '33,204' },
  { id: 's8', name: '上海交通大学', region: '上海市·闵行区', members: '40,558' },
]`,
        'mock.ts 加回 schools/campusInfo',
      )
      writeFileSync(MOCK, denormalized(mock, mockEol), 'utf8')
    }

    // ── CampusScreen.tsx（CRLF）──
    let [src, eol] = normalized(readFileSync(FILE, 'utf8'))
    src = replaceOnce(
      src,
      "import type { FeedPost } from '../data/mock'",
      "import { campusInfo, schools, type FeedPost } from '../data/mock'",
      '还原 import',
    )
    src = replaceOnce(
      src,
      '<BigTitle title="Campus" sub={CAMPUS_SUBTITLE} onSubClick={() => setPickerOpen(true)} />',
      '<BigTitle title="Campus" sub={campusInfo.name} onSubClick={() => setPickerOpen(true)} />',
      '副标题 → mock 学校名',
    )
    src = replaceOnce(src, LEGACY_PANEL, LEGACY_PANEL_MUTATED, '面板 → mock 8 校列表')
    /*
      ⚠️ 必须**同时**把这个常量去掉：突变后它再无引用 ⇒ tsc 报
        `TS6133 'CAMPUS_SUBTITLE' is declared but its value is never read` ⇒ 构建失败。
      ⇒ 那就成了"验构建会不会崩"而**不是**"验断言能不能红"（我已在别处踩过一次）。
      做法：把常量块整体删掉（保留一句说明，免得看起来像误删）。
    */
    src = replaceOnce(
      src,
      `/**
 * 顶部副标题：**逐字**取自基线。
 *   \`screens/trident-campus/baseline.json\` interactions[1] =
 *   「顶部：大标题 Campus + **副标题「校园广场 ▼」** + 右上消息气泡」
 * ⚠️ 「▼」不是本常量的一部分 —— 它由 \`BigTitle\` 组件自己附加（渲染一个 chevron）。
 * ⚠️ 这里**刻意不写学校名**：按审核 60，原版该位置是固定标签而非当前学校名。
 */
const CAMPUS_SUBTITLE = '校园广场'

`,
      '/* [突变] 副标题常量已移除，改回用 mock 的 campusInfo.name */\n\n',
      '移除 CAMPUS_SUBTITLE 常量',
    )
    src = replaceOnce(
      src,
      '            已加载全部 · {feed.length} 条动态',
      '            已加载全部 · {feed.length} 条动态\n            <br />\n            {campusInfo.name}',
      '底部 → mock 学校名',
    )
    writeFileSync(FILE, denormalized(src, eol), 'utf8')

    console.log('  已注入突变（' + edits.length + ' 处）：CampusScreen 还原成"mock 学校名 + 8 校面板"')
    for (const e of edits) console.log('    · ' + e)
  } catch (err) {
    console.error('FAIL ' + String(err && err.message))
    doRestore(true)
    process.exit(1)
  }
} else if (mode === 'restore') {
  if (!doRestore(false)) process.exit(1)
} else {
  console.error('用法：node mutate-campus-mock.mjs inject|restore')
  process.exit(2)
}
