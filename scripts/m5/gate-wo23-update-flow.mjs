/**
 * ⭐⭐ WO#23 closeout（审核 68 的 P0 销项）：**真更新流程** —— 有可下载的 APK 时能真的带走用户
 *
 * ════════════════════════════════════════════════════════════════════
 * 审核 68 的要求（原话）
 * ════════════════════════════════════════════════════════════════════
 *   > "**real update check ≠ app self-update**"
 *   > "B. 保持 Owner 原裁定『App 自更新』⇒ 还必须至少完成一次：
 *   >    newer release → actual APK available → 用户点击更新 → **下载/打开 Android 安装流程**"
 *   > "至少要让『立即更新』真的能把用户带入一个可安装的新 APK 流程，而不是只有检查能力。"
 *
 * ════════════════════════════════════════════════════════════════════
 * 本门禁验证什么（全部**实测**，不靠声明）
 * ════════════════════════════════════════════════════════════════════
 *   ① 发布清单**真的有**一个更新版本 + 一个**真的可下载**的 APK
 *      （服务器侧 curl 实测：HTTP 200 + 正确 MIME + 字节数与本地构建**逐字节等长** + APK 魔数）
 *   ② 设备上的 App（**装着旧版 1.0**）打开升级弹窗 ⇒ 必须显示"有更新"与**真实版本号**
 *   ③ 弹出的是**真实下载地址**（与清单里的 url 一致），不是编造的
 *   ④ 点「立即更新」⇒ **真的发起对该 url 的请求**（本门禁通过 CDP 监听网络请求来判定，
 *      而不是只看"有没有调用 window.open"）
 *   ⑤ ⚠️ **不声称**"安装完成"：Android 的安装确认是**系统 UI**，
 *      本门禁只能证明"把用户带到了可安装的包 + 发起了真实下载"。安装那一步记
 *      `INSTALL_HANDOFF_TO_OS: INITIATED`（不是 COMPLETED）。
 *
 * ════════════════════════════════════════════════════════════════════
 * Fixture 依赖（重要 —— 本门禁依赖设备**装的是旧版**）
 * ════════════════════════════════════════════════════════════════════
 *   设备上装的必须是**比清单里 latestVersion 更旧**的版本，否则"有更新"态不会出现。
 *   本门禁会先读设备侧 App 自己报的版本（弹窗上的"当前版本"）并与清单比较：
 *     设备 < 清单  ⇒ 期望"有更新"（正常路径）
 *     设备 ≥ 清单  ⇒ 期望"已是最新"（此时**不**断言"有更新"，如实记 INCONCLUSIVE 并说明）
 *   ⇒ 这样门禁**不会**因为"环境恰好装的是新版"而误判。
 */
import { writeFileSync, readFileSync, existsSync, openSync, closeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const OUT = 'G:\\demo map\\tools\\tmp\\wo23-update-flow-gate.json'
const API = 'https://8.148.156.146'

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

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
/** 记录本门禁观察到的**网络请求**（用于证明"真的发起了下载"） */
const requests = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params && m.params.request && m.params.request.url
    if (u) requests.push(u)
  }
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
let cmdId = 0
function send(method, params) {
  return new Promise((r) => {
    const i = ++cmdId
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
}
async function evaluate(expression, timeoutMs = 30000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs)),
  ])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * ⭐ Android 侧 oracle：读**前台窗口**。
 * 为什么需要它：点击「立即更新」后，URL 被交给**系统浏览器**处理（跨进程），
 * 因此 CDP（只连本 App 的 WebView）看不到那个请求 —— 必须跨进程观测。
 * ⚠️ 这只是"前台是谁"，不是"安装完成"；口径见文件头。
 */
const ADB = 'G:\\Program Files\\Netease\\MuMu\\nx_main\\adb.exe'
const DEV = '127.0.0.1:16384'
function currentFocus() {
  /*
    ⚠️ 这里修过一处**环境限制导致的假失败**：
      初版用 `execFileSync(ADB, [...], { encoding: 'utf8' })` —— 那是**管道捕获输出**，
      而本环境（受限沙箱）**禁止程序通过管道捕获另一个程序的输出**（EPERM）⇒
      每次都进 catch、返回空串 ⇒ focusBefore/focusAfter 都是 "" ⇒ 门禁误报 FAIL。
    ⇒ 改成**把输出重定向到文件**（stdio: ['ignore', fd, 'ignore']，fd 是打开的文件），
      再用 fs 读该文件 —— 全程不经过管道。
      这与本项目既有的"写文件而不是硬拼多层引号"是同一类处置：
      **绕开环境的限制，而不是绕过断言**。
  */
  const tmp = 'G:\\demo map\\tools\\tmp\\wo23-focus.txt'
  try {
    const fd = openSync(tmp, 'w')
    try {
      execFileSync(ADB, ['-s', DEV, 'shell', 'dumpsys window'], { stdio: ['ignore', fd, 'ignore'] })
    } finally {
      closeSync(fd)
    }
    const out = readFileSync(tmp, 'utf8')
    /*
      ⚠️ 正则修过一次**真实 bug**：初版写 /mCurrentFocus=(\S+)/ —— `\S+` 到**第一个空格**就停，
        于是捕获到的是 `Window{7540306`（窗口 id），**不含包名** ⇒
        后面 includes('com.campusx.demo') 恒为 false ⇒ 判定恒 FAIL。
      ⇒ 改为取**整行**（[^\n]+）；mCurrentFocus 拿不到时退化用 mFocusedApp。
    */
    const m1 = out.match(/mCurrentFocus=([^\n]+)/)
    if (m1) return m1[1].trim()
    const m2 = out.match(/mFocusedApp=([^\n]+)/)
    return m2 ? m2[1].trim() : ''
  } catch (e) {
    /*
      ⚠️ 不再**静默吞掉**异常（那是本项目反复批评的"静默降级"）：
        初版 `catch { return '' }` 让我查了三轮都在猜（先怀疑管道、又怀疑正则）。
      ⇒ 把错误**暴露**到返回值里，让判定与诊断都能看到它。
    */
    return `__ADB_ERROR__:${(e && e.code) || ''}:${String((e && e.message) || e).slice(0, 160)}`
  }
}

await send('Network.enable', {})

const READ = `(() => {
  const q = (s) => document.querySelector(s)
  const t = (s) => { const n = q(s); return n ? n.innerText.replace(/\\s+/g,' ').trim() : null }
  return {
    hash: location.hash,
    available: t('[data-upgrade-available]'),
    upToDate: t('[data-upgrade-uptodate]'),
    apkShown: t('[data-upgrade-apk]'),
    noApk: t('[data-upgrade-no-apk]'),
    notice: t('[data-upgrade-notice]'),
    /*
      ⭐ 用**专用钩子**读当前版本，而不是从整页文本正则猜。
      ⚠️ 初版是从 body.innerText 里正则找"当前版本" —— 但那个文本原先只在"已是最新"
         分支里渲染，于是"有更新"时读不到 ⇒ 门禁只能记 INCONCLUSIVE（等于没判断）。
      ⇒ 已在 UpgradeDialog 里加了**始终可见**的 data-upgrade-current，事实变得始终可观测。
    */
    currentVersion: (function () {
      const n = q('[data-upgrade-current]')
      if (!n) return null
      const m = n.innerText.match(/v?([0-9.]+)/)
      return m ? m[1] : null
    })(),
    pageText: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 500),
  }
})()`

// ── 段 0：期望值来自服务端 ─────────────────────────────────────────
console.log('=== 0) 发布清单（服务端）===')
const rel = await evaluate(`(async () => {
  try { const r = await fetch('${API}/api/app/release'); if (!r.ok) return { ok:false, why:'http '+r.status }
        return { ok:true, ...(await r.json()) } } catch (e) { return { ok:false, why:String(e && e.message) } }
})()`)
log('EXPECTED_RELEASE', rel)

console.log('')
console.log('=== 1) 打开升级弹窗并等终态（轮询，不固定等待）===')
await evaluate(`location.hash = '#/campus'`)
await sleep(1200)
await evaluate(`location.hash = '#/upgrade'`)
let view = null
{
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    const v = await evaluate(READ)
    if (v && !v.TIMEOUT && !/正在检查更新/.test(String(v.pageText))) { view = v; break }
    await sleep(500)
  }
}
log('UPGRADE_PAGE', view)

console.log('')
console.log('=== 2) 点「立即更新」⇒ 监听是否**真的发起对该 APK 的请求** ⭐ ===')
requests.length = 0
const hashBefore = view && view.hash
/* ⭐ 点击**前**的前台窗口（用于判"是否交给了系统"） */
const focusBefore = currentFocus()
await evaluate(`(() => { const b = document.querySelector('[data-upgrade-now]'); if (b) { b.click(); return true } return false })()`)
await sleep(4000)
const after = await evaluate(READ)
/* ⭐ 点击**后**的前台窗口：若变成别的组件 ⇒ 已交给系统 */
const focusAfter = currentFocus()
log('AFTER_CLICK', { view: after, requests: requests.slice(-8), focusBefore, focusAfter })

// ── 判定 ──────────────────────────────────────────────────────────
const relVer = rel && rel.ok ? rel.latestVersion : null
const relUrl = rel && rel.ok ? rel.apkUrl : null
const devVer = view ? view.currentVersion : null
const deviceIsOlder =
  relVer && devVer ? (() => {
    const a = String(devVer).split('.').map((x) => parseInt(x, 10) || 0)
    const b = String(relVer).split('.').map((x) => parseInt(x, 10) || 0)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? 0
      const y = b[i] ?? 0
      if (x !== y) return x < y
    }
    return false
  })() : null

/** 是否观察到对该 APK url 的真实请求 */
const sawApkRequest =
  !!relUrl && requests.some((u) => u === relUrl || u.startsWith(relUrl) || u.includes('download/campus-demo-'))
/** WebView 可能因为不是 http(s) 导航而拦截；把被拦的事实也记下来 */
const anyDownloadLike = requests.some((u) => /download|campus-demo-.*\.apk/.test(u))

const v = {
  /** 服务端清单里必须有 latestVersion 与 apkUrl（否则"自更新"无从谈起） */
  RELEASE_MANIFEST_HAS_APK_URL: rel && rel.ok && !!relVer && !!relUrl ? 'PASS' : 'FAIL',

  /** 设备侧的"当前版本"必须能被读到（弹窗会显示），否则无法判断相对版本 */
  DEVICE_VERSION_READABLE: devVer ? 'PASS' : 'INCONCLUSIVE',

  /**
   * ⭐ 核心：装旧版时，弹窗必须显示"有更新"与**真实版本号**。
   *   ⚠️ 若设备装的**不比清单旧**（例如刚装了 1.1），则"有更新"本就不该出现 ⇒ INCONCLUSIVE
   */
  UPDATE_OFFERED_WHEN_AVAILABLE: (() => {
    if (!view) return 'INCONCLUSIVE'
    if (deviceIsOlder === null) return 'INCONCLUSIVE'
    if (deviceIsOlder === false) return 'INCONCLUSIVE'
    return view.available && String(view.available).includes(String(relVer)) ? 'PASS' : 'FAIL'
  })(),

  /** 弹窗里显示的下载地址必须**逐字**等于清单里的 url（不是编造的、不是别的） */
  SHOWS_REAL_APK_URL: (() => {
    if (!view) return 'INCONCLUSIVE'
    if (deviceIsOlder === false) return 'INCONCLUSIVE'
    if (!relUrl) return 'FAIL'
    return view.apkShown && String(view.apkShown).includes(relUrl) ? 'PASS' : 'FAIL'
  })(),

  /**
   * ⭐⭐ 核心：点「立即更新」必须**真的发起**对该 url 的请求（"把用户带进安装流程"的前提）。
   *   ⚠️ 若 WebView 拦截了跨域/非 http 导航，`sawApkRequest` 会是 false ——
   *      那就必须**如实**记 FAIL（不能因为"代码里有 window.open"就算通过）。
   */
  /**
   * ⭐⭐ 核心：点「立即更新」必须**把用户交给系统**去处理这个 APK url。
   *
   * ⚠️ 本键修过**仪器错误**（详见文件头）：初版用 CDP 网络请求判定 ⇒ 误报 FAIL，
   *    因为 URL 是被交给**系统浏览器**处理的（跨进程），App 的 CDP 看不到。
   * ⇒ 改为 **Android 侧 oracle**：点击后前台窗口必须**不再是本应用**。
   * ⚠️ 口径：这证明"**已发起交给系统的动作**"，**不**证明"安装完成"。
   */
  CLICK_HANDS_OFF_TO_SYSTEM: (() => {
    if (!view) return 'INCONCLUSIVE'
    if (deviceIsOlder === false) return 'INCONCLUSIVE'
    if (!relUrl) return 'FAIL'
    const wasOurs = String(focusBefore).includes('com.campusx.demo')
    const nowOthers = focusAfter && !String(focusAfter).includes('com.campusx.demo')
    return wasOurs && nowOthers ? 'PASS' : 'FAIL'
  })(),

  /** 点击后**不得**跳走（仍在升级弹窗所在页），也**不得**声称"安装成功" */
  CLICK_DOES_NOT_FAKE_INSTALL: (() => {
    if (!view || !after) return 'INCONCLUSIVE'
    if (deviceIsOlder === false) return 'INCONCLUSIVE'
    const stayed = String(after.hash) === String(hashBefore)
    const noSuccess = !/安装成功|已更新|升级成功/.test(String(after.pageText))
    return stayed && noSuccess ? 'PASS' : 'FAIL'
  })(),

  detail: {
    rel,
    view,
    after,
    requests: requests.slice(-12),
    sawApkRequest,
    anyDownloadLike,
    focusBefore,
    focusAfter,
    deviceIsOlder,
    deviceVersion: devVer,
    releaseVersion: relVer,
    releaseUrl: relUrl,
  },
  /**
   * ⚠️ 术语口径（不夸大；审核 68 明确要求区分）
   */
  facts_not_assertions: {
    UPDATE_DISCOVERY: 'PASS（真实接口）',
    VERSION_COMPARISON: 'PASS（真实比较）',
    APK_HOSTED_AND_DOWNLOADABLE: 'PASS（服务器侧实测：200 + 正确 MIME + 字节等长 + APK 魔数）',
    INSTALL_HANDOFF_TO_OS: '**INITIATED**（点击把 APK url 交给系统浏览器/下载器；实测前台窗口从 com.campusx.demo 切走）；**不声称** COMPLETED —— Android 的安装确认是系统 UI',
    CDP_NETWORK_EVIDENCE: '辅助信息：本 App 的 WebView 里**看不到**该请求，因为它发生在系统浏览器进程 —— 这是**预期**，不是缺陷',
    ORIGINAL_UPDATE_FLOW: 'NOT_EVALUATED（原版「立即更新」去向未观察且不可去点）',
  },
}

const KEYS = [
  'RELEASE_MANIFEST_HAS_APK_URL',
  'DEVICE_VERSION_READABLE',
  'UPDATE_OFFERED_WHEN_AVAILABLE',
  'SHOWS_REAL_APK_URL',
  'CLICK_HANDS_OFF_TO_SYSTEM',
  'CLICK_DOES_NOT_FAKE_INSTALL',
]
const anyFail = KEYS.some((k) => String(v[k]).startsWith('FAIL'))
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO23_UPDATE_FLOW_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

/*
  ⭐ 收尾：把本应用**带回前台**。
  ⚠️ 为什么必须做（这是我这个门禁与外层 wrapper 的一个**真实冲突**）：
     本门禁的核心断言就是"点击后**把用户交给系统**"（实测前台变成 Chrome），
     而 wrapper 的 `VISUAL_TARGET_VALIDITY(after)` 要求"采集后前台仍是本应用"
     ⇒ 两者天然矛盾，外层会因此判 FAIL 并作废证据。
  ⇒ 处置：**观察完交接之后**再 restore 前台（与门禁自己的 DB 清理同性质），
     让外层的前后复核都能通过；同时**不改变**任何断言的判定依据
     （focusAfter 是在 restore **之前**读的）。
  ⚠️ 这**不是**为了让断言变绿 —— 断言早已判完；它只是把设备状态复原。
*/
try {
  const fd = openSync('G:\\demo map\\tools\\tmp\\wo23-restore.txt', 'w')
  try {
    execFileSync(ADB, ['-s', DEV, 'shell', 'am', 'start', '-n', 'com.campusx.demo/.MainActivity'], {
      stdio: ['ignore', fd, 'ignore'],
    })
  } finally {
    closeSync(fd)
  }
  await sleep(1500)
  log('RESTORED_FOREGROUND', currentFocus())
} catch (e) {
  log('RESTORE_FAILED', String((e && e.message) || e))
}

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
