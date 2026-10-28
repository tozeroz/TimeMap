/** Local read-only remote-data preview. Does not import createDb or run migrations. */
import { execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { resolve } from 'node:path'
import Fastify, { type RouteHandlerMethod } from 'fastify'
import pg from 'pg'
import type { Db } from './db.ts'
import { registerMapRoutes } from './mapRoutes.ts'

const key = process.env.REMOTE_PREVIEW_KEY
if (!key) throw new Error('REMOTE_PREVIEW_KEY must point to a locally secured SSH key')
const sshTarget = 'root@8.148.156.146'
// Read only the database URL into memory. Never persist or log remote credentials.
const line = execFileSync('ssh', ['-i', resolve(key), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', sshTarget,
  "sed -n '/^DATABASE_URL=/p' /srv/campus/server.env"], { encoding: 'utf8', timeout: 20000 }).trim()
if (!line.startsWith('DATABASE_URL=')) throw new Error('Remote database configuration unavailable')
const database = new URL(line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, ''))
database.hostname = '127.0.0.1'
database.port = '15543'
const pool = new pg.Pool({ connectionString: database.toString(), max: 3, connectionTimeoutMillis: 8000,
  options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c idle_in_transaction_session_timeout=10000' })
const mode = await pool.query<{ default_transaction_read_only: string }>('show default_transaction_read_only')
if (mode.rows[0]?.default_transaction_read_only !== 'on') throw new Error('Read-only mode required')
const app = Fastify({ logger: false })
const origins = new Set(['http://127.0.0.1:5180', 'http://localhost:5180'])
app.addHook('onRequest', async (req, reply) => {
  if (req.headers.origin && origins.has(req.headers.origin)) reply.header('access-control-allow-origin', req.headers.origin).header('vary', 'Origin')
  reply.header('access-control-allow-methods', 'GET,HEAD,OPTIONS')
  reply.header('access-control-allow-headers', 'authorization,content-type')
  reply.header('cache-control', 'no-store')
  if (req.method === 'OPTIONS') return reply.code(204).send()
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(405).send({ error: 'read_only_preview', message: '远程数据只读预览暂不支持修改' })
})
registerMapRoutes(app, { pool, noteFailure: () => 'transient' } as unknown as Db, { previewHierarchy: true })
app.get('/api/ready', async () => {
  const r = await pool.query('select version from schema_migrations order by version desc limit 1')
  return { status: 'ready', source: 'remote', readOnly: true, migration: r.rows[0]?.version }
})
// Media and existing public read APIs go through nginx inside the SSH tunnel,
// preserving authenticated media checks and X-Accel-Redirect handling.
const proxyRead: RouteHandlerMethod = async (req, reply) => {
  // The preview-only school has no upstream detail row until migration 027 is applied.
  if (req.url.split('?')[0] === '/api/places/aaaaaaaa-1111-4111-8111-000000000011') {
    const existing = await pool.query("select id from places where id='aaaaaaaa-1111-4111-8111-000000000011'")
    if (!existing.rows.length) {
      const placesResponse = await app.inject('/api/map/places')
      const postsResponse = await app.inject('/api/map/posts?placeId=aaaaaaaa-1111-4111-8111-000000000011&limit=50')
      if (placesResponse.statusCode !== 200 || postsResponse.statusCode !== 200) return reply.code(503).send({ error: 'remote_read_unavailable' })
      const school = placesResponse.json().items.find((p: { id: string }) => p.id === 'aaaaaaaa-1111-4111-8111-000000000011')
      const posts = postsResponse.json()
      return { ...school, description: '只读预览：北京交通大学及已确认的九个下属地点。点击地图帖子入口可分页浏览全部内容。',
        history: null, photos: [], activities: [], posts: posts.items, postCount: posts.total }
    }
  }
  if (req.url.startsWith('/api/') && !/^\/api\/(schools|posts|places|media|users|me|health)(\/|\?|$)/.test(req.url)) {
    return reply.code(403).send({ error: 'preview_route_unavailable' })
  }
  return new Promise<void>(done => {
    const upstream = request({ hostname: '127.0.0.1', port: 18080, path: req.url, method: req.method,
      headers: { host: '8.148.156.146', ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        ...(req.headers.range ? { range: req.headers.range } : {}) }, timeout: 15000 }, response => {
      reply.code(response.statusCode ?? 502)
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined && !['connection', 'transfer-encoding', 'keep-alive', 'content-length'].includes(name) && !name.startsWith('access-control-')) reply.header(name, value)
      }
      reply.send(response)
      done()
    })
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')))
    upstream.on('error', () => { if (!reply.sent) reply.code(502).send({ error: 'remote_read_unavailable' }); done() })
    upstream.end()
  })
}
app.get('/api/*', proxyRead)
// Public media endpoints redirect to this path; keep relative redirects inside the tunnel.
app.get('/media/*', proxyRead)
const stop = async () => { await app.close(); await pool.end(); process.exit(0) }
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
await app.listen({ host: '127.0.0.1', port: 3003 })
console.log('Remote read-only preview API: http://127.0.0.1:3003 (database writes and migrations disabled)')
