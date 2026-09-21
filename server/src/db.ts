import { createHash } from 'node:crypto'
import pg from 'pg'
import initSql from './migrations/001_init.sql'
import identitySql from './migrations/002_identity.sql'
import dataModelSql from './migrations/003_data_model_v01.sql'
import m3RevisionsSql from './migrations/004_m3_model_revisions.sql'
import m3AuthSql from './migrations/005_phone_otp_identity.sql'
import mediaScopeSql from './migrations/006_media_scope.sql'
import mediaLinkIdsSql from './migrations/007_media_link_ids.sql'
import messageMentionsSql from './migrations/008_message_mentions.sql'
import voiceMediaSql from './migrations/009_voice_media.sql'
import voiceMediaStrictSql from './migrations/010_voice_media_strict.sql'
import type { AppConfig } from './config.ts'

/**
 * 迁移清单。
 *
 * 为什么把 SQL 显式 import 进数组，而不是运行时读目录：
 * 部署形态是「本地 esbuild 打成单文件 → 服务器零 node_modules」，
 * 服务器上没有 migrations/ 目录，SQL 必须在打包时内联进来。
 * 新增迁移就往这个数组追加一项（顺序即执行顺序）。
 */
export const MIGRATIONS: ReadonlyArray<{ version: string; sql: string }> = [
  { version: '001_init', sql: initSql },
  { version: '002_identity', sql: identitySql },
  { version: '003_data_model_v01', sql: dataModelSql },
  { version: '004_m3_model_revisions', sql: m3RevisionsSql },
  { version: '005_phone_otp_identity', sql: m3AuthSql },
  { version: '006_media_scope', sql: mediaScopeSql },
  { version: '007_media_link_ids', sql: mediaLinkIdsSql },
  { version: '008_message_mentions', sql: messageMentionsSql },
  // 009：语音消息 —— media.mime 放开 audio/webm + 新增 duration_ms（实测驱动，见该文件头部注释）
  { version: '009_voice_media', sql: voiceMediaSql },
  // 010：加严 MIME ↔ duration 一致性（审核记录 35 要求；009 已应用不能改，故追加）
  { version: '010_voice_media_strict', sql: voiceMediaStrictSql },
]

/** 每个迁移内容的 SHA-256：用于检测「已应用的迁移文件被改动」（审核记录 08 第 3 点） */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

/**
 * schema 就绪状态。
 *
 * `terminal` 与 `retryable` 必须分开（审核记录 08）：
 * - transient（PG 不可用/超时）→ 可以重试；
 * - terminal（校验和不匹配、SQL 语法/运行错误、意外的 schema 状态）
 *   → **不能每 10 秒无限重试**：那只会把日志刷爆，还掩盖真正需要人来修的问题。
 *   终态时保持 NOT_READY + 响亮诊断，等待人工修复后重启。
 */
export type MigrationState = 'pending' | 'ready' | 'retryable' | 'terminal'

export interface DbStatus {
  /** 能连上 PG */
  dbUp: boolean
  /** schema_migrations 里已应用的版本数 */
  applied: number
  /** 代码里期望的版本数 */
  expected: number
  state: MigrationState
  /** 终态/重试态的原因（给人看的） */
  lastError: string | null
  /** 是否所有依赖 schema 的业务路由可以放行 */
  ready: boolean
}

export interface Db {
  pool: pg.Pool
  /** 连接可用性（不抛异常） */
  ping(): Promise<boolean>
  /** 已应用迁移数 */
  appliedMigrationCount(): Promise<number>
  /** 执行未应用的迁移；可重复调用（幂等） */
  migrate(): Promise<{ applied: string[]; skipped: number[] | string[] }>
  /** 当前就绪状态（业务路由与 /api/ready 都用它） */
  status(): DbStatus
  /** 尝试一次迁移并更新状态；返回是否恰好就绪 */
  refresh(): Promise<DbStatus>
  /**
   * 请求路径上碰到数据库错误时调用。
   *
   * 为什么必须有这个：`status()` 是"上次 refresh 时"的快照。
   * PG 在两次 refresh 之间挂掉时，就绪门禁仍然以为自己是 ready，
   * 于是业务路由会拿旧 schema 硬发 SQL，返回 500 —— 而正确行为是**立刻**变成 503。
   * 顺着真实请求观察到的错误来失效状态，是最及时也最省的信号。
   */
  noteFailure(err: unknown): 'transient' | 'terminal'
  close(): Promise<void>
}

/** advisory lock 的键：所有实例用同一把锁串行化迁移 */
const MIGRATION_LOCK_KEY = 8_148_156_146

/**
 * 判断一个迁移错误是"等一会儿会好"还是"必须人工介入"。
 *
 * 分错的代价很大：把 terminal 当 transient 会无限重试刷日志；
 * 把 transient 当 terminal 会让一次网络抖动永久卡住服务。
 * 所以这里只把**明确的连接层错误**当 transient，其余一律 terminal（保守）。
 */
export function classifyMigrationError(err: unknown): 'transient' | 'terminal' {
  const e = err as { code?: string; message?: string }
  const code = e?.code ?? ''
  const msg = (e?.message ?? '').toLowerCase()

  // 连接层：PG 没起来 / 连不上 / 超时
  if (
    ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code) ||
    code === '57P03' /* cannot_connect_now */ ||
    msg.includes('connection terminated') ||
    msg.includes('connection timeout') ||
    msg.includes('timeout expired') ||
    msg.includes('the database system is starting up') ||
    msg.includes('terminating connection due to administrator command')
  ) {
    return 'transient'
  }

  // 其余（语法错误 42601、约束 23xxx、校验和不匹配、意外 schema 状态）都要求人介入
  return 'terminal'
}

export function createDb(cfg: AppConfig): Db {
  const pool = new pg.Pool({
    connectionString: cfg.databaseUrl,
    max: cfg.poolMax,
    idleTimeoutMillis: cfg.poolIdleTimeoutMs,
    connectionTimeoutMillis: cfg.poolConnectionTimeoutMs,
  })
  // 连接池里的空闲连接报错不应该让进程崩掉
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message)
  })

  const state: DbStatus = {
    dbUp: false,
    applied: 0,
    expected: MIGRATIONS.length,
    state: 'pending',
    lastError: null,
    ready: false,
  }

  async function appliedCount(): Promise<number> {
    try {
      const r = await pool.query<{ n: string }>('select count(*)::text as n from schema_migrations')
      return Number.parseInt(r.rows[0]?.n ?? '0', 10)
    } catch {
      // schema_migrations 还不存在（全新库）→ 视为 0
      return 0
    }
  }

  async function migrate(): Promise<{ applied: string[]; skipped: string[] }> {
    const applied: string[] = []
    const skipped: string[] = []

    // schema_migrations 自己必须先存在，才能记录版本。
    // checksum 列在 005 之前就已经写入的旧行会是 NULL —— 那不算错，首次见到时回填即可。
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text')

    /**
     * advisory lock：多实例/并发启动时串行化迁移。
     *
     * **必须先拿锁、再读"已应用集合"**（这里改过一次，Gate 抓到过真实 bug）：
     * 早先的写法是"先读 existing → 再拿锁 → 再按 existing 决定要应用哪些"，
     * 于是两个并发调用（后台迁移 + `/api/ready` 触发的 refresh）会各自读到
     * "005 未应用"，然后都去 INSERT 005 → `duplicate key ... schema_migrations_pkey`。
     * 检查与动作必须都在锁内，否则锁等于没加。
     */
    const lockClient = await pool.connect()
    try {
      await lockClient.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])

      // 锁内重新读取权威状态
      const rows = (
        await lockClient.query<{ version: string; checksum: string | null }>(
          'select version, checksum from schema_migrations',
        )
      ).rows
      const existing = new Map(rows.map((r) => [r.version, r.checksum]))

      // 先校验已应用迁移的校验和：不一致说明迁移文件被改过，绝不能自动重跑
      for (const m of MIGRATIONS) {
        if (!existing.has(m.version)) continue
        const stored = existing.get(m.version) ?? null
        const actual = migrationChecksum(m.sql)
        if (stored === null) {
          await lockClient.query('update schema_migrations set checksum = $1 where version = $2', [
            actual,
            m.version,
          ])
          continue
        }
        if (stored !== actual) {
          throw new Error(
            `migration checksum mismatch: ${m.version} (stored=${stored.slice(0, 12)}… actual=${actual.slice(0, 12)}…)`,
          )
        }
      }

      for (const m of MIGRATIONS) {
        if (existing.has(m.version)) {
          skipped.push(m.version)
          continue
        }
        // 每个迁移一个事务：失败就整体回滚，不会留半截 schema
        const client = await pool.connect()
        try {
          await client.query('begin')
          await client.query(m.sql)
          // on conflict do nothing 只是兜底：拿到锁之后本不该再有并发插入，
          // 但万一有第二个进程用了不同的锁路径，也不该让整个迁移流程崩掉
          await client.query(
            'insert into schema_migrations(version, checksum) values ($1, $2) on conflict (version) do nothing',
            [m.version, migrationChecksum(m.sql)],
          )
          await client.query('commit')
          applied.push(m.version)
        } catch (err) {
          await client.query('rollback').catch(() => undefined)
          throw new Error(`migration ${m.version} failed: ${(err as Error).message}`)
        } finally {
          client.release()
        }
      }
    } finally {
      await lockClient.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined)
      lockClient.release()
    }

    return { applied, skipped }
  }

  /**
   * 单飞（single-flight）：同一时刻只允许**一次**迁移在跑。
   *
   * 为什么必要：`/api/ready` 与后台的重试定时器都会调 refresh()。
   * 没有单飞时，两次调用会各自跑一遍 migrate()；虽然现在锁内会重读状态（不会再撞主键），
   * 但重复跑迁移本身是浪费，而且会让"某次调用看到的中间态"变得难以解释。
   */
  let inflight: Promise<DbStatus> | null = null

  /**
   * 进程正在关闭 —— 用它**消除 shutdown 竞态**。
   *
   * 修的是一个真实缺陷（2026-09-22）：停机日志里出现过
   *   `[migrate] TERMINAL failure (no retry, human action required): Cannot use a pool after calling end on the pool`
   * 并伴随 `[health] ready: true -> false (state=terminal)`。
   *
   * 机理：shutdown 会依次 `app.close()` → `db.close()` → `pool.end()`；
   * 若此刻后台重试定时器或 `/api/ready` 探测正在 `refreshOnce()` 内部，
   * 它的 `pool.query` 就会在 pool 已 end 之后抛出 "Cannot use a pool after calling end on the pool"。
   * 该错误**不匹配任何 transient 模式** → 被 classifyMigrationError 判为 **terminal**
   * → 打出一条"需要人工介入"的严重告警并翻转健康状态。
   *
   * 危害不是崩溃（进程本来就在退出），而是**把一次正常、有意的停机记成严重故障**，
   * 从而误导运维 —— 这正是本项目一直在防的"假信号"类问题。
   *
   * 两处一起才是完整修法：
   *   ① 本标志：关闭开始后**不再发起**新的 refresh；
   *   ② close() 中先 `await inflight`：**等已在飞的 refresh 收尾**再 end pool
   *      —— 只加 ① 不足以覆盖"已经在飞行中"的那一次。
   */
  let closing = false

  async function refreshOnce(): Promise<DbStatus> {
    const up = await (async () => {
      try {
        await pool.query('select 1')
        return true
      } catch {
        return false
      }
    })()
    state.dbUp = up
    state.applied = up ? await appliedCount() : 0

    if (!up) {
      state.state = 'retryable'
      state.lastError = 'database unreachable'
      state.ready = false
      return { ...state }
    }

    try {
      const result = await migrate()
      state.state = 'ready'
      state.applied = MIGRATIONS.length
      state.lastError = result.applied.length ? `applied=${result.applied.join(',')}` : null
      state.ready = true
    } catch (err) {
      const kind = classifyMigrationError(err)
      // classifyMigrationError 说的是"该不该重试"，对外状态用 retryable/terminal 表达
      state.state = kind === 'transient' ? 'retryable' : 'terminal'
      state.lastError = (err as Error).message
      state.ready = false
      if (kind === 'terminal') {
        // 终态：不重试。响亮地说清楚，别让它变成一个刷屏的循环。
        console.error('[migrate] TERMINAL failure (no retry, human action required):', state.lastError)
      }
    }
    return { ...state }
  }

  async function refresh(): Promise<DbStatus> {
    /**
     * 关闭中：直接返回当前状态，**不碰 pool**。
     * 否则会撞上 "Cannot use a pool after calling end on the pool" 并被误判为 terminal
     * （见上面 `closing` 的注释）。
     */
    if (closing) return { ...state }

    /**
     * 终态短路：进入 terminal 之后**不再重试迁移**。
     * 否则 /api/ready 每被探测一次就会重跑一次注定失败的迁移 ——
     * 那正是审核记录 08 说的"死循环执行 migration"，而且会把日志刷爆。
     * 人工修好之后重启进程即可恢复（状态是内存里的）。
     */
    if (state.state === 'terminal') return { ...state }

    if (inflight) return inflight
    inflight = refreshOnce().finally(() => {
      inflight = null
    })
    return inflight
  }

  return {
    pool,

    async ping(): Promise<boolean> {
      try {
        await pool.query('select 1')
        return true
      } catch (err) {
        console.error('[db] ping failed:', (err as Error).message)
        return false
      }
    },

    appliedMigrationCount: appliedCount,
    migrate,
    status: () => ({ ...state }),
    refresh,

    noteFailure(err) {
      const kind = classifyMigrationError(err)
      /**
       * **只有连接层错误才降级就绪状态**。
       *
       * 这里踩过一个坑（Slice 1 的评论查询写错别名时暴露）：
       * 原来把任何非连接错误都标成 terminal 并置 ready=false，
       * 结果**一条业务 SQL 写错就把全局就绪状态打成终态，所有业务路由全 503** ——
       * 一个本该只影响单个请求的产品缺陷被放大成了全站不可用，
       * 而且 ready=false 之后连"哪条路由坏了"都看不出来（全是 503）。
       *
       * 语义上必须分清：
       *   - transient（PG 连不上/超时）→ 这是**可用性问题**，降级 ready，让业务路由统一 503；
       *   - terminal（SQL 写错、约束冲突等）→ 这是**代码缺陷**，只应让该请求返回 500，
       *     就绪状态（"能不能服务"）不受影响。
       * terminal 的"不再重试迁移"只适用于**迁移路径**（见 refresh()），不适用于请求路径。
       */
      if (kind === 'transient' && state.state !== 'terminal') {
        state.state = 'retryable'
        state.lastError = (err as Error).message
        state.ready = false
      }
      return kind
    },

    async close(): Promise<void> {
      /**
       * 顺序很重要（见 `closing` 的注释）：
       *   ① 先置 closing → 之后**不会再有新的** refresh 发起；
       *   ② 再等在飞的那一次 refresh 收尾 → 它不会在 pool.end() 之后还在查询；
       *   ③ 最后才 end pool。
       * 老写法只有第 ③ 步，于是"已 in-flight 的 refresh" 会撞上已关闭的 pool，
       * 抛出 "Cannot use a pool after calling end on the pool" 并被误判为 terminal。
       */
      closing = true
      if (inflight) {
        // 吞掉错误：关闭路径上不该因为一次 refresh 失败而中断（它也已经不再重要）
        await inflight.catch(() => undefined)
      }
      await pool.end()
    },
  }
}
