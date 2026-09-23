/**
 * ⭐ WO#22 门禁：扫码 = **真实取景 + 真实解码循环**（Owner 裁定 ①：必须实现体验等价）
 *
 * ════════════════════════════════════════════════════════════════════
 * 本门禁能验什么、**不能**验什么（如实划界，不假装）
 * ════════════════════════════════════════════════════════════════════
 *   ✅ 能验：
 *     · 摄像头**真的打开了**（<video> 拿到流、readyState ≥ 2、videoWidth > 0）
 *     · 解码循环**真的在逐帧跑**（`data-scanner-frames` **持续增长** —— 不是写了行 rAF 就完事）
 *     · **不再有 fake-success**（无「识别成功」、无 5.2s 无条件成功；旧占位文案已消失）
 *     · 状态**如实且互斥**（scanning / denied / unsupported / error 各有专属钩子）
 *     · 静态：jsQR 已接线、每帧 getImageData、**无任何上传**（隐私：画面只在内存里）
 *   ❌ **不能**验（如实标注）：
 *     · `SCANNER_DECODES_ACTUAL_QR` —— 需要**摄像头前有一个可扫的二维码**。
 *       本环境（MuMu）有 Back/Front 摄像头，但**没有可配置的虚拟图像摄像头**
 *       （`dumpsys media.camera` 只列出前后两个 camera，无虚拟设备）。
 *       ⇒ 记 **NOT_EVALUATED**，并给出可验证路径（见 detail.verification_paths）。
 *     · 原版扫码**后的目标页/流程** —— 只读约束下不可观察 ⇒ NOT_EVALUATED
 *
 * Fixture 依赖：device=本轮构建；permission=**摄像头**（可能弹窗 ⇒ denied 也算"如实"）；
 *              session=不依赖；db=不依赖；order=不依赖
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo22-scanner-gate.json'
const SRC = 'G:\\demo map\\app\\src\\screens\\ScannerScreen.tsx'

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

// ── 静态检查（先剥注释，避免"注释里提到即命中"的误判）───────────────
const raw = existsSync(SRC) ? readFileSync(SRC, 'utf8') : ''
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const stat = {
  importsJsQR: /from 'jsqr'/.test(src) && /jsQR\(/.test(src),
  perFrameDecode: /getImageData\(/.test(src),
  realCamera: /startCamera\(/.test(src) && /ensureCameraPermission\(/.test(src),
  /* ⚠️ 隐私：不应有任何上传调用 */
  noUploadInScanner: !/uploadMedia|fetch\(/.test(src),
  noFakeTimer: !/setTimeout\(/.test(src),
  noOldPlaceholder: !src.includes('扫码功能尚未实现'),
}
log('STATIC_CHECKS', stat)

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
  const v = q('[data-scanner-video]')
  return {
    hash: location.hash,
    phase: frame ? frame.getAttribute('data-scanner') : null,
    frames: frame ? Number(frame.getAttribute('data-scanner-frames') || '0') : -1,
    videoReady: v ? v.readyState : -1,
    videoW: v ? v.videoWidth : -1,
    videoH: v ? v.videoHeight : -1,
    hasUnsupported: !!q('[data-scanner-unsupported]'),
    hasDenied: !!q('[data-scanner-denied]'),
    hasError: !!q('[data-scanner-error]'),
    hasResult: !!q('[data-scanner-result]'),
    text: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 400),
  }
})()`

console.log('')
console.log('=== 进入扫码页（真实入口：抽屉「扫一扫」）===')
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
const v1 = await evaluate(READ)
log('SCANNER_PAGE_T0', v1)
/* 等 2.5 秒再读一次：解码循环应在推进 */
await sleep(2500)
const v2 = await evaluate(READ)
log('SCANNER_PAGE_T1', v2)

const v = {
  /** 摄像头真的打开了：video 有流且拿到尺寸 */
  SCANNER_CAMERA_IS_LIVE: (() => {
    const a = v1 && v1.videoReady >= 2 && v1.videoW > 0
    const b = v2 && v2.videoReady >= 2 && v2.videoW > 0
    return a || b ? 'PASS' : 'FAIL'
  })(),

  /**
   * ⭐ 解码循环**真的在逐帧跑**：帧计数必须增长。
   *   ⚠️ 这条是关键 —— 只断言"页面有 video 元素"证明不了解码在发生。
   */
  SCANNER_DECODE_LOOP_RUNNING: (() => {
    if (!v1 || !v2) return 'INCONCLUSIVE'
    if (v1.frames < 0 || v2.frames < 0) return 'INCONCLUSIVE'
    return v2.frames > v1.frames && v2.frames > 0 ? 'PASS' : 'FAIL'
  })(),

  /** 不再有 fake-success（运行时 + 静态双重） */
  SCANNER_NO_FAKE_SUCCESS: (() => {
    const t = String((v1 && v1.text) || '') + String((v2 && v2.text) || '')
    if (/识别成功/.test(t)) return 'FAIL'
    return stat.noFakeTimer && stat.noOldPlaceholder ? 'PASS' : 'FAIL'
  })(),

  /** 静态：jsQR 接线 + 每帧 getImageData */
  SCANNER_DECODE_WIRED: stat.importsJsQR && stat.perFrameDecode ? 'PASS' : 'FAIL',

  /** 隐私：扫码屏不做任何上传 */
  SCANNER_NO_UPLOAD: stat.noUploadInScanner ? 'PASS' : 'FAIL',

  /**
   * 状态**如实**：要么在 scanning（有取景），要么给出 denied/unsupported/error 的**明确**原因。
   * ⚠️ 不允许"既不在扫、也没有明确原因"的空白态。
   */
  SCANNER_STATE_IS_EXPLICIT: (() => {
    if (!v1) return 'INCONCLUSIVE'
    const scanning = v1.phase === 'scanning'
    const explicit =
      v1.hasDenied || v1.hasUnsupported || v1.hasError || (v1.phase === 'found' && v1.hasResult)
    return scanning || explicit ? 'PASS' : 'FAIL'
  })(),

  detail: {
    stat,
    v1,
    v2,
    frameDelta: v1 && v2 ? v2.frames - v1.frames : null,
  },
  facts_not_assertions: {
    SCANNER_CAMERA_AND_DECODE: '实现（真实取景 + 逐帧 jsQR 解码）',
    SCANNER_ENTRY: 'MATCH（抽屉「扫一扫」）',
    SCANNER_DECODES_ACTUAL_QR:
      '**NOT_EVALUATED** —— 需要摄像头前有一个可扫的二维码；本环境（MuMu）有 Back/Front 摄像头但无可配置的虚拟图像摄像头',
    SCANNER_OTHER_SYMBOLOGIES: 'NOT_EVALUATED（jsQR 只解 QR；原版是否支持条码未观察）',
    SCANNER_TARGET_SCAN_FLOW: 'NOT_EVALUATED（原版扫到码之后的去向，只读约束下不可观察）',
    SCANNER_SCANNED_RESULT_UI: 'OUR_DESIGN_CHOICE（只如实展示解到的内容，不发明"结果页"）',
  },
  verification_paths: {
    如何验证真实解码: [
      '① 在 MuMu 里把摄像头配置成"使用宿主机摄像头"，并在宿主机屏幕/纸上放一个二维码，让摄像头能看到；或',
      '② 用真机安装本 APK，对着另一个屏幕上的二维码扫；或',
      '③ 若 MuMu 支持"虚拟摄像头图片"，把二维码 PNG 设为虚拟摄像头画面（本轮未找到该配置项）',
    ],
  },
}

const KEYS = [
  'SCANNER_CAMERA_IS_LIVE',
  'SCANNER_DECODE_LOOP_RUNNING',
  'SCANNER_NO_FAKE_SUCCESS',
  'SCANNER_DECODE_WIRED',
  'SCANNER_NO_UPLOAD',
  'SCANNER_STATE_IS_EXPLICIT',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO22_SCANNER_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
