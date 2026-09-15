/**
 * 用鼠标事件在设备上拖拽（CDP Input.dispatchMouseEvent）。
 * 有些地图 SDK 在 WebView 里判定为「桌面环境」，只绑鼠标事件不认触摸。
 * 用法：node tools/device-mouse-drag.mjs <x1> <y1> <x2> <y2> [steps]
 */
const x1 = Number(process.argv[2] ?? 480)
const y1 = Number(process.argv[3] ?? 700)
const x2 = Number(process.argv[4] ?? 180)
const y2 = Number(process.argv[5] ?? 430)
const steps = Number(process.argv[6] ?? 12)

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function mouse(type, x, y, buttons) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e6)
    const onMsg = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id) {
        ws.removeEventListener('message', onMsg)
        resolve(msg.result ?? msg.error)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(
      JSON.stringify({
        id,
        method: 'Input.dispatchMouseEvent',
        params: { type, x, y, button: 'left', buttons, clickCount: 1 },
      }),
    )
    setTimeout(resolve, 5000)
  })
}

await mouse('mousePressed', x1, y1, 1)
for (let i = 1; i <= steps; i++) {
  await mouse('mouseMoved', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, 1)
  await wait(35)
}
await mouse('mouseReleased', x2, y2, 0)

console.log(JSON.stringify({ gesture: `mouse drag ${x1},${y1} -> ${x2},${y2}` }))
process.exit(0)
