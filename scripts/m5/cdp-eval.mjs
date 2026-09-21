/**
 * 通用 CDP 求值小工具：把**一段 JS 表达式从文件里读出来**在设备 WebView 里跑。
 *
 * 为什么要单独有这个文件：
 *   本项目的纪律是"长命令/复杂文本用文件工具写，不要塞进 PowerShell 命令行"。
 *   之前把几十行 JS 内联进 pwsh 参数时，引号被 PowerShell → adb → WebView 多层解析吃掉，
 *   结果是**表达式被截断后仍然跑成功**（返回一个看似合理的错误值），排查了很久。
 *   放到 .js 文件里就没有这层引号解析。
 *
 * 用法：
 *   node scripts/m5/cdp-eval.mjs --file=<表达式文件路径> [--port=9222]
 *
 * 约定：
 *   - 前缀 `await ` 的表达式会被包进 async IIFE（并带 awaitPromise），
 *     所以文件里可以直接写 `await fetch(...)`。
 *   - 输出永远是单行 JSON：`{"ok":true,"value":...}` 或 `{"ok":false,"error":"..."}`。
 *     **失败不会伪装成成功** —— 调用方必须看 ok。
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const argOf = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? ''
const file = argOf('file')
const port = argOf('port') || '9222'
if (!file) {
  console.log(JSON.stringify({ ok: false, error: '缺少 --file' }))
  process.exit(2)
}

const src = readFileSync(file, 'utf8')
const expr = /\bawait\b/.test(src) ? `(async () => { return (${src.trim()}) })()` : src.trim()

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const target = list.find((x) => x.type === 'page')
if (!target) {
  console.log(JSON.stringify({ ok: false, error: '没有可调试页面（forward 掉了？App 冷启动过？）' }))
  process.exit(3)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ ok: false, error: 'evaluate 超时（渲染器被挂起？picker 在前台？）' }), 15000)
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id !== 1) return
    clearTimeout(timer)
    if (m.result?.exceptionDetails) {
      resolve({ ok: false, error: JSON.stringify(m.result.exceptionDetails).slice(0, 400) })
    } else {
      resolve({ ok: true, value: m.result?.result?.value ?? null })
    }
  })
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }),
  )
})
console.log(JSON.stringify(result))
try {
  ws.close()
} catch {
  /* 已关 */
}
process.exit(result.ok ? 0 : 1)
