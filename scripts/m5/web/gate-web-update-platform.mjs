/**
 * 网页端门禁：**App 更新在 Web 上的平台语义**（WO#25 P0）
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 为什么需要它（这是审核方点出的 P0，而既有门禁抓不到）
 * ════════════════════════════════════════════════════════════════════════════
 * 审核方原文：
 *   「正式 Web 前必须特别处理一个 P0：App 更新 …
 *     网页端**绝不能**出现：发现新版本 → 下载 Android APK 作为自己的『更新』。
 *     Web 本身是服务器部署后刷新即更新 …
 *     这属于**平台语义正确性**，不是功能缩水。」
 *
 * ⚠️ 为什么原有门禁没抓到：`gate-wo23-update-check/-flow` 是按 **APK 场景**写的，
 *    它们验的是"检查是不是真的 / 有没有假成功 / 点击是否交给系统"——
 *    在网页端**照样 PASS**，因为"网页端该不该有这个动作"根本不在它们的判据里。
 *    ⇒ 这是"**门禁全绿掩盖语义错误**"的典型：
 *       门禁只保证"实现与它写定的口径一致"，**不保证该口径在当前平台上是对的**。
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 判据（网页端）
 * ════════════════════════════════════════════════════════════════════════════
 *   ① 更新弹窗存在，且**明确标注平台**（`data-upgrade-platform="web"`）
 *   ② ⭐ **不提供 APK 自更新动作**：页面上不存在"点击就会下载 APK"的按钮
 *   ③ ⭐ **不展示 Android 安装包地址**（那是 Android 的更新载体）
 *   ④ 如实说明网页端的更新方式（刷新即最新）
 *   ⑤ 版本信息仍然如实可见（当前版本）
 *   ⑥ 在**清单说"有更新"**的场景下也一样成立（这是最容易漏的分支：
 *      平时显示"已是最新"时看不出问题，一旦真有新版本就必须仍是网页端口径）
 *
 * ⚠️ ⑥ 用 CDP **Fetch 域拦截**发布清单接口注入"有更新"，从而**确定地**覆盖那个分支，
 *    而不是依赖"碰巧当前正好有更新"。
 */
const PORT = process.env.CDP_PORT ?? 9222
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'https://8.148.156.146'
const WEB_ENTRY_PATH = process.env.WEB_ENTRY_PATH ?? '/'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.error('FATAL 没有 page target'); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })

let id = 0
const pending = new Map()
let interceptMode = null // null | 'available'
ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Fetch.requestPaused') {
    const reqId = m.params.requestId
    if (interceptMode === 'available' && /\/api\/app\/release/.test(m.params.request.url)) {
      const body = {
        configured: true,
        latestVersion: '9.9.9',
        apkUrl: 'https://example.invalid/campus-demo-9.9.9.apk',
        notes: '门禁用注入的"有更新"场景',
      }
      await send('Fetch.fulfillRequest', {
        requestId: reqId,
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: 'application/json' },
          { name: 'access-control-allow-origin', value: WEB_ORIGIN },
        ],
        body: Buffer.from(JSON.stringify(body), 'utf8').toString('base64'),
      }).catch(() => {})
    } else {
      await send('Fetch.continueRequest', { requestId: reqId }).catch(() => {})
    }
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
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

const SNAP = `(() => {
  const dlg = document.querySelector('.up__dialog')
  const t = (document.body.innerText || '').replace(/\\s+/g,' ').trim()
  const nowBtn = document.querySelector('[data-upgrade-now]')
  const apkNote = document.querySelector('[data-upgrade-apk]')
  const webNote = document.querySelector('[data-upgrade-web-note]')
  const cur = document.querySelector('[data-upgrade-current]')
  const avail = document.querySelector('[data-upgrade-available]')
  const upToDate = document.querySelector('[data-upgrade-uptodate]')
  return {
    hash: location.hash,
    dialogPresent: !!dlg,
    platform: dlg ? dlg.getAttribute('data-upgrade-platform') : null,
    hasNowButton: !!nowBtn,
    nowButtonText: nowBtn ? (nowBtn.innerText || '').trim() : null,
    hasApkAddressNote: !!apkNote,
    apkAddressText: apkNote ? (apkNote.innerText || '').trim().slice(0, 120) : null,
    hasWebNote: !!webNote,
    webNoteText: webNote ? (webNote.innerText || '').trim().slice(0, 160) : null,
    currentText: cur ? (cur.innerText || '').trim() : null,
    availableText: avail ? (avail.innerText || '').trim() : null,
    upToDateText: upToDate ? (upToDate.innerText || '').trim() : null,
    mentionsApk: /apk/i.test(t),
    mentionsRefreshAdvice: /刷新|无需.*安装|部署更新/.test(t),
    text: t.slice(0, 320),
  }
})()`

async function freshLoad(hash, settleMs = 3500) {
  await send('Page.navigate', { url: `${WEB_ORIGIN}${WEB_ENTRY_PATH}${hash}` })
  const d1 = Date.now() + 20000
  while (Date.now() < d1) {
    const st = await ev(`(() => ({ rs: document.readyState, org: location.origin }))()`)
    if (st && st.rs === 'complete' && String(st.org || '').startsWith(WEB_ORIGIN)) break
    await sleep(400)
  }
  await send('Page.reload', { ignoreCache: true })
  const d2 = Date.now() + 20000
  while (Date.now() < d2) {
    const st = await ev(`(() => ({ rs: document.readyState, dlg: !!document.querySelector('.up__dialog') }))()`)
    if (st && st.rs === 'complete') break
    await sleep(400)
  }
  await sleep(settleMs)
}

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/app/release*' }] })

const checks = {}
const detail = {}

// ── 场景 A：清单显示"已是最新"（真实清单）──────────────────────────────
interceptMode = null
await freshLoad('#/upgrade')
const a = await ev(SNAP)
detail.realManifest = a
checks.UPGRADE_DIALOG_PRESENT = a.dialogPresent === true
checks.PLATFORM_MARKED_AS_WEB = a.platform === 'web'
// ⭐ 核心：网页端不得有"点击即下载 APK"的动作
checks.NO_APK_UPDATE_ACTION_ON_WEB = a.hasNowButton === false
// ⭐ 不得展示 Android 安装包地址
checks.NO_APK_ADDRESS_ON_WEB = a.hasApkAddressNote === false
// 版本信息仍如实可见
checks.CURRENT_VERSION_VISIBLE = !!a.currentText && /当前版本 v/.test(a.currentText || '')

// ── 场景 B：注入"有更新"⇒ 最容易漏的分支也必须仍是网页端口径 ──────────
interceptMode = 'available'
await freshLoad('#/upgrade')
const b = await ev(SNAP)
detail.injectedAvailable = b
checks.RECOGNIZES_AVAILABLE_WHEN_MANIFEST_SAYS_SO = !!b.availableText && /9\.9\.9/.test(b.availableText || '')
// ⭐ 即便"有更新"，网页端仍不得给出 APK 动作 / 地址
checks.INJECTED_AVAILABLE_STILL_NO_APK_ACTION = b.hasNowButton === false
checks.INJECTED_AVAILABLE_STILL_NO_APK_ADDRESS = b.hasApkAddressNote === false
// ⭐ 必须**如实说明**网页端怎么更新（而不是什么都不说、让用户困惑）
checks.EXPLAINS_WEB_UPDATE_MODEL = b.hasWebNote === true && /刷新|无需.*安装包|部署/.test(b.webNoteText || '')

await send('Fetch.disable').catch(() => {})

const hardFail = Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k)
console.log('VERDICT = ' + JSON.stringify({ ...checks, detail }))
ws.close()
process.exit(hardFail.length ? 1 : 0)
