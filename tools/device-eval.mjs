/**
 * 在设备上 demo 的 WebView 里执行 JS（调试用）。
 * 用法：
 *   node tools/device-eval.mjs --file <脚本路径> [超时毫秒]   ← 推荐（避免命令行引号/井号被 shell 吞掉）
 *   node tools/device-eval.mjs "<js 表达式>" [超时毫秒]
 *
 * 前置：adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
let expression
let timeoutMs = 30000
if (args[0] === '--file') {
  expression = readFileSync(args[1], 'utf8')
  if (args[2]) timeoutMs = Number(args[2])
} else {
  expression = args[0]
  if (args[1]) timeoutMs = Number(args[1])
}
if (!expression) {
  console.error('usage: node device-eval.mjs --file <path> | "<expression>"')
  process.exit(2)
}

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
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id === 1) resolve(msg)
  })
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true },
  }))
  setTimeout(() => reject(new Error('timeout')), timeoutMs)
})

if (result.error) {
  console.error('CDP error:', JSON.stringify(result.error))
  process.exit(1)
}
if (result.result?.exceptionDetails) {
  console.error('页面异常:', JSON.stringify(result.result.exceptionDetails).slice(0, 400))
  process.exit(1)
}
console.log(JSON.stringify(result.result?.result?.value ?? null, null, 2))
process.exit(0)
