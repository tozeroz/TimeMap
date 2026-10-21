/**
 * BJTU TimeMap P0 新增路由（F05 收藏 / F06 活动 / F07 举报与管理端 / 作者删除）。
 *
 * 为什么单独一个文件：index.ts 已 3000+ 行，P0 的七个新面（收藏、我的收藏、
 * 活动公开读、举报、管理端、作者删除、审计）集中在这里，契约与需求文档逐条对应。
 *
 * 与需求的对应（US-xx 见《BJTU TimeMap需求分析与产品设计文档》§5）：
 *   · POST/DELETE /api/posts/:id/favorite   → US-03 收藏可撤销、重复请求不重复计数
 *   · GET /api/me/favorites                 → US-03 收藏内容可在个人中心查看
 *   · DELETE /api/posts/:id                 → US-02 只有作者能够删除自己的帖子
 *   · DELETE /api/comments/:id              → US-03 只能删除自己的评论；删除后不计入有效评论量
 *   · POST /api/reports                     → US-08 举报进入待处理列表但**不自动下架**
 *   · GET /api/activities(:id)              → US-04 活动列表/详情 + 时间地点状态一致
 *   · POST/DELETE /api/activities/:id/favorite → US-04 活动收藏可撤销、重复请求不重复计数
 *   · GET /api/me/activity-favorites        → US-04 我的活动收藏（失效活动**保留**并标注状态）
 *   · /api/admin/*                          → US-08 管理员处理举报/内容/地点/活动 + 操作记录
 *
 * 热度规则（迭代一前确定并冻结的需求，先在此登记）：
 *   score = 点赞×2 + 有效评论×3 + 收藏×1 − max(0, 距发布小时数 − 24)
 *   「近期热门」= 近 7 天内发布的帖子按 score 降序，同分按时间降序。
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from './db'

export interface TimemapSessionUser {
  sessionId: string
  userId: string
  handle: string
  displayName: string
  phone: string | null
  role: string
}

export interface TimemapCtx {
  app: FastifyInstance
  db: Db
  resolveSession(
    authHeader: unknown,
  ): Promise<{ kind: 'ok'; user: TimemapSessionUser } | { kind: 'none' } | { kind: 'db_down' }>
  unauthorized(reply: { code: (n: number) => unknown }): unknown
  dbUnavailable(
    reply: { code: (n: number) => unknown; header: (k: string, v: string) => unknown },
    err: unknown,
  ): unknown
}

const UUID_RE = /^[0-9a-f-]{36}$/i
const REPORT_REASON_MAX = 500
const LIST_LIMIT = 200

/** 活动展示态：cancelled 为人工覆盖，其余按时间推导（ends_at 缺省按 2 小时计） */
const ACTIVITY_EFF_STATUS_SQL = `
  case
    when a.status = 'cancelled' then 'cancelled'
    when coalesce(a.ends_at, a.starts_at + interval '2 hours') < now() then 'ended'
    when a.starts_at <= now() then 'ongoing'
    else 'upcoming'
  end
`

type Reply = { code: (n: number) => unknown; header?: (k: string, v: string) => unknown }

type Guard<T> = { ok: true; user: T } | { ok: false; code: number; body: Record<string, unknown> }

function fail(reply: Reply, g: { ok: false; code: number; body: Record<string, unknown> }) {
  reply.code(g.code)
  return g.body
}

export function registerTimemapRoutes(ctx: TimemapCtx): void {
  const { app, db, resolveSession } = ctx

  async function requireUser(req: { headers: { authorization?: unknown } }): Promise<Guard<TimemapSessionUser>> {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down')
      return { ok: false, code: 503, body: { error: 'not_ready', reason: 'db_down' } }
    if (s.kind === 'none') return { ok: false, code: 401, body: { error: 'unauthorized' } }
    return { ok: true, user: s.user }
  }

  async function requireAdmin(req: {
    headers: { authorization?: unknown }
  }): Promise<Guard<TimemapSessionUser>> {
    const g = await requireUser(req)
    if (!g.ok) return g
    if (g.user.role !== 'admin')
      return { ok: false, code: 403, body: { error: 'forbidden', reason: '需要学生管理员角色' } }
    return g
  }

  async function audit(
    client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    actorId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    reason: string | null,
  ): Promise<void> {
    await client.query(
      'insert into audit_log (id, actor_id, action, target_type, target_id, reason) values ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), actorId, action, targetType, targetId, reason],
    )
  }

  // ===========================================================================
  // F05：收藏
  // ===========================================================================

  app.post('/api/posts/:id/favorite', async (req, reply) => {
    const g = await requireUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      const post = await db.pool.query<{ status: string }>('select status from posts where id = $1', [id])
      if (!post.rows[0] || post.rows[0].status !== 'published') {
        reply.code(404)
        return { error: 'not_found' }
      }
      // 唯一约束保证重复请求不重复计数；重复收藏是幂等成功
      await db.pool.query(
        'insert into favorites (id, post_id, user_id) values ($1,$2,$3) on conflict (user_id, post_id) do nothing',
        [randomUUID(), id, g.user.userId],
      )
      const c = await db.pool.query<{ n: string }>('select count(*)::text as n from favorites where post_id = $1', [id])
      reply.code(201)
      return { favorited: true, favoriteCount: Number(c.rows[0]!.n) }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.delete('/api/posts/:id/favorite', async (req, reply) => {
    const g = await requireUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      await db.pool.query('delete from favorites where post_id = $1 and user_id = $2', [id, g.user.userId])
      const c = await db.pool.query<{ n: string }>('select count(*)::text as n from favorites where post_id = $1', [id])
      return { favorited: false, favoriteCount: Number(c.rows[0]!.n) }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // ===========================================================================
  // US-03：收藏内容可在个人中心查看（我的收藏）。只返回仍公开的帖子——
  // 被下架/删除的内容同步从收藏列表消失；取消收藏后自然移除。
  // ===========================================================================

  app.get('/api/me/favorites', async (req, reply) => {
    const g = await requireUser(req)
    if (!g.ok) return fail(reply, g)
    try {
      const r = await db.pool.query<{
        id: string
        author_name: string
        author_id: string | null
        body: string
        place: string | null
        place_id: string | null
        created_at: Date
        like_count: string
        comment_count: string
        liked_by_me: boolean
        images: unknown
      }>(
        `select p.id, p.author_name, p.author_id, p.body, p.place, p.place_id, p.created_at,
                (select count(*) from likes l where l.post_id = p.id)::text as like_count,
                (select count(*) from comments c where c.post_id = p.id and c.status='published')::text as comment_count,
                exists (select 1 from likes l2 where l2.post_id = p.id and l2.user_id = $1::uuid) as liked_by_me,
                coalesce((
                  select json_agg(json_build_object('id', m.id, 'width', m.width, 'height', m.height) order by pm.position)
                    from post_media pm join media m on m.id = pm.media_id
                   where pm.post_id = p.id and m.scope = 'public' and m.mime like 'image/%'
                ), '[]'::json) as images
           from favorites f
           join posts p on p.id = f.post_id
          where f.user_id = $1 and p.status = 'published'
          order by f.created_at desc
          limit ${LIST_LIMIT}`,
        [g.user.userId],
      )
      return {
        items: r.rows.map((row) => ({
          id: row.id,
          author: row.author_name,
          authorId: row.author_id,
          body: row.body,
          place: row.place,
          placeId: row.place_id,
          createdAt: row.created_at.toISOString(),
          likeCount: Number.parseInt(row.like_count ?? '0', 10),
          commentCount: Number.parseInt(row.comment_count ?? '0', 10),
          likedByMe: row.liked_by_me,
          favoritedByMe: true,
          images: row.images ?? [],
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // ===========================================================================
  // US-02 / US-03：作者删除自己的帖子 / 评论（软下架：同步退出所有公开面）
  // ===========================================================================

  app.delete('/api/posts/:id', async (req, reply) => {
    const g = await requireUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      const r = await db.pool.query<{ id: string; author_id: string | null; status: string }>(
        'select id, author_id, status from posts where id = $1',
        [id],
      )
      const row = r.rows[0]
      if (!row) {
        reply.code(404)
        return { error: 'not_found' }
      }
      // US-02：只有作者能够删除自己的帖子（管理员下架走 /api/admin/posts/:id/takedown）
      if (row.author_id !== g.user.userId) {
        reply.code(403)
        return { error: 'forbidden', reason: '只有作者能够删除自己的帖子' }
      }
      if (row.status === 'published') {
        await db.pool.query(
          `update posts set status='removed', removed_reason='author_delete',
                  removed_by=$2, removed_at=now() where id=$1`,
          [id, g.user.userId],
        )
      }
      return { removed: true }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.delete('/api/comments/:id', async (req, reply) => {
    const g = await requireUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      const r = await db.pool.query<{ id: string; author_id: string | null; status: string }>(
        'select id, author_id, status from comments where id = $1',
        [id],
      )
      const row = r.rows[0]
      if (!row) {
        reply.code(404)
        return { error: 'not_found' }
      }
      if (row.author_id !== g.user.userId) {
        reply.code(403)
        return { error: 'forbidden', reason: '只能删除自己的评论' }
      }
      if (row.status === 'published') {
        await db.pool.query(
          `update comments set status='removed', removed_reason='author_delete',
                  removed_by=$2, removed_at=now() where id=$1`,
          [id, g.user.userId],
        )
      }
      return { removed: true }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // ===========================================================================
  // US-08：举报（学生）。举报成功进入待处理列表，**不自动下架**。
  // ===========================================================================

  app.post('/api/reports', async (req, reply) => {
    const g = await requireUser(req)
    if (!g.ok) return fail(reply, g)
    const payload = (req.body ?? {}) as Record<string, unknown>
    const targetType = typeof payload.targetType === 'string' ? payload.targetType : ''
    const targetId = typeof payload.targetId === 'string' ? payload.targetId : ''
    const reasonCode = typeof payload.reasonCode === 'string' && payload.reasonCode.trim() ? payload.reasonCode.trim() : 'other'
    const reasonText = typeof payload.reasonText === 'string' ? payload.reasonText.trim() : ''

    if (targetType !== 'post' && targetType !== 'comment') {
      reply.code(400)
      return { error: 'invalid_payload', details: ['targetType 必须是 post 或 comment'] }
    }
    if (!UUID_RE.test(targetId)) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['targetId 必须是合法 id'] }
    }
    if (reasonText.length > REPORT_REASON_MAX) {
      reply.code(400)
      return { error: 'invalid_payload', details: [`reasonText 不能超过 ${REPORT_REASON_MAX} 字`] }
    }

    try {
      // 目标必须真实存在且当前是公开状态（对已下架内容重复举报没有意义）
      const target =
        targetType === 'post'
          ? await db.pool.query<{ status: string }>('select status from posts where id = $1', [targetId])
          : await db.pool.query<{ status: string }>('select status from comments where id = $1', [targetId])
      if (!target.rows[0] || target.rows[0].status !== 'published') {
        reply.code(404)
        return { error: 'target_not_found', reason: '被举报内容不存在或已下架' }
      }

      const existing = await db.pool.query<{ id: string }>(
        `select id from reports
          where reporter_id = $1 and target_type = $2 and target_id = $3 and status = 'pending'`,
        [g.user.userId, targetType, targetId],
      )
      if (existing.rows[0]) {
        // 同一用户对同一目标只保留一条待处理举报：重复举报幂等返回原举报
        return { id: existing.rows[0].id, status: 'pending', duplicate: true }
      }
      const id = randomUUID()
      await db.pool.query(
        `insert into reports (id, target_type, target_id, reporter_id, reason_code, reason_text)
         values ($1,$2,$3,$4,$5,$6)`,
        [id, targetType, targetId, g.user.userId, reasonCode, reasonText || null],
      )
      reply.code(201)
      return { id, status: 'pending' }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // ===========================================================================
  // US-04：近期活动（公开只读）
  // ===========================================================================

  /**
   * 活动行的共享 SELECT。
   *
   * ⚠️ **接受一个参数 `$1`**：当前查看者的 user id（可为 NULL = 未登录）。
   *    只用于推导 `favoritedByMe`，不参与任何过滤 —— 活动始终是公开只读的，
   *    未登录也能看列表和详情（这一点与帖子收藏不同）。
   *    调用方必须传参：登录时传 user id、未登录传 null、管理端传 null。
   */
  const ACTIVITY_SELECT = `
    select a.id, a.title, a.description, a.starts_at, a.ends_at, a.source, a.status,
           a.activity_type, a.organizer, a.external_link, a.cover_image_id,
           ${ACTIVITY_EFF_STATUS_SQL} as eff_status,
           a.starts_at, coalesce(a.ends_at, a.starts_at + interval '2 hours') as eff_ends_at,
           pl.id as place_id, pl.name as place_name, pl.latitude as place_lat, pl.longitude as place_lng,
           pl.enabled as place_enabled,
           exists (select 1 from activity_favorites af
                    where af.activity_id = a.id and af.user_id = $1::uuid) as favorited_by_me,
           (select count(*) from activity_favorites afc
             where afc.activity_id = a.id)::text as favorite_count
      from activities a
      join places pl on pl.id = a.place_id
  `

  interface ActivityRow {
    id: string
    title: string
    description: string | null
    starts_at: Date
    ends_at: Date | null
    eff_ends_at: Date
    source: string
    status: string
    eff_status: string
    place_id: string
    place_name: string
    place_lat: number | string | null
    place_lng: number | string | null
    place_enabled: boolean
    favorited_by_me: boolean
    favorite_count: string
    activity_type: string | null
    organizer: string | null
    external_link: string | null
    cover_image_id: string | null
  }

  function activityToJson(row: ActivityRow) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at ? row.ends_at.toISOString() : null,
      effectiveEndsAt: row.eff_ends_at.toISOString(),
      source: row.source,
      /** 库存状态（管理员视角）：scheduled / cancelled */
      status: row.status,
      /** 展示态（学生视角）：upcoming / ongoing / ended / cancelled */
      effectiveStatus: row.eff_status,
      place: {
        id: row.place_id,
        name: row.place_name,
        latitude: row.place_lat === null ? null : Number(row.place_lat),
        longitude: row.place_lng === null ? null : Number(row.place_lng),
        enabled: row.place_enabled,
      },
      /** 当前查看者是否收藏过（US-04）。未登录恒为 false —— 活动列表/详情不需要登录。 */
      favoritedByMe: row.favorited_by_me,
      /** 收藏总数（**服务端权威值**，与帖子收藏同一口径：::text 取出后 parseInt） */
      favoriteCount: Number.parseInt(row.favorite_count ?? '0', 10),
      /**
       * ACT-003 要求的四个字段。
       * ⚠️ `activityType` 目前**没有任何取值约束**（取值集在 ACT-002 里是「待讨论」），
       *    所以它是自由文本、也**没有**对应的筛选功能 —— 不要在前端按它分组/筛选。
       */
      activityType: row.activity_type,
      organizer: row.organizer,
      externalLink: row.external_link,
      coverImageId: row.cover_image_id,
    }
  }

  app.get('/api/activities', async (req, reply) => {
    const query = req.query as { window?: string; status?: string; placeId?: string }

    /*
      ---- ACT-001 / ACT-002：状态筛选与地标筛选 ----

      ACT-001（已确认）：默认只展示"即将开始"和"进行中"，按开始时间从近到远；
      已结束和已取消**通过筛选**查看。

      ⚠️ 改前这里只有一个"近 7 天"窗口（`ends_at > now() - 7 day`），把最近结束的活动
         混进了默认列表，而前端又用 `effectiveStatus` 二次过滤 —— 结果是
         "已结束"筛选恒为空（窗口先把它们剔除，前端再筛一次自然一条不剩）。

      现在：`status` 在**服务端**生效，`ended` / `cancelled` / `all` **不套时间窗口**
      （历史活动是长期存在的事实，不是"近期列表"的一部分）。前端不再二次过滤。

      `placeId`（ACT-002 / PLACE-003）：活动**必须**有地点（activities.place_id NOT NULL），
      所以这里是等值过滤，不是 left join 的可空判断。非法 uuid → 400。
    */
    const status = query.status ?? ''
    const ALLOWED = ['', 'upcoming', 'ongoing', 'ended', 'cancelled', 'all']
    if (!ALLOWED.includes(status)) {
      reply.code(400)
      return { error: 'bad_status', got: status, allowed: ALLOWED }
    }
    const placeIdRaw = query.placeId ?? ''
    if (placeIdRaw && !UUID_RE.test(placeIdRaw)) {
      reply.code(400)
      return { error: 'bad_place_id', got: placeIdRaw }
    }

    const window = query.window ?? ''
    const conds: string[] = []
    if (status === '') {
      // 默认：近期 = 即将开始 + 进行中
      conds.push(`(${ACTIVITY_EFF_STATUS_SQL}) in ('upcoming','ongoing')`)
    } else if (status !== 'all') {
      // 白名单已校验，直接内插安全；'all' = 不按状态过滤
      conds.push(`(${ACTIVITY_EFF_STATUS_SQL}) = '${status}'`)
    }
    if (window === 'week') {
      // 一周内开始（或正在进行）的活动
      conds.push(`a.starts_at < now() + interval '7 day'`)
    } else if (window === 'today') {
      conds.push(`a.starts_at < now() + interval '1 day'`)
    }
    const params: unknown[] = []
    if (placeIdRaw) {
      // ⚠️ $1 被 ACTIVITY_SELECT 的 favoritedByMe 占用，所以地标是 $2
      conds.push(`a.place_id = $2::uuid`)
      params.push(placeIdRaw)
    }
    const whereCond = conds.length ? `where ${conds.join(' and ')}` : ''

    /*
      排序：默认/即将开始/进行中 = 开始时间从近到远（升序，进行中天然在前）；
      已结束/已取消/全部 = 从近到远地看历史，用降序（不然几百条历史活动要翻到底）。
    */
    const orderCond =
      status === 'ended' || status === 'cancelled' || status === 'all'
        ? `order by a.starts_at desc, a.id desc`
        : `order by a.starts_at, a.id`

    // 可选会话：活动**不需要**登录即可浏览，登录只用来推导 favoritedByMe
    // （与 index.ts:1749 的地点详情同一写法：未登录 ⇒ meId = null ⇒ favoritedByMe 恒 false）
    const sess = await resolveSession(req.headers.authorization)
    if (sess.kind === 'db_down') return ctx.dbUnavailable(reply, new Error('session lookup failed'))
    const meId = sess.kind === 'ok' ? sess.user.userId : null
    try {
      const r = await db.pool.query<ActivityRow>(
        `${ACTIVITY_SELECT}
          ${whereCond}
         ${orderCond}
         limit ${LIST_LIMIT}`,
        [meId, ...params],
      )
      return { items: r.rows.map(activityToJson) }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.get('/api/activities/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    // 可选会话：同列表，活动详情也不需要登录（见 ACTIVITY_SELECT 的 $1 说明）
    const sess = await resolveSession(req.headers.authorization)
    if (sess.kind === 'db_down') return ctx.dbUnavailable(reply, new Error('session lookup failed'))
    const meId = sess.kind === 'ok' ? sess.user.userId : null
    try {
      // ⚠️ $1 被 ACTIVITY_SELECT 的 favoritedByMe 占用，活动 id 因此是 $2
      const r = await db.pool.query<ActivityRow>(`${ACTIVITY_SELECT} where a.id = $2`, [meId, id])
      if (!r.rows[0]) {
        reply.code(404)
        return { error: 'not_found' }
      }
      return activityToJson(r.rows[0])
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // ===========================================================================
  // F06 / US-04：活动收藏 —— 与帖子的 F05 收藏**对称**，但独立成表。
  //
  // ⚠️ 与帖子收藏的两点差异，都是**有意**的：
  //   ① 活动是公开只读内容（未登录也能看列表/详情）⇒ 这三个端点是**新增面**，
  //      帖子那三个端点（/api/posts/:id/favorite、/api/me/favorites）一字未动。
  //   ② 活动**没有**删除/下架概念（学生不能改活动，US-04 验收④）⇒ 已结束/已取消
  //      的活动**保留**在收藏列表里，靠 effectiveStatus 标注状态，不做过滤。
  //      理由：活动状态是**时间推导**的，大量活动会自然结束；收藏了却找不到
  //      才是真的坏体验。（帖子那边相反：下架内容必须退出各展示入口，US-08。）
  // ===========================================================================

  /** 收藏一个活动（US-04）。幂等：UNIQUE(user_id, activity_id)，重复收藏不重复计数 */
  app.post('/api/activities/:id/favorite', async (req, reply) => {
    const g = await requireUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      const act = await db.pool.query<{ id: string }>('select id from activities where id = $1', [id])
      if (!act.rows[0]) {
        reply.code(404)
        return { error: 'not_found' }
      }
      // 唯一约束保证重复请求不重复计数；重复收藏是幂等成功
      await db.pool.query(
        'insert into activity_favorites (id, activity_id, user_id) values ($1,$2,$3) on conflict (user_id, activity_id) do nothing',
        [randomUUID(), id, g.user.userId],
      )
      const c = await db.pool.query<{ n: string }>(
        'select count(*)::text as n from activity_favorites where activity_id = $1',
        [id],
      )
      reply.code(201)
      return { favorited: true, favoriteCount: Number(c.rows[0]!.n) }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /** 取消收藏活动（US-04：收藏可撤销）。幂等：本来没收藏也返回 200 favorited=false */
  app.delete('/api/activities/:id/favorite', async (req, reply) => {
    const g = await requireUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    try {
      await db.pool.query('delete from activity_favorites where activity_id = $1 and user_id = $2', [
        id,
        g.user.userId,
      ])
      const c = await db.pool.query<{ n: string }>(
        'select count(*)::text as n from activity_favorites where activity_id = $1',
        [id],
      )
      return { favorited: false, favoriteCount: Number(c.rows[0]!.n) }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /**
   * 我的活动收藏（US-04）。与帖子的 /api/me/favorites 对称。
   *
   * ⚠️ **刻意不过滤**已结束/已取消的活动 —— 见本节顶部注释。
   *    排序按**收藏时间倒序**（最近收藏的在前），不是活动开始时间。
   */
  app.get('/api/me/activity-favorites', async (req, reply) => {
    const g = await requireUser(req)
    if (!g.ok) return fail(reply, g)
    try {
      // $1 同时服务两处，且两者恒等（都是当前登录用户）：
      //   · ACTIVITY_SELECT 里的 favoritedByMe 子查询
      //   · 下面这个 join 的 user 过滤
      const r = await db.pool.query<ActivityRow>(
        `${ACTIVITY_SELECT}
           join activity_favorites af2 on af2.activity_id = a.id and af2.user_id = $1
          order by af2.created_at desc
          limit ${LIST_LIMIT}`,
        [g.user.userId],
      )
      return { items: r.rows.map(activityToJson) }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // ===========================================================================
  // F07 / US-08：管理端（role=student admin）。所有写操作记 audit_log。
  // ===========================================================================

  app.get('/api/admin/reports', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    const status = (req.query as { status?: string }).status ?? 'pending'
    if (status !== 'pending' && status !== 'resolved') {
      reply.code(400)
      return { error: 'invalid_payload', details: ['status 必须是 pending 或 resolved'] }
    }
    try {
      const r = await db.pool.query<{
        id: string
        target_type: string
        target_id: string
        reason_code: string
        reason_text: string | null
        status: string
        resolution: string | null
        handle_reason: string | null
        handled_at: Date | null
        created_at: Date
        reporter_name: string | null
        target_body: string | null
        target_status: string | null
      }>(
        `select rp.id, rp.target_type, rp.target_id, rp.reason_code, rp.reason_text,
                rp.status, rp.resolution, rp.handle_reason, rp.handled_at, rp.created_at,
                u.display_name as reporter_name,
                coalesce(tp.body, tc.body) as target_body,
                coalesce(tp.status, tc.status) as target_status
           from reports rp
           join users u on u.id = rp.reporter_id
           left join posts tp on rp.target_type = 'post' and tp.id = rp.target_id
           left join comments tc on rp.target_type = 'comment' and tc.id = rp.target_id
          where rp.status = $1
          order by rp.created_at desc
          limit ${LIST_LIMIT}`,
        [status],
      )
      return {
        items: r.rows.map((row) => ({
          id: row.id,
          targetType: row.target_type,
          targetId: row.target_id,
          targetPreview: row.target_body,
          targetStatus: row.target_status,
          reasonCode: row.reason_code,
          reasonText: row.reason_text,
          status: row.status,
          resolution: row.resolution,
          handleReason: row.handle_reason,
          handledAt: row.handled_at ? row.handled_at.toISOString() : null,
          createdAt: row.created_at.toISOString(),
          reporterName: row.reporter_name,
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.post('/api/admin/reports/:id/resolve', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    const payload = (req.body ?? {}) as Record<string, unknown>
    const resolution = typeof payload.resolution === 'string' ? payload.resolution : ''
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
    if (resolution !== 'no_action' && resolution !== 'removed') {
      reply.code(400)
      return { error: 'invalid_payload', details: ["resolution 必须是 'no_action' 或 'removed'"] }
    }
    // US-08：不处理或下架时**必须**记录原因
    if (!reason) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['reason 不能为空（不处理与下架都必须记录原因）'] }
    }
    if (reason.length > REPORT_REASON_MAX) {
      reply.code(400)
      return { error: 'invalid_payload', details: [`reason 不能超过 ${REPORT_REASON_MAX} 字`] }
    }

    const client = await db.pool.connect()
    try {
      await client.query('begin')
      const r = await client.query<{ id: string; target_type: string; target_id: string; status: string }>(
        'select id, target_type, target_id, status from reports where id = $1 for update',
        [id],
      )
      const row = r.rows[0]
      if (!row) {
        await client.query('rollback')
        reply.code(404)
        return { error: 'not_found' }
      }
      if (row.status === 'resolved') {
        await client.query('rollback')
        reply.code(409)
        return { error: 'already_resolved' }
      }

      // 下架 = 目标内容 status→removed，同步退出所有公开面（列表/详情/地点/地图/热门）
      if (resolution === 'removed') {
        if (row.target_type === 'post') {
          await client.query(
            `update posts set status='removed', removed_reason=$2, removed_by=$3, removed_at=now()
              where id=$1 and status='published'`,
            [row.target_id, reason, g.user.userId],
          )
        } else {
          await client.query(
            `update comments set status='removed', removed_reason=$2, removed_by=$3, removed_at=now()
              where id=$1 and status='published'`,
            [row.target_id, reason, g.user.userId],
          )
        }
      }

      await client.query(
        `update reports set status='resolved', resolution=$2, handle_reason=$3,
                handled_by=$4, handled_at=now() where id=$1`,
        [id, resolution, reason, g.user.userId],
      )
      await audit(client, g.user.userId, resolution === 'removed' ? 'report_resolve_remove' : 'report_resolve_no_action', row.target_type, row.target_id, reason)
      await client.query('commit')
      return { id, status: 'resolved', resolution }
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    } finally {
      client.release()
    }
  })

  app.get('/api/admin/posts', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    try {
      const r = await db.pool.query<{
        id: string
        author_name: string
        body: string
        place: string | null
        status: string
        removed_reason: string | null
        created_at: Date
      }>(
        `select id, author_name, body, place, status, removed_reason, created_at
           from posts order by created_at desc limit ${LIST_LIMIT}`,
      )
      return {
        items: r.rows.map((row) => ({
          id: row.id,
          author: row.author_name,
          body: row.body,
          place: row.place,
          status: row.status,
          removedReason: row.removed_reason,
          createdAt: row.created_at.toISOString(),
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.post('/api/admin/posts/:id/takedown', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    const payload = (req.body ?? {}) as Record<string, unknown>
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
    if (!reason) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['reason 不能为空（下架必须记录原因）'] }
    }
    const client = await db.pool.connect()
    try {
      await client.query('begin')
      const r = await client.query<{ id: string; status: string }>(
        'select id, status from posts where id = $1 for update',
        [id],
      )
      if (!r.rows[0]) {
        await client.query('rollback')
        reply.code(404)
        return { error: 'not_found' }
      }
      await client.query(
        `update posts set status='removed', removed_reason=$2, removed_by=$3, removed_at=now()
          where id=$1 and status='published'`,
        [id, reason, g.user.userId],
      )
      await audit(client, g.user.userId, 'post_takedown', 'post', id, reason)
      await client.query('commit')
      return { id, status: 'removed' }
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    } finally {
      client.release()
    }
  })

  // ---- 地点管理（F02：管理员维护启用/停用与资料）----

  app.get('/api/admin/places', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    try {
      const r = await db.pool.query<{
        id: string
        name: string
        address: string | null
        latitude: number | string | null
        longitude: number | string | null
        category: string
        enabled: boolean
        description: string | null
        history: string | null
        sort_order: number
        post_count: string
      }>(
        `select pl.*, (select count(*) from posts p where p.place_id = pl.id and p.status='published')::text as post_count
           from places pl order by pl.sort_order, pl.name`,
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
          description: row.description,
          history: row.history,
          sortOrder: row.sort_order,
          postCount: Number(row.post_count),
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.post('/api/admin/places', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    const payload = (req.body ?? {}) as Record<string, unknown>
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (!name) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['name 不能为空'] }
    }
    if (name.length > 40) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['name 不能超过 40 字'] }
    }
    const category = typeof payload.category === 'string' && payload.category ? payload.category : '地标'
    if (category !== '地标' && category !== '食堂') {
      reply.code(400)
      return { error: 'invalid_payload', details: ["category 必须是 '地标' 或 '食堂'"] }
    }
    const id = randomUUID()
    try {
      const r = await db.pool.query<{ id: string }>(
        `insert into places (id, name, category, address, latitude, longitude, description, history, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [
          id,
          name,
          category,
          typeof payload.address === 'string' ? payload.address.trim() || null : null,
          typeof payload.latitude === 'number' ? payload.latitude : null,
          typeof payload.longitude === 'number' ? payload.longitude : null,
          typeof payload.description === 'string' ? payload.description.trim() || null : null,
          typeof payload.history === 'string' ? payload.history.trim() || null : null,
          typeof payload.sortOrder === 'number' ? payload.sortOrder : 100,
        ],
      )
      const client = await db.pool.connect()
      try {
        await client.query('begin')
        await audit(client, g.user.userId, 'place_create', 'place', r.rows[0]!.id, null)
        await client.query('commit')
      } catch (e) {
        await client.query('rollback').catch(() => undefined)
        throw e
      } finally {
        client.release()
      }
      reply.code(201)
      return { id: r.rows[0]!.id }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.patch('/api/admin/places/:id', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    const payload = (req.body ?? {}) as Record<string, unknown>
    const allowed = ['name', 'category', 'address', 'latitude', 'longitude', 'description', 'history', 'enabled', 'sortOrder']
    const extra = Object.keys(payload).filter((k) => !allowed.includes(k))
    if (extra.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: [`不支持字段: ${extra.join(', ')}`] }
    }
    const sets: string[] = []
    const params: unknown[] = []
    const push = (col: string, val: unknown) => {
      params.push(val)
      sets.push(`${col} = $${params.length}`)
    }
    if (payload.name !== undefined) {
      const name = typeof payload.name === 'string' ? payload.name.trim() : ''
      if (!name || name.length > 40) {
        reply.code(400)
        return { error: 'invalid_payload', details: ['name 必须是非空且不超过 40 字'] }
      }
      push('name', name)
    }
    if (payload.category !== undefined) {
      if (payload.category !== '地标' && payload.category !== '食堂') {
        reply.code(400)
        return { error: 'invalid_payload', details: ["category 必须是 '地标' 或 '食堂'"] }
      }
      push('category', payload.category)
    }
    if (payload.address !== undefined) push('address', typeof payload.address === 'string' ? payload.address.trim() || null : null)
    if (payload.latitude !== undefined) push('latitude', typeof payload.latitude === 'number' ? payload.latitude : null)
    if (payload.longitude !== undefined) push('longitude', typeof payload.longitude === 'number' ? payload.longitude : null)
    if (payload.description !== undefined) push('description', typeof payload.description === 'string' ? payload.description.trim() || null : null)
    if (payload.history !== undefined) push('history', typeof payload.history === 'string' ? payload.history.trim() || null : null)
    if (payload.enabled !== undefined) {
      if (typeof payload.enabled !== 'boolean') {
        reply.code(400)
        return { error: 'invalid_payload', details: ['enabled 必须是布尔值'] }
      }
      push('enabled', payload.enabled)
    }
    if (payload.sortOrder !== undefined) push('sort_order', typeof payload.sortOrder === 'number' ? payload.sortOrder : 100)
    if (!sets.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['没有要更新的字段'] }
    }
    params.push(id)
    try {
      const r = await db.pool.query<{ id: string }>(
        `update places set ${sets.join(', ')} where id = $${params.length} returning id`,
        params,
      )
      if (!r.rows[0]) {
        reply.code(404)
        return { error: 'not_found' }
      }
      const client = await db.pool.connect()
      try {
        await client.query('begin')
        await audit(client, g.user.userId, 'place_update', 'place', id, JSON.stringify(payload))
        await client.query('commit')
      } catch (e) {
        await client.query('rollback').catch(() => undefined)
        throw e
      } finally {
        client.release()
      }
      return { id: r.rows[0].id }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // ---- 活动管理（F06：管理员录入/修改；无报名/支付）----

  app.get('/api/admin/activities', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    try {
      // 管理端传 null：这里是"看全部活动"，不是"我的收藏视图"，
      // favoritedByMe 无意义（恒 false）。但 ACTIVITY_SELECT 必须拿到 $1。
      const r = await db.pool.query<ActivityRow>(
        `${ACTIVITY_SELECT} order by a.starts_at desc limit ${LIST_LIMIT}`,
        [null],
      )
      return { items: r.rows.map(activityToJson) }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  /** 活动的公共字段校验：缺少必要时间或地点时不能作为正式活动发布（US-04） */
  function parseActivityPayload(payload: Record<string, unknown>, partial: boolean): { errors: string[]; fields: Record<string, unknown> } {
    const errors: string[] = []
    const fields: Record<string, unknown> = {}
    if (!partial || payload.title !== undefined) {
      const title = typeof payload.title === 'string' ? payload.title.trim() : ''
      if (!title || title.length > 60) errors.push('title 不能为空且不超过 60 字')
      else fields.title = title
    }
    if (!partial || payload.placeId !== undefined) {
      if (typeof payload.placeId !== 'string' || !UUID_RE.test(payload.placeId)) errors.push('placeId 必须是合法地点 id')
      else fields.placeId = payload.placeId
    }
    if (!partial || payload.startsAt !== undefined) {
      const t = typeof payload.startsAt === 'string' ? Date.parse(payload.startsAt) : NaN
      if (!Number.isFinite(t)) errors.push('startsAt 必须是合法的 ISO 时间')
      else fields.startsAt = new Date(t).toISOString()
    }
    if (payload.endsAt !== undefined) {
      if (payload.endsAt === null) fields.endsAt = null
      else {
        const t = typeof payload.endsAt === 'string' ? Date.parse(payload.endsAt) : NaN
        if (!Number.isFinite(t)) errors.push('endsAt 必须是合法的 ISO 时间或 null')
        else fields.endsAt = new Date(t).toISOString()
      }
    }
    if (payload.description !== undefined)
      fields.description = typeof payload.description === 'string' ? payload.description.trim() || null : null
    if (payload.source !== undefined)
      fields.source = typeof payload.source === 'string' ? payload.source.trim() || '管理员录入' : '管理员录入'

    /*
      ---- ACT-003 新增字段（022）----
      ① 三个文本字段沿用 description 的既有口径：trim 后为空 ⇒ 存 null。
         不把空串写进库 —— 空串与"没填"在展示层是两回事。
      ② `activityType` **故意不做取值校验**：取值集在 ACT-002 里是「待讨论」，
         这里编一套枚举就是文档明令禁止的"由开发/AI 自行补齐"。
         只加长度上限，防止把整篇文章塞进来。
      ③ `externalLink` 只校验"是不是无凭证的 http(s) 绝对地址"，
         **不**在这里决定打开方式（新窗口 / 风险提示在 ACT-003 里是「待讨论」）。
    */
    const TEXT_LIMITS: Record<string, number> = { activityType: 40, organizer: 60, externalLink: 500 }
    for (const [key, max] of Object.entries(TEXT_LIMITS)) {
      if (payload[key] === undefined) continue
      const raw = payload[key]
      if (raw === null) {
        fields[key] = null
        continue
      }
      if (typeof raw !== 'string') {
        errors.push(`${key} 必须是字符串或 null`)
        continue
      }
      const v = raw.trim()
      if (!v) fields[key] = null
      else if (v.length > max) errors.push(`${key} 不能超过 ${max} 字`)
      else fields[key] = v
    }
    if (fields.externalLink) {
      let ok = false
      try {
        const u = new URL(fields.externalLink as string)
        ok = (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password
      } catch {
        ok = false
      }
      // 不是"尽力解析"，是拒绝：带凭证的链接（https://user:pass@…）会被原样渲染出去
      if (!ok) {
        errors.push('externalLink 必须是 http(s) 开头、且不含账号密码的合法链接')
        delete fields.externalLink
      }
    }
    if (payload.coverImageId !== undefined) {
      if (payload.coverImageId === null) fields.coverImageId = null
      else if (typeof payload.coverImageId === 'string' && UUID_RE.test(payload.coverImageId))
        fields.coverImageId = payload.coverImageId
      else errors.push('coverImageId 必须是合法媒体 id 或 null')
    }

    return { errors, fields }
  }

  app.post('/api/admin/activities', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    const { errors, fields } = parseActivityPayload((req.body ?? {}) as Record<string, unknown>, false)
    if (errors.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: errors }
    }
    const id = randomUUID()
    const client = await db.pool.connect()
    try {
      await client.query('begin')
      // 地点必须存在且启用
      const place = await client.query<{ enabled: boolean }>('select enabled from places where id = $1', [fields.placeId])
      if (!place.rows[0]) {
        await client.query('rollback')
        reply.code(400)
        return { error: 'invalid_payload', details: ['地点不存在'] }
      }
      if (!place.rows[0].enabled) {
        await client.query('rollback')
        reply.code(400)
        return { error: 'invalid_payload', details: ['地点已停用，不能关联活动'] }
      }
      if (
        fields.endsAt &&
        fields.startsAt &&
        Date.parse(fields.endsAt as string) <= Date.parse(fields.startsAt as string)
      ) {
        await client.query('rollback')
        reply.code(400)
        return { error: 'invalid_payload', details: ['endsAt 必须晚于 startsAt'] }
      }
      await client.query(
        `insert into activities (id, title, description, place_id, starts_at, ends_at, source, status, created_by,
                                 activity_type, organizer, external_link, cover_image_id)
         values ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8,$9,$10,$11,$12)`,
        [
          id,
          fields.title,
          fields.description ?? null,
          fields.placeId,
          fields.startsAt,
          fields.endsAt ?? null,
          fields.source ?? '管理员录入',
          g.user.userId,
          fields.activityType ?? null,
          fields.organizer ?? null,
          fields.externalLink ?? null,
          fields.coverImageId ?? null,
        ],
      )
      await audit(client, g.user.userId, 'activity_create', 'activity', id, null)
      await client.query('commit')
      reply.code(201)
      return { id }
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    } finally {
      client.release()
    }
  })

  app.patch('/api/admin/activities/:id', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(400)
      return { error: 'invalid_id' }
    }
    const payload = (req.body ?? {}) as Record<string, unknown>
    const { errors, fields } = parseActivityPayload(payload, true)
    if (payload.status !== undefined) {
      if (payload.status !== 'scheduled' && payload.status !== 'cancelled') {
        errors.push("status 只能是 'scheduled' 或 'cancelled'（展示态由服务端按时间推导）")
      } else {
        fields.status = payload.status
      }
    }
    if (errors.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: errors }
    }
    if (!Object.keys(fields).length) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['没有要更新的字段'] }
    }
    const client = await db.pool.connect()
    try {
      await client.query('begin')
      const cur = await client.query<{ id: string; starts_at: Date; ends_at: Date | null }>(
        'select id, starts_at, ends_at from activities where id = $1 for update',
        [id],
      )
      if (!cur.rows[0]) {
        await client.query('rollback')
        reply.code(404)
        return { error: 'not_found' }
      }
      if (fields.placeId !== undefined) {
        const place = await client.query<{ enabled: boolean }>('select enabled from places where id = $1', [fields.placeId])
        if (!place.rows[0] || !place.rows[0].enabled) {
          await client.query('rollback')
          reply.code(400)
          return { error: 'invalid_payload', details: ['地点不存在或已停用'] }
        }
      }
      const startsAt = (fields.startsAt as string | undefined) ?? cur.rows[0].starts_at.toISOString()
      const endsAt =
        fields.endsAt !== undefined
          ? (fields.endsAt as string | null)
          : cur.rows[0].ends_at
            ? cur.rows[0].ends_at.toISOString()
            : null
      if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
        await client.query('rollback')
        reply.code(400)
        return { error: 'invalid_payload', details: ['endsAt 必须晚于 startsAt'] }
      }
      const cols = Object.keys(fields)
      /*
        ⚠️ 这个映射表是**必需**的，不是可选的美化：没被映射到的字段会被**原样当列名**拼进 SQL。
        所以每加一个 camelCase 字段（activityType / externalLink / coverImageId …），
        必须在这里补一条，否则拼出 `activityType = $n` ⇒ 列不存在 ⇒ 整个 PATCH 500。
        （title / description / source / organizer 是单词，蛇形与驼峰相同，无需映射。）
      */
      const COLUMN_OF: Record<string, string> = {
        placeId: 'place_id',
        startsAt: 'starts_at',
        endsAt: 'ends_at',
        activityType: 'activity_type',
        externalLink: 'external_link',
        coverImageId: 'cover_image_id',
      }
      const sets = cols.map((c, i) => {
        const col = COLUMN_OF[c] ?? c
        return `${col} = $${i + 1}`
      })
      sets.push(`updated_at = now()`)
      await client.query(
        `update activities set ${sets.join(', ')} where id = $${cols.length + 1}`,
        [...cols.map((c) => fields[c]), id],
      )
      await audit(client, g.user.userId, 'activity_update', 'activity', id, JSON.stringify(payload))
      await client.query('commit')
      return { id }
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    } finally {
      client.release()
    }
  })

  app.get('/api/admin/audit-log', async (req, reply) => {
    const g = await requireAdmin(req)
    if (!g.ok) return fail(reply, g)
    try {
      const r = await db.pool.query<{
        id: string
        action: string
        target_type: string
        target_id: string | null
        reason: string | null
        created_at: Date
        actor_name: string
      }>(
        `select a.id, a.action, a.target_type, a.target_id, a.reason, a.created_at,
                u.display_name as actor_name
           from audit_log a join users u on u.id = a.actor_id
          order by a.created_at desc limit ${LIST_LIMIT}`,
      )
      return {
        items: r.rows.map((row) => ({
          id: row.id,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          reason: row.reason,
          createdAt: row.created_at.toISOString(),
          actorName: row.actor_name,
        })),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })
}
