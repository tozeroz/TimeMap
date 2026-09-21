/**
 * E3 验证：`cleanup-auth` 只删"确定已死的四类"，**绝不碰**活跃 session / 有效 challenge。
 *
 * 设计要点（沿用本项目 Gate 纪律）：
 *  ① **控制变量**：造出 6 种状态的行，其中 4 类该删、2 类绝不能删，
 *     两组之间只差"时间是否超过 grace"或"是否已撤销/已消费"。
 *  ② **先证明断言能失败**：脚本包含 SENSITIVITY 段 ——
 *     用 `--grace-hours 0` 复跑，验证"刚产生的行也会被删"，
 *     从而证明"按 grace 保护"这件事**真的在起作用**（而不是碰巧没删）。
 *  ③ fail-closed：无 DATABASE_URL 必须退出码 2 且不删任何行。
 *  ④ 幂等：连跑两次，第二次删除数为 0。
 *
 * 用法（需本地 PG）：
 *   $env:DATABASE_URL='postgres://campus:devpass@127.0.0.1:55432/campus'
 *   node scripts/m5/verify-cleanup-auth.mjs
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Pool } from 'pg'

const DSN = process.env.DATABASE_URL
if (!DSN) {
  console.error('FATAL 需要 DATABASE_URL')
  process.exit(2)
}

let PASS = 0
let FAIL = 0
const ok = (m) => {
  PASS++
  console.log(`  PASS ${m}`)
}
const bad = (m) => {
  FAIL++
  console.log(`  FAIL ${m}`)
}

// CLI 产物在 server/dist/；本测试位于 server/tests/ → 由文件位置推算，避免依赖调用方的 cwd
const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

const pool = new Pool({ connectionString: DSN, max: 2 })
const q = (sql, params) => pool.query(sql, params)

/** 跑 CLI（相对 server/dist），返回 { code, stdout, stderr, json } */
function runCli(args, env = {}) {
  try {
    const out = execFileSync(process.execPath, ['dist/cleanup-auth.mjs', ...args], {
      cwd: SERVER_DIR,
      encoding: 'utf8',
      // ⚠ 顺序要紧：传入的 env 必须能**覆盖** DSN，否则测不出 fail-closed。
      //    第一版写成 (...process.env, ...env, DATABASE_URL: DSN) —— DSN 落在最后，
      //    把传进来的空 DATABASE_URL 又盖回去了 → CLI 拿到有效 DSN 正常退出（0），
      //    断言"期望退出码 2 实得 0"失败。那是 harness bug，不是产品 bug。
      env: { ...process.env, DATABASE_URL: DSN, ...env },
    })
    return { code: 0, stdout: out, stderr: '', json: tryJson(out) }
  } catch (e) {
    const stdout = e.stdout?.toString() ?? ''
    const stderr = e.stderr?.toString() ?? ''
    return { code: e.status ?? 1, stdout, stderr, json: tryJson(stdout) }
  }
}
function tryJson(s) {
  try {
    return JSON.parse(s.trim().split('\n').pop())
  } catch {
    return null
  }
}

console.log('=== E3: cleanup-auth 行为验证 ===')
// ⚠ id 列是 uuid 类型，必须用真 UUID（第一版用了 `e3-...-A` 这种字符串，
//    直接被 PG 以 22P02 invalid input syntax for type uuid 拒绝）
const tag = `e3-${Date.now()}`
const ids = {
  // 该删的四类（都超过 grace=24h）
  deadExpiredSession: randomUUID(),
  deadRevokedSession: randomUUID(),
  deadExpiredChallenge: randomUUID(),
  deadConsumedChallenge: randomUUID(),
  // 绝不能删的两类
  liveActiveSession: randomUUID(),
  livePendingChallenge: randomUUID(),
  // 边界：刚产生、未超 grace（应不删）
  freshRevokedSession: randomUUID(),
  freshConsumedChallenge: randomUUID(),
}

// 需要一个真实 user（sessions.user_id 有外键）
const u = await q(`select id from users order by created_at limit 1`)
if (!u.rows[0]) {
  console.error('FATAL 库里没有 users，无法造 session')
  process.exit(2)
}
const uid = u.rows[0].id

const beforeSessions = Number((await q('select count(*) as n from sessions')).rows[0].n)
const beforeChallenges = Number((await q('select count(*) as n from login_challenges')).rows[0].n)

console.log('\n--- 准备：造 8 行覆盖 6 种状态（4 该删 / 2 绝不能删 / 2 边界未超 grace）---')
// ① 过期会话（过期 48h 前，未撤销）
await q(
  `insert into sessions (id, user_id, token_hash, created_at, expires_at) values ($1,$2,$3, now()-interval '50 days', now()-interval '48 hours')`,
  [ids.deadExpiredSession, uid, `${tag}-A`],
)
// ② 撤销会话（撤销 48h 前，未过期）
await q(
  `insert into sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) values ($1,$2,$3, now()-interval '5 days', now()+interval '25 days', now()-interval '48 hours')`,
  [ids.deadRevokedSession, uid, `${tag}-B`],
)
// ③ 过期 challenge（过期 48h 前，未消费）
await q(
  `insert into login_challenges (id, phone_e164, code_hmac, created_at, expires_at) values ($1,$2,$3, now()-interval '3 days', now()-interval '48 hours')`,
  [ids.deadExpiredChallenge, '+8613900000001', 'x'.repeat(64)],
)
// ④ 已消费 challenge（消费 48h 前）
await q(
  `insert into login_challenges (id, phone_e164, code_hmac, created_at, expires_at, consumed_at) values ($1,$2,$3, now()-interval '3 days', now()-interval '2 days', now()-interval '48 hours')`,
  [ids.deadConsumedChallenge, '+8613900000002', 'y'.repeat(64)],
)
// ⑤ 活跃 session（未撤销、未过期）—— **绝不能删**
await q(
  `insert into sessions (id, user_id, token_hash, created_at, expires_at) values ($1,$2,$3, now(), now()+interval '30 days')`,
  [ids.liveActiveSession, uid, `${tag}-E`],
)
// ⑥ 有效 pending challenge（未消费、未过期）—— **绝不能删**
await q(
  `insert into login_challenges (id, phone_e164, code_hmac, created_at, expires_at) values ($1,$2,$3, now(), now()+interval '5 minutes')`,
  [ids.livePendingChallenge, '+8613900000003', 'z'.repeat(64)],
)
// ⑦ 刚撤销的会话（撤销 1 分钟前）—— 未超 grace，应不删
await q(
  `insert into sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) values ($1,$2,$3, now()-interval '1 day', now()+interval '29 days', now()-interval '1 minute')`,
  [ids.freshRevokedSession, uid, `${tag}-G`],
)
// ⑧ 刚消费的 challenge（消费 1 分钟前）—— 未超 grace，应不删
await q(
  `insert into login_challenges (id, phone_e164, code_hmac, created_at, expires_at, consumed_at) values ($1,$2,$3, now()-interval '10 minutes', now()+interval '5 minutes', now()-interval '1 minute')`,
  [ids.freshConsumedChallenge, '+8613900000004', 'w'.repeat(64)],
)
ok('8 行测试数据已就位')

const count = async (t) => Number((await q(`select count(*) as n from ${t}`)).rows[0].n)
console.log(`  造数后: sessions=${await count('sessions')}（原 ${beforeSessions}）challenges=${await count('login_challenges')}（原 ${beforeChallenges}）`)

// ---------- 1) dry-run 只报告、不删 ----------
console.log('\n=== 1) dry-run：应报告 4 类各 1 条 + 活跃类规模，且**不删任何行** ===')
const dry = runCli(['--json', '--grace-hours', '24'])
const sAfterDry = await count('sessions')
const cAfterDry = await count('login_challenges')
if (dry.json) {
  const j = dry.json
  j.expiredSessions === 1 ? ok('dry-run 报告 expiredSessions=1') : bad(`expiredSessions 期望 1 实得 ${j.expiredSessions}`)
  j.revokedSessions === 1 ? ok('dry-run 报告 revokedSessions=1') : bad(`revokedSessions 期望 1 实得 ${j.revokedSessions}`)
  j.expiredChallenges === 1 ? ok('dry-run 报告 expiredChallenges=1') : bad(`expiredChallenges 期望 1 实得 ${j.expiredChallenges}`)
  j.consumedChallenges === 1 ? ok('dry-run 报告 consumedChallenges=1') : bad(`consumedChallenges 期望 1 实得 ${j.consumedChallenges}`)
  j.deadTotal === 4 ? ok('dry-run 报告 deadTotal=4') : bad(`deadTotal 期望 4 实得 ${j.deadTotal}`)
  j.deleted === null ? ok('dry-run 未执行删除（deleted=null）') : bad('dry-run 竟然执行了删除')
} else {
  bad(`dry-run 输出不是合法 JSON：${dry.stdout.slice(0, 200)}`)
}
// 本次造了 4 行 sessions（①②⑤⑦）与 4 行 challenges（③④⑥⑧）→ 期望各 +4。
// ⚠ 第一版这里写成 +2，于是明明正确也判 FAIL —— 是我的期望值写错，不是产品问题。
if (sAfterDry === beforeSessions + 4 && cAfterDry === beforeChallenges + 4) {
  ok('dry-run 后行数未变（sessions +4、challenges +4 —— 正是本次造的 4+4 行）')
} else {
  bad(
    `dry-run 后行数异常: sessions=${sAfterDry}（期望 ${beforeSessions + 4}）challenges=${cAfterDry}（期望 ${beforeChallenges + 4}）`,
  )
}

// ---------- 2) apply：只删该删的 4 类 ----------
console.log('\n=== 2) --apply：删 4 条死数据，**保留**活跃/有效/未超 grace 的 4 条 ===')
const ap = runCli(['--json', '--apply', '--grace-hours', '24'])
if (ap.json && ap.json.deleted) {
  const d = ap.json.deleted
  const sum = d.expiredSessions + d.revokedSessions + d.expiredChallenges + d.consumedChallenges
  sum === 4 ? ok(`实际删除 4 行（各 1 条）`) : bad(`实际删除 ${sum} 行，期望 4（${JSON.stringify(d)}）`)
} else {
  bad(`--apply 未返回 deleted：${ap.stdout.slice(0, 200)} ${ap.stderr.slice(0, 200)}`)
}

/** 断言某 id 是否存在 */
async function exists(table, id) {
  const r = await q(`select 1 from ${table} where id = $1`, [id])
  return (r.rowCount ?? 0) > 0
}

// 该删的 4 条都不在
for (const [label, table, id] of [
  ['① 过期会话', 'sessions', ids.deadExpiredSession],
  ['② 撤销会话', 'sessions', ids.deadRevokedSession],
  ['③ 过期 challenge', 'login_challenges', ids.deadExpiredChallenge],
  ['④ 已消费 challenge', 'login_challenges', ids.deadConsumedChallenge],
]) {
  ;(await exists(table, id)) ? bad(`${label} **仍然存在**（应已删）`) : ok(`${label} 已删`)
}
// 绝不能删的 2 条都在
for (const [label, table, id] of [
  ['⑤ **活跃会话**', 'sessions', ids.liveActiveSession],
  ['⑥ **有效 pending challenge**', 'login_challenges', ids.livePendingChallenge],
]) {
  ;(await exists(table, id)) ? ok(`${label} 保留（正确）`) : bad(`${label} **被误删**！`)
}
// 未超 grace 的 2 条都在
for (const [label, table, id] of [
  ['⑦ 刚撤销会话（未超 grace）', 'sessions', ids.freshRevokedSession],
  ['⑧ 刚消费 challenge（未超 grace）', 'login_challenges', ids.freshConsumedChallenge],
]) {
  ;(await exists(table, id)) ? ok(`${label} 保留（grace 生效）`) : bad(`${label} 被删（grace 未生效）`)
}

// ---------- 3) 幂等 ----------
console.log('\n=== 3) 幂等：立刻再跑一次 --apply，应删 0 行 ===')
const ap2 = runCli(['--json', '--apply', '--grace-hours', '24'])
if (ap2.json) {
  const d = ap2.json.deleted
  const sum = d ? d.expiredSessions + d.revokedSessions + d.expiredChallenges + d.consumedChallenges : 0
  sum === 0 ? ok('第二次 --apply 删除 0 行（幂等）') : bad(`第二次删了 ${sum} 行（非幂等）`)
} else {
  bad('第二次 --apply 未返回 JSON')
}

// ---------- 4) SENSITIVITY：--grace-hours 0 应把"刚产生"的也视为可删 ----------
// 这一步是**证明 grace 保护真的在起作用**（先证明断言能失败）
console.log('\n=== 4) SENSITIVITY：--grace-hours 0 → 刚撤销/刚消费的两条也会进入候选（证明 grace 有效）===')
const zero = runCli(['--json', '--grace-hours', '0'])
if (zero.json) {
  const j = zero.json
  j.deadTotal >= 2
    ? ok(`grace=0 时候选增加到 ${j.deadTotal}（含刚撤销/刚消费两条）→ 证明 grace 保护确实在起作用`)
    : bad(`grace=0 时候选仍为 ${j.deadTotal}，说明 grace 参数未被应用`)
} else {
  bad('grace=0 未返回 JSON')
}
// ⚠️ 刻意**只 dry-run、不 --apply**。
//    第一版在这里跑了 `--apply --grace-hours 0` —— 那会把库里**所有**历史 challenge
//    一并删掉（grace=0 时"一切已消费/已过期"都算可删），结果把本地 dev 库的 14 行
//    login_challenges 全清空了。**本步只需证明"grace 参数确实被应用"**，dry-run 足够。
//    收尾改用精确 id 删除（见下方"收尾"段），不做任何范围删除。

// ---------- 5) fail-closed ----------
console.log('\n=== 5) fail-closed：无 DATABASE_URL 必须退出码 2 且不删任何行 ===')
const sBeforeNoDb = await count('sessions')
const noDb = runCli(['--apply'], { DATABASE_URL: '' })
noDb.code === 2 ? ok('无 DATABASE_URL → 退出码 2') : bad(`期望退出码 2，实得 ${noDb.code}`)
;(await count('sessions')) === sBeforeNoDb ? ok('无 DATABASE_URL 时未删任何行') : bad('无 DATABASE_URL 时竟然删了行')

// ---------- 收尾：清掉本次测试残留 ----------
console.log('\n=== 收尾：删除本次测试残留 ===')
await q(`delete from sessions where id = any($1::uuid[])`, [
  [ids.deadExpiredSession, ids.deadRevokedSession, ids.liveActiveSession, ids.freshRevokedSession],
])
await q(`delete from login_challenges where id = any($1::uuid[])`, [
  [ids.deadExpiredChallenge, ids.deadConsumedChallenge, ids.livePendingChallenge, ids.freshConsumedChallenge],
])
const sFinal = await count('sessions')
const cFinal = await count('login_challenges')
sFinal === beforeSessions ? ok(`sessions 回到基线 ${beforeSessions}`) : bad(`sessions=${sFinal} 未回到基线 ${beforeSessions}`)
cFinal === beforeChallenges ? ok(`login_challenges 回到基线 ${beforeChallenges}`) : bad(`challenges=${cFinal} 未回到基线 ${beforeChallenges}`)

await pool.end()
console.log('')
console.log(`CLEANUP_AUTH_RESULT: PASS=${PASS} FAIL=${FAIL}`)
console.log(FAIL === 0 ? 'CLEANUP_AUTH: PASS' : 'CLEANUP_AUTH: FAIL')
process.exit(FAIL === 0 ? 0 : 1)
