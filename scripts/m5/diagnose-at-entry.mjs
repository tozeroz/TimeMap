/**
 * 诊断：为什么层 A 门禁找不到 AT 面板入口（`[data-at-panel-entry]`）
 *
 * 可能原因（逐一排除）：
 *   a) 安装的 APK 不是最新 bundle（Capacitor 资源被缓存）
 *   b) 群聊路由没有渲染 group 变体（variant 传错）
 *   c) 按钮渲染了但属性名不匹配（例如 JSX 里写成 data-at-panel-entry 但被打包/转义影响）
 *   d) 门禁进入的页面不是群聊页
 */
const GROUP_ID = 'aaaaaaaa-0001-4001-8001-00000000000a'

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
async function ev(expression, timeoutMs = 20000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}

// 直接进群聊页（诊断用；正式 Gate 不设 hash）
await ev(`location.hash = '#/group?id=${GROUP_ID}'`)
await new Promise((r) => setTimeout(r, 3000))

const probe = await ev(`(() => {
  const all = [...document.querySelectorAll('button')]
  return {
    hash: location.hash,
    /* bundle 指纹：新 bundle 里应当含有 atpanel 相关 class 名 */
    hasAtPanelClassInStyles: [...document.styleSheets].some((ss) => {
      try { return [...ss.cssRules].some((r) => (r.selectorText || '').includes('atpanel')) } catch { return false }
    }),
    buttonCount: all.length,
    buttonLabels: all.map((b) => b.getAttribute('aria-label')).filter(Boolean),
    hasDataAttr: !!document.querySelector('[data-at-panel-entry]'),
    grpHead: !!document.querySelector('[data-group-header]'),
    groupTitle: (document.querySelector('[data-group-title]') || {}).textContent || null,
    composerAtButtons: all.filter((b) => (b.textContent || '').trim() === '@').length,
  }
})()`)
console.log('=== 诊断：群聊页 DOM ===')
console.log(JSON.stringify(probe, null, 2))

ws.close()
process.exit(0)
