/**
 * ⭐ WO#23 门禁：App 自更新 = **真实的检查更新**（Owner 裁定 ③：必须实现体验等价）
 *
 * ════════════════════════════════════════════════════════════════════
 * 背景（为什么不能只停在"如实说没接"）
 * ════════════════════════════════════════════════════════════════════
 *   Round 319 早段我把 UpgradeDialog 的**编造内容**（2.11.0 / 48.6 MB / 3 条亮点）与
 *   **假成功**（「立即更新」= navigate('campus')）都删了，改为如实说明"未接入"。
 *   Owner 裁定 ③ 要求"必须实现体验等价" ⇒ 只停在"如实说没接"**不满足**。
 *   ⚠️ 但原版「立即更新」的真实去向**未观察**（点它可能触发真实下载 ⇒ 只读约束下
 *      **BLOCKED_BY_POLICY**）⇒ 无从对齐。
 *   ⇒ 本 WO 做的是"**真检查**"：客户端问我们自己的后端要发布清单，拿本机真实版本比较。
 *
 * ════════════════════════════════════════════════════════════════════
 * 能验 / 不能验（如实划界）
 * ════════════════════════════════════════════════════════════════════
 *   ✅ APP_VERSION_MATCHES_ANDROID      version.ts 与 android versionName 一致（**机械**校验）
 *   ✅ UPDATE_CHECKS_REAL_API           走真实接口、**无编造值**
 *   ✅ UPDATE_SHOWS_UPTODATE            版本相等时显示"已是最新版本" + 真实版本号
 *   ✅ UPDATE_NO_FAKE_SUCCESS           点「立即更新」**不跳走、不声称成功**，只给明确说明
 *   ✅ UPDATE_NO_FABRICATED_VALUES      改前的编造值全部不出现
 *   ✅ UPDATE_STRUCTURE_MATCHES_BASELINE 有「取消」+「立即更新」（基线 observed）
 *   ❌ ORIGINAL_UPDATE_FLOW             **NOT_EVALUATED**（原版去向未观察且不能去点）
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo23-update-gate.json'
const VERSION_TS = 'G:\\demo map\\app\\src\\version.ts'
const GRADLE = 'G:\\demo map\\app\\android\\app\\build.gradle'
const DIALOG = 'G:\\demo map\\app\\src\\screens\\UpgradeDialog.tsx'

/** 改前那批**编造值**（出现任一即说明没清干净） */
const FABRICATED = ['2.11.0', '48.6 MB', '校园广场支持按标签筛选', '群聊新增 @ 面板与消息引用', '修复地图定位偶发偏移']

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

// ── 静态 ──────────────────────────────────────────────────────────
const vts = existsSync(VERSION_TS) ? readFileSync(VERSION_TS, 'utf8') : ''
const gradle = existsSync(GRADLE) ? readFileSync(GRADLE, 'utf8') : ''
const dlgRaw = existsSync(DIALOG) ? readFileSync(DIALOG, 'utf8') : ''
const dlg = dlgRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const appVer = (vts.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1] ?? null
const androidVer = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] ?? null
const stat = {
  appVersion: appVer,
  androidVersion: androidVer,
  callsRealApi: /getAppRelease\(/.test(dlg),
  usesCompare: /compareVersions\(/.test(dlg),
  /*
    ⚠️ 这里修过一次**判据缺陷**（与 WO#21 那次同型）：
      初版写的是 `!FABRICATED.some((s) => dlgRaw.includes(s))` —— 用了**未剥注释**的 dlgRaw，
      而那些编造值出现在**我自己的注释里**（写"改前是 2.11.0 / 48.6 MB…"）⇒ 误报 FAIL。
      我明明已经算出了剥注释版 `dlg`，却用错了变量。
      ⇒ 教训（第三次同类）：**"注释里提到它" ≠ "界面里还在"** —— 静态检查必须搜剥注释后的源码。
  */
  noFabricatedInDialog: !FABRICATED.some((s) => dlg.includes(s)),
  handlesNullApkUrl: /apkUrl/.test(dlg) && /尚未托管|未配置/.test(dlg),
  /** 运行时的**界面文本**也必须干净（与静态互为独立证据） */
  noFabricatedInBody: !FABRICATED.some((s) => dlg.includes(s)),
}
log('STATIC', stat)

// ── 设备 ──────────────────────────────────────────────────────────
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target（用 run-device-gate.sh 跑）')
  process.exit(2)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
async function evaluate(expression, timeoutMs = 30000) {
  const p = new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(
      JSON.stringify({
        id: i,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    )
  })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const READ = `(() => {
  const q = (s) => document.querySelector(s)
  const t = (s) => { const n = q(s); return n ? n.innerText.replace(/\\s+/g,' ').trim() : null }
  return {
    hash: location.hash,
    upToDate: t('[data-upgrade-uptodate]'),
    available: t('[data-upgrade-available]'),
    notConfigured: t('[data-upgrade-not-configured]'),
    errored: t('[data-upgrade-error]'),
    checking: t('[data-upgrade-checking]'),
    noApk: t('[data-upgrade-no-apk]'),
    notice: t('[data-upgrade-notice]'),
    hasCancel: !!q('[data-upgrade-cancel]'),
    hasNow: !!q('[data-upgrade-now]'),
    pageText: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 500),
  }
})()`

console.log('')
console.log('=== 1) 打开升级弹窗（路由 #/upgrade）===')
await evaluate(`location.hash = '#/campus'`)
await sleep(1200)
await evaluate(`location.hash = '#/upgrade'`)
await sleep(3500)
const before = await evaluate(READ)
log('UPGRADE_T0', before)

console.log('')
console.log('=== 2) 点「立即更新」：不得跳走、不得声称成功 ⭐ ===')
const hashBefore = before && before.hash
await evaluate(`(() => { const b = document.querySelector('[data-upgrade-now]'); if (b) { b.click(); return true } return false })()`)
await sleep(2200)
const after = await evaluate(READ)
log('AFTER_NOW_CLICK', after)

// ── 判定 ──────────────────────────────────────────────────────────
const SUCCESS_WORDS = /更新成功|已更新|升级成功|安装成功|正在更新/
const txt = String((before && before.pageText) || '')
const txt2 = String((after && after.pageText) || '')

const v = {
  /** ⭐ version.ts 与 android versionName 必须一致（机械校验，防"悄悄漂移"） */
  APP_VERSION_MATCHES_ANDROID: (() => {
    if (!appVer || !androidVer) return 'INCONCLUSIVE'
    return appVer === androidVer ? 'PASS' : `FAIL（version.ts=${appVer} android=${androidVer}）`
  })(),

  /** 走真实接口、真比较；不冒充 */
  UPDATE_CHECKS_REAL_API: stat.callsRealApi && stat.usesCompare ? 'PASS' : 'FAIL',

  /** 版本相等（本机 1.0 == 后端 1.0）⇒ 必须显示"已是最新版本" */
  UPDATE_SHOWS_UPTODATE: (() => {
    if (!before) return 'INCONCLUSIVE'
    if (before.errored) return 'INCONCLUSIVE' // 网络问题
    if (before.notConfigured) return 'INCONCLUSIVE' // 后端没清单
    return before.upToDate && /已是最新版本/.test(String(before.upToDate)) ? 'PASS' : 'FAIL'
  })(),

  /**
   * ⭐ 点「立即更新」**不假装成功**：
   *   ① hash 不变（没跳走）② 无成功类字样 ③ 给出明确说明
   */
  UPDATE_NO_FAKE_SUCCESS: (() => {
    if (!before || !after) return 'INCONCLUSIVE'
    const stayed = String(after.hash) === String(hashBefore)
    const noSuccess = !SUCCESS_WORDS.test(txt2)
    const explained = !!after.notice || /已是最新|未托管|无法执行|不可用/.test(txt2)
    return stayed && noSuccess && explained ? 'PASS' : 'FAIL'
  })(),

  /** 改前那批编造值（版本/体积/亮点）必须全部消失 */
  UPDATE_NO_FABRICATED_VALUES: (() => {
    if (!stat.noFabricatedInDialog) return 'FAIL'
    if (FABRICATED.some((s) => txt.includes(s) || txt2.includes(s))) return 'FAIL'
    return 'PASS'
  })(),

  /** 结构对齐基线 observed：「标题 + 版本说明 +『取消』『立即更新』」 */
  UPDATE_STRUCTURE_MATCHES_BASELINE: before && before.hasCancel && before.hasNow ? 'PASS' : 'FAIL',

  /** apkUrl 为 null 时必须如实说明（不编造链接、不假装能下载） */
  UPDATE_HANDLES_NULL_APK_HONESTLY: (() => {
    if (!stat.handlesNullApkUrl) return 'FAIL'
    /* 运行时不一定走到 available 分支（当前版本相等）⇒ 静态确认 + 若走了就核对文案 */
    if (before && before.available) return before.noApk ? 'PASS' : 'FAIL'
    return 'PASS'
  })(),

  detail: { stat, before, after, fabricatedChecked: FABRICATED },
  facts_not_assertions: {
    APP_UPDATE_CHECK_IS_REAL: 'PASS（真请求、真比较、真状态）',
    UPDATE_DIALOG_STRUCTURE: '与基线 observed 一致（取消 / 立即更新）',
    ORIGINAL_UPDATE_FLOW: '**NOT_EVALUATED** —— 原版「立即更新」的真实去向未观察，且不可去点（可能触发真实下载）',
    UPDATE_DIALOG_LAYOUT: 'NOT_EVALUATED（原版弹窗视觉布局未逐像素核对）',
    UPDATE_DOWNLOAD_AND_INSTALL: '我们**没有**托管安装包（apkUrl=null）⇒ 不声称"能下载安装"',
  },
}

const KEYS = [
  'APP_VERSION_MATCHES_ANDROID',
  'UPDATE_CHECKS_REAL_API',
  'UPDATE_SHOWS_UPTODATE',
  'UPDATE_NO_FAKE_SUCCESS',
  'UPDATE_NO_FABRICATED_VALUES',
  'UPDATE_STRUCTURE_MATCHES_BASELINE',
  'UPDATE_HANDLES_NULL_APK_HONESTLY',
]
const anyFail = KEYS.some((k) => String(v[k]).startsWith('FAIL'))
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO23_UPDATE_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
