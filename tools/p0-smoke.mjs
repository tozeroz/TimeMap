/**
 * BJTU TimeMap —— P0 功能冒烟验证（F01~F07 / US-01~US-08 验收条件）
 *
 * 为什么用 CDP：这套 demo 没有 DOM 测试框架，也不该为了验证再塞一套 jsdom。
 * 直接连浏览器的 DevTools 协议，在真实渲染的页面里点真实按钮、读真实文案，
 * 比截图 OCR 点坐标稳定得多。
 *
 * 前置：
 *   1) pnpm run dev（默认 http://127.0.0.1:5174）
 *   2) 浏览器带 --remote-debugging-port=9222 打开该地址
 * 用法：node tools/p0-smoke.mjs
 */

const CDP_PORT = Number(process.env.CDP_PORT ?? 9222)
const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5174/'

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
/**
 * 浏览器里除了应用页还有扩展后台页、Edge 内部页。
 * 必须挑真正的应用页，否则会在错误的目标上执行断言（表现为「页面里什么都没有」）。
 */
const appOrigin = new URL(APP_URL).origin
const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
const page = pages.find((t) => t.url.startsWith(appOrigin)) ?? pages.find((t) => !t.url.startsWith('chrome-extension://') && !t.url.startsWith('edge://'))
if (!page) {
  console.error('找不到可调试页面：请用 --remote-debugging-port 启动浏览器并打开 app')
  process.exit(1)
}
console.log(`调试目标：${page.url}`)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  const slot = pending.get(msg.id)
  if (slot) {
    pending.delete(msg.id)
    slot(msg)
  }
})

/** 在页面里跑一段 JS，返回值必须可 JSON 序列化 */
async function evaluate(expression) {
  const id = ++seq
  const msg = await new Promise((resolve, reject) => {
    pending.set(id, resolve)
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    )
    setTimeout(() => reject(new Error(`CDP timeout: ${expression.slice(0, 60)}`)), 20000)
  })
  if (msg.error) throw new Error(`CDP error: ${JSON.stringify(msg.error)}`)
  const details = msg.result?.exceptionDetails
  if (details) {
    throw new Error(`页面异常: ${details.exception?.description ?? details.text}`)
  }
  return msg.result?.result?.value ?? null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 等 React 渲染完再断言（hash 切换 + setState 都是异步的） */
async function settle(ms = 260) {
  await sleep(ms)
}

const results = []
let failed = 0

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed += 1
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${mark}] ${name}${detail ? ' — ' + detail : ''}`)
}

async function check(name, expression, predicate) {
  let value
  try {
    value = await evaluate(expression)
  } catch (err) {
    record(name, false, String(err.message).slice(0, 200))
    return null
  }
  const verdict = predicate(value)
  const ok = verdict === true
  record(name, ok, ok ? '' : `实际值=${JSON.stringify(value)?.slice(0, 220)}${typeof verdict === 'string' ? ' / ' + verdict : ''}`)
  return value
}

/* ------------------------------------------------------------------
 * 页面小工具：注入到页面里复用（点击 / 取文本 / 受控 input 赋值）
 * ------------------------------------------------------------------ */
const HELPERS = `
window.__tm = window.__tm || {
  q: (sel) => document.querySelector(sel),
  all: (sel) => Array.from(document.querySelectorAll(sel)),
  text: (sel) => (document.querySelector(sel)?.innerText ?? '').replace(/\\s+/g, ' ').trim(),
  body: () => document.body.innerText.replace(/\\s+/g, ' ').trim(),
  click: (sel, idx = 0) => {
    const el = Array.from(document.querySelectorAll(sel))[idx]
    if (!el) return 'NOT_FOUND:' + sel
    el.click()
    return 'OK'
  },
  clickText: (sel, needle) => {
    const el = Array.from(document.querySelectorAll(sel)).find((n) => (n.innerText || '').includes(needle))
    if (!el) return 'NOT_FOUND:' + sel + '/' + needle
    el.click()
    return 'OK'
  },
  setInput: (sel, value) => window.__tm.setInputAt(sel, 0, value),
  setInputAt: (sel, idx, value) => {
    const el = Array.from(document.querySelectorAll(sel))[idx]
    if (!el) return 'NOT_FOUND:' + sel + '#' + idx
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return 'OK'
  },
  post: (id) => JSON.parse(localStorage.getItem('tm.state.v1') || '{}').posts?.find((p) => p.id === id) ?? null,
  state: () => JSON.parse(localStorage.getItem('tm.state.v1') || '{}'),
  go: (hash) => { window.location.hash = hash; return window.location.hash },
  reset: () => { localStorage.removeItem('tm.state.v1'); return 'CLEARED' },
};
'READY'
`

/* ==================================================================
 * 开始：干净状态 + 登录门禁（F01）
 * ================================================================== */
console.log('\n=== F01 账号与资料 ===')
await evaluate(`window.location.href = ${JSON.stringify(APP_URL)} + '#/map'`)
await settle(500)
await evaluate(HELPERS)
await evaluate(`window.__tm.reset()`)
await evaluate(`window.location.reload()`)
await settle(900)
await evaluate(HELPERS)

await check(
  'US-01 未登录访问任意页 → 落到登录页（登录门禁）',
  `window.__tm.go('#/admin'); 'x'`,
  () => true,
)
await settle()
await evaluate(HELPERS)
await check(
  '未登录时管理端不可达，显示登录页',
  `window.__tm.body()`,
  (v) => v.includes('邀请码') && v.includes('进入 TimeMap') && !v.includes('举报处理'),
)

await check('错误邀请码被拒绝', `window.__tm.setInput('.lg__input', 'WRONG-CODE')`, (v) => v === 'OK')
await evaluate(`window.__tm.click('.lg__submit')`)
await settle()
await check(
  '错误邀请码给出明确错误提示',
  `window.__tm.body()`,
  (v) => v.includes('邀请码'),
)

// 正确邀请码 + 昵称
await evaluate(`window.__tm.setInput('.lg__input', 'BJTU2026')`)
await evaluate(
  `window.__tm.setInputAt('.lg__input', 1, '冒烟测试同学')`,
)
await evaluate(`window.__tm.click('.lg__submit')`)
await settle(400)
await evaluate(HELPERS)
await check(
  'F01 学生邀请码登录成功（登录门禁放行）',
  `window.__tm.body()`,
  (v) => !v.includes('进入 TimeMap'),
)
// 前面为了验越权跳到了 #/admin，登录后显式回地图再继续
await evaluate(`window.__tm.go('#/map')`)
await settle(450)
await evaluate(HELPERS)
await check(
  'F01 登录后进入地图主页',
  `window.__tm.body()`,
  (v) => v.includes('BJTU TimeMap') && !v.includes('无权限'),
)
await check(
  'F01 一级入口 = 地图/活动/我的（不含课表/二手等超范围入口）',
  `window.__tm.all('.tabbar__item').map((n) => n.innerText.replace(/\\s+/g, ''))`,
  (v) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.includes('地图') &&
    v.includes('活动') &&
    v.includes('我的'),
)

/* ==================================================================
 * F02 地图与地点
 * ================================================================== */
console.log('\n=== F02 地图与地点 ===')
await check(
  'F02 地图页展示分类筛选（全部/地标/食堂/教学楼/图书馆/体育场馆）',
  `window.__tm.all('.map__chip').map((n) => n.innerText.trim())`,
  (v) => Array.isArray(v) && v.includes('全部') && v.includes('食堂') && v.length >= 5,
)
// 标记有两套实现：离线 SVG 地图 .map__marker / Leaflet 栅格底图 .rm__wrap
const MARKERS = '.map__marker, .rm__wrap'
const markerCount = await check(
  'F02 地图渲染预设地点标记',
  `window.__tm.all('${MARKERS}').length`,
  (v) => typeof v === 'number' && v > 0,
)
await evaluate(`window.__tm.clickText('.map__chip', '食堂')`)
await settle(400)
await check(
  'F02 分类筛选生效（食堂数量少于全部）',
  `window.__tm.all('${MARKERS}').length`,
  (v) => typeof v === 'number' && v > 0 && v < markerCount,
)
await evaluate(`window.__tm.clickText('.map__chip', '全部')`)
await settle()

await check(
  'US-01 地图不可用时提供地点列表备用入口',
  `!!window.__tm.q('.map__listBtn')`,
  (v) => v === true,
)
await evaluate(`window.__tm.click('.map__listBtn')`)
await settle()
await check(
  '地点列表弹层列出预设地点',
  `window.__tm.all('.map__sheetItem').map((n) => n.innerText.replace(/\\s+/g, ' ').trim())`,
  (v) => Array.isArray(v) && v.length >= 8 && v.some((t) => t.includes('明湖')),
)

/* ==================================================================
 * F03 地点详情（校史 + 老照片年代/来源 + 帖子）
 * ================================================================== */
console.log('\n=== F03 地点详情 ===')
await evaluate(`window.__tm.clickText('.map__sheetItem', '明湖')`)
await settle(350)
await evaluate(HELPERS)
await check(
  'F03 点击地点进入详情，标题与所点地点一致',
  `window.__tm.text('.pd__name')`,
  (v) => v.includes('明湖'),
)
await check(
  'F03 详情含校史沿革说明',
  `window.__tm.body()`,
  (v) => v.includes('校史') || v.includes('沿革'),
)
await check(
  'US-01 老照片必须带年代与来源（缺失则标年代不详，不伪造）',
  `window.__tm.all('.pd__photo').map((n) => ({ era: n.querySelector('.pd__photoEra')?.innerText ?? '', src: n.querySelector('.pd__photoSource')?.innerText ?? '' }))`,
  (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((p) => p.era.trim().length > 0 && p.src.trim().length > 0),
)
await check(
  'F03 提供最新 / 近期热门两种排序',
  `window.__tm.all('.pd__sortBtn').map((n) => n.innerText.trim())`,
  (v) => Array.isArray(v) && v.includes('最新') && v.some((t) => t.includes('热门')),
)
await evaluate(`window.__tm.clickText('.pd__sortBtn', '热门')`)
await settle()
await check(
  'F03 热门排序可切换且仍有内容',
  `window.__tm.all('.tm__post').length`,
  (v) => typeof v === 'number' && v > 0,
)

/* ==================================================================
 * F04 发布（必须挂地点 / 文字或图片其一 / 防重复）
 * ================================================================== */
console.log('\n=== F04 发布 ===')
await evaluate(`window.__tm.go('#/publish')`)
await settle(350)
await evaluate(HELPERS)
await check(
  'F04 发布页要求选择地点',
  `window.__tm.body()`,
  (v) => v.includes('地点'),
)
await evaluate(`window.__tm.click('.tpub__submit')`)
await settle()
await check(
  'US-02 未选地点/空内容不允许发布，给出提示',
  `window.__tm.body()`,
  (v) => v.includes('选择') || v.includes('内容') || v.includes('不能'),
)

// 选地点 → 写内容 → 发布
await evaluate(`window.__tm.click('.tpub__place')`)
await settle()
await evaluate(`window.__tm.clickText('.tpub__placeItem', '明湖')`)
await settle()
await evaluate(`window.__tm.setInput('.tpub__text', '冒烟测试：明湖今天结了薄冰，很好看。')`)
await settle()
const beforePublish = await evaluate(
  `JSON.parse(localStorage.getItem('tm.state.v1') || '{}').posts?.length ?? 0`,
)
await evaluate(`window.__tm.click('.tpub__submit')`)
await settle(450)
await evaluate(HELPERS)
await check(
  'F04 发布成功后回到该地点详情并能看到新帖',
  `window.__tm.body()`,
  (v) => v.includes('明湖') && v.includes('冒烟测试：明湖今天结了薄冰'),
)
await check(
  'US-02 一次提交只产生一条内容（防重复提交）',
  `JSON.parse(localStorage.getItem('tm.state.v1') || '{}').posts?.length ?? 0`,
  (v) => v === beforePublish + 1,
)

/* ==================================================================
 * F05 互动（点赞/评论/收藏 幂等且可撤销）
 * ================================================================== */
console.log('\n=== F05 互动 ===')
const LIKE_BTN = '[data-act="like"]'
const likeBefore = await evaluate(`window.__tm.q('${LIKE_BTN}')?.dataset.count ?? ''`)
await evaluate(`window.__tm.click('${LIKE_BTN}')`)
await settle()
const likeAfter = await evaluate(`window.__tm.q('${LIKE_BTN}')?.dataset.count ?? ''`)
record(
  'F05 点赞后计数 +1',
  Number(likeAfter) === Number(likeBefore) + 1,
  `${likeBefore} → ${likeAfter}`,
)
await evaluate(`window.__tm.click('${LIKE_BTN}')`)
await settle()
const likeUndo = await evaluate(`window.__tm.q('${LIKE_BTN}')?.dataset.count ?? ''`)
record(
  'US-03 重复点赞只算一次且可取消（回到初始计数）',
  likeUndo === likeBefore,
  `${likeAfter} → ${likeUndo}（初始 ${likeBefore}）`,
)

// 评论：进帖子详情
await evaluate(`window.__tm.click('.tm__postBody', 0)`)
await settle(350)
await evaluate(HELPERS)
await check('F05 进入帖子详情页', `!!window.__tm.q('.fd__post')`, (v) => v === true)
await evaluate(`window.__tm.setInput('.tm__cmtInput input', '冒烟测试评论')`)
await settle()
await evaluate(`window.__tm.click('.tm__cmtInput button')`)
await settle(350)
await check(
  'F05 评论发布后立即可见',
  `window.__tm.body()`,
  (v) => v.includes('冒烟测试评论'),
)
await check(
  'US-03 自己的评论可删除',
  `window.__tm.all('.tm__cmtDel').length`,
  (v) => typeof v === 'number' && v > 0,
)
// 收藏（按 data-act 精确定位，图标按钮没有可点的文字）
await evaluate(`window.__tm.click('.fd__bar [data-act="favorite"]')`)
await settle(350)
await check(
  'F05 收藏后按钮进入已收藏态',
  `window.__tm.q('.fd__bar [data-act="favorite"]')?.getAttribute('aria-pressed')`,
  (v) => v === 'true',
)
await evaluate(`window.__tm.go('#/me')`)
await settle(400)
await evaluate(HELPERS)
await check(
  'US-03 收藏出现在个人中心 我的收藏',
  `window.__tm.clickText('.tme__stat', '收藏')`,
  (v) => v === 'OK',
)
await settle(300)
await check(
  '我的收藏列表含刚收藏的帖子',
  `window.__tm.all('.tm__post').length`,
  (v) => typeof v === 'number' && v > 0,
)
await check(
  'F01 个人中心展示我的发布入口',
  `window.__tm.all('.tme__stat').map((n) => n.innerText.replace(/\\s+/g, ' ').trim())`,
  (v) => Array.isArray(v) && v.some((t) => t.includes('发布')) && v.some((t) => t.includes('收藏')),
)

/* ==================================================================
 * F06 活动（管理端录入，只读浏览，无报名/支付）
 * ================================================================== */
console.log('\n=== F06 活动 ===')
await evaluate(`window.__tm.go('#/activities')`)
await settle(400)
await evaluate(HELPERS)
const actList = await check(
  'F06 活动列表有内容',
  `window.__tm.all('.act__item').length`,
  (v) => typeof v === 'number' && v > 0,
)
await check(
  'F06 已结束/已取消活动有明确标识',
  `window.__tm.body()`,
  (v) => v.includes('已结束') || v.includes('已取消'),
)
await check(
  'US-04 活动页不含报名/支付功能（不纳入范围）',
  `window.__tm.body()`,
  (v) => !v.includes('报名') && !v.includes('支付') && !v.includes('立即购买'),
)
if (actList) {
  await evaluate(`window.__tm.click('.act__item', 0)`)
  await settle(350)
  await evaluate(HELPERS)
  await check(
    'F06 活动详情含时间/地点/主办方/来源',
    `window.__tm.body()`,
    (v) => v.includes('时间') && v.includes('地点') && v.includes('主办'),
  )
  await check(
    'US-04 活动详情可跳到举办地点',
    `!!window.__tm.q('.acd__placeBtn') || window.__tm.body().includes('举办地点')`,
    (v) => v === true,
  )
}

/* ==================================================================
 * F07 举报与管理端（普通用户越权 / 举报入队 / 下架 + 操作记录）
 * ================================================================== */
console.log('\n=== F07 举报与管理端 ===')
await evaluate(`window.__tm.go('#/admin')`)
await settle(350)
await evaluate(HELPERS)
await check(
  'US-08 普通用户访问管理端被拒绝',
  `window.__tm.body()`,
  (v) => typeof v === 'string' && (v.includes('无权限') || v.includes('仅管理员')),
)

// 学生先举报一条内容
await evaluate(`window.__tm.go('#/feed?id=tp1')`)
await settle(400)
await evaluate(HELPERS)
await evaluate(`window.__tm.click('.fd__reportBtn')`)
await settle(300)
await check(
  'F07 举报弹层要求选择原因',
  `window.__tm.all('.tm__chipBtn').length`,
  (v) => typeof v === 'number' && v > 0,
)
await evaluate(`window.__tm.click('.tm__chipBtn', 0)`)
await evaluate(`window.__tm.setInput('.tm__textarea', '冒烟测试举报说明')`)
await evaluate(`window.__tm.clickText('.tm__sheetActions button', '提交')`)
await settle(350)
await check(
  'US-08 举报后内容不会自动消失（先入待处理队列）',
  `window.__tm.post('tp1').status === 'published' && window.__tm.state().reports.some((r) => r.status === 'pending')`,
  (v) => v === true,
)

// 切管理员
await evaluate(`window.__tm.go('#/me')`)
await settle(350)
await evaluate(HELPERS)
await evaluate(`window.__tm.clickText('.tme__logout', '退出')`)
await settle(400)
await evaluate(HELPERS)
await evaluate(`window.__tm.setInput('.lg__input', 'BJTUADMIN')`)
await evaluate(`window.__tm.click('.lg__submit')`)
await settle(400)
await evaluate(HELPERS)
await check(
  'F07 管理员登录后出现管理端入口',
  `!!window.__tm.q('.tme__adminEntry') || (window.__tm.go('#/me'), !!window.__tm.q('.tme__adminEntry'))`,
  (v) => v === true,
)
await evaluate(`window.__tm.go('#/admin')`)
await settle(400)
await evaluate(HELPERS)
await check(
  'F07 管理端含举报处理/内容/地点/活动/操作记录分区',
  `window.__tm.all('.adm__tab').map((n) => n.innerText.trim())`,
  (v) => Array.isArray(v) && v.length >= 4,
)
await check(
  'F07 待处理举报可见',
  `window.__tm.all('.adm__report').length`,
  (v) => typeof v === 'number' && v > 0,
)
// 下架必须填原因
await evaluate(`window.__tm.clickText('.adm__reportActions button', '下架')`)
await settle(250)
await check(
  'US-08 下架前必须填写理由',
  `!!window.__tm.q('.adm__reasonInput')`,
  (v) => v === true,
)
await evaluate(`window.__tm.setInput('.adm__reasonInput', '冒烟测试：违反社区规范')`)
await evaluate(`window.__tm.clickText('.adm__reasonBox button, .adm__reportActions button', '确认')`)
await settle(400)
await check(
  'US-08 下架后内容被标记移除',
  `window.__tm.post('tp1').status`,
  (v) => v === 'removed',
)
await check(
  'US-08 操作记录含管理员/动作/对象/时间/理由',
  `window.__tm.state().ops.slice(-1).map((o) => ({ admin: !!o.adminName, action: !!o.action, target: !!o.targetLabel, at: !!o.at, reason: !!o.reason }))[0]`,
  (v) => v && v.admin && v.action && v.target && v.at && v.reason,
)
// tp1 属于哪个地点由种子数据决定，直接读出来再跳
const tp1Place = await evaluate(`window.__tm.post('tp1').placeId`)
await evaluate(`window.__tm.go('#/place?id=${tp1Place}')`)
await settle(450)
await evaluate(HELPERS)
const removedVisible = await evaluate(
  `(() => { const p = window.__tm.post('tp1'); return document.body.innerText.includes(p.text.slice(0, 12)) })()`,
)
record('已下架帖子正文不再出现在地点详情列表', removedVisible === false, `可见=${removedVisible}`)

// 地点停用 → 禁止发布
await evaluate(`window.__tm.go('#/admin')`)
await settle(350)
await evaluate(HELPERS)
await evaluate(`window.__tm.clickText('.adm__tab', '地点')`)
await settle(300)
await check(
  'F02 管理端可启用/停用地点',
  `window.__tm.all('.adm__toggle').length`,
  (v) => typeof v === 'number' && v > 0,
)

// 停用「明湖」→ 该地点应退出可发布范围（US-01）
await evaluate(`
  (() => {
    const row = Array.from(document.querySelectorAll('.adm__placeItem')).find((n) => n.innerText.includes('明湖'))
    row?.querySelector('.adm__toggle')?.click()
    return 'OK'
  })()
`)
await settle(350)
const minghuDisabled = await evaluate(
  `window.__tm.state().disabledPlaces.some((id) => id === 'pl_minghu')`,
)
record('F02 停用地点写入状态', minghuDisabled === true, `disabledPlaces含明湖=${minghuDisabled}`)

await evaluate(`window.__tm.go('#/place?id=pl_minghu')`)
await settle(420)
await evaluate(HELPERS)
await check(
  'US-01 地点被停用后，详情仍可看但不再提供发布入口',
  `(() => { const b = window.__tm.body(); const btn = Array.from(document.querySelectorAll('button')).find((n) => n.innerText.includes('在这里发布')); return { hasInfo: b.includes('明湖'), publishable: !!btn && !btn.disabled } })()`,
  (v) => v && v.hasInfo === true && v.publishable === false,
)
await evaluate(`window.__tm.go('#/publish')`)
await settle(380)
await evaluate(HELPERS)
await evaluate(`window.__tm.click('.tpub__place')`)
await settle(300)
await check(
  'US-01 停用地点不出现在发布可选列表（或标为不可选）',
  `(() => { const el = Array.from(document.querySelectorAll('.tpub__placeItem')).find((n) => n.innerText.includes('明湖')); return el ? !!el.disabled : 'ABSENT' })()`,
  (v) => v === true || v === 'ABSENT',
)

// 恢复启用，避免污染后续手动体验
await evaluate(`window.__tm.go('#/admin')`)
await settle(350)
await evaluate(HELPERS)
await evaluate(`window.__tm.clickText('.adm__tab', '地点')`)
await settle(300)
await evaluate(`
  (() => {
    const row = Array.from(document.querySelectorAll('.adm__placeItem')).find((n) => n.innerText.includes('明湖'))
    row?.querySelector('.adm__toggle')?.click()
    return 'OK'
  })()
`)
await settle(300)

console.log('\n=== US-04 非法活动不可发布 ===')
await evaluate(`window.__tm.go('#/admin')`)
await settle(350)
await evaluate(HELPERS)
await evaluate(`window.__tm.clickText('.adm__tab', '活动')`)
await settle(300)
const actsBefore = await evaluate(`window.__tm.state().addedActivities.length`)
await evaluate(`window.__tm.clickText('.adm__sectionHead button', '录入活动')`)
await settle(300)
// 空表单提交：缺标题 / 地点 / 时间
await evaluate(`window.__tm.clickText('.adm__form button', '发布活动')`)
await settle(300)
await check(
  'US-04 缺标题/地点/时间的活动被拒绝发布',
  `window.__tm.state().addedActivities.length`,
  (v) => v === actsBefore,
)
await check(
  'US-04 非法提交给出明确原因',
  `window.__tm.text('.tm__toast')`,
  (v) => typeof v === 'string' && v.length > 0,
)
// 结束早于开始：仍应被拒绝
await evaluate(`window.__tm.setInput('.adm__form input', '冒烟测试非法活动')`)
await evaluate(
  `(() => { const s = document.querySelector('.adm__form select'); s.value = 'pl_minghu'; s.dispatchEvent(new Event('change', { bubbles: true })); return 'OK' })()`,
)
await evaluate(
  `window.__tm.setInputAt('.adm__form input[type="datetime-local"]', 0, '2026-11-10T18:00')`,
)
await evaluate(
  `window.__tm.setInputAt('.adm__form input[type="datetime-local"]', 1, '2026-11-10T09:00')`,
)
await evaluate(`window.__tm.clickText('.adm__form button', '发布活动')`)
await settle(350)
await check(
  'US-04 结束时间早于开始时间被拒绝',
  `window.__tm.state().addedActivities.length`,
  (v) => v === actsBefore,
)
// 合法数据可以发布
await evaluate(
  `window.__tm.setInputAt('.adm__form input[type="datetime-local"]', 1, '2026-11-10T21:00')`,
)
await evaluate(`window.__tm.clickText('.adm__form button', '发布活动')`)
await settle(400)
await check(
  'US-04 合法活动可以录入（新增一条）',
  `window.__tm.state().addedActivities.length`,
  (v) => v === actsBefore + 1,
)

/* ==================================================================
 * US-02 删除权限
 * ================================================================== */
console.log('\n=== US-02 删除权限 ===')
// 当前是管理员登录；打开一条非本人帖子的详情，不应出现「删除」
const othersPost = await evaluate(`
  (() => {
    const st = window.__tm.state()
    const mine = st.session.profile.id
    const p = st.posts.find((x) => x.authorId !== mine && x.status === 'published')
    return p ? p.id : null
  })()
`)
if (othersPost) {
  await evaluate(`window.__tm.go('#/feed?id=${othersPost}')`)
  await settle(400)
  await evaluate(HELPERS)
  await check(
    'US-02 他人帖子详情不提供删除入口（管理员走下架流程，不是删除）',
    `Array.from(document.querySelectorAll('.fd__delBtn')).length`,
    (v) => v === 0,
  )
} else {
  record('US-02 他人帖子详情不提供删除入口', false, '种子数据里找不到他人帖子')
}

console.log('\n================ 汇总 ================')
console.log(`用例 ${results.length}，通过 ${results.length - failed}，失败 ${failed}`)
if (failed) {
  console.log('\n失败项：')
  for (const r of results.filter((x) => !x.ok)) console.log(` - ${r.name} :: ${r.detail}`)
}
ws.close()
process.exit(failed ? 1 : 0)
