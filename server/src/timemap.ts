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

  const ACTIVITY_SELECT = `
    select a.id, a.title, a.description, a.starts_at, a.ends_at, a.source, a.status,
           ${ACTIVITY_EFF_STATUS_SQL} as eff_status,
           a.starts_at, coalesce(a.ends_at, a.starts_at + interval '2 hours') as eff_ends_at,
           pl.id as place_id, pl.name as place_name, pl.latitude as place_lat, pl.longitude as place_lng,
           pl.enabled as place_enabled
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
    }
  }

  app.get('/api/activities', async (req, reply) => {
    const window = (req.query as { window?: string }).window ?? ''
    let windowCond = ''
    if (window === 'week') {
      // 一周内开始（或正在进行）的活动
      windowCond = `where (${ACTIVITY_EFF_STATUS_SQL}) in ('upcoming','ongoing')
                     and a.starts_at < now() + interval '7 day'`
    } else if (window === 'today') {
      windowCond = `where (${ACTIVITY_EFF_STATUS_SQL}) in ('upcoming','ongoing')
                     and a.starts_at < now() + interval '1 day'`
    } else {
      // 默认：近期活动 = 尚未结束的 + 刚结束（7 天内）的 + 近期取消（醒目标注）的；
      // 更早的历史活动自动退出近期列表
      windowCond = `where coalesce(a.ends_at, a.starts_at + interval '2 hours') > now() - interval '7 day'`
    }
    try {
      const r = await db.pool.query<ActivityRow>(
        `${ACTIVITY_SELECT}
          ${windowCond}
         order by case (${ACTIVITY_EFF_STATUS_SQL})
                    when 'ongoing' then 0 when 'upcoming' then 1
                    when 'ended' then 2 else 3 end,
                  a.starts_at
         limit ${LIST_LIMIT}`,
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
    try {
      const r = await db.pool.query<ActivityRow>(`${ACTIVITY_SELECT} where a.id = $1`, [id])
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
      const r = await db.pool.query<ActivityRow>(
        `${ACTIVITY_SELECT} order by a.starts_at desc limit ${LIST_LIMIT}`,
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
        `insert into activities (id, title, description, place_id, starts_at, ends_at, source, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8)`,
        [
          id,
          fields.title,
          fields.description ?? null,
          fields.placeId,
          fields.startsAt,
          fields.endsAt ?? null,
          fields.source ?? '管理员录入',
          g.user.userId,
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
      const sets = cols.map((c, i) => {
        const col = c === 'placeId' ? 'place_id' : c === 'startsAt' ? 'starts_at' : c === 'endsAt' ? 'ends_at' : c
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
