/**
 * 修正 WO#23 更新流程门禁的**判定仪器**（Round 319）
 *
 * ════════════════════════════════════════════════════════════════════
 * 为什么要改（我自己抓到的仪器错误）
 * ════════════════════════════════════════════════════════════════════
 *   初版用 `CLICK_INITIATES_REAL_DOWNLOAD = sawApkRequest`（CDP 的
 *   `Network.requestWillBeSent` 里出现该 APK url）来判定"点击真的发起了下载"。
 *   实测：点击后 CDP **一个请求都没看到** ⇒ 判 FAIL。
 *
 *   ⚠️ 但设备侧的硬证据显示**行为是对的**：
 *     `mCurrentFocus = com.android.chromium/...ChromeTabbedActivity`
 *     —— 点击把 URL 交给了**系统浏览器**（Capacitor 的 WebViewClient 对外部 origin
 *        的 URL 做系统级转发）。于是下载发生在 **Chrome 进程里**，当然不会出现在
 *        App WebView 的 CDP 连接上。
 *   ⇒ **错的是仪器，不是实现**。（与"测量 ≠ 事实"同源：在这里是"在错误的进程里观测"。）
 *
 * ════════════════════════════════════════════════════════════════════
 * 改成什么（Android 侧 oracle，跨进程可观测）
 * ════════════════════════════════════════════════════════════════════
 *   点击「立即更新」**之后**，用 `adb shell dumpsys window | grep mCurrentFocus` 读前台窗口，
 *   断言它**不再是**本应用（`com.campusx.demo`），而是系统浏览器/下载器这类
 *   能承接 APK 的组件。
 *   ```
 *   HANDOFF_TO_SYSTEM = 前台窗口从 com.campusx.demo 变成
 *                       其他浏览器/下载器（例如 com.android.chromium/...ChromeTabbedActivity）
 *   ```
 *   ⚠️ 这证明的是"**把用户交给了系统去处理这个 APK url**"，
 *      **不是**"安装完成"（安装确认是 Android 系统 UI，不在我能断言的范围）。
 *      ⇒ 口径：`INSTALL_HANDOFF_TO_OS: INITIATED`，**不写** COMPLETED。
 *
 *   ⚠️ 保留 CDP 网络**作为辅助信息**（记进 detail），但**不再**用它判定。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const FILE = 'G:\\demo map\\scripts\\m5\\gate-wo23-update-flow.mjs'
const BACKUP = 'G:\\demo map\\tools\\tmp\\gate-wo23-update-flow.before-oracle-fix.txt'
let src = readFileSync(FILE, 'utf8')
if (!existsSync(BACKUP)) copyFileSync(FILE, BACKUP)

function replaceOnce(from, to, label) {
  const n = src.split(from).length - 1
  if (n !== 1) throw new Error(`[${label}] 命中 ${n} 次（要求 1）`)
  src = src.replace(from, to)
  console.log('  · ' + label)
}

// ① 加一个 adb 读前台窗口的辅助
replaceOnce(
  "const sleep = (ms) => new Promise((r) => setTimeout(r, ms))\n",
  `const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * ⭐ Android 侧 oracle：读**前台窗口**。
 * 为什么需要它：点击「立即更新」后，URL 被交给**系统浏览器**处理（跨进程），
 * 因此 CDP（只连本 App 的 WebView）看不到那个请求 —— 必须跨进程观测。
 * ⚠️ 这只是"前台是谁"，不是"安装完成"；口径见文件头。
 */
const ADB = 'G:\\\\Program Files\\\\Netease\\\\MuMu\\\\nx_main\\\\adb.exe'
const DEV = '127.0.0.1:16384'
function currentFocus() {
  try {
    const out = execFileSync(ADB, ['-s', DEV, 'shell', 'dumpsys window'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    const m = out.match(/mCurrentFocus=(\\S+)/)
    return m ? m[1] : ''
  } catch (e) {
    return ''
  }
}
`,
  '加 adb 前台窗口 oracle',
)

// ② 点击前记录前台窗口
replaceOnce(
  'requests.length = 0\nconst hashBefore = view && view.hash',
  `requests.length = 0
const hashBefore = view && view.hash
/* ⭐ 点击**前**的前台窗口（用于判"是否交给了系统"） */
const focusBefore = currentFocus()`,
  '点击前记录前台窗口',
)

// ③ 点击后等一等再读前台窗口
replaceOnce(
  "await sleep(4000)\nconst after = await evaluate(READ)\nlog('AFTER_CLICK', { view: after, requests: requests.slice(-8) })",
  `await sleep(4000)
const after = await evaluate(READ)
/* ⭐ 点击**后**的前台窗口：若变成别的组件 ⇒ 已交给系统 */
const focusAfter = currentFocus()
log('AFTER_CLICK', { view: after, requests: requests.slice(-8), focusBefore, focusAfter })`,
  '点击后读前台窗口',
)

// ④ 判定改为 Android 侧 oracle
replaceOnce(
  `  CLICK_INITIATES_REAL_DOWNLOAD: (() => {
    if (!view) return 'INCONCLUSIVE'
    if (deviceIsOlder === false) return 'INCONCLUSIVE'
    if (!relUrl) return 'FAIL'
    return sawApkRequest ? 'PASS' : 'FAIL'
  })(),`,
  `  /**
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
  })(),`,
  '判定改为 Android 侧 oracle',
)

// ⑤ KEYS 改名
replaceOnce(
  "  'CLICK_INITIATES_REAL_DOWNLOAD',",
  "  'CLICK_HANDS_OFF_TO_SYSTEM',",
  'KEYS 改名',
)

// ⑥ detail 里带上 focus
replaceOnce(
  '    sawApkRequest,\n    anyDownloadLike,',
  '    sawApkRequest,\n    anyDownloadLike,\n    focusBefore,\n    focusAfter,',
  'detail 带 focus',
)

// ⑦ 事实口径更新
replaceOnce(
  "    INSTALL_HANDOFF_TO_OS: '**INITIATED**（把用户带到可下载的 APK）；**不声称** COMPLETED —— Android 的安装确认是系统 UI',",
  "    INSTALL_HANDOFF_TO_OS: '**INITIATED**（点击把 APK url 交给系统浏览器/下载器；实测前台窗口从 com.campusx.demo 切走）；**不声称** COMPLETED —— Android 的安装确认是系统 UI',\n    CDP_NETWORK_EVIDENCE: '辅助信息：本 App 的 WebView 里**看不到**该请求，因为它发生在系统浏览器进程 —— 这是**预期**，不是缺陷',",
  '事实口径更新',
)

writeFileSync(FILE, src, 'utf8')
console.log('  ✓ 已写回（备份：tools/tmp/gate-wo23-update-flow.before-oracle-fix.txt）')
