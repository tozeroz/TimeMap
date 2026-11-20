import { randomUUID } from 'node:crypto'
import type { TimemapCtx } from './timemap.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function registerProjectReviewRoutes(ctx: TimemapCtx) {
  const { app, db, resolveSession } = ctx
  app.get('/api/projects/:id/reviews', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const id = (req.params as { id: string }).id
    if (!UUID.test(id)) return reply.code(400).send({ error: 'invalid_id' })
    const session = await resolveSession(req.headers.authorization)
    if (session.kind === 'db_down') return reply.code(503).send({ error: 'not_ready' })
    const cursor = (req.query as { cursor?: string }).cursor
    let at: string | null = null, after: string | null = null
    if (cursor) {
      try {
        if (cursor.length > 512) throw new Error()
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        if (typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at)) || typeof value.id !== 'string' || !UUID.test(value.id)) throw new Error()
        at = value.at; after = value.id
      } catch { return reply.code(400).send({ error: 'invalid_cursor' }) }
    }
    try {
      if (!(await db.pool.query('select id from training_projects where id=$1 and published', [id])).rows.length) return reply.code(404).send({ error: 'not_found' })
      const result = await db.pool.query(`select r.id,r.body,r.created_at as "createdAt",r.user_id as "userId",
        u.display_name as "displayName",u.avatar_media_id as "avatarMediaId"
        from training_project_reviews r join users u on u.id=r.user_id
        where r.project_id=$1 and r.deleted_at is null and ($2::timestamptz is null or (r.created_at,r.id)<($2::timestamptz,$3::uuid))
        order by r.created_at desc,r.id desc limit 21`, [id, at, after])
      const rows = result.rows.slice(0, 20), last = rows.at(-1)
      const total = (await db.pool.query('select count(*)::int as total from training_project_reviews where project_id=$1 and deleted_at is null', [id])).rows[0].total
      return { items: rows.map(row => ({ ...row, canDelete: session.kind === 'ok' && (session.user.userId === row.userId || session.user.role === 'admin') })), total,
        nextCursor: result.rows.length > 20 && last ? Buffer.from(JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null }
    } catch (err) { app.log.error(err); return ctx.dbUnavailable(reply, err) }
  })
  app.post('/api/projects/:id/reviews', async (req, reply) => {
    const session = await resolveSession(req.headers.authorization)
    if (session.kind === 'db_down') return reply.code(503).send({ error: 'not_ready' })
    if (session.kind === 'none') return reply.code(401).send({ error: 'unauthorized' })
    const id = (req.params as { id: string }).id, payload = req.body as Record<string, unknown> | null
    if (!UUID.test(id)) return reply.code(400).send({ error: 'invalid_id' })
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['body', 'clientRequestId'].includes(k))) return reply.code(400).send({ error: 'invalid_payload' })
    const body = typeof payload.body === 'string' ? payload.body.trim() : ''
    if (!body || Array.from(body).length > 500 || typeof payload.clientRequestId !== 'string' || !UUID.test(payload.clientRequestId)) return reply.code(400).send({ error: 'invalid_payload', details: ['评价须为 1–500 字，并携带有效请求 ID'] })
    let client
    try {
      client = await db.pool.connect(); await client.query('begin')
      const project = (await client.query('select published from training_projects where id=$1 for update', [id])).rows[0]
      if (!project?.published) { await client.query('rollback'); return reply.code(404).send({ error: 'not_found' }) }
      const previous = (await client.query('select id,project_id,body,deleted_at from training_project_reviews where user_id=$1 and client_request_id=$2', [session.user.userId, payload.clientRequestId])).rows[0]
      if (previous && (previous.project_id !== id || previous.body !== body || previous.deleted_at)) { await client.query('rollback'); return reply.code(409).send({ error: 'request_conflict' }) }
      const reviewId = previous?.id ?? randomUUID()
      if (!previous) await client.query('insert into training_project_reviews(id,project_id,user_id,body,client_request_id) values($1,$2,$3,$4,$5)', [reviewId, id, session.user.userId, body, payload.clientRequestId])
      await client.query('commit')
      return reply.code(previous ? 200 : 201).send({ id: reviewId })
    } catch (err) {
      await client?.query('rollback').catch(() => {})
      if ((err as { code?: string }).code === '23505') return reply.code(409).send({ error: 'request_conflict' })
      app.log.error(err); return ctx.dbUnavailable(reply, err)
    } finally { client?.release() }
  })
  app.delete('/api/projects/:id/reviews/:reviewId', async (req, reply) => {
    const session = await resolveSession(req.headers.authorization)
    if (session.kind === 'db_down') return reply.code(503).send({ error: 'not_ready' })
    if (session.kind === 'none') return reply.code(401).send({ error: 'unauthorized' })
    const { id, reviewId } = req.params as { id: string; reviewId: string }
    if (!UUID.test(id) || !UUID.test(reviewId)) return reply.code(400).send({ error: 'invalid_id' })
    try {
      const result = await db.pool.query(`update training_project_reviews set deleted_at=coalesce(deleted_at,now())
        where id=$1 and project_id=$2 and (user_id=$3 or $4) returning id`, [reviewId, id, session.user.userId, session.user.role === 'admin'])
      return result.rows.length ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' })
    } catch (err) { app.log.error(err); return ctx.dbUnavailable(reply, err) }
  })
}
