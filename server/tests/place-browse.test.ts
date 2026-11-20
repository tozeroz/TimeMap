/** Isolated schema only. Set PROFILE_TEST_DATABASE_URL to a local PostgreSQL. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { buildServer, type ServerDeps } from '../src/index.ts'

const url = process.env.PROFILE_TEST_DATABASE_URL
assert(url, 'Set PROFILE_TEST_DATABASE_URL')
assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname))
const schema = 'anonymous_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema })
const app = buildServer({ db: { pool, status: () => ({ ready: true }), noteFailure: () => 'none' },
  corsOrigins: [], smsSender: { configured: false }, devSink: {}, sessionTtlDays: 30,
} as unknown as ServerDeps)
try {
  await pool.query(`create table posts(id uuid primary key, place_id uuid, status text, created_at timestamptz)`)
  const place = randomUUID(), elsewhere = randomUUID()
  const ids = Array.from({length: 5}, () => randomUUID())
  for (let i=0; i<ids.length; i++) await pool.query('insert into posts values($1,$2,$3,$4)',
    [ids[i], i < 3 ? place : elsewhere, i===4 ? 'removed' : 'published', new Date(2026,0,i+1)])
  const r = await app.inject({ method:'GET', url:`/api/posts/${ids[1]}/browse` })
  assert.equal(r.statusCode,200,r.body)
  assert.deepEqual(r.json().ids,[ids[1],ids[2],ids[0],ids[3]])
  assert.equal((await app.inject({method:'GET',url:`/api/posts/${ids[4]}/browse`})).statusCode,404)
  assert.equal((await app.inject({method:'GET',url:'/api/posts/invalid/browse'})).statusCode,400)
  console.log('PASS place-first browse: clicked post first, every same-place post before newer other-place post, removed content excluded')
} finally {
  await app.close(); await pool.end(); await setup.query(`drop schema ${schema} cascade`); await setup.end()
}
