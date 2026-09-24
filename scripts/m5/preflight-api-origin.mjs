/**
 * `API_E2E_ORIGIN_VALIDITY` —— 设备侧 API E2E 的**机械前置**（审核记录 47 要求）
 *
 * ## 它防的是什么（本项目**已踩两次**的坑）
 *
 * 在 Capacitor WebView 里，**相对路径 fetch** 不会打到远端后端，而是打到
 * WebView 自己的本地服务器（`https://localhost`），并且**返回 HTML 且状态码 200**：
 * ```
 * fetch('/api/auth/me')        → 200  text/html   ← 其实是 index.html
 *   → res.json() 抛错/得 {}    → 看起来像"服务端没返回字段"
 * ```
 * 第一次踩：WO#5 的语音 E2E；第二次踩：WO#9A 的身份 oracle（meId 变 null）。
 * 两次都**不是**服务端问题，而是"请求根本没打到后端"。
 *
 * ## 审核 47 的原话要旨
 * ```
 * 把它从"个人经验"升级成**机械 precondition**：
 *   API_E2E_ORIGIN_VALIDITY: request URL origin == configured backend origin
 * 关键 API E2E 如果捕获到 text/html，也应该**直接 FATAL**，
 * 而不是继续 json() 后让 {} 污染后续判断。
 * ```
 *
 * ## 本脚本做什么（在设备 Gate **之前**跑）
 *   1. 确认 CDP 可达、前台是目标 App（由 run-device-gate.sh 的 VISUAL_TARGET_VALIDITY 负责）
 *   2. 在页面里用**绝对 origin** 打一次后端（`/api/health`）与一次**相对路径**同址请求
 *   3. 断言：
 *        · 绝对 origin 的响应是 JSON（content-type 不含 text/html），状态 2xx
 *        · 相对路径的响应**若**是 text/html → 只作为**已知陷阱的实证记录**（INFO），
 *          并据此提醒：所有关键断言**必须**走绝对 origin
 *   4. 任一项不满足 → **FATAL（exit 2）**，不进入后续 Gate
 *
 * 退出码：0 = PASS；2 = FATAL（前置不成立，**本次所有 API 断言都不可信**）
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\api-origin-validity.json'
const API = process.env.CAMPUS_API_ORIGIN || 'https://8.148.156.146'

const report = { startedAt: new Date().toISOString(), api: API, checks: {}, verdict: null }
const log = (k, v) => {
  report.checks[k] = v
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(`  ${k} = ${JSON.stringify(v)}`)
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('  FATAL 没有 CDP page target（先建 adb forward）')
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
async function evaluate(expression, timeoutMs = 30000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

console.log('=== API_E2E_ORIGIN_VALIDITY ===')
console.log(`  期望后端 origin: ${API}`)

// 页面的 location.origin（应当**不是**后端 origin —— 它是 Capacitor 的 https://localhost）
const pageOrigin = await evaluate(`location.origin`)
log('PAGE_ORIGIN', pageOrigin)

/*
  两条探针（同一次调用里做完，避免时序干扰）：
    A) 绝对 origin → 必须是 JSON
    B) 相对路径   → 记录它到底返回什么（用于**实证**这个陷阱，不作为通过条件）
*/
const probe = await evaluate(`(async () => {
  const out = {}
  const grab = async (label, url) => {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      const ct = res.headers.get('content-type') || ''
      let bodySample = ''
      try { bodySample = (await res.text()).slice(0, 120) } catch {}
      out[label] = { url, status: res.status, contentType: ct, isHtml: /text\\/html/i.test(ct), bodySample }
    } catch (e) {
      out[label] = { url, error: String(e && e.message) }
    }
  }
  await grab('absolute', '${API}/api/health')
  await grab('relative', '/api/health')
  return out
})()`)
log('PROBE', probe)

const abs = probe && probe.absolute ? probe.absolute : {}
const rel = probe && probe.relative ? probe.relative : {}

// ---- 判定 ----
const absOk = !abs.error && typeof abs.status === 'number' && abs.status >= 200 && abs.status < 300
const absIsHtml = !!abs.isHtml
log('ABSOLUTE_ORIGIN_REACHES_BACKEND', { ok: absOk, status: abs.status, contentType: abs.contentType, isHtml: absIsHtml })
log('RELATIVE_PATH_BEHAVIOUR_INFO', {
  note: '相对路径在 WebView 里会打到 Capacitor 本地服务器；若这里是 text/html，正是已踩两次的陷阱',
  status: rel.status,
  contentType: rel.contentType,
  isHtml: !!rel.isHtml,
})

let fatal = null
if (abs.error) {
  fatal = `绝对 origin 请求失败：${abs.error} —— 后端不可达或证书不被信任，本次所有 API 断言都不可信`
} else if (absIsHtml) {
  fatal = `绝对 origin 竟然返回 text/html（${abs.contentType}）—— 请求打到了前端而非后端`
} else if (!absOk) {
  fatal = `绝对 origin 返回非 2xx：HTTP ${abs.status}`
}

report.verdict = fatal ? 'FATAL' : 'PASS'
report.fatal = fatal
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

console.log('')
if (fatal) {
  console.log('  API_E2E_ORIGIN_VALIDITY: **FATAL**')
  console.log(`  → ${fatal}`)
  console.log('  → 按审核 47：**不进入后续 json() 解析与断言**，本次 Gate 结果一律不可信')
  ws.close()
  process.exit(2)
}
console.log('  API_E2E_ORIGIN_VALIDITY: PASS')
console.log(`  （绝对 origin ${API} 返回 JSON 且 2xx；相对路径的实际行为已记录为 INFO）`)
ws.close()
process.exit(0)
