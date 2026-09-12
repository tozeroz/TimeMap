/**
 * 在设备上派发真实触摸手势（CDP Input.dispatchTouchEvent），用于验证地图缩放。
 *
 * 为什么不用 adb input：`adb shell input swipe` 只支持单指，
 * 双指捏合必须走 CDP 的 Input.dispatchTouchEvent。
 *
 * 用法：
 *   node tools/device-gesture.mjs double-tap <x> <y>
 *   node tools/device-gesture.mjs pinch <cx> <cy> <fromGap> <toGap> [steps]
 *
 * 前置：adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 */

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

let msgId = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg.error)
    pending.delete(msg.id)
  }
})

function send(method, params) {
  const id = ++msgId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve({ timeout: true })
      }
    }, 15000)
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function readTransform() {
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const w = document.querySelector('.map__world'); return w ? getComputedStyle(w).transform : null })()`,
    returnByValue: true,
  })
  return r?.result?.value ?? null
}

async function touch(type, points) {
  await send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ x: p[0], y: p[1] })),
  })
}

const mode = process.argv[2]

if (mode === 'double-tap') {
  const x = Number(process.argv[3])
  const y = Number(process.argv[4])
  const before = await readTransform()
  for (let i = 0; i < 2; i++) {
    await touch('touchStart', [[x, y]])
    await touch('touchEnd', [])
    await wait(90)
  }
  await wait(700)
  const after = await readTransform()
  console.log(JSON.stringify({ 手势: 'double-tap', before, after, 变化: before !== after }, null, 2))
} else if (mode === 'pinch') {
  const cx = Number(process.argv[3])
  const cy = Number(process.argv[4])
  const from = Number(process.argv[5] ?? 60)
  const to = Number(process.argv[6] ?? 260)
  const steps = Number(process.argv[7] ?? 12)
  const before = await readTransform()
  // 双指起始
  await touch('touchStart', [
    [cx - from / 2, cy],
    [cx + from / 2, cy],
  ])
  for (let i = 1; i <= steps; i++) {
    const gap = from + ((to - from) * i) / steps
    await touch('touchMove', [
      [cx - gap / 2, cy],
      [cx + gap / 2, cy],
    ])
    await wait(40)
  }
  await touch('touchEnd', [])
  await wait(700)
  const after = await readTransform()
  console.log(JSON.stringify({ 手势: `pinch ${from}->${to}`, before, after, 变化: before !== after }, null, 2))
} else if (mode === 'tap') {
  // 单击：坐标是 CSS 视口像素（不是设备像素）。
  // 用它做验收很重要 —— 它会走浏览器的真实命中测试，
  // 而 element.click() 会绕过命中测试，被别的层盖住也照样“成功”。
  const x = Number(process.argv[3])
  const y = Number(process.argv[4])
  await touch('touchStart', [[x, y]])
  await wait(60)
  await touch('touchEnd', [])
  await wait(400)
  console.log(JSON.stringify({ 手势: `tap ${x},${y}` }, null, 2))
} else if (mode === 'drag') {
  // 单指拖拽：分步派发 touchMove。比 `adb shell input swipe` 更接近真实手指，
  // 有些地图 SDK 只在收到连续的 move 流时才认拖拽。
  const x1 = Number(process.argv[3])
  const y1 = Number(process.argv[4])
  const x2 = Number(process.argv[5])
  const y2 = Number(process.argv[6])
  const steps = Number(process.argv[7] ?? 12)
  const delay = Number(process.argv[8] ?? 40)
  await touch('touchStart', [[x1, y1]])
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', [
      [x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps],
    ])
    await wait(delay)
  }
  await touch('touchEnd', [])
  await wait(800)
  console.log(JSON.stringify({ 手势: `drag ${x1},${y1} -> ${x2},${y2}` }, null, 2))
} else {
  console.error('usage: device-gesture.mjs double-tap <x> <y> | pinch <cx> <cy> <fromGap> <toGap> [steps] | drag <x1> <y1> <x2> <y2> [steps] [delayMs] | tap <x> <y>')
  process.exit(2)
}

process.exit(0)
