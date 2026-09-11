/**
 * 设备端走查：通过 Chrome DevTools Protocol 连接 MuMu 里 demo APK 的 WebView，
 * 在真实设备上执行点击并断言路由变化。
 *
 * 前置：
 *   1) 应用已启动（com.campusx.demo）
 *   2) adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *
 * 用法：node tools/device-walkthrough.mjs
 */

const CDP_HTTP = 'http://127.0.0.1:9222'

async function listTargets() {
  const res = await fetch(`${CDP_HTTP}/json`)
  if (!res.ok) throw new Error(`CDP /json HTTP ${res.status}`)
  return res.json()
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}, timeoutMs = 90000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, timeoutMs)
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`页面内异常: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`)
    }
    return result.result?.value
  }
}

const WALKTHROUGH = `
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const steps = []
  const record = (label) => steps.push({ label, hash: location.hash, title: document.title })

  // 先归位到校园页，避免上一轮残留的路由影响本轮的 tab 点击
  location.hash = '#/campus'
  await wait(900)
  record('起点')

  const clickText = (sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((e) => (e.innerText || '').includes(text))
    if (!el) return false
    el.click()
    return true
  }

  steps.push({ label: '校园页底部 tab 数', count: document.querySelectorAll('.tabbar__item').length })
  // 底部 tab：用文本定位，避免依赖 DOM 顺序
  clickText('.tabbar__item', '地图'); await wait(800); record('点底部「地图」')
  document.querySelector('.map__modal-btn')?.click(); await wait(300); record('关掉授权弹窗')
  clickText('.tabbar__item', '自定义名称6'); await wait(700); record('点底部「个人」')
  clickText('.tabbar__item', '校园'); await wait(700); record('点底部「校园」')

  // 个人页 → 更多
  location.hash = '#/me'; await wait(700)
  document.querySelector('button[aria-label="菜单"]')?.click(); await wait(600); record('个人页点菜单')
  clickText('.row', '校园圈'); await wait(700); record('更多页点「校园圈」')

  // 校园圈错误态 → 刷新
  steps.push({ label: '校园圈错误态存在', errorState: !!document.querySelector('.fl__error') })
  document.querySelector('.fl__retry')?.click(); await wait(800)
  steps.push({ label: '刷新后卡片数', count: document.querySelectorAll('.pcard').length })

  // 回校园 → 进动态详情
  location.hash = '#/campus'; await wait(700)
  document.querySelector('.pcard')?.click(); await wait(700); record('点第一条动态')

  // 详情 → 评论：底部三个动作依次是「点赞数 / 评论数 / 收藏」，取第 2 个
  const actions = [...document.querySelectorAll('.feed__action')]
  actions[1]?.click()
  await wait(700)
  record('点评论入口')
  location.hash = '#/feed?id=p1'; await wait(600)
  document.querySelector('.feed__image')?.click(); await wait(700); record('点图片进预览')

  // 聊天 → 群聊 → @面板
  location.hash = '#/message'; await wait(700)
  clickText('.row', '计算机学院'); await wait(700); record('点群聊')
  document.querySelector('.grp__at')?.click(); await wait(400)
  steps.push({ label: '@面板项数', count: document.querySelectorAll('.grp__at-item').length })

  // 扫码页：等识别成功
  location.hash = '#/scanner'; await wait(6200)
  steps.push({ label: '扫码识别完成', done: !!document.querySelector('.scan__ok') })

  // 升级弹窗
  location.hash = '#/upgrade'; await wait(700)
  steps.push({ label: '升级弹窗按钮数', count: document.querySelectorAll('.up__actions button').length })

  location.hash = '#/campus'
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    userAgent: navigator.userAgent.slice(0, 80),
    steps,
  }
})()
`

const targets = await listTargets()
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('没有找到可调试的页面目标：', JSON.stringify(targets, null, 2))
  process.exit(1)
}
console.log(`目标页面: ${page.title}  ${page.url}`)

const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')
const out = await cdp.evaluate(WALKTHROUGH)
console.log(`视口: ${JSON.stringify(out.viewport)}`)
console.log(`UA: ${out.userAgent}`)
console.log('--- 走查步骤 ---')
for (const s of out.steps) {
  const extra = Object.entries(s)
    .filter(([k]) => k !== 'label' && k !== 'hash' && k !== 'title')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.log(`${s.label.padEnd(18)} ${(s.hash ?? '').padEnd(24)} ${s.title ?? ''} ${extra}`)
}

// WebSocket 保持打开会让进程不退出，这里显式结束
process.exit(0)
