import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import {
  createRateLimiter,
  getDummyHash,
  hashPassword,
  hashToken,
  newSessionToken,
  normalizeHandle,
  verifyPassword,
} from './auth.ts'
import { DEFAULT_CORS_ORIGINS, loadConfig } from './config.ts'
import { createDb, MIGRATIONS, type Db } from './db.ts'

/**
 * Campus 后端（M2）。
 *
 * 健康检查刻意分成三个语义（审核要求，不许用一个 /health 假装证明三件事）：
 *   GET /health      —— Nginx 直接返回，证明「网关活着」（不在本进程里实现）
 *   GET /api/health  —— liveness：本进程活着
 *   GET /api/ready   —— readiness：能连 PG **且** schema 已就绪；不满足返回 503
 *
 * 业务：
 *   - 认证：login / logout / me（不透明 session token，见 auth.ts）
 *   - 帖子：读（匿名）+ 写（必须带会话；作者只能来自服务端）
 *
 * **M2 的核心不变量：客户端不能选择帖子的归属。**
 * 任何试图在请求体里塞 author / authorId / user_id 的请求都会被 strict 400 拒绝，
 * 而不是"忽略该字段"——静默忽略看起来更宽容，但会让"客户端到底能不能影响归属"变得不可机械验证。
 */

const BODY_MAX = 500
const PLACE_MAX = 60
const HANDLE_MAX = 40
const DISPLAY_MAX = 40
const PASSWORD_MIN = 8
const PASSWORD_MAX = 200
const LIST_LIMIT = 50

/** POST /api/posts 只接受这两个字段，多一个就 400 */
const POST_ALLOWED_KEYS = ['body', 'place'] as const

interface PostRow {
  id: string
  author_name: string
  author_id: string | null
  body: string
  place: string | null
  created_at: Date
}

interface UserRow {
  id: string
  handle: string
  display_name: string
  password_hash: string
}

export interface ServerDeps {
  db: Db
  defaultAuthorName: string
  corsOrigins?: string[]
  sessionTtlDays: number
  loginMaxFailures: number
  loginWindowSeconds: number
}

export function buildServer(deps: ServerDeps) {
  const app = Fastify({
    logger: false,
    // 只信任本机反代
    trustProxy: '127.0.0.1',
  })

  const { db } = deps
  /**
   * CORS 白名单（默认值来自 config.ts 的 DEFAULT_CORS_ORIGINS，可被环境变量 CORS_ORIGINS 覆盖）：
   *   - Capacitor APK 里的 WebView：https://localhost
   *   - 本地浏览器预览：http://127.0.0.1:517x
   * 用白名单而不是 `*`：以后接真实域名时不会留下过宽策略。
   * 注意：M2 之后即使换成 HTTPS 也不能删——来源仍然不同。
   */
  const allowed = new Set(deps.corsOrigins ?? DEFAULT_CORS_ORIGINS)

  const loginLimiter = createRateLimiter(
    deps.loginMaxFailures,
    deps.loginWindowSeconds * 1000,
  )

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (typeof origin === 'string' && allowed.has(origin)) {
      reply.header('access-control-allow-origin', origin)
      reply.header('vary', 'Origin')
      reply.header('access-control-allow-methods', 'GET,POST,OPTIONS')
      reply.header('access-control-allow-headers', 'content-type,authorization')
      reply.header('access-control-max-age', '600')
    }
    if (req.method === 'OPTIONS') {
      reply.code(204).send()
    }
  })

  // -------------------------------------------------------------------------
  // 会话解析
  // -------------------------------------------------------------------------

  interface SessionUser {
    sessionId: string
    userId: string
    handle: string
    displayName: string
  }

  /**
   * 从 Authorization: Bearer <token> 解析出会话用户。
   * 失败一律返回 null，由调用方决定返回 401；**不区分**"没带 token""格式错""过期""已撤销"，
   * 避免把会话状态泄漏给客户端。
   */
  async function resolveSession(authHeader: unknown): Promise<SessionUser | null> {
    if (typeof authHeader !== 'string') return null
    const m = /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
    if (!m) return null
    const token = m[1]!
    if (token.length < 20 || token.length > 200) return null
    try {
      const r = await db.pool.query<{
        session_id: string
        user_id: string
        handle: string
        display_name: string
      }>(
        `select s.id as session_id, u.id as user_id, u.handle, u.display_name
           from sessions s
           join users u on u.id = s.user_id
          where s.token_hash = $1
            and s.revoked_at is null
            and s.expires_at > now()`,
        [hashToken(token)],
      )
      const row = r.rows[0]
      if (!row) return null
      return {
        sessionId: row.session_id,
        userId: row.user_id,
        handle: row.handle,
        displayName: row.display_name,
      }
    } catch (err) {
      console.error('[auth] session lookup failed:', (err as Error).message)
      return null
    }
  }

  /** 统一的 401 响应（不区分"没带/格式错/过期/已撤销"，避免泄漏会话状态） */
  function unauthorized(reply: { code: (n: number) => unknown }) {
    reply.code(401)
    return { error: 'unauthorized' }
  }

  // -------------------------------------------------------------------------
  // 健康检查
  // -------------------------------------------------------------------------

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'campus-api',
    stage: 'M2',
    uptime_s: Math.round(process.uptime()),
  }))

  app.get('/api/ready', async (_req, reply) => {
    const dbOk = await db.ping()
    const applied = dbOk ? await db.appliedMigrationCount() : -1
    const expected = MIGRATIONS.length
    const ready = dbOk && applied === expected
    reply.code(ready ? 200 : 503)
    return {
      status: ready ? 'ready' : 'not_ready',
      db: dbOk ? 'up' : 'down',
      migrations: { applied, expected },
    }
  })

  // -------------------------------------------------------------------------
  // 认证（M2.1 契约，只有这三个接口）
  // -------------------------------------------------------------------------

  app.post('/api/auth/login', async (req, reply) => {
    const payload = (req.body ?? {}) as Record<string, unknown>
    const handleRaw = typeof payload.handle === 'string' ? payload.handle : ''
    const password = typeof payload.password === 'string' ? payload.password : ''

    if (!handleRaw.trim() || !password) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['handle 与 password 必填'] }
    }
    if (handleRaw.length > HANDLE_MAX) {
      reply.code(400)
      return { error: 'invalid_payload', details: [`handle 不能超过 ${HANDLE_MAX} 字`] }
    }

    const handle = normalizeHandle(handleRaw)
    // 限流键带 IP：只按 handle 限流会被"换 handle 撞库"绕过
    const limitKey = `${req.ip}|${handle}`
    const limited = loginLimiter.hit(limitKey)
    if (limited.limited) {
      reply.header('retry-after', String(limited.retryAfterS))
      reply.code(429)
      return { error: 'too_many_attempts', retryAfterS: limited.retryAfterS }
    }

    let user: UserRow | undefined
    try {
      const r = await db.pool.query<UserRow>(
        'select id, handle, display_name, password_hash from users where lower(handle) = $1',
        [handle],
      )
      user = r.rows[0]
    } catch (err) {
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }

    // 关键：用户不存在时也要跑一次参数完全相同的 scrypt，
    // 否则耗时差异可以枚举出哪些 handle 存在（仅统一错误文案是不够的）。
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, await getDummyHash())

    if (!ok || !user) {
      loginLimiter.fail(limitKey)
      reply.code(401)
      return { error: 'invalid_credentials' }
    }

    loginLimiter.reset(limitKey)

    const token = newSessionToken()
    const expiresAt = new Date(Date.now() + deps.sessionTtlDays * 24 * 60 * 60 * 1000)
    try {
      await db.pool.query(
        `insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, $4)`,
        [randomUUID(), user.id, hashToken(token), expiresAt],
      )
    } catch (err) {
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, handle: user.handle, displayName: user.display_name },
    }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const session = await resolveSession(req.headers.authorization)
    if (!session) return unauthorized(reply)
    try {
      await db.pool.query(
        'update sessions set revoked_at = now() where id = $1 and revoked_at is null',
        [session.sessionId],
      )
    } catch (err) {
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
    reply.code(204)
    return null
  })

  app.get('/api/auth/me', async (req, reply) => {
    const session = await resolveSession(req.headers.authorization)
    if (!session) return unauthorized(reply)
    return {
      id: session.userId,
      handle: session.handle,
      displayName: session.displayName,
    }
  })

  // -------------------------------------------------------------------------
  // 帖子
  // -------------------------------------------------------------------------

  app.get('/api/posts', async (_req, reply) => {
    try {
      const r = await db.pool.query<PostRow>(
        `select id, author_name, author_id, body, place, created_at
           from posts
          order by created_at desc, id desc
          limit $1`,
        [LIST_LIMIT],
      )
      return {
        items: r.rows.map((row) => ({
          id: row.id,
          author: row.author_name,
          // M1 历史帖子为 null（当时没有可信身份，不伪造归属）
          authorId: row.author_id,
          body: row.body,
          place: row.place,
          createdAt: row.created_at.toISOString(),
        })),
      }
    } catch (err) {
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.post('/api/posts', async (req, reply) => {
    const session = await resolveSession(req.headers.authorization)
    if (!session) return unauthorized(reply)

    const payload = (req.body ?? {}) as Record<string, unknown>

    // strict schema：只允许 body/place。
    // 这样 author / authorId / user_id 之类的字段会直接 400，
    // 而不是被静默忽略 —— 归属问题必须可以被机械验证。
    const extra = Object.keys(payload).filter(
      (k) => !(POST_ALLOWED_KEYS as readonly string[]).includes(k),
    )
    if (extra.length) {
      reply.code(400)
      return {
        error: 'invalid_payload',
        details: [`不支持字段: ${extra.join(', ')}（作者由服务端会话决定）`],
      }
    }

    const body = typeof payload.body === 'string' ? payload.body.trim() : ''
    const placeRaw = typeof payload.place === 'string' ? payload.place.trim() : ''

    const errors: string[] = []
    if (!body) errors.push('body 不能为空')
    else if (body.length > BODY_MAX) errors.push(`body 不能超过 ${BODY_MAX} 字`)
    if (placeRaw.length > PLACE_MAX) errors.push(`place 不能超过 ${PLACE_MAX} 字`)
    if (errors.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: errors }
    }

    const id = randomUUID()
    const place = placeRaw || null

    try {
      // 作者完全来自服务端会话；author_name 存为快照（用户以后改名也保留当时的展示名）
      const r = await db.pool.query<PostRow>(
        `insert into posts (id, author_name, author_id, body, place)
         values ($1, $2, $3, $4, $5)
         returning id, author_name, author_id, body, place, created_at`,
        [id, session.displayName.slice(0, DISPLAY_MAX), session.userId, body, place],
      )
      const row = r.rows[0]!
      reply.code(201)
      return {
        id: row.id,
        author: row.author_name,
        authorId: row.author_id,
        body: row.body,
        place: row.place,
        createdAt: row.created_at.toISOString(),
      }
    } catch (err) {
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // 仅用于本地/演练环境造账号；生产形态下由 seed 或运维显式创建
  app.post('/api/auth/dev-register', async (req, reply) => {
    if (process.env.ENABLE_DEV_REGISTER !== '1') {
      reply.code(404)
      return { error: 'not_found' }
    }
    const payload = (req.body ?? {}) as Record<string, unknown>
    const handleRaw = typeof payload.handle === 'string' ? payload.handle : ''
    const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : ''
    const password = typeof payload.password === 'string' ? payload.password : ''
    const errors: string[] = []
    if (!handleRaw.trim()) errors.push('handle 必填')
    if (handleRaw.length > HANDLE_MAX) errors.push(`handle 不能超过 ${HANDLE_MAX} 字`)
    if (!displayName) errors.push('displayName 必填')
    if (displayName.length > DISPLAY_MAX) errors.push(`displayName 不能超过 ${DISPLAY_MAX} 字`)
    if (password.length < PASSWORD_MIN) errors.push(`password 至少 ${PASSWORD_MIN} 位`)
    if (password.length > PASSWORD_MAX) errors.push(`password 不能超过 ${PASSWORD_MAX} 位`)
    if (errors.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: errors }
    }
    const handle = normalizeHandle(handleRaw)
    try {
      const exists = await db.pool.query('select 1 from users where lower(handle) = $1', [handle])
      if (exists.rowCount) {
        reply.code(409)
        return { error: 'handle_taken' }
      }
      const id = randomUUID()
      const hash = await hashPassword(password)
      await db.pool.query(
        `insert into users (id, handle, display_name, password_hash) values ($1, $2, $3, $4)`,
        [id, handleRaw.trim(), displayName, hash],
      )
      reply.code(201)
      return { id, handle: handleRaw.trim(), displayName }
    } catch (err) {
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  return app
}

/** 进程入口：跑迁移 → 起服务 */
async function main() {
  const cfg = loadConfig()
  const db = createDb(cfg)

  /**
   * 迁移失败**不能**让进程退出。
   * 原因：readiness 的语义是「能连 PG 且 schema 就绪，否则返回 503」——
   * 如果 PG 挂了进程就直接死，运维看到的是"连不上"，而不是一个明确说 503 的实例，
   * Gate 里的「停掉 PG → /api/ready 必须 503」也就无从验证。
   * 所以这里只报错并后台重试；schema 晚到也能自愈。
   */
  let migrateTimer: NodeJS.Timeout | null = null
  let migrated = false
  const tryMigrate = async (): Promise<void> => {
    try {
      const result = await db.migrate()
      if (result.applied.length) {
        console.log(`[migrate] applied=${result.applied.join(',')} skipped=${result.skipped.length}`)
      }
      migrated = true
      if (migrateTimer) {
        clearInterval(migrateTimer)
        migrateTimer = null
      }
    } catch (err) {
      console.error('[migrate] failed (will retry):', (err as Error).message)
    }
  }
  await tryMigrate()
  if (!migrated) {
    // 首次失败才起重试定时器；成功后自动停掉，不会一直空转
    migrateTimer = setInterval(() => {
      void tryMigrate()
    }, 10_000)
    migrateTimer.unref?.()
  }

  const app = buildServer({
    db,
    defaultAuthorName: cfg.defaultAuthorName,
    corsOrigins: cfg.corsOrigins,
    sessionTtlDays: cfg.sessionTtlDays,
    loginMaxFailures: cfg.loginMaxFailures,
    loginWindowSeconds: cfg.loginWindowSeconds,
  })

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal}`)
    if (migrateTimer) clearInterval(migrateTimer)
    await app.close().catch(() => undefined)
    await db.close().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ host: cfg.host, port: cfg.port })
  console.log(`[listen] http://${cfg.host}:${cfg.port}`)
}

// 仅在被当作入口执行时启动（import 时不启动，方便测试）
const isEntry =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
if (isEntry) {
  main().catch((err) => {
    console.error('[fatal]', err)
    process.exit(1)
  })
}
