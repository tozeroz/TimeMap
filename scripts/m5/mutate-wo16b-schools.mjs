/**
 * 受控突变：把学校搜索页与校区面板的**数据源接回 mock**（证明 WO#16 层 B 的门禁能红）
 *
 * ## 设计原则：只换**数据源**，不动渲染模板
 *   审核 59/60/61 一贯要求敏感度证明"Gate 能抓出**接错数据源**这个原因"，
 *   而不是"对空值敏感"。所以本突变**只把 API 结果换成 8 条编造的 mock 学校**
 *   （那正是层 A 之前的历史形态：8 所学校 + `region` + `members` 如 '12,486'），
 *   **不改渲染模板** —— 这样"红"就精确归因到数据源，而不是归因到布局改动。
 *
 *   数据形状仍用 `ApiCampus[]`（`{id, name, campusCircleCount}`）⇒ **必然通过 tsc**，
 *   不会被"构建失败"混淆（那种情况验的是"构建会不会崩"，不是"断言能不能红"）。
 *
 * ## 预计结果
 *   打红：`SCHOOL_ROW_SHAPE`（行文本不再是「学校 (校区)」）
 *        `SCHOOL_ROWS_FROM_AUTHORITY`（8 行 ≠ 服务端 3 行）
 *        `CIRCLE_COUNT_NULL_NOT_RENDERED`（把 null 换成了编造数字，于是渲染出计数）
 *        `CAMPUS_PANEL_FROM_AUTHORITY`（面板项变成 8 个 mock 学校）
 *   **应仍 PASS**（归因清晰的另一半）：`SCHOOL_SEARCH_PLACEHOLDER` ／ `SCHOOL_SEARCH_GROUP_LABEL` ／
 *        `CAMPUS_PANEL_TITLE` ／ `SCHOOL_SEARCH_ENTRY_NAVIGATES`
 *
 * 用法：node scripts/m5/mutate-wo16b-schools.mjs inject|restore
 *       （多文件：MUT_TARGET="app/src/screens/SchoolSearchScreen.tsx app/src/screens/CampusScreen.tsx"）
 */
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'

const SEARCH = 'G:\\demo map\\app\\src\\screens\\SchoolSearchScreen.tsx'
const CAMPUS = 'G:\\demo map\\app\\src\\screens\\CampusScreen.tsx'
const TARGETS = [SEARCH, CAMPUS]
const BACKUPS = TARGETS.map((p) => 'G:\\demo map\\tools\\tmp\\' + p.split('\\').pop() + '.orig16b.txt')
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
  if (any) console.log(quiet ? '  （回滚）已还原两个源文件' : '  已还原 SchoolSearchScreen.tsx 与 CampusScreen.tsx')
  return any
}

/** 8 条编造的 mock 学校（**逐字**取自层 A 之前 mock.ts 的那 8 条 + 编造 members） */
const FAKE = `[
        { id: 's1', name: '北京交通大学 · 北京市·海淀区 · 12,486 位同学', campusCircleCount: 12486 },
        { id: 's2', name: '清华大学 · 北京市·海淀区 · 38,021 位同学', campusCircleCount: 38021 },
        { id: 's3', name: '北京大学 · 北京市·海淀区 · 42,138 位同学', campusCircleCount: 42138 },
        { id: 's4', name: '中国人民大学 · 北京市·海淀区 · 28,905 位同学', campusCircleCount: 28905 },
        { id: 's5', name: '北京航空航天大学 · 北京市·海淀区 · 31,672 位同学', campusCircleCount: 31672 },
        { id: 's6', name: '北京师范大学 · 北京市·海淀区 · 26,410 位同学', campusCircleCount: 26410 },
        { id: 's7', name: '复旦大学 · 上海市·杨浦区 · 33,204 位同学', campusCircleCount: 33204 },
        { id: 's8', name: '上海交通大学 · 上海市·闵行区 · 40,558 位同学', campusCircleCount: 40558 },
      ]`

if (mode === 'inject') {
  try {
    TARGETS.forEach((t, i) => {
      if (!existsSync(BACKUPS[i])) copyFileSync(t, BACKUPS[i])
    })
    // 搜索页
    {
      const [src, eol] = norm(readFileSync(SEARCH, 'utf8'))
      const from = '      setCampuses(cr.value.items)'
      if (!src.includes(from)) throw new Error('SchoolSearchScreen 找不到 setCampuses(cr.value.items)')
      writeFileSync(SEARCH, denorm(src.replace(from, '      /* [突变] 数据源接回 mock：8 所学校 + 编造计数 */\n      setCampuses(' + FAKE + ' as ApiCampus[])'), eol), 'utf8')
    }
    // 校区面板
    {
      const [src, eol] = norm(readFileSync(CAMPUS, 'utf8'))
      const from = '      setCampuses(cr.value.items)'
      if (!src.includes(from)) throw new Error('CampusScreen 找不到 setCampuses(cr.value.items)')
      writeFileSync(CAMPUS, denorm(src.replace(from, '      /* [突变] 数据源接回 mock */\n      setCampuses(' + FAKE + ' as ApiCampus[])'), eol), 'utf8')
    }
    console.log('  已注入突变：**数据源接回 mock**（8 所学校 + 编造计数 12486 等），渲染模板未动')
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
  console.error('用法：node mutate-wo16b-schools.mjs inject|restore')
  process.exit(2)
}
