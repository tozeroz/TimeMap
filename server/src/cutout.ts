import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Db } from './db.ts'
import { probeImage } from './imageProbe.ts'

export function registerCutoutRoutes(app: FastifyInstance, db: Db, root: string,
  authenticate: (req: FastifyRequest) => Promise<string | null>) {
  let token: { value: string; expires: number } | null = null
  app.post('/api/media/cutout', async (req, reply) => {
    const owner = await authenticate(req)
    if (!owner) return reply.code(401).send({ message: '请先登录再生成贴纸' })
    const { mediaId, requestId } = (req.body ?? {}) as { mediaId?: string; requestId?: string }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(mediaId ?? '') || !uuid.test(requestId ?? '')) return reply.code(400).send({ message: '图片或请求标识无效' })
    const prior = await db.pool.query('select * from cutout_jobs where request_id=$1', [requestId])
    if (prior.rows[0]) {
      const job = prior.rows[0]
      if (job.owner_id !== owner || job.media_id !== mediaId) return reply.code(403).send({ message: '处理请求归属不一致' })
      if (job.status === 'done') return { dataUrl: `data:image/png;base64,${job.result_base64}` }
      if (job.status === 'processing' && Date.now() - new Date(job.created_at).getTime() < 120000) return reply.code(409).send({ message: '该图片仍在处理，请稍后重试查询结果' })
      if (job.status === 'processing') await db.pool.query("update cutout_jobs set status='failed' where request_id=$1 and status='processing'", [requestId])
      return reply.code(422).send({ message: '上次处理失败，可重新生成或使用原图' })
    }
    const key = process.env.BAIDU_CUTOUT_API_KEY
    const secret = process.env.BAIDU_CUTOUT_SECRET_KEY
    const maxCalls = Number(process.env.CUTOUT_MAX_CALLS ?? 0)
    if (!key || !secret || !Number.isSafeInteger(maxCalls) || maxCalls <= 0) {
      return reply.code(503).send({ message: '贴纸服务尚未开通，请先使用原图发布' })
    }
    const media = await db.pool.query('select storage_key, width, height from media where id=$1 and owner_user_id=$2 and scope=\'public\' and mime like \'image/%\'', [mediaId, owner])
    const image = media.rows[0]
    if (!image) return reply.code(403).send({ message: '无法处理该图片' })
    if (Math.min(image.width, image.height) < 128 || Math.max(image.width, image.height) > 3000) {
      return reply.code(400).send({ message: '生成贴纸需要图片短边至少128像素、长边不超过3000像素' })
    }
    const input = (await readFile(join(root, 'public', image.storage_key))).toString('base64')
    if (input.length > 10 * 1024 * 1024) return reply.code(413).send({ message: '图片过大，请更换图片' })
    const client = await db.pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock(719202610)')
      // A racing retry must never consume another paid call.
      const duplicate = await client.query('select 1 from cutout_jobs where request_id=$1', [requestId])
      if (duplicate.rows.length) {
        await client.query('rollback')
        return reply.code(409).send({ message: '该图片仍在处理，请稍后重试查询结果' })
      }
      const total = await client.query('select count(*)::int as n from cutout_jobs')
      const recent = await client.query("select count(*)::int as n from cutout_jobs where owner_id=$1 and created_at > now()-interval '1 minute'", [owner])
      if (total.rows[0].n >= maxCalls || recent.rows[0].n >= 3) {
        await client.query('rollback')
        return reply.code(429).send({ message: '已达到贴纸处理额度或调用频率限制，请使用原图或稍后再试' })
      }
      await client.query("insert into cutout_jobs(request_id, owner_id, media_id, status) values($1,$2,$3,'processing')", [requestId, owner, mediaId])
      await client.query('commit')
    } catch (e) { await client.query('rollback'); throw e }
    finally { client.release() }
    try {
      if (!token || token.expires < Date.now()) {
        const res = await fetch('https://aip.baidubce.com/oauth/2.0/token', {
          method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: key, client_secret: secret }),
          signal: AbortSignal.timeout(10000),
        })
        const auth = await res.json() as { access_token?: string; expires_in?: number }
        if (!res.ok || !auth.access_token) throw new Error('auth')
        token = { value: auth.access_token, expires: Date.now() + ((auth.expires_in ?? 3600) - 60) * 1000 }
      }
      const res = await fetch(`https://aip.baidubce.com/rest/2.0/image-process/v1/segment?access_token=${encodeURIComponent(token.value)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: input, method: 'auto', return_form: 'rgba', refine_mask: 'true' }),
        signal: AbortSignal.timeout(45000),
      })
      const output = await res.json() as { image?: string; error_code?: number; log_id?: string }
      if (!res.ok || output.error_code || !output.image || output.image.length > 14 * 1024 * 1024) throw new Error('provider')
      const bytes = Buffer.from(output.image, 'base64')
      const probe = probeImage(bytes)
      if (!probe.ok || probe.mime !== 'image/png') throw new Error('invalid_png')
      await db.pool.query("update cutout_jobs set status='done', result_base64=$2 where request_id=$1", [requestId, output.image])
      console.info('[cutout] completed', { requestId, logId: output.log_id })
      return { dataUrl: `data:image/png;base64,${output.image}` }
    } catch {
      await db.pool.query("update cutout_jobs set status='failed' where request_id=$1", [requestId])
      return reply.code(502).send({ message: '贴纸服务处理失败，请重试或使用原图' })
    }
  })
}
