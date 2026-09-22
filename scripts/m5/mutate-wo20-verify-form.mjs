/**
 * 受控突变：把 `VerifyScreen` **恢复成 WO#20 之前的历史实现**
 * —— 用来证明 WO#20 的门禁断言**真的能红**
 *
 * ## 复现的历史形态（与审核 65 引用的完全一致）
 * ```
 *   标题「校园认证」（错：那是抽屉条目名）
 *   「未认证」卡片 + desc「完成学生认证后可解锁校园广场发帖、同校推荐等能力。」
 *   按钮「去认证」→ navigate('board')   ← **错跳留言板**
 *   Rows「认证方式 = 学生证 / 校园卡」「认证状态 = 待认证」
 * ```
 *
 * ## 预计打红哪几条
 *   `VERIFY_TITLE_IS_FORM_TITLE`          —— 标题变回「校园认证」⇒ 不含「填写认证信息」
 *   `VERIFY_FORM_FIELDS_MATCH_BASELINE`   —— 四个字段被换成「认证方式/认证状态」
 *   `VERIFY_SCHOOL_FROM_AUTHORITY`        —— 「就读学校」这一行**不存在**了
 *   `VERIFY_NO_FABRICATED_STATUS_CARD`    —— 编造文案**全部回来**
 *   `VERIFY_NEXT_DOES_NOT_FAKE_SUCCESS`   —— 按钮变成「去认证」且**跳走**（hash 变），
 *                                          同时没有 `[data-verify-next]` 钩子 ⇒ FAIL
 *   ⇒ **5 键全红**
 *
 * ## 实现要点
 *   · 只替换 **VerifyScreen 的渲染体**，不动路由/抽屉/其它屏 ⇒ 归因清晰
 *   · 注入后**必须通过 tsc**（否则验的是"构建会不会崩"而非"断言能不能红"）
 *     ⇒ 因突变后 `school`/`schoolState`/`notice`/`setNotice` 会变成未使用，
 *        用 `void` 显式引用（前几版踩过 TS6133）
 *   · 锚点找不到 ⇒ **抛错**（不静默降级）；失败先回滚
 *
 * 用法：node scripts/m5/mutate-wo20-verify-form.mjs inject|restore
 *       MUT_TARGET="app/src/screens/DrawerPages.tsx"
 */
import { readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'

const FILE = 'G:\\demo map\\app\\src\\screens\\DrawerPages.tsx'
const BACKUP = 'G:\\demo map\\tools\\tmp\\DrawerPages.tsx.orig20.txt'
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

/** 历史实现（**逐字**复现改前的 VerifyScreen **渲染体**） */
const LEGACY_RENDER = `  void school
  void schoolState
  void notice
  void setNotice
  return (
    <DrawerPage title="校园认证" onBack={() => goBack('me')}>
      {/* [突变] 复现历史形态：编造的状态卡 + 错跳留言板 */}
      <div className="dpcard">
        <div className="dpcard__title">未认证</div>
        <p className="dpcard__desc">
          完成学生认证后可解锁校园广场发帖、同校推荐等能力。
        </p>
        <button className="dpcard__btn" onClick={() => navigate('board')}>
          去认证
        </button>
      </div>
      <Rows
        items={[
          { label: '认证方式', value: '学生证 / 校园卡' },
          { label: '认证状态', value: '待认证' },
        ]}
      />
    </DrawerPage>
  )`

if (mode === 'inject') {
  try {
    if (!existsSync(BACKUP)) copyFileSync(FILE, BACKUP)
    let [src, eol] = norm(readFileSync(FILE, 'utf8'))

    /*
      ⚠️ 只替换 **VerifyScreen 的 render 部分**，保留其状态声明与 useEffect。
        第一版我把 `export function VerifyScreen() {` 到下一个导出之间的**整段**替换了 ——
        那连状态声明与 useEffect 一起删掉 ⇒ ① `void school` 引用不存在的变量（TS2304）
        ② `useState`/`useEffect` import 变成未使用（TS6133）⇒ **构建失败**。
        而"构建失败"会让自测变成**验构建会不会崩**，不是**验断言能不能红**。
      ⇒ 边界改为：
         起点 = VerifyScreen 之后第一个 `  return (`
         终点 = 该函数结尾的 `  }\n\n`（在 PrivacyScreen 之前）
      · `school`/`schoolState`/`notice`/`setNotice` 在突变后不再被渲染使用
        ⇒ 用 `void` 显式引用（setSchool/setSchoolState 仍被 useEffect 使用，无需 void）
    */
    const fnMark = 'export function VerifyScreen() {'
    const nextMark = 'export function PrivacyScreen() {'
    const iFn = src.indexOf(fnMark)
    const iNext = src.indexOf(nextMark)
    if (iFn < 0 || iNext <= iFn) throw new Error('找不到 VerifyScreen 的边界')

    const iStart = src.indexOf('\n  return (', iFn)
    if (iStart < 0 || iStart > iNext) throw new Error('找不到 VerifyScreen 的 return 起点')
    // 该函数结尾：iNext 之前最后一个 "\n}"（函数闭合）
    const iEnd = src.lastIndexOf('\n}\n', iNext)
    if (iEnd < 0 || iEnd <= iStart) throw new Error('找不到 VerifyScreen 的结束位置')

    src = src.slice(0, iStart + 1) + LEGACY_RENDER + '\n}' + src.slice(iEnd + '\n}\n'.length)

    writeFileSync(FILE, denorm(src, eol), 'utf8')
    console.log('  已注入突变：VerifyScreen 退回历史形态（编造状态卡 + 错跳 board + 认证方式/认证状态）')
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
  console.error('用法：node mutate-wo20-verify-form.mjs inject|restore')
  process.exit(2)
}
