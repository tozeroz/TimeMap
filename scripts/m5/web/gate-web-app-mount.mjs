/**
 * 网页端专属门禁：**应用真的挂载了**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 为什么需要这个门禁（它是被一个真实 bug 逼出来的）
 * ════════════════════════════════════════════════════════════════════════════
 *   我在精简 index.html 注释时**误删了 `<body>` 与 `<div id="root">`**。
 *   部署后：
 *     · `/` 返回 **200**
 *     · `<title>Campus</title>` **正常**
 *     · 我的部署冒烟脚本 **全绿**
 *     · 但页面上**什么都没有**（React createRoot 拿到 null ⇒ React error #299）
 *   ⇒ "HTTP 200 + 标题对"**证明不了应用能挂载**。
 *      静态检查（HTML 里有没有 #root）也只在"部署那一刻"成立；
 *      真正要守的是**运行时**：脚本跑完之后 DOM 里到底有没有内容。
 *
 * ⇒ 本门禁断言运行时事实：根节点存在、有子树、且没有挂载期异常。
 *    ⚠️ 它与"静态检查 HTML 含 #root"**互补而非重复**：
 *       静态查的是代码/产物，本门禁查的是**浏览器里真的渲染出来了**。
 */
const PORT = process.env.CDP_PORT ?? 9222
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'https://8.148.156.146'
// ⚠️ 入口路径单独一个变量（默认 `/`）。
//    为什么分开：敏感度验证需要"让门禁去加载一个**故意坏的**页面"，
//    而**不能**通过改 WEB_ORIGIN 来做到 —— 那会让 origin 断言一起失败，
//    于是门禁变红的原因就变成了"origin 不对"，**归因错误**（假敏感度）。
//    分开之后：入口指向 /web-broken/，origin 断言依然成立，
//    变红只可能因为"应用没挂载" ⇒ 这才是有效判别力。
const WEB_ENTRY_PATH = process.env.WEB_ENTRY_PATH ?? '/'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.error('FATAL 没有 page target'); process.exit(2) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })

let id = 0
const pending = new Map()
const exceptions = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text))
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
function send(method, params = {}) {
  return new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
}
async function ev(expr, t = 20000) {
  const p = send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), t))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Runtime.enable')
await send('Page.enable')

// ⭐ 先导航到**确定的主路由**，再断言。
// ⚠️ 这里修过一次**脆性**问题：初版直接对"当前页面"断言，而前一个门禁可能把应用
//    留在全屏页面（实测留在 #/scanner）⇒ 两条断言因**环境**而误判。
//    ⇒ 门禁必须**自己建立前置条件**。
await send('Page.navigate', { url: `${WEB_ORIGIN}${WEB_ENTRY_PATH}#/campus` })

// ⚠️ 再修一次**脆性**：初版用**固定 sleep(8000)** 等加载完成。
//    实测在敏感度验证里偶发读到 origin=null（导航与评估赛跑，评估落在旧执行上下文
//    已被销毁、新页面尚未提交的时刻）⇒ 得到自相矛盾的结果。
//    ⇒ 改为**轮询等就绪**：直到 readyState=complete 且 origin 已经是我们的目标，
//      最多等 20 秒。这样"等待时间"由**实际状态**决定，而不是靠猜一个秒数。
{
  const deadline = Date.now() + 20000
  let ready = false
  while (Date.now() < deadline) {
    const st = await ev(`(() => ({ rs: document.readyState, org: location.origin, href: location.href }))()`)
    if (st && st.rs === 'complete' && String(st.org || '').startsWith(WEB_ORIGIN) && String(st.href).includes(WEB_ENTRY_PATH)) {
      ready = true
      break
    }
    await sleep(400)
  }
  if (!ready) {
    console.log('VERDICT = ' + JSON.stringify({
      ON_WEB_ORIGIN: false, ROOT_ELEMENT_PRESENT: false, ROOT_HAS_CHILDREN: false,
      PAGE_HAS_VISIBLE_TEXT: false, APP_SHELL_RENDERED: false, NO_MOUNT_EXCEPTION: false,
      detail: { reason: '页面在 20 秒内未就绪（导航未完成或未落在目标路径）', target: `${WEB_ORIGIN}${WEB_ENTRY_PATH}` },
    }))
    ws.close()
    process.exit(1)
  }
}

const v = await ev(`(() => {
  const root = document.getElementById('root')
  const txt = (document.body.innerText || '').replace(/\\s+/g, ' ').trim()
  return {
    origin: location.origin,
    hash: location.hash,
    rootExists: !!root,
    rootChildren: root ? root.childElementCount : -1,
    rootHTMLlen: root ? root.innerHTML.length : -1,
    bodyTextLen: txt.length,
    bodyTextSample: txt.slice(0, 120),
    hasTabbar: !!document.querySelector('.tabbar'),
    scriptCount: document.querySelectorAll('script').length,
    title: document.title,
  }
})()`)

const checks = {}
// ① 目标正确（避免把"模拟器里的 App"当成网页端来判定）
checks.ON_WEB_ORIGIN = String(v.origin || '').startsWith(WEB_ORIGIN)
// ② ⭐ 挂载点存在
checks.ROOT_ELEMENT_PRESENT = v.rootExists === true
// ③ ⭐ 真的渲染出了子树（这是"应用起来了"的核心判据）
checks.ROOT_HAS_CHILDREN = typeof v.rootChildren === 'number' && v.rootChildren > 0
// ④ 页面有可见文本（不是空白页）
checks.PAGE_HAS_VISIBLE_TEXT = typeof v.bodyTextLen === 'number' && v.bodyTextLen > 20
// ⑤ 应用外壳渲染出来了（底部标签栏是每个主界面都有的结构）
checks.APP_SHELL_RENDERED = v.hasTabbar === true
// ⑥ ⭐ 没有挂载期异常（React error #299 就是"容器不是 DOM 元素"，正是那个 bug 的症状）
const badExceptions = exceptions.filter((e) => /React error #299|createRoot|Target container/i.test(e))
checks.NO_MOUNT_EXCEPTION = badExceptions.length === 0

const detail = {
  origin: v.origin,
  hash: v.hash,
  rootChildren: v.rootChildren,
  rootHTMLlen: v.rootHTMLlen,
  bodyTextLen: v.bodyTextLen,
  bodyTextSample: v.bodyTextSample,
  hasTabbar: v.hasTabbar,
  mountExceptions: badExceptions.slice(0, 2),
  allExceptionCount: exceptions.length,
}
if (badExceptions.length) detail.badExceptionSample = badExceptions[0].slice(0, 300)

const fail = Object.entries(checks).filter(([, ok]) => ok !== true).map(([k]) => k)
console.log('VERDICT = ' + JSON.stringify({ ...checks, detail }))
ws.close()
process.exit(fail.length ? 1 : 0)
