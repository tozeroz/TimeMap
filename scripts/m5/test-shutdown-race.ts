/**
 * B2 停机竞态修复的**确定性判别测试**。
 *
 * ## 要断言的不变量
 *
 *   进程开始关闭之后，**不得再对 pool 发起任何查询**。
 *
 * 为什么这是根因所在：原缺陷的机理是"shutdown 期间心跳仍能调 db.refresh()，
 * 而 pool 已被 end()"，于是抛出 `Cannot use a pool after calling end on the pool`，
 * 被 classifyMigrationError 判为 **terminal**，打出"需要人工介入"的假警报。
 * 修复的关键就是 `closing` 守卫让关闭后的 refresh() **完全不碰 pool**。
 *
 * ## 为什么必须是这种测法（而不是"重启几次看日志"）
 *
 * 我先写的是"重启 3 次 + 轮询 /api/ready，断言日志无假警报"。**它没有判别力**：
 * 在**未修复**的构建上跑同样 PASS —— 因为该竞态依赖时序（原发现场是 SIGTERM 后 3 秒，
 * 由 app.close() 等待在飞请求撑开的窗口），重启几次碰不到。
 * 一个在修复前后都通过的测试，不能用来证明修复。**实测确认过这一点，因此改用本测试。**
 *
 * 本测试的判别力来源：用探针**计数** pool.query 的调用，而不是等一次偶发异常。
 *   · 未修复 → close() 后 refresh() 会进入 refreshOnce()，**调用 pool.query**（计数 > 0）→ FAIL
 *   · 已修复 → closing 守卫直接返回，**一次都不调用**（计数 = 0）→ PASS
 *
 * ## 本测试**不能**证明的
 *
 *   · 不能证明"生产环境 100% 不会再出现该日志"（那需要能复现原时序；本环境做不到）
 *   · 不能覆盖"心跳恰好在 clearInterval 之前已发起"的那一次 —— 那一路由 db.ts 的
 *     `close()` 中 `await inflight` 覆盖，只能靠**源码审阅**确认，不由此测试覆盖
 *
 * 用法（Node 24+ 支持直接跑 TS）：
 *   node scripts/m5/test-shutdown-race.ts
 */
import pg from 'pg'
import { createDb } from '../../server/src/db.ts'

const DSN = process.env.DATABASE_URL ?? 'postgres://campus:campus@127.0.0.1:5432/campus'

/** 探针：统计 close() 之后发生的 pool.query 调用 */
let closedAt: number | null = null
const queriesAfterClose: string[] = []

const origQuery = pg.Pool.prototype.query
pg.Pool.prototype.query = function patched(this: pg.Pool, ...args: unknown[]) {
  if (closedAt !== null) {
    const first = args[0]
    queriesAfterClose.push(typeof first === 'string' ? first.slice(0, 60) : '(non-string)')
  }
  // @ts-expect-error 透传给原始实现（参数形态很多，这里只做旁路记录）
  return origQuery.apply(this, args)
}

const origEnd = pg.Pool.prototype.end
pg.Pool.prototype.end = async function patchedEnd(this: pg.Pool, ...args: unknown[]) {
  // ⚠ 在**调用时**就标记（而不是 await 之后）：要抓的是"end 已经开始之后还有查询"
  if (closedAt === null) closedAt = Date.now()
  // @ts-expect-error 透传
  return origEnd.apply(this, args)
}

const cfg = {
  databaseUrl: DSN,
  poolMax: 4,
  poolIdleTimeoutMs: 1000,
  poolConnectionTimeoutMs: 3000,
} as unknown as Parameters<typeof createDb>[0]

const db = createDb(cfg)

console.log('=== 前置：确认能连上（否则测试无意义）===')
const first = await db.refresh()
console.log('  首次 refresh:', JSON.stringify({ dbUp: first.dbUp, state: first.state, ready: first.ready }))
if (!first.dbUp) {
  console.error('  FATAL 连不上数据库，无法进行本测试（设置 DATABASE_URL）')
  process.exit(2)
}

console.log()
console.log('=== 关闭（标记 closedAt）===')
await db.close()
console.log('  close() 完成，closedAt 已标记')

console.log()
console.log('=== 关键断言：关闭之后再调 refresh()，不得发起任何 pool 查询 ===')
let refreshAfterCloseError: string | null = null
let afterState = 'n/a'
try {
  const r = await db.refresh()
  afterState = `${r.state}/ready=${r.ready}`
} catch (e) {
  refreshAfterCloseError = (e as Error).message
}

console.log(`  关闭后 refresh() 返回状态: ${afterState}`)
console.log(`  关闭后 refresh() 抛错    : ${refreshAfterCloseError ?? '(无)'}`)
console.log(`  关闭后发生的 pool.query  : ${queriesAfterClose.length} 次`)
if (queriesAfterClose.length > 0) {
  for (const q of queriesAfterClose.slice(0, 5)) console.log(`      - ${q}`)
}

const noPoolUse = queriesAfterClose.length === 0
console.log()
if (noPoolUse) {
  console.log('B2_CLOSING_GUARD: PASS（关闭后完全不碰 pool —— closing 守卫生效）')
  process.exit(0)
} else {
  console.log('B2_CLOSING_GUARD: FAIL（关闭后仍发起了 pool 查询 —— 守卫未生效）')
  process.exit(1)
}
