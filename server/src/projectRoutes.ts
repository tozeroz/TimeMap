import { randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { TimemapCtx } from './timemap.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const names = new Intl.Collator('zh-CN', { sensitivity: 'variant', numeric: false })
export interface ProjectFields {
  name: string; summary: string; groupName: string; memberCount: number
  experienceUrl: string; coverImageId: string | null; position: number; published: boolean
}
export interface Project extends ProjectFields { id: string; likeCount: number; likedByMe: boolean }

/** Complete class catalogue: sort before returning, never sort a truncated page. */
export function sortProjects(items: Project[], popular: boolean) {
  return items.sort((a, b) => (popular ? b.likeCount - a.likeCount : a.position - b.position)
    || names.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function parseProject(payload: unknown): { fields?: ProjectFields; errors: string[] } {
  const errors: string[] = []
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { errors: ['请填写项目信息'] }
  const p = payload as Record<string, unknown>
  const allowed = ['name', 'summary', 'groupName', 'memberCount', 'experienceUrl', 'coverImageId', 'position', 'published']
  if (Object.keys(p).some(k => !allowed.includes(k))) errors.push('包含不支持的项目字段')
  const text = (key: string, label: string, max: number) => {
    const value = typeof p[key] === 'string' ? p[key].trim() : ''
    if (!value || Array.from(value).length > max) errors.push(`${label}须为 1–${max} 字`)
    return value
  }
  const name = text('name', '项目名称', 80), summary = text('summary', '一句话简介', 160)
  const groupName = text('groupName', '小组名称', 60), experienceUrl = text('experienceUrl', '体验网址', 2048)
  try {
    const url = new URL(experienceUrl)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error()
  } catch { errors.push('请填写有效的 HTTP/HTTPS 体验网址') }
  const memberCount = p.memberCount, position = p.position
  if (typeof memberCount !== 'number' || !Number.isInteger(memberCount) || memberCount < 1 || memberCount > 100) errors.push('小组人数须为 1–100 的整数')
  if (typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position > 10000) errors.push('展示顺序须为 0–10000 的整数')
  if (typeof p.published !== 'boolean') errors.push('请选择展示状态')
  const coverImageId = p.coverImageId === null ? null : typeof p.coverImageId === 'string' && UUID.test(p.coverImageId) ? p.coverImageId : null
  if (!coverImageId) errors.push('请上传项目封面')
  return errors.length ? { errors } : { errors, fields: { name, summary, groupName, experienceUrl, memberCount: memberCount as number, position: position as number, published: p.published as boolean, coverImageId } }
}

const SELECT = `select p.id, p.name, p.summary, p.group_name as "groupName",
  p.member_count as "memberCount", p.experience_url as "experienceUrl", p.cover_image_id as "coverImageId",
  p.position, p.published, (select count(*)::int from training_project_likes l where l.project_id=p.id) as "likeCount",
  exists(select 1 from training_project_likes l where l.project_id=p.id and l.user_id=$1::uuid) as "likedByMe"
  from training_projects p`

export function registerProjectRoutes(ctx: TimemapCtx) {
  const { app, db, resolveSession } = ctx
  async function user(req: FastifyRequest, reply: FastifyReply, admin = false) {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') { reply.code(503).send({ error: 'not_ready' }); return null }
    if (s.kind === 'none') { reply.code(401).send({ error: 'unauthorized' }); return null }
    if (admin && s.user.role !== 'admin') { reply.code(403).send({ error: 'forbidden' }); return null }
    return s.user
  }
  const failed = (reply: FastifyReply, err: unknown) => {
    if (db.noteFailure(err) === 'transient') return ctx.dbUnavailable(reply, err)
    app.log.error(err)
    return reply.code(500).send({ error: 'project_operation_failed' })
  }
  app.get('/api/projects', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const session = await resolveSession(req.headers.authorization)
    if (session.kind === 'db_down') return reply.code(503).send({ error: 'not_ready' })
    try {
      const r = await db.pool.query<Project>(SELECT + ' where p.published', [session.kind === 'ok' ? session.user.userId : null])
      const items = sortProjects(r.rows, (req.query as { view?: string }).view === 'popular')
      return { items, total: items.length }
    } catch (err) { return failed(reply, err) }
  })
  app.get('/api/admin/projects', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const u = await user(req, reply, true); if (!u) return
    try { return { items: sortProjects((await db.pool.query<Project>(SELECT, [u.userId])).rows, false) } }
    catch (err) { return failed(reply, err) }
  })

  for (const method of ['POST', 'PUT'] as const) app.route({
    method, url: method === 'POST' ? '/api/admin/projects' : '/api/admin/projects/:id',
    handler: async (req, reply) => {
      const u = await user(req, reply, true); if (!u) return
      const id = method === 'POST' ? randomUUID() : (req.params as { id: string }).id
      if (!UUID.test(id)) return reply.code(400).send({ error: 'invalid_id' })
      const parsed = parseProject(req.body)
      if (!parsed.fields) return reply.code(400).send({ error: 'invalid_payload', details: parsed.errors })
      const p = parsed.fields
      let client
      try {
        client = await db.pool.connect()
        await client.query('begin')
        // Lock the media row while attaching it; only public uploaded images can be used.
        const media = await client.query("select id from media where id=$1 and scope='public' and mime like 'image/%' for key share", [p.coverImageId])
        if (!media.rows.length) { await client.query('rollback'); return reply.code(400).send({ error: 'invalid_payload', details: ['封面须为已上传的公开图片'] }) }
        const args = [id, p.name, p.summary, p.groupName, p.memberCount, p.experienceUrl, p.coverImageId, p.position, p.published]
        const r = method === 'POST'
          ? await client.query(`insert into training_projects(id,name,summary,group_name,member_count,experience_url,cover_image_id,position,published) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, args)
          : await client.query(`update training_projects set name=$2,summary=$3,group_name=$4,member_count=$5,experience_url=$6,cover_image_id=$7,position=$8,published=$9,updated_at=now() where id=$1 returning id`, args)
        if (!r.rows.length) { await client.query('rollback'); return reply.code(404).send({ error: 'not_found' }) }
        await client.query('insert into audit_log(id,actor_id,action,target_type,target_id,reason) values($1,$2,$3,$4,$5,$6)', [randomUUID(), u.userId, method === 'POST' ? 'project_create' : 'project_update', 'project', id, p.published ? '项目上架/更新' : '项目下架/草稿'])
        await client.query('commit')
        return reply.code(method === 'POST' ? 201 : 200).send({ id })
      } catch (err) { await client?.query('rollback').catch(() => {}); return failed(reply, err) }
      finally { client?.release() }
    },
  })

  for (const method of ['PUT', 'DELETE'] as const) app.route({
    method, url: '/api/projects/:id/like', handler: async (req, reply) => {
      const u = await user(req, reply); if (!u) return
      const id = (req.params as { id: string }).id
      if (!UUID.test(id)) return reply.code(400).send({ error: 'invalid_id' })
      let client
      try {
        client = await db.pool.connect(); await client.query('begin')
        // Serialize likes/cancellations and publication changes for this project.
        const p = await client.query('select published from training_projects where id=$1 for update', [id])
        if (!p.rows[0]?.published) { await client.query('rollback'); return reply.code(404).send({ error: 'not_found' }) }
        if (method === 'PUT') await client.query('insert into training_project_likes(project_id,user_id) values($1,$2) on conflict do nothing', [id, u.userId])
        else await client.query('delete from training_project_likes where project_id=$1 and user_id=$2', [id, u.userId])
        const result = await client.query<Project>(SELECT + ' where p.id=$2', [u.userId, id])
        await client.query('commit')
        return { likeCount: result.rows[0].likeCount, likedByMe: result.rows[0].likedByMe }
      } catch (err) { await client?.query('rollback').catch(() => {}); return failed(reply, err) }
      finally { client?.release() }
    },
  })
}
