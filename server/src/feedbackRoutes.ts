import { randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { TimemapCtx, TimemapSessionUser } from './timemap.ts'

/**
 * 用户反馈（bug / 功能建议）—— 043。
 *
 * 边界很清楚，刻意只做这么点事：
 *   · 写：**登录用户**提交一条（类别 + 正文 + 可选联系方式），带上提交时所在页面与版本号，
 *     让管理员能复现问题。不做"我的反馈列表"——本轮需求只要"能反馈"与"管理员能看到"。
 *   · 读：**仅管理员**。反馈里可能有用户的联系方式与未公开的问题描述，
 *     对普通用户暴露等于把别人的反馈内容与联系方式发给任意登录者。
 *   · 处理：管理员标记已处理/回退待处理，可写内部备注。备注**不**回传给用户端。
 *
 * 与 reports（举报）的区别写在迁移 043 的头部：举报针对站内内容，反馈针对产品本身，
 * 所以不复用同一张表，也不复用同一套状态名。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CATEGORIES = ['bug', 'feature', 'other'] as const
const STATUSES = ['open', 'resolved'] as const
type Category = (typeof CATEGORIES)[number]
type Status = (typeof STATUSES)[number]

const CONTENT_MIN = 5
const CONTENT_MAX = 1000
const CONTACT_MAX = 100
const PAGE_MAX = 200
const VERSION_MAX = 20
const NOTE_MAX = 500
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

const len = (text: string) => Array.from(text).length

interface FeedbackRow {
  id: string
  user_id: string | null
  category: Category
  content: string
  contact: string | null
  page_context: string | null
  app_version: string | null
  status: Status
  admin_note: string | null
  created_at: Date
  updated_at: Date
  submitter_name: string | null
  submitter_handle: string | null
}

const SELECT = `
  select f.id, f.user_id, f.category, f.content, f.contact, f.page_context, f.app_version,
         f.status, f.admin_note, f.created_at, f.updated_at,
         u.display_name as submitter_name, u.handle as submitter_handle
    from user_feedback f
    left join users u on u.id = f.user_id
`

function toJson(row: FeedbackRow) {
  return {
    id: row.id,
    category: row.category,
    content: row.content,
    contact: row.contact,
    pageContext: row.page_context,
    appVersion: row.app_version,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    submitter: row.user_id
      ? { id: row.user_id, displayName: row.submitter_name ?? '', handle: row.submitter_handle ?? '' }
      : null,
  }
}

export function registerFeedbackRoutes(ctx: TimemapCtx): void {
  const { app, db, resolveSession, dbUnavailable } = ctx

  type Guard = { ok: true; user: TimemapSessionUser } | { ok: false; code: number; body: Record<string, unknown> }
  const fail = (reply: FastifyReply, g: Extract<Guard, { ok: false }>) => {
    reply.code(g.code)
    return g.body
  }

  async function currentUser(req: FastifyRequest): Promise<Guard> {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return { ok: false, code: 503, body: { error: 'not_ready', reason: 'db_down' } }
    if (s.kind === 'none') return { ok: false, code: 401, body: { error: 'unauthorized' } }
    return { ok: true, user: s.user }
  }
  async function adminUser(req: FastifyRequest): Promise<Guard> {
    const g = await currentUser(req)
    if (!g.ok) return g
    if (g.user.role !== 'admin') return { ok: false, code: 403, body: { error: 'forbidden', reason: '需要学生管理员角色' } }
    return g
  }

  // =========================================================================
  // 提交反馈（登录用户）
  // =========================================================================
  app.post('/api/feedback', async (req, reply) => {
    const g = await currentUser(req)
    if (!g.ok) return fail(reply, g)

    const body = (req.body ?? {}) as Record<string, unknown>
    const category = typeof body.category === 'string' ? body.category.trim() : 'bug'
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    const contact = typeof body.contact === 'string' ? body.contact.trim() : ''
    const pageContext = typeof body.pageContext === 'string' ? body.pageContext.trim() : ''
    const appVersion = typeof body.appVersion === 'string' ? body.appVersion.trim() : ''

    const details: string[] = []
    if (!CATEGORIES.includes(category as Category)) details.push('反馈类型不合法（bug / feature / other）')
    if (len(content) < CONTENT_MIN || len(content) > CONTENT_MAX)
      details.push(`反馈内容需要 ${CONTENT_MIN}–${CONTENT_MAX} 字`)
    if (len(contact) > CONTACT_MAX) details.push(`联系方式不能超过 ${CONTACT_MAX} 字`)
    if (len(pageContext) > PAGE_MAX) details.push(`页面信息不能超过 ${PAGE_MAX} 字`)
    if (len(appVersion) > VERSION_MAX) details.push(`版本号不能超过 ${VERSION_MAX} 字`)
    if (details.length) {
      reply.code(400)
      return { error: 'invalid_payload', details }
    }

    try {
      const id = randomUUID()
      await db.pool.query(
        `insert into user_feedback (id, user_id, category, content, contact, page_context, app_version)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id,
          g.user.userId,
          category,
          content,
          contact || null,
          // 空串归一化为 null：与"没填"区分开，避免库里出现一堆空字符串
          pageContext || null,
          appVersion || null,
        ],
      )
      reply.code(201)
      return { id, status: 'open' }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // =========================================================================
  // 管理端：列表
  // =========================================================================
  app.get('/api/admin/feedback', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const g = await adminUser(req)
    if (!g.ok) return fail(reply, g)

    const query = req.query as { status?: string; limit?: string }
    const status = (query.status ?? 'open').trim()
    if (!STATUSES.includes(status as Status)) {
      reply.code(400)
      return { error: 'bad_status', got: status, allowed: STATUSES }
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT))

    try {
      const rows = (
        await db.pool.query<FeedbackRow>(
          `${SELECT} where f.status = $1 order by f.created_at desc, f.id desc limit ${limit}`,
          [status],
        )
      ).rows
      const counts = await db.pool.query<{ status: Status; total: string }>(
        'select status, count(*)::text as total from user_feedback group by status',
      )
      return {
        items: rows.map(toJson),
        counts: Object.fromEntries(counts.rows.map((r) => [r.status, Number(r.total)])),
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  // =========================================================================
  // 管理端：标记已处理 / 回退待处理
  // =========================================================================
  app.post('/api/admin/feedback/:id/status', async (req, reply) => {
    const g = await adminUser(req)
    if (!g.ok) return fail(reply, g)

    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    const status = typeof body.status === 'string' ? body.status.trim() : ''
    if (!STATUSES.includes(status as Status)) {
      reply.code(400)
      return { error: 'bad_status', got: status, allowed: STATUSES }
    }
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (len(note) > NOTE_MAX) {
      reply.code(400)
      return { error: 'invalid_payload', details: [`备注不能超过 ${NOTE_MAX} 字`] }
    }

    const client = await db.pool.connect()
    try {
      await client.query('begin')
      const row = (
        await client.query<{ id: string; status: Status }>('select id, status from user_feedback where id = $1 for update', [id])
      ).rows[0]
      if (!row) {
        await client.query('rollback')
        reply.code(404)
        return { error: 'not_found' }
      }
      await client.query(
        `update user_feedback
            set status = $2,
                admin_note = coalesce($3, admin_note),
                updated_at = now()
          where id = $1`,
        [id, status, note || null],
      )
      await client.query(
        'insert into audit_log (id, actor_id, action, target_type, target_id, reason) values ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), g.user.userId, status === 'resolved' ? 'feedback_resolve' : 'feedback_reopen', 'user_feedback', id, note || null],
      )
      await client.query('commit')
      const updated = (await db.pool.query<FeedbackRow>(`${SELECT} where f.id = $1`, [id])).rows[0]
      return toJson(updated as FeedbackRow)
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    } finally {
      client.release()
    }
  })
}
