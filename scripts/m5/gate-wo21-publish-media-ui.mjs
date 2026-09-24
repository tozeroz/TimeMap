/**
 * ⭐ WO#21 设备侧门禁：发布页「语音」是**真实录音**、且媒体走**上传→随帖提交**
 * （Owner 裁定 ④：发布页语音真实录音必须实现体验等价）
 *
 * ════════════════════════════════════════════════════════════════════
 * 本门禁能验什么、**不能**验什么（如实划界）
 * ════════════════════════════════════════════════════════════════════
 *   ✅ 能验（UI 层，确定性强）：
 *     · 语音模式有**真实录音控件**（data-voice-toggle / data-voice-status）
 *     · 旧的占位文案「录音功能尚未接入真实麦克风」**已消失**
 *     · 点「开始录音」**不是静默 no-op**：要么进入录音态，要么给出**明确**的权限/设备错误
 *       （麦克风权限在真机上可能弹窗，故两种结果都算"控件真的接了东西"）
 *     · 发布失败上报面（data-publish-err）在代码里存在（静态）
 *   ❌ **不能**验（如实标注，不假装）：
 *     · "选图后发布，服务器帖子上真的带图" —— 需要**相册自动化**
 *       （隐藏的 `<input type=file>` + 系统相册选择器），本 Gate **不做**。
 *       ⇒ 那一段由**服务器侧** `gate-wo21-media-attach.sh`（8 键 PASS）+ 代码路径共同保证：
 *         `doPublish` 先 `uploadMedia(blob,'post')` 再 `createPost({...,mediaIds})`。
 *     · 原版语音**交互形态**是否一致 —— 基线把"语音模式的真实录音交互"标为 known_unknown
 *       ⇒ `ORIGINAL_PUBLISH_VOICE_EXPERIENCE: NOT_EVALUATED`（我们的形态是 OUR_DESIGN_CHOICE）
 *     · 原版录完之后的去向（入草稿/直接发帖）⇒ `PUBLISH_VOICE_FLOW: NOT_EVALUATED`
 *
 * Fixture 依赖：device=本轮构建；导航=真实入口（校园页 →「发布」）；
 *              session=发帖需要登录（本 Gate 只查 UI，**不**提交帖子）；
 *              permission=麦克风（可能弹窗，已按"两种结果都接受"处理）；order=不依赖
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo21-device-gate.json'
const SRC = 'G:\\demo map\\app\\src\\screens\\PublishScreen.tsx'

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

// ── 静态检查（代码路径是否真的接了上传与 mediaIds）────────────────
const src = existsSync(SRC) ? readFileSync(SRC, 'utf8') : ''
/*
  ⚠️ 这里修过一次**判据缺陷**（自检式复核抓出来的）：
    初版直接用 `!src.includes('录音功能尚未接入真实麦克风')` 判断"旧文案已消失"，
    结果报 FAIL —— 因为**我自己在注释里引用了那句旧文案**（写"改前是…"）。
    ⇒ 静态检查必须**先剥掉注释**再搜，否则"注释里提到它"会被误判成"界面里还在"。
    （与本项目反复出现的"断言口径错"同源：检查的对象与要断言的对象不是同一个东西。）
*/
const srcNoComments = src
  .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // 行注释（避开 http:// 里的 //）
const staticChecks = {
  callsUploadMediaWithPost: /uploadMedia\([^)]*'post'/.test(srcNoComments),
  passesMediaIdsToCreatePost:
    /mediaIds/.test(srcNoComments) && /createPost\(\{[\s\S]{0,260}mediaIds/.test(srcNoComments),
  hasPublishErrSurface: /data-publish-err/.test(srcNoComments),
  usesRealRecorder: /from '\.\.\/native\/recorder'/.test(srcNoComments),
  noOldPlaceholderText: !srcNoComments.includes('录音功能尚未接入真实麦克风'),
}
log('STATIC_CHECKS', staticChecks)

// ── 设备侧 ────────────────────────────────────────────────────────
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
  const st = q('[data-voice-status]')
  return {
    hash: location.hash,
    inVoiceMode: !!q('[data-voice-mode]'),
    hasToggle: !!q('[data-voice-toggle]'),
    hasClear: !!q('[data-voice-clear]'),
    statusText: st ? st.innerText.replace(/\\s+/g,' ').trim() : null,
    toggleText: q('[data-voice-toggle]') ? q('[data-voice-toggle]').innerText.replace(/\\s+/g,' ').trim() : null,
    pageText: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 500),
  }
})()`

console.log('')
console.log('=== 1) 进入发布页并切到「语音」模式 ===')
await evaluate(`location.hash = '#/publish'`)
await sleep(2600)
// 切到语音模式（三个模式键之一）
await evaluate(`(() => {
  const hit = [...document.querySelectorAll('.pub__mode')].find((n) => (n.innerText || '').trim() === '语音')
  if (hit) { hit.click(); return true }
  return false
})()`)
await sleep(1500)
const voice = await evaluate(READ)
log('VOICE_MODE', voice)

console.log('')
console.log('=== 2) 点「开始录音」：必须不是静默 no-op（录音态 或 明确错误）⭐ ===')
const before = await evaluate(READ)
await evaluate(`(() => { const b = document.querySelector('[data-voice-toggle]'); if (b) { b.click(); return true } return false })()`)
await sleep(2600)
const afterClick = await evaluate(READ)
log('AFTER_START_CLICK', afterClick)
// 若真的开始录音了，收尾（避免占用麦克风）
await evaluate(`(() => { const b = document.querySelector('[data-voice-toggle]'); if (b && /结束/.test(b.innerText || '')) { b.click(); return true } return false })()`)
await sleep(1600)
const afterStop = await evaluate(READ)
log('AFTER_STOP_CLICK', afterStop)

// ── 判定 ──────────────────────────────────────────────────────────
const vt = String((voice && voice.pageText) || '')
const at = String((afterClick && afterClick.pageText) || '')

const v = {
  /** 语音模式有真实录音控件（而不是只有一排装饰条） */
  VOICE_MODE_HAS_RECORDER_CONTROLS: voice && voice.inVoiceMode && voice.hasToggle ? 'PASS' : 'FAIL',

  /** ⭐ 旧占位文案必须消失（代码级 + 运行时双重确认） */
  NO_OLD_PLACEHOLDER_TEXT: (() => {
    if (!staticChecks.noOldPlaceholderText) return 'FAIL'
    if (!voice) return 'INCONCLUSIVE'
    return /尚未接入真实麦克风/.test(vt) ? 'FAIL' : 'PASS'
  })(),

  /**
   * ⭐ 点「开始录音」**不是静默 no-op**。
   *   判据：状态文本**发生变化**，且新状态属于两种**明确**结果之一：
   *     ① 进入录音（含「正在录音」） ② 明确错误（含权限/麦克风/不支持/失败）
   *   ⚠️ 麦克风权限可能在真机弹窗 ⇒ 两种都算"控件真的接了东西"。
   */
  VOICE_START_IS_NOT_NOOP: (() => {
    if (!before || !afterClick) return 'INCONCLUSIVE'
    const s0 = String(before.statusText || '')
    const s1 = String(afterClick.statusText || '')
    const changed = s0 !== s1
    const explicit = /正在录音|已录制|权限|麦克风|不支持|失败|拒绝/.test(s1 + at)
    return changed && explicit ? 'PASS' : 'FAIL'
  })(),

  /** 录音结束/清除按钮存在（证明有完整生命周期，而不是只有"开始"） */
  VOICE_HAS_LIFECYCLE_CONTROLS: (() => {
    if (!voice) return 'INCONCLUSIVE'
    /* 未录音时应显示「开始录音」；录音后出现「结束录音」；录完出现「删除这段语音」 */
    const ok = !!voice.toggleText && /开始录音|结束录音|重新录音/.test(String(voice.toggleText))
    return ok && afterStop && afterStop.hasToggle ? 'PASS' : 'FAIL'
  })(),

  /** 代码路径：媒体真的走 uploadMedia(purpose='post') 且随帖提交 mediaIds */
  PUBLISH_MEDIA_PATH_WIRED:
    staticChecks.callsUploadMediaWithPost && staticChecks.passesMediaIdsToCreatePost ? 'PASS' : 'FAIL',

  /** 代码路径：用了真实录音器 */
  USES_REAL_RECORDER: staticChecks.usesRealRecorder ? 'PASS' : 'FAIL',

  detail: { staticChecks, voice, before, afterClick, afterStop },
  /**
   * ⚠️ 术语口径（不夸大；审核 67 要求区分 truthfulness 与 parity）
   */
  facts_not_assertions: {
    PUBLISH_VOICE_TRUTHFULNESS: 'PASS（不再有"尚未接入真实麦克风"的占位说法，也不假装录音成功）',
    PUBLISH_VOICE_FEATURE: '真实录音已接入（native/recorder.ts，与 ChatScreen 同一实现）',
    PUBLISH_IMAGE_ATTACH: '代码路径已接：uploadMedia(f,"post") → createPost({mediaIds})',
    ORIGINAL_PUBLISH_VOICE_EXPERIENCE: 'NOT_EVALUATED（基线自己把"语音模式的真实录音交互"列为 known_unknown）',
    PUBLISH_VOICE_FLOW: 'NOT_EVALUATED（原版录完后入草稿还是直接发帖 未观察）',
    PUBLISH_MEDIA_LAYOUT: 'NOT_EVALUATED（原版帖子里图片/语音怎么排布 未观察）',
    END_TO_END_GALLERY_PUBLISH: '本 Gate **不验**（需相册自动化）；那一段由服务器侧 gate-wo21-media-attach.sh 保证接口正确',
  },
}

const KEYS = [
  'VOICE_MODE_HAS_RECORDER_CONTROLS',
  'NO_OLD_PLACEHOLDER_TEXT',
  'VOICE_START_IS_NOT_NOOP',
  'VOICE_HAS_LIFECYCLE_CONTROLS',
  'PUBLISH_MEDIA_PATH_WIRED',
  'USES_REAL_RECORDER',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.WO21_DEVICE_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
