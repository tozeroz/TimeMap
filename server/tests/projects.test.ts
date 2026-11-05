/** Isolated local PostgreSQL integration: no production data or real users. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import pg from 'pg'
import { parseProject, registerProjectRoutes, sortProjects, type Project } from '../src/projectRoutes.ts'
import type { Db } from '../src/db.ts'

const url = process.env.PROJECT_TEST_DATABASE_URL
assert(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Set PROJECT_TEST_DATABASE_URL to local PostgreSQL')
const schema = 'project_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema + ',public' })
const app = Fastify()
try {
  await pool.query(`create table users(id uuid primary key); create table media(id uuid primary key, scope text, mime text);
    create table audit_log(id uuid primary key, actor_id uuid, action text, target_type text, target_id uuid, reason text);`)
  const migration = readFileSync(new URL('../src/migrations/032_training_projects.sql', import.meta.url), 'utf8')
  await pool.query(migration); await pool.query(migration)
  const [admin, a, b, cover, privateCover, audio] = Array.from({ length: 6 }, () => randomUUID())
  await pool.query('insert into users values($1),($2),($3)', [admin, a, b])
  await pool.query("insert into media values($1,'public','image/png'),($2,'private','image/png'),($3,'public','audio/webm')", [cover, privateCover, audio])
  registerProjectRoutes({ app, db: { pool, noteFailure: () => 'terminal' } as unknown as Db,
    resolveSession: async auth => {
      const id = auth === 'Bearer admin' ? admin : auth === 'Bearer a' ? a : auth === 'Bearer b' ? b : null
      return id ? { kind: 'ok', user: { sessionId: randomUUID(), userId: id, handle: 'test', displayName: 'test', phone: null, role: id === admin ? 'admin' : 'student' } } : { kind: 'none' }
    }, unauthorized: reply => { reply.code(401); return { error: 'unauthorized' } }, dbUnavailable: reply => { reply.code(503); return { error: 'unavailable' } } })
  const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, token = '', payload?: object) => app.inject({ method, url: path, headers: token ? { authorization: 'Bearer ' + token } : {}, ...(payload ? { payload } : {}) })
  const fields = { name: '交园搭子', summary: '找到一起运动、自习的伙伴', groupName: '第六小组', memberCount: 5, experienceUrl: 'https://example.com/project', coverImageId: cover, position: 0, published: true }
  const create = async (patch = {}) => {
    const r = await request('POST', '/api/admin/projects', 'admin', { ...fields, ...patch }); assert.equal(r.statusCode, 201, r.body); return r.json().id as string
  }
  assert.equal((await request('GET', '/api/projects')).json().items.length, 0)
  assert.equal((await request('POST', '/api/admin/projects', '', fields)).statusCode, 401)
  assert.equal((await request('POST', '/api/admin/projects', 'a', fields)).statusCode, 403)
  assert.equal((await request('GET', '/api/admin/projects', 'a')).statusCode, 403)
  for (const patch of [{ experienceUrl: 'javascript:alert(1)' }, { memberCount: 0 }, { memberCount: 2.5 }, { name: ' ' }, { coverImageId: null }, { coverImageId: privateCover }, { coverImageId: audio }, { position: -1 }, { likeCount: 99 }, { experienceUrl: 'https://user:password@example.com' }]) {
    assert.equal((await request('POST', '/api/admin/projects', 'admin', { ...fields, ...patch })).statusCode, 400)
  }
  assert.ok(!parseProject(null).fields)
  const one = await create(), two = await create({ name: '校园失物招领', position: 1 }), draft = await create({ name: '草稿项目', published: false })
  assert.equal((await request('GET', '/api/projects')).json().items.length, 2)
  assert.equal((await request('GET', '/api/admin/projects', 'admin')).json().items.length, 3)
  assert.equal((await request('PUT', `/api/projects/${one}/like`)).statusCode, 401)
  assert.equal((await request('PUT', `/api/projects/${draft}/like`, 'a')).statusCode, 404)
  assert.equal((await request('PUT', '/api/projects/nope/like', 'a')).statusCode, 400)
  const likes = await Promise.all(Array.from({ length: 12 }, () => request('PUT', `/api/projects/${one}/like`, 'a')))
  assert.ok(likes.every(r => r.statusCode === 200 && r.json().likeCount === 1 && r.json().likedByMe))
  assert.equal((await request('PUT', `/api/projects/${one}/like`, 'b')).json().likeCount, 2)
  assert.equal((await request('PUT', `/api/projects/${two}/like`, 'a')).json().likeCount, 1)
  let list = (await request('GET', '/api/projects?view=popular', 'a')).json().items
  assert.equal(list[0].id, one); assert.ok(list.every((p: Project) => p.likedByMe))
  assert.ok((await request('GET', '/api/projects')).json().items.every((p: Project) => !p.likedByMe))
  const cancelled = await Promise.all(Array.from({ length: 8 }, () => request('DELETE', `/api/projects/${one}/like`, 'a')))
  assert.ok(cancelled.every(r => r.statusCode === 200 && r.json().likeCount === 1 && !r.json().likedByMe))
  await assert.rejects(pool.query('insert into training_project_likes(project_id,user_id) values($1,$2)', [one, b]), /duplicate key/)
  // Same counts: Chinese name first, identical names: stable ID last.
  const twin = await create()
  await request('PUT', `/api/projects/${twin}/like`, 'a')
  list = (await request('GET', '/api/projects?view=popular')).json().items
  assert.deepEqual(list.map((p: Project) => p.id), [one, twin].sort().concat(two))
  assert.deepEqual(sortProjects([...list].reverse(), true).map(p => p.id), list.map((p: Project) => p.id))
  assert.equal((await request('PUT', `/api/admin/projects/${one}`, 'admin', { ...fields, name: '修改后的项目', published: false })).statusCode, 200)
  assert.ok(!(await request('GET', '/api/projects')).json().items.some((p: Project) => p.id === one))
  assert.equal((await request('DELETE', `/api/projects/${one}/like`, 'b')).statusCode, 404)
  await request('PUT', `/api/admin/projects/${one}`, 'admin', fields)
  assert.equal((await request('GET', '/api/projects', 'b')).json().items.find((p: Project) => p.id === one).likeCount, 1)
  assert.equal((await pool.query('select count(*)::int as n from audit_log')).rows[0].n, 6)
  console.log('PASS project PostgreSQL: migration, admin/auth, validation, publication, public/user state, concurrent idempotent likes/cancellation, multiple projects, stable ranking, audit and re-publication.')
} finally {
  await app.close(); await pool.end()
  assert(/^project_test_[a-f0-9]+$/.test(schema)); await setup.query(`drop schema ${schema} cascade`); await setup.end()
}
