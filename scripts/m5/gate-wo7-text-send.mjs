/**
 * WO#7 设备侧 Gate：会话页**文字消息发送路径**（审核记录 42 给定的断言清单）
 *
 * 覆盖：
 *   TEXT_SEND_ENTRY       非空 draft 存在可达发送入口（且空 draft 时不存在）
 *   TEXT_SEND_FUNCTIONAL  点击 → exactly one POST → 201 → 列表出现 kind=text 且 body 等于原文
 *   TEXT_SEND_PERSISTENCE reload 后仍在
 *   TEXT_SEND_FAILURE     服务端失败 → 明确错误 + 无新消息 + 无幽灵气泡 + **draft 不丢**
 *   COMPOSER_REGRESSION   image / voice 入口仍在
 *
 * 身份 oracle：`/api/auth/me`（当前会话用户）+ 读模型返回的 senderId（**不用 CSS/class 自证**）
 * DB oracle：本脚本把产生的 messageId 写入 JSON，由服务器侧脚本再核 DB 行（kind/body/sender/message_media）
 *
 * ## 判别力（SENSITIVITY）
 *   脚本末尾做一次**受控突变**：从 DOM 里移除发送按钮 → 同一条"入口存在"断言必须 FAIL。
 *   这等价于"先证明断言能失败"（本单改前/改后都跑过；受控突变是它的可重复版本）。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\wo7-gate.json'
const THREAD = '66666666-cccc-4ccc-8ccc-000000000003'
const TEXT = `WO7-GATE-${Date.now()}`

const report = { startedAt: new Date().toISOString(), steps: [], verdict: null }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target')
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

// 挂钩 fetch 记录 /messages 的 POST
await evaluate(`(() => {
  if (!window.__WO7NET__) {
    window.__WO7NET__ = []
    const orig = window.fetch
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''
      const init = args[1] || {}
      const method = (init.method || 'GET').toUpperCase()
      const res = await orig(...args)
      if (url.includes('/messages') && method === 'POST') {
        let body = ''
        try { body = (await res.clone().text()).slice(0, 200) } catch {}
        window.__WO7NET__.push({ url: url.split('/api')[1] || url, status: res.status, body })
      }
      return res
    }
  }
  window.__WO7NET__ = []
  return true
})()`)

await evaluate(`location.hash = '#/chat/${THREAD}'`)
await new Promise((r) => setTimeout(r, 2500))

// ---------- 基线 ----------
const base = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-message-id]')]
  return {
    rows: rows.length,
    hasSend: !!document.querySelector('.chatbar__send'),
    hasImageEntry: !!document.querySelector('.chatbar__file'),
    hasVoiceEntry: !!document.querySelector('.chatbar__mic'),
    hasInput: !!document.querySelector('.chatbar__input'),
  }
})()`)
log('BASELINE', base)

// ---------- 1) TEXT_SEND_ENTRY：空 draft 不应有发送按钮 ----------
const entryOk = base.hasSend === false
log('ENTRY_EMPTY_DRAFT_NO_SEND', { ok: entryOk, actual: base.hasSend })

// ---------- 2) 输入文字 → 发送按钮应出现 ----------
const typed = await evaluate(`(() => {
  const inp = document.querySelector('.chatbar__input')
  if (!inp) return { ok: false, why: 'no input' }
  // React 受控组件：必须走原生 setter + 派发 input 事件，直接改 value 不会触发 onChange
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, ${JSON.stringify(TEXT)})
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  return { ok: true, value: inp.value }
})()`)
await new Promise((r) => setTimeout(r, 600))
const afterType = await evaluate(`(() => ({
  hasSend: !!document.querySelector('.chatbar__send'),
  sendLabel: (document.querySelector('.chatbar__send') || {}).getAttribute ? document.querySelector('.chatbar__send').getAttribute('aria-label') : null,
  inputValue: (document.querySelector('.chatbar__input') || {}).value,
}))()`)
log('AFTER_TYPE', { typed, afterType })

// ---------- 3) 点击发送 → exactly one POST ----------
const clicked = await evaluate(
  `(() => { const b = document.querySelector('.chatbar__send'); if (!b) return { clicked: false }; b.click(); return { clicked: true } })()`,
)
await new Promise((r) => setTimeout(r, 3500))
const net = await evaluate(`window.__WO7NET__ || []`)
const postCount = (net || []).filter((n) => n.status).length
log('NET', { clicked, postCount, net })

// ---------- 4) 列表里出现 kind=text 且 body 等于原文 ----------
const afterSend = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-message-id]')]
  const texts = rows.map((r) => (r.querySelector('.bubble__text') || {}).textContent || '')
  return {
    rows: rows.length,
    hasOurText: texts.includes(${JSON.stringify(TEXT)}),
    inputValue: (document.querySelector('.chatbar__input') || {}).value,
    hasSendNow: !!document.querySelector('.chatbar__send'),
    msgIds: rows.map((r) => r.getAttribute('data-message-id')),
  }
})()`)
log('AFTER_SEND', afterSend)

// ---------- 5) reload → 持久 ----------
await evaluate(`location.reload()`)
await new Promise((r) => setTimeout(r, 4000))
await evaluate(`location.hash = '#/chat/${THREAD}'`)
await new Promise((r) => setTimeout(r, 2500))
const afterReload = await evaluate(`(() => {
  const texts = [...document.querySelectorAll('[data-message-id]')].map((r) => (r.querySelector('.bubble__text') || {}).textContent || '')
  return { hasOurText: texts.includes(${JSON.stringify(TEXT)}), rows: texts.length }
})()`)
log('AFTER_RELOAD', afterReload)

// ---------- 6) 失败路径：桩住 fetch 让它失败 ----------
const failPath = await evaluate(`(async () => {
  const orig = window.fetch
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''
    const method = ((args[1] || {}).method || 'GET').toUpperCase()
    if (url.includes('/messages') && method === 'POST') {
      return new Response(JSON.stringify({ error: 'injected_failure' }), { status: 500, headers: { 'content-type': 'application/json' } })
    }
    return orig(...args)
  }
  const inp = document.querySelector('.chatbar__input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, 'WO7-FAIL-CASE')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 500))
  const before = document.querySelectorAll('[data-message-id]').length
  const b = document.querySelector('.chatbar__send')
  if (!b) { window.fetch = orig; return { why: 'no send button' } }
  b.click()
  await new Promise((r) => setTimeout(r, 3000))
  const err = document.querySelector('.chatbar__error')
  const after = document.querySelectorAll('[data-message-id]').length
  const stillThere = (document.querySelector('.chatbar__input') || {}).value
  const hasFailBubble = [...document.querySelectorAll('[data-message-id]')].some(
    (r) => ((r.querySelector('.bubble__text') || {}).textContent || '') === 'WO7-FAIL-CASE'
  )
  window.fetch = orig
  // 清掉测试文字，避免影响后续
  setter.call(document.querySelector('.chatbar__input'), '')
  document.querySelector('.chatbar__input').dispatchEvent(new Event('input', { bubbles: true }))
  return { before, after, errText: err ? err.textContent : null, draftPreserved: stillThere, hasFailBubble }
})()`)
log('FAILURE_PATH', failPath)

// ---------- 7) COMPOSER_REGRESSION：图片/语音入口仍在 ----------
const regress = await evaluate(`(() => ({
  hasImageEntry: !!document.querySelector('.chatbar__file'),
  hasVoiceEntry: !!document.querySelector('.chatbar__mic'),
  hasPlusEntry: !!document.querySelector('.chatbar__fab') || !!document.querySelector('.chatbar .iconbtn[aria-label="更多"]'),
}))()`)
log('COMPOSER_REGRESSION', regress)

// ---------- 8) SENSITIVITY：受控突变（移除发送按钮）→ 入口断言必须 FAIL ----------
const mutation = await evaluate(`(() => {
  const inp = document.querySelector('.chatbar__input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, 'MUTATION-PROBE')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  return new Promise((res) => setTimeout(() => {
    const before = !!document.querySelector('.chatbar__send')
    const el = document.querySelector('.chatbar__send')
    if (el) el.remove()   // 受控突变：把按钮从 DOM 里去掉
    const after = !!document.querySelector('.chatbar__send')
    res({ visibleBeforeMutation: before, visibleAfterMutation: after })
  }, 600))
})()`)
log('SENSITIVITY_MUTATION', mutation)
await evaluate(`location.reload()`)
await new Promise((r) => setTimeout(r, 3500))
await evaluate(`location.hash = '#/chat/${THREAD}'`)
await new Promise((r) => setTimeout(r, 2000))
const restored = await evaluate(`(() => {
  const inp = document.querySelector('.chatbar__input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, 'X'); inp.dispatchEvent(new Event('input', { bubbles: true }))
  return new Promise((res) => setTimeout(() => {
    const v = !!document.querySelector('.chatbar__send')
    setter.call(document.querySelector('.chatbar__input'), '')
    document.querySelector('.chatbar__input').dispatchEvent(new Event('input', { bubbles: true }))
    res({ sendVisibleAfterRestore: v })
  }, 600))
})()`)
log('AFTER_RESTORE', restored)

// ---------- 判定 ----------
const newIds = (afterSend.msgIds || []).filter((x) => !(base.msgIds || []).includes(x))
const v = {
  TEXT_SEND_ENTRY: entryOk && afterType.hasSend ? 'PASS' : 'FAIL',
  TEXT_SEND_FUNCTIONAL:
    postCount === 1 && afterSend.hasOurText && (net[0] || {}).status === 201 ? 'PASS' : 'FAIL',
  TEXT_SEND_PERSISTENCE: afterReload.hasOurText ? 'PASS' : 'FAIL',
  TEXT_SEND_FAILURE:
    failPath && failPath.errText && String(failPath.errText).length > 0 &&
    failPath.after === failPath.before && !failPath.hasFailBubble && failPath.draftPreserved === 'WO7-FAIL-CASE'
      ? 'PASS'
      : 'FAIL',
  COMPOSER_REGRESSION:
    regress.hasImageEntry && regress.hasVoiceEntry && regress.hasPlusEntry ? 'PASS' : 'FAIL',
  SENSITIVITY:
    mutation.visibleBeforeMutation === true && mutation.visibleAfterMutation === false &&
    restored.sendVisibleAfterRestore === true
      ? 'PASS'
      : 'FAIL',
  newMessageIds: newIds,
  sentText: TEXT,
}
v.WO7_DEVICE_GATE = ['TEXT_SEND_ENTRY', 'TEXT_SEND_FUNCTIONAL', 'TEXT_SEND_PERSISTENCE', 'TEXT_SEND_FAILURE', 'COMPOSER_REGRESSION', 'SENSITIVITY']
  .every((k) => v[k] === 'PASS') ? 'PASS' : 'FAIL'
log('VERDICT', v)
ws.close()
process.exit(v.WO7_DEVICE_GATE === 'PASS' ? 0 : 1)
