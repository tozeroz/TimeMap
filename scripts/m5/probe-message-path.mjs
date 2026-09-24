/**
 * 只读取证：**从"消息"列表点进会话，实际会发生什么**
 *
 * 背景（本轮源码审计发现）：
 *   app/src/screens/MessageScreen.tsx:107  navigate('chat', { id: t.id })
 *   而 t 来自 `app/src/data/mock.ts` 的 threads，id 是 **'t1' / 't2'** 这种简单字符串，
 *   不是真实会话的 UUID（种子里的真实 id 形如 66666666-cccc-4ccc-8ccc-000000000003）。
 *
 * 因此**推断**是：点会话会跳到 #/chat/t1，而真实 ChatScreen 请求
 *   GET /api/threads/t1/messages
 * 会因 id 非法而失败 → **主路径"消息 → 会话"是断的**。
 *
 * 但按纪律：**推断不算证据**。本脚本做纯只读的设备实测：
 *   ① 记录"消息"列表里实际渲染的会话项（文本 + 计数）
 *   ② 点第 1 项
 *   ③ 记录跳转后的路由、页面可见内容、以及网络请求与响应状态
 *   ④ 不做任何写操作（不输入、不点发送）
 *
 * 同时对照：直接设 hash 到**真实 UUID** 时是否正常加载（证明 ChatScreen 本身是好的，
 * 问题只在"从列表进入"这条路径）。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\msgpath-probe.json'
const REAL_THREAD = '66666666-cccc-4ccc-8ccc-000000000003'

const report = { startedAt: new Date().toISOString() }
const log = (k, v) => {
  report[k] = v
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}

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
async function evaluate(expression, timeoutMs = 30000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

// 挂钩 fetch，记录所有 /api 请求与状态
await evaluate(`(() => {
  if (!window.__MSGPATH__) {
    window.__MSGPATH__ = []
    const orig = window.fetch
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || ''
      const method = ((args[1] || {}).method || 'GET').toUpperCase()
      let status = 0
      let snippet = ''
      try {
        const res = await orig(...args)
        status = res.status
        if (url.includes('/api/')) {
          try { snippet = (await res.clone().text()).slice(0, 160) } catch {}
        }
        return res
      } catch (e) {
        status = -1
        snippet = String(e && e.message)
        throw e
      } finally {
        if (url.includes('/api/')) window.__MSGPATH__.push({ method, url: url.replace(/^https?:\\/\\/[^/]+/, ''), status, snippet })
      }
    }
  }
  window.__MSGPATH__ = []
  return true
})()`)

console.log('=== 步骤 1：进入"消息"列表（底部 tab 第一项 → #/messages）===')
await evaluate(`location.hash = '#/message'`)
await new Promise((r) => setTimeout(r, 2500))
const listState = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.row, [class*=row]')].filter(e => e.tagName === 'BUTTON')
  return {
    hash: location.hash,
    rowCount: rows.length,
    rowTexts: rows.slice(0, 4).map(r => (r.innerText || '').replace(/\\n/g, ' | ').slice(0, 80)),
    bodyHead: (document.body.innerText || '').slice(0, 300).replace(/\\n/g, ' / '),
  }
})()`)
log('STEP1_MESSAGE_LIST', listState)

console.log('')
console.log('=== 步骤 2：点第 1 个会话项（只读导航，不输入任何内容）===')
const clicked = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.row, [class*=row]')].filter(e => e.tagName === 'BUTTON')
  if (!rows.length) return { clicked: false, why: '没有可点的行' }
  const first = rows[0]
  const label = (first.innerText || '').replace(/\\n/g, ' | ').slice(0, 80)
  first.click()
  return { clicked: true, label }
})()`)
await new Promise((r) => setTimeout(r, 3000))
const afterClick = await evaluate(`(() => ({
  hash: location.hash,
  hasBubble: !!document.querySelector('[data-message-id], .bubble'),
  text: (document.body.innerText || '').slice(0, 400).replace(/\\n/g, ' / '),
  hasError: !!document.querySelector('.chat__state, .chatbar__error'),
}))()`)
log('STEP2_AFTER_CLICK', { clicked, afterClick })

const net1 = await evaluate(`window.__MSGPATH__ || []`)
log('STEP2_NETWORK', net1)

console.log('')
console.log('=== 步骤 3：对照 —— 直接设 hash 到**真实 UUID**（证明 ChatScreen 本身是好的）===')
await evaluate(`window.__MSGPATH__ = []`)
await evaluate(`location.hash = '#/chat/${REAL_THREAD}'`)
await new Promise((r) => setTimeout(r, 3000))
const realOk = await evaluate(`(() => ({
  hash: location.hash,
  bubbleCount: document.querySelectorAll('[data-message-id]').length,
  hasInput: !!document.querySelector('.chatbar__input'),
  text: (document.body.innerText || '').slice(0, 200).replace(/\\n/g, ' / '),
}))()`)
log('STEP3_REAL_UUID', realOk)
log('STEP3_NETWORK', await evaluate(`window.__MSGPATH__ || []`))

console.log('')
console.log('=== 结论（机械判定）===')
const hashAfterClick = (afterClick && afterClick.hash) || ''
const isMockId = /#\/chat\/t\d+$/.test(hashAfterClick)
const realLoaded = realOk && realOk.bubbleCount >= 1 && realOk.hasInput
const v = {
  MESSAGE_LIST_IS_MOCK_ID: isMockId,
  CLICK_LANDS_ON_NON_UUID_ROUTE: isMockId,
  REAL_UUID_LOADS_FINE: !!realLoaded,
  MESSAGE_PATH_BROKEN: isMockId && !!realLoaded ? 'YES（列表给了 mock id，而真实 UUID 可用 → 主路径断）' : 'NEEDS_REVIEW',
}
log('VERDICT', v)
ws.close()
process.exit(0)
