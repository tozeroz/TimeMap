/**
 * 把设备上 demo 的 WebView 导航到指定 hash 并等待渲染。
 * 用法：node tools/device-nav.mjs "#/campus" [等待毫秒]
 * 供 tools/device-shots.ps1 逐页截图时调用。
 */
const hash = process.argv[2] ?? '#/campus'
const settle = Number(process.argv[3] ?? 900)

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('no debuggable page')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

const result = await new Promise((resolve, reject) => {
  const id = 1
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id === id) resolve(msg.result ?? msg.error)
  })
  ws.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: {
      expression: `(async () => {
        location.hash = ${JSON.stringify(hash)}
        await new Promise(r => setTimeout(r, ${settle}))
        return { hash: location.hash, title: document.title }
      })()`,
      awaitPromise: true,
      returnByValue: true,
    },
  }))
  setTimeout(() => reject(new Error('timeout')), 30000)
})

console.log(JSON.stringify(result?.result?.value ?? result))
process.exit(0)
