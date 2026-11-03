import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { PoolClient } from 'pg'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { TimemapCtx, TimemapSessionUser } from './timemap.ts'
import { acquireMediaMutationLock } from './mutationBarrier.ts'

/**
 * 校园活动投稿与审核闭环（ACT-004 / ACT-005，迁移 031）
 *
 * 这一层是"**服务端说了算**"的边界，页面上的状态与按钮只是它的投影：
 *   · 归属：所有 /api/me/* 一律从会话取用户，**不信请求里的 submitterId**；
 *     别人的投稿按 404 处理（不区分"不存在"与"不是你的"），避免枚举。
 *   · 状态机：pending →(通过) approved / (驳回) rejected；rejected →(重提) pending。
 *     版本号只增不减，旧版本与旧审核结论都保留（历史在详情里返回）。
 *   · 并发：审核先 `select … for update` 锁住投稿行，再比对管理员看到的版本；
 *     同一版本第二次审核返回 409 让前端刷新，而不是"最后一次写入覆盖"。
 *   · 原子性：审核通过与"生成公开活动"在**同一个事务**里，不会出现
 *     已通过却没有活动的半成功状态。
 *   · 幂等：创建/重提带 clientRequestId，同 id 同内容重试返回同一结果，
 *     同 id 不同内容返回 409（见 activity_submission_requests）。
 *
 * 封面（执行文档 §7）：投稿封面是 **private** 媒体，审核前只有本人与管理员可读
 * （权限判定在数据库函数 can_read_media 里，见迁移 031）。
 * 审核通过时**复制出一份 public 副本**给公开活动用 —— 私有文件本身不改变归属，
 * 所以"未审核内容不进公开链路"不依赖任何应用层代码记得过滤。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UPLOAD_ROOT = process.env.UPLOAD_ROOT ?? '/srv/campus/uploads'

/** 与前端/接口文档一致的长度上限（按**码点**计数，与 Array.from(str).length 同口径） */
const LIMITS = { title: 60, description: 300, organizer: 60, source: 100, externalLink: 500, activityType: 40, reason: 500 }
const STATUSES = ['pending', 'approved', 'rejected'] as const
type Status = (typeof STATUSES)[number]
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

const len = (text: string) => Array.from(text).length

export interface SubmissionFields {
  title: string
  placeId: string
  startsAt: string
  endsAt: string | null
  description: string
  coverImageId: string | null
  organizer: string
  source: string
  externalLink: string
  activityType: string
}

interface SubmissionRow {
  id: string
  submitter_id: string
  status: Status
  current_revision: number
  published_activity_id: string | null
  published_cover_media_id: string | null
  created_at: Date
  updated_at: Date
  revision: number
  title: string
  place_id: string
  starts_at: Date
  ends_at: Date | null
  description: string | null
  cover_image_id: string | null
  organizer: string | null
  source: string | null
  external_link: string | null
  activity_type: string | null
  submitted_at: Date
  place_name: string | null
  activity_status: string | null
  reject_reason: string | null
  submitter_name?: string | null
  submitter_handle?: string | null
}

const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null)
const blankToNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * 一次查询取回「投稿 + 当前版本 + 地点名 + 关联公开活动状态 + 当前版本驳回原因」。
 * 版本用 current_revision 关联 —— 列表与详情都只看当前版本，历史走 history 子查询。
 */
const SUBMISSION_SELECT = `
  select s.id, s.submitter_id, s.status, s.current_revision, s.published_activity_id,
         s.published_cover_media_id, s.created_at, s.updated_at,
         r.revision, r.title, r.place_id, r.starts_at, r.ends_at, r.description, r.cover_image_id,
         r.organizer, r.source, r.external_link, r.activity_type, r.submitted_at,
         p.name as place_name,
         a.status as activity_status,
         (select v.reason from activity_submission_reviews v
           where v.submission_id = s.id and v.revision = s.current_revision and v.decision = 'rejected'
           order by v.reviewed_at desc limit 1) as reject_reason,
         u.display_name as submitter_name, u.handle as submitter_handle
    from activity_submissions s
    join activity_submission_revisions r
      on r.submission_id = s.id and r.revision = s.current_revision
    left join places p on p.id = r.place_id
    left join activities a on a.id = s.published_activity_id
    join users u on u.id = s.submitter_id
`

/**
 * 公开活动的**可访问性**：执行文档 §4 要求"不永久写死已公开展示"。
 *   · 没有关联活动 → null
 *   · 活动被取消   → 'cancelled'
 *   · 活动行没了   → 'unavailable'
 *   · 其余         → 'public'（活动在列表/详情/地点区都能看到）
 */
function publicationStatus(row: SubmissionRow): 'public' | 'cancelled' | 'unavailable' | null {
  if (!row.published_activity_id) return null
  if (!row.activity_status) return 'unavailable'
  if (row.activity_status === 'cancelled') return 'cancelled'
  return 'public'
}

function toJson(row: SubmissionRow, history?: Array<Record<string, unknown>>, withSubmitter = false) {
  return {
    id: row.id,
    revision: row.revision,
    status: row.status,
    placeId: row.place_id,
    placeName: row.place_name ?? '地点已删除',
    title: row.title,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    description: row.description ?? '',
    coverImageId: row.cover_image_id,
    organizer: row.organizer ?? '',
    source: row.source ?? '',
    externalLink: row.external_link ?? '',
    activityType: row.activity_type ?? '',
    submittedAt: iso(row.submitted_at),
    reviewReason: row.reject_reason,
    publishedActivityId: row.published_activity_id,
    publicationStatus: publicationStatus(row),
    ...(history ? { history } : {}),
    ...(withSubmitter
      ? { submitter: { id: row.submitter_id, displayName: row.submitter_name ?? '', handle: row.submitter_handle ?? '' } }
      : {}),
  }
}

function encodeCursor(row: SubmissionRow): string {
  return Buffer.from(`${new Date(row.created_at).toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

function decodeCursor(raw: string): { at: string; id: string } | null {
  try {
    const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
    if (!at || !id || !UUID_RE.test(id) || !Number.isFinite(Date.parse(at))) return null
    return { at: new Date(at).toISOString(), id }
  } catch {
    return null
  }
}

/**
 * 业务字段校验 —— 错误文案与前端保持一致口径，但**以服务端为准**：
 * 前端能绕过，所以这里每一项都要独立成立。空串一律归一化为 null（不把 '' 写进库）。
 */
export function parseSubmissionFields(payload: Record<string, unknown>): { errors: string[]; fields: SubmissionFields | null } {
  const errors: string[] = []
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  if (!title) errors.push('活动名称不能为空')
  else if (len(title) > LIMITS.title) errors.push(`活动名称不能超过 ${LIMITS.title} 字`)

  const placeId = typeof payload.placeId === 'string' ? payload.placeId.trim() : ''
  if (!UUID_RE.test(placeId)) errors.push('请选择有效的校园地点')

  const startsAtRaw = typeof payload.startsAt === 'string' ? Date.parse(payload.startsAt) : NaN
  if (!Number.isFinite(startsAtRaw)) errors.push('开始时间必须是合法的 ISO 时间')
  let endsAt: string | null = null
  if (payload.endsAt !== undefined && payload.endsAt !== null && payload.endsAt !== '') {
    const endsAtRaw = typeof payload.endsAt === 'string' ? Date.parse(payload.endsAt) : NaN
    if (!Number.isFinite(endsAtRaw)) errors.push('结束时间必须是合法的 ISO 时间')
    else if (Number.isFinite(startsAtRaw) && endsAtRaw <= startsAtRaw) errors.push('结束时间必须晚于开始时间')
    else endsAt = new Date(endsAtRaw).toISOString()
  }

  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  if (len(description) > LIMITS.description) errors.push(`活动简介不能超过 ${LIMITS.description} 字`)
  const organizer = blankToNull(payload.organizer)
  if (organizer && len(organizer) > LIMITS.organizer) errors.push(`主办方不能超过 ${LIMITS.organizer} 字`)
  const source = blankToNull(payload.source)
  if (source && len(source) > LIMITS.source) errors.push(`信息来源不能超过 ${LIMITS.source} 字`)
  const activityType = blankToNull(payload.activityType)
  if (activityType && len(activityType) > LIMITS.activityType) errors.push(`活动类型不能超过 ${LIMITS.activityType} 字`)

  const externalLink = blankToNull(payload.externalLink)
  if (externalLink) {
    if (len(externalLink) > LIMITS.externalLink) errors.push(`链接不能超过 ${LIMITS.externalLink} 字`)
    else {
      let ok = false
      try {
        const url = new URL(externalLink)
        // 带账号密码的链接会被原样渲染出去 —— 直接拒绝，不做"尽力解析"
        ok = (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      } catch {
        ok = false
      }
      if (!ok) errors.push('链接必须是 http(s) 开头、且不含账号密码的合法地址')
    }
  }

  let coverImageId: string | null = null
  if (payload.coverImageId !== undefined && payload.coverImageId !== null && payload.coverImageId !== '') {
    if (typeof payload.coverImageId !== 'string' || !UUID_RE.test(payload.coverImageId)) errors.push('封面图 id 不合法')
    else coverImageId = payload.coverImageId
  }

  if (errors.length) return { errors, fields: null }
  return {
    errors,
    fields: {
      title,
      placeId,
      startsAt: new Date(startsAtRaw).toISOString(),
      endsAt,
      description,
      coverImageId,
      organizer: organizer ?? '',
      source: source ?? '',
      externalLink: externalLink ?? '',
      activityType: activityType ?? '',
    },
  }
}

/** 内容摘要：用于幂等键的"同标识是否同内容"判定。键顺序固定，避免等价对象算出不同摘要。 */
function payloadHash(fields: SubmissionFields): string {
  const ordered = [
    fields.title,
    fields.placeId,
    fields.startsAt,
    fields.endsAt ?? '',
    fields.description,
    fields.coverImageId ?? '',
    fields.organizer,
    fields.source,
    fields.externalLink,
    fields.activityType,
  ]
  return createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex')
}

export function registerSubmissionRoutes(ctx: TimemapCtx): void {
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

  async function history(submissionId: string) {
    const rows = (
      await db.pool.query<{ revision: number; decision: Status; reason: string | null; reviewed_at: Date }>(
        `select revision, decision, reason, reviewed_at from activity_submission_reviews
          where submission_id = $1 order by revision, reviewed_at`,
        [submissionId],
      )
    ).rows
    return rows.map((r) => ({
      revision: r.revision,
      decision: r.decision,
      reason: r.reason ?? '',
      reviewedAt: iso(r.reviewed_at),
    }))
  }

  async function loadOne(id: string, ownerId: string | null) {
    const params: unknown[] = [id]
    let where = 'where s.id = $1'
    if (ownerId) {
      params.push(ownerId)
      where += ' and s.submitter_id = $2'
    }
    const row = (await db.pool.query<SubmissionRow>(`${SUBMISSION_SELECT} ${where}`, params)).rows[0]
    return row ?? null
  }

  /**
   * 地点必须存在且启用（执行文档 §5：不能只提交可编造的地点名）。
   * 投稿时校验一次，**审核通过时再校验一次** —— 中间地点可能被停用。
   */
  async function checkPlace(client: PoolClient, placeId: string) {
    const rows = (await client.query<{ enabled: boolean }>('select enabled from places where id = $1', [placeId])).rows
    if (!rows[0]) return '地点不存在'
    if (!rows[0].enabled) return '该地点已停用，请换一个地点'
    return null
  }

  /**
   * 封面必须是**本人上传的 private 图片**。
   * 只检查"UUID 存在"是不够的（那样可以把别人的私图挂到自己的投稿上）。
   */
  async function checkCover(
    client: PoolClient,
    mediaId: string,
    ownerId: string,
  ) {
    const rows = (
      await client.query(
        `select id, owner_user_id, scope, mime, storage_key, bytes, width, height, sha256
           from media where id = $1`,
        [mediaId],
      )
    ).rows
    const media = rows[0] as
      | { id: string; owner_user_id: string; scope: string; mime: string; storage_key: string; bytes: number; width: number | null; height: number | null; sha256: string }
      | undefined
    if (!media) return { error: '封面图不存在' as string, media: null }
    if (media.owner_user_id !== ownerId) return { error: '只能使用自己上传的封面图' as string, media: null }
    if (media.scope !== 'private') return { error: '封面图必须通过活动投稿上传' as string, media: null }
    return { error: null, media }
  }

  /**
   * 审核通过时把 private 封面复制成 public 副本（执行文档 §7②「生成公开副本」）。
   *
   * 为什么不是直接把 scope 改成 public：`media.storage_key` 配合 scope 决定物理目录
   * （uploads/private/… 与 uploads/public/…），只改 DB 字段会让文件留在私有目录，
   * 匿名请求 404。复制一份 public 记录 + 文件，公开链路走既有的 Nginx 静态下发，
   * 私有原件与其作者归属都不动。
   *
   * 与上传同样的锁：文件与 DB 行必须在同一个事务窗口里，避免备份出现"行有文件无"。
   */
  async function promoteCover(
    client: PoolClient,
    media: { mime: string; storage_key: string; bytes: number; width: number | null; height: number | null; sha256: string },
    ownerId: string,
  ): Promise<{ id: string; path: string }> {
    const id = randomUUID()
    const now = new Date()
    const relDir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const ext = media.mime === 'image/png' ? 'png' : media.mime === 'image/webp' ? 'webp' : 'jpg'
    const storageKey = `${relDir}/${id}.${ext}`
    const finalPath = join(UPLOAD_ROOT, 'public', storageKey)
    const tmpPath = join(UPLOAD_ROOT, '.tmp', `${id}.${ext}`)

    await acquireMediaMutationLock(client)
    await mkdir(join(UPLOAD_ROOT, 'public', relDir), { recursive: true, mode: 0o750 })
    await copyFile(join(UPLOAD_ROOT, 'private', media.storage_key), tmpPath)
    await rename(tmpPath, finalPath)
    await client.query(
      `insert into media (id, owner_user_id, scope, storage_key, mime, bytes, width, height, sha256, upload_request_id, duration_ms)
       values ($1,$2,'public',$3,$4,$5,$6,$7,$8,$9,null)`,
      [id, ownerId, storageKey, media.mime, media.bytes, media.width, media.height, media.sha256, id],
    )
    return { id, path: finalPath }
  }

  async function audit(
    client: PoolClient,
    actorId: string,
    action: string,
    targetId: string,
    reason: string | null,
  ) {
    await client.query(
      'insert into audit_log (id, actor_id, action, target_type, target_id, reason) values ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), actorId, action, 'activity_submission', targetId, reason],
    )
  }

  // =========================================================================
  // 普通用户：创建投稿
  // =========================================================================
  app.post('/api/activity-submissions', async (req, reply) => {
    const g = await currentUser(req)
    if (!g.ok) return fail(reply, g)
    const body = (req.body ?? {}) as Record<string, unknown>
    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId.trim() : ''
    if (!UUID_RE.test(clientRequestId)) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['缺少有效的 clientRequestId'] }
    }
    const { errors, fields } = parseSubmissionFields(body)
    if (!fields) {
      reply.code(400)
      return { error: 'invalid_payload', details: errors }
    }
    const hash = payloadHash(fields)

    // 幂等：同一用户 + 同一 clientRequestId 已经处理过 → 直接返回上次结果
    const replay = replayOrFail(reply, await findRequest(g.user.userId, clientRequestId, hash))
    if (replay !== null) return replay

    const client = await db.pool.connect()
    try {
      await client.query('begin')
      const placeError = await checkPlace(client, fields.placeId)
      if (placeError) {
        await client.query('rollback')
        reply.code(400)
        return { error: 'invalid_payload', details: [placeError] }
      }
      if (fields.coverImageId) {
        const cover = await checkCover(client, fields.coverImageId, g.user.userId)
        if (cover.error) {
          await client.query('rollback')
          reply.code(400)
          return { error: 'invalid_payload', details: [cover.error] }
        }
      }
      const id = randomUUID()
      await client.query(
        `insert into activity_submissions (id, submitter_id, status, current_revision) values ($1,$2,'pending',1)`,
        [id, g.user.userId],
      )
      await client.query(
        `insert into activity_submission_revisions
           (submission_id, revision, title, place_id, starts_at, ends_at, description, cover_image_id,
            organizer, source, external_link, activity_type)
         values ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          fields.title,
          fields.placeId,
          fields.startsAt,
          fields.endsAt,
          fields.description || null,
          fields.coverImageId,
          fields.organizer || null,
          fields.source || null,
          fields.externalLink || null,
          fields.activityType || null,
        ],
      )
      await client.query(
        `insert into activity_submission_requests (actor_id, client_request_id, submission_id, revision, payload_sha256)
         values ($1,$2,$3,1,$4)`,
        [g.user.userId, clientRequestId, id, hash],
      )
      await client.query('commit')
      const row = await loadOne(id, g.user.userId)
      reply.code(201)
      return toJson(row as SubmissionRow, await history(id))
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      // 并发重放：另一个请求抢到了同一个 clientRequestId
      if ((err as { code?: string }).code === '23505') {
        const again = replayOrFail(reply, await findRequest(g.user.userId, clientRequestId, hash))
        if (again !== null) return again
      }
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    } finally {
      client.release()
    }
  })

  /**
   * 幂等重放判定：命中同一 clientRequestId 时
   *   · 摘要相同 → 返回已有投稿（客户端视为成功；重复提交不会产生第二条）
   *   · 摘要不同 → 409（同一个标识不能承载不同内容）
   */
  type Replay = { kind: 'none' } | { kind: 'same'; body: unknown } | { kind: 'conflict' }

  async function findRequest(actorId: string, clientRequestId: string, hash: string): Promise<Replay> {
    const existing = (
      await db.pool.query<{ submission_id: string; payload_sha256: string }>(
        'select submission_id, payload_sha256 from activity_submission_requests where actor_id = $1 and client_request_id = $2',
        [actorId, clientRequestId],
      )
    ).rows[0]
    if (!existing) return { kind: 'none' }
    if (existing.payload_sha256 !== hash) return { kind: 'conflict' }
    const row = await loadOne(existing.submission_id, actorId)
    return row ? { kind: 'same', body: toJson(row, await history(row.id)) } : { kind: 'none' }
  }

  /** 幂等重放的统一应答：冲突 409，重放直接回上次的结果。返回 null 表示需要继续创建。 */
  function replayOrFail(reply: FastifyReply, replay: Replay): unknown | null {
    if (replay.kind === 'conflict') {
      reply.code(409)
      return { error: 'request_id_conflict', reason: '同一请求标识不能提交不同内容，请刷新后重试' }
    }
    if (replay.kind === 'same') return replay.body
    return null
  }

  // =========================================================================
  // 普通用户：本人列表 / 详情 / 重提
  // =========================================================================
  app.get('/api/me/activity-submissions', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const g = await currentUser(req)
    if (!g.ok) return fail(reply, g)
    const query = req.query as { status?: string; cursor?: string; limit?: string }
    const status = (query.status ?? '').trim()
    if (status && !STATUSES.includes(status as Status)) {
      reply.code(400)
      return { error: 'bad_status', got: status, allowed: STATUSES }
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT))
    const params: unknown[] = [g.user.userId]
    const conds: string[] = ['s.submitter_id = $1']
    if (status) {
      params.push(status)
      conds.push(`s.status = $${params.length}`)
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor)
      if (!cursor) {
        reply.code(400)
        return { error: 'bad_cursor' }
      }
      params.push(cursor.at, cursor.id)
      conds.push(`(s.created_at, s.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
    }
    const sql = `${SUBMISSION_SELECT} where ${conds.join(' and ')} order by s.created_at desc, s.id desc limit ${limit + 1}`
    try {
      const rows = (await db.pool.query<SubmissionRow>(sql, params)).rows
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      return { items: page.map((row) => toJson(row)), nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.get('/api/me/activity-submissions/:id', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const g = await currentUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    try {
      // 所有权校验在 SQL 里：别人的投稿与不存在的投稿返回同一个 404
      const row = await loadOne(id, g.user.userId)
      if (!row) {
        reply.code(404)
        return { error: 'not_found' }
      }
      return toJson(row, await history(id))
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.post('/api/me/activity-submissions/:id/resubmit', async (req, reply) => {
    const g = await currentUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    const clientRequestId = typeof body.clientRequestId === 'string' ? body.clientRequestId.trim() : ''
    if (!UUID_RE.test(clientRequestId)) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['缺少有效的 clientRequestId'] }
    }
    const { errors, fields } = parseSubmissionFields(body)
    if (!fields) {
      reply.code(400)
      return { error: 'invalid_payload', details: errors }
    }
    const hash = payloadHash(fields)
    const replay = replayOrFail(reply, await findRequest(g.user.userId, clientRequestId, hash))
    if (replay !== null) return replay

    const client = await db.pool.connect()
    try {
      await client.query('begin')
      // 锁住投稿行：与管理员审核互斥，避免"审核通过的同时又重提"
      const current = (
        await client.query<{ status: Status; current_revision: number; submitter_id: string }>(
          'select status, current_revision, submitter_id from activity_submissions where id = $1 for update',
          [id],
        )
      ).rows[0]
      if (!current || current.submitter_id !== g.user.userId) {
        await client.query('rollback')
        reply.code(404)
        return { error: 'not_found' }
      }
      if (current.status !== 'rejected') {
        await client.query('rollback')
        reply.code(409)
        return { error: 'not_rejected', status: current.status, reason: '只有未通过的投稿可以修改重提' }
      }
      const expected = body.expectedRevision
      if (expected !== undefined && expected !== null && Number(expected) !== current.current_revision) {
        await client.query('rollback')
        reply.code(409)
        return { error: 'revision_conflict', currentRevision: current.current_revision, reason: '投稿已被修改，请刷新后重试' }
      }
      const placeError = await checkPlace(client, fields.placeId)
      if (placeError) {
        await client.query('rollback')
        reply.code(400)
        return { error: 'invalid_payload', details: [placeError] }
      }
      if (fields.coverImageId) {
        const cover = await checkCover(client, fields.coverImageId, g.user.userId)
        if (cover.error) {
          await client.query('rollback')
          reply.code(400)
          return { error: 'invalid_payload', details: [cover.error] }
        }
      }
      const next = current.current_revision + 1
      await client.query(
        `insert into activity_submission_revisions
           (submission_id, revision, title, place_id, starts_at, ends_at, description, cover_image_id,
            organizer, source, external_link, activity_type)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          next,
          fields.title,
          fields.placeId,
          fields.startsAt,
          fields.endsAt,
          fields.description || null,
          fields.coverImageId,
          fields.organizer || null,
          fields.source || null,
          fields.externalLink || null,
          fields.activityType || null,
        ],
      )
      await client.query(
        `update activity_submissions set current_revision = $2, status = 'pending', updated_at = now() where id = $1`,
        [id, next],
      )
      await client.query(
        `insert into activity_submission_requests (actor_id, client_request_id, submission_id, revision, payload_sha256)
         values ($1,$2,$3,$4,$5)`,
        [g.user.userId, clientRequestId, id, next, hash],
      )
      await client.query('commit')
      const row = await loadOne(id, g.user.userId)
      return toJson(row as SubmissionRow, await history(id))
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      if ((err as { code?: string }).code === '23505') {
        const again = replayOrFail(reply, await findRequest(g.user.userId, clientRequestId, hash))
        if (again !== null) return again
      }
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    } finally {
      client.release()
    }
  })

  // =========================================================================
  // 管理员：审核队列 / 详情 / 通过或驳回
  // =========================================================================
  app.get('/api/admin/activity-submissions', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const g = await adminUser(req)
    if (!g.ok) return fail(reply, g)
    const query = req.query as { status?: string; cursor?: string; limit?: string }
    const status = (query.status ?? '').trim()
    if (status && !STATUSES.includes(status as Status)) {
      reply.code(400)
      return { error: 'bad_status', got: status, allowed: STATUSES }
    }
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT))
    const params: unknown[] = []
    const conds: string[] = []
    if (status) {
      params.push(status)
      conds.push(`s.status = $${params.length}`)
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor)
      if (!cursor) {
        reply.code(400)
        return { error: 'bad_cursor' }
      }
      params.push(cursor.at, cursor.id)
      conds.push(`(s.created_at, s.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
    }
    const where = conds.length ? `where ${conds.join(' and ')}` : ''
    try {
      const rows = (
        await db.pool.query<SubmissionRow>(
          `${SUBMISSION_SELECT} ${where} order by s.created_at desc, s.id desc limit ${limit + 1}`,
          params,
        )
      ).rows
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      return {
        items: page.map((row) => toJson(row, undefined, true)),
        nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
      }
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.get('/api/admin/activity-submissions/:id', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const g = await adminUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    try {
      const row = await loadOne(id, null)
      if (!row) {
        reply.code(404)
        return { error: 'not_found' }
      }
      return toJson(row, await history(id), true)
    } catch (err) {
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.post('/api/admin/activity-submissions/:id/review', async (req, reply) => {
    const g = await adminUser(req)
    if (!g.ok) return fail(reply, g)
    const id = (req.params as { id?: string }).id ?? ''
    if (!UUID_RE.test(id)) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    const decision = body.decision
    if (decision !== 'approved' && decision !== 'rejected') {
      reply.code(400)
      return { error: 'invalid_payload', details: ['decision 必须是 approved 或 rejected'] }
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (decision === 'rejected' && !reason) {
      reply.code(400)
      return { error: 'invalid_payload', details: ['驳回必须填写原因'] }
    }
    if (len(reason) > LIMITS.reason) {
      reply.code(400)
      return { error: 'invalid_payload', details: [`原因不能超过 ${LIMITS.reason} 字`] }
    }
    const expectedRevision = body.expectedRevision

    const client = await db.pool.connect()
    /** 已成功复制的 public 副本路径 —— 事务回滚时要把它删掉，避免留孤儿文件 */
    let promotedPath: string | null = null
    let mediaInserted = false
    try {
      await client.query('begin')
      const row = (
        await client.query<SubmissionRow>(`${SUBMISSION_SELECT} where s.id = $1 for update of s`, [id])
      ).rows[0]
      if (!row) {
        await client.query('rollback')
        reply.code(404)
        return { error: 'not_found' }
      }
      /*
        冲突语义（执行文档 §4）：管理员审核必须指定自己看到的版本。
        已经被别人处理过、或版本已经变了 → 409 + 当前状态，让前端刷新，
        而不是把后来的决定盖上去。
      */
      if (row.status !== 'pending') {
        await client.query('rollback')
        reply.code(409)
        return { error: 'already_reviewed', status: row.status, currentRevision: row.revision, reason: '该投稿已被处理' }
      }
      if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== row.revision) {
        await client.query('rollback')
        reply.code(409)
        return {
          error: 'revision_conflict',
          currentRevision: row.revision,
          status: row.status,
          reason: '投稿版本已变化，请刷新后重新审核',
        }
      }

      let publishedActivityId: string | null = null
      let publishedCoverMediaId: string | null = null

      if (decision === 'approved') {
        // 通过前再校验一次地点：投稿后地点可能被停用
        const placeError = await checkPlace(client, row.place_id)
        if (placeError) {
          await client.query('rollback')
          reply.code(409)
          return { error: 'place_unavailable', reason: `${placeError}，无法通过审核` }
        }
        if (row.cover_image_id) {
          const cover = await checkCover(client, row.cover_image_id, row.submitter_id)
          if (cover.error || !cover.media) {
            await client.query('rollback')
            reply.code(409)
            return { error: 'cover_unavailable', reason: `${cover.error ?? '封面图不可用'}，无法通过审核` }
          }
          const promoted = await promoteCover(client, cover.media, row.submitter_id)
          publishedCoverMediaId = promoted.id
          promotedPath = promoted.path
          mediaInserted = true
        }
        publishedActivityId = randomUUID()
        /*
          created_by 记的是**投稿人**，不是审核的管理员 ——
          审核人单独记在 activity_submission_reviews.reviewer_id
          （执行文档 §4：不把审核管理员错误显示为活动投稿人）。
        */
        await client.query(
          `insert into activities (id, title, description, place_id, starts_at, ends_at, source, status, created_by,
                                   activity_type, organizer, external_link, cover_image_id)
           values ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8,$9,$10,$11,$12)`,
          [
            publishedActivityId,
            row.title,
            row.description,
            row.place_id,
            row.starts_at,
            row.ends_at,
            row.source ?? '学生投稿',
            row.submitter_id,
            row.activity_type,
            row.organizer,
            row.external_link,
            publishedCoverMediaId,
          ],
        )
      }

      await client.query(
        'insert into activity_submission_reviews (id, submission_id, revision, reviewer_id, decision, reason) values ($1,$2,$3,$4,$5,$6)',
        [randomUUID(), id, row.revision, g.user.userId, decision, reason || null],
      )
      await client.query(
        `update activity_submissions
            set status = $2, published_activity_id = $3, published_cover_media_id = $4, updated_at = now()
          where id = $1`,
        [id, decision === 'approved' ? 'approved' : 'rejected', publishedActivityId, publishedCoverMediaId],
      )
      await audit(client, g.user.userId, decision === 'approved' ? 'activity_submission_approve' : 'activity_submission_reject', id, reason || null)
      await client.query('commit')
      const updated = await loadOne(id, null)
      return toJson(updated as SubmissionRow, await history(id), true)
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      // 事务确定回滚了：把已经复制出去的 public 文件删掉（DB 行随回滚消失）
      if (promotedPath && mediaInserted) await unlink(promotedPath).catch(() => undefined)
      if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    } finally {
      client.release()
    }
  })
}
