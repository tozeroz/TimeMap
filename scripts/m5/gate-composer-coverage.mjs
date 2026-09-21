/**
 * `IMPLEMENTED_COMPOSER_CAPABILITY_COVERAGE` —— 高层机械覆盖检查
 *
 * （审核记录 42 建议立项、记录 43 **修正语义与命名**后定稿）
 *
 * ## 它防的是什么
 *
 * WO#7 暴露的盲区极其典型：
 * ```
 * WO#2 验证了图片发送、WO#5 验证了语音发送、服务端 Gate 验证了 text API ——
 * 三个垂直 slice 全绿，但**从来没人问"用户在 App 里能不能发文字"**。
 * ```
 * 于是"服务端支持 text、UI 也叫聊天 composer，却没有用户入口"这种
 * **横向能力缺口**能长期存在而不被任何 Gate 发现。
 *
 * ## ⚠️ 关键语义修正（审核记录 43 第 4 点）
 *
 * **不要**让它从"服务端 message kind enum"机械推出"每个 enum 都必须有 UI 入口"：
 * ```
 * 未来可能存在**内部 kind / 历史兼容 kind / 只读 kind** ——
 * 那些本来就不该有发送入口，机械一一对应会造出**假 FAIL**。
 * ```
 * 正确的关系是：
 * ```
 * declared as **user-sendable** 的能力  →  每个都必须有可达的用户路径
 *     text  → 发送控件
 *     image → 选文件控件
 *     voice → 录音控件
 * ```
 * 即检查的是 **UI ↔ "产品声明为用户可发送的能力"**，而不是 **UI ↔ DB enum**。
 *
 * 因此：
 *   · 下面的 `SENDABLE` 是**产品声明**（人工维护、每个都要给出可探测判据）
 *   · 服务端 enum 只作 **INFO 对照**打印，用来让"声明"与"实现"的漂移**可见**，
 *     **不参与判定**（不因为多了个 enum 就判 FAIL）
 *
 * ## 用法
 *   node scripts/m5/gate-composer-coverage.mjs --thread <uuid>
 *   node scripts/m5/gate-composer-coverage.mjs --thread <uuid> --server-kinds text,image,voice  # 仅作 INFO 对照
 */
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : d
}
const THREAD = arg('thread', '66666666-cccc-4ccc-8ccc-000000000003')
/** 服务端 enum，**仅作 INFO 对照**，不参与判定 */
const SERVER_KINDS = (arg('server-kinds', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
/**
 * 敏感度自检钩子（**仅用于证明本检查能失败**，正常运行不要传）。
 * 传 `--self-test-declare video` 会临时把一个"已声明但无入口"的能力加进声明表 →
 * 期望结果：该能力报 COVERAGE GAP 且整体 FAIL、exit 非零。
 * 这与本项目既有的 FIXTURE VALIDITY / SENSITIVITY 纪律同源：
 * **先证明检查能失败，它的通过才有意义**。
 */
const SELF_TEST_DECLARE = (arg('self-test-declare', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
const OUT = 'G:\\demo map\\tools\\tmp\\composer-coverage.json'

/**
 * **产品声明**：哪些能力是"用户可发送"的，以及各自的可达性判据。
 *
 * 维护规则（写在这里以免被误用）：
 *   · 新增一个**用户可发送**的消息类型时，必须在这里加一项 + 给出可探测判据；
 *     否则该能力不会被覆盖检查保护到（这正是 WO#7 缺口的成因）。
 *   · **仅服务端内部使用**的 kind **不要**加进来。
 */
const SENDABLE = [
  {
    kind: 'text',
    entry: '发送控件（.chatbar__send）—— 注意必须"输入非空 draft 后出现"才算可达；只看输入框不够',
    probe: 'text',
  },
  { kind: 'image', entry: '选文件控件（.chatbar__file）', probe: 'image' },
  { kind: 'voice', entry: '录音控件（.chatbar__mic）', probe: 'voice' },
  // 敏感度自检用：这些是"已声明但**没有**实现入口"的能力，判据恒 false
  ...SELF_TEST_DECLARE.map((k) => ({
    kind: k,
    entry: `（敏感度自检注入：${k} 没有实现入口 —— 期望被判 COVERAGE GAP）`,
    probe: 'none',
  })),
]

const report = {
  startedAt: new Date().toISOString(),
  declaredSendable: SENDABLE.map((s) => s.kind),
  serverKindsInfoOnly: SERVER_KINDS,
  thread: THREAD,
  probe: null,
  matrix: {},
  verdict: null,
}
const log = (k, v) => {
  report[k] = v
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target（用 scripts/m5/run-device-gate.sh 跑，它会先建 forward）')
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
const send = (method, params) =>
  new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
async function evaluate(expression, timeoutMs = 40000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

console.log('=== IMPLEMENTED_COMPOSER_CAPABILITY_COVERAGE ===')
console.log(`  产品声明"用户可发送"的能力: ${report.declaredSendable.join(', ')}`)
if (SERVER_KINDS.length) {
  console.log(`  服务端 enum（**仅 INFO 对照，不参与判定**）: ${SERVER_KINDS.join(', ')}`)
  const extra = SERVER_KINDS.filter((k) => !report.declaredSendable.includes(k))
  const missing = report.declaredSendable.filter((k) => !SERVER_KINDS.includes(k))
  if (extra.length) console.log(`    info 服务端有但未声明为可发送: ${extra.join(', ')}（**不判 FAIL** —— 可能是内部/历史/只读 kind）`)
  if (missing.length) console.log(`    info 已声明可发送但服务端 enum 里没有: ${missing.join(', ')}（**不判 FAIL**，但值得核对）`)
}
console.log(`  目标会话: ${THREAD}`)

await evaluate(`location.hash = '#/chat/${THREAD}'`)
await new Promise((r) => setTimeout(r, 2500))

const probe = await evaluate(`(async () => {
  const q = (s) => document.querySelector(s)
  const visible = (el) => !!el && el.offsetParent !== null && !el.disabled
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const inp = q('.chatbar__input')
  const out = {}
  const fileInput = q('.chatbar__file')
  out.image = { exists: !!fileInput, enabled: !!(fileInput && !fileInput.disabled) }
  const mic = q('.chatbar__mic')
  out.voice = { exists: !!mic, enabled: !!(mic && !mic.disabled), visible: visible(mic) }
  const beforeSend = !!q('.chatbar__send')
  if (inp) setVal(inp, 'COVERAGE-PROBE')
  await new Promise((r) => setTimeout(r, 500))
  const sendBtn = q('.chatbar__send')
  out.text = { hasInput: !!inp, sendBeforeTyping: beforeSend, sendAfterTyping: !!sendBtn, sendEnabled: !!(sendBtn && !sendBtn.disabled) }
  if (inp) setVal(inp, '')
  await new Promise((r) => setTimeout(r, 300))
  return out
})()`)
log('probe', probe)

function judge(spec, p) {
  if (spec.probe === 'text') {
    // 可达定义：输入框存在 **且** 非空 draft 后出现可用的发送控件
    return !!(p.text && p.text.hasInput && p.text.sendAfterTyping && p.text.sendEnabled)
  }
  if (spec.probe === 'image') return !!(p.image && p.image.exists && p.image.enabled)
  if (spec.probe === 'voice') return !!(p.voice && p.voice.exists && p.voice.enabled)
  return false
}

const matrix = {}
let gaps = 0
for (const s of SENDABLE) {
  const reachable = judge(s, probe || {})
  matrix[s.kind] = { reachable, entry: s.entry }
  if (!reachable) gaps++
}
log('matrix', matrix)

const verdict = gaps === 0 ? 'PASS' : 'FAIL'
console.log('')
console.log('=== 覆盖矩阵（声明的"用户可发送"能力 × 可达 UI 路径）===')
for (const s of SENDABLE) {
  console.log(`  ${s.kind.padEnd(8)} → ${matrix[s.kind].reachable ? 'REACHABLE' : '**COVERAGE GAP**'}`)
  console.log(`             判据: ${s.entry}`)
}
console.log('')
console.log(`  IMPLEMENTED_COMPOSER_CAPABILITY_COVERAGE: ${verdict}${gaps ? `（${gaps} 个已声明可发送的能力没有可达入口）` : ''}`)
console.log('')
console.log('  ⚠️ 边界 1：只证明"入口可达"，**不证明**端到端能用（后者由各 WO Gate 负责）。')
console.log('  ⚠️ 边界 2：本检查的基准是**产品声明**（SENDABLE），不是服务端 enum ——')
console.log('     未来若新增 enum，不会自动要求它有 UI 入口（可能是内部/历史/只读 kind）。')
console.log('     新增**用户可发送**类型时，必须回来在 SENDABLE 里登记，否则不受本检查保护。')

log('verdict', verdict)
ws.close()
process.exit(verdict === 'PASS' ? 0 : 1)
