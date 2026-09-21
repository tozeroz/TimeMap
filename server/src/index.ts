import { createHash, randomBytes, randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import {
  createRateLimiter,
  hashLoginCode,
  newLoginCode,
  normalizePhone,
  safeEqualHex,
} from './auth.ts'
import { DEFAULT_CORS_ORIGINS, loadConfig } from './config.ts'
import { createDb, type Db } from './db.ts'
import { createDevSink, type DevSink } from './devSink.ts'

/**
 * Campus 后端（M3 Slice 0B）。
 *
 * 健康检查刻意分成三个语义（审核要求，不许用一个 /health 假装证明三件事）：
 *   GET /health      —— Nginx 直接返回，证明「网关活着」（不在本进程里实现）
 *   GET /api/health  —— liveness：本进程活着
 *   GET /api/ready   —— readiness：能连 PG **且** schema 已就绪；不满足返回 503
 *
 * **M3 起所有依赖数据库 schema 的业务路由在就绪之前统一返回 503**（审核记录 08 第 3 点）：
 * 服务是"先 listen、再后台迁移"的，如果不拦，半迁移期间业务 API 会拿着旧 schema 发 SQL ——
 * 那比 connection refused 更危险（看起来在正常服务，实则数据可能是错的）。
 *
 * 登录方式（M3 Slice 0B，依据实测的原版语义）：
 *   只有「手机号 + 一次性验证码」一条公开路径。
 *   M2 的 handle + password 已按审核裁定**退休**（原版没有密码登录）。
 *   session 机制完全沿用 M2：不透明 token、库里只存 SHA-256(token)、过期、撤销、Bearer。
 */

const BODY_MAX = 500
const PLACE_MAX = 60
const DISPLAY_MAX = 40
const LIST_LIMIT = 50

/** POST /api/posts 只接受这两个字段，多一个就 400 */
const POST_ALLOWED_KEYS = ['body', 'place'] as const

/** 就绪之前也放行的路径：它们本身就是用来"报告状态"的 */
const READINESS_EXEMPT = new Set(['/api/health', '/api/ready'])

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
}

export interface ServerDeps {
  db: Db
  defaultAuthorName: string
  corsOrigins?: string[]
  sessionTtlDays: number
  loginCodeHmacKey: string
  loginCodeTtlSeconds: number
  loginRequestMax: number
  loginVerifyMaxAttempts: number
  loginWindowSeconds: number
  devSink: DevSink
  trustProxy?: string
}

export function buildServer(deps: ServerDeps) {
  const app = Fastify({
    logger: false,
    // 只信任本机反代
    trustProxy: deps.trustProxy ?? '127.0.0.1',
  })

  const { db } = deps
  /**
   * CORS 白名单（默认值来自 config.ts 的 DEFAULT_CORS_ORIGINS，可被环境变量 CORS_ORIGINS 覆盖）：
   *   - Capacitor APK 里的 WebView：https://localhost
   *   - 本地浏览器预览：http://127.0.0.1:517x
   * 用白名单而不是 `*`：以后接真实域名时不会留下过宽策略。
   */
  const allowed = new Set(deps.corsOrigins ?? DEFAULT_CORS_ORIGINS)

  /** 请求验证码的限流（按 手机号+IP） */
  const requestLimiter = createRateLimiter(deps.loginRequestMax, deps.loginWindowSeconds * 1000)
  /** 校验验证码失败的限流（按 手机号） */
  const verifyLimiter = createRateLimiter(deps.loginVerifyMaxAttempts, deps.loginWindowSeconds * 1000)

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
      return
    }

    /**
     * 就绪门禁：schema 没就绪之前，业务路由一律 503。
     * 这条与 /api/ready 使用**同一个**状态源（db.status()），不存在两套判断。
     */
    const path = req.url.split('?')[0] ?? ''
    if (path.startsWith('/api/') && !READINESS_EXEMPT.has(path)) {
      const st = db.status()
      if (!st.ready) {
        reply.code(503)
        reply.header('retry-after', '5')
        reply.send({
          error: 'not_ready',
          reason: st.state, // pending | retryable | terminal
          detail: st.lastError,
          migrations: { applied: st.applied, expected: st.expected },
        })
      }
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
    phone: string | null
  }

  /**
   * 会话解析的三种结果。
   *
   * 必须区分 `db_down` 与 `none`：数据库不可用时返回 401 会把"后端故障"
   * 说成"你没登录"，客户端会去走登录流程（而且登录也必然失败），排障时也被误导。
   */
  type SessionResult =
    | { kind: 'ok'; user: SessionUser }
    | { kind: 'none' }
    | { kind: 'db_down' }

  /**
   * 从 Authorization: Bearer <token> 解析出会话用户。
   * 解析失败**不区分**"没带/格式错/过期/已撤销"，避免泄漏会话状态。
   */
  async function resolveSession(authHeader: unknown): Promise<SessionResult> {
    if (typeof authHeader !== 'string') return { kind: 'none' }
    const m = /^Bearer\s+(\S+)$/i.exec(authHeader.trim())
    if (!m) return { kind: 'none' }
    const token = m[1]!
    if (token.length < 20 || token.length > 200) return { kind: 'none' }
    try {
      const r = await db.pool.query<{
        session_id: string
        user_id: string
        handle: string
        display_name: string
        phone_e164: string | null
      }>(
        `select s.id as session_id, u.id as user_id, u.handle, u.display_name, u.phone_e164
           from sessions s
           join users u on u.id = s.user_id
          where s.token_hash = $1
            and s.revoked_at is null
            and s.expires_at > now()`,
        [tokenHash(token)],
      )
      const row = r.rows[0]
      if (!row) return { kind: 'none' }
      return {
        kind: 'ok',
        user: {
          sessionId: row.session_id,
          userId: row.user_id,
          handle: row.handle,
          displayName: row.display_name,
          phone: row.phone_e164,
        },
      }
    } catch (err) {
      console.error('[auth] session lookup failed:', (err as Error).message)
      // 连接层错误 → 这是"后端不可用"，不是"未认证"
      db.noteFailure(err)
      return { kind: 'db_down' }
    }
  }

  function unauthorized(reply: { code: (n: number) => unknown }) {
    reply.code(401)
    return { error: 'unauthorized' }
  }

  /** 数据库暂时不可用时的统一响应（503，而不是 500/401） */
  function dbUnavailable(reply: { code: (n: number) => unknown; header: (k: string, v: string) => unknown }, err: unknown) {
    const st = db.status()
    reply.code(503)
    reply.header('retry-after', '5')
    return {
      error: 'not_ready',
      reason: st.state,
      detail: st.lastError ?? (err as Error).message,
      migrations: { applied: st.applied, expected: st.expected },
    }
  }

  // -------------------------------------------------------------------------
  // 健康检查
  // -------------------------------------------------------------------------

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'campus-api',
    stage: 'M3',
    uptime_s: Math.round(process.uptime()),
    // liveness 只说明"进程活着"；schema 状态放这里是为了排障方便，不代表它就绪
    schema_state: db.status().state,
  }))

  app.get('/api/ready', async (_req, reply) => {
    const st = await db.refresh()
    reply.code(st.ready ? 200 : 503)
    return {
      status: st.ready ? 'ready' : 'not_ready',
      db: st.dbUp ? 'up' : 'down',
      migrations: { applied: st.applied, expected: st.expected },
      schema_state: st.state,
      detail: st.lastError,
    }
  })

  // -------------------------------------------------------------------------
  // 登录：手机号 + 一次性验证码（唯一公开路径）
  // -------------------------------------------------------------------------

  app.post('/api/auth/request-code', async (req, reply) => {
    // 密钥缺失 → 失败关闭。绝不退化成"没有密钥也能登录"。
    if (!deps.loginCodeHmacKey) {
      reply.code(503)
      return { error: 'login_disabled', reason: 'LOGIN_CODE_HMAC_KEY 未配置' }
    }

    const payload = (req.body ?? {}) as Record<string, unknown>
    const phoneRaw = typeof payload.phone === 'string' ? payload.phone : ''
    const phone = normalizePhone(phoneRaw)
    if (!phone) {
      reply.code(400)
      return { error: 'invalid_phone', details: ['手机号格式不正确（仅支持中国大陆 +86，且需 1[3-9] 开头）'] }
    }

    const limitKey = `${req.ip}|${phone}`
    const limited = requestLimiter.hit(limitKey)
    if (limited.limited) {
      reply.header('retry-after', String(limited.retryAfterS))
      reply.code(429)
      return { error: 'too_many_requests', retryAfterS: limited.retryAfterS }
    }
    requestLimiter.fail(limitKey)

    const code = newLoginCode()
    const expiresAt = new Date(Date.now() + deps.loginCodeTtlSeconds * 1000)
    try {
      await db.pool.query(
        `insert into login_challenges (id, phone_e164, code_hmac, expires_at)
         values ($1, $2, $3, $4)`,
        [randomUUID(), phone, hashLoginCode(deps.loginCodeHmacKey, phone, code), expiresAt],
      )
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }

    /**
     * 投递：本项目**没有短信通道**，因此走 dev sink（独立目录，tmpfs 优先）。
     * 注意：**绝不把验证码写进日志**（审核记录 08 第 2 点）。
     */
    let sinkPath = ''
    try {
      sinkPath = deps.devSink.deliver(phone, code, expiresAt)
    } catch (err) {
      reply.code(503)
      return { error: 'delivery_unavailable', reason: (err as Error).message }
    }

    return {
      ok: true,
      phone,
      expiresAt: expiresAt.toISOString(),
      // 明确告诉调用方：没有短信通道，码在哪取
      delivery: 'dev-sink',
      delivery_note: 'SMS_GATEWAY_NOT_INTEGRATED：无短信通道，验证码投递到 dev sink',
      sink: sinkPath,
    }
  })

  app.post('/api/auth/verify-code', async (req, reply) => {
    if (!deps.loginCodeHmacKey) {
      reply.code(503)
      return { error: 'login_disabled', reason: 'LOGIN_CODE_HMAC_KEY 未配置' }
    }
    const payload = (req.body ?? {}) as Record<string, unknown>
    const phoneRaw = typeof payload.phone === 'string' ? payload.phone : ''
    const code = typeof payload.code === 'string' ? payload.code.trim() : ''
    const phone = normalizePhone(phoneRaw)
    if (!phone || !/^\d{6}$/.test(code)) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['需要合法的手机号与 6 位验证码'] }
    }

    const limitKey = phone
    const limited = verifyLimiter.hit(limitKey)
    if (limited.limited) {
      reply.header('retry-after', String(limited.retryAfterS))
      reply.code(429)
      return { error: 'too_many_attempts', retryAfterS: limited.retryAfterS }
    }

    type ChallengeRow = { id: string; code_hmac: string; attempts: number }
    let challenge: ChallengeRow | undefined
    try {
      const r = await db.pool.query<ChallengeRow>(
        `select id, code_hmac, attempts
           from login_challenges
          where phone_e164 = $1
            and consumed_at is null
            and expires_at > now()
          order by created_at desc
          limit 1`,
        [phone],
      )
      challenge = r.rows[0]
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }

    // 没有可用挑战：与"码错了"用同一个响应，避免泄漏"这个号有没有在登录"
    if (!challenge) {
      verifyLimiter.fail(limitKey)
      reply.code(401)
      return { error: 'invalid_code' }
    }

    const expected = hashLoginCode(deps.loginCodeHmacKey, phone, code)
    const ok = safeEqualHex(expected, challenge.code_hmac)
    if (!ok) {
      // 失败计数落库：即使进程重启也不能重置穷举进度
      try {
        await db.pool.query('update login_challenges set attempts = attempts + 1 where id = $1', [
          challenge.id,
        ])
      } catch {
        /* 计数失败不影响本次判定 */
      }
      verifyLimiter.fail(limitKey)
      reply.code(401)
      return { error: 'invalid_code' }
    }

    // 一次性消费：同一个码不能用第二次
    try {
      await db.pool.query(
        'update login_challenges set consumed_at = now() where id = $1 and consumed_at is null',
        [challenge.id],
      )
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }

    // 登录即注册（原版是"手机号验证码登录"，没有单独的注册页）
    let user: UserRow | undefined
    try {
      const r = await db.pool.query<UserRow>(
        'select id, handle, display_name from users where phone_e164 = $1',
        [phone],
      )
      user = r.rows[0]
      if (!user) {
        const id = randomUUID()
        // 昵称走 onboarding 页设置（原版有 login/onboarding）；这里给一个明确的占位名
        const placeholder = `校园用户${phone.slice(-4)}`
        const r2 = await db.pool.query<UserRow>(
          `insert into users (id, handle, display_name, phone_e164)
           values ($1, $2, $3, $4)
           returning id, handle, display_name`,
          [id, placeholder, placeholder, phone],
        )
        user = r2.rows[0]!
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }

    verifyLimiter.reset(limitKey)

    const token = newSessionToken()
    const expiresAt = new Date(Date.now() + deps.sessionTtlDays * 24 * 60 * 60 * 1000)
    try {
      await db.pool.query(
        `insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, $4)`,
        [randomUUID(), user.id, tokenHash(token), expiresAt],
      )
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, handle: user.handle, displayName: user.display_name, phone },
    }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    try {
      await db.pool.query(
        'update sessions set revoked_at = now() where id = $1 and revoked_at is null',
        [s.user.sessionId],
      )
    } catch (err) {
      db.noteFailure(err)
      return dbUnavailable(reply, err)
    }
    reply.code(204)
    return null
  })

  app.get('/api/auth/me', async (req, reply) => {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    return {
      id: s.user.userId,
      handle: s.user.handle,
      displayName: s.user.displayName,
      phone: s.user.phone,
    }
  })

  /**
   * **已退休**：M2 的 handle + password 登录。
   *
   * 原版登录页实测**没有密码**（只有手机号 + 验证码），所以这条路不是"暂时关掉"，
   * 而是"这个产品里不存在"。审核记录 08 明确要求不保留两个公开登录路径。
   * 这里显式保留一个拒绝分支，是为了让"有人试图走老路"时有一个**明确**的答案，
   * 而不是一个含糊的 404 让人以为路径写错了。
   */
  app.post('/api/auth/login', async (_req, reply) => {
    reply.code(410)
    return {
      error: 'gone',
      reason: '密码登录已退休：本产品的登录方式只有「手机号 + 一次性验证码」（见 /api/auth/request-code）',
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
      // 连接层错误 → 立刻把就绪状态降级并返回 503；
      // 只有真正的查询错误（比如 SQL 写错）才是 500
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.post('/api/posts', async (req, reply) => {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    const session = s.user

    const payload = (req.body ?? {}) as Record<string, unknown>

    // strict schema：只允许 body/place。
    // 这样 author / authorId / user_id 之类的字段会直接 400，而不是被静默忽略 ——
    // 归属问题必须可以被机械验证。
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
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  return app
}

/**
 * 会话 token 的库内表示（与 M2 一致：只存 SHA-256，不存明文）。
 *
 * 注意它与验证码的区别，这是有意的：
 *   - **session token**：本身是 256-bit 随机数（高熵）→ 裸 SHA-256 足够；
 *   - **验证码**：只有 6 位（低熵）→ 必须用带服务端密钥的 HMAC（见 auth.ts 的 hashLoginCode）。
 */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 生成 256-bit 不透明 token（与 M2 一致） */
function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 进程入口：先 listen（liveness 立刻可用）→ 后台迁移（失败按错误性质决定是否重试） */
async function main() {
  const cfg = loadConfig()
  const db = createDb(cfg)
  const devSink = createDevSink(cfg.loginCodeSink)

  if (!cfg.loginCodeHmacKey) {
    console.error(
      '[config] LOGIN_CODE_HMAC_KEY 未配置：验证码相关接口会失败关闭(503)。' +
        '请在 server.env 中配置（由 tools/deploy-server.ps1 生成）。',
    )
  }

  const app = buildServer({
    db,
    defaultAuthorName: cfg.defaultAuthorName,
    corsOrigins: cfg.corsOrigins,
    sessionTtlDays: cfg.sessionTtlDays,
    loginCodeHmacKey: cfg.loginCodeHmacKey,
    loginCodeTtlSeconds: cfg.loginCodeTtlSeconds,
    loginRequestMax: cfg.loginRequestMax,
    loginVerifyMaxAttempts: cfg.loginVerifyMaxAttempts,
    loginWindowSeconds: cfg.loginWindowSeconds,
    devSink,
    trustProxy: cfg.trustProxy,
  })

  let migrateTimer: NodeJS.Timeout | null = null

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal}`)
    if (migrateTimer) clearInterval(migrateTimer)
    await app.close().catch(() => undefined)
    await db.close().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  /**
   * **先 listen，再在后台跑迁移**（顺序很重要，改过一次）。
   *
   * 原来是 `await migrate()` 在 `app.listen()` 之前。实测踩到：PG 一时连不上时，
   * 迁移里的 `pool.connect()` 会耗掉几十秒，于是进程**根本不监听** ——
   * 外部看到 "connection refused"（像进程死了），而不是「进程活着、但没就绪」。
   * 这与刻意做的 liveness / readiness 语义分离直接矛盾。
   *
   * 现在：liveness 立刻可用；schema 没就绪时 /api/ready 与**所有业务路由**都返回 503。
   */
  await app.listen({ host: cfg.host, port: cfg.port })
  console.log(`[listen] http://${cfg.host}:${cfg.port}`)

  const runMigrate = async (): Promise<void> => {
    const st = await db.refresh()
    if (st.ready) {
      if (migrateTimer) {
        clearInterval(migrateTimer)
        migrateTimer = null
      }
      console.log(`[migrate] ready applied=${st.applied}/${st.expected}`)
      return
    }
    if (st.state === 'terminal') {
      // 终态：**不再重试**。刷日志循环既没用、又会掩盖真正需要人修的问题。
      if (migrateTimer) {
        clearInterval(migrateTimer)
        migrateTimer = null
      }
      console.error('[migrate] terminal state, retries stopped:', st.lastError)
      return
    }
    console.error(`[migrate] ${st.state}:`, st.lastError ?? '(no detail)')
  }

  void (async () => {
    await runMigrate()
    const st = db.status()
    if (!st.ready && st.state !== 'terminal') {
      // 只有**暂时性**问题才安排重试
      migrateTimer = setInterval(() => {
        void runMigrate()
      }, 10_000)
      migrateTimer.unref?.()
    }

    /**
     * 健康心跳：即使没有任何业务流量，也定期刷新一次数据库状态。
     *
     * 为什么需要：就绪状态决定业务路由是放行还是 503。
     * 只靠"请求打进来才发现库挂了"的话，PG 恢复之后会一直卡在 not_ready 直到有人来敲门。
     * 这个心跳同时负责"故障时降级"与"恢复时自愈"，代价是每 10 秒一次 select 1。
     */
    let wasReady = st.ready
    const heartbeat = setInterval(() => {
      void db.refresh().then((s) => {
        if (s.ready !== wasReady) {
          console.log(`[health] ready: ${wasReady} -> ${s.ready} (state=${s.state})`)
          wasReady = s.ready
        }
      })
    }, 10_000)
    heartbeat.unref?.()
  })()
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
