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
import mentionsAllSql from './migrations/011_mentions_all.sql'
import seedSchoolCampusesSql from './migrations/012_seed_school_campuses.sql'
import seedCollegesSql from './migrations/013_seed_colleges.sql'
import appReleaseSql from './migrations/014_app_release.sql'
import release11Sql from './migrations/015_release_1_1.sql'
import timemapP0Sql from './migrations/016_timemap_p0.sql'
import adminPasswordSql from './migrations/017_admin_password.sql'
import release12Sql from './migrations/018_release_1_2.sql'
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
  // 011：群聊 @所有人 —— messages.mentions_all（M5 WO#9B 层 B；审核记录 48 §3 批准）
  //      只加列，不用 CHECK/trigger 表达"与逐人提及互斥"（那是 service 事务不变量）
  { version: '011_mentions_all', sql: mentionsAllSql },
  // 012：种下**有基线观察证据**的学校与校区（WO#16 层 B；审核 61 批准）
  //      ⚠️ 只种**实体**（北京交通大学 + 校本部/威海校区/东校区），
  //         **不**种任何 campus 归属（users/posts.school_campus_id 仍全为 NULL）——
  //         审核 60：place 推不出 campus，不得为了"让数字出来"而伪造归属。
  //      该 SQL 自带断言：若本迁移产生了任何归属，会直接 raise exception。
  { version: '012_seed_school_campuses', sql: seedSchoolCampusesSql },

  // 013：种下**有观察证据**的学院（F-004/F-006；审核 67 批准为「一个非常小的 closeout」）
  //      ⚠️ 只种**学院实体本身**（5 条，逐字来自 Round 319 对原版「所在学院」picker 的
  //         只读 dump）；**不**种任何归属（users 无 college 列；不种学院→校区；
  //         不种专业列表 —— F-005 明确 NOT_EVALUATED）。
  //      ⚠️ 该 dump 是**观察到的子集**（面板可能可滚动）⇒
  //         ORIGINAL_COLLEGE_LIST_COMPLETE: NOT_EVALUATED（**不**声称完整）。
  { version: '013_seed_colleges', sql: seedCollegesSql },

  // 014：App 发布清单（WO#23；Owner 裁定 ③：App 自更新必须实现体验等价）
  //      ⚠️ 只种**一行**，版本取我们的**真实版本**（1.0，与 android versionName 一致；
  //         该一致性由门禁机械校验）；apk_url 为 NULL（我们**没有**托管 APK）
  //         ⇒ 客户端必须如实说"下载地址未配置"，**不得**编造链接。
  //      ⚠️ **不**种编造的"新版本号/包体积/功能亮点"（改前的 mock 正是那样，已删除）。
  //      目的：「检查更新」去问**我们自己的后端**（真实请求、真实数据、真实比较），
  //            而不是弹一个写死的提示框。
  //      ⚠️ 它**不等于**与原版一致：原版「立即更新」的真实去向未观察（点它可能触发真实
  //         下载 ⇒ 只读约束下 BLOCKED_BY_POLICY）⇒ ORIGINAL_UPDATE_FLOW: NOT_EVALUATED。
  { version: '014_app_release', sql: appReleaseSql },

  // 015：发布 1.1 并托管**真实**安装包（WO#23 收尾；Owner 裁定 ③）
  //      ⚠️ 用**迁移**而不是直接 UPDATE 库：凡"需长期成立的状态"都要能从仓库重建 ——
  //         本项目刚因 nginx 配置 drift（仓库 23 行 / 服务器 99 行）吃过一次亏。
  //      · latest_version='1.1' 与 app/src/version.ts 的 APP_VERSION 和 android
  //        versionName **一致**（一致性由门禁机械校验）
  //      · apk_url 指向我们**自己构建并托管**的 APK（Nginx /download/ 静态下发）
  //        ⚠️ 刻意用 **http**：线上是私有 CA 自签证书，APK 下载会被证书告警挡住；
  //           80 端口在同一份 locations 配置里可用 ⇒ 这是**已知取舍**，不是疏忽。
  { version: '015_release_1_1', sql: release11Sql },

  // 016：BJTU TimeMap P0（F01–F07）—— 用户角色、地点分类/启用/简介/校史、
  //      帖子状态（下架同步）与幂等键、收藏、评论状态、地点老照片、活动、举报、操作记录，
  //      以及北交大首批 10 个地点 / 3 张老照片（演示素材）/ 6 条活动的种子。
  //      数据来源与合规标注见该文件头部注释。
  { version: '016_timemap_p0', sql: timemapP0Sql },

  // 017：为**管理员**恢复密码凭据（users.password_hash，可空；学生恒 NULL）。
  //      原因与边界见迁移头部：短信通道故障时管理端必须仍可达，
  //      而"凭据唯一化到一条依赖第三方通道的路径"等于给管理能力绑了单点故障。
  { version: '017_admin_password', sql: adminPasswordSql },

  // 018：发布 App 1.2（自更新清单指向我们自己构建并托管的 campus-demo-1.2.apk）。
  //      ⚠️ 发布纪律：**先**上传 APK 并校验 sha256 / HTTP 200 / Content-Type，
  //         **再**执行本迁移；反过来会出现"清单说 1.2、点下载 404"的假发布。
  { version: '018_release_1_2', sql: release12Sql },
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
    /*
      ⚠️ M5 X3（审核记录 55 的 DO NOW 项）：**不要把错误丢掉**。
        原先这里是 `} catch { return false }` —— 错误被**完全吞掉**，
        于是日志只说得出 `[migrate] retryable: database unreachable`，
        **没有 SQLSTATE、没有 code、没有 message**。
        而审核 55 明确要求："记录启动期间的**精确 DB 连接错误 / SQLSTATE**"，
        并特别提醒：`max_connections=15 且 used=10` 很紧，但**必须有实际的
        SQLSTATE / connection error 才能说是"连接耗尽"**（不能靠数字推断）。
        → 因此这里把 pg 的错误字段取出来存进 `state.lastError`，让启动期失败**可归因**。
        注意：这**只是记录**，不改变任何重试/判定行为（审核 55：先记录事实，不先调参数）。

      ⚠️ 实现形态：**由这个 IIFE 直接 return 结果**，而不是去改一个外层变量。
        我第一版写成 `let probeErr = null` + 在 catch 里 `probeErr = {...}`，
        结果 tsc 报 6 个 `Property 'x' does not exist on type 'never'` ——
        因为**外层控制流分析看不到嵌套函数里发生的赋值**，
        于是把 probeErr 一路收窄成 `null`（真值分支里就变成 `never`）。
        → 改成 return 结构后，类型完全确定，不需要任何断言。
    */
    type PgErrInfo = {
      code?: string
      errno?: string
      syscall?: string
      address?: string
      port?: number
      message?: string
    }
    const probe = await (async (): Promise<{ up: boolean; err: PgErrInfo | null }> => {
      try {
        await pool.query('select 1')
        return { up: true, err: null }
      } catch (raw) {
        const e = raw as PgErrInfo
        return {
          up: false,
          err: {
            code: e?.code,
            errno: e?.errno,
            syscall: e?.syscall,
            address: e?.address,
            port: e?.port,
            message: e?.message,
          },
        }
      }
    })()
    const up = probe.up
    state.dbUp = up
    state.applied = up ? await appliedCount() : 0

    if (!up) {
      state.state = 'retryable'
      // 把可归因的字段拼进来；缺哪个就写 <none>，**不要**用空串掩盖"没取到"
      const e = probe.err
      const detail = e
        ? `code=${e.code ?? '<none>'} errno=${e.errno ?? '<none>'} syscall=${e.syscall ?? '<none>'} address=${e.address ?? '<none>'}:${e.port ?? '<none>'} message=${e.message ?? '<none>'}`
        : 'code=<none>（探针未捕获到错误对象）'
      state.lastError = `database unreachable: ${detail}`
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
