/**
 * `COMPOSER_CAPABILITY_COVERAGE` —— 高层**机械**覆盖检查（审核记录 42 建议）
 *
 * ## 它防的是什么
 *
 * 本轮（WO#7）暴露的盲区极其典型：
 * ```
 * WO#2 验证了图片发送、WO#5 验证了语音发送、服务端 Gate 验证了 text API ——
 * 三个垂直 slice 全绿，但**从来没人问"用户在 App 里能不能发文字"**。
 * ```
 * 于是"服务端支持 text、UI 也叫聊天 composer，却没有用户入口"这种
 * **横向能力缺口**能长期存在而不被任何 Gate 发现。
 *
 * ## 本检查做什么（机械、可断言）
 *
 * 输入：**声明支持的消息类型**（`messages_kind_allowed` 约束的取值 —— 权威来源是 DB）
 * 过程：对每个类型，在真实设备上探测"是否存在可达的 UI 发送入口"
 * 输出：覆盖矩阵 + `COMPOSER_CAPABILITY_COVERAGE: PASS/FAIL`
 *
 * **FAIL 的语义**：某个声明支持的类型**没有任何可达入口** → coverage gap。
 * 这正是 WO#7 之前 text 的状态。
 *
 * ## 入口映射（kind → 可达性判据）
 *
 * 映射本身是"产品设计事实"，写在下面的 ENTRIES 里，**每个都要给出可探测的判据**：
 * ```
 * text  : 输入框存在 且 **输入非空后出现发送按钮**（不能只看输入框 —— 那正是缺口所在）
 * image : 选图 input[type=file] 存在且未禁用
 * voice : 麦克风按钮存在且未禁用
 * ```
 * ⚠️ 未知 kind（例如将来新增 video）→ 记 `NO_ENTRY_MAPPED` 并判 **FAIL**，
 *    提醒"新增了消息类型但没有覆盖检查" —— 沉默地忽略等于把这类缺口又放回去。
 *
 * ## 用法
 *   node scripts/m5/gate-composer-coverage.mjs --kinds text,image,voice --thread <uuid>
 *   # 取 kinds 的权威来源（跑在服务器上）：
 *   #   psql -Atc "select pg_get_constraintdef(oid) from pg_constraint where conname='messages_kind_allowed'"
 */
import { writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : d
}
const KINDS = (arg('kinds', 'text,image,voice') || '').split(',').map((s) => s.trim()).filter(Boolean)
const THREAD = arg('thread', '66666666-cccc-4ccc-8ccc-000000000003')
const OUT = 'G:\\demo map\\tools\\tmp\\composer-coverage.json'

const report = { startedAt: new Date().toISOString(), kindsDeclared: KINDS, thread: THREAD, probe: null, matrix: {}, verdict: null }
const log = (k, v) => {
  report[k] = v
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target（先建 adb forward tcp:9222 ...）')
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

console.log('=== COMPOSER_CAPABILITY_COVERAGE ===')
console.log(`  声明的消息类型（来自 DB 约束）: ${KINDS.join(', ')}`)
console.log(`  目标会话: ${THREAD}`)

await evaluate(`location.hash = '#/chat/${THREAD}'`)
await new Promise((r) => setTimeout(r, 2500))

// 一次把"可达入口探测"全做了（含临时输入触发发送按钮，做完清空）
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
  // image
  const fileInput = q('.chatbar__file')
  out.image = { selector: '.chatbar__file', exists: !!fileInput, enabled: !!(fileInput && !fileInput.disabled), reachable: visible(fileInput) || !!(fileInput && !fileInput.disabled) }
  // voice
  const mic = q('.chatbar__mic')
  out.voice = { selector: '.chatbar__mic', exists: !!mic, enabled: !!(mic && !mic.disabled), reachable: visible(mic) }
  // text：必须"输入后能出现发送入口"，只看输入框不够（那正是缺口所在）
  const beforeSend = !!q('.chatbar__send')
  if (inp) setVal(inp, 'COVERAGE-PROBE')
  await new Promise((r) => setTimeout(r, 500))
  const sendBtn = q('.chatbar__send')
  out.text = {
    selector: '.chatbar__input + .chatbar__send',
    hasInput: !!inp,
    sendBeforeTyping: beforeSend,
    sendAfterTyping: !!sendBtn,
    sendEnabled: !!(sendBtn && !sendBtn.disabled),
    reachable: !!inp && !!sendBtn,
  }
  if (inp) setVal(inp, '')   // 清掉探针文字
  await new Promise((r) => setTimeout(r, 300))
  return out
})()`)
log('probe', probe)

/** kind → 可达性判据（机械） */
function judge(kind, p) {
  if (kind === 'text') return { reachable: !!(p.text && p.text.reachable), why: 'input + 非空 draft 后出现的发送按钮' }
  if (kind === 'image') return { reachable: !!(p.image && p.image.reachable), why: 'input[type=file]（选图）' }
  if (kind === 'voice') return { reachable: !!(p.voice && p.voice.reachable), why: '麦克风按钮（按住说话）' }
  return { reachable: false, why: 'NO_ENTRY_MAPPED（新增了消息类型但本检查未覆盖 → 必须补映射）' }
}

const matrix = {}
let gaps = 0
for (const k of KINDS) {
  const j = judge(k, probe || {})
  matrix[k] = { reachable: j.reachable, entry: j.why }
  if (!j.reachable) gaps++
}
log('matrix', matrix)

const verdict = gaps === 0 ? 'PASS' : 'FAIL'
console.log('')
console.log('=== 覆盖矩阵 ===')
for (const k of KINDS) {
  console.log(`  ${k.padEnd(8)} → ${matrix[k].reachable ? 'REACHABLE' : '**COVERAGE GAP**'}   （入口判据: ${matrix[k].entry}）`)
}
console.log('')
console.log(`  COMPOSER_CAPABILITY_COVERAGE: ${verdict}${gaps ? `（${gaps} 个声明支持的类型没有可达入口）` : ''}`)
console.log('')
console.log('  ⚠️ 本检查的边界：只证明"入口可达"，**不证明**该入口端到端能用 ——')
console.log('     端到端能力由各自的 WO Gate 负责（如 TEXT_SEND_FUNCTIONAL / 图片 / 语音各自的断言）。')

log('verdict', verdict)
ws.close()
process.exit(verdict === 'PASS' ? 0 : 1)
