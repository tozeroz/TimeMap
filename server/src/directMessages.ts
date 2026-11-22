import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { FastifyRequest } from 'fastify'
import type { TimemapCtx } from './timemap.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function limit(name: string, fallback: number) {
  const value=Number(process.env[name]);return Number.isInteger(value)&&value>0?Math.min(value,5000):fallback
}
export class MessagingError extends Error {
  constructor(public status: number, public error: string) { super(error) }
}
export async function pairLock(client: PoolClient, a: string, b: string) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['dm:' + [a.toLowerCase(), b.toLowerCase()].sort().join(':')])
}
async function blocked(client: PoolClient, a: string, b: string) {
  return Boolean((await client.query(`select 1 from user_blocks where
    (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1)`, [a, b])).rowCount)
}
export function messageFingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

/** Shared by old and new clients, before all message mutations. Lock order: sender, request, pair, thread. */
export async function prepareMessage(client: PoolClient, threadId: string, sender: string, requestId: string | null, fingerprint: string) {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['dm-sender:' + sender])
  if (requestId) {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['dm-request:' + sender + ':' + requestId])
    const previous = (await client.query(`select id,thread_id,request_fingerprint,thread_seq::text,created_at from messages where sender_id=$1 and client_request_id=$2`, [sender, requestId])).rows[0]
    if (previous) {
      if (previous.thread_id !== threadId || previous.request_fingerprint !== fingerprint) throw new MessagingError(409, 'message_request_conflict')
      return previous as { id: string; thread_seq: string; created_at: Date }
    }
  }
  const pair = (await client.query('select user_low,user_high from direct_thread_pairs where thread_id=$1', [threadId])).rows[0]
  if (pair) {
    await pairLock(client, pair.user_low, pair.user_high)
    if (await blocked(client, pair.user_low, pair.user_high)) throw new MessagingError(403, 'messaging_unavailable')
  }
  const thread = (await client.query('select kind from message_threads where id=$1 for update', [threadId])).rows[0]
  if (thread?.kind === 'direct') {
    if (!pair) throw new MessagingError(409, 'direct_thread_needs_audit')
    const counts = (await client.query(`select count(*)::int as total,
      count(*) filter(where m.thread_id=$2)::int as local from messages m join message_threads t on t.id=m.thread_id
      where m.sender_id=$1 and t.kind='direct' and m.created_at>now()-interval '1 minute'`, [sender, threadId])).rows[0]
    if (counts.total >= limit('DM_SEND_PER_MINUTE',30) || counts.local >= limit('DM_THREAD_SEND_PER_MINUTE',20)) throw new MessagingError(429, 'message_rate_limited')
  }
  return null
}

export function registerDirectMessageRoutes(ctx: TimemapCtx) {
  const { app, db, resolveSession, dbUnavailable } = ctx
  async function user(req: FastifyRequest) {
    const session = await resolveSession(req.headers.authorization)
    if (session.kind === 'db_down') throw new MessagingError(503, 'not_ready')
    if (session.kind === 'none') throw new MessagingError(401, 'unauthorized')
    return session.user
  }
  function failure(reply: Parameters<TimemapCtx['dbUnavailable']>[0], error: unknown) {
    if (error instanceof MessagingError) {
      if (error.status === 429) reply.header('Retry-After', '60')
      reply.code(error.status); return { error: error.error }
    }
    if (db.noteFailure(error) === 'transient') return dbUnavailable(reply, error)
    app.log.error({ err: error }, 'direct messaging failed')
    reply.code(500); return { error: 'db_error' }
  }
  app.post('/api/threads/:id/messages/:messageId/revoke', async (req, reply) => {
    try {
      const me = await user(req)
      const { id, messageId } = req.params as { id: string; messageId: string }
      if (!UUID.test(id) || !UUID.test(messageId)) throw new MessagingError(400, 'invalid_message')
      // Preserve the row, sequence and media references. Existing media authorization
      // excludes deleted messages, and retries must retain their original identity.
      const result = await db.pool.query(`update messages m set deleted_at=coalesce(m.deleted_at,now())
        where m.id=$1 and m.thread_id=$2 and m.sender_id=$3
        and exists(select 1 from thread_members where thread_id=m.thread_id and user_id=$3)
        returning m.id,m.thread_seq::text,m.deleted_at`, [messageId, id, me.userId])
      if (!result.rowCount) throw new MessagingError(404, 'not_found')
      reply.header('Cache-Control', 'no-store')
      return { id: result.rows[0].id, threadSeq: result.rows[0].thread_seq, revoked: true }
    } catch (error) { return failure(reply, error) }
  })
  // Reconcile already displayed history: an afterSeq query alone cannot see
  // a revocation because revoking never allocates a new message sequence.
  app.post('/api/threads/:id/messages/revocations', async (req, reply) => {
    try {
      const me = await user(req), id = (req.params as { id: string }).id
      const input = (req.body ?? {}) as Record<string, unknown>
      const ids = input.messageIds
      if (!UUID.test(id) || !Array.isArray(ids) || ids.length > 200 ||
          ids.some(value => typeof value !== 'string' || !UUID.test(value)) ||
          Object.keys(input).some(key => key !== 'messageIds')) throw new MessagingError(400, 'invalid_messages')
      if (!(await db.pool.query('select 1 from thread_members where thread_id=$1 and user_id=$2', [id, me.userId])).rowCount) {
        throw new MessagingError(404, 'not_found')
      }
      const result = await db.pool.query('select id from messages where thread_id=$1 and id=any($2::uuid[]) and deleted_at is not null', [id, ids])
      reply.header('Cache-Control', 'no-store')
      return { revokedIds: result.rows.map(row => row.id) }
    } catch (error) { return failure(reply, error) }
  })
  app.post('/api/threads/direct', async (req, reply) => {
    let client: PoolClient | undefined
    try {
      const me = await user(req)
      const input = (req.body ?? {}) as Record<string, unknown>
      const peerId = typeof input.peerId === 'string' ? input.peerId.toLowerCase() : ''
      if (!UUID.test(peerId) || peerId === me.userId || Object.keys(input).some(k => k !== 'peerId')) throw new MessagingError(400, 'invalid_peer')
      client = await db.pool.connect(); await client.query('begin')
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', ['dm-sender:' + me.userId])
      await pairLock(client, me.userId, peerId)
      const peer = (await client.query('select id,display_name,avatar_media_id from users where id=$1', [peerId])).rows[0]
      if (!peer) throw new MessagingError(404, 'not_found')
      if (await blocked(client, me.userId, peerId)) throw new MessagingError(403, 'messaging_unavailable')
      const [low, high] = [me.userId, peerId].sort()
      let id = (await client.query('select thread_id from direct_thread_pairs where user_low=$1 and user_high=$2', [low, high])).rows[0]?.thread_id as string | undefined
      const created = !id
      if (!id) {
        const count = (await client.query("select count(*)::int as n from direct_thread_pairs where created_by=$1 and created_at>now()-interval '1 minute'", [me.userId])).rows[0].n
        if (count >= limit('DM_CREATE_PER_MINUTE',10)) throw new MessagingError(429, 'thread_rate_limited')
        id = randomUUID()
        await client.query("insert into message_threads(id,kind) values($1,'direct')", [id])
        await client.query('insert into thread_members(id,thread_id,user_id) values($1,$2,$3),($4,$2,$5)', [randomUUID(), id, me.userId, randomUUID(), peerId])
        await client.query('insert into direct_thread_pairs(thread_id,user_low,user_high,created_by) values($1,$2,$3,$4)', [id, low, high, me.userId])
      }
      await client.query('commit'); reply.code(created ? 201 : 200)
      return { id, kind: 'direct', peer: { id: peer.id, displayName: peer.display_name, avatarMediaId: peer.avatar_media_id } }
    } catch (error) { await client?.query('rollback').catch(() => {}); return failure(reply, error) }
    finally { client?.release() }
  })
  for (const method of ['POST', 'DELETE'] as const) app.route({ method, url: '/api/users/:id/block', handler: async (req, reply) => {
    let client: PoolClient | undefined
    try {
      const me = await user(req), id = (req.params as { id: string }).id.toLowerCase()
      if (!UUID.test(id) || id === me.userId) throw new MessagingError(400, 'invalid_peer')
      client = await db.pool.connect(); await client.query('begin'); await pairLock(client, me.userId, id)
      if (!(await client.query('select 1 from users where id=$1', [id])).rowCount) throw new MessagingError(404, 'not_found')
      if (method === 'POST') await client.query('insert into user_blocks(blocker_id,blocked_id) values($1,$2) on conflict do nothing', [me.userId, id])
      else await client.query('delete from user_blocks where blocker_id=$1 and blocked_id=$2', [me.userId, id])
      await client.query('commit'); return { blocked: method === 'POST' }
    } catch (error) { await client?.query('rollback').catch(() => {}); return failure(reply, error) }
    finally { client?.release() }
  } })
  app.post('/api/threads/:id/read', async (req, reply) => {
    try {
      const me = await user(req), id = (req.params as { id: string }).id
      const input = (req.body ?? {}) as Record<string, unknown>
      const seq = input.throughSeq
      if (!UUID.test(id) || typeof seq !== 'string' || !/^\d{1,18}$/.test(seq) || Object.keys(input).some(k => k !== 'throughSeq')) throw new MessagingError(400, 'invalid_read_position')
      const row = (await db.pool.query(`update thread_members me set last_read_seq=greatest(me.last_read_seq,$3::bigint)
        from message_threads t where me.thread_id=t.id and t.id=$1 and me.user_id=$2 and $3::bigint<=t.next_message_seq
        and ($3::bigint=0 or exists(select 1 from messages m where m.thread_id=t.id and m.thread_seq=$3::bigint))
        returning me.last_read_seq::text`, [id, me.userId, seq])).rows[0]
      if (!row) {
        const member = await db.pool.query('select 1 from thread_members where thread_id=$1 and user_id=$2', [id, me.userId])
        throw new MessagingError(member.rowCount ? 400 : 404, member.rowCount ? 'invalid_read_position' : 'not_found')
      }
      const unread=(await db.pool.query(`select count(*)::int as n from messages m join thread_members me on me.thread_id=m.thread_id and me.user_id=$2
        left join inbox_reads ir on ir.user_id=$2 and ir.scope='thread:'||m.thread_id
        where m.thread_id=$1 and m.thread_seq>me.last_read_seq and m.sender_id<>$2 and m.deleted_at is null
        and m.created_at>greatest(me.joined_at,coalesce(ir.read_at,'epoch'::timestamptz))`,[id,me.userId])).rows[0].n
      return { lastReadSeq: row.last_read_seq, unreadCount: unread }
    } catch (error) { return failure(reply, error) }
  })
}
