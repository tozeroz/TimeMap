import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, rename, statfs, unlink, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import multipart, { type MultipartFile } from '@fastify/multipart'
import Fastify from 'fastify'
import { probeAudioWebm } from './audioProbe.ts'
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
import { createSmsSender, type SmsSender } from './sms.ts'
import { fakeVerify, verifyPassword } from './password.ts'
import { acquireMediaMutationLock, isBarrierTimeout } from './mutationBarrier.ts'
import { registerCutoutRoutes } from './cutout.ts'
import { registerTimemapRoutes } from './timemap.ts'

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
const DISPLAY_MAX = 40
const COMMENT_MAX = 500
const LIST_LIMIT = 50

/**
 * POST /api/posts 只接受这几个字段，多一个就 400。
 *
 * ⭐ WO#21（Round 319）：新增**可选** `mediaIds` —— 让发布页的**图片与语音**真正随帖入库。
 *   为什么需要它：在 Owner 裁定"④ 发布页语音真实录音必须实现体验等价"之后我去查后端，
 *   发现 **post_media 表存在、但服务端对它的引用全是 select**（没有任何接口能挂媒体），
 *   而 `PublishScreen.doPublish` 的注释自己写着"图片留在本地"。
 *   ⇒ 发布页的图片与语音**都只存在于本机**，从未随帖子进入服务器。
 *
 * ⚠️ **向后兼容**：`mediaIds` 可选；不传时行为与旧版**完全一致** ⇒ 既有 Gate/客户端不受影响。
 */
/**
 * F04（TimeMap P0）：发帖契约。
 *   · `placeId` **必填**且必须是管理员**启用**的预设地点（US-01/US-02：地点为必填项，
 *     只能选择启用地点）—— 旧的"自由文本 place 匹配"契约废除（那允许无地点发帖，
 *     与"所有帖子必须关联预设地点"冲突）。
 *   · `clientRequestId` 可选幂等键：客户端为一次逻辑发布生成 UUID，
 *     连续点击/网络重试时服务端按它去重（US-02：连续点击发布不得产生重复帖子）。
 *   · `mediaIds` 沿用 WO#21 契约（先上传、随帖一并挂）。
 */
const POST_ALLOWED_KEYS = ['body', 'placeId', 'mediaIds', 'clientRequestId', 'imageMode', 'mapMediaId'] as const

/** 一条帖子最多挂几个媒体（超出直接 400，**不静默截断**） */
const POST_MEDIA_MAX = 1

/**
 * PATCH /api/users/me 只接受这一个字段（M5 WO#13，审核记录 54 冻结的契约）。
 *
 * ⚠️ 关键点（审核 54 明确要求）：**bio / gender / tags / school 等字段不得被静默忽略**。
 *    如果它们被"接受但丢弃"，调用方会以为保存成功了 —— 那正是 WO#13 要消灭的那类
 *    "假写成功"，只是换到了服务端。因此未知字段一律 400，且错误里点名是哪些字段。
 */
const ME_PATCH_ALLOWED_KEYS = ['displayName'] as const

/** 就绪之前也放行的路径：它们本身就是用来"报告状态"的 */
const READINESS_EXEMPT = new Set(['/api/health', '/api/ready'])

interface PostRow {
  map_media_id?: string | null
  image_mode: 'photo' | 'sticker'
  id: string
  author_name: string
  author_id: string | null
  body: string
  place: string | null
  created_at: Date
  /**
   * ⭐ M5 WO#15：地点经纬度（来自 `left join places`）。
   * 可选：只有**做了该 join 的查询**才会有这两列（列表与详情有；其它查询没有）。
   * ⚠️ pg 的 numeric/double 可能以**字符串**返回 → 上层必须显式 Number() 转换，
   * 否则前端拿到字符串，地图 SDK 需要 number，会静默出错（标记跑到 0,0）。
   */
  place_lat?: string | number | null
  place_lng?: string | number | null
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
  /**
   * ⭐ 短信通道（阿里云「短信认证」PNVS）。
   * ⚠️ 它可能是 **未配置** 状态（`configured === false`）—— 那时 request-code
   *    **如实回退**到 dev sink，并在响应里标 `delivery: 'dev-sink'`。
   *    我们**绝不**在没真发短信时声称发过。
   */
  smsSender: SmsSender
  trustProxy?: string
}

/**
 * 上传根目录 —— **模块级单一来源**。
 *
 * 提升到模块级的原因（审核记录 24 的实现后果）：`main()` 需要在启动时验证它并自建 `.tmp`，
 * 而它原本只是 `buildServer` 内部的局部常量，`main()` 取不到。
 * 若在 `main()` 里再写一遍 `process.env.UPLOAD_ROOT ?? '/srv/campus/uploads'`，
 * 默认值就会变成**两处真相**（改一处忘另一处 → 启动自愈与实际写入落在不同目录）。
 */
const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? '/srv/campus/uploads'

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
  /**
   * 管理员密码登录的限流（按 手机号+IP）。
   *
   * ⚠️ 为什么单独一个、而且更严：这是**密码**接口，可以被离线/在线爆破。
   *    复用 verifyLimiter 会让"短信码失败次数"和"密码失败次数"互相影响
   *    （学生会因为管理员被爆破而被一起限流，反之亦然）—— 两件事必须分开计量。
   *    窗口与阈值沿用配置里的 loginVerifyMaxAttempts（默认 5 次 / 300s）。
   */
  const adminLoginLimiter = createRateLimiter(deps.loginVerifyMaxAttempts, deps.loginWindowSeconds * 1000)

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (typeof origin === 'string' && allowed.has(origin)) {
      reply.header('access-control-allow-origin', origin)
      reply.header('vary', 'Origin')
      /*
        ⚠️ **必须包含所有已注册的方法**（M5 WO#13 踩到两次同类问题）：
          · 加 PATCH /api/users/me 时忘了加 PATCH → 设备上"保存"100% 失败
          · 而 **DELETE 从一开始就缺**：`app.delete('/api/posts/:id/like')`（取消点赞）
            注册了，但这里没有 DELETE → 跨域（Capacitor WebView, origin=https://localhost）
            下 DELETE 会先发预检、预检未列 DELETE → fetch 报 **"Failed to fetch"**。
            ⚠️ 注意：DELETE **不是** CORS 简单方法，**无论有没有自定义头都必触发预检**，
            所以它比 PATCH 更早、更稳定地坏掉 —— 而点赞（POST，无 body 时客户端不带
            content-type）是简单请求、不触发预检，所以**点赞正常、只有取消点赞坏**。
            设备实测（scripts/m5/diagnose-unlike-cors.mjs）：
              POST(点赞)   → 正常（简单请求）
              DELETE(取消) → **"Failed to fetch"**  ← 用户可见的功能性缺陷，长期存在
        为什么服务端脚本测不出来：curl/psql **不带 CORS 语义、根本不发预检**。
        → 已加机械门禁 scripts/m5/check-cors-methods.sh：
            从部署产物提取已注册方法，逐一断言它们都在 allow-methods 里。
            它上线当天就抓到了这个 DELETE 缺失（我原本只修了 PATCH）。
      */
      reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
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
    /** F01/F07：student | admin。管理端路由靠它做服务端强校验 */
    role: string
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
        role: string
      }>(
        `select s.id as session_id, u.id as user_id, u.handle, u.display_name, u.phone_e164, u.role
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
          role: row.role,
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
     * 投递：优先走**真实短信通道**（阿里云「短信认证」）；未配置时才回退 dev sink。
     *
     * ⚠️⚠️ 这里的分支必须**如实反映现实**（这是本项目反复强调的纪律）：
     *   · 真发了短信 ⇒ `delivery: 'sms'`，**不**再给 sink 路径（那等于把码又泄一份到磁盘）
     *   · 没配短信 ⇒ `delivery: 'dev-sink'`，**明确写出**没接短信通道，并给出取码路径
     *   · 配了但**发送失败** ⇒ 返回错误（503），**绝不**退回 dev sink 糊过去 ——
     *     否则"渠道坏了"会表现为"用户收到了码"（假成功）。
     *
     * 注意：**绝不把验证码写进日志**（审核记录 08 第 2 点）。
     */
    if (deps.smsSender.configured) {
      const sent = await deps.smsSender.sendVerifyCode(phone, code, deps.loginCodeTtlSeconds)
      if (!sent.ok) {
        /*
          ⚠️ 失败时**不再**把码写进 sink：能发短信的部署不应在磁盘上留一份明文码
             （dev sink 存在的前提是"没有真实通道"）。
          ⚠️ 也**不**泄露 code 本身，只给错误码与原因，便于排障。
        */
        reply.code(503)
        return {
          error: 'sms_delivery_failed',
          reason: sent.code,
          message: sent.message,
          delivery: 'sms',
        }
      }
      return {
        ok: true,
        phone,
        expiresAt: expiresAt.toISOString(),
        delivery: 'sms',
        delivery_note: '验证码已通过短信下发（阿里云短信认证）',
        /*
          ⭐ 把**短信签名**告诉客户端。
          为什么必须这么做：短信签名是阿里云 PNVS **系统赠送的**（官方明确不支持自定义），
          所以用户收到的是「【恒创联众】您的验证码为…」——**看不出是我们的 App**。
          客户端改不了短信内容，但可以提示用户"该等哪条短信"。
          ⚠️ 由服务端给（不是客户端写死）：运维换签名时提示自动跟上，不会变成假话。
        */
        sms_sender: deps.smsSender.signName,
      }
    }

    /* ── 未配置短信通道 ⇒ 如实回退 dev sink ── */
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
    let user: UserRow & { role: string } | undefined
    try {
      const r = await db.pool.query<UserRow & { role: string }>(
        'select id, handle, display_name, role from users where phone_e164 = $1',
        [phone],
      )
      user = r.rows[0]
      if (!user) {
        const id = randomUUID()
        // 昵称走 onboarding 页设置（原版有 login/onboarding）；这里给一个明确的占位名
        const placeholder = `校园用户${phone.slice(-4)}`
        const r2 = await db.pool.query<UserRow & { role: string }>(
          `insert into users (id, handle, display_name, phone_e164)
           values ($1, $2, $3, $4)
           returning id, handle, display_name, role`,
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
      user: { id: user.id, handle: user.handle, displayName: user.display_name, phone, role: user.role },
    }
  })

  /**
   * 管理员密码登录（017）。
   *
   * ## 为什么需要它
   *   管理端是"出事了要进去处理"的地方，而原先它唯一的凭据路径是**短信验证码**。
   *   实测踩到：线上短信通道故障（`503 sms_delivery_failed`）⇒ 谁也登不进去 ⇒ 管理端完全不可达。
   *   把管理能力绑在一条依赖第三方通道的路径上，等于给它加了一个单点故障。
   *   ⇒ 恢复**第二条**路径（不是替换掉验证码那条）。
   *
   * ## 安全边界（四条都要看，少一条就是漏洞）
   *   ① **只认 role='admin'**：查库时把 role 一起选出来，非 admin 直接走 fakeVerify 后拒绝。
   *   ② **不泄露账号状态**：手机号不存在 / 存在但不是管理员 / 密码错 —— 三种情况返回
   *      **完全相同**的 401 与同一句话。否则这个接口就成了"哪些手机号是管理员"的探测器。
   *   ③ **等价耗时**：失败路径也跑一次 scrypt（`fakeVerify`），否则响应时间能区分出前三种情况。
   *   ④ **独立限流**：见 adminLoginLimiter 的说明。
   *
   * ## 明确不做的事
   *   · **不**给学生开密码登录（学生账号 password_hash 恒为 NULL，这里也要求 role=admin）
   *   · **不**在没有密码时给任何默认值（没有默认密码、没有后门；没设过密码就是登不上）
   */
  app.post('/api/auth/admin-login', async (req, reply) => {
    const payload = (req.body ?? {}) as Record<string, unknown>
    const phoneRaw = typeof payload.phone === 'string' ? payload.phone : ''
    const password = typeof payload.password === 'string' ? payload.password : ''
    const phone = normalizePhone(phoneRaw)
    if (!phone || !password) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['需要手机号与密码'] }
    }

    const limitKey = `${req.ip}|${phone}`
    const limited = adminLoginLimiter.hit(limitKey)
    if (limited.limited) {
      reply.header('retry-after', String(limited.retryAfterS))
      reply.code(429)
      return { error: 'too_many_attempts', retryAfterS: limited.retryAfterS }
    }

    // 统一失败响应：三种失败原因共用同一句话（见边界②）
    const deny = (): { error: string } => {
      adminLoginLimiter.fail(limitKey)
      reply.code(401)
      return { error: 'invalid_credentials' }
    }

    type AdminRow = { id: string; handle: string; display_name: string; role: string; password_hash: string | null }
    let row: AdminRow | undefined
    try {
      const r = await db.pool.query<AdminRow>(
        'select id, handle, display_name, role, password_hash from users where phone_e164 = $1',
        [phone],
      )
      row = r.rows[0]
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }

    // 边界①③：不是管理员（含不存在）⇒ 也跑一次等价耗时，再拒绝
    if (!row || row.role !== 'admin') {
      await fakeVerify(password)
      return deny()
    }
    const okPassword = await verifyPassword(password, row.password_hash)
    if (!okPassword) return deny()

    adminLoginLimiter.reset(limitKey)

    const token = newSessionToken()
    const expiresAt = new Date(Date.now() + deps.sessionTtlDays * 24 * 60 * 60 * 1000)
    try {
      await db.pool.query(
        `insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, $4)`,
        [randomUUID(), row.id, tokenHash(token), expiresAt],
      )
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: row.id, handle: row.handle, displayName: row.display_name, phone, role: row.role },
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
      role: s.user.role,
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
  // 用户（最小只读身份查询 —— M5 WO#12，审核记录 53 批准）
  // -------------------------------------------------------------------------

  /*
    ## 为什么需要它
      WO#12 修的是"点真实作者却显示成另一个 mock 用户"的**假身份**缺陷。
      修完之后，"他人主页"要显示**真实昵称**，就必须有一个**按 user id 查权威资料**的入口 ——
      而此前路由清单里没有任何 /api/users/:id（只有 /api/auth/me 返回"自己"）。

    ## 边界（审核记录 53 明确冻结）
      · **只返回两个字段**：`{ id, displayName }`
        —— **不**顺手把 phone / campus / 学院 / 年级之类放进来（那些要么没有权威来源，
           要么属于不该对任意登录用户暴露的信息）。
      · 未知 id → **404 `not_found`**（与既有"不区分不存在与无权"的口径一致）
      · 形状非法（非 uuid）→ 404（与其它 :id 端点同一处理：不做"格式错误 vs 不存在"的区分，
        避免把"id 空间里有哪些值"变成可探测的）

    ## 为什么它不是"为了 UI 临时造数据"
      displayName 已经通过帖子作者（/api/posts 的 author）与群成员（/api/threads/:id 的 members[]）
      向用户展示过，所以它**本来就是可展示的**；本接口只是提供一个
      "按 user identity 稳定查询"的权威读模型，不引入新的数据类别。
  */
  app.get('/api/users/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    /*
      与 /api/posts 同一档：**不要求登录**（该接口本身就是公开帖子里已展示过的信息）。
      但会话解析仍要走一遍，以便 DB 不可用时给出**可重试的 503**，而不是把
      "数据库挂了"伪装成"这个用户不存在"（那会让客户端做出错误的降级决定）。
    */
    const sess = await resolveSession(req.headers.authorization)
    if (sess.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    try {
      const r = await db.pool.query<{ id: string; display_name: string }>(
        'select id, display_name from users where id = $1',
        [id],
      )
      const row = r.rows[0]
      if (!row) {
        reply.code(404)
        return { error: 'not_found' }
      }
      // 只这两个字段（审核 53：当前阶段只允许这两个）
      return { id: row.id, displayName: row.display_name }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /*
    -------------------------------------------------------------------------
    PATCH /api/users/me —— profile-update 写能力（M5 WO#13，审核记录 54 批准）
    -------------------------------------------------------------------------

    ## 为什么需要它
      WO#13 修的是 ProfileEditScreen 的**假写成功**：saveEdit() 只 setState、零网络请求，
      而界面**确实显示新值** → 用户以为改成功了。而该页从「我的」页**一步可达**
      （MeScreen 5 个入口），所以这不是"未接线"，是**向用户谎报持久写入已成功**。

    ## 契约（审核记录 54 冻结，逐条落实）
      · **仅登录用户**（未登录 → 401）
      · body **严格只接受** `{ displayName: string }`；出现任何其它字段 → **400**，
        并在 details 里点名是哪些字段 —— **不得静默忽略**（静默忽略会让调用方以为保存了，
        只是把"假写成功"从客户端搬到了服务端）
      · **user id 一律来自会话**，客户端**不能**提交"我要改哪个 user"
        （body 里出现 id/userId 之类会被上面的严格检查直接 400 —— 归属必须可机械验证）
      · 成功 → **200 + `{ id, displayName }`**，且 displayName 是**服务端库里刚写入的值**
        （不是回显请求体：回显请求体会在"写入失败但回显成功"时骗过客户端）
      · 失败 → 明确的 4xx/5xx，**且零写入**

    ## 保存链（审核 54 冻结的语义）
      draft → PATCH → DB mutation → **authoritative server response** → UI commit
      PATCH 失败 → **保留 draft** → 权威值不变 → **不得出现成功表象**

    ## 边界（不夸大）
      · 只支持 displayName 一个字段。bio / gender / tags / campus-card / school **不加列**、
        也不接收（审核 54：没有权威 schema、没有页面内容基线，不应反推数据模型）。
      · 它**不**改变任何读取路径；GET /api/auth/me 与 GET /api/users/:id 会自动反映新值。
  */
  app.patch('/api/users/me', async (req, reply) => {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    const session = s.user

    const payload = (req.body ?? {}) as Record<string, unknown>

    // strict schema：只允许 displayName（与 POST /api/posts 同一纪律）
    const extra = Object.keys(payload).filter(
      (k) => !(ME_PATCH_ALLOWED_KEYS as readonly string[]).includes(k),
    )
    if (extra.length) {
      reply.code(400)
      return {
        error: 'invalid_payload',
        details: [
          `不支持字段: ${extra.join(', ')}（当前只支持 displayName；用户由服务端会话决定）`,
        ],
      }
    }

    const raw = typeof payload.displayName === 'string' ? payload.displayName.trim() : ''
    const errors: string[] = []
    if (!raw) errors.push('displayName 不能为空')
    else if (raw.length > DISPLAY_MAX) errors.push(`displayName 不能超过 ${DISPLAY_MAX} 字`)
    if (errors.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: errors }
    }

    try {
      /*
        用 `returning` 取回**库里的新值**再返回 —— 而不是回显 raw。
        这样"响应里的 displayName == 数据库里的 displayName"成为结构性事实，
        客户端的 UI commit 就必然基于权威值（审核 54 要求的 authoritative server response）。
      */
      const r = await db.pool.query<{ id: string; display_name: string }>(
        'update users set display_name = $2, updated_at = now() where id = $1 returning id, display_name',
        [session.userId, raw],
      )
      const row = r.rows[0]
      if (!row) {
        // 会话有效但用户行不存在（理论不该发生）→ 明确报错，不假装成功
        reply.code(500)
        return { error: 'user_row_missing', message: '会话有效但用户行不存在' }
      }
      return { id: row.id, displayName: row.display_name }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
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

    /*
      ---- M5 WO#12：可选的 `authorId` 过滤（审核记录 53 批准的最小 read extension）----

      ## 为什么必须放在**服务端**而不是客户端过滤
        客户端 `posts.filter(p => p.authorId === id)` 只有在 `/api/posts` **永远返回完整全集**
        时才等价于"TA 的全部动态"。一旦列表加了分页/limit，客户端过滤会**静默变成**
        "不完整但看起来完整"——而用户无法察觉。服务端过滤没有这个问题。

      ## 形状检查放在**连库之前**（与既有 mediaId 的处理同一纪律）
        `authorId` 必须是合法 uuid；非法 → **400 `bad_author_id`**（显式拒绝，不静默忽略：
        静默忽略会让调用方拿到"全部帖子"却以为是"某人的帖子"）。
        合法 uuid 但该用户没有帖子 → 200 + `items: []`（这是诚实的空结果，不是错误）。
    */
    const authorIdRaw = (req.query as { authorId?: unknown } | undefined)?.authorId
    let authorId: string | null = null
    if (authorIdRaw !== undefined) {
      if (typeof authorIdRaw !== 'string' || !/^[0-9a-f-]{36}$/i.test(authorIdRaw)) {
        reply.code(400)
        return { error: 'bad_author_id', got: typeof authorIdRaw === 'string' ? authorIdRaw : typeof authorIdRaw }
      }
      authorId = authorIdRaw
    }

    /*
      ---- CAMP-002 / PLACE-002：排序（`sort`）与地标过滤（`placeId` / `placeIds`）----

      ## 为什么排序必须在服务端
        "热门"是**全量**排序口径（点赞/评论/收藏加权 + 时间衰减），客户端只能对
        已经取回的那一页重排 —— 那不是"热门"，是"这一页里最热的"。
        `LIST_LIMIT` 一旦小于总帖数，客户端排序就会把榜外的热帖永久藏起来。

      ## 口径与地点面板（`/api/places/:id`）必须**逐项一致**
        点赞×2 + 有效评论×3 + 收藏×1 − max(0, 距发布小时数 − 24)。
        两处如果口径不同，同一个帖子在"校园流热门"和"地点面板热门"里的顺序会互相矛盾
        —— 用户看不出为什么，只会觉得排序坏了。

      ## 为什么 hot 不套"近 7 天"窗口
        地点面板的 hot 有 7 天窗口（`out-of-hot-window` 空态），是因为它只显示"少量"帖子。
        校园流是主列表，套 7 天窗口会在冷清时段变成"空页面"——比排序不完美更糟。
        所以这里 hot = 全部已发布帖子按分数排序，时间衰减已经承担了"让旧帖下沉"的职责。

      ## placeIds 的语义（CAMP-003）
        多选 = "属于任意一个所选地标"（需求 §6.3 的建议口径），因此是 `= any($n::uuid[])`。
        空数组 = 不过滤（等价"全部地标"）。非法 id → 400 `bad_place_id`（显式拒绝，
        不做静默忽略：静默忽略会让调用方看见"全部帖子"却以为筛过了）。
    */
    const query = req.query as { sort?: unknown; placeId?: unknown; placeIds?: unknown } | undefined
    const sortRaw = query?.sort
    let sort: 'latest' | 'hot' = 'latest'
    if (sortRaw !== undefined) {
      if (sortRaw !== 'latest' && sortRaw !== 'hot') {
        reply.code(400)
        return { error: 'bad_sort', got: typeof sortRaw === 'string' ? sortRaw : typeof sortRaw }
      }
      sort = sortRaw
    }

    const placeIdsRaw: unknown[] =
      query?.placeIds !== undefined
        ? (typeof query.placeIds === 'string' ? query.placeIds.split(',') : Array.isArray(query.placeIds) ? (query.placeIds as unknown[]) : [query.placeIds])
        : query?.placeId !== undefined
          ? [query.placeId]
          : []
    const placeIds: string[] = []
    for (const raw of placeIdsRaw) {
      const v = typeof raw === 'string' ? raw.trim() : ''
      if (!v) continue
      if (!/^[0-9a-f-]{36}$/i.test(v)) {
        reply.code(400)
        return { error: 'bad_place_id', got: v }
      }
      if (!placeIds.includes(v)) placeIds.push(v)
    }

    /*
      外层包一个子查询，是为了直接对聚合出来的三个文本列做算术（`q.like_count::int`），
      不必在 ORDER BY 里重复写三遍 `(select count(*) ...)` 子查询。
    */
    const orderBy =
      sort === 'hot'
        ? `(q.like_count::int * 2 + q.comment_count::int * 3 + q.favorite_count::int
            - greatest(0, extract(epoch from (now() - q.created_at)) / 3600 - 24)) desc,
           q.created_at desc, q.id desc`
        : 'q.created_at desc, q.id desc'

    try {
      const r = await db.pool.query<
        PostRow & {
          like_count: string
          comment_count: string
          liked_by_me: boolean
          images: unknown
          /* ⭐ 审核 68 P0：audio 与 images **分开**（images 里不得出现 audio） */
          audio: unknown
          place_id: string | null
          favorite_count: string
          favorited_by_me: boolean
        }
      >(
        `select * from (
        select (select pm.media_id from post_media pm where pm.post_id = p.id and pm.purpose = 'map') as map_media_id, p.image_mode, p.id, p.author_name, p.author_id, p.body, p.place, p.created_at, p.place_id,
                -- ⭐ M5 WO#15（审核 57 批准）：地点的**经纬度**。
                -- 为什么需要：地图页的标记按经纬度渲染（默认 provider=tencent 用
                -- projectToContainer(LatLng)；RealMap 用 L.marker([lat,lng])），
                -- 而前端此前只能拿到 place（地名文本）——**拿不到坐标就无法把 mock 换成权威**。
                -- 为什么用 left join 而不是取 posts 自己的列：posts 表没有坐标列，
                -- 坐标存在 places 表（原版 poi-search 基线也证明地点是 name+address 的实体）。
                -- 为什么只补两个数字、不返回 address/内部 id：与 WO#12/#13 的
                -- "只暴露必要字段"一致；本页只需要能定位。
                -- 无地点（place_id 为空）或地点不存在 → null（**不伪造 0,0**）。
                pl.latitude  as place_lat,
                pl.longitude as place_lng,
                (select count(*) from likes l where l.post_id = p.id)::text as like_count,
                -- F05/US-03：删除后不计入有效评论量 → 只统计 published 状态的评论
                (select count(*) from comments c where c.post_id = p.id and c.status='published')::text as comment_count,
                (select count(*) from favorites f where f.post_id = p.id)::text as favorite_count,
                exists (
                  select 1 from likes l2
                   where l2.post_id = p.id and l2.user_id = $2::uuid
                ) as liked_by_me,
                exists (
                  select 1 from favorites f2
                   where f2.post_id = p.id and f2.user_id = $2::uuid
                ) as favorited_by_me,
                -- M4：帖子的**公**图片（public scope）。
                -- 只取 public：private 是聊天媒体，结构上不可能通过 post_media 关联
                -- （迁移 006 的复合外键钉死了 scope），这里再显式过滤一次是防御性写法。
                -- 只返回 id/尺寸，不返回 storage_key —— 客户端统一用 /api/media/:id 取图，
                -- 不把存储路径暴露给前端（以后换对象存储也不用改客户端）。
                -- ⭐⭐ 审核 68 P0（我引入的真实缺陷）：**按 mime 分流**，images 里不得出现 audio。
                --    改前这里把所有 post_media 行都放进 images ⇒ 语音会被报成图片。
                coalesce((
                  select json_agg(json_build_object('id', m.id, 'width', m.width, 'height', m.height) order by pm.position)
                    from post_media pm
                    join media m on m.id = pm.media_id
                   where pm.post_id = p.id and pm.purpose = 'post' and m.scope = 'public' and m.mime like 'image/%'
                ), '[]'::json) as images,
                coalesce((
                  select json_agg(json_build_object('id', m.id, 'mime', m.mime, 'durationMs', m.duration_ms) order by pm.position)
                    from post_media pm
                    join media m on m.id = pm.media_id
                   where pm.post_id = p.id and pm.purpose = 'post' and m.scope = 'public' and m.mime = 'audio/webm'
                ), '[]'::json) as audio
           from posts p
           -- ⭐ WO#15：地点坐标来自 places（left join，缺地点时两列为 null）
           left join places pl on pl.id = p.place_id
          where ($3::uuid is null or p.author_id = $3::uuid)
            -- F07/US-08：下架/删除的帖子同步退出所有公开面
            and p.status = 'published'
            -- CAMP-003：空数组 = 不过滤（"全部地标"）
            and (cardinality($4::uuid[]) = 0 or p.place_id = any($4::uuid[]))
        ) q
        order by ${orderBy}
        limit $1`,
        [LIST_LIMIT, meId, authorId, placeIds],
      )
      return {
        items: r.rows.map((row) => ({
          id: row.id,
          author: row.author_name,
          // M1 历史帖子为 null（当时没有可信身份，不伪造归属）
          authorId: row.author_id,
          body: row.body,
          imageMode: row.image_mode,
          mapMediaId: row.map_media_id ?? null,
            place: row.place,
          // F02：关联地点的权威 id（地点详情/地点页跳转用）
          placeId: row.place_id,
          // ⭐ WO#15：地点坐标（可为 null）。**注意 pg 的 numeric 会以字符串返回**，
          //    所以这里显式 Number() 转换 —— 否则前端拿到 "39.9519" 字符串，
          //    而地图 SDK 的 LatLng 需要 number（静默的类型错误会变成"标记全在 0,0"）。
          placeLat: row.place_lat === null ? null : Number(row.place_lat),
          placeLng: row.place_lng === null ? null : Number(row.place_lng),
          createdAt: row.created_at.toISOString(),
          // M3 Slice 2：列表卡片需要显示计数与"我点过没"
          likeCount: Number.parseInt(row.like_count ?? '0', 10),
          commentCount: Number.parseInt(row.comment_count ?? '0', 10),
          likedByMe: row.liked_by_me,
          // F05：收藏计数与"我收藏过没"
          favoriteCount: Number.parseInt(row.favorite_count ?? '0', 10),
          favoritedByMe: row.favorited_by_me,
          // M4：帖子图片（只给 id 与尺寸；客户端用 /api/media/:id 取图）
          images: row.images ?? [],
          /* ⭐ 审核 68 P0：audio 独立返回（语音不会被报成图片） */
          audio: row.audio ?? [],
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
    const placeIdRaw = typeof payload.placeId === 'string' ? payload.placeId.trim() : ''
    const clientRequestIdRaw =
      typeof payload.clientRequestId === 'string' ? payload.clientRequestId.trim() : ''

    const errors: string[] = []
    if (Array.from(body).length > BODY_MAX) errors.push(`body 不能超过 ${BODY_MAX} 字`)
    // US-02：地点为必填项
    if (!placeIdRaw) errors.push('placeId 不能为空（所有帖子必须关联预设地点）')
    else if (!/^[0-9a-f-]{36}$/i.test(placeIdRaw)) errors.push('placeId 必须是合法地点 id')
    if (clientRequestIdRaw && !/^[0-9a-f-]{36}$/i.test(clientRequestIdRaw))
      errors.push('clientRequestId 必须是 UUID')

    /*
      ⭐ WO#21：可选 mediaIds 的解析与校验。
      ⚠️ 一律"**拒绝**"而不是"忽略" —— 与既有契约一致（strict schema：错就 400，不静默丢字段）。
      校验三道：
        ① 形状：数组、元素是 uuid 字符串、数量 ≤ POST_MEDIA_MAX、**无重复**
        ② 存在性与 scope：必须存在且 scope='public'
           （post_media 的复合外键本来就把 scope 钉死为 public ⇒ private 的聊天媒体挂不上，
             这里显式判一次是为了给出**可读的 400**而不是让 DB 抛外键错）
        ③ ⭐ **归属**：必须属于**当前会话用户**
           ⚠️ 这是 OUR_DESIGN_CHOICE：原版是否也这样**未观察**；但不做的话
              任何登录用户都能把**别人的**媒体挂到自己帖子上（越权引用）。
              安全优先 ⇒ 做，并在提交审核时明确标注这一点。
    */
    let mediaIds: string[] = []
    if (payload.mediaIds !== undefined) {
      if (!Array.isArray(payload.mediaIds)) {
        errors.push('mediaIds 必须是字符串数组')
      } else if (payload.mediaIds.length > POST_MEDIA_MAX) {
        errors.push(`mediaIds 最多 ${POST_MEDIA_MAX} 个`)
      } else if (!payload.mediaIds.every((v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v))) {
        errors.push('mediaIds 含非法 id')
      } else {
        mediaIds = payload.mediaIds as string[]
        if (new Set(mediaIds).size !== mediaIds.length) errors.push('mediaIds 不能重复')
      }
    }

    const mapMediaId = payload.mapMediaId
    if (mapMediaId !== undefined && (typeof mapMediaId !== 'string' || !/^[0-9a-f-]{36}$/i.test(mapMediaId) || mediaIds.length !== 1 || mediaIds.includes(mapMediaId))) {
      errors.push('mapMediaId 必须是独立的地图图片，且同时关联一张帖子图片')
    }
    const allMediaIds = typeof mapMediaId === 'string' ? [...mediaIds, mapMediaId] : mediaIds
    if (!body && mediaIds.length === 0) errors.push('正文和图片不能同时为空')
    const imageMode = payload.imageMode ?? 'photo'
    if (imageMode !== 'photo' && imageMode !== 'sticker') errors.push('imageMode 无效')
    if (imageMode === 'sticker' && mediaIds.length !== 1) errors.push('贴纸必须关联一张图片')
    if (errors.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: errors }
    }

    const id = randomUUID()
    const placeId = placeIdRaw
    const clientRequestId = clientRequestIdRaw || null

    try {
      /*
        F04 幂等（US-02：连续点击发布不得产生重复帖子）：
        同一 clientRequestId 已成功建过帖 → 直接返回**原帖**（200 + idempotentReplay），
        不再插入第二条。并发下由 posts_client_request_id_uniq 唯一索引兜底。
      */
      if (clientRequestId) {
        const dup = await db.pool.query<{ id: string }>(
          'select id from posts where client_request_id = $1 and author_id = $2',
          [clientRequestId, session.userId],
        )
        if (dup.rows[0]) {
          return {
            id: dup.rows[0].id,
            idempotentReplay: true,
          }
        }
      }

      /*
        F02/US-01：地点必须是**管理员启用**的预设地点。
        停用地点不能再关联新帖子；不存在/停用都以 400 明确拒绝（不静默降级为无地点帖）。
        同时取地点名做**展示快照**（posts.place），用户改名地点不影响历史帖的展示。
      */
      const placeRow = await db.pool.query<{ name: string; enabled: boolean }>(
        'select name, enabled from places where id = $1',
        [placeId],
      )
      if (!placeRow.rows[0]) {
        reply.code(400)
        return { error: 'invalid_payload', details: ['关联的地点不存在'] }
      }
      if (!placeRow.rows[0].enabled) {
        reply.code(400)
        return { error: 'invalid_payload', details: ['该地点已停用，不能再关联新帖子'] }
      }
      const placeName = placeRow.rows[0].name

      /*
        ⭐ WO#21：把"插帖 + 挂媒体"放进**同一个事务**。
        为什么必须原子：若先插帖成功、挂媒体失败，就会留下一条**少图的帖子**，
        而客户端拿到的是 201 ⇒ 用户以为发出去了、图片却永久丢了（且没有任何自愈路径）。

        ⚠️ 媒体校验（存在性 / scope=public / **归属当前会话用户**）放在事务**内**，
          在插入前完成；任一不合法 ⇒ 400 并回滚，不留下半条帖子。

        用 `db.pool.connect()` + begin/commit 的写法与既有的 POST /api/media（行 ~1787）一致。
      */
      const client = await db.pool.connect()
      let inserted = false
      try {
        await client.query('begin')

        if (allMediaIds.length > 0) {
          const mr = await client.query<{ id: string; owner_user_id: string; scope: string; mime: string }>(
            'select id, owner_user_id, scope, mime from media where id = any($1::uuid[])',
            [allMediaIds],
          )
          const byId = new Map(mr.rows.map((x) => [x.id, x]))
          for (const mid of allMediaIds) {
            const m = byId.get(mid)
            if (!m) {
              await client.query('rollback')
              reply.code(400)
              return { error: 'invalid_media', details: [`媒体不存在: ${mid}`] }
            }
            if (m.scope !== 'public' || !m.mime.startsWith('image/') || (imageMode === 'sticker' && m.mime !== 'image/png')) {
              await client.query('rollback')
              reply.code(400)
              return { error: 'invalid_media', details: [`媒体必须是公共图片，贴纸必须为PNG（scope=${m.scope}）: ${mid}`] }
            }
            /* ⭐ 归属校验 —— 不允许把**别人**的媒体挂到自己的帖子上（OUR_DESIGN_CHOICE，安全优先） */
            if (m.owner_user_id !== session.userId) {
              await client.query('rollback')
              reply.code(403)
              return { error: 'media_not_owned', details: [`该媒体不属于当前用户: ${mid}`] }
            }
          }
        }

        // 作者完全来自服务端会话；author_name 存为快照（用户以后改名也保留当时的展示名）
        // F04：place_id 必填（上面已校验启用）；place 为地点名快照；client_request_id 幂等键
        const r = await client.query<PostRow>(
          `insert into posts (id, author_name, author_id, body, place, place_id, client_request_id, image_mode)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning image_mode, id, author_name, author_id, body, place, created_at`,
          [id, session.displayName.slice(0, DISPLAY_MAX), session.userId, body, placeName, placeId, clientRequestId, imageMode],
        )

        /* 挂媒体：position 按传入顺序递增（0..n-1），与 GET 的口径一致 */
        for (let i = 0; i < mediaIds.length; i++) {
          await client.query(
            'insert into post_media (post_id, media_id, media_scope, position) values ($1, $2, $3, $4)',
            [id, mediaIds[i], 'public', i],
          )
        }

        if (typeof mapMediaId === 'string') {
          await client.query("insert into post_media (post_id, media_id, media_scope, position, purpose) values ($1, $2, 'public', 1, 'map')", [id, mapMediaId])
        }

        await client.query('commit')
        inserted = true

        const row = r.rows[0]!
        row.map_media_id = typeof mapMediaId === 'string' ? mapMediaId : null
        /*
          响应里带回媒体 —— 与 `GET /api/posts/:id` **同一形状**，这样客户端发布后
          不需要再发一次请求就能把媒体渲染出来。

          ⭐⭐ 审核 68 的 P0（**我引入的真实缺陷**）：改前这里把 post_media 里**所有**行
          一律报成 `images: [{id,width,height}]` ⇒ **一条语音帖会把 audio 也报成 image**
          （width/height 为 null）。读模型必须**按 mime 分流**：
            · `images` = `mime like 'image/%'` → `{id,width,height}`
            · `audio`  = `mime = 'audio/webm'` → `{id,mime,durationMs}`
          判据（审核 68 原文）："**audio still represented as audio** → **audio NOT in images**"。
          ⚠️ 用 `mime` 而不是"靠 width/height 是否为空"来判 —— 后者是**推断**，
             一旦将来有"无尺寸的图片"就会误判；mime 是**事实**。
        */
        const mediaRes = await db.pool.query<{
          id: string
          mime: string
          width: number | null
          height: number | null
          duration_ms: number | null
        }>(
          `select m.id, m.mime, m.width, m.height, m.duration_ms
             from post_media pm join media m on m.id = pm.media_id
            where pm.post_id = $1 and pm.purpose = 'post' and m.scope = 'public'
            order by pm.position`,
          [id],
        )
        const images = mediaRes.rows
          .filter((m) => m.mime.startsWith('image/'))
          .map((m) => ({ id: m.id, width: m.width, height: m.height }))
        const audio = mediaRes.rows
          .filter((m) => m.mime === 'audio/webm')
          .map((m) => ({ id: m.id, mime: m.mime, durationMs: m.duration_ms }))
        reply.code(201)
        return {
          id: row.id,
          author: row.author_name,
          authorId: row.author_id,
          body: row.body,
          imageMode: row.image_mode,
          mapMediaId: row.map_media_id ?? null,
            place: row.place,
          createdAt: row.created_at.toISOString(),
          /* ⭐ 审核 68 P0：按 mime 分流（images 里**不得**出现 audio） */
          images,
          audio,
        }
      } catch (e) {
        /* ⚠️ commit 之前失败才回滚；commit 之后失败说明帖已落库，不能再 rollback */
        if (!inserted) await client.query('rollback').catch(() => undefined)
        throw e
      } finally {
        client.release()
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
  // 1:1 依据（原版实测，见 docs/pending/m3/MODEL-VALIDATION.md §2.7 与 supplements/comment-detail.json）：
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
          where c.post_id = $1 and c.parent_id is null and c.status = 'published'
         union all
         select c.id, t.root_id, c.parent_id, t.depth + 1
           from comments c
           join tree t on c.parent_id = t.id
          where t.depth < 20 and c.status = 'published'
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
        order by t.root_id, t.depth, c.created_at, c.id`,
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
      const pr = await db.pool.query<PostRow & { status: string; place_id: string | null }>(
        `select (select pm.media_id from post_media pm where pm.post_id = p.id and pm.purpose = 'map') as map_media_id, p.image_mode, p.id, p.author_name, p.author_id, p.body, p.place, p.created_at, p.status, p.place_id,
                -- ⭐ WO#15：详情也要带地点坐标（原版 poi-detail 页有「距我N公里」，
                -- 那需要地点经纬度 + 客户端自身位置）。
                pl.latitude as place_lat, pl.longitude as place_lng
           from posts p
           left join places pl on pl.id = p.place_id
          where p.id = $1`,
        [id],
      )
      const post = pr.rows[0]
      if (!post) {
        reply.code(404)
        return { error: 'not_found' }
      }
      /*
        F07/US-08：已下架的帖子 → 410 gone。
        详情页据此显示"内容不存在或已下架"状态页（**不**返回正文——下架内容必须
        同步退出所有公开面，包括详情）。
      */
      if (post.status !== 'published') {
        reply.code(410)
        return { error: 'gone', reason: '内容不存在或已下架' }
      }
      const cr = await db.pool.query<{ n: string }>(
        "select count(*)::text as n from comments where post_id = $1 and status='published'",
        [id],
      )
      const like = await likeStateFor(id, meId)
      // F05：收藏状态
      const favCount = await db.pool.query<{ n: string }>(
        'select count(*)::text as n from favorites where post_id = $1',
        [id],
      )
      let favoritedByMe = false
      if (meId) {
        const fm = await db.pool.query<{ exists: boolean }>(
          'select exists(select 1 from favorites where post_id = $1 and user_id = $2) as exists',
          [id, meId],
        )
        favoritedByMe = fm.rows[0]?.exists ?? false
      }
      // M4：详情也要带图片（与列表同口径：只取 public，只给 id 与尺寸）
      /*
        ⭐⭐ 审核 68 P0（我引入的真实缺陷）：按 mime 分流，**images 里不得出现 audio**。
        改前这里把所有 post_media 行都塞进 images ⇒ 语音会被报成图片。
      */
      const imgs = await db.pool.query<{
        id: string
        mime: string
        width: number | null
        height: number | null
        duration_ms: number | null
      }>(
        `select m.id, m.mime, m.width, m.height, m.duration_ms
           from post_media pm
           join media m on m.id = pm.media_id
          where pm.post_id = $1 and pm.purpose = 'post' and m.scope = 'public'
          order by pm.position`,
        [id],
      )
      const images = imgs.rows
        .filter((m) => m.mime.startsWith('image/'))
        .map((m) => ({ id: m.id, width: m.width, height: m.height }))
      const audio = imgs.rows
        .filter((m) => m.mime === 'audio/webm')
        .map((m) => ({ id: m.id, mime: m.mime, durationMs: m.duration_ms }))
      return {
        id: post.id,
        author: post.author_name,
        authorId: post.author_id,
        body: post.body,
        imageMode: post.image_mode,
        mapMediaId: post.map_media_id ?? null,
        place: post.place,
        // F02：地点权威 id（帖子详情跳地点页用）
        placeId: post.place_id,
        // ⭐ WO#15：地点坐标（可为 null）。显式 Number() —— 见 PostRow 上的注释
        // （pg 可能以字符串返回数值，前端地图 SDK 需要 number）。
        placeLat: post.place_lat === null || post.place_lat === undefined ? null : Number(post.place_lat),
        placeLng: post.place_lng === null || post.place_lng === undefined ? null : Number(post.place_lng),
        createdAt: post.created_at.toISOString(),
        commentCount: Number.parseInt(cr.rows[0]?.n ?? '0', 10),
        likeCount: like.likeCount,
        likedByMe: like.likedByMe,
        // F05：收藏计数与状态（US-03：收藏内容可在个人中心查看，取消后移除）
        favoriteCount: Number.parseInt(favCount.rows[0]?.n ?? '0', 10),
        favoritedByMe,
        /* ⭐ 审核 68 P0：audio 是**独立附件类型**，不出现在 images 里（见上方 imgs 查询的分流） */
        audio,
        images,
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
      const exists = await db.pool.query("select 1 from posts where id = $1 and status = 'published'", [id])
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
      // F07：只能对**未下架**的帖子发评论（下架帖同步退出互动面）
      const pr = await db.pool.query("select 1 from posts where id = $1 and status = 'published'", [id])
      if (!pr.rowCount) {
        reply.code(404)
        return { error: 'not_found' }
      }
      if (parentId) {
        // 被回复的评论必须存在**且属于同一篇帖子**且未被删除 —— 否则就会跨帖挂载
        const pp = await db.pool.query(
          "select 1 from comments where id = $1 and post_id = $2 and status = 'published'",
          [parentId, id],
        )
        if (!pp.rowCount) {
          reply.code(400)
          return { error: 'invalid_payload', details: ['parentId 不属于该帖子或已删除'] }
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
      // F07：下架帖不再可点赞（公开互动面同步）
      const pr = await db.pool.query("select 1 from posts where id = $1 and status = 'published'", [id])
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
  // -------------------------------------------------------------------------
  // WO#18（审核 62 的 A2）：地点**列表/搜索** —— 只读
  //
  // 为什么在此之前 PoiSearchScreen 只能读 mock：**此前根本没有这个接口**
  //   （只有 /api/places/:id 单品）。而 PoiDetailScreen 早已走权威 ⇒ 一真一假。
  //
  // ⭐ 最小 read model（按 UI **实际渲染**的字段定，不按 mock 有什么）：
  //     id / name / address / latitude / longitude / postCount
  //   ⚠️ mock 里的 `category` 与 `posts` **都没被 UI 渲染** ——
  //      其中 `posts: 1284` 是"无出处的编造数字"，本接口用**真实 COUNT** 取代它。
  //   ⚠️ `distance` 由**客户端**算（依赖用户当前位置），服务端不返回 ——
  //      没有定位就不渲染，不编造（同 WO#15 对「距我N公里」的处置）。
  //
  // ⭐ `postCount` 这里**可以**是真值（与校园圈的 campusCircleCount 不同）：
  //     posts.place_id 是**直接外键**，归属已存在且权威 ⇒ COUNT 即真值，无需推断。
  //     而 campusCircleCount 必须 null 是因为归属列全空、根本不知道属于哪个校区。
  //     **两者不可类比。**
  //
  // ⚠️ 服务端过滤（沿用 WO#12 纪律）：客户端 filter 只有"永远返回全集"才等价，
  //    一旦加 limit 会静默变成"不完整但看起来完整"。
  // -------------------------------------------------------------------------
  app.get('/api/places', async (req, reply) => {
    const q = String((req.query as { q?: string }).q ?? '').trim()
    const category = String((req.query as { category?: string }).category ?? '').trim()
    const includeDisabled = String((req.query as { includeDisabled?: string }).includeDisabled ?? '') === '1'
    try {
      /*
        ⚠️ 用参数化 + 上限，避免无界返回；
          `q` 用 ILIKE 子串匹配（与 mock 版本的 includes 语义一致）。
        F02：默认只返回**启用**地点（地图与前端选择器用）；includeDisabled=1 供管理端。
      */
      const conds: string[] = []
      const params: unknown[] = []
      if (q) {
        params.push('%' + q + '%')
        conds.push(`(pl.name ilike $${params.length} or coalesce(pl.address, '') ilike $${params.length})`)
      }
      if (category === '地标' || category === '食堂') {
        params.push(category)
        conds.push(`pl.category = $${params.length}`)
      }
      if (!includeDisabled) conds.push('pl.enabled = true')
      const where = conds.length ? `where ${conds.join(' and ')}` : ''
      params.push(200)
      const r = await db.pool.query<{
        id: string
        name: string
        address: string | null
        latitude: number | null
        longitude: number | null
        category: string
        enabled: boolean
        post_count: string
      }>(
        'select pl.id, pl.name, pl.address, pl.latitude, pl.longitude, pl.category, pl.enabled, ' +
          "(select count(*) from posts p where p.place_id = pl.id and p.status = 'published')::text as post_count " +
          'from places pl ' +
          where +
          ' order by pl.sort_order, pl.name, pl.id limit $' +
          String(params.length),
        params,
      )
      return {
        items: r.rows.map((row) => ({
          id: row.id,
          name: row.name,
          address: row.address,
          latitude: row.latitude === null ? null : Number(row.latitude),
          longitude: row.longitude === null ? null : Number(row.longitude),
          category: row.category,
          enabled: row.enabled,
          /**
           * 真实计数（posts.place_id 是直接外键 ⇒ 无需推断）。
           * ⚠️ 与 campusCircleCount 的 null 语义**不同**，别混。
           */
          postCount: Number(row.post_count),
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /*
    F03：地点详情（TimeMap P0）。
    返回：基础资料（名称/分类/坐标/简介/校史）+ 老照片（年代与来源可追溯）
         + 近期活动（US-04：进入某地点时能看到该地点即将举行的活动）
         + 帖子（US-01/US-03：最新 或 近期热门；食堂标签筛选）。
    热度规则（冻结在 timemap.ts 头部注释）：点赞×2 + 有效评论×3 + 收藏×1 − 发布超24小时后的衰减。
    慢内容（校史/老照片）与近期内容（帖子/活动）分层 —— 同一接口两个 section。
  */
  app.get('/api/places/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    // 可选会话（likedByMe/favoritedByMe 需要）
    const sess = await resolveSession(req.headers.authorization)
    if (sess.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    const meId = sess.kind === 'ok' ? sess.user.userId : null
    try {
      const pr = await db.pool.query<{
        id: string
        name: string
        address: string | null
        latitude: number | null
        longitude: number | null
        category: string
        enabled: boolean
        description: string | null
        history: string | null
      }>(
        'select id, name, address, latitude, longitude, category, enabled, description, history from places where id = $1',
        [id],
      )
      const place = pr.rows[0]
      if (!place) {
        reply.code(404)
        return { error: 'not_found' }
      }
      // 老照片（慢内容）：年代 + 来源必须可追溯
      const photos = await db.pool.query<{
        id: string
        title: string
        year_label: string
        source: string
        image_url: string | null
      }>(
        'select id, title, year_label, source, image_url from place_photos where place_id = $1 order by position, created_at',
        [id],
      )
      // 近期活动（US-04）：未结束 + 7 天内结束的；取消的醒目返回（前端标红）
      const activities = await db.pool.query<{
        id: string
        title: string
        starts_at: Date
        ends_at: Date | null
        eff_status: string
        source: string
      }>(
        `select a.id, a.title, a.starts_at, a.ends_at, a.source,
                case
                  when a.status = 'cancelled' then 'cancelled'
                  when coalesce(a.ends_at, a.starts_at + interval '2 hours') < now() then 'ended'
                  when a.starts_at <= now() then 'ongoing'
                  else 'upcoming'
                end as eff_status
           from activities a
          where a.place_id = $1
            and coalesce(a.ends_at, a.starts_at + interval '2 hours') > now() - interval '7 day'
          order by a.starts_at
          limit 20`,
        [id],
      )
      // 帖子：最新（默认）或 近期热门（近 7 天按冻结的热度公式）
      const sort = String((req.query as { sort?: string }).sort ?? 'latest')
      const posts = await db.pool.query<
        PostRow & {
          place_id: string | null
          like_count: string
          comment_count: string
          favorite_count: string
          liked_by_me: boolean
          favorited_by_me: boolean
          images: unknown
        }
      >(
        `select (select pm.media_id from post_media pm where pm.post_id = p.id and pm.purpose = 'map') as map_media_id, p.image_mode, p.id, p.author_name, p.author_id, p.body, p.place, p.created_at, p.place_id,
                pl.latitude as place_lat, pl.longitude as place_lng,
                (select count(*) from likes l where l.post_id = p.id)::text as like_count,
                (select count(*) from comments c where c.post_id = p.id and c.status='published')::text as comment_count,
                (select count(*) from favorites f where f.post_id = p.id)::text as favorite_count,
                exists (select 1 from likes l2 where l2.post_id = p.id and l2.user_id = $2::uuid) as liked_by_me,
                -- F05：地点详情里的帖子也要能显示"我收藏了没"（与 likedByMe 同一套写法）。
                -- ⚠️ meId 为 null（未登录）时 exists(... uuid = null) 得 false —— 正确。
                exists (select 1 from favorites f2 where f2.post_id = p.id and f2.user_id = $2::uuid) as favorited_by_me,
                coalesce((
                  select json_agg(json_build_object('id', m.id, 'width', m.width, 'height', m.height) order by pm.position)
                    from post_media pm join media m on m.id = pm.media_id
                   where pm.post_id = p.id and pm.purpose = 'post' and m.scope = 'public' and m.mime like 'image/%'
                ), '[]'::json) as images
           from posts p
           left join places pl on pl.id = p.place_id
          where p.place_id = $1 and p.status = 'published'
            and ($3 = 'latest' or p.created_at > now() - interval '7 day')
          order by case when $3 = 'hot' then
                  (select count(*) from likes l where l.post_id = p.id) * 2
                + (select count(*) from comments c where c.post_id = p.id and c.status='published') * 3
                + (select count(*) from favorites f where f.post_id = p.id)
                - greatest(0, extract(epoch from (now() - p.created_at)) / 3600.0 - 24)::int
              else 0 end desc,
             p.created_at desc, p.id desc
          limit $4`,
        [id, meId, sort, LIST_LIMIT],
      )
      return {
        id: place.id,
        name: place.name,
        address: place.address,
        latitude: place.latitude === null ? null : Number(place.latitude),
        longitude: place.longitude === null ? null : Number(place.longitude),
        category: place.category,
        enabled: place.enabled,
        description: place.description,
        history: place.history,
        photos: photos.rows.map((ph) => ({
          id: ph.id,
          title: ph.title,
          yearLabel: ph.year_label,
          source: ph.source,
          imageUrl: ph.image_url,
        })),
        activities: activities.rows.map((a) => ({
          id: a.id,
          title: a.title,
          startsAt: a.starts_at.toISOString(),
          endsAt: a.ends_at ? a.ends_at.toISOString() : null,
          status: a.eff_status,
          source: a.source,
        })),
        posts: posts.rows.map((row) => ({
          id: row.id,
          author: row.author_name,
          authorId: row.author_id,
          body: row.body,
          imageMode: row.image_mode,
          mapMediaId: row.map_media_id ?? null,
          placeId: row.place_id,
          createdAt: row.created_at.toISOString(),
          likeCount: Number.parseInt(row.like_count ?? '0', 10),
          commentCount: Number.parseInt(row.comment_count ?? '0', 10),
          favoriteCount: Number.parseInt(row.favorite_count ?? '0', 10),
          likedByMe: row.liked_by_me,
          // F05：与 likedByMe 同型 —— "我收藏了没"必须来自服务端（前端不得推算）
          favoritedByMe: row.favorited_by_me,
          images: row.images ?? [],
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
  // WO#16 层 B（审核 61 APPROVED TO IMPLEMENT）：学校 / 校区 —— **只读**
  //
  // 为什么只有「列出」而没有「按 school 过滤的全局 campus 搜索」：
  //   domain 本身是 School 1 → N Campus，两层接口比 /api/campuses?schoolId=
  //   更能表达层级，也不会把"全局 campus 搜索"与"某学校的 campuses"混成一个接口。
  //   （审核 60 选了这条形状。）
  //
  // ⭐ campusCircleCount 的语义（审核 60 的计数策略 A，**最要紧的一处**）：
  //     count = COUNT(posts WHERE posts.school_campus_id = campus.id)
  //   但**只有存在权威归属时这个数才有意义**。我们的现状是：
  //     posts.school_campus_id 与 users.school_campus_id **全为 NULL**
  //     （没有任何权威来源能确定动态属于哪个校区）
  //   ⇒ 此时返回 **null**（"无法由权威归属计算"），**不是 0**、不由 place 推断、不伪造。
  //   ⚠️ 为什么不能给 0：0 会被读成"这个校区确实没有动态"，
  //      而事实是"我们根本还不知道"——这两件事完全不同（审核 60 原话）。
  //   ⚠️ 也**不得**用 posts.place_id → places.name 去推：
  //      place='北京交通大学' 只说明一个**地理 POI**，推不出 school_campus='校本部'
  //      —— 这正是 Gate PLACE_DOES_NOT_IMPLY_CAMPUS 守的线。
  //   ⇒ 判定规则（可测）：平台里**一条非空归属都没有** ⇒ 归属机制未建立 ⇒ 全 campus 返回 null。
  //     将来只要出现真实归属，计数自然变为真实 COUNT，无需改接口形状。
  // -------------------------------------------------------------------------
  app.get('/api/schools', async (_req, reply) => {
    try {
      const r = await db.pool.query<{ id: string; name: string }>(
        'select id, name from schools order by name, id',
      )
      return { items: r.rows.map((row) => ({ id: row.id, name: row.name })) }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /*
    ⭐ F-004 / F-006（审核 67 批准为「一个非常小的 closeout」）：学院的**权威列表**。
    ═══════════════════════════════════════════════════════════════════════════
    为什么需要这个接口：审核 67 把「所在学院」原版是 **picker**、我们却是纯文本 Row
    定为 **EXPERIENCE_FIDELITY BLOCKER**（"这是**交互方式**，不是视觉……用户操作能力不同"）。
    而 picker **若无可选实体就只是一个空面板** ⇒ 等于把一个假功能换成另一个假功能。
    ⇒ 所以 F-004（交互侧）与 F-006（数据侧）必须一起做，本接口就是数据侧。

    数据来源与**证据限度**（不夸大）：
      · 5 条学院名**逐字**来自 Round 319 对原版认证页「所在学院」picker 的**只读 dump**
        （tools/tmp/orig-v4.xml，可复算）—— 不是我编的，见迁移 013 的注释。
      · ⚠️ 该 dump 是**观察到的子集**（面板在真机上可能可滚动）⇒
        `ORIGINAL_COLLEGE_LIST_COMPLETE: NOT_EVALUATED` ⇒ 响应里带上该字段，**不**声称完整。
      · ⚠️ **不**返回"专业"：F-005 明确 NOT_EVALUATED（点「就读专业」无可见反应）。
      · ⚠️ **不**返回学院→校区归属：原版未显示这种关系 ⇒ 无依据。
  */
  /*
    ⭐ WO#23（Owner 裁定 ③：App 自更新必须实现体验等价）：**真实的**发布清单。
    ═══════════════════════════════════════════════════════════════════════════
    为什么这样做（而不是继续显示"更新流程未接入"）：
      Owner 裁定 ③ 要求"必须实现体验等价" ⇒ 只停在"如实说没接"不满足。
      但原版「立即更新」的**真实去向未观察**（点它可能触发真实下载 ⇒ 只读约束下
      **BLOCKED_BY_POLICY**，不能去点）⇒ "原版做成什么样"**无从对齐**。
    ⇒ 能做且**是真的**的事：让客户端来问**我们自己的后端**要发布清单（真实请求/真实数据），
      客户端拿**自己真实的版本号**比较（真实比较）：
        · 有更新 ⇒ 给出**真实的下载地址**（运维在 app_release 表里配置；
                    未配置就**如实说**未配置，**不编造链接**）
        · 无更新 ⇒ 如实显示"已是最新版本"
      ⇒ 于是"检查更新"是一个**真功能**，不是提示框。
    ⚠️ 术语：`ORIGINAL_UPDATE_FLOW: NOT_EVALUATED`（不与原版对齐）；
       `APP_UPDATE_CHECK_IS_REAL: PASS`（检查是真的）。
    ⚠️ 本接口**公开只读**（升级弹窗在登录前也可能用到），不返回任何敏感信息。
  */
  app.get('/api/app/release', async (_req, reply) => {
    try {
      const r = await db.pool.query<{
        latest_version: string
        apk_url: string | null
        notes: string | null
        updated_at: Date
      }>(
        `select latest_version, apk_url, notes, updated_at
           from app_release where active = true
          order by updated_at desc limit 1`,
      )
      const row = r.rows[0]
      if (!row) {
        /* 没有生效的发布行 ⇒ 如实说没有清单，**不**编造版本 */
        return { configured: false, reason: 'no_active_release' }
      }
      return {
        configured: true,
        latestVersion: row.latest_version,
        /* ⚠️ apkUrl 为 null = 我们**没有**托管安装包 ⇒ 客户端必须如实说明 */
        apkUrl: row.apk_url,
        notes: row.notes,
        updatedAt: row.updated_at.toISOString(),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error' }
    }
  })

  app.get('/api/schools/:id/colleges', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      const sr = await db.pool.query<{ id: string }>('select id from schools where id = $1', [id])
      if (sr.rows.length === 0) {
        reply.code(404)
        return { error: 'not_found' }
      }
      const cr = await db.pool.query<{ id: string; name: string }>(
        'select id, name from colleges where school_id = $1 order by sort_order, name, id',
        [id],
      )
      return {
        items: cr.rows,
        /* ⚠️ 如实标注证据限度：这是**观察到的子集**，不声称是完整学院表 */
        completeness: 'OBSERVED_SUBSET',
        originalCollegeListComplete: false,
        note:
          '学院名逐字来自 Round 319 对原版认证页「所在学院」picker 的只读 dump（5 条）；' +
          '该面板可能可滚动 ⇒ ORIGINAL_COLLEGE_LIST_COMPLETE: NOT_EVALUATED。',
      }
    } catch (err) {
      req.log.error({ err }, 'schools/:id/colleges failed')
      reply.code(500)
      return { error: 'internal' }
    }
  })

  app.get('/api/schools/:id/campuses', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      const sr = await db.pool.query<{ id: string }>('select id from schools where id = $1', [id])
      if (sr.rows.length === 0) {
        reply.code(404)
        return { error: 'not_found' }
      }
      const cr = await db.pool.query<{ id: string; name: string }>(
        'select id, name from campuses where school_id = $1 order by name, id',
        [id],
      )
      /*
        ⭐⭐ 归属**覆盖完整性**判定（审核 62 收紧；WO#16 closeout）
        ═══════════════════════════════════════════════════════════════
        规则：`campusCircleCount` 可以是 number **当且仅当**"当前被计入该校园圈统计的
              **post population** 已 100% 有显式 school_campus_id"。

          totalRelevantPosts == 0          → 覆盖完整 ⇒ 允许 0
          0 <= attributed < total          → **覆盖不完整 ⇒ 全部 count = null**
          attributed == total              → 覆盖完整 ⇒ 才允许真实 COUNT

        ⚠️ 这里修过一个**真实的语义漏洞**（我原来的实现）：
           旧规则只看"平台里有没有**任何**一条非空归属"，于是当 4 条帖子里
           **只有 1 条**有归属、另 3 条仍 NULL 时，它会认为"已建立"并返回
             校本部 = 1 ／ 威海校区 = **0** ／ 东校区 = **0**
           —— 那两个 0 是错误的：3 条 NULL 完全可能属于任意校区。
           0 的语义是"**权威地知道**没有动态"，不是"目前没被归属到这里"。
           ⇒ 根因：把"**存在任何归属**"当成了"**归属覆盖完整**"。

        ⚠️ 另一处修正：覆盖完整性**只看 posts**。
           原实现把 `users.school_campus_id` 也加进了那个计数，但
           统计对象是"**校园圈动态数**"（post population）——
           把 user 的归属混进来会得出"覆盖完整"的错误结论。
      */
      const cov = await db.pool.query<{ total: string; attributed: string }>(
        'select (select count(*) from posts)::text as total, ' +
          '(select count(*) from posts where school_campus_id is not null)::text as attributed',
      )
      const totalRelevantPosts = Number(cov.rows[0]?.total ?? '0')
      const attributedPosts = Number(cov.rows[0]?.attributed ?? '0')
      /* 覆盖完整 = 该有归属的帖子**全部**都有归属（0 == 0 也算完整，此时允许 0） */
      const attributionCoverageComplete = attributedPosts === totalRelevantPosts

      let counts = new Map<string, number>()
      if (attributionCoverageComplete) {
        const cc = await db.pool.query<{ school_campus_id: string; n: string }>(
          'select school_campus_id, count(*)::text as n from posts ' +
            'where school_campus_id is not null group by school_campus_id',
        )
        counts = new Map(cc.rows.map((row) => [row.school_campus_id, Number(row.n)]))
      }

      return {
        schoolId: id,
        items: cr.rows.map((row) => ({
          id: row.id,
          name: row.name,
          /*
            null = 覆盖不完整／无法由权威归属计算（**不是 0**，见函数头说明）；
            只有覆盖完整时才给真实 COUNT。
          */
          campusCircleCount: attributionCoverageComplete ? (counts.get(row.id) ?? 0) : null,
        })),
        /*
          ⚠️ 字段改名（审核 62 建议）：原 `attributionEstablished` 容易把
             "存在任何归属"误读成"归属覆盖完整" —— 正是上面那个漏洞的语言根源。
        */
        attributionCoverageComplete,
        // 诊断用（也让"为什么是 null"可被机械核对）；不暴露任何敏感数据
        coverage: { totalRelevantPosts, attributedPosts },
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
  // UPLOAD_ROOT 见模块级常量（单一来源）；此处不再重复定义。
  // 启动时由 main() 验证 UPLOAD_ROOT 并自建 .tmp —— 见那里的注释与审核记录 24。
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
    //   post     → public    帖子配图
    //   activity → public    活动封面（022：ACT-003 的"封面"）
    //   chat     → private   聊天图片/语音
    const purpose = ((data.fields?.purpose as { value?: string } | undefined)?.value ?? 'post').trim()
    const scope =
      purpose === 'chat' ? 'private' : purpose === 'post' || purpose === 'activity' ? 'public' : null
    if (!scope) {
      reply.code(400)
      return { error: 'bad_purpose', allowed: ['post', 'chat', 'activity'] }
    }

    /**
     * 语音时长（毫秒）—— **Phase 1 必需字段**，且**必须由客户端提供**。
     *
     * 为什么不能从文件里读出来：MediaRecorder 产出的是"live/流式" WebM，
     * **文件头不含 duration**，`<audio>` 不 seek 时拿到 null/Infinity（WO#5 探针 P10 实测）。
     * 因此客户端用**单调时钟**（performance.now()）在录音时计时后上传，服务端只做校验与存储。
     *
     * 校验规则（审核记录 35 给定，**不静默忽略错误 metadata**）：
     *   audio/webm → durationMs **必需**，且为正整数
     *   image/*    → durationMs **禁止出现**（带了就是自相矛盾的载荷 → 400）
     * 缺失与非法都直接 400，不"猜一个值"也不"忽略掉"。
     */
    const durationRaw = (data.fields?.durationMs as { value?: string } | undefined)?.value
    let durationMs: number | null = null
    if (durationRaw !== undefined) {
      if (!/^[0-9]{1,10}$/.test(durationRaw.trim())) {
        reply.code(400)
        return { error: 'bad_duration_ms', reason: 'must_be_positive_integer', got: durationRaw.slice(0, 32) }
      }
      durationMs = Number(durationRaw.trim())
      if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
        reply.code(400)
        return { error: 'bad_duration_ms', reason: 'must_be_positive', got: durationRaw.slice(0, 32) }
      }
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
    //    分流：先按图片探（既有路径，一字不改其行为），不是图片再按 WebM 容器探。
    const u8 = new Uint8Array(buf)
    const imgProbe = probeImage(u8)

    /** 本次上传被判定为什么媒体种类 —— 决定 mime/宽高/时长的合法性 */
    type Kind = { mime: string; ext: string; width: number | null; height: number | null; isAudio: boolean }
    let kind: Kind

    if (imgProbe.ok) {
      kind = {
        mime: imgProbe.mime,
        ext: imgProbe.mime === 'image/png' ? 'png' : imgProbe.mime === 'image/jpeg' ? 'jpg' : 'webp',
        width: imgProbe.width,
        height: imgProbe.height,
        isAudio: false,
      }
    } else {
      const audProbe = probeAudioWebm(u8)
      if (!audProbe.ok) {
        reply.code(400)
        // 两个探测器的原因都给出，便于定位（图片原因沿用原字段名，保持向后兼容）
        return { error: 'not_an_image', reason: imgProbe.reason, audioReason: audProbe.reason }
      }
      kind = { mime: audProbe.mime, ext: 'webm', width: null, height: null, isAudio: true }
    }

    /*
      ③b durationMs ↔ 媒体种类的一致性（审核记录 35 要求"不静默忽略错误 metadata"）
        · 音频必须带正时长 —— 否则 DB 的 media_mime_duration_consistent 会拒绝，
          但**要在写文件之前就拒**，避免留下"文件已落盘但没有 DB 行"的 orphan。
        · 图片不许带时长 —— 同理，属于自相矛盾的载荷。
      注意：这两条与迁移 010 的 DB 约束**意图相同**，这里是更早的一道闸：
      DB 约束是最后防线（防服务层写错），这里防的是"用户输入错误"并且不产生垃圾文件。
    */
    if (kind.isAudio && durationMs === null) {
      reply.code(400)
      return { error: 'missing_duration_ms', reason: 'audio_requires_duration' }
    }
    if (!kind.isAudio && durationMs !== null) {
      reply.code(400)
      return { error: 'unexpected_duration_ms', reason: 'duration_only_for_audio', mime: kind.mime }
    }

    const ext = kind.ext
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
          `insert into media (id, owner_user_id, scope, storage_key, mime, bytes, width, height, sha256, upload_request_id, duration_ms)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, s.user.userId, scope, storageKey, kind.mime, buf.length, kind.width, kind.height, sha256, uploadRequestId, durationMs],
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
        mime: kind.mime,
        bytes: buf.length,
        width: kind.width,
        height: kind.height,
        // 语音：回显时长，便于客户端断言"存进去的就是我测到的那个值"
        durationMs,
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

      // Local development has no Nginx; authorization still uses can_read_media above.
      if (process.env.LOCAL_MEDIA_SERVE === '1') {
        reply.header('Content-Type', row.mime)
        reply.header('X-Media-Scope', row.scope)
        return reply.send(createReadStream(join(UPLOAD_ROOT, row.scope, row.storage_key)))
      }

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
        peer_name: string | null
        peer_id: string | null
      }>(
        `select t.id, t.kind, t.title,
                (select count(*) from thread_members tm2 where tm2.thread_id = t.id)::text as member_count,
                lm.body as last_body, lm.kind as last_kind, lm.created_at as last_at,
                -- M5 WO#8：direct 会话的"对方昵称"。
                -- 为什么需要它：会话列表要显示一行"跟谁在聊"，而 direct 会话的 t.title 是 NULL
                -- （实测：ffffffff-…-001 的 title=NULL、成员 2 人）。没有它这一行就没名字可显示，
                -- 列表会退化成"未命名会话"—— 那既不好用，也不符合原版（原版显示对方昵称）。
                -- 取法：本会话里**除我以外**的第一个成员。
                -- M5 WO#9A：**只对 kind='direct' 计算**。群聊里没有"对方"这个概念，
                -- 群里返回 peerName 只是"某个别的成员"——那是**误导性字段**，将来一定会被误用
                -- （例如把群聊行显示成某个成员的名字）。群聊行的显示名应取 t.title，
                -- 因此这里用 case 在 SQL 层挡掉。
                --
                -- M5 WO#12：**同时**返回 peer_id（审核记录 53 批准）。
                --   为什么不能只用 peerName 定位"我与 TA 的会话"：displayName 可能重名/改名，
                --   拿名字当身份是错的。peer_id 回答的是"已有 direct 会话里，对方是谁"，
                --   这是可机械验证的（== thread_members 中除我之外的另一成员 id）。
                --   ⚠️ 两个字段**必须来自同一行**：因此用**同一 order by** 的两个子查询，
                --      而不是"分别取第一个" ——那可能在极端情况下指向不同成员，造成
                --      "名字与 id 不是同一个人"这种最难查的错误。
                --   ⚠️ 它**不**回答"从没聊过的人点私信该怎样建会话" —— 那是另一个问题，
                --      WO#12 对"零匹配会话"的处置是 hide/unavailable，不猜、不造。
                case when t.kind = 'direct' then (
                  select u.display_name
                    from thread_members tm3
                    join users u on u.id = tm3.user_id
                   where tm3.thread_id = t.id and tm3.user_id <> $1
                   order by u.display_name
                   limit 1
                ) else null end as peer_name,
                case when t.kind = 'direct' then (
                  select tm4.user_id
                    from thread_members tm4
                    join users u2 on u2.id = tm4.user_id
                   where tm4.thread_id = t.id and tm4.user_id <> $1
                   order by u2.display_name
                   limit 1
                ) else null end as peer_id
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
          // 列表行的显示名：group 用 title；direct 用对方昵称（见上面 SQL 的注释）
          peerName: row.peer_name,
          // M5 WO#12（审核 53 批准）：direct 会话里"对方是谁"的**权威身份**。
          // 用途：他人主页的「私信」要跳到"我与 TA 的会话"，靠 peerName 匹配不可靠
          // （重名/改名），必须按 id 匹配。群聊恒为 null（没有"对方"这个概念）。
          peerId: row.peer_id,
          lastMessage: row.last_body === null ? null : { body: row.last_body, kind: row.last_kind, createdAt: row.last_at?.toISOString() ?? null },
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /*
    M5 WO#9A：**单个会话的元数据**。

    为什么需要它：群聊页的顶部要显示**群名**，而群名是服务端数据。
    可选做法只有两种：
      (a) 从「消息」列表跳过来时把 title 塞进路由 query —— ❌ 那样群名就变成**客户端提供的数据**，
          刷新/深链会丢，而且客户端可以随便改；一个"页面标题"不该是不可信输入。
      (b) 页面自己按 id 取权威元数据 —— ✅ 本接口。
    返回体与列表里的单项**同构**（同一批字段），避免出现两套会话表示。

    访问控制与 `/api/threads/:id/messages` **完全一致**：
      · id 形状不合法 → 404 not_found
      · 不是成员 / 不存在 / 未登录 → **一律 404**（沿用既有"刻意不区分"的设计：
        不让调用方从状态码区分"不存在"与"无权查看"）
      · 未登录 → 401（这一条与 messages 接口一致：先判会话再判形状）
  */
  app.get('/api/threads/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (s.kind === 'none') return unauthorized(reply)
    try {
      const r = await db.pool.query<{
        id: string
        kind: string
        title: string | null
        member_count: string
        peer_name: string | null
      }>(
        `select t.id, t.kind, t.title,
                (select count(*) from thread_members tm2 where tm2.thread_id = t.id)::text as member_count,
                case when t.kind = 'direct' then (
                  select u.display_name
                    from thread_members tm3
                    join users u on u.id = tm3.user_id
                   where tm3.thread_id = t.id and tm3.user_id <> $1
                   order by u.display_name
                   limit 1
                ) else null end as peer_name
           from message_threads t
           join thread_members me on me.thread_id = t.id and me.user_id = $1
          where t.id = $2`,
        [s.user.userId, id],
      )
      if (r.rows.length === 0) {
        reply.code(404)
        return { error: 'not_found' }
      }
      const row = r.rows[0]!

      /*
        M5 WO#9B 层 A（blocker ①，审核记录 49 批准）：
        AT 面板需要**权威的成员列表** —— 不能从消息 sender / seed / mock / 本地缓存反推。

        ## 边界（审核 49 明确要求，逐条落实）
         · 只返回**最小身份字段** `{ id, displayName }` ——
           **不顺手暴露 phone 等无关数据**（面板只需要"显示谁"，不需要联系方式）
         · `memberCount` 必须与 `members.length` **一致**（Gate 会顺手校验）
         · 权限沿用本接口既有语义：成员 200 ／ 非成员 404（不区分"不存在"与"无权"）

        ## ⚠️ 顺序
         当前**没有原版成员排序规则的证据**，所以**顺序不得写成 conformance contract**。
         这里按 display_name 排序**只是为了结果稳定**（同一份数据每次返回顺序一致，
         便于 Gate 做集合与配对比较），并在此显式声明它是**我方选择**而非原版规则。
      */
      const members = await db.pool.query<{ id: string; display_name: string }>(
        `select u.id, u.display_name
           from thread_members tm
           join users u on u.id = tm.user_id
          where tm.thread_id = $1
          order by u.display_name, u.id`,
        [id],
      )
      const memberList = members.rows.map((m) => ({ id: m.id, displayName: m.display_name }))
      const memberCount = Number.parseInt(row.member_count, 10)
      // 一致性自检：两者由**不同查询**得到，若将来有人改了其中一处，这里能立刻暴露
      if (memberList.length !== memberCount) {
        reply.code(500)
        return {
          error: 'member_count_mismatch',
          memberCount,
          membersLength: memberList.length,
        }
      }

      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        memberCount,
        peerName: row.peer_name,
        members: memberList,
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
        mentions_all: boolean
        media: unknown
      }>(
        `select m.id, m.sender_id, u.display_name as sender_name, m.body, m.kind, m.created_at, m.deleted_at,
                -- M5 WO#9B：@所有人 是消息的**持久属性**（存在列上），读模型必须原样带出，
                -- 否则"刷新后 @所有人 就消失了"——而它本该与消息同生共死。
                m.mentions_all,
                -- 消息的媒体引用。除 id 与尺寸外，**语音还需要 mime 与 duration_ms**：
                --   · mime   → 客户端据此决定渲染成图片气泡还是语音气泡（不能靠"宽度为 null"来猜）
                --   · duration_ms → **时长必须来自这里**。MediaRecorder 产出的 live/WebM 文件头
                --     不含 duration（探针 P10 实测 <audio>.duration === null），
                --     所以"刷新后仍能显示时长"只能靠持久化的这个字段，
                --     绝不能指望重新下载音频再解码得到（那也违背"一条消息的展示不该依赖整段音频"）。
                coalesce((
                  select json_agg(json_build_object(
                           'id', md.id, 'width', md.width, 'height', md.height,
                           'mime', md.mime, 'durationMs', md.duration_ms
                         ) order by mm.position)
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
          // M5 WO#9B：与 `mentions`（逐人）**并列**的独立字段，语义不混同
          mentionsAll: row.mentions_all === true,
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
    /*
      带了媒体却不是"媒体类消息" → 自相矛盾的载荷，直接拒（不写任何行）。

      M5 WO#5 之前这里写的是 `kind !== 'image'`（即"带媒体就必须是图片消息"）。
      放开语音后，正确的形式是"**kind 与媒体的 mime 类必须相容**"：
        image → 媒体必须是 image/*
        voice → 媒体必须是 audio/*
        text  → **不允许**带媒体（本篇消息没有可承载媒体的语义）
      kind 与 mime 的精确匹配要拿到 media 行才知道，因此这里先做**形状级**判断
      （哪些 kind 允许带媒体），mime 级判断放在事务内（见下面的 mediaId 校验段）。
      ⚠ 必须保留原行为：`text + mediaId` 仍要 400 —— 否则就是把 WO#2 已收紧的
        contract 又放松了（Gate 里有对应回归断言）。
    */
    if (mediaId !== null && kind !== 'image' && kind !== 'voice') {
      reply.code(400)
      return { error: 'media_requires_media_kind', kind, allowed: ['image', 'voice'] }
    }

    /*
      ---- M5 WO#9B：@所有人（mentions_all）------------------------------------------

      ## 为什么是**独立布尔**而不是"逐人提及的一种特殊形式"
        既有 `message_mentions.mentioned_user_id` 是**指向 users(id) 的外键** ——
        要表达"全体"只能塞一个**假的 user 行**，而那正是 AUDIT 明确否决的做法
        （"绝不能伪造成某个 user id：那会让'提到全体'与'提到某人'在数据上无法区分"）。
        → 独立布尔，与逐人提及**并存但不混同**。

      ## ⚠️ 校验顺序（审核记录 49 **冻结**，必须严格按此）
        1. authenticate / resolve thread membership
        2. **non-member → 404**（最先，不泄漏"会话存在"）
        3. validate thread-kind policy（direct → 400）
        4. validate mentionsAll ↔ individual mentions **mutual exclusion**
        5. only then validate individual mention targets
             （cannot_mention_self / mentioned user membership / duplicates…）
        6. perform writes in transaction

        为什么顺序必须写死：我此前踩过一个真实假 PASS ——
        `MIXED_ALL_AND_INDIVIDUAL_REJECT` 曾"因为 `cannot_mention_self` 而通过"，
        证明**错误优先级会影响 Gate 是否真的覆盖目标分支**。
        按冻结顺序，`mentionsAll=true + mentions=[Lemy]` 必须稳定得到
        `mentions_all_conflicts_with_mentions`，
        **不能**先掉进 `cannot_mention_self` / `mention_not_in_thread`。

      ## ⚠️ 因此形状检查里**只做类型**，不做互斥
        互斥（第 4 步）依赖不了"是不是成员"吗？—— 不，它**必须**排在成员判定（第 2 步）之后：
        否则非成员同时带两个字段时会拿到 400（冲突）而不是 404，
        既违反冻结顺序，也把"你不在这个会话里"这条先决条件暴露成了另一类错误。
        → 类型检查（不需要连库）留在事务前；**语义检查全部进事务**。

      ## 口径（审核记录 48/49）
        MENTIONS_ALL_DIRECT_POLICY: REJECT
        PROVENANCE:                 OUR_DESIGN_CHOICE
        ORIGINAL_BEHAVIOR:          NOT_EVALUATED
        ⚠️ **不**声称"direct 里 @全体 逻辑上不可能"——该说法已被否决；
           只是**我方产品选择**不提供该语义。
        AT_ALL_PERMISSION_POLICY: group member → allowed ／ non-member → 404
        PROVENANCE: OUR_DESIGN_CHOICE ／ ORIGINAL_PERMISSION_MODEL: NOT_EVALUATED
    */
    const mentionsAllRaw = (body as { mentionsAll?: unknown } | undefined)?.mentionsAll
    if (mentionsAllRaw !== undefined && typeof mentionsAllRaw !== 'boolean') {
      reply.code(400)
      return { error: 'bad_mentions_all', got: typeof mentionsAllRaw }
    }
    const mentionsAll = mentionsAllRaw === true

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
      /*
        ---- M5 WO#9B：@所有人 的两条语义检查（审核记录 49 冻结的**第 3、4 步**）--------
        顺序严格按冻结清单：
          2. non-member → 404（上面刚判完）
          3. thread-kind policy：mentionsAll 且 kind !== 'group' → 400
          4. mentionsAll ↔ 逐人 mentions **互斥** → 400
          5. 之后才校验逐人提及目标（cannot_mention_self / member / 重复）—— 见下面既有块
        这样 `mentionsAll=true + mentions=[Lemy]` 会**稳定**命中 mentions_all_conflicts_with_mentions，
        而**不会**先掉进 cannot_mention_self —— 这正是我此前那次"假 PASS"要防的形态。
      */
      if (mentionsAll) {
        const th = await client.query<{ kind: string }>('select kind from message_threads where id = $1', [threadId])
        const threadKind = th.rows[0]?.kind ?? null
        if (threadKind !== 'group') {
          await client.query('rollback')
          reply.code(400)
          return { error: 'mentions_all_requires_group', kind: threadKind }
        }
        if (mentions.length > 0) {
          // 互斥：两者同时出现会让"全体"与"逐人"的语义同时存在，读端无法区分该按哪个解释
          await client.query('rollback')
          reply.code(400)
          return {
            error: 'mentions_all_conflicts_with_mentions',
            mentionsAll: true,
            mentionsCount: mentions.length,
          }
        }
      }
      // 校验被提及者：必须是会话成员、且不能是自己（冻结顺序的第 5 步）
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
        const m = await client.query<{ owner_user_id: string; scope: string; mime: string }>(
          // 一并取 mime：下面的 kind ↔ mime 相容性判断需要它（M5 WO#5）
          'select owner_user_id, scope, mime from media where id = $1',
          [mediaId],
        )
        const row = m.rows[0]
        if (!row) {
          await client.query('rollback')
          reply.code(400)
          return { error: 'media_not_found', mediaId }
        }
        /*
          ★ kind ↔ mime 相容性（M5 WO#5 泛化原来的"必须是图片"）

          为什么必须在**这里**判而不是只发形状检查：形状检查只能知道 kind 是 image 还是 voice，
          不知道这个 media 的实际类型。若只做形状检查，`kind='voice'` + 一张 **image/png** 就能过，
          结果是一条"语音消息"里挂着图片 —— 客户端会去按音频解析而拿到 PNG，属于语义错误。
          （这正是 WO#4 被驳回时审核点出的形态："看起来一个东西、发出去另一个东西"。）

          分类**同时**用"已批准 MIME 集"与"mime 前缀"：
            · 已批准集是**权威判据**（可收紧、扩展时必须显式登记）；
            · 前缀只用来给出**可读的错误信息**（expectedPrefix）。

          ⚠️ **已知的语义瑕疵（审核记录 37 §6 指出）**：早先这里只用
          `mime.startsWith('audio/')`，等于让"任何未来的 audio/* 自动获得 voice 资格"。
          当前**没有实际安全扩张**（DB 的 media_mime_allowed 只放行 audio/webm，
          新增音频格式必须过一次迁移），但语义上不理想 —— 已改为显式批准集。
          **扩展音频格式时必须把新 MIME 同时加进 AUDIO_MIMES 与 DB 白名单**，
          不要依赖"它在 audio/ 前缀下"就悄悄获得 voice 资格。
        */
        const IMAGE_MIMES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp']
        const AUDIO_MIMES: readonly string[] = ['audio/webm']
        const wantPrefix = kind === 'image' ? 'image/' : 'audio/'
        const approved = kind === 'image' ? IMAGE_MIMES : AUDIO_MIMES
        if (!row.mime.startsWith(wantPrefix) || !approved.includes(row.mime)) {
          await client.query('rollback')
          reply.code(400)
          return {
            error: 'media_kind_mismatch',
            kind,
            mediaMime: row.mime,
            expectedPrefix: wantPrefix,
            approved,
          }
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
      /*
        M5 WO#9B：把 mentions_all 一并写入。
        ⚠️ 它必须在**同一个 INSERT** 里 —— 不能"先插消息、再 UPDATE mentions_all"：
           那样中间存在一个"消息已存在但 @所有人 标记还没写上"的窗口，
           读端可能读到半成品；而且一旦 UPDATE 失败就留下语义残缺的消息。
           （这正是审核 48 要求的"服务端事务不变量"：任一失败 → 零消息 + 零 mention 变更。）
      */
      await client.query(
        'insert into messages (id, thread_id, sender_id, body, kind, mentions_all) values ($1, $2, $3, $4, $5, $6)',
        [msgId, threadId, s.user.userId, text, kind, mentionsAll],
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
      // M5 WO#9B：把 mentionsAll 一并回给调用方 —— 客户端要靠它确认"@所有人 确实生效了"，
      // 而不是自己以为生效（Gate：AT_ALL_SELECTION_STATE_MATCHES_PAYLOAD 正是校验这一点）。
      return { id: msgId, kind, mentions, mentionsAll, mediaId }
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

  // -------------------------------------------------------------------------
  // BJTU TimeMap P0 新增路由（F05 收藏 / F06 活动 / F07 举报与管理端 / 作者删除）。
  // 路由体在 ./timemap.ts；这里只注入本文件已有的会话解析与错误响应助手。
  // -------------------------------------------------------------------------
  registerCutoutRoutes(app, db, UPLOAD_ROOT, async (req) => {
    const session = await resolveSession(req.headers.authorization)
    if (session.kind === 'db_down') throw new Error('session lookup unavailable')
    return session.kind === 'none' ? null : session.user.userId
  })

  registerTimemapRoutes({
    app,
    db,
    resolveSession,
    unauthorized,
    dbUnavailable,
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

  /*
    ⭐ 短信通道：**四项齐全**才算配置好；缺任何一项就如实回退 dev sink。
    ⚠️ 这里刻意**不**在缺项时报警退出：回退是设计好的行为（本地/离线开发要用），
       但**必须在启动日志里说清当前用的是哪条通道** —— 否则"以为在发短信、其实没发"
       正是最难发现的一类假成功。
    ⚠️ 只打印**是否配置**，**绝不**打印 AK 或密钥（与"验证码不进日志"同一条纪律）。
  */
  const smsSender = createSmsSender({
    akId: cfg.aliyunSmsAkId,
    akSecret: cfg.aliyunSmsAkSecret,
    signName: cfg.aliyunSmsSignName,
    templateCode: cfg.aliyunSmsTemplateCode,
    ttlMinutes: Math.max(1, Math.round(cfg.loginCodeTtlSeconds / 60)),
  })
  console.log(
    smsSender.configured
      ? '[sms] 已配置阿里云短信认证（PNVS）⇒ 验证码走真实短信下发'
      : '[sms] 未配置（缺 AK 或赠送签名/模板）⇒ 验证码回退到 dev sink；响应里会明确标 delivery=dev-sink',
  )

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
    smsSender,
    trustProxy: cfg.trustProxy,
  })

  let migrateTimer: NodeJS.Timeout | null = null

  /**
   * 健康心跳的句柄 —— **必须放在外层**，好让 shutdown 能清掉它。
   *
   * 修的是一个真实缺陷（2026-09-22）：原来 `heartbeat` 是下方 async IIFE 内的**局部变量**，
   * shutdown 只清了 `migrateTimer`，于是：
   *   SIGTERM → `app.close()`（会等在飞请求，可能耗时数秒）→ 此窗口内心跳触发
   *   → `db.refresh()` → 撞上已经 `pool.end()` 的 pool
   *   → 抛 "Cannot use a pool after calling end on the pool"
   *   → 不匹配任何 transient 模式 → 被判 terminal
   *   → 打出 `[migrate] TERMINAL failure (no retry, human action required)` + `[health] ready: true -> false`
   * 把一次**正常停机**记成了"需要人工介入的严重故障"，误导运维。
   *
   * 双层防护（缺一不可）：
   *   ① 这里：shutdown 时 clear 掉心跳 → 关闭过程中**不再发起**新的 refresh；
   *   ② db.ts 的 `closing` 标志 + close() 中 `await inflight`
   *      → 覆盖"心跳恰好在 clear 之前已经发起"的那一次。
   */
  let heartbeatTimer: NodeJS.Timeout | null = null

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal}`)
    // 先停掉两个定时器，再关连接 —— 顺序反了就会重现上面那个假警报
    if (migrateTimer) clearInterval(migrateTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
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

  /**
   * 上传根目录的启动自愈（审核记录 24 选定方案 A；**边界：只自建 `.tmp`**）。
   *
   * 背景（实测踩到）：`POST /api/media` 先写 `UPLOAD_ROOT/.tmp/<id>.<ext>` 再 rename，
   * 但代码**从不创建 `.tmp`**（只对 `public`/`private` 那层做过 mkdir）。
   * 于是当前服务器因为历史手工 `install -d` 建过 `.tmp` 而一直 PASS，
   * **全新机器上第一次上传直接 500（ENOENT）** —— 典型的 persistent invariant 漏洞。
   *
   * 边界（刻意区分，避免把部署配置塞进应用）：
   *   · `UPLOAD_ROOT` 是**持久存储根**，与"PG 必须安装""service user 权限"同类，
   *     属部署职责 —— 这里**只验证、绝不自建**。缺失时打印明确错误而**不阻断进程**，
   *     以保持既有的"liveness 优先"语义（文本功能仍可用，只有媒体上传会失败）。
   *   · `UPLOAD_ROOT/.tmp` 是**应用自己拥有的运行时内部子目录**：上传代码自己依赖它，
   *     就自己保证它存在 —— 递归创建，权限与既有 scope 目录一致（0o750）。
   */
  try {
    await statfs(UPLOAD_ROOT)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    console.error(
      `[uploads] 上传根目录不可用：${UPLOAD_ROOT}（${code ?? String(err)}）。` +
        'UPLOAD_ROOT 属部署职责（需挂载并授予 service user 权限），本进程不会自建它；' +
        '在修复前媒体上传会失败，其余功能不受影响。',
    )
  }
  try {
    await mkdir(join(UPLOAD_ROOT, '.tmp'), { recursive: true, mode: 0o750 })
    console.log(`[uploads] tmp 目录就绪：${join(UPLOAD_ROOT, '.tmp')}`)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    console.error(
      `[uploads] 无法创建 .tmp 目录：${join(UPLOAD_ROOT, '.tmp')}（${code ?? String(err)}）。` +
        '上传会失败；请检查 UPLOAD_ROOT 是否存在且对 service user 可写。',
    )
  }

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
    // 赋给**外层**变量（不是局部 const），这样 shutdown 能 clearInterval 它 ——
    // 局部变量会让心跳在关机窗口内继续跑，引发那个假警报（见 heartbeatTimer 的注释）。
    heartbeatTimer = setInterval(() => {
      void db.refresh().then((s) => {
        if (s.ready !== wasReady) {
          console.log(`[health] ready: ${wasReady} -> ${s.ready} (state=${s.state})`)
          wasReady = s.ready
        }
      })
    }, 10_000)
    heartbeatTimer.unref?.()
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
