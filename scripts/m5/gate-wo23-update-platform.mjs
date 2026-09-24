/**
 * 设备门禁（原生端）：**App 更新动作的平台语义** —— 与网页端门禁对称
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 为什么需要这一条（它是网页端那条的"对照侧"）
 * ════════════════════════════════════════════════════════════════════════════
 * WO#25 修了一个 P0：**网页端不得提供「下载 APK」作为自己的更新**，
 * 实现方式是"只在原生端渲染该动作"（`{!web && <button data-upgrade-now>}`）。
 *
 * ⚠️ 这种"按平台分支渲染"的改动，风险是**改错方向**：
 *   把按钮在原生端也一起去掉（"过度修复"），于是**手机端更新功能没了**——
 *   而网页端门禁只会检查"网页端没有这个按钮"，**发现不了原生端被误删**。
 *   ⇒ 必须有**对称的一条**在原生端断言"这个动作**仍然存在**"。
 *
 * ⭐ 这正是本项目反复强调的口径：**判据要能区分"修对了"与"改过头了"**。
 *
 * 判据（原生端）：
 *   ① 更新弹窗存在且标注 `data-upgrade-platform="native"`
 *   ② ⭐ **仍有** [data-upgrade-now]（APK 更新动作未被误删）
 *   ③ 没有网页端专属的说明（平台提示不串台）
 *   ④ 当前版本如实可见
 */
const PORT = process.env.CDP_PORT ?? 9222

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.error('FATAL 没有 page target'); process.exit(2) }
// 目标校验：必须在原生壳里（Capacitor 的 https://localhost），否则证据无意义
if (!/^https:\/\/localhost\//.test(page.url)) {
  console.error(`FATAL 目标不是原生壳（url=${page.url}）⇒ 拒绝给结论`)
  console.log('VERDICT = ' + JSON.stringify({ ON_NATIVE_SHELL: false, detail: { url: page.url } }))
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
function send(method, params = {}) {
  return new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
}
async function ev(expr, t = 20000) {
  const p = send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), t))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
await ev(`location.hash = '#/upgrade'`)
await sleep(4000)
const v = await ev(`(() => {
  const dlg = document.querySelector('.up__dialog')
  const nowBtn = document.querySelector('[data-upgrade-now]')
  const webNote = document.querySelector('[data-upgrade-web-note]')
  const cur = document.querySelector('[data-upgrade-current]')
  return {
    hash: location.hash,
    dialogPresent: !!dlg,
    platform: dlg ? dlg.getAttribute('data-upgrade-platform') : null,
    hasNowButton: !!nowBtn,
    nowButtonText: nowBtn ? (nowBtn.innerText || '').trim() : null,
    hasWebNote: !!webNote,
    currentText: cur ? (cur.innerText || '').trim() : null,
  }
})()`)

const checks = {
  ON_NATIVE_SHELL: true,
  NATIVE_UPGRADE_DIALOG_PRESENT: v.dialogPresent === true,
  NATIVE_PLATFORM_MARKED: v.platform === 'native',
  // ⭐ 核心：原生端**必须仍有** APK 更新动作（防止"改过头"把手机端更新也去掉）
  NATIVE_KEEPS_UPDATE_ACTION: v.hasNowButton === true,
  NATIVE_NO_WEB_ONLY_NOTE: v.hasWebNote === false,
  NATIVE_CURRENT_VERSION_VISIBLE: !!v.currentText && /当前版本 v/.test(v.currentText || ''),
}
console.log('VERDICT = ' + JSON.stringify({ ...checks, detail: v }))
ws.close()
process.exit(Object.values(checks).some((x) => x !== true) ? 1 : 0)
