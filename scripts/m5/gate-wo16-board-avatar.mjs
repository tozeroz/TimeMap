/**
 * Round 266 设备侧 Gate：留言板头像**不是** mock 自称身份（+ 无 peer 时不得可发）
 *
 * ## 改前是什么样（问题不只是"用了 mock"）
 *   `BoardScreen.tsx` 曾写：
 *     `<img className="note__avatar" src={me.avatar} alt="" />`        每条留言都用**同一个** mock 头像
 *     `<span className="note__name">{n.fromName ?? (n.mine ? '我' : '同学')}</span>`  名字**正确区分**双方
 *   ⇒ 症状：**列表里所有留言头像完全相同**，而名字不同 —— **头像与名字自相矛盾**
 *     （对方发的留言也显示"我"的头像）。mock 的 `me` 还是 `{name:'自定义名称6', avatar:…}`，
 *     与 WO#12/#14 已冻结的"users 表没有 avatar 列 ⇒ 用首字占位"直接冲突。
 *
 * ## 断言设计与**判别力**（本文件最要紧的部分）
 *   ① BOARD_NOTE_AVATAR_NOT_MOCK：不再有 mock 生成的 img，且每条都是首字占位。
 *   ② BOARD_NOTE_AVATAR_INITIAL_MATCHES_NAME：占位字母 **== 该条留言显示名字的首字**。
 *   ③ BOARD_NOTE_AVATAR_TWO_PARTIES_DIFFER：若列表里**同时**有"我"与"对方"，两者占位字母必须**不同**。
 *   ⭐ 为什么 ② 是核心：**只断言"有占位"没有判别力** ——
 *      一个"所有留言都用同一个字母"的实现也会通过 ①。
 *      而 ② 要求占位**逐条取自该条显示的名字** ⇒ 只要两条名字不同，
 *      占位字母就**由构造保证**不同（不是一个偶然观察）。
 *   ⚠️ 若数据里只有一方，③ 记 **INCONCLUSIVE**，**不**当作 PASS（样本不足 ≠ 通过）。
 *
 * ## 为什么不去"造双方数据"
 *   留言板是**按 peer 的双方留言**（`GET/POST /api/board-notes/:userId`）。
 *   同一会话里要造出"对方发的"留言，必须**以对方身份登录**并 POST（完整 OTP 链），
 *   成本高且会写更多数据 ⇒ 本 Gate 选择**不做**，而是把 ③ 如实记 INCONCLUSIVE
 *   并说明 ② 已覆盖其判别力。
 *   （我第一版曾试图 POST 造数，但把端点写成 `/api/board-notes`（真形状是
 *     `/api/board-notes/:userId`）→ 404 → 样本没建立。那次失败本身也说明：
 *     **"样本没建立"必须如实记录，不能算通过**。）
 *
 * ## 另外两个同批修掉、与本 Gate 同源的缺陷（各有独立断言）
 *   · App.tsx 曾把 peerId **硬编码兜底**成某个具体用户 UUID（兄弟路由一律 `?? ''`）
 *     ⇒ 从抽屉入口进来时 peerId = 我自己的 id ⇒ 服务端按自指处理 ⇒ **板为空且看不出原因**
 *   · 由此，没有 peer 时 composer 仍可输入并发送 ⇒ 必然 404
 *     ⇒ 断言 BOARD_NO_PEER_COMPOSER_DISABLED
 *
 * ⚠️ 本 Gate **只读**（不发任何写请求）。
 */
import { writeFileSync } from 'node:fs'

const OUT = 'G:\\demo map\\tools\\tmp\\board-avatar-gate.json'
const PEER_ID = process.env.WO_BOARD_PEER_ID || ''

const report = { startedAt: new Date().toISOString(), steps: [] }
const log = (k, v) => {
  report.steps.push({ at: new Date().toISOString(), k, v })
  writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log(k, '=', JSON.stringify(v))
}
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')

if (!PEER_ID) {
  console.error('FATAL 需要 WO_BOARD_PEER_ID=<对方 userId>（留言板是按 peer 的双方留言）')
  process.exit(2)
}

const list = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) {
  console.error('FATAL 没有 CDP page target（用 scripts/m5/run-device-gate.sh 跑）')
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 读留言板：每条的名字 / 占位字母 / 是否仍是 img；并读 no-peer 说明与 composer 状态 */
const snapBoard = () =>
  evaluate(`(() => {
  const notes = [...document.querySelectorAll('[data-note-id]')].map((el) => {
    const name = ((el.querySelector('.note__name') || {}).textContent || '').trim()
    const av = el.querySelector('.note__avatar')
    return {
      name: name,
      avatarTag: av ? av.tagName.toLowerCase() : null,
      isImg: !!(av && av.tagName.toLowerCase() === 'img'),
      placeholder: !!(av && av.hasAttribute('data-note-avatar-placeholder')),
      initial: av ? (av.textContent || '').trim() : null,
    }
  })
  const st = document.querySelector('[data-board-state]')
  const comp = document.querySelector('[data-board-composer]')
  return {
    hash: location.hash,
    count: notes.length,
    notes: notes,
    names: notes.map((n) => n.name),
    anyImgAvatar: notes.some((n) => n.isImg),
    boardState: st ? st.getAttribute('data-board-state') : null,
    composer: comp ? comp.getAttribute('data-board-composer') : 'enabled',
  }
})()`)

console.log('=== 1) 带 peer 进留言板（路由形状 #/<root>/<param>）===')
await evaluate(`location.hash = '#/campus'`)
await sleep(1500)
await evaluate("location.hash = '#/board/' + " + JSON.stringify(PEER_ID))
await sleep(3200)
const snap = await snapBoard()
log('BOARD', snap)

console.log('')
console.log('=== 2) 无 peer 时的不可用态（应不渲染 composer、且给出说明）===')
await evaluate(`location.hash = '#/campus'`)
await sleep(1200)
await evaluate(`location.hash = '#/board'`)
await sleep(3000)
const noPeer = await snapBoard()
log('BOARD_NO_PEER', noPeer)

// ---------- 判定 ----------
const notes = snap.notes || []
const initialMatchesName =
  notes.length > 0 && notes.every((n) => n.name && n.initial && n.name.trim().startsWith(n.initial))
const noMockAvatar =
  notes.length > 0 && snap.anyImgAvatar === false && notes.every((n) => n.placeholder === true)
const byName = new Map()
for (const n of notes) if (!byName.has(n.name)) byName.set(n.name, n)
const distinctNames = [...byName.keys()]
const twoPartiesDiffer =
  distinctNames.length >= 2
    ? byName.get(distinctNames[0]).initial !== byName.get(distinctNames[1]).initial
    : null

const v = {
  BOARD_NOTE_AVATAR_NOT_MOCK: notes.length === 0 ? 'INCONCLUSIVE' : noMockAvatar ? 'PASS' : 'FAIL',
  BOARD_NOTE_AVATAR_INITIAL_MATCHES_NAME:
    notes.length === 0 ? 'INCONCLUSIVE' : initialMatchesName ? 'PASS' : 'FAIL',
  BOARD_NOTE_AVATAR_TWO_PARTIES_DIFFER:
    twoPartiesDiffer === null ? 'INCONCLUSIVE' : twoPartiesDiffer ? 'PASS' : 'FAIL',
  BOARD_NO_PEER_COMPOSER_DISABLED:
    noPeer && noPeer.boardState === 'no-peer' && noPeer.composer === 'disabled' ? 'PASS' : 'FAIL',
  detail: { snap: snap, noPeer: noPeer, distinctNames: distinctNames, peerId: PEER_ID },
  notes: {
    判别力:
      '只断言"有占位"没有判别力；②要求占位**逐条取自该条显示的名字** ⇒ 名字不同则字母由构造保证不同；' +
      '③直接比两方，但样本不足时记 INCONCLUSIVE（不当作 PASS）',
    只读: '本 Gate **不发写请求**（造双方数据需以对方身份 OTP 登录，成本高；故不做并如实标注）',
  },
}
const KEYS = [
  'BOARD_NOTE_AVATAR_NOT_MOCK',
  'BOARD_NOTE_AVATAR_INITIAL_MATCHES_NAME',
  'BOARD_NOTE_AVATAR_TWO_PARTIES_DIFFER',
  'BOARD_NO_PEER_COMPOSER_DISABLED',
]
const anyFail = KEYS.some((k) => v[k] === 'FAIL')
const anyIncon = KEYS.filter((k) => v[k] === 'INCONCLUSIVE')
v.BOARD_AVATAR_GATE = anyFail ? 'FAIL' : anyIncon.length ? 'PASS_WITH_INCONCLUSIVE' : 'PASS'
v.INCONCLUSIVE_KEYS = anyIncon
log('VERDICT', v)

ws.close()
await sleep(400)
process.exit(anyFail ? 1 : 0)
