/**
 * ⭐⭐ WO#22 closeout（审核 68 的 P0 销项）：**真实 QR → 解码路径 → 期望 payload**
 *
 * ════════════════════════════════════════════════════════════════════
 * 审核 68 的要求（原话）
 * ════════════════════════════════════════════════════════════════════
 *   > "`SCANNER_DECODES_ACTUAL_QR: NOT_EVALUATED` 恰好就是 Owner 要求实现的
 *   >  **核心能力本身**，因此这一个 NOT_EVALUATED **不能**和视觉类 NOT_EVALUATED 一样放过。"
 *   ```
 *   生成内容固定的 QR，例如 campus-scanner-e2e-20260923
 *   → 放到另一块真实屏幕/手机上 → MuMu 当前摄像头对准
 *   → 页面应实际进入 found → decoded payload 必须逐字等于预期值 → 不触发任何业务动作
 *   ```
 *   ⚠️ "若这条环境路线确实做不到，也可以拿实际 Android 真机做一次。"
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ 本门禁**验证到什么程度**（如实划界，不夸大）
 * ════════════════════════════════════════════════════════════════════
 *   ✅ 已验证（本条 + 上一条门禁合起来）：
 *     · `gate-wo22-scanner-real.mjs`：**摄像头真的在出帧**（videoReady=4、1080×1920、
 *       **帧计数持续增长**）⇒ "camera → 帧 → 每帧 getImageData" 这一段是真的
 *     · 本条：把**真实 QR 位图**（segno 生成，payload 固定）喂进**同一条解码路径**
 *       （`drawImage → getImageData → jsQR → 状态机 → UI`），断言
 *       **页面实际进入 found 且 payload 逐字等于预期值**
 *   ❌ **未**验证（如实标注）：**摄像头的"光学成像"拍到物理二维码**那一步。
 *     原因：本机摄像头的设备是 **Integrated Camera（笔记本内置）**，
 *     物理上无法拍到自己的屏幕；而 MuMu 的摄像头源只能通过它的 **GUI** 配置
 *     （我在 MuMu 的 configs / nx_device 配置与注册表里都**没有**找到摄像头设置项，
 *       所以无法用脚本把它改成"虚拟图像"）。
 *     ⇒ 替代路径（需人工/他人设备，属要求 1 允许停下并说明的类别）：
 *        ① 在 MuMu 的 GUI 里把摄像头设为"使用电脑摄像头"，再拿**手机**显示本二维码对准；
 *        ② 或装到**真机**上对着另一块屏幕扫。
 *
 *   ⚠️ 术语口径：因此本门禁给出的是
 *     `SCANNER_DECODE_PATH_E2E: PASS`（真实 QR 位图走真实解码路径 ⇒ 正确 payload），
 *     而不是"摄像头拍到物理二维码"的 PASS。**两者不是一回事**，我不混为一谈。
 *
 * Fixture 依赖：device=本轮构建；QR fixture=segno 生成的 PNG（payload 固定）；
 *              camera=真实（本条仅用于确保进入 scanning 态）；order=不依赖
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo22-qr-e2e-gate.json'
const QR_DATAURL = 'G:\\demo map\\tools\\tmp\\scanner-e2e-qr.dataurl.txt'

/** ⭐ 固定期望载荷（审核 68 建议的内容）——**逐字**比较，不做任何归一化 */
const EXPECTED = 'campus-scanner-e2e-20260923'

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

if (!existsSync(QR_DATAURL)) {
  console.error('FATAL 缺少 QR fixture（先跑 tools/tmp/gen-qr.py）')
  process.exit(2)
}
const qrDataUrl = readFileSync(QR_DATAURL, 'utf8').trim()
log('QR_FIXTURE', { dataUrlLen: qrDataUrl.length, expected: EXPECTED })

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
  const frame = q('[data-scanner]')
  const out = q('[data-scanner-result-text]')
  return {
    hash: location.hash,
    phase: frame ? frame.getAttribute('data-scanner') : null,
    frames: frame ? Number(frame.getAttribute('data-scanner-frames') || '0') : -1,
    hasResult: !!q('[data-scanner-result]'),
    payload: out ? out.innerText.trim() : null,
    hasAgain: !!q('[data-scanner-again]'),
    text: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 300),
  }
})()`

console.log('')
/*
  ⭐⭐ 前置清理：**必须在开始前清掉上一次运行可能残留的 drawImage 补丁**。
  ⚠️ 为什么需要（真实踩到过）：补丁挂在 CanvasRenderingContext2D.prototype 上，
     而 WebView 页面在两次门禁运行之间**不会重载** ⇒ 若上一次没还原（旧版本代码没有还原逻辑），
     本次一进扫码页就**第一帧识别成功**（phase=found、frames=1）
     ⇒ 本门的 `SCANNER_WAS_SCANNING_BEFORE` 误报 FAIL，而根因在**上一次运行**。
  ⇒ 一边"运行前清理"、一边"运行后还原"，两头都做，才不会被上一次的运行状态左右。
     这也是"门禁必须自己保证前置状态"，而不是假设环境是干净的。
*/
{
  const cleared = await evaluate(`(() => {
    const p = CanvasRenderingContext2D.prototype
    if (p.__wo22patched && p.__wo22origDrawImage) {
      p.drawImage = p.__wo22origDrawImage
      delete p.__wo22patched
      delete p.__wo22origDrawImage
      return { cleared: true }
    }
    return { cleared: false, stuck: !!p.__wo22patched }
  })()`)
  log('STALE_PATCH_CLEARED', cleared)

  /*
    ⚠️⚠️ 若**清不掉**（stuck:true），说明残留的是**旧版本补丁**：
       旧版把原函数存在**闭包**里、只把 `__wo22patched=true` 挂在原型上
       ⇒ 没有任何引用能还原它 ⇒ 只能**重载页面**（原型是页面级的，重载即丢弃）。
    ⭐ 这就是"我的门禁污染了别人的门禁"的完整修复：
       既要"运行前清理 + 运行后还原"（新版本），
       也要能处理**历史上已经留下**的、清不掉的残留（重载）。
    ⚠️ 教训：给被测环境打补丁时，**必须把还原所需的引用也保存到可访问的地方**
       （把它存到原型上，而不是闭包里）—— 否则补丁就是**不可撤销**的。
  */
  if (cleared && cleared.stuck) {
    console.log('  ⚠ 检测到**不可撤销的旧补丁残留** ⇒ 重载页面以丢弃原型修改')
    await evaluate(`window.location.reload()`)
    await sleep(6000)
    const after = await evaluate(`(() => ({ patched: !!CanvasRenderingContext2D.prototype.__wo22patched, hash: location.hash }))()`)
    log('AFTER_RELOAD', after)
  }
}

console.log('')
console.log('=== 1) 进入扫码页（真实入口：抽屉「扫一扫」）→ 应进入 scanning ===')
await evaluate(`location.hash = '#/me'`)
await sleep(2200)
await evaluate(`(() => { const b = document.querySelector('button[aria-label="菜单"]'); if (b) { b.click(); return true } return false })()`)
await sleep(1500)
await evaluate(`(() => {
  const hit = [...document.querySelectorAll('.drawer__item')].find((n) => (n.innerText || '').trim() === '扫一扫')
  if (hit) { hit.click(); return true }
  return false
})()`)
await sleep(4000)
const t0 = await evaluate(READ)
log('SCANNER_T0', t0)
const hashBefore = t0 && t0.hash

console.log('')
console.log('=== 2) 把**真实 QR 位图**注入解码路径（替换帧内容，其余路径不变）⭐ ===')
/*
  注入方式（最小侵入，且**保留整条真实解码路径**）：
    只覆盖 `CanvasRenderingContext2D.prototype.drawImage` —— 当绘制源是扫码页的
    <video data-scanner-video> 时，改为绘制**真实的 QR 位图**。
  于是下游**原样**执行：getImageData → jsQR → 状态机 → UI。
  ⚠️ 我只替换"帧的内容"，**没有**替换解码器、没有替换 jsQR 调用、没有伪造 found。
*/
const injected = await evaluate(`(async () => {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = ${JSON.stringify(qrDataUrl)} })
  const proto = CanvasRenderingContext2D.prototype
  if (!proto.__wo22patched) {
    const orig = proto.drawImage
    /* ⭐ 把原函数留在 proto 上，供测试结束**还原**（见文件末尾） */
    proto.__wo22origDrawImage = orig
    proto.drawImage = function (src, ...rest) {
      if (src && src.tagName === 'VIDEO' && src.hasAttribute && src.hasAttribute('data-scanner-video')) {
        return orig.call(this, img, ...rest)
      }
      return orig.call(this, src, ...rest)
    }
    proto.__wo22patched = true
  }
  return { patched: true, imgW: img.naturalWidth, imgH: img.naturalHeight }
})()`)
log('INJECTED', injected)

console.log('')
console.log('=== 3) 等页面进入 found（不伪造：只看真实状态机结果）===')
let found = null
const tStart = Date.now()
while (Date.now() - tStart < 15000) {
  const v = await evaluate(READ)
  if (v && (v.phase === 'found' || v.hasResult)) {
    found = v
    break
  }
  await sleep(600)
}
log('SCANNER_FOUND', found || (await evaluate(READ)))

const after = await evaluate(READ)
log('SCANNER_AFTER', after)

// ── 判定 ──────────────────────────────────────────────────────────
const got = found ? found.payload : null
const v = {
  /** 前置：扫码页确实处于 scanning（真实摄像头已开），否则注入无意义 */
  SCANNER_WAS_SCANNING_BEFORE: t0 && t0.phase === 'scanning' ? 'PASS' : 'FAIL',

  /** ⭐ 核心：真实 QR 位图 → 解码 → 页面进入 found */
  SCANNER_ENTERED_FOUND: found && found.phase === 'found' && found.hasResult ? 'PASS' : 'FAIL',

  /** ⭐⭐ 核心：**解码载荷逐字等于期望值**（不做任何归一化） */
  SCANNER_PAYLOAD_MATCHES_EXACTLY: got === null ? 'FAIL' : got === EXPECTED ? 'PASS' : `FAIL（got=${JSON.stringify(got)}）`,

  /**
   * ⭐ 不触发任何业务动作：进入 found 后 URL **不变**（没有跳转/入群/签到之类），
   *   且没有出现"再扫一次"之外的额外动作按钮。
   */
  SCANNER_NO_BUSINESS_ACTION: (() => {
    if (!found) return 'FAIL'
    const samePage = String(after.hash) === String(hashBefore)
    return samePage ? 'PASS' : `FAIL（hash ${hashBefore} → ${after.hash}）`
  })(),

  detail: { expected: EXPECTED, t0, injected, found, after },
  /**
   * ⚠️ 术语口径（不夸大）—— 这两条**不是断言**，是事实登记
   */
  facts_not_assertions: {
    SCANNER_DECODE_PATH_E2E: 'PASS（真实 QR 位图走真实解码路径 ⇒ 逐字正确的 payload）',
    SCANNER_CAMERA_FRAMES_REAL: 'PASS（见 gate-wo22-scanner-real.mjs：真实摄像头出帧、帧计数持续增长）',
    SCANNER_CAMERA_OPTICS_SAW_PHYSICAL_QR: '**NOT EVALUATED** —— 本机摄像头是内置 Integrated Camera，物理上拍不到自己的屏幕；MuMu 的摄像头源只能经其 GUI 配置（其 configs/nx_device/注册表里都没有该设置项，脚本改不了）',
    SCANNER_FRAME_SOURCE_SUBSTITUTED: '是（只替换了"帧的内容"，解码器/jsQR 调用/状态机**全部原样**）',
    SCANNER_TARGET_SCAN_FLOW: 'NOT_EVALUATED（审核 68 明确：继续 NOT_EVALUATED 没关系，不要猜）',
  },
  manual_paths_if_needed: [
    '① MuMu GUI 里把摄像头设为"使用电脑摄像头"，再拿**手机**显示该二维码对准它（需人工）',
    '② 把本 APK 装到**真机**，对着另一块屏幕上的该二维码扫（需人工）',
  ],
}

const KEYS = [
  'SCANNER_WAS_SCANNING_BEFORE',
  'SCANNER_ENTERED_FOUND',
  'SCANNER_PAYLOAD_MATCHES_EXACTLY',
  'SCANNER_NO_BUSINESS_ACTION',
]
const anyFail = KEYS.some((k) => String(v[k]).startsWith('FAIL'))
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO22_QR_E2E_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

/*
  ⭐⭐ 收尾：**必须还原** drawImage 补丁。
  ════════════════════════════════════════════════════════════════════
  ⚠️ 这是一处**真实缺陷**（被最终干净回归抓出来的，值得记）
  ════════════════════════════════════════════════════════════════════
    本门禁把补丁挂在 `CanvasRenderingContext2D.prototype` 上，而 **prototype 是
    整个页面会话共享的** —— 路由切换/组件重挂载都不会清掉它。
    但它**不会**在 ws.close() 时自动消失（WebView 页面还活着）。

    后果（实测到的现象）：本门禁跑完之后，`gate-wo22-scanner-real.mjs` 里的扫码页
    **第一帧就"识别成功"** ⇒ `phase="found"`、`frames=1` ⇒
    它的核心断言 `SCANNER_DECODE_LOOP_RUNNING`（帧计数必须**持续增长**）判 **FAIL**。
    ⇒ 这正是那轮回归里"顺序敏感"的一个根因：
      **我的门禁污染了别人的门禁**，结果取决于两者谁先跑。

  处置：测试结束前把原型上的方法**还原**（与门禁自己的 DB 清理同性质），
        并把"补丁状态"写进报告，便于日后核对。
  ⚠️ 教训（与"验证产物"同源）：**测试对被测环境的修改，必须在测试结束前撤回**；
    否则它制造的问题会记在**别人**头上，而且只在特定顺序下出现 —— 极难归因。
*/
try {
  const restored = await evaluate(`(() => {
    const proto = CanvasRenderingContext2D.prototype
    if (proto.__wo22patched && proto.__wo22origDrawImage) {
      proto.drawImage = proto.__wo22origDrawImage
      delete proto.__wo22patched
      delete proto.__wo22origDrawImage
      return { restored: true }
    }
    return { restored: false, why: 'not patched' }
  })()`)
  log('DRAWIMAGE_PATCH_RESTORED', restored)
} catch (e) {
  log('DRAWIMAGE_PATCH_RESTORE_FAILED', String((e && e.message) || e))
}

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
