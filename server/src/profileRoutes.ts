import type { Pool, PoolClient } from 'pg'
import type { TimemapCtx } from './timemap.ts'
import { acquireMediaMutationLock, isBarrierTimeout } from './mutationBarrier.ts'

export const DEFAULT_PROFILE_SCHOOL_ID = 'b0000000-0000-4000-8000-000000000001'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const allowed = ['displayName', 'bio', 'avatarMediaId', 'campusId', 'collegeId', 'enrollmentYear']
type ProfileRow = { id: string; display_name: string; bio: string; avatar_media_id: string | null; school_campus_id: string | null; college_id: string | null; enrollment_year: number | null }

export async function readProfile(connection: Pool | PoolClient, userId: string, schoolId: string) {
  const user = (await connection.query<ProfileRow>(`select id, display_name, bio, avatar_media_id,
    school_campus_id, college_id, enrollment_year from users where id = $1`, [userId])).rows[0]
  if (!user) return null
  const school = (await connection.query<{ id: string; name: string }>('select id, name from schools where id = $1', [schoolId])).rows[0]
  if (!school) throw new Error('profile_school_not_configured')
  const campuses = (await connection.query<{ id: string; name: string }>('select id, name from campuses where school_id = $1 order by name, id', [schoolId])).rows
  const colleges = (await connection.query<{ id: string; name: string }>('select id, name from colleges where school_id = $1 order by sort_order, name, id', [schoolId])).rows
  return { id: user.id, displayName: user.display_name, bio: user.bio, avatarMediaId: user.avatar_media_id,
    campusId: user.school_campus_id, collegeId: user.college_id, enrollmentYear: user.enrollment_year,
    school, options: { campuses, colleges }, collegeListComplete: false }
}

/** Private profile routes. No campus, college or admission year is added to public users/:id. */
export function registerProfileRoutes(ctx: TimemapCtx, schoolId = process.env.PROFILE_SERVICE_SCHOOL_ID || DEFAULT_PROFILE_SCHOOL_ID) {
  if (!UUID.test(schoolId)) throw new Error('Invalid PROFILE_SERVICE_SCHOOL_ID')
  const { app, db, resolveSession, unauthorized, dbUnavailable } = ctx
  app.get('/api/users/me/profile', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const session = await resolveSession(req.headers.authorization)
    if (session.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (session.kind === 'none') return unauthorized(reply)
    try {
      const profile = await readProfile(db.pool, session.user.userId, schoolId)
      return profile ?? reply.code(404).send({ error: 'not_found' })
    } catch (error) {
      if (db.noteFailure(error) === 'transient') return dbUnavailable(reply, error)
      req.log.error({ err: error }, 'profile read failed')
      return reply.code(503).send({ error: 'profile_unavailable' })
    }
  })
  app.patch('/api/users/me', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const session = await resolveSession(req.headers.authorization)
    if (session.kind === 'db_down') return dbUnavailable(reply, new Error('session lookup failed'))
    if (session.kind === 'none') return unauthorized(reply)
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'invalid_payload' })
    const input = body as Record<string, unknown>
    const keys = Object.keys(input)
    const errors: string[] = []
    if (!keys.length || keys.some(key => !allowed.includes(key))) errors.push('仅支持昵称、简介、头像、校区、学院与入学年份；学校不可修改')
    if ('displayName' in input && (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.trim().length > 40)) errors.push('昵称不能为空且最多 40 个字符')
    if ('bio' in input && (typeof input.bio !== 'string' || Array.from(input.bio.trim()).length > 160)) errors.push('个人简介最多 160 个字')
    for (const key of ['avatarMediaId', 'campusId', 'collegeId']) if (key in input && input[key] !== null && (typeof input[key] !== 'string' || !UUID.test(input[key] as string))) errors.push(`${key} 必须为 UUID 或 null`)
    if ('enrollmentYear' in input && input.enrollmentYear !== null && (!Number.isInteger(input.enrollmentYear) || Number(input.enrollmentYear) < 1900 || Number(input.enrollmentYear) > 2100)) errors.push('年级须为 1900–2100 的入学年份或 null')
    if (errors.length) return reply.code(400).send({ error: 'invalid_payload', details: errors })
    let client: PoolClient
    try { client = await db.pool.connect() }
    catch (error) { db.noteFailure(error); return dbUnavailable(reply, error) }
    try {
      await client.query('begin')
      await acquireMediaMutationLock(client)
      const existing = (await client.query<ProfileRow>(`select id, display_name, bio, avatar_media_id,
        school_campus_id, college_id, enrollment_year from users where id = $1 for update`, [session.user.userId])).rows[0]
      if (!existing) { await client.query('rollback'); return reply.code(404).send({ error: 'not_found' }) }
      const extended = keys.some(key => key !== 'displayName')
      const next = {
        displayName: 'displayName' in input ? (input.displayName as string).trim() : existing.display_name,
        bio: 'bio' in input ? (input.bio as string).trim() : existing.bio,
        avatar: 'avatarMediaId' in input ? input.avatarMediaId as string | null : existing.avatar_media_id,
        campus: 'campusId' in input ? input.campusId as string | null : existing.school_campus_id,
        college: 'collegeId' in input ? input.collegeId as string | null : existing.college_id,
        year: 'enrollmentYear' in input ? input.enrollmentYear as number | null : existing.enrollment_year,
      }
      for (const [value, table] of [[next.campus, 'campuses'], [next.college, 'colleges']] as const) {
        if (extended && value && !(await client.query(`select id from ${table} where id = $1 and school_id = $2 for share`, [value, schoolId])).rowCount) errors.push(`${table === 'campuses' ? '校区' : '学院'}不属于当前服务学校`)
      }
      if ('avatarMediaId' in input && next.avatar && !(await client.query(`select id from media where id = $1 and owner_user_id = $2
        and scope = 'public' and mime in ('image/jpeg','image/png','image/webp') for share`, [next.avatar, session.user.userId])).rowCount) errors.push('请选择本人上传的有效公开头像图片')
      if (errors.length) { await client.query('rollback'); return reply.code(400).send({ error: 'invalid_payload', details: errors }) }
      if (!extended) {
        const saved = (await client.query<{ id: string; display_name: string }>('update users set display_name = $2, updated_at = now() where id = $1 returning id, display_name', [session.user.userId, next.displayName])).rows[0]!
        await client.query('commit')
        return { id: saved.id, displayName: saved.display_name }
      }
      await client.query(`update users set display_name = $2, bio = $3, avatar_media_id = $4,
        school_campus_id = $5, college_id = $6, enrollment_year = $7, profile_school_id = $8, updated_at = now() where id = $1`,
      [session.user.userId, next.displayName, next.bio, next.avatar, next.campus, next.college, next.year, schoolId])
      const profile = await readProfile(client, session.user.userId, schoolId)
      await client.query('commit')
      return profile
    } catch (error) {
      await client.query('rollback')
      if (isBarrierTimeout(error)) return reply.code(503).header('retry-after', '5').send({ error: 'backup_in_progress' })
      if (db.noteFailure(error) === 'transient') return dbUnavailable(reply, error)
      req.log.error({ err: error }, 'profile save failed')
      return reply.code(500).send({ error: 'profile_save_failed' })
    } finally { client.release() }
  })
}
