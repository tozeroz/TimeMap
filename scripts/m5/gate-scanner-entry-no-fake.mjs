/**
 * ⭐ Round 319 门禁：扫码**入口存在 + 无假 scanner/假成功**
 * （审核 66 的 `SCANNER_ENTRY_RESTORATION` 授权 + 本项目"不本地假成功"原则）
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ 本单的来龙去脉（含**我自己的一个错误更正**）
 * ════════════════════════════════════════════════════════════════════
 *   Round 318 我在 A4 观察里写："原版抽屉里有「扫一扫」，**我们抽屉里没有** ⇒ 缺失入口"。
 *   ⚠️ **那是错的** —— 我当时看的是**原版**的 dump，**从未核对我们自己的 `Drawer.tsx`**。
 *   Round 319 用**设备实证**核对：
 *     ```
 *     我们抽屉实际渲染：["账号与安全","编辑资料","校园认证","隐私设置","黑名单",
 *                        "版本信息","联系我们","扫一扫","更多功能/demo"]
 *     与原版实测清单比对：**我们缺少的原版条目 = []**（一个都不缺）
 *     ```
 *   ⇒ 无需"恢复入口"（它本来就在）；审核 66 的 `SCANNER_ENTRY_RESTORATION: APPROVED`
 *     是**基于我那份错误报告**作出的 ⇒ 我如实更正并报告。
 *
 *   ⭐ 而**真正**的问题在别处：我们的扫码页是一个**fake-success surface** ——
 *     其原文注释即写明"扫描几秒后「识别成功」"，实现上是
 *     `setTimeout(() => setDone(true), 5200)` **无条件**报成功 +
 *     「正在识别…」+「查看扫描结果」+ 取景框/扫描线动画 + mock 轮播提示。
 *     ⇒ 已改为如实呈现"扫码功能尚未实现"（无取景框、无扫描线、无假成功）。
 *
 * ════════════════════════════════════════════════════════════════════
 * Fixture 依赖声明
 * ════════════════════════════════════════════════════════════════════
 *   Device：WO#20/319 构建（依赖 data-scanner-unavailable / data-scanner-note 钩子）
 *   导航：真实入口（Me → 「菜单」按钮 → 抽屉「扫一扫」）
 *   session/permission：**不依赖** ／ DB：**不依赖**
 *   ⚠️ **不做**任何相机/扫码实际动作（那是写操作风险路径；原版扫码流程记 NOT_EVALUATED）
 *
 * 断言（6 键）：
 *   SCANNER_ENTRY_PRESENT_IN_DRAWER      抽屉里有「扫一扫」（入口 MATCH）
 *   DRAWER_ITEMS_MATCH_ORIGINAL          ⭐ 抽屉条目**不缺**任何原版实测条目
 *   SCANNER_EXPLICIT_UNAVAILABLE         扫码页明确说「扫码功能尚未实现」
 *   SCANNER_NO_FAKE_SUCCESS              不出现「识别成功」「查看扫描结果」
 *   SCANNER_NO_FAKE_VIEWFINDER           不出现假取景框/扫描线（scan__frame / scan__line）
 *   SCANNER_NO_MOCK_HINTS                不出现已移出的 mock 提示文案
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\scanner-gate.json'

/** 原版**实测**的抽屉条目（Round 318 只读观察 dump） */
const ORIGINAL_DRAWER_ITEMS = [
  '账号与安全',
  '编辑资料',
  '校园认证',
  '隐私设置',
  '黑名单',
  '版本信息',
  '联系我们',
  '扫一扫',
]

/** 已移出生产的 mock 提示文案（出现即说明还留着假数据） */
const MOCK_HINTS = ['扫描校园卡二维码', '扫描群邀请二维码', '扫描活动签到码']
/** 假成功/假进行中的字样 */
const FAKE_WORDS = ['识别成功', '查看扫描结果', '正在识别']

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

// ── 段 1：抽屉条目 ─────────────────────────────────────────────────
console.log('=== 1) 打开抽屉，读实际渲染的条目 ===')
await evaluate(`location.hash = '#/me'`)
await sleep(2200)
await evaluate(`(() => { const b = document.querySelector('button[aria-label="菜单"]'); if (b) { b.click(); return true } return false })()`)
await sleep(1500)
const drawer = await evaluate(`(() => {
  const items = [...document.querySelectorAll('.drawer__item')].map((n) => (n.innerText || '').trim())
  return { items, hasScanner: items.includes('扫一扫') }
})()`)
log('DRAWER', drawer)

// ── 段 2：点「扫一扫」进扫码页 ─────────────────────────────────────
console.log('')
console.log('=== 2) 点「扫一扫」→ 扫码页实际内容 ⭐ ===')
await evaluate(`(() => {
  const hit = [...document.querySelectorAll('.drawer__item')].find((n) => (n.innerText || '').trim() === '扫一扫')
  if (hit) { hit.click(); return true }
  return false
})()`)
await sleep(3200)
const scanner = await evaluate(`(() => {
  const q = (s) => document.querySelector(s)
  const txt = ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim()
  return {
    hash: location.hash,
    text: txt.slice(0, 400),
    hasUnavailableHook: !!q('[data-scanner-unavailable]'),
    hasNoteHook: !!q('[data-scanner-note]'),
    fakeViewfinderNodes: document.querySelectorAll('.scan__frame, .scan__line, .scan__corner').length,
    hasOkNode: !!q('.scan__ok'),
    hasResultButton: !!q('.scan__result'),
  }
})()`)
log('SCANNER_PAGE', scanner)

// 再等一会儿：旧实现在 5.2 秒后会"识别成功" ⇒ 必须确认新实现**不会**
await sleep(4500)
const scannerLater = await evaluate(`(() => {
  const q = (s) => document.querySelector(s)
  return {
    text: ((q('.screen') || document.body).innerText || '').replace(/\\s+/g,' ').trim().slice(0, 400),
    hasOkNode: !!q('.scan__ok'),
  }
})()`)
log('SCANNER_AFTER_WAIT', scannerLater)

// ── 判定 ───────────────────────────────────────────────────────────
const drawerItems = (drawer && drawer.items) || []
const text = String((scanner && scanner.text) || '')
const laterText = String((scannerLater && scannerLater.text) || '')

const v = {
  SCANNER_ENTRY_PRESENT_IN_DRAWER: drawer && drawer.hasScanner === true ? 'PASS' : 'FAIL',

  /** ⭐ 抽屉条目**不缺**任何原版实测条目（这条正是我 Round 318 结论错的地方） */
  DRAWER_ITEMS_MATCH_ORIGINAL: (() => {
    if (!drawer || drawerItems.length === 0) return 'INCONCLUSIVE'
    const missing = ORIGINAL_DRAWER_ITEMS.filter((n) => !drawerItems.includes(n))
    return missing.length === 0 ? 'PASS' : 'FAIL'
  })(),

  /** 扫码页必须**明确**说明尚未实现 */
  SCANNER_EXPLICIT_UNAVAILABLE:
    scanner && scanner.hasUnavailableHook && /尚未实现/.test(text) ? 'PASS' : 'FAIL',

  /** ⭐ 不得出现假成功/假进行中（含等待 4.5s 后的复查 —— 旧实现会在 5.2s 后"成功"） */
  SCANNER_NO_FAKE_SUCCESS:
    !scanner
      ? 'INCONCLUSIVE'
      : FAKE_WORDS.some((w) => text.includes(w)) ||
          FAKE_WORDS.some((w) => laterText.includes(w)) ||
          scanner.hasOkNode ||
          (scannerLater && scannerLater.hasOkNode)
        ? 'FAIL'
        : 'PASS',

  /** 不得画**假取景框/扫描线**（那会让人以为这个 app 能扫码） */
  SCANNER_NO_FAKE_VIEWFINDER:
    !scanner ? 'INCONCLUSIVE' : scanner.fakeViewfinderNodes === 0 ? 'PASS' : 'FAIL',

  /** 不得出现已移出生产的 mock 提示文案 */
  SCANNER_NO_MOCK_HINTS: !scanner ? 'INCONCLUSIVE' : MOCK_HINTS.some((h) => text.includes(h)) ? 'FAIL' : 'PASS',

  detail: {
    originalDrawerItems: ORIGINAL_DRAWER_ITEMS,
    drawer,
    scanner,
    scannerLater,
    fakeWordsChecked: FAKE_WORDS,
    mockHintsChecked: MOCK_HINTS,
  },
  /**
   * ⚠️ 术语口径（审核 66 要求"必须准确描述它完成了什么"）——
   *    以下三项**不是**断言，是**事实登记**，故意不写成 PASS，避免暗示"扫码体验完成"。
   */
  facts_not_assertions: {
    SCANNER_ENTRY_IN_ORIGINAL: 'OBSERVED',
    SCANNER_ENTRY_CURRENT: 'MATCH（我们抽屉里**本来就有**；无需"恢复"）',
    SCANNER_TARGET_SCAN_FLOW: 'NOT_EVALUATED（原版扫码后的目标页未观察：打开相机会涉及相机用途/权限，且扫码可能触发业务写入 ⇒ 只读约束下的高风险路径，未做）',
    SCANNER_FUNCTIONALITY: 'NOT_IMPLEMENTED（无摄像头扫码能力）',
    SCANNER_EXPERIENCE: '**不可写 PASS**',
  },
  fixture_dependencies: {
    device: '本轮构建（依赖 data-scanner-unavailable / data-scanner-note 钩子）',
    navigation: '真实入口：Me → button[aria-label="菜单"] → 抽屉「扫一扫」',
    session: '**不依赖**',
    permission: '**不依赖**（**不**触发相机权限）',
    db: '**不依赖**',
    order: '**不依赖**上一段状态',
  },
}

const KEYS = [
  'SCANNER_ENTRY_PRESENT_IN_DRAWER',
  'DRAWER_ITEMS_MATCH_ORIGINAL',
  'SCANNER_EXPLICIT_UNAVAILABLE',
  'SCANNER_NO_FAKE_SUCCESS',
  'SCANNER_NO_FAKE_VIEWFINDER',
  'SCANNER_NO_MOCK_HINTS',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const incon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.SCANNER_GATE = anyFail ? 'FAIL' : incon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = incon
log('VERDICT', v)

ws.close()
await sleep(300)
process.exit(anyFail ? 1 : 0)
