import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, rename, statfs, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import multipart, { type MultipartFile } from '@fastify/multipart'
import Fastify from 'fastify'
import { probeImage } from './imageProbe.ts'
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
import { acquireMediaMutationLock, isBarrierTimeout } from './mutationBarrier.ts'

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
const COMMENT_MAX = 500
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

  /**
   * 备份窗口（media mutation barrier）把写操作挡在门外时的统一响应。
   *
   * 刻意**不是 500**：这不是"出错了"，而是"现在不行、稍后重试就行"——
   * 客户端（以及 Gate 的竞争条件测试）据此能区分"屏障生效"与"后端真的坏了"。
   * Retry-After 取 5 秒，与 mutationBarrier 里的 lock_timeout 同一量级。
   */
  function backupBarrierUnavailable(reply: {
    code: (n: number) => unknown
    header: (k: string, v: string) => unknown
  }) {
    reply.code(503)
    reply.header('retry-after', '5')
    return {
      error: 'backup_in_progress',
      message: '媒体写入正处在备份窗口内，请稍后重试',
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

  app.get('/api/posts', async (req, reply) => {
    // 可选会话：登录后列表里每条帖子都带上 likeCount / commentCount / likedByMe
    // （未登录时不查库，likedByMe 恒为 false）
    const sess = await resolveSession(req.headers.authorization)
    if (sess.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    const meId = sess.kind === 'ok' ? sess.user.userId : null
    try {
      const r = await db.pool.query<
        PostRow & { like_count: string; comment_count: string; liked_by_me: boolean; images: unknown }
      >(
        `select p.id, p.author_name, p.author_id, p.body, p.place, p.created_at,
                (select count(*) from likes l where l.post_id = p.id)::text as like_count,
                (select count(*) from comments c where c.post_id = p.id)::text as comment_count,
                exists (
                  select 1 from likes l2
                   where l2.post_id = p.id and l2.user_id = $2::uuid
                ) as liked_by_me,
                -- M4：帖子的**公**图片（public scope）。
                -- 只取 public：private 是聊天媒体，结构上不可能通过 post_media 关联
                -- （迁移 006 的复合外键钉死了 scope），这里再显式过滤一次是防御性写法。
                -- 只返回 id/尺寸，不返回 storage_key —— 客户端统一用 /api/media/:id 取图，
                -- 不把存储路径暴露给前端（以后换对象存储也不用改客户端）。
                coalesce((
                  select json_agg(json_build_object('id', m.id, 'width', m.width, 'height', m.height) order by pm.position)
                    from post_media pm
                    join media m on m.id = pm.media_id
                   where pm.post_id = p.id and m.scope = 'public'
                ), '[]'::json) as images
           from posts p
          order by p.created_at desc, p.id desc
          limit $1`,
        [LIST_LIMIT, meId],
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
          // M3 Slice 2：列表卡片需要显示计数与"我点过没"
          likeCount: Number.parseInt(row.like_count ?? '0', 10),
          commentCount: Number.parseInt(row.comment_count ?? '0', 10),
          likedByMe: row.liked_by_me,
          // M4：帖子图片（只给 id 与尺寸；客户端用 /api/media/:id 取图）
          images: row.images ?? [],
        })),
      }
    } catch (err) {
      // 连接层错误 → 立刻把就绪状态降级并返回 503；
      // 只有真正的查询错误（比如 SQL 写错）才是 500
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
      /*
        M3 Slice 4：把地点文本**对到已知地点**（places.name 精确匹配）并写 place_id。
        为什么必须有这一步：原版 poi-detail 是"按地点聚合动态"，而聚合只能靠 place_id；
        只存文本 place 的话，地点详情页永远查不到"该地点的动态"。

        **只有候选唯一时才自动绑定**（审核记录 13 的 closeout）：
        同名地点存在时（0 个或 >1 个候选）一律保持 NULL —— 随便挑一个会把动态挂到错误的地点，
        而且这种错误在界面上看不出来（地点名一样，只是地址/坐标不同）。
        宁可 NULL（未知就是未知），也不要猜。
      */
      let placeId: string | null = null
      if (place) {
        const matches = await db.pool.query<{ id: string }>(
          'select id from places where name = $1 limit 2',
          [place],
        )
        if (matches.rows.length === 1) {
          placeId = matches.rows[0]!.id
        }
        // 0 个候选 → NULL（未知地点）
        // 2 个及以上候选 → 仍然是 NULL（同名歧义，不猜）
      }

      // 作者完全来自服务端会话；author_name 存为快照（用户以后改名也保留当时的展示名）
      const r = await db.pool.query<PostRow>(
        `insert into posts (id, author_name, author_id, body, place, place_id)
         values ($1, $2, $3, $4, $5, $6)
         returning id, author_name, author_id, body, place, created_at`,
        [id, session.displayName.slice(0, DISPLAY_MAX), session.userId, body, place, placeId],
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

  // -------------------------------------------------------------------------
  // 帖子详情 / 评论 / 回复（M3 Slice 1）
  //
  // 1:1 依据（原版实测，见 docs/m3/MODEL-VALIDATION.md §2.7 与 supplements/comment-detail.json）：
  //   - 评论区**内联**在动态详情里，顶层评论各自带一个"回复列表"（嵌套渲染，EXPANDED）
  //   - 每条评论都有独立的「回复」入口；回复编辑器标题是「回复 @某人」
  //   - 回复行渲染为：「<作者> 回复 <目标> · <时间>」+ 正文
  //     → 目标来自**独立的 reply_target 字段**，不是把 @某人 拼进正文
  //   - **「评论 N」把回复也算进去**：发一条回复后计数从 1 变 2
  //     → 计数 = 顶层评论 + 全部子回复
  //   - 回复可以再被回复（子回复行也有「回复」按钮）
  //     → parent_id 可指向任意一条评论；展示时**归到同一顶层评论下**，
  //       每条回复自带 replyTo 说明它回的是谁（与实测的平面嵌套一致）
  // -------------------------------------------------------------------------

  interface CommentRow {
    id: string
    root_id: string
    parent_id: string | null
    depth: number
    body: string
    created_at: Date
    author_id: string | null
    author_name: string
    reply_to_name: string | null
  }

  /** 取某帖的评论树：顶层评论 + 各自的全部后代（递归 CTE 一次查完，避免 N+1） */
  async function loadComments(postId: string): Promise<{
    items: Array<Record<string, unknown>>
    total: number
  }> {
    /**
     * 递归 CTE 把每条评论归到它的**顶层祖先**（root_id）。
     * `t.depth < 20` 是防御性上限：正常插入不可能形成环（parent 必须已存在），
     * 但真出现异常数据时不能让查询无限递归下去。
     */
    const r = await db.pool.query<CommentRow>(
      `with recursive tree as (
         select c.id, c.id as root_id, c.parent_id, 0 as depth
           from comments c
          where c.post_id = $1 and c.parent_id is null
         union all
         select c.id, t.root_id, c.parent_id, t.depth + 1
           from comments c
           join tree t on c.parent_id = t.id
          where t.depth < 20
       )
       select t.id, t.root_id, t.parent_id, t.depth,
              c.body, c.created_at, c.author_id,
              coalesce(u.display_name, po.author_name, '匿名') as author_name,
              pu.display_name as reply_to_name
         from tree t
         join comments c on c.id = t.id
         join posts po on po.id = c.post_id
         left join users u on u.id = c.author_id
         left join comments pc on pc.id = c.parent_id
         left join users pu on pu.id = pc.author_id
        order by t.root_id, t.depth, c.created_at, t.id`,
      [postId],
    )

    const byRoot = new Map<string, Record<string, unknown>>()
    const order: string[] = []
    for (const row of r.rows) {
      const base = {
        id: row.id,
        body: row.body,
        authorId: row.author_id,
        author: row.author_name,
        createdAt: row.created_at.toISOString(),
      }
      if (row.depth === 0) {
        const node = { ...base, parentId: null, replyTo: null, replies: [] as unknown[] }
        byRoot.set(row.id, node)
        order.push(row.id)
      } else {
        const root = byRoot.get(row.root_id)
        // 理论上不会缺（顶层一定先于后代被读到）；缺了就跳过，不让结构错乱
        if (!root) continue
        ;(root.replies as unknown[]).push({
          ...base,
          parentId: row.parent_id,
          // 「回复 <目标>」的目标：来自 parent_id 指向的那条评论的作者
          replyTo: row.reply_to_name,
        })
      }
    }

    return { items: order.map((id) => byRoot.get(id)!), total: r.rows.length }
  }

  /** 帖子详情：帖子本身 + 两个计数（评论计数含回复，点赞计数来自 likes 表） */
  app.get('/api/posts/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    // 可选会话：登录了就带上"我是否点过赞"，没登录就 false（不查库）
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    const meId = s.kind === 'ok' ? s.user.userId : null
    try {
      const pr = await db.pool.query<PostRow>(
        `select id, author_name, author_id, body, place, created_at
           from posts where id = $1`,
        [id],
      )
      const post = pr.rows[0]
      if (!post) {
        reply.code(404)
        return { error: 'not_found' }
      }
      const cr = await db.pool.query<{ n: string }>(
        'select count(*)::text as n from comments where post_id = $1',
        [id],
      )
      const like = await likeStateFor(id, meId)
      // M4：详情也要带图片（与列表同口径：只取 public，只给 id 与尺寸）
      const imgs = await db.pool.query<{ id: string; width: number | null; height: number | null }>(
        `select m.id, m.width, m.height
           from post_media pm
           join media m on m.id = pm.media_id
          where pm.post_id = $1 and m.scope = 'public'
          order by pm.position`,
        [id],
      )
      return {
        id: post.id,
        author: post.author_name,
        authorId: post.author_id,
        body: post.body,
        place: post.place,
        createdAt: post.created_at.toISOString(),
        commentCount: Number.parseInt(cr.rows[0]?.n ?? '0', 10),
        likeCount: like.likeCount,
        likedByMe: like.likedByMe,
        images: imgs.rows,
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /** 评论树：顶层评论各带 replies（每条 replies 里带 replyTo） */
  app.get('/api/posts/:id/comments', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      const exists = await db.pool.query('select 1 from posts where id = $1', [id])
      if (!exists.rowCount) {
        reply.code(404)
        return { error: 'not_found' }
      }
      const { items, total } = await loadComments(id)
      return { items, total }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /** 发评论或回复：author 一律来自会话；parentId 可选（给了就是回复） */
  app.post('/api/posts/:id/comments', async (req, reply) => {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)

    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }

    const payload = (req.body ?? {}) as Record<string, unknown>
    // strict schema：只允许 body / parentId，多一个字段就 400（与发帖同一原则）
    const extra = Object.keys(payload).filter((k) => !['body', 'parentId'].includes(k))
    if (extra.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: [`不支持字段: ${extra.join(', ')}（作者由服务端会话决定）`] }
    }
    const body = typeof payload.body === 'string' ? payload.body.trim() : ''
    const parentId = typeof payload.parentId === 'string' ? payload.parentId.trim() : ''
    if (!body) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['body 不能为空'] }
    }
    if (body.length > COMMENT_MAX) {
      reply.code(400)
      return { error: 'invalid_payload', details: [`body 不能超过 ${COMMENT_MAX} 字`] }
    }
    if (parentId && !/^[0-9a-f-]{36}$/i.test(parentId)) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['parentId 不是合法 id'] }
    }

    try {
      const pr = await db.pool.query('select 1 from posts where id = $1', [id])
      if (!pr.rowCount) {
        reply.code(404)
        return { error: 'not_found' }
      }
      if (parentId) {
        // 被回复的评论必须存在**且属于同一篇帖子** —— 否则就会跨帖挂载
        const pp = await db.pool.query('select 1 from comments where id = $1 and post_id = $2', [
          parentId,
          id,
        ])
        if (!pp.rowCount) {
          reply.code(400)
          return { error: 'invalid_payload', details: ['parentId 不属于该帖子'] }
        }
      }
      const cr = await db.pool.query<{ id: string; created_at: Date }>(
        `insert into comments (id, post_id, author_id, parent_id, body)
         values ($1, $2, $3, $4, $5)
         returning id, created_at`,
        [randomUUID(), id, s.user.userId, parentId || null, body],
      )
      const row = cr.rows[0]!
      reply.code(201)
      return {
        id: row.id,
        body,
        authorId: s.user.userId,
        author: s.user.displayName,
        createdAt: row.created_at.toISOString(),
        parentId: parentId || null,
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // -------------------------------------------------------------------------
  // 点赞（M3 Slice 2）
  //
  // 1:1 依据（原版**只读**观察，见 supplements/slice2-likes-readonly.json）：
  //   - 点赞区是整块热区（id/post_like_section clickable），图标在左、计数在右
  //   - 计数是**纯数字无单位**（不是「1 赞」）
  //   - **0 赞时计数控件不存在**（不是显示 0）→ 展示层规则：0 只渲染图标
  //   - 详情页没有「谁点了赞」的列表 → 不需要点赞用户列表接口
  //
  // 政策约束：原版上的点赞**切换行为**与**已点赞态样式**属写操作，禁止取证，
  // 记 BLOCKED_BY_POLICY；这两项的验证只来自本自建系统（见 verify-likes.sh）。
  // -------------------------------------------------------------------------

  /** 点赞计数 + 当前用户是否已赞（可选会话：未登录时 likedByMe=false，不发 DB 查询） */
  async function likeStateFor(
    postId: string,
    userId: string | null,
  ): Promise<{ likeCount: number; likedByMe: boolean }> {
    const r = await db.pool.query<{ n: string; mine: string }>(
      `select count(*)::text as n,
              coalesce(bool_or(l.user_id = $2::uuid), false)::text as mine
         from likes l
        where l.post_id = $1`,
      [postId, userId],
    )
    const row = r.rows[0]
    return {
      likeCount: Number.parseInt(row?.n ?? '0', 10),
      likedByMe: row?.mine === 'true',
    }
  }

  /** 点赞（幂等：重复点赞不报错、不重复计数） */
  app.post('/api/posts/:id/like', async (req, reply) => {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      const pr = await db.pool.query('select 1 from posts where id = $1', [id])
      if (!pr.rowCount) {
        reply.code(404)
        return { error: 'not_found' }
      }
      // on conflict do nothing：把"重复点赞"定义为幂等，而不是让客户端去猜状态
      await db.pool.query(
        `insert into likes (id, post_id, user_id) values ($1, $2, $3)
         on conflict (user_id, post_id) do nothing`,
        [randomUUID(), id, s.user.userId],
      )
      const st = await likeStateFor(id, s.user.userId)
      return { liked: true, ...st }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /** 取消点赞（同样幂等：没点过也不报错） */
  app.delete('/api/posts/:id/like', async (req, reply) => {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      await db.pool.query('delete from likes where post_id = $1 and user_id = $2', [
        id,
        s.user.userId,
      ])
      const st = await likeStateFor(id, s.user.userId)
      return { liked: false, ...st }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // -------------------------------------------------------------------------
  // 地点（M3 Slice 4：poi-detail 的一致性依据是**只读证据**，可做真实比对）
  //
  // 1:1 依据（supplements/poi-detail.json，只读取得 → 可采信）：
  //   - 地点详情页聚合「该地点的动态」（图片 + 作者标签叠加）
  //   - 显示 地点名 + 距离 + 完整地址
  //   因此 posts.place_id 必须真的落库 —— 只存文本 place 是聚合不出"该地点的动态"的。
  // -------------------------------------------------------------------------

  /** 地点详情：地点本体 + 该地点的动态列表（按时间倒序） */
  app.get('/api/places/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      const pr = await db.pool.query<{
        id: string
        name: string
        address: string | null
        latitude: number | null
        longitude: number | null
      }>('select id, name, address, latitude, longitude from places where id = $1', [id])
      const place = pr.rows[0]
      if (!place) {
        reply.code(404)
        return { error: 'not_found' }
      }
      const posts = await db.pool.query<PostRow>(
        `select id, author_name, author_id, body, place, created_at
           from posts
          where place_id = $1
          order by created_at desc, id desc
          limit $2`,
        [id, LIST_LIMIT],
      )
      return {
        id: place.id,
        name: place.name,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        posts: posts.rows.map((row) => ({
          id: row.id,
          author: row.author_name,
          authorId: row.author_id,
          body: row.body,
          createdAt: row.created_at.toISOString(),
        })),
        postCount: posts.rows.length,
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // -------------------------------------------------------------------------
  // M4：媒体下发（审核记录 13 第 6 条 + 记录 15 的 P0-A / X-Accel）
  //
  // 设计要点：
  //   public  → 由 Nginx 直接静态下发（/media/...），应用层不管字节；
  //             本接口对 public 只做 302 到静态路径（保证前端可以用同一个 URL 形态）
  //   private → **没有静态入口**；本接口做会话 + can_read_media 鉴权，
  //             然后用 X-Accel-Redirect 让 Nginx 从 internal location 取文件。
  //             Node 只判定、不搬字节（396MB 内存的机器上这很重要）。
  //
  // 授权**复用** can_read_media（它又复用 can_read_message）——
  // 不在这个接口里另写一套可见性规则，这是 P0-A 防权限漂移的核心。
  //
  // 不满足 → **404 而不是 403**：403 会主动告诉未授权者"这个 id 存在"。
  // -------------------------------------------------------------------------
  const MEDIA_URL_PREFIX = process.env.MEDIA_URL_PREFIX ?? '/media'
  const PRIVATE_XACCEL_PREFIX = process.env.PRIVATE_XACCEL_PREFIX ?? '/_private_media'
  const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? '/srv/campus/uploads'
  const MEDIA_MAX_BYTES = 5 * 1024 * 1024 // 单图 ≤ 5MB（PLAN §6）
  const DISK_RESERVE_BYTES = 1024 * 1024 * 1024 // 预留 1GB
  const DISK_REJECT_PERCENT = 90 // >90% 拒绝新上传

  // multipart 解析器（上传接口用）。limit 在调用处再收紧到 5MB。
  // 不 await：buildApp 是同步函数，Fastify 的 register 会在 ready() 时完成加载
  // （调用方本来就会 await app.ready()，所以这里的顺序是有保证的）。
  app.register(multipart, {
    limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 10 },
  })

  /**
   * 磁盘水位检查（审核记录 13 第 5 条）。
   *
   * 两个条件都要满足才算"还有空间"，任一不满足就拒绝新上传：
   *   ① 使用率 ≤ 90%
   *   ② 剩余 ≥ 1GB
   * 为什么两个都要：这台机器只有 20GB 盘，**百分比在小盘上会抖动**
   * （删一点日志使用率就掉几个点，但绝对余量并没有变安全）。
   * 用 statfs 拿的是**真实文件系统**数据，不是应用层的估算。
   */
  async function checkDisk(root: string): Promise<{ ok: boolean; usedPercent: number; freeBytes: number }> {
    const st = await statfs(root)
    const total = Number(st.blocks) * Number(st.bsize)
    const free = Number(st.bavail) * Number(st.bsize)
    const usedPercent = total > 0 ? Math.round(((total - free) / total) * 100) : 100
    const ok = usedPercent <= DISK_REJECT_PERCENT && free >= DISK_RESERVE_BYTES
    return { ok, usedPercent, freeBytes: free }
  }

  /**
   * M4：上传媒体（multipart）。
   *
   * 边界逐条对应审核记录 13 的 7 条与记录 15 的 4 条：
   *   ① DB 只存**逻辑 key**（YYYY/MM/<uuid>.<ext>），不存 URL / 绝对路径
   *   ② 文件名**服务端生成**（UUID）；客户端 filename 只用来记日志，绝不参与路径
   *   ③ 不信任 Content-Type / 扩展名：用 imageProbe **按字节**判类型与尺寸
   *   ④ 顺序不变式：**先有文件、后有 DB 行**（宁可留可清扫的 orphan，
   *      也不要留"DB 说有图、实际取不到"的悬空引用）
   *   ⑤ 磁盘 Gate：>90% 或剩余 < 1GB → **507**；写盘 ENOSPC → 507（可恢复的外部条件）
   *   ⑥ scope 由服务端按 purpose 决定（post→public / chat→private），不接受客户端直接给 scope
   *   ⑦ 幂等键 upload_request_id：重复上传返回**同一条** media，不新建文件
   *   ⑧ 备份期屏障：写入段（文件 + DB 行）在 media 共享锁事务内；备份窗口内返回
   *      503 + Retry-After，而不是 500 —— 语义是"稍后重试"，不是"出错了"
   */
  app.post('/api/media', async (req, reply) => {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)

    let data
    try {
      data = await (req as unknown as { file: (o?: unknown) => Promise<MultipartFile | undefined> }).file({
        limits: { fileSize: MEDIA_MAX_BYTES, files: 1 },
      })
    } catch (err) {
      // @fastify/multipart 在超限时抛错（fileSize limit）
      const code = (err as { code?: string }).code ?? ''
      if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT') {
        reply.code(413)
        return { error: 'file_too_large', limit: MEDIA_MAX_BYTES }
      }
      reply.code(400)
      return { error: 'bad_multipart', message: (err as Error).message }
    }
    if (!data) {
      reply.code(400)
      return { error: 'no_file' }
    }

    // 幂等键：客户端为一次逻辑上传生成；缺失则一律拒绝（否则重试会重复建文件）
    const uploadRequestId = (data.fields?.uploadRequestId as { value?: string } | undefined)?.value
    if (!uploadRequestId || !/^[0-9a-f-]{36}$/i.test(uploadRequestId)) {
      reply.code(400)
      return { error: 'missing_upload_request_id' }
    }
    // purpose → scope 的映射在**服务端**；客户端不能直接指定 scope
    const purpose = ((data.fields?.purpose as { value?: string } | undefined)?.value ?? 'post').trim()
    const scope = purpose === 'chat' ? 'private' : purpose === 'post' ? 'public' : null
    if (!scope) {
      reply.code(400)
      return { error: 'bad_purpose', allowed: ['post', 'chat'] }
    }

    const buf = await data.toBuffer()
    if (buf.length === 0) {
      reply.code(400)
      return { error: 'empty_file' }
    }
    if (buf.length > MEDIA_MAX_BYTES) {
      reply.code(413)
      return { error: 'file_too_large', limit: MEDIA_MAX_BYTES }
    }

    // ③ 按**内容**判类型（不信任 Content-Type 与扩展名）
    const probe = probeImage(new Uint8Array(buf))
    if (!probe.ok) {
      reply.code(400)
      return { error: 'not_an_image', reason: probe.reason }
    }
    const ext = probe.mime === 'image/png' ? 'png' : probe.mime === 'image/jpeg' ? 'jpg' : 'webp'
    const sha256 = createHash('sha256').update(buf).digest('hex')

    try {
      // ⑦ 先查幂等键：命中就直接返回原来的 media（不写文件、不建行）
      const dup = await db.pool.query<{ id: string; storage_key: string; mime: string }>(
        'select id, storage_key, mime from media where owner_user_id = $1 and upload_request_id = $2',
        [s.user.userId, uploadRequestId],
      )
      if (dup.rows[0]) {
        return {
          id: dup.rows[0].id,
          storageKey: dup.rows[0].storage_key,
          mime: dup.rows[0].mime,
          scope,
          idempotentReplay: true,
        }
      }

      // ⑤ 磁盘 Gate（在写盘之前）
      const disk = await checkDisk(UPLOAD_ROOT)
      if (!disk.ok) {
        reply.code(507)
        return { error: 'insufficient_storage', usedPercent: disk.usedPercent, freeBytes: disk.freeBytes }
      }

      // ② storage_key 完全由服务端生成；④ 先写 tmp，再原子 rename 到最终路径
      const id = randomUUID()
      const now = new Date()
      const yyyy = String(now.getUTCFullYear())
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
      const relDir = `${yyyy}/${mm}`
      const storageKey = `${relDir}/${id}.${ext}`
      const finalPath = join(UPLOAD_ROOT, scope, storageKey)
      const tmpPath = join(UPLOAD_ROOT, '.tmp', `${id}.${ext}`)

      /**
       * ★ M4 backup mutation barrier（审核记录 19 的 P0）：「写文件 + 写 DB 行」这一段
       * 必须落在**同一个共享锁事务**内。要挡的时序是：
       * ```
       * 备份进程 pg_dump 已完成 → 用户上传成功（DB 行 + 文件都落）→ uploads.tar 开始
       * ```
       * 于是 dump 里没有这行、tar 里有这个文件 —— 备份"各自内部正确"但不属于同一时刻。
       *
       * 取锁位置**刻意放在写盘之前**：备份窗口内这里直接阻塞到 lock_timeout，返回 503，
       * 而不是"先把文件落了盘再卡在锁上"——那样等于自己制造了那个不一致窗口。
       * 拿到共享锁之后，备份的排他锁要么完全在本次写之前、要么完全在本事务提交之后。
       *
       * 范围边界：只包住 media 的 INSERT 与文件落盘。**读路径一律不加锁**
       * （本函数开头的幂等键查询、GET /api/media/:id 等读接口都不受影响，这是设计的一部分）。
       */
      const client = await db.pool.connect()
      /** INSERT 是否已经成功 —— 决定出错时"这个文件能不能删"（见下面的 catch） */
      let inserted = false
      try {
        await client.query('begin')
        // 备份窗口内这里会阻塞；lock_timeout（5s）到点抛 55P03 → isBarrierTimeout 翻成 503
        await acquireMediaMutationLock(client)

        await mkdir(join(UPLOAD_ROOT, scope, relDir), { recursive: true, mode: 0o750 })
        await writeFile(tmpPath, buf, { mode: 0o640 })
        await rename(tmpPath, finalPath) // 同文件系统（同一个 uploads 根）→ 原子

        // ④ 文件已就位，再写 DB 行
        await client.query(
          `insert into media (id, owner_user_id, scope, storage_key, mime, bytes, width, height, sha256, upload_request_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [id, s.user.userId, scope, storageKey, probe.mime, buf.length, probe.width, probe.height, sha256, uploadRequestId],
        )
        inserted = true
        // 提交即释放共享锁：提交之前备份的排他锁进不来，提交之后它才可以开始
        await client.query('commit')
      } catch (err) {
        // 已经在 commit 之前 INSERT 成功 → 失败的只是 commit，这一行到底有没有落库**不确定**
        const commitUncertain = inserted
        await client.query('rollback').catch(() => undefined)
        if (!commitUncertain) {
          /*
            只有在"确定没有 DB 行"时才删文件：
              - 写盘失败 / ENOSPC   → 没有行，文件是 orphan
              - INSERT 失败（含并发撞幂等键唯一约束）→ 事务已回滚，没有行
            而 commit 结果不确定时**保留**文件：本项目明确宁可留下能被 cleanup 清扫的
            orphan 文件，也不要留下"DB 说有图、实际取不到"的悬空引用（见 cleanup-entry.ts 文件头）。
          */
          await unlink(tmpPath).catch(() => undefined)
          await unlink(finalPath).catch(() => undefined)
        }
        // 备份窗口导致的锁等待超时 → 503 + Retry-After（"稍后重试"），而不是 500（"出错了"）
        if (isBarrierTimeout(err)) return backupBarrierUnavailable(reply)

        const code = (err as { code?: string }).code ?? ''
        if (code === 'ENOSPC') {
          reply.code(507)
          return { error: 'insufficient_storage', reason: 'enospc' }
        }

        // 并发下另一个请求可能刚插了同一个幂等键 → 返回那条
        const again = await db.pool
          .query<{ id: string; storage_key: string; mime: string }>(
            'select id, storage_key, mime from media where owner_user_id = $1 and upload_request_id = $2',
            [s.user.userId, uploadRequestId],
          )
          .catch(() => ({ rows: [] as Array<{ id: string; storage_key: string; mime: string }> }))
        if (again.rows[0]) {
          return {
            id: again.rows[0].id,
            storageKey: again.rows[0].storage_key,
            mime: again.rows[0].mime,
            scope,
            idempotentReplay: true,
          }
        }
        throw err
      } finally {
        client.release()
      }

      reply.code(201)
      return {
        id,
        storageKey,
        mime: probe.mime,
        bytes: buf.length,
        width: probe.width,
        height: probe.height,
        scope,
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.get('/api/media/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))

    try {
      // 一次查询同时拿到 storage_key / scope / mime，并用**同一个函数**判定可读性
      const r = await db.pool.query<{
        storage_key: string
        scope: string
        mime: string
        allowed: boolean
      }>(
        `select m.storage_key, m.scope, m.mime,
                can_read_media($1::uuid, m.id) as allowed
           from media m
          where m.id = $2`,
        [s.kind === 'ok' ? s.user.userId : null, id],
      )
      const row = r.rows[0]
      // 不存在 / 不可读 → 一律 404（对外不可区分）
      if (!row || !row.allowed) {
        reply.code(404)
        return { error: 'not_found' }
      }

      // 私有媒体的响应头：不允许任何缓存（含中间代理）
      reply.header('Cache-Control', 'private, no-store')
      reply.header('X-Content-Type-Options', 'nosniff')

      if (row.scope === 'public') {
        // public 走 Nginx 静态；302 过去，字节不经过 Node
        reply.header('X-Media-Scope', 'public')
        reply.code(302)
        reply.header('Location', `${MEDIA_URL_PREFIX}/${row.storage_key}`)
        return null
      }

      // private：要求必须已登录（未登录在上面已经因为 allowed=false 变成 404）
      if (s.kind !== 'ok') {
        reply.code(404)
        return { error: 'not_found' }
      }
      reply.header('X-Media-Scope', 'private')
      /*
        **必须显式设置 Content-Type**（诊断得到的教训）：
        Nginx 做 X-Accel-Redirect 内部重定向时，**会保留上游响应里的 Content-Type**。
        Fastify 默认给的是 application/json; charset=utf-8，
        于是客户端拿到的就是"内容是真图、类型却是 JSON" —— 浏览器不会把它当图片渲染，
        而且这种不一致很难从状态码上看出来（200 看着是成功的）。
        所以这里按 media 行里记录的 mime 明确设置，让类型来自我们的白名单而不是框架默认值。
      */
      reply.header('Content-Type', row.mime)
      // Nginx internal location 映射到 uploads/private/
      reply.header('X-Accel-Redirect', `${PRIVATE_XACCEL_PREFIX}/${row.storage_key}`)
      reply.code(200)
      return null
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // -------------------------------------------------------------------------
  // M4 Slice A：消息消费端（A2）
  //
  // 为什么要新做：后端此前只有 messages 表结构，**没有任何消息接口** ——
  // 于是 message_media / 私有媒体虽然做完了，用户侧完全没有消费路径（审核记录 16 点名的缺口）。
  //
  // 两个只读接口：
  //   GET /api/threads            —— 我参与的会话（只列自己的，成员关系由 thread_members 决定）
  //   GET /api/threads/:id/messages —— 会话消息（**非成员一律 404**，复用同一套成员判定）
  //
  // 关键纪律（审核记录 15 的 P0-A）：可见性判定只有一处权威定义。
  // 这里不重写"我是不是成员"，而是用与 can_read_message 完全相同的 SQL 条件
  // （exists thread_members ...），并在返回消息时按 deleted_at 标注是否撤回。
  // -------------------------------------------------------------------------
  app.get('/api/threads', async (req, reply) => {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    try {
      const r = await db.pool.query<{
        id: string
        kind: string
        title: string | null
        member_count: string
        last_body: string | null
        last_kind: string | null
        last_at: Date | null
      }>(
        `select t.id, t.kind, t.title,
                (select count(*) from thread_members tm2 where tm2.thread_id = t.id)::text as member_count,
                lm.body as last_body, lm.kind as last_kind, lm.created_at as last_at
           from message_threads t
           join thread_members me on me.thread_id = t.id and me.user_id = $1
           left join lateral (
             select m.body, m.kind, m.created_at
               from messages m
              where m.thread_id = t.id and m.deleted_at is null
              order by m.created_at desc, m.id desc
              limit 1
           ) lm on true
          order by coalesce(lm.created_at, t.created_at) desc
          limit 50`,
        [s.user.userId],
      )
      return {
        items: r.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          title: row.title,
          memberCount: Number.parseInt(row.member_count, 10),
          lastMessage: row.last_body === null ? null : { body: row.last_body, kind: row.last_kind, createdAt: row.last_at?.toISOString() ?? null },
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.get('/api/threads/:id/messages', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') {
      // 未登录 → 404（与私有媒体同口径：不区分"不存在"与"没权限"）
      reply.code(404)
      return { error: 'not_found' }
    }
    try {
      const member = await db.pool.query(
        'select 1 from thread_members where thread_id = $1 and user_id = $2',
        [id, s.user.userId],
      )
      if (!member.rowCount) {
        reply.code(404)
        return { error: 'not_found' }
      }
      const r = await db.pool.query<{
        id: string
        sender_id: string | null
        sender_name: string | null
        body: string
        kind: string
        created_at: Date
        deleted_at: Date | null
        media: unknown
      }>(
        `select m.id, m.sender_id, u.display_name as sender_name, m.body, m.kind, m.created_at, m.deleted_at,
                -- 图片消息的媒体引用（只给 id 与尺寸；客户端用 /api/media/:id 取图）
                coalesce((
                  select json_agg(json_build_object('id', md.id, 'width', md.width, 'height', md.height) order by mm.position)
                    from message_media mm join media md on md.id = mm.media_id
                   where mm.message_id = m.id
                ), '[]'::json) as media
           from messages m
           left join users u on u.id = m.sender_id
          where m.thread_id = $1
          order by m.created_at asc, m.id asc
          limit $2`,
        [id, LIST_LIMIT],
      )
      return {
        threadId: id,
        items: r.rows.map((row) => ({
          id: row.id,
          senderId: row.sender_id,
          sender: row.sender_name,
          body: row.body,
          kind: row.kind,
          createdAt: row.created_at.toISOString(),
          // 撤回：**保留 kind 与行**，只标记状态 —— 界面显示"消息已撤回"，
          // 而媒体授权也已经因为 deleted_at 变成不可读（服务端强制执行，不是靠前端隐藏）
          revoked: row.deleted_at !== null,
          media: row.deleted_at !== null ? [] : (row.media ?? []),
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // -------------------------------------------------------------------------
  // M4 Slice C：发送消息 + @ 提及（最小闭环，审核记录 16）
  //
  // 范围刻意最小：只做"消息提到某些用户"这一条关系。
  // **不做 @所有人** —— 若将来要做，必须单独明确语义，绝不能伪造成某个 user id
  // （那会让"提到全体"与"提到某人"在数据上无法区分）。
  //
  // 两条写入校验（Gate 会机械验证）：
  //   ① 被提及者**必须是会话成员**（复用 is_thread_member —— 成员关系只有一处定义）
  //   ② 不允许提到自己（自指没有语义，与 board_notes 的 from<>to 同理）
  // 任何一条不满足 → 400 且**不写入任何行**（消息与 mention 都不写）。
  //
  // M5 WO#2（审核记录 21 修订 1）：消息可以带**一张**私有图，字段是单数 `mediaId`。
  //   - **刻意不接受数组**（`mediaIds`/`[id]` 一律 400 bad_media_id）：
  //     当前**没有可采信证据**支持"一条消息多图"，数组属于没有证据的扩张；
  //     将来真有证据再另立一单扩展（届时是新增字段，不是改语义）。
  //   - `mediaId` 只能配 `kind='image'`：kind 与载荷必须自洽，
  //     否则会写出"说自己是文本、其实挂了张图"的行。
  //   - 校验全过才写；任一不过 → 4xx 且**一行都不写**（消息、mention、message_media 全不写），
  //     错误码各自独立，便于 Gate 机械断言。
  // -------------------------------------------------------------------------
  app.post('/api/threads/:id/messages', async (req, reply) => {
    const threadId = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(threadId)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') {
      reply.code(404)
      return { error: 'not_found' }
    }
    const body = req.body as
      | { body?: unknown; kind?: unknown; mentions?: unknown; mediaId?: unknown; mediaIds?: unknown }
      | undefined
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    const kind = typeof body?.kind === 'string' ? body.kind : 'text'
    if (!text || text.length > 2000) {
      reply.code(400)
      return { error: 'bad_body' }
    }
    if (!['text', 'image', 'voice'].includes(kind)) {
      reply.code(400)
      return { error: 'bad_kind' }
    }
    const rawMentions = Array.isArray(body?.mentions) ? body.mentions : []
    const mentions = [...new Set(rawMentions.filter((m): m is string => typeof m === 'string'))]
    for (const m of mentions) {
      if (!/^[0-9a-f-]{36}$/i.test(m)) {
        reply.code(400)
        return { error: 'bad_mention_id', mention: m }
      }
    }

    // ---- M5 WO#2：可选的单个 mediaId --------------------------------------
    // 格式问题在开事务**之前**就拒掉（不需要连库）；语义问题（存在/scope/owner）在事务内查。
    // 形状检查顺序刻意如此：先要求"是个字符串"，这样传数组时给出的是 bad_media_id，
    // 而不是被悄悄取成 undefined 当成"没带图"（那才是最难发现的一类 bug）。
    //
    // 复数 `mediaIds` **明确拒绝**（而不是"不认识就忽略"）：
    // 依据是审核记录 21 修订 1 —— "当前没有证据支持一条消息多图，所以 API 用单数"。
    // 如果这里只是静默忽略，客户端按旧计划发了 `mediaIds:[id]` 会收到 **201**：
    // 消息发出去了、图没挂上，用户以为图发了，而服务端与客户端都不报错 ——
    // 这类"静默丢数据"比 400 糟得多。本项目的既有纪律也是"身份/意图类字段宁可 strict 400，
    // 不做宽容解析"（同 M5 留言板对 from_user_id 的处理）。
    if (body?.mediaIds !== undefined) {
      reply.code(400)
      return { error: 'bad_media_id', reason: 'array_not_supported_use_singular_mediaId' }
    }
    const mediaId = body?.mediaId === undefined ? null : body.mediaId
    if (mediaId !== null && typeof mediaId !== 'string') {
      reply.code(400)
      return { error: 'bad_media_id', reason: 'not_a_string' }
    }
    if (typeof mediaId === 'string' && !/^[0-9a-f-]{36}$/i.test(mediaId)) {
      reply.code(400)
      return { error: 'bad_media_id', reason: 'bad_format' }
    }
    // 带了图却不是图片消息 → 自相矛盾的载荷，直接拒（不写任何行）
    if (mediaId !== null && kind !== 'image') {
      reply.code(400)
      return { error: 'media_requires_image_kind', kind }
    }

    const client = await db.pool.connect()
    try {
      await client.query('begin')
      // 发送者必须是会话成员（否则连"这个会话存在"都不告诉他 → 404）
      const member = await client.query(
        'select 1 from thread_members where thread_id = $1 and user_id = $2',
        [threadId, s.user.userId],
      )
      if (!member.rowCount) {
        await client.query('rollback')
        reply.code(404)
        return { error: 'not_found' }
      }
      // 校验被提及者：必须是会话成员、且不能是自己
      for (const m of mentions) {
        if (m === s.user.userId) {
          await client.query('rollback')
          reply.code(400)
          return { error: 'cannot_mention_self', mention: m }
        }
        const ok2 = await client.query('select is_thread_member($1, $2) as ok', [threadId, m])
        if (!ok2.rows[0]?.ok) {
          await client.query('rollback')
          reply.code(400)
          return { error: 'mention_not_in_thread', mention: m }
        }
      }
      // ---- 校验 mediaId（全部通过才写；任一条不过 → rollback + 4xx，一行都不写）----
      //
      // 关于"media 当前有效"这条：**当前没有"已失效 media"这个概念，故不实现，但写下判断依据**。
      //   证据：006_media_scope.sql 的 media 表只有 created_at，**没有** deleted_at / expires_at；
      //   上传路径（POST /api/media）只写 scope='public'|'private'，且服务端从不 UPDATE media；
      //   全仓唯一的 media 行删除路径是清扫工具里"确实无引用的孤儿"（含本次新增的 unattached TTL GC）。
      //   因此"存在"就等于"有效"。将来若引入失效语义，必须在这里补一条判断，
      //   并且要让 GET /api/media/:id 共用同一个 predicate（防权限漂移，审核记录 15 P0-A）。
      if (mediaId !== null) {
        const m = await client.query<{ owner_user_id: string; scope: string }>(
          'select owner_user_id, scope from media where id = $1',
          [mediaId],
        )
        const row = m.rows[0]
        if (!row) {
          await client.query('rollback')
          reply.code(400)
          return { error: 'media_not_found', mediaId }
        }
        if (row.scope !== 'private') {
          // 公共动态图不能挂进私聊。DB 层的复合外键本来也会拒，
          // 但那里报的是 FK 错误（500 不好诊断），所以在服务层先给出明确 400。
          await client.query('rollback')
          reply.code(400)
          return { error: 'media_not_private', mediaId, scope: row.scope }
        }
        if (row.owner_user_id !== s.user.userId) {
          // ★ 最容易漏的一条越权：知道别人的 private media id 就把它挂到自己的消息上。
          //   注意这里**不是** 404 —— 会话成员身份已确认，返回明确 400 泄漏不了额外信息
          //   （能拿到这个 id 的人本来就已经通过别的途径知道它存在）。
          await client.query('rollback')
          reply.code(400)
          return { error: 'media_not_owned', mediaId }
        }
      }
      const msgId = randomUUID()
      await client.query(
        'insert into messages (id, thread_id, sender_id, body, kind) values ($1, $2, $3, $4, $5)',
        [msgId, threadId, s.user.userId, text, kind],
      )
      for (const m of mentions) {
        await client.query(
          'insert into message_mentions (id, message_id, mentioned_user_id) values ($1, $2, $3)',
          [randomUUID(), msgId, m],
        )
      }
      // ④ 消息与媒体引用**同事务**（否则会出现"消息在、图没挂上"或反之）。
      // 不自己重写跨 scope 防线：message_media 的常量 CHECK(media_scope='private')
      // + 复合外键 (media_id, media_scope) → media(id, scope) 仍在 DB 层兜底，
      // 这里写的 media_scope 只是把"我们主张它是 private"显式表达出来。
      if (mediaId !== null) {
        await client.query(
          "insert into message_media (message_id, media_id, media_scope, position) values ($1, $2, 'private', 0)",
          [msgId, mediaId],
        )
      }
      await client.query('commit')
      reply.code(201)
      return { id: msgId, kind, mentions, mediaId }
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      // 23503 = foreign_key_violation。走到这里只可能是"校验通过之后那张 media 行没了"
      // —— 例如 TTL GC 在同一瞬间把它回收了（cleanup-entry.ts 的 unattached 清扫）。
      // 这**不是**服务端故障，也不该写任何行（上面已 rollback），
      // 所以翻译成可重试的 4xx，而不是 500。
      // （23514 = check_violation 理论上到不了，因为 scope 已在上面校验过；
      //   留着是为了让"DB 防线被绕过"这种情况有可诊断的错误码，而不是 500。）

      const code = (err as { code?: string }).code ?? ''
      if (code === '23503') {
        reply.code(409)
        return { error: 'media_gone', mediaId }
      }
      if (code === '23514') {
        reply.code(400)
        return { error: 'media_scope_conflict', mediaId }
      }
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    } finally {
      client.release()
    }
  })

  // -------------------------------------------------------------------------
  // M5 Slice 1：留言板（board_notes）—— 原版 message-board 的对应实现
  //
  // 一致性依据是**可采信**的只读证据（supplements/message-board.json）：
  //   「仅双方可见」（顶部副标题 + 输入框占位）、空态「可以给同学留言噢」、
  //   发送按钮「留言」、表情行恰好 7 个。
  // 模型结论为 SUPPORTED：**用户对用户的私密留言**，不挂在帖子/地点上。
  //
  // 可见性规则（服务端强制）：
  //   只有 from_user_id = 我 或 to_user_id = 我 的留言才返回 —— 也就是"双方可见"。
  //   第三方即使知道对方 user id 也拿不到（返回空列表，而不是 403：
  //   与私有媒体同口径，不泄漏"这两个人之间有没有留言"）。
  // 写入规则：不能给自己留言（DB 层已有 CHECK，这里先在服务层给出明确 400）。
  // -------------------------------------------------------------------------
  app.get('/api/board-notes/:userId', async (req, reply) => {
    const otherId = (req.params as { userId?: string }).userId ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(otherId)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    try {
      const r = await db.pool.query<{
        id: string
        from_user_id: string
        to_user_id: string
        body: string
        created_at: Date
        from_name: string | null
        to_name: string | null
      }>(
        `select b.id, b.from_user_id, b.to_user_id, b.body, b.created_at,
                fu.display_name as from_name, tu.display_name as to_name
           from board_notes b
           left join users fu on fu.id = b.from_user_id
           left join users tu on tu.id = b.to_user_id
          where (b.from_user_id = $1 and b.to_user_id = $2)
             or (b.from_user_id = $2 and b.to_user_id = $1)
          order by b.created_at asc
          limit $3`,
        [s.user.userId, otherId, LIST_LIMIT],
      )
      return {
        peerId: otherId,
        // 原版口径：标题「留言」+ 副标题「仅双方可见」；空态「可以给同学留言噢」
        visibleTo: 'two_parties_only',
        emptyText: '可以给同学留言噢',
        toUser: r.rows[0]?.to_name ?? null,
        items: r.rows.map((row) => ({
          id: row.id,
          fromUserId: row.from_user_id,
          toUserId: row.to_user_id,
          fromName: row.from_name,
          toName: row.to_name,
          body: row.body,
          createdAt: row.created_at.toISOString(),
          mine: row.from_user_id === s.user.userId,
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.post('/api/board-notes/:userId', async (req, reply) => {
    const toId = (req.params as { userId?: string }).userId ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(toId)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    if (toId === s.user.userId) {
      reply.code(400)
      return { error: 'cannot_leave_note_to_self' }
    }
    const b = req.body as Record<string, unknown> | undefined
    // 严格拒绝"伪造发送者"字段（审核记录 18，口径选择 **strict reject**，而不是静默忽略）。
    //
    // 为什么"忽略"不够：静默忽略会把接口契约模糊化 —— 调用方提交了一个无效字段
    // 却收到 201，会误以为这个参数生效了（实际作者来自 session，与它无关）；
    // 更危险的是将来若有人把 from_user_id 误接进业务逻辑（例如直接当插入值用），
    // 忽略式实现不会报错、只会**静默改变行为**，这类偏差在线上极难定位。
    // 契约上这个参数根本不该存在，所以只要**出现**就 400：
    // 用 hasOwnProperty 判断"字段存在"，与取值是否有效无关 ——
    // 即使提交的值恰好等于 session 用户，也一律拒绝（存在本身即违约）。
    const FORGED_SENDER_FIELDS = ['from_user_id', 'fromUserId', 'sender_id', 'senderId'] as const
    const forged = FORGED_SENDER_FIELDS.filter(
      (k) => b !== undefined && b !== null && Object.prototype.hasOwnProperty.call(b, k),
    )
    if (forged.length > 0) {
      reply.code(400)
      return {
        error: 'from_user_id_not_accepted',
        fields: forged,
        hint: 'author 永远来自 session',
      }
    }
    const text = typeof b?.body === 'string' ? b.body.trim() : ''
    if (!text || text.length > 200) {
      reply.code(400)
      return { error: 'bad_body' }
    }
    try {
      const exists = await db.pool.query('select 1 from users where id = $1', [toId])
      if (!exists.rowCount) {
        reply.code(404)
        return { error: 'not_found' }
      }
      const id = randomUUID()
      await db.pool.query(
        'insert into board_notes (id, from_user_id, to_user_id, body) values ($1, $2, $3, $4)',
        [id, s.user.userId, toId, text],
      )
      reply.code(201)
      return { id, fromUserId: s.user.userId, toUserId: toId, body: text }
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
//
// 用 pathToFileURL 而不是手拼 `file://${argv[1]}`：手拼那版在 Windows 上**恒为 false**
// —— file URL 里有盘符前导斜杠且路径要百分号转义（本地仓库路径 `G:\demo map\…` 含空格，
// 转义后是 `%20`），argv[1] 则是原生路径，两边永远不相等。
// 后果就是"直接 node dist/index.mjs 什么都不发生、静默退出 0"，本地无法起服务做端到端验证
// （服务器在 Linux 上路径无空格所以一直没暴露）。pathToFileURL 两种平台都给出规范 file URL，
// 语义与原来完全一致（import 时不启动），Linux 行为不变。
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  main().catch((err) => {
    console.error('[fatal]', err)
    process.exit(1)
  })
}
