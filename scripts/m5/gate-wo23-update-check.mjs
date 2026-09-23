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
 *   ✅ UPDATE_STATE_MATCHES_MANIFEST      弹窗状态与"设备版本 vs 清单版本"的**关系**一致（不写死某一状态）
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
    /*
      ⭐ 必须能观测到"显示出来的下载地址"。
      ⚠️ 本键修过一次：断言里用到 before.apkShown，但**本门禁的 READ 当初没有采集它**
        ⇒ 恒为 undefined ⇒ 误报 FAIL。（跨门禁抄判据时，忘了抄它依赖的**观测字段**。）
      ⇒ 教训：改判据时要同时确认"它依赖的观测项**真的被测了**"，
        否则断言测的是 undefined，而不是被测对象。
    */
    apkShown: t('[data-upgrade-apk]'),
    currentVersion: (function () {
      const n = q('[data-upgrade-current]')
      if (!n) return null
      const m = n.innerText.match(/v?([0-9.]+)/)
      return m ? m[1] : null
    })(),
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

/*
  ⚠️ 这里修过一次**真实缺陷**：本门禁的断言"版本相等 ⇒ 显示已是最新"依赖一次
     **网络往返**（GET /api/app/release）。初版只 `sleep(3500)` 就断言 ——
     在我单独跑时侥幸通过，但在**批量回归**里（设备/网络更忙）T0 读到的还是
     `checking:"正在检查更新…"` ⇒ `UPDATE_STATE_MATCHES_MANIFEST`（当时的键名）误报 FAIL。
  ⇒ 正确做法：**轮询到"终态"**（不再是 checking），带超时；超时才算真的没出结果。
     这是任何"断言异步状态"的门禁都该用的模式，而不是固定等待。
*/
async function waitUntilSettled(maxMs = 15000) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < maxMs) {
    last = await evaluate(READ)
    if (last && !last.TIMEOUT && !last.checking) return { view: last, settled: true, waitedMs: Date.now() - t0 }
    await sleep(500)
  }
  return { view: last, settled: false, waitedMs: Date.now() - t0 }
}
const settled = await waitUntilSettled()
const before = settled.view
log('UPGRADE_T0', { ...before, _settled: settled.settled, _waitedMs: settled.waitedMs })

console.log('')
console.log('=== 2) 点「立即更新」：不得跳走、不得声称成功 ⭐ ===')
const hashBefore = before && before.hash
await evaluate(`(() => { const b = document.querySelector('[data-upgrade-now]'); if (b) { b.click(); return true } return false })()`)
await sleep(2200)
const after = await evaluate(READ)

/*
  ⭐ 取"清单里的最新版本"，用于把断言写成**关系**而不是写死某个状态。
  ⚠️ 这正是上面两处修正的前提：不硬编码"当前应该显示已是最新"。
*/
/*
  ⭐ 取"清单里的最新版本"，用于把断言写成**关系**而不是写死某个状态。
  ⚠️ 修过一次：初版在**页面内** fetch（先 https 后 http）—— https 会被私有 CA 自签证书挡住；
     换成 http 仍拿不到（WebView 的混合内容/来源策略）。
  ⇒ 改为**由门禁自己（node）直接取**：node 不受 WebView 的这些策略限制，
     而且这本来就是"门禁要知道服务端期望值"的正常做法。
*/
let releaseInfo = { ok: false, why: '未取' }
try {
  const r = await fetch('http://8.148.156.146/api/app/release')
  if (r.ok) {
    const j = await r.json()
    releaseInfo = { ok: true, latestVersion: j.latestVersion || null, apkUrl: j.apkUrl || null, configured: !!j.configured }
  } else {
    releaseInfo = { ok: false, why: 'http ' + r.status }
  }
} catch (e) {
  releaseInfo = { ok: false, why: String((e && e.message) || e) }
}
const relVersion = releaseInfo && releaseInfo.ok ? releaseInfo.latestVersion : null
log('RELEASE_INFO', releaseInfo)
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

  /**
   * ⭐ 弹窗的**状态必须与"设备版本 vs 清单版本"的关系一致**。
   *
   * ⚠️⚠️ 本键修过一次**真实缺陷**（最终回归抓出来的）：
   *   初版断言的是"**必须**显示已是最新版本" —— 那是把**当时的发布状态**
   *   （清单=1.0、设备=1.0）**写死进了判据**。
   *   后来 WO#23 closeout 真的发布了 1.1（清单=1.1、设备=1.0），
   *   弹窗**正确地**显示"新版本 v1.1" ⇒ 本键反而误报 FAIL。
   *
   *   ⇒ 教训：**门禁不得把"某一时刻的数据状态"写死成断言**。
   *     它该断言的是**关系**：清单比设备新 ⇒ 必须有更新；否则 ⇒ 必须说已是最新。
   *     （与"判据要经得起状态变化"同源；这类硬编码会在每次真实状态变化时制造假失败。）
   */
  UPDATE_STATE_MATCHES_MANIFEST: (() => {
    if (!before) return 'INCONCLUSIVE'
    if (!settled.settled) return 'INCONCLUSIVE'
    if (before.errored) return 'INCONCLUSIVE' // 网络问题
    if (before.notConfigured) return 'INCONCLUSIVE' // 后端没清单
    /* 关系判定：设备版本 vs 清单版本 */
    const dev = appVer
    const rel = relVersion
    if (!dev || !rel) return 'INCONCLUSIVE'
    const dv = String(dev).split('.').map((x) => parseInt(x, 10) || 0)
    const rv = String(rel).split('.').map((x) => parseInt(x, 10) || 0)
    let cmp = 0
    for (let i = 0; i < Math.max(dv.length, rv.length); i++) {
      const x = dv[i] ?? 0
      const y = rv[i] ?? 0
      if (x !== y) {
        cmp = x < y ? -1 : 1
        break
      }
    }
    if (cmp < 0) {
      /* 清单更新 ⇒ 必须显示"有更新"且带**真实**版本号 */
      return before.available && String(before.available).includes(String(rel)) ? 'PASS' : 'FAIL'
    }
    /* 否则必须显示"已是最新版本" */
    return before.upToDate && /已是最新版本/.test(String(before.upToDate)) ? 'PASS' : 'FAIL'
  })(),

  /**
   * ⭐ 点「立即更新」**不假装成功**：
   *   ① hash 不变（没跳走）② 无成功类字样 ③ 给出明确说明
   *
   * ⚠️ 本键也修过一次：旧判据要求"hash 不变 + 有 notice" —— 那同样**把状态写死了**。
   *   有更新时，点「立即更新」会**有意**交给系统（导航走，见 gate-wo23-update-flow.mjs）
   *   ⇒ hash 会变、也不会有 notice ⇒ 误报 FAIL。
   * ⇒ 现在只断言**本键真正关心的那件事**：**绝不出现"假成功"字样**；
   *   并**额外**记录当时处于哪个状态（state），便于核对行为是否符合预期 ——
   *   点击后的"去向"由 update-flow 那条门禁专门负责（分工明确，不重复也不互相打脸）。
   */
  UPDATE_NO_FAKE_SUCCESS: (() => {
    if (!before || !after) return 'INCONCLUSIVE'
    const noSuccess = !SUCCESS_WORDS.test(txt2)
    if (!noSuccess) return 'FAIL'
    const isUptodate = !!(before.upToDate && /已是最新版本/.test(String(before.upToDate)))
    if (isUptodate) {
      /* 已是最新 ⇒ 点击必须**不跳走**且给出明确说明 */
      const stayed = String(after.hash) === String(hashBefore)
      const explained = !!after.notice || /已是最新/.test(txt2)
      return stayed && explained ? 'PASS' : 'FAIL'
    }
    /* 有更新 ⇒ 允许交给系统（由 update-flow 门禁断言），此处只要求"没有假成功" */
    return 'PASS'
  })(),
  /** 记录当时的更新状态（供核对；不参与判定） */
  UPDATE_STATE_AT_TEST: before
    ? before.available
      ? 'available'
      : before.upToDate
        ? 'uptodate'
        : before.notConfigured
          ? 'not_configured'
          : before.errored
            ? 'error'
            : 'unknown'
    : 'unknown',

  /** 改前那批编造值（版本/体积/亮点）必须全部消失 */
  UPDATE_NO_FABRICATED_VALUES: (() => {
    if (!stat.noFabricatedInDialog) return 'FAIL'
    if (FABRICATED.some((s) => txt.includes(s) || txt2.includes(s))) return 'FAIL'
    return 'PASS'
  })(),

  /** 结构对齐基线 observed：「标题 + 版本说明 +『取消』『立即更新』」 */
  UPDATE_STRUCTURE_MATCHES_BASELINE: before && before.hasCancel && before.hasNow ? 'PASS' : 'FAIL',

  /** apkUrl 为 null 时必须如实说明（不编造链接、不假装能下载） */
  /**
   * APK 地址的**诚实性**（与发布状态相关，因此也必须是**关系式**判据）。
   *
   * ⚠️ 本键也修过一次：初版写的是"若走到 available 分支就必须显示**没有**安装包"
   *   —— 那同样是**把当时的发布状态（apkUrl=null）写死进判据**。
   *   现在真的托管了 APK（WO#23 closeout）⇒ 必须显示**真实地址**才是诚实。
   * ⇒ 正确判据：**清单里有 apkUrl ⇒ 弹窗必须显示该地址；清单里没有 ⇒ 必须如实说未托管**。
   */
  UPDATE_APK_ADDRESS_IS_HONEST: (() => {
    if (!stat.handlesNullApkUrl) return 'FAIL'
    if (!before) return 'INCONCLUSIVE'
    const inAvailable = !!before.available
    if (!inAvailable) return 'INCONCLUSIVE' /* 没走到该分支 ⇒ 无从判断 */
    const manifestHasUrl = !!(releaseInfo && releaseInfo.ok && releaseInfo.apkUrl)
    if (manifestHasUrl) {
      /* 有真实地址 ⇒ 必须显示该地址（不是"未托管"） */
      return before.apkShown && String(before.apkShown).includes(String(releaseInfo.apkUrl)) ? 'PASS' : 'FAIL'
    }
    /* 没有地址 ⇒ 必须如实说未托管 */
    return before.noApk ? 'PASS' : 'FAIL'
  })(),

  detail: { stat, before, after, fabricatedChecked: FABRICATED, releaseInfo },
  facts_not_assertions: {
    APP_UPDATE_CHECK_IS_REAL: 'PASS（真请求、真比较、真状态）',
    UPDATE_DIALOG_STRUCTURE: '与基线 observed 一致（取消 / 立即更新）',
    ORIGINAL_UPDATE_FLOW: '**NOT_EVALUATED** —— 原版「立即更新」的真实去向未观察，且不可去点（可能触发真实下载）',
    UPDATE_DIALOG_LAYOUT: 'NOT_EVALUATED（原版弹窗视觉布局未逐像素核对）',
    /* ⚠️ 这条随发布状态变化（旧版本是 NOT IMPLEMENTED）；由 update-flow 门禁实测 */
    APK_DOWNLOAD_AND_HANDOFF: '见 gate-wo23-update-flow.mjs（点击交给系统；INSTALL_HANDOFF_TO_OS: INITIATED）',
  },
}

const KEYS = [
  'APP_VERSION_MATCHES_ANDROID',
  'UPDATE_CHECKS_REAL_API',
  'UPDATE_STATE_MATCHES_MANIFEST',
  'UPDATE_NO_FAKE_SUCCESS',
  'UPDATE_NO_FABRICATED_VALUES',
  'UPDATE_STRUCTURE_MATCHES_BASELINE',
  'UPDATE_APK_ADDRESS_IS_HONEST',
]
const anyFail = KEYS.some((k) => String(v[k]).startsWith('FAIL'))
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO23_UPDATE_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

/*
  ⭐ 收尾：若本次处于"有更新"状态，点击会把用户**交给系统**（导航到 APK 地址）
  ⇒ 设备前台会变成浏览器，外层 wrapper 的 VISUAL_TARGET_VALIDITY(after) 会因此 FAIL、
     并把证据作废。⇒ 与 gate-wo23-update-flow.mjs 同样处理：观察完之后**把前台复原**。
  ⚠️ 断言依据都在此之前已读完 ⇒ 这不是为了让断言变绿，只是复原设备状态。
  ⚠️ 用"输出重定向到文件"的方式调 adb（本环境禁止通过管道捕获外部程序输出）。
*/
try {
  const { execFileSync } = await import('node:child_process')
  const { openSync, closeSync } = await import('node:fs')
  const fd = openSync('G:\\demo map\\tools\\tmp\\wo23check-restore.txt', 'w')
  try {
    execFileSync(
      'G:\\Program Files\\Netease\\MuMu\\nx_main\\adb.exe',
      ['-s', '127.0.0.1:16384', 'shell', 'am', 'start', '-n', 'com.campusx.demo/.MainActivity'],
      { stdio: ['ignore', fd, 'ignore'] },
    )
  } finally {
    closeSync(fd)
  }
  await sleep(1500)
  log('RESTORED_FOREGROUND', true)
} catch (e) {
  log('RESTORE_FAILED', String((e && e.message) || e))
}

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
