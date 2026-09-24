/**
 * 验证 `dismiss-blocking-modals.mjs` **真的能关掉**地图页的地理授权弹窗
 *
 * ## 为什么必须单独验这一步（不能只看"两条门禁都过了"）
 *   我把弹窗清理接进共用入口后，跑"地图 → 个人页"顺序时输出的是
 *   **「没有需要关闭的阻断式弹窗」** —— 因为地理授权状态在**同一个 App 会话里是缓存的**，
 *   弹窗只在**首次进入地图页**时出现一次。
 *   ⇒ 也就是说：**我的修复还从未被观察到真的关掉过任何东西**。
 *     那种状态下"两条门禁都 PASS"**不能**证明修复有效 —— 它只证明"这次没遇到问题"。
 *     这与本项目"敏感度必须证明能红"是同一条纪律：**新加的修复也必须被证明真的会生效**。
 *
 * ## 本脚本做什么
 *   ① 强制重启 App（`am force-stop` + `am start`）→ 让地理授权弹窗重新可能出现
 *   ② 走真实路径进地图页，**确认弹窗确实出现了**（否则后面的"已关闭"没有意义）
 *   ③ 跑 `dismiss-blocking-modals.mjs`
 *   ④ 断言弹窗**已消失**
 *   ⚠️ 若第 ② 步发现弹窗**没出现**，则如实记为"无法验证"（样本未建立），
 *      **不**把"没找到弹窗就跳过"当成通过。
 *
 * 用法：node selftest-dismiss-modals.mjs
 */
import { spawnSync } from 'node:child_process'

const ADB = 'G:\\Program Files\\Netease\\MuMu\\nx_main\\adb.exe'
const SERIAL = '127.0.0.1:16384'
const PKG = 'com.campusx.demo'
const HELPER = 'G:\\demo map\\scripts\\m5\\dismiss-blocking-modals.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const adb = (...args) => spawnSync(ADB, ['-s', SERIAL, ...args], { encoding: 'utf8' })

async function withCdp(fn) {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('没有 CDP page target')
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
  const evaluate = (expression) =>
    new Promise((r) => {
      const i = ++id
      pending.set(i, r)
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    }).then((m) => (m.result && m.result.result ? m.result.result.value : null))
  try {
    return await fn(evaluate)
  } finally {
    ws.close()
  }
}

const probeModal = `(function () {
  const m = document.querySelector('.map__modal')
  const t = m ? (m.innerText || '').slice(0, 80) : null
  return { present: !!m, text: t, hash: location.hash }
})()`

let fail = 0
console.log('=== ① 强制重启 App（让地理授权弹窗重新可能出现）===')
adb('shell', 'am', 'force-stop', PKG)
await sleep(2000)
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`)
await sleep(6000)
const pid = (adb('shell', 'pidof', PKG).stdout || '').trim()
console.log(`  pid=${pid || '(空)'}`)
if (!pid) {
  console.error('  **FAIL** 拿不到 pid，App 没起来')
  process.exit(1)
}
adb('forward', '--remove-all')
adb('forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`)
await sleep(1500)
console.log('  CDP 已转发')

console.log()
console.log('=== ② 走真实路径进地图页，确认弹窗**确实出现** ===')
const appeared = await withCdp(async (ev) => {
  await ev("location.hash = '#/campus'")
  await sleep(1500)
  await ev("location.hash = '#/map'")
  await sleep(3500)
  return await ev(probeModal)
})
console.log('  ', JSON.stringify(appeared))
if (!appeared || appeared.present !== true) {
  console.log('  ⚠️ **弹窗没有出现** → 无法建立样本。')
  console.log('     如实记为「无法验证」；**不**把"没找到弹窗"当作通过。')
  console.log()
  console.log('SELFTEST_DISMISS_MODALS: INCONCLUSIVE（样本未建立）')
  process.exit(2)
}

console.log()
console.log('=== ③ 跑清理脚本 ===')
const r = spawnSync('node', [HELPER], { encoding: 'utf8' })
console.log((r.stdout || '').trimEnd().split('\n').map((l) => '  ' + l).join('\n'))

console.log()
console.log('=== ④ 断言弹窗已消失 ===')
await sleep(1200)
const after = await withCdp(async (ev) => await ev(probeModal))
console.log('  ', JSON.stringify(after))
if (after && after.present === false) {
  console.log('  PASS 弹窗已被关闭')
} else {
  console.log('  **FAIL** 弹窗仍在')
  fail = 1
}

console.log()
if (fail === 0) console.log('SELFTEST_DISMISS_MODALS: PASS（弹窗确实出现过，且被清理脚本关掉）')
else console.log('SELFTEST_DISMISS_MODALS: FAIL')
// ⚠️ 稍等再退出：CDP 的 WebSocket 关闭需要一拍，立刻 process.exit 会让 Node 在
//    uv 异步句柄仍打开时退出（实测崩溃 Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)）
await sleep(600)
process.exit(fail)
