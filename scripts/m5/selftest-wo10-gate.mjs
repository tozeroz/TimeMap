/**
 * WO#10 门禁的**受控敏感度自检**（REQUIRED 口径）
 *
 * ## 为什么要它
 *   本项目冻结的纪律：
 *     PREFERRED: pre-fix FAIL → fix → PASS   （我已有：改前 9 行 mock / 5 个假目标 / 零请求假成功）
 *     REQUIRED : **controlled sensitivity test** —— 破坏 invariant → Gate 必须 FAIL；恢复 → PASS
 *   只有"改前 FAIL"还不足以排除"这条断言其实恒 PASS"（例如我的选择器写错了、
 *   或范围框选错了导致什么都匹配不到）。
 *
 * ## 怎么做的（不改产品代码、不重装 APK）
 *   在**运行中的页面**上做 DOM 级受控突变，直接检验断言的**检测逻辑**：
 *     突变 A：往推荐区内注入一个 mock 专有昵称 → NO_MOCK_USER_NAMES_IN_DOM 必须 FAIL
 *     突变 B：往推荐区内注入一个"已申请"按钮     → NO_FAKE_FRIEND_REQUEST_STATE 必须 FAIL
 *     突变 C：往页面注入一个假分享目标节点        → NO_INERT_SHARE_ENTRY 必须 FAIL
 *     恢复  ：移除注入节点 → 全部回到 PASS
 *
 *   ⚠️ 这检验的是"**断言能否发现该形态**"，不是"产品是否会再次产生该形态"。
 *      后者由 PREFERRED 的改前 FAIL 证据承担。两者互补，都要有。
 */
import { readFileSync } from 'node:fs'

const FIXTURE = 'G:\\demo map\\scripts\\m5\\fixtures\\known-message-screen-mocks.json'
const FIX = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const MOCK_ONLY_NAMES = FIX.mockOnlyDisplayNames
const SUGGEST_SEL = '[data-mock-region="suggestions"]'

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target（用 run-device-gate.sh 跑，或先建好 CDP 转发）')
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

/** 与产品门禁**同一套判据**（从 fixture 取词表、限定推荐区范围） */
const evalAssertions = `
(() => {
  const sec = document.querySelector('${SUGGEST_SEL}')
  const scopeText = (sec ? sec.innerText || sec.textContent : '') || ''
  const bodyText = document.body.innerText || ''
  const names = ${JSON.stringify(MOCK_ONLY_NAMES)}
  const hitNames = sec ? names.filter((n) => scopeText.includes(n)) : ['<no-section>']
  return {
    hitNames,
    appliedInSuggest: /已申请/.test(scopeText),
    friendDialogTitle: /好友申请/.test(bodyText),
    shareTargetNodes: document.querySelectorAll('.dialog__target').length,
    inviteEntryNodes: document.querySelectorAll('.invite__btn').length,
    shareSheetNodes: document.querySelectorAll('.dialog__sheet').length,
  }
})()
`

console.log('=== 0) 基线（未突变时三条断言应为"干净"）===')
await evaluate(`location.hash = '#/campus'`)
await new Promise((r) => setTimeout(r, 2000))
await evaluate(`(() => { const b = document.querySelector('button[aria-label="消息"]'); if (b) b.click(); return true })()`)
await new Promise((r) => setTimeout(r, 2500))
const base = await evaluate(evalAssertions)
console.log('  BASE =', JSON.stringify(base))
const baseClean = base && base.hitNames.length === 0 && base.appliedInSuggest === false && base.shareTargetNodes === 0
console.log(baseClean ? '  PASS 基线干净（三条断言当前为 PASS）' : '  FAIL 基线不干净 → 后续突变结论无意义')

console.log('')
console.log('=== 突变 A：往推荐区注入 mock 专有昵称 → NO_MOCK_USER_NAMES_IN_DOM 必须 FAIL ===')
await evaluate(`(() => {
  const sec = document.querySelector('${SUGGEST_SEL}')
  if (!sec) return false
  const d = document.createElement('div')
  d.id = '__wo10_mut_name__'
  d.textContent = ${JSON.stringify(MOCK_ONLY_NAMES[0])}
  sec.appendChild(d)
  return true
})()`)
const mutA = await evaluate(evalAssertions)
console.log('  MUT_A =', JSON.stringify({ hitNames: mutA && mutA.hitNames }))
const aFails = !!(mutA && mutA.hitNames && mutA.hitNames.length > 0)
console.log(aFails ? '  PASS 突变 A 被断言捕获（hitNames 非空 → 该断言会 FAIL）' : '  FAIL 突变 A 未被捕获 → 断言没有判别力')

console.log('')
console.log('=== 突变 B：注入"已申请" → NO_FAKE_FRIEND_REQUEST_STATE 必须 FAIL ===')
await evaluate(`(() => {
  const sec = document.querySelector('${SUGGEST_SEL}')
  if (!sec) return false
  const b = document.createElement('button')
  b.id = '__wo10_mut_applied__'
  b.textContent = '已申请'
  sec.appendChild(b)
  return true
})()`)
const mutB = await evaluate(evalAssertions)
console.log('  MUT_B =', JSON.stringify({ appliedInSuggest: mutB && mutB.appliedInSuggest }))
const bFails = !!(mutB && mutB.appliedInSuggest === true)
console.log(bFails ? '  PASS 突变 B 被断言捕获（appliedInSuggest=true → 该断言会 FAIL）' : '  FAIL 突变 B 未被捕获')

console.log('')
console.log('=== 突变 C：注入假分享目标 → NO_INERT_SHARE_ENTRY 必须 FAIL ===')
await evaluate(`(() => {
  const d = document.createElement('div')
  d.id = '__wo10_mut_share__'
  d.className = 'dialog__target'
  d.textContent = '微信好友'
  document.body.appendChild(d)
  return true
})()`)
const mutC = await evaluate(evalAssertions)
console.log('  MUT_C =', JSON.stringify({ shareTargetNodes: mutC && mutC.shareTargetNodes }))
const cFails = !!(mutC && mutC.shareTargetNodes > 0)
console.log(cFails ? '  PASS 突变 C 被断言捕获（shareTargetNodes>0 → 该断言会 FAIL）' : '  FAIL 突变 C 未被捕获')

console.log('')
console.log('=== 恢复：移除全部注入节点 → 三条断言回到干净 ===')
await evaluate(`(() => {
  for (const i of ['__wo10_mut_name__', '__wo10_mut_applied__', '__wo10_mut_share__']) {
    const e = document.getElementById(i)
    if (e) e.remove()
  }
  return true
})()`)
await new Promise((r) => setTimeout(r, 400))
const restored = await evaluate(evalAssertions)
console.log('  RESTORED =', JSON.stringify(restored))
const restoredClean =
  restored && restored.hitNames.length === 0 && restored.appliedInSuggest === false && restored.shareTargetNodes === 0
console.log(restoredClean ? '  PASS 恢复后回到干净' : '  FAIL 恢复后仍不干净')

console.log('')
const allOk = baseClean && aFails && bFails && cFails && restoredClean
console.log(
  allOk
    ? 'WO10_GATE_SENSITIVITY: PASS（三条断言都能被对应突变触发 → 有判别力；恢复即改判）'
    : 'WO10_GATE_SENSITIVITY: FAIL',
)
ws.close()
process.exit(allOk ? 0 : 1)
