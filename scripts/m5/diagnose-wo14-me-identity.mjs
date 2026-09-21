/**
 * WO14 设备侧诊断：MeScreen 的身份是否自相矛盾 / 改完昵称是否连续？
 *
 * ## 依据
 *   审核 55：WO14 = MeScreen 权威自身身份；理由「MeScreen 是主导航真实 surface，
 *   自己的身份却仍来自 mock；WO#13 已让它通往真实 ProfileEdit →
 *   若不同步会产生**新的跨页面 identity inconsistency**」。
 *   审核 55 要求**先 inventory，不要直接改**，并列出 Gate：
 *     ME_IDENTITY_FROM_SESSION / ME_DISPLAY_NAME_CONSISTENCY /
 *     PROFILE_EDIT_TO_ME_CONTINUITY / ME_AVATAR_PLACEHOLDER / NO_MOCK_SELF_IDENTITY
 *
 * ## 代码侧已看到的事实（本脚本要**实测确认**）
 *   · MeScreen.tsx:74  `<h2 className="me__name">{me.name}</h2>`          ← mock('自定义名称6')
 *   · MeScreen.tsx:73  `<img className="me__avatar" src={me.avatar} />`   ← mock 生成头像
 *   · MeScreen.tsx:105 `已登录 {session.user.displayName}`                ← **权威**
 *   ⇒ **同一屏上两个身份**：中间大名字是 mock，下面登录行是真实值
 *   · session.ts 的 getSession() 有**模块级 cache**，MeScreen 用
 *     `useState(() => getSession())` **只在挂载时读一次**
 *   ⇒ 改完昵称后：中间名字不变（mock）、登录行也不变（读到的是**旧缓存**）
 *
 * ⚠️ 本脚本会**真的改一次昵称**（用 WO#13 已批准的 PATCH），结束后**精确恢复**。
 */
const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) { console.error('FATAL 没有 CDP target'); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function ev(expression, timeoutMs = 40000) {
  const p = send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const r = await Promise.race([p, new Promise((res) => setTimeout(() => res({ TIMEOUT: true }), timeoutMs))])
  if (r.TIMEOUT) return { TIMEOUT: true }
  if (r.result && r.result.exceptionDetails) return { ERROR: r.result.exceptionDetails.text }
  return r.result && r.result.result ? r.result.result.value : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const snapMe = () => ev(`(() => {
  const name = (document.querySelector('.me__name') || {}).textContent || null
  const who = (document.querySelector('.me__authWho') || {}).textContent || null
  const av = document.querySelector('.me__avatar')
  return {
    hash: location.hash,
    centerName: name ? name.trim() : null,
    authWho: who ? who.replace(/\\s+/g, ' ').trim() : null,
    avatarIsImg: !!(av && av.tagName.toLowerCase() === 'img'),
    avatarSrcHead: av ? String(av.getAttribute('src') || '').slice(0, 24) : null,
  }
})()`)

console.log('=== 1) 先看「我的」页当前状态（同一屏的两个身份）===')
await ev(`location.hash = '#/me'`)
await sleep(2600)
const before = await snapMe()
console.log('  ', JSON.stringify(before))

console.log('')
console.log('=== 2) 会话里存的 displayName（客户端缓存）vs 服务端权威 ===')
const sessionVsServer = await ev(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  const cachedName = sess.user ? sess.user.displayName : null
  let serverName = null
  try {
    const res = await fetch('https://8.148.156.146/api/auth/me', {
      headers: sess.token ? { authorization: 'Bearer ' + sess.token } : {},
    })
    if (res.ok) { const d = await res.json(); serverName = d.displayName }
  } catch (e) { serverName = 'ERR:' + String(e && e.message) }
  return { cachedName, serverName, same: cachedName === serverName }
})()`)
console.log('  ', JSON.stringify(sessionVsServer))

console.log('')
console.log('=== 3) 走真实路径改一次昵称（ProfileEdit）===')
const editResult = await ev(`(async () => {
  location.hash = '#/me'
  await new Promise(r => setTimeout(r, 1800))
  const b = document.querySelector('[data-me-entry="edit-profile"]')
  if (!b) return { ok: false, why: '找不到「编辑资料」' }
  b.click()
  await new Promise(r => setTimeout(r, 2200))
  const row = document.querySelector('[data-pe-row="nickname"]')
  if (!row) return { ok: false, why: '找不到昵称行' }
  row.click()
  await new Promise(r => setTimeout(r, 800))
  const input = document.querySelector('[data-pe-input]')
  if (!input) return { ok: false, why: '没有输入框' }
  const NEW = 'WO14连续' + String(Date.now()).slice(-5)
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, NEW)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  document.querySelector('[data-pe-save]').click()
  await new Promise(r => setTimeout(r, 2600))
  const shown = (document.querySelector('[data-pe-name]') || {}).textContent || ''
  return { ok: true, attempted: NEW, profileEditShows: shown.trim(), saved: shown.trim() === NEW }
})()`)
console.log('  ', JSON.stringify(editResult))

console.log('')
console.log('=== 4) ⭐ 返回「我的」页：中心名字 / 登录行 是否跟着变？（PROFILE_EDIT_TO_ME_CONTINUITY）===')
await ev(`location.hash = '#/me'`)
await sleep(2600)
const after = await snapMe()
console.log('  ', JSON.stringify(after))

const target = editResult && editResult.attempted
const centerFollowed = after && after.centerName === target
const authFollowed = after && after.authWho && after.authWho.indexOf(target) >= 0
console.log('')
console.log('=== 5) 判定 ===')
console.log('  改昵称目标 =', JSON.stringify(target))
console.log('  ME_DISPLAY_NAME_CONSISTENCY（同屏两处身份是否一致）:',
  before && before.centerName && before.authWho && before.authWho.indexOf(before.centerName) >= 0
    ? 'PASS' : 'FAIL  ← 中间大名字与下面登录行**不是同一个人**')
console.log('  PROFILE_EDIT_TO_ME_CONTINUITY（改完回「我的」是否显示新值）:',
  centerFollowed && authFollowed ? 'PASS'
    : ('FAIL  ← 中心名字跟随=' + centerFollowed + ' 登录行跟随=' + authFollowed))
console.log('  NO_MOCK_SELF_IDENTITY（是否还有 mock 身份）:',
  after && after.centerName === '自定义名称6' ? 'FAIL  ← 中心名字仍是 mock 的「自定义名称6」' : '未知')
console.log('  ME_AVATAR_PLACEHOLDER（头像是否首字占位）:',
  after && after.avatarIsImg ? 'FAIL  ← 仍是 mock 生成的 <img>（src=' + after.avatarSrcHead + '…）' : 'PASS')

console.log('')
console.log('=== 6) 恢复原昵称（不污染 seed）===')
const restored = await ev(`(async () => {
  const sess = JSON.parse(localStorage.getItem('campus.demo.session.v1') || '{}')
  if (!sess.token) return { ok: false, why: '无 token' }
  const res = await fetch('https://8.148.156.146/api/users/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + sess.token },
    body: JSON.stringify({ displayName: 'Lemy' }),
  })
  const d = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, displayName: d.displayName }
})()`)
console.log('  ', JSON.stringify(restored))
ws.close()
process.exit(0)
