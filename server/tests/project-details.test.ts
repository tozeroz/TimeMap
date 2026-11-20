import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import pg from 'pg'
import { registerProjectRoutes } from '../src/projectRoutes.ts'
import type { Db } from '../src/db.ts'

const url = process.env.PROJECT_TEST_DATABASE_URL
assert(url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Use a local test database')
const schema = 'project_detail_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema + ',public' })
const app = Fastify()
try {
  await pool.query(`create table users(id uuid primary key,display_name text,avatar_media_id uuid);
    create table media(id uuid primary key,scope text,mime text);
    create table audit_log(id uuid primary key,actor_id uuid,action text,target_type text,target_id uuid,reason text);`)
  for (const migration of ['032_training_projects', '033_training_project_links', '034_class_training_projects', '041_project_details']) await pool.query(readFileSync(new URL(`../src/migrations/${migration}.sql`, import.meta.url), 'utf8'))
  const enrichment = readFileSync(new URL('../src/migrations/042_project_content_enrichment.sql', import.meta.url), 'utf8')
  await pool.query(enrichment)
  const catalog = await pool.query('select * from training_projects order by position')
  assert.equal(catalog.rows.length, 10); assert.ok(catalog.rows.every(p => p.description && p.category && p.features.length > 0 && p.experience_notes))
  assert.equal(catalog.rows.filter(p => p.experience_url).length, 4)
  await pool.query('update training_projects set description=$2 where id=$1', [catalog.rows[0].id, '管理员自定义介绍'])
  await pool.query(enrichment)
  assert.equal((await pool.query('select description from training_projects where id=$1', [catalog.rows[0].id])).rows[0].description, '管理员自定义介绍')
  const [admin, a, b, logo, portrait, landscape, privateImage] = Array.from({ length: 7 }, () => randomUUID())
  await pool.query('insert into users(id,display_name) values($1,$2),($3,$4),($5,$6)', [admin, '管理员', a, '同学甲', b, '同学乙'])
  await pool.query("insert into media values($1,'public','image/png'),($2,'public','image/png'),($3,'public','image/png'),($4,'private','image/png')", [logo, portrait, landscape, privateImage])
  registerProjectRoutes({ app, db: { pool, noteFailure: () => 'terminal' } as unknown as Db,
    resolveSession: async auth => {
      const userId = auth === 'Bearer admin' ? admin : auth === 'Bearer a' ? a : auth === 'Bearer b' ? b : null
      return userId ? { kind: 'ok', user: { userId, sessionId: randomUUID(), handle: 'test', displayName: 'test', phone: null, role: userId === admin ? 'admin' : 'student' } } : { kind: 'none' }
    }, unauthorized: reply => { reply.code(401); return {} }, dbUnavailable: reply => { reply.code(503); return {} } })
  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token = '', payload?: object) => app.inject({ method, url: path, headers: token ? { authorization: 'Bearer ' + token } : {}, ...(payload ? { payload } : {}) })
  const fields = { name: '图片独立维护测试', summary: '列表 Logo 和详情截图分别保存', groupName: null, memberCount: null, projectUrl: 'https://github.com/test/project', experienceUrl: null, coverImageId: logo, position: 1, published: true, description: '项目介绍', category: '校园生活', features: ['功能一', '功能二'], experienceNotes: '体验提示', showcaseImageIds: [portrait, landscape] }
  let r = await send('POST', '/api/admin/projects', 'admin', fields); assert.equal(r.statusCode, 201, r.body)
  const id = r.json().id, path = `/api/projects/${id}`
  let detail = (await send('GET', path)).json()
  assert.equal(detail.coverImageId, logo); assert.deepEqual(detail.showcaseImageIds, [portrait, landscape]); assert.equal(detail.reviewCount, 0)
  r = await send('PUT', `/api/admin/projects/${id}`, 'admin', { ...fields, showcaseImageIds: [landscape, portrait] }); assert.equal(r.statusCode, 200)
  detail = (await send('GET', path)).json(); assert.equal(detail.coverImageId, logo); assert.deepEqual(detail.showcaseImageIds, [landscape, portrait])
  for (const patch of [{ showcaseImageIds: [privateImage] }, { showcaseImageIds: [portrait, portrait] }, { showcaseImageIds: Array.from({ length: 9 }, () => randomUUID()) }, { features: Array(5).fill('功能') }, { description: '字'.repeat(4001) }]) assert.equal((await send('PUT', `/api/admin/projects/${id}`, 'admin', { ...fields, ...patch })).statusCode, 400)
  assert.deepEqual((await send('GET', path)).json().showcaseImageIds, [landscape, portrait])
  const { description, category, features, experienceNotes, showcaseImageIds, ...legacy } = fields
  void description; void category; void features; void experienceNotes; void showcaseImageIds
  assert.equal((await send('PUT', `/api/admin/projects/${id}`, 'admin', legacy)).statusCode, 200)
  detail = (await send('GET', path)).json(); assert.equal(detail.description, '项目介绍'); assert.deepEqual(detail.showcaseImageIds, [landscape, portrait])
  assert.equal((await send('POST', path + '/reviews', '', { body: '评价', clientRequestId: randomUUID() })).statusCode, 401)
  for (const body of ['', ' ', '字'.repeat(501)]) assert.equal((await send('POST', path + '/reviews', 'a', { body, clientRequestId: randomUUID() })).statusCode, 400)
  const clientRequestId = randomUUID(), review = { body: '<script>纯文本评价</script>', clientRequestId }
  const batch = await Promise.all(Array.from({ length: 8 }, () => send('POST', path + '/reviews', 'a', review)))
  assert.ok(batch.every(x => [200, 201].includes(x.statusCode))); assert.equal(new Set(batch.map(x => x.json().id)).size, 1)
  const reviewId = batch[0].json().id
  assert.equal((await send('POST', path + '/reviews', 'a', { ...review, body: '不同正文' })).statusCode, 409)
  let page = (await send('GET', path + '/reviews', 'a')).json(); assert.equal(page.total, 1); assert.equal(page.items[0].canDelete, true)
  assert.equal((await send('GET', path + '/reviews', 'b')).json().items[0].canDelete, false)
  assert.equal((await send('DELETE', path + '/reviews/' + reviewId, 'b')).statusCode, 404)
  for (let i = 0; i < 24; i++) await send('POST', path + '/reviews', 'b', { body: `分页评价${i}`, clientRequestId: randomUUID() })
  page = (await send('GET', path + '/reviews', 'admin')).json(); assert.equal(page.total, 25); assert.equal(page.items.length, 20); assert(page.items.every((x: { canDelete: boolean }) => x.canDelete))
  const next = (await send('GET', path + '/reviews?cursor=' + page.nextCursor)).json(); assert.equal(next.items.length, 5); assert.equal(next.nextCursor, null)
  assert.equal(new Set([...page.items, ...next.items].map(x => x.id)).size, 25)
  assert.equal((await send('GET', path + '/reviews?cursor=invalid')).statusCode, 400)
  assert.equal((await send('DELETE', path + '/reviews/' + reviewId, 'a')).statusCode, 204)
  assert.equal((await send('POST', path + '/reviews', 'a', review)).statusCode, 409)
  assert.equal((await send('GET', path)).json().reviewCount, 24)
  const another = (await send('GET', path + '/reviews')).json().items[0].id
  assert.equal((await send('DELETE', path + '/reviews/' + another, 'admin')).statusCode, 204)
  await send('PUT', `/api/admin/projects/${id}`, 'admin', { ...fields, showcaseImageIds: [], coverImageId: null })
  detail = (await send('GET', path)).json(); assert.equal(detail.coverImageId, null); assert.deepEqual(detail.showcaseImageIds, [])
  await send('PUT', `/api/admin/projects/${id}`, 'admin', { ...fields, published: false })
  for (const suffix of ['', '/reviews']) assert.equal((await send('GET', path + suffix)).statusCode, 404)
  assert.equal((await send('POST', path + '/reviews', 'a', { body: '下架后提交', clientRequestId: randomUUID() })).statusCode, 404)
  console.log('PASS project details: 10 enriched projects, preserve admin edits, independent images/order/atomic validation, legacy clients, review auth/idempotence/pagination/deletion and takedown.')
} finally {
  await app.close(); await pool.end()
  assert(/^project_detail_test_[a-f0-9]+$/.test(schema)); await setup.query(`drop schema ${schema} cascade`); await setup.end()
}
