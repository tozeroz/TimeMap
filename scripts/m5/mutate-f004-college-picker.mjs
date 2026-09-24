/**
 * 受控突变：把认证页「所在学院」退回到 **WO#20 时期的纯文本 Row**
 * —— 用来证明 F-004/F-006 门禁断言**真的能红**
 *
 * ## 复现的历史形态（逐字）
 * ```
 *   <Rows items={[
 *     { label: '就读学校', value: ... },
 *     { label: '所在学院', value: '' },      ← 纯文本行：**不可点、无 picker**
 *     { label: '就读专业', value: '' },
 *     { label: '当前年级', value: '' },
 *   ]} />
 *   （无 data-verify-college 钩子、无面板、无学院列表、无「没有我的学院？」）
 * ```
 *
 * ## 预计打红哪几条
 *   `VERIFY_COLLEGE_ROW_TAPPABLE`            没有 data-verify-college ⇒ FAIL
 *   `COLLEGE_PICKER_OPENS_AND_MATCHES_DUMP`  点不开面板 ⇒ FAIL
 *   `COLLEGE_LIST_FROM_AUTHORITY`            无列表 ⇒ FAIL
 *   `COLLEGE_SELECT_AND_CONFIRM_WORKS`       无面板可选 ⇒ FAIL
 *   `COLLEGE_NO_FABRICATED_OPTIONS`          无列表（空） ⇒ **这点要注意**：
 *        "面板里没有 API 之外的学院"在"根本没有面板"时**逻辑上仍成立** ⇒ 可能仍 PASS
 *        ⇒ 这与"恒真断言"风险同型 ⇒ 若它仍 PASS，**如实记录**并说明该键的判别力边界
 *   `VERIFY_MAJOR_YEAR_NOT_INVENTED`         此时三行都无钩子 ⇒ 「学院行有钩子」不成立 ⇒ FAIL
 *
 * ⚠️ 注入后**必须通过 tsc**（否则验的是"构建会不会崩"而非"断言能不能红"）。
 * ⚠️ 需要把因突变而未使用的状态/导入处理掉（`void` 显式引用），否则 TS6133。
 *
 * 用法：node scripts/m5/mutate-f004-college-picker.mjs inject|restore
 *       MUT_TARGET="app/src/screens/DrawerPages.tsx"
 */
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'

const FILE = 'G:\\demo map\\app\\src\\screens\\DrawerPages.tsx'
const BACKUP = 'G:\\demo map\\tools\\tmp\\DrawerPages.tsx.origf004.txt'
const mode = process.argv[2]

function norm(text) {
  const crlf = text.includes('\r\n')
  return [crlf ? text.replace(/\r\n/g, '\n') : text, crlf ? '\r\n' : '\n']
}
function denorm(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}
function restore() {
  if (existsSync(BACKUP)) {
    writeFileSync(FILE, readFileSync(BACKUP, 'utf8'), 'utf8')
    rmSync(BACKUP, { force: true })
    return true
  }
  return false
}

if (mode === 'inject') {
  try {
    if (!existsSync(BACKUP)) copyFileSync(FILE, BACKUP)
    let [src, eol] = norm(readFileSync(FILE, 'utf8'))

    /* ① 把「所在学院」行改回纯文本（去掉 onClick 与 hook） */
    const oldRow = `          {
            label: '所在学院',
            value: college ? college : collegeState === 'loading' ? '加载中…' : '',
            onClick: () => setPickerOpen(true),
            hook: 'data-verify-college' as const,
          },`
    const newRow = `          { label: '所在学院', value: '' },`
    if (!src.includes(oldRow)) throw new Error('找不到「所在学院」行锚点')
    src = src.replace(oldRow, newRow)

    /* ② 删掉整个 picker 面板块（从 {pickerOpen && ( 到其配对结束） */
    const iPanel = src.indexOf('      {pickerOpen && (')
    if (iPanel < 0) throw new Error('找不到 picker 面板锚点')
    /* 面板结束后紧跟「<div className="dpcard">」 */
    const iCard = src.indexOf('      <div className="dpcard">', iPanel)
    if (iCard < 0) throw new Error('找不到面板结束锚点（dpcard）')
    src = src.slice(0, iPanel) + src.slice(iCard)

    /* ③ void 引用因突变而未使用的状态（保持能过 tsc） */
    const anchor = `  return (\n    <DrawerPage title="填写认证信息"`
    const k = src.indexOf(anchor)
    if (k < 0) throw new Error('找不到 VerifyScreen 的 return 锚点')
    src =
      src.slice(0, k) +
      `  /* [突变] 以下状态/导入在本突变下不再被渲染使用，显式引用以过 tsc */\n` +
      `  void pickerOpen\n  void colleges\n  void college\n  void draftCollege\n` +
      `  void setPickerOpen\n  void setDraftCollege\n  void setCollege\n  void setColleges\n` +
      `  void collegeState\n  void setCollegeState\n  void schoolId\n  void listSchoolColleges\n\n` +
      src.slice(k)

    writeFileSync(FILE, denorm(src, eol), 'utf8')
    console.log('  已注入突变：「所在学院」退回纯文本 Row（无 picker / 无学院列表）')
  } catch (err) {
    console.error('FAIL ' + String(err && err.message))
    if (restore()) console.error('  （回滚）已还原 DrawerPages.tsx')
    process.exit(1)
  }
} else if (mode === 'restore') {
  if (!restore()) {
    console.error('FAIL 没有备份文件，无法还原')
    process.exit(1)
  }
  console.log('  已还原 DrawerPages.tsx')
} else {
  console.error('用法：node mutate-f004-college-picker.mjs inject|restore')
  process.exit(2)
}
