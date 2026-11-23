import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { TimemapCtx } from './timemap.ts'

export const INBOX_EVENTS_SQL = `
with events as (
  select 'like:'||l.id as id, 'likes' as category, u.display_name as actor,
    u.avatar_media_id as avatar, p.id as post_id, null::uuid as thread_id,
    '赞了你的帖子' as action, left(p.body, 160) as preview, l.created_at
  from likes l join posts p on p.id=l.post_id join users u on u.id=l.user_id
  where p.author_id=$1 and l.user_id<>$1 and p.status='published'
  union all
  -- 048：评论点赞。与「赞了你的帖子」同属 likes 分类（一个入口、一个未读计数），
  -- 靠 action 文案区分。post_id 用来点击后跳到那条帖子，thread_id 恒空。
  -- 只认 published：评论软删（status='removed'）后不再通知，帖子下架同理。
  select 'comment-like:'||cl.id, 'likes', u.display_name, u.avatar_media_id, p.id, null::uuid,
    '赞了你的评论', left(c.body,160), cl.created_at
  from comment_likes cl
  join comments c on c.id=cl.comment_id
  join posts p on p.id=c.post_id
  join users u on u.id=cl.user_id
  where c.author_id=$1 and cl.user_id<>$1 and c.status='published' and p.status='published'
  union all
  select 'favorite:'||f.id, 'favorites', u.display_name, u.avatar_media_id, p.id, null::uuid,
    '收藏了你的帖子', left(p.body,160), f.created_at
  from favorites f join posts p on p.id=f.post_id join users u on u.id=f.user_id
  where p.author_id=$1 and f.user_id<>$1 and p.status='published'
  union all
  select 'comment:'||c.id, 'comments',
    case when c.is_anonymous then '匿名同学' else coalesce(u.display_name,'同学') end,
    case when c.is_anonymous then null::uuid else u.avatar_media_id end, p.id, null::uuid,
    case when parent.author_id=$1 then '回复了你的评论' else '评论了你的帖子' end,
    left(c.body,160), c.created_at
  from comments c join posts p on p.id=c.post_id
  left join comments parent on parent.id=c.parent_id and parent.status='published'
  left join users u on u.id=c.author_id
  where (p.author_id=$1 or parent.author_id=$1) and c.author_id is distinct from $1
    and c.status='published' and p.status='published'
  union all
  select 'mention:'||m.id, 'comments', coalesce(u.display_name,'同学'), u.avatar_media_id,
    null::uuid, m.thread_id, '在会话中提到了你', left(m.body,160), m.created_at
  from messages m join thread_members me on me.thread_id=m.thread_id and me.user_id=$1
  left join users u on u.id=m.sender_id
  where m.sender_id is distinct from $1 and m.deleted_at is null
    and (exists(select 1 from message_mentions mm where mm.message_id=m.id and mm.mentioned_user_id=$1)
      or (m.mentions_all and m.created_at>=me.joined_at))
), visible as (
  select e.*, e.created_at>coalesce(r.read_at,'epoch'::timestamptz) as unread
  from events e left join inbox_reads r on r.user_id=$1 and r.scope=e.category
  where e.created_at <= $2::timestamptz
)
select *, count(*) filter(where unread) over(partition by category)::int as unread_count
from visible order by created_at desc, id desc
`

export function registerInboxRoutes(ctx: TimemapCtx) {
  const { app, db, resolveSession, dbUnavailable } = ctx
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  async function guard(req: FastifyRequest, admin = false) {
    const s = await resolveSession(req.headers.authorization)
    if (s.kind === 'db_down') return { code: 503, error: 'not_ready' } as const
    if (s.kind === 'none') return { code: 401, error: 'unauthorized' } as const
    if (admin && s.user.role !== 'admin') return { code: 403, error: 'forbidden' } as const
    return { user: s.user } as const
  }
  function error(reply: Parameters<TimemapCtx['dbUnavailable']>[0], err: unknown) {
    if (db.noteFailure(err) === 'transient') return dbUnavailable(reply, err)
    reply.code(500)
    return { error: 'db_error' }
  }
  app.get('/api/inbox', async (req, reply) => {
    reply.header('cache-control', 'private, no-store')
    const g = await guard(req)
    if (!g.user) return reply.code(g.code).send({ error: g.error })
    try {
      const clock = await db.pool.query<{ now: Date }>('select clock_timestamp() as now')
      const through = clock.rows[0]!.now.toISOString()
      const args = [g.user.userId, through]
      // Limit per category after counting so an active category cannot hide another's unread count.
      const events = await db.pool.query(`select * from (select e.*,
        (select kind from message_threads where id=e.thread_id) as thread_kind,
        row_number() over(partition by category order by created_at desc,id desc) as position
        from (${INBOX_EVENTS_SQL}) e) ranked where position<=100 order by created_at desc,id desc`, args)
      const announcements = await db.pool.query(`select a.*, a.created_at>coalesce(r.read_at,'epoch'::timestamptz) as unread
        from app_announcements a left join inbox_reads r on r.user_id=$1 and r.scope='announcements'
        where a.created_at<=$2::timestamptz order by a.created_at desc,a.id desc`, args)
      const threads = await db.pool.query(`select t.id, peer.avatar_media_id,
        (select count(*)::int from messages m where m.thread_id=t.id and m.sender_id is distinct from $1
          and m.deleted_at is null and m.created_at<= $2::timestamptz
          and m.thread_seq>me.last_read_seq and m.created_at>greatest(me.joined_at,coalesce(r.read_at,'epoch'::timestamptz))) as unread_count
        from message_threads t join thread_members me on me.thread_id=t.id and me.user_id=$1
        left join inbox_reads r on r.user_id=$1 and r.scope='thread:'||t.id
        left join lateral (select u.avatar_media_id from thread_members tm join users u on u.id=tm.user_id
          where tm.thread_id=t.id and tm.user_id<>$1 order by u.display_name,u.id limit 1) peer on true
        where t.kind='direct'`, args)
      const counts = { likes: 0, favorites: 0, comments: 0 }
      for (const e of events.rows) counts[e.category as keyof typeof counts] = Number(e.unread_count)
      return { through, counts, items: events.rows.map(e => ({ id: e.id, category: e.category, actor: e.actor,
        avatarMediaId: e.avatar, postId: e.post_id, threadId: e.thread_id, threadKind: e.thread_kind, action: e.action,
        preview: e.preview, createdAt: e.created_at.toISOString(), unread: e.unread })),
        announcements: announcements.rows.map(a => ({ id: a.id, title: a.title, body: a.body,
          createdAt: a.created_at.toISOString(), unread: a.unread })),
        threads: threads.rows.map(t => ({ id: t.id, avatarMediaId: t.avatar_media_id, unreadCount: t.unread_count })) }
    } catch (err) { return error(reply, err) }
  })
  app.post('/api/inbox/read', async (req, reply) => {
    const g = await guard(req)
    if (!g.user) return reply.code(g.code).send({ error: g.error })
    const { scope, through } = (req.body || {}) as { scope?: string; through?: string }
    if (typeof scope !== 'string' || !['all','likes','favorites','comments','announcements'].includes(scope) && !/^thread:[0-9a-f-]{36}$/i.test(scope)
      || typeof through !== 'string' || !Number.isFinite(Date.parse(through)) || Date.parse(through) > Date.now())
      return reply.code(400).send({ error: 'invalid_payload' })
    try {
      let scopes = [scope]
      if (scope === 'all') {
        const ts = await db.pool.query('select thread_id from thread_members where user_id=$1', [g.user.userId])
        scopes = ['likes','favorites','comments','announcements', ...ts.rows.map(t => `thread:${t.thread_id}`)]
      } else if (scope.startsWith('thread:')) {
        if (!uuid.test(scope.slice(7))) return reply.code(400).send({ error: 'invalid_payload' })
        const member = await db.pool.query('select 1 from thread_members where thread_id=$1 and user_id=$2', [scope.slice(7), g.user.userId])
        if (!member.rowCount) return reply.code(404).send({ error: 'not_found' })
      }
      await db.pool.query(`insert into inbox_reads(user_id,scope,read_at)
        select $1,unnest($2::text[]),$3::timestamptz on conflict(user_id,scope)
        do update set read_at=greatest(inbox_reads.read_at,excluded.read_at)`, [g.user.userId, scopes, through])
      return { ok: true }
    } catch (err) { return error(reply, err) }
  })
  app.post('/api/admin/announcements', async (req, reply) => {
    const g = await guard(req, true)
    if (!g.user) return reply.code(g.code).send({ error: g.error })
    const input = (req.body || {}) as { title?: unknown; body?: unknown }
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (!title || Array.from(title).length>80 || !body || Array.from(body).length>5000)
      return reply.code(400).send({ error: 'invalid_payload' })
    try {
      const id = randomUUID()
      await db.pool.query('insert into app_announcements(id,title,body,author_id) values($1,$2,$3,$4)', [id,title,body,g.user.userId])
      return reply.code(201).send({ id })
    } catch (err) { return error(reply, err) }
  })
}
