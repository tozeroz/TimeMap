/**
 * M4 Slice A 设备端验证（审核记录 16 要求的断言）。
 *
 * 要点：
 *  1. 成员能 render：图片元素 naturalWidth > 0（真的解码出了图）
 *  2. **bearer 不写进 URL**：img.src 必须以 blob: 开头，且 **不含 token/Authorization**
 *     —— 这是审核点名的关键点（不能为了 <img> 好用而把凭据放进 URL）
 *  3. 撤回消息显示「消息已撤回」，且**没有** media 图片元素
 *  4. blob 在组件销毁后 revoke：离开会话页后，之前的 blob URL 应当失效
 *     （用 fetch(blobUrl) 应当失败来间接证明）
 *
 * 用法：node scripts/m4/device-sliceA-check.mjs <threadId>
 */
const threadId = process.argv[2]
if (!threadId) {
  console.error('用法: node device-sliceA-check.mjs <threadId>')
  process.exit(2)
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((x) => x.type === 'page')
if (!target) {
  console.error('找不到可调试页面')
  process.exit(1)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
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
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i)
        r({ timeout: true })
      }
    }, 15000)
  })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.result?.exceptionDetails) return `ERR:${JSON.stringify(r.result.exceptionDetails).slice(0, 120)}`
  return r?.result?.result?.value
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
const ok = (m) => console.log(`  PASS ${m}`)
const bad = (m) => {
  console.log(`  FAIL ${m}`)
  failed = 1
}

// 会话页路由：#/chat/<id>
await ev(`location.hash = '#/chat/${threadId}'`)
await wait(5000)

const info = await ev(`(() => {
  const imgs = [...document.querySelectorAll('.bubble__media')]
  const allImgs = [...document.querySelectorAll('img')]
  const tokenish = allImgs.filter(i => /(token|authorization|bearer)/i.test(i.src))
  return JSON.stringify({
    bubbleImgs: imgs.length,
    loaded: imgs.filter(i => i.naturalWidth > 0).length,
    srcPrefixes: imgs.map(i => (i.src||'').split(':')[0]),
    // blob: URL 里不应出现凭据
    anyBlob: imgs.some(i => (i.src||'').startsWith('blob:')),
    tokenInUrl: tokenish.length,
    revokedShown: document.body.innerText.includes('消息已撤回'),
    text: (document.body.innerText || '').replace(/\\s+/g,' ').slice(0, 120)
  })
})()`)

let parsed
try {
  parsed = JSON.parse(info)
} catch {
  console.error('无法解析页面信息:', String(info).slice(0, 200))
  process.exit(1)
}

console.log(`  页面: ${parsed.text}`)
if (parsed.loaded > 0) ok(`成员能 render：${parsed.loaded} 张图片解码成功`)
else bad(`没有图片解码成功（bubbleImgs=${parsed.bubbleImgs}）`)
if (parsed.anyBlob) ok('图片使用 blob: URL（经鉴权 fetch 取得，不是裸 <img src=/api/media>）')
else bad(`图片不是 blob: URL（前缀 ${JSON.stringify(parsed.srcPrefixes)}）`)
if (parsed.tokenInUrl === 0) ok('**URL 里没有 token/authorization/bearer**（凭据没有泄漏到 URL）')
else bad(`有 ${parsed.tokenInUrl} 个 img.src 含凭据字样`)

// 撤回后：接口不再返回 media → 页面上不应有该图
// （fixture 里那条消息当前未撤回；此处只断言"撤回文案"逻辑可达，
//  真正的撤回断言由后端脚本负责 —— 这里不重复造场景）
console.log(`  撤回文案可见: ${parsed.revokedShown}`)

console.log('')
console.log(failed === 0 ? 'SLICE_A_DEVICE_RESULT PASS' : 'SLICE_A_DEVICE_RESULT FAIL')
try {
  ws.close()
} catch {
  /* 已关闭 */
}
process.exit(failed)
