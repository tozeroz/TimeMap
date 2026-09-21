/**
 * M3 Slice 4 设备端：poi-detail 与**可采信只读证据**的结构一致性检查。
 *
 * 为什么这一页可以做一致性判定（而 at-panel / media-preview 不行）：
 * poi-detail 的证据是**只读**取得的（supplements/poi-detail.json），
 * 未被 provenance 审计排除；另外两页的证据依赖第三方写操作，只能当设计线索。
 *
 * 依据（原版控件树，1080×1920）：
 *   iv_poi_detail_dynamic_back [14,88][112,186]   返回（左上）
 *   tv_poi_name [28,500][978,566]                地点名（大号加粗、占满宽度）
 *   iv_poi_detail_share [992,500][1059,567]      分享（右上，与地点名同行）
 *   tv_distance [28,580][124,637]                「距我4公里」
 *   tv_address [138,580][1052,637]               完整地址（与距离同一行，距离在左）
 *   图片 + view_user_tag（作者标签叠在图片上）
 *   **没有**中心标题、统计、动作按钮、"最近来过"
 */
const PLACE = 'cccccccc-0001-4001-8001-000000000001'

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!target) {
  console.error('no debuggable page')
  process.exit(1)
}

let ws
let msgId = 0
let pending = new Map()

async function connect() {
  const l = await (await fetch('http://127.0.0.1:9222/json')).json()
  const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl)
  if (!t) throw new Error('找不到可调试页面')
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  })
  for (let i = 0; i < 20; i++) {
    const p = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
    if (p && !p.timeout && p.result?.result?.value) return
    await wait(400)
  }
  throw new Error('调试会话不可用')
}

await connect()

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
    }, 20000)
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  if (!r || r.timeout) throw new Error(`CDP 超时: ${expression.slice(0, 60)}`)
  if (r.result?.exceptionDetails) throw new Error(`页面异常: ${JSON.stringify(r.result.exceptionDetails).slice(0, 200)}`)
  const v = r.result?.result?.value
  return v === undefined ? null : v
}

function shutdown(code) {
  try {
    ws.close()
  } catch {
    /* 已关闭 */
  }
  process.exit(code)
}

const bodyText = async () => {
  const v = await evaluate(`(document.body ? document.body.innerText : '').replace(/\\s+/g, ' ')`)
  return typeof v === 'string' ? v : ''
}

let failed = 0
const ok = (m) => console.log(`  PASS ${m}`)
const bad = (m) => {
  console.log(`  FAIL ${m}`)
  failed = 1
}

await evaluate(`location.hash = '#/poidetail?id=${PLACE}'`)
await wait(3000)
const t = await bodyText()
console.log(`  页面: ${t.slice(0, 140)}`)

// 1) 地点名（证据里有 tv_poi_name，大号加粗占满宽度）
if (t.includes('北京交通大学')) ok('显示地点名（tv_poi_name 对应项）')
else bad('没有显示地点名')

// 2) 距离：证据里是「距我N公里」
if (/距我\s*\d+\s*公里/.test(t)) ok(`显示「${(t.match(/距我\s*\d+\s*公里/) ?? [''])[0]}」（tv_distance 对应项）`)
else bad('没有显示「距我N公里」')

// 3) 地址：证据里与距离同一行
if (t.includes('西直门外上园村3号')) ok('显示完整地址（tv_address 对应项）')
else bad('没有显示地址')

// 4) 该地点的动态 + 图片上的作者标签（view_user_tag 对应项）
const tagCount = await evaluate(`document.querySelectorAll('.pd__userTag').length`)
const itemCount = await evaluate(`document.querySelectorAll('.pd__item').length`)
if (itemCount >= 1) ok(`渲染了该地点的动态（${itemCount} 条）`)
else bad('没有渲染该地点的动态')
if (tagCount >= 1) {
  const tag = await evaluate(`document.querySelector('.pd__userTag').textContent.trim()`)
  ok(`图片上有作者标签「${tag}」（view_user_tag 对应项）`)
} else {
  bad('图片上没有作者标签')
}

// 5) 反向断言：证据里**没有**的东西不应该出现（防止又按想象加内容）
for (const ghost of ['人来过', '在这里发动态', '给这里留言', '最近来过', '条动态']) {
  if (t.includes(ghost)) bad(`出现了证据里不存在的内容：「${ghost}」`)
  else ok(`未出现证据里不存在的内容：「${ghost}」`)
}

// 6) 顶部：证据里**没有中心标题**（只有左上返回 + 右上分享）
const centerTitle = await evaluate(`(() => {
  const el = document.querySelector('.topbar__center, .bigtitle__title')
  return el ? (el.textContent || '').trim() : null
})()`)
if (!centerTitle || !centerTitle.includes('地点')) ok('顶部没有出现「地点」中心标题（与证据一致）')
else bad(`顶部出现了中心标题「${centerTitle}」`)

console.log('')
console.log(failed === 0 ? 'SLICE4_POIDETAIL_CONFORMANCE PASS' : 'SLICE4_POIDETAIL_CONFORMANCE FAIL')
shutdown(failed)
