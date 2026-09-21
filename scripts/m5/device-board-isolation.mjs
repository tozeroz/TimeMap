/**
 * M5 留言板（board_notes）Slice 1 收口：**第三账号真机隔离验证**。
 *
 * 审核方要求："board_notes：from_user_id 等身份字段 strict 400 **+ 第三账号真机隔离验证** → Slice 1 CLOSED"。
 * 前半（strict 400）已由 scripts/m5/verify-board-notes.sh 的 B8 组在真实服务端验证过；
 * 本脚本补的是后半：**在真机（MuMu 模拟器）上，用第三个账号确认"读不到另两个人之间的留言"**。
 *
 * 与 verify-board-notes.sh 的 B9 组的区别（两者都要有，不是重复）：
 *   B9 —— 服务端侧：丙用 curl 构造查询参数也读不到（验证服务端不采纳客户端指定的任一方）。
 *   本脚本 —— 设备侧：丙**在 App 里**打开乙的留言板，界面上看不到那条留言。
 *   服务端正确 ≠ 设备端正确：前端可能自己把数据拼出来、缓存住、或把错误渲染成"正常"。
 *   所以必须真机走一遍，而且断言要落在**界面文本**上，不能只看接口返回。
 *
 * 账号设计（审核要求的三角色）：
 *   甲、乙 —— 临时账号，用真实 HTTP API 造（request-code → 读 dev sink 取码 → verify-code）
 *   丙     —— **设备上当前登录的账号**，由 scripts/m3/device-login-helper.ps1 走真实 OTP 登录得到
 *
 * 为什么"丙"不能用 API 造一个：那样验的还是"服务端拒绝"，设备端什么都没验到。
 * 本脚本的关键证据是"丙这个**真实登录的设备会话**在页面上看到空态"。
 *
 * 用法（在项目根目录）：node scripts/m5/device-board-isolation.mjs
 * 前置：MuMu 模拟器已启动、App 已安装（com.campusx.demo）、能 ssh 到服务器。
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const run = promisify(execFile)

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const REPO = 'G:\\demo map'
const API = 'https://8.148.156.146' // 设备端 App 用的就是这个源（见 app/src/api/client.ts DEFAULT_API_ORIGIN）
const SSH_KEY = `${REPO}\\TimeMap.pem`
const SSH_HOST = 'root@8.148.156.146'
const ADB = 'G:\\Program Files\\Netease\\MuMu\\nx_main\\adb.exe'
const SERIAL = '127.0.0.1:16384'
const PKG = 'com.campusx.demo'

const SEED = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
}

/**
 * 服务端是自签证书（CA 内置在 APK 的 Network Security Config 里）。
 * Node 这边没有那份 CA，所以显式声明"不校验证书"—— 只影响本脚本的 curl 式调用，
 * 不影响设备/浏览器，也不改变任何产品行为。
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
let failed = 0
const ok = (m) => console.log(`  PASS ${m}`)
const bad = (m) => {
  console.log(`  FAIL ${m}`)
  failed = 1
}
const info = (m) => console.log(`  · ${m}`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 断言辅助：条件为真 PASS，否则 FAIL（附实际值，便于事后复核） */
function check(cond, passMsg, failMsg) {
  if (cond) ok(passMsg)
  else bad(failMsg)
}

async function ssh(script) {
  // 提示：直接用 ssh 传内联脚本时，引号会被三层解析吃掉（本项目已栽过多次）。
  // 所以统一先 base64，再让远端 base64 -d | bash —— 脚本内容原样到达，不经第二层解析。
  const b64 = Buffer.from(script, 'utf8').toString('base64')
  const { stdout } = await run('ssh', ['-i', SSH_KEY, '-o', 'BatchMode=yes', SSH_HOST, `echo '${b64}' | base64 -d | bash`], {
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout.trim()
}

const psql = (sql) => ssh(`PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc ${shellQuote(sql)}`)

/** 单引号包裹（bash 安全引用）：内部的 ' 变成 '\'' */
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON 响应保留原文 */
  }
  return { status: res.status, text, json }
}

/**
 * 用真实 OTP 流程登录一个临时账号（甲/乙用）。
 * 码从 dev sink 读 —— 那是**服务端自己返回的路径**，不是猜的路径。
 */
async function loginViaApi(phone) {
  const req = await api('/api/auth/request-code', { method: 'POST', body: { phone } })
  if (req.status !== 200 || !req.json?.sink) {
    throw new Error(`request-code 失败（${req.status}）: ${req.text.slice(0, 200)}`)
  }
  // sink 文件权限 0600、属主 campus；我们是 root，直接读即可（无需 sudo）
  const raw = await ssh(`cat ${shellQuote(req.json.sink)}`)
  const code = JSON.parse(raw).code
  const ver = await api('/api/auth/verify-code', { method: 'POST', body: { phone, code } })
  if (ver.status !== 200 || !ver.json?.token) {
    throw new Error(`verify-code 失败（${ver.status}）: ${ver.text.slice(0, 200)}`)
  }
  // 记下本次真的被投递过的 sink 路径 —— 清理时**只删这些**。
  // 第一版用的是号码段通配（1380000*.json / 13845498*.json），踩了坑：
  //   丙的号码由 device-login-helper 随机生成（138 + 8 位随机），号段根本没法预料，
  //   于是清理"看起来成功了"，sink 目录里却留着文件（实测留下 3 个）。
  //   教训：清理要基于**运行时拿到的具体路径**，不要基于对命名规律的猜测。
  sinkPaths.push(req.json.sink)
  return { phone, token: ver.json.token, userId: ver.json.user.id, displayName: ver.json.user.displayName }
}

// ---------------------------------------------------------------------------
// 设备侧：adb + CDP
// ---------------------------------------------------------------------------
async function adb(args) {
  const { stdout } = await run(ADB, ['-s', SERIAL, ...args], { maxBuffer: 8 * 1024 * 1024 })
  return stdout.trim()
}

/**
 * 重新建立 CDP 转发。
 *
 * **必须在 App 重启之后重做**：helper 登录时会冷启动 App，WebView 进程号（pidof）会变，
 * 旧的 localabstract 转发指向已经不存在的进程 —— 表现是"页面明明在，连上去读到的却是空"。
 */
async function cdpForward() {
  await adb(['forward', '--remove-all']).catch(() => {})
  let pid = ''
  for (let i = 0; i < 20 && !pid; i++) {
    pid = await adb(['shell', 'pidof', PKG]).catch(() => '')
    if (!pid) await wait(1000)
  }
  if (!pid) throw new Error(`找不到 ${PKG} 的进程（App 是否在运行？）`)
  await adb(['forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`])
  return pid
}

/** 连 CDP 并等到"真的能执行脚本"为止（WebSocket open ≠ 这条调试会话可用） */
async function connectCdp() {
  let lastErr = null
  for (let attempt = 1; attempt <= 12; attempt++) {
    let ws
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json')).json()
      const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (!target) {
        await wait(700)
        continue
      }
      ws = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((res, rej) => {
        ws.addEventListener('open', res, { once: true })
        ws.addEventListener('error', rej, { once: true })
      })
      // 只 bind 一次，后面的 ev/send 都用这一份（同一张 pending 表），
      // 否则每次 re-bind 都会新挂一个 message 监听、各自维护 pending，回包对不上号。
      const { ev, send } = bind(ws)
      const probe = await ev('document.readyState')
      if (probe) return { ws, ev, send }
      ws.close()
    } catch (e) {
      lastErr = e
      try {
        ws?.close()
      } catch {
        /* 已关闭 */
      }
    }
    await wait(700)
  }
  throw new Error(`连不上可执行脚本的调试目标（CDP）${lastErr ? `：${lastErr.message}` : ''}`)
}

/** 给一个 WebSocket 绑定 send/ev 两个函数 */
function bind(ws) {
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
      }, 20000)
    })
  const ev = async (expr) => {
    // 注意：这个项目的 CDP 需要 awaitPromise:true 才能用 async IIFE
    //（device-login-e2e.mjs 里的注释写的是相反的经验，但 device-board-emoji-check.mjs 实测
    //  awaitPromise:true 可用，且本脚本需要页面内 fetch，故采用后者并在此记录差异）
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r?.timeout) throw new Error(`CDP 求值超时: ${expr.slice(0, 80)}`)
    if (r?.result?.exceptionDetails) throw new Error(`页面异常: ${JSON.stringify(r.result.exceptionDetails).slice(0, 200)}`)
    return r?.result?.result?.value
  }
  return { send, ev }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const A = { phone: null, token: null, userId: null, displayName: null }
const B = { phone: null, token: null, userId: null, displayName: null }
let C = { phone: null, userId: null, token: null }
let ws = null
let noteBody = ''
/** 本次运行中真的被投递过的 dev sink 文件路径（用于精确清理，不靠猜命名规律） */
const sinkPaths = []

/** 清理：删掉本次造的两个临时账号及其一切痕迹（**绝不碰种子账号**） */
async function cleanup() {
  const phones = [A.phone, B.phone, C.phone].filter(Boolean)
  const users = [A.userId, B.userId, C.userId].filter(Boolean)
  if (phones.length === 0) return { skipped: true }
  /**
   * 引号纪律：**SQL 的 IN 列表必须自带引号**。
   * 排练时踩过：把 bash 数组写成 `IDS=('u1' 'u2')` 再展开 `(${IDS[*]})`，
   * 结果引号在展开时**丢掉了**，SQL 变成 `in (796533a7-5a0f-...)`，
   * psql 报 `trailing junk after numeric literal` —— 清理**没执行**，测试数据留在库里。
   * 现在不再依赖数组展开的引号保留行为，直接生成 `'a','b'` 这样的字面量。
   */
  const inList = (arr) => arr.map((v) => `'${v}'`).join(',')
  const script = `
set -e
PSQL() { PGPASSWORD="$(cat /srv/campus/.db_password)" psql -h 127.0.0.1 -U campus -d campus -Atc "$1"; }
IDS="${inList(users)}"
PHONES="${inList(phones.map((p) => `+86${p}`))}"
# 1) 留言（本次三人中任意两人之间的都清掉）
PSQL "delete from board_notes where from_user_id in ($IDS) or to_user_id in ($IDS)" >/dev/null
# 2) 会话（登录产生的）
PSQL "delete from sessions where user_id in ($IDS)" >/dev/null
# 3) 登录挑战（验证码记录）
PSQL "delete from login_challenges where phone_e164 in ($PHONES)" >/dev/null
# 4) 账号本体
PSQL "delete from users where id in ($IDS)" >/dev/null
# 5) 校验：残留必须为 0
echo "LEFT_USERS=$(PSQL "select count(*) from users where id in ($IDS)")"
echo "LEFT_NOTES=$(PSQL "select count(*) from board_notes where from_user_id in ($IDS) or to_user_id in ($IDS)")"
echo "LEFT_SESSIONS=$(PSQL "select count(*) from sessions where user_id in ($IDS)")"
echo "LEFT_CHALLENGES=$(PSQL "select count(*) from login_challenges where phone_e164 in ($PHONES)")"
# 6) 种子账号必须还在（**不删种子数据**）
echo "SEED_USERS=$(PSQL "select count(*) from users where id in ('${SEED.a}','${SEED.b}','${SEED.c}')")"
echo "SEED_NOTES=$(PSQL "select count(*) from board_notes where from_user_id in ('${SEED.a}','${SEED.b}') or to_user_id in ('${SEED.a}','${SEED.b}')")"
# 7) dev sink：**只删本次运行明确投递过的那些文件**（路径来自 request-code 的响应）
rm -f ${sinkPaths.length ? sinkPaths.map((p) => shellQuote(p)).join(' ') : '/dev/null'} 2>/dev/null || true
# latest.json 是"最近一次验证码"的运维便利副本，由本次投递写入，一并清掉
rm -f /run/campus/login-codes/latest.json 2>/dev/null || true
# 8) 核对：**本次投递过的那些文件必须一个都不剩**。
#    注意这里**不断言"目录里总数为 0"** —— dev sink 是全局共享目录，
#    别的验证脚本可能同时在里面留下文件（本项目已有多份 M3 登录脚本共用它），
#    拿总数当断言会把"别人的文件"算成"我的清理失败"。
#    只核对本次运行真正投递过的路径，这才是本脚本该负责的范围。
LEFT_SINK=0
${sinkPaths.map((p) => `[ -e ${shellQuote(p)} ] && LEFT_SINK=$((LEFT_SINK+1));`).join('\n')}
echo "SINK_FILES_LEFT_FROM_THIS_RUN=$LEFT_SINK"
echo "SINK_DELETE_TARGETS=${sinkPaths.length}"
`
  return ssh(script)
}

try {
  console.log('=== M5 留言板：第三账号真机隔离验证 ===')
  console.log('')

  // -------------------------------------------------------------------------
  console.log('[1/6] 造甲、乙两个临时账号（真实 OTP 流程）')
  // 手机号用 1380000xxxx：与种子号（13800000001/2/3）和 helper 的 138xxxxxxxx 都不同段，
  // 避免与种子数据/其它用例撞号。每次运行新号，也就绕开了 request-code 的 (IP,号码) 限流。
  A.phone = `1380000${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`
  B.phone = `1380000${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`
  const accA = await loginViaApi(A.phone)
  const accB = await loginViaApi(B.phone)
  Object.assign(A, accA)
  Object.assign(B, accB)
  info(`甲 phone=${A.phone} userId=${A.userId}`)
  info(`乙 phone=${B.phone} userId=${B.userId}`)
  check(A.userId && B.userId && A.userId !== B.userId, '甲、乙两个临时账号已就绪（且互不相同）', '甲/乙账号创建失败')

  // -------------------------------------------------------------------------
  console.log('')
  console.log('[2/6] 甲给乙留一条留言，并做服务端前置验证')
  // 正文里带一个**唯一标记**：后面在设备界面与接口响应里都找这个字符串，
  // 避免"页面刚好有别的留言"造成的假通过。
  const marker = `ISO-${randomUUID().slice(0, 8)}`
  noteBody = `甲乙之间的私密留言 ${marker}`
  const post = await api(`/api/board-notes/${B.userId}`, { method: 'POST', token: A.token, body: { body: noteBody } })
  check(post.status === 201, `甲给乙留言 → 201（id=${post.json?.id ?? '?'}）`, `甲给乙留言期望 201，实际 ${post.status}：${post.text.slice(0, 160)}`)

  // 断言 1：甲、乙都能看到（服务端侧前置）
  const readA = await api(`/api/board-notes/${B.userId}`, { token: A.token })
  const readB = await api(`/api/board-notes/${A.userId}`, { token: B.token })
  check(readA.text.includes(marker), '甲（发送方）能读到这条留言', `甲方读不到：${readA.text.slice(0, 160)}`)
  check(readB.text.includes(marker), '乙（接收方）能读到这条留言', `乙方读不到：${readB.text.slice(0, 160)}`)

  // -------------------------------------------------------------------------
  console.log('')
  console.log('[3/6] 把设备登录成丙（device-login-helper，真实 OTP 登录）')
  // 注意顺序：设备登录会冷启动 App 并清空会话，所以必须排在"甲乙与留言"之后。
  // 也不要在 Windows 上用管道捕获——本项目在受限沙箱下 `stdio: 'pipe'` 会 EPERM，
  // 而 execFile 默认走管道；这里让 helper 把日志写文件，读文件即可拿到全文。
  //
  // **先处理设备前台**（本单实测踩到的坑，记下来避免下次再花一轮）：
  //   这台模拟器上同时装着**原版** App（com.kairuotu.campus），而它当时正停在
  //   原版的留言板 Activity 上（topResumedActivity=com.kairuotu.campus/...MessageBoardActivity）。
  //   于是 helper 冷启动我们的 App 时，原版把我们 App 顶掉了：
  //     · coldreset 阶段能读到我们 App 的校园页（那一瞬间我们在前台）
  //     · prepare 阶段页面已被顶走 → 拿不到底部导航 → 报「找不到底部导航」
  //   诊断证据：force-stop 原版后，我们的 App 立刻回到前台，
  //   .tabbar__item 数量 = 3、hash = #/campus，helper 也就跑得通了。
  //   这**不是产品缺陷**，是设备环境没归位；而且原版 App 对本单毫无用处（我们只验自己的 App）。
  await adb(['shell', 'am', 'force-stop', 'com.kairuotu.campus']).catch(() => {})
  info('已 force-stop 原版 App（com.kairuotu.campus），避免它抢占前台遮蔽我们的 App')

  const helperLog = `${REPO}\\.tmp-m5-iso\\helper-login.log`
  let helperOut = ''
  try {
    const r = await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${REPO}\\scripts\\m3\\device-login-helper.ps1`, '-SelfTest'], {
      maxBuffer: 8 * 1024 * 1024,
    })
    helperOut = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  } catch (e) {
    // 失败时也要把输出落盘：execFile 抛错时 stdout/stderr 挂在 error 上
    helperOut = `${e?.stdout ?? ''}\n${e?.stderr ?? ''}\n${e?.message ?? e}`
  }
  await import('node:fs/promises').then((fs) => fs.writeFile(helperLog, helperOut, 'utf8'))
  const helperPass = helperOut.includes('HELPER_SELFTEST PASS')
  const phoneMatch = helperOut.match(/phone=(\d{11})/)
  C.phone = phoneMatch ? phoneMatch[1] : null
  info(`helper 输出：${helperPass ? 'HELPER_SELFTEST PASS' : '未看到 PASS'}${C.phone ? `，丙 phone=${C.phone}` : ''}`)
  if (!helperPass) {
    bad(`device-login-helper 未通过（原始输出见 ${helperLog}）`)
    console.log(helperOut.split('\n').filter((l) => l.includes('helper') || l.includes('FAIL') || l.includes('PASS')).slice(0, 25).join('\n'))
    throw new Error('设备登录失败，后续真机断言无法进行')
  }
  ok('丙在真机上完成真实 OTP 登录（HELPER_SELFTEST PASS）')

  // -------------------------------------------------------------------------
  console.log('')
  console.log('[4/6] 重连 CDP（App 已被 helper 冷启动，pidof 变了，必须重做转发）')
  const pid = await cdpForward()
  info(`WebView pid=${pid}`)
  const cdp = await connectCdp()
  ws = cdp.ws
  const ev = cdp.ev

  // 从设备本地会话读回丙的身份 —— 这是"设备上确实是丙"的直接证据，
  // 而不是靠 helper 的标准输出（那只是它自己的说法）。
  const sessRaw = await ev(`localStorage.getItem('campus.demo.session.v1')`)
  const sess = sessRaw ? JSON.parse(sessRaw) : null
  info(`设备本地会话：phone=${sess?.user?.phone ?? '(无)'} displayName=${sess?.user?.displayName ?? '(无)'}`)
  check(!!sess?.token, '设备本地存在会话（丙已登录）', '设备本地没有会话：丙未登录，后续断言无意义')

  // 用设备里的 token 调 /api/auth/me，确认服务端认可的身份就是丙（而不是甲/乙）
  const me = await ev(`(async () => {
    const s = JSON.parse(localStorage.getItem('campus.demo.session.v1'))
    const r = await fetch('${API}/api/auth/me', { headers: { authorization: 'Bearer ' + s.token } })
    return JSON.stringify({ status: r.status, body: await r.text() })
  })()`)
  const meP = JSON.parse(me)
  const meBody = JSON.parse(meP.body)
  C.userId = meBody.id
  C.token = sess?.token
  info(`服务端身份：/api/auth/me → ${meP.status} id=${C.userId} phone=${meBody.phone}`)
  check(
    C.userId !== A.userId && C.userId !== B.userId,
    `**设备上登录的丙与甲、乙都不是同一人**（丙=${C.userId}）`,
    `设备上登录的身份与甲或乙重合（丙=${C.userId}，甲=${A.userId}，乙=${B.userId}）`,
  )
  check(
    !C.phone || meBody.phone === `+86${C.phone}`,
    `设备身份与服务端一致（+86${C.phone}）`,
    `设备身份与 helper 报告的号码不一致：helper=${C.phone} 服务端=${meBody.phone}`,
  )

  // 服务端侧再补一条"丙读不到"（作为设备断言的对照；设备断言才是本单的主证据）
  const readC = await api(`/api/board-notes/${B.userId}`, { token: C.token })
  check(!readC.text.includes(marker), '丙（服务端侧）读不到甲乙之间的留言', `丙的接口响应里出现了那条留言：${readC.text.slice(0, 200)}`)

  // -------------------------------------------------------------------------
  console.log('')
  console.log('[5/6] 真机断言：丙在 App 里打开乙的留言板')
  // 冷启动 + 进路由：与 device-board-emoji-check.mjs 同一套做法（reload 保留 hash，所以先进 hash 再 reload）
  await ev(`location.hash = '#/board/${B.userId}'`)
  await wait(600)
  await ev(`location.reload()`)
  await wait(3500)
  await ev(`location.hash = '#/board/${B.userId}'`)
  await wait(4000)

  const dump = JSON.parse(
    await ev(`(() => JSON.stringify({
      hash: location.hash,
      state: {
        notes: document.querySelectorAll('.note').length,
        emptyText: document.querySelector('.board__emptyText')?.textContent ?? null,
        hint: document.querySelector('.board__hint')?.textContent ?? null,
        title: document.querySelector('.board__title')?.textContent ?? null,
        sub: document.querySelector('.board__sub')?.textContent ?? null,
        placeholder: document.querySelector('.board__input')?.placeholder ?? null,
        body: (document.body.innerText || '').replace(/\\n+/g, ' | ').slice(0, 400),
      },
    }))()`),
  )
  info(`当前路由：${dump.hash}`)
  info(`页面正文：${dump.state.body}`)

  check(dump.state.title === '留言' && !!dump.state.sub, '已进入留言板页面（标题「留言」+ 副标题存在）', `没有进入留言板页面：${dump.state.body.slice(0, 120)}`)

  // 断言 2：看不到那条留言
  check(!dump.state.body.includes(marker), '**丙在设备界面上看不到那条留言**（正文里没有唯一标记）', `**界面出现了他人的留言！**正文片段：${dump.state.body.slice(0, 200)}`)
  check(dump.state.notes === 0, '便签数为 0（页面上没有任何 .note 元素）', `页面上出现了 ${dump.state.notes} 条便签`)

  // 断言 3：不是报错，是正常空态
  check(
    dump.state.emptyText === '可以给同学留言噢',
    '页面不是报错而是正常空态（显示「可以给同学留言噢」）',
    `页面不是空态：emptyText=${JSON.stringify(dump.state.emptyText)}`,
  )
  check(dump.state.body.includes('可以给同学留言噢'), '**空态文案在页面可见文本里**（不只是 DOM 里有个元素）', '页面可见文本里没有空态文案')
  check(
    !dump.state.body.includes('网络错误'),
    '页面没有出现「网络错误」（说明是真的空列表，不是请求失败被渲染成空）',
    '页面显示「网络错误」：这不是"读不到"，而是"没读到"—— 断言无效',
  )

  // 断言 4：顺带记录丙看到的是空态而不是权限错误
  const looksLikePermissionError = /403|无权限|没有权限|禁止访问|forbidden/i.test(dump.state.body)
  check(!looksLikePermissionError, '丙看到的是空态，不是权限错误（服务端按"空列表"处理，不泄漏两人之间有没有留言）', '页面出现了权限类错误文案')
  info(`顺带记录：丙看到 emptyText=${JSON.stringify(dump.state.emptyText)}，hint=${JSON.stringify(dump.state.hint)}`)

  // -------------------------------------------------------------------------
  console.log('')
  console.log('[6/6] 清理测试数据')
  const result = await cleanup()
  const want = {
    LEFT_USERS: '0',
    LEFT_NOTES: '0',
    LEFT_SESSIONS: '0',
    LEFT_CHALLENGES: '0',
    SEED_USERS: '3',
    SINK_FILES_LEFT_FROM_THIS_RUN: '0',
  }
  const got = {}
  for (const line of String(result).split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) got[m[1]] = m[2].trim()
  }
  for (const [k, v] of Object.entries(want)) {
    check(got[k] === v, `清理核对 ${k}=${got[k]}`, `清理核对 ${k} 期望 ${v}，实际 ${got[k] ?? '(未取到)'}`)
  }
  info(`种子留言数保持为 ${got.SEED_NOTES}（未删除种子数据）`)
} catch (err) {
  bad(`脚本异常中断：${err.message}`)
  console.log(String(err.stack ?? '').split('\n').slice(0, 6).join('\n'))
  // 异常路径也要清理（否则会留下临时账号）
  try {
    const r = await cleanup()
    console.log(String(r).split('\n').map((l) => `  · 清理 ${l}`).join('\n'))
  } catch (e2) {
    bad(`异常路径清理也失败：${e2.message}`)
  }
} finally {
  try {
    ws?.close()
  } catch {
    /* 已关闭 */
  }
}

console.log('')
console.log(failed === 0 ? 'DEVICE_BOARD_ISOLATION_RESULT PASS' : 'DEVICE_BOARD_ISOLATION_RESULT FAIL')
process.exit(failed)
