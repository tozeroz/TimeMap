/** Local PostgreSQL integration: isolated schema, real route/SQL, no production writes. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import pg from 'pg'
import { registerTimemapRoutes } from '../src/timemap.ts'
import type { Db } from '../src/db.ts'

const url = process.env.ACTIVITY_TEST_DATABASE_URL
assert(url, 'Set ACTIVITY_TEST_DATABASE_URL to a local test database')
assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Only local PostgreSQL is allowed')
const schema = 'activity_calendar_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema + ',public' })
const app = Fastify()
try {
  await pool.query(`
    create table places(id uuid primary key, name text, latitude float8, longitude float8, enabled boolean);
    create table activities(id uuid primary key, title text, description text, starts_at timestamptz,
      ends_at timestamptz, source text, status text, activity_type text, organizer text,
      external_link text, cover_image_id uuid, place_id uuid references places(id));
    create table activity_favorites(activity_id uuid, user_id uuid);
  `)
  const placeId = randomUUID(), otherPlace = randomUUID()
  await pool.query('insert into places values($1,$2,39.95,116.34,true),($3,$4,39.94,116.33,true)', [placeId, '明湖', otherPlace, '图书馆'])
  const now = new Date((await pool.query('select now() as instant')).rows[0].instant).getTime()
  const DAY = 86_400_000, HOUR = 3_600_000, offset = 8 * HOUR
  const local = new Date(now + offset)
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset
  const week = day - (local.getUTCDay() + 6) % 7 * DAY
  const cases: Array<{ id: string; start: number; end: number | null; status: string; place: string }> = []
  async function add(title: string, start: number, end: number | null, status = 'scheduled', place = placeId) {
    const id = randomUUID()
    cases.push({ id, start, end, status, place })
    await pool.query('insert into activities(id,title,starts_at,ends_at,status,source,place_id) values($1,$2,$3,$4,$5,$6,$7)',
      [id, title, new Date(start), end === null ? null : new Date(end), status, '本地测试', place])
    return id
  }
  await add('午夜结束，不计今天', day - 2 * HOUR, day)
  await add('跨午夜', day - HOUR, day + HOUR)
  await add('今天的活动', day + 2 * HOUR, day + 4 * HOUR)
  await add('明天零点开始', day + DAY, day + DAY + HOUR)
  await add('历史活动', day - 40 * DAY, day - 39 * DAY)
  await add('未填结束时间，默认两小时', day - HOUR, null)
  await add('长活动跨日', day - 3 * DAY, day + 2 * DAY)
  await add('已取消', day + HOUR, day + 2 * HOUR, 'cancelled')
  await add('另一个地点', day + 3 * HOUR, day + 4 * HOUR, 'scheduled', otherPlace)
  await add('周一零点结束', week - HOUR, week)
  await add('跨周', week - HOUR, week + HOUR)
  await add('下周一零点开始', week + 7 * DAY, week + 7 * DAY + HOUR)
  registerTimemapRoutes({ app, db: { pool, noteFailure: () => 'permanent' } as unknown as Db,
    resolveSession: async () => ({ kind: 'none' as const }),
    unauthorized: reply => { reply.code(401); return { error: 'unauthorized' } },
    dbUnavailable: reply => { reply.code(503); return { error: 'db_unavailable' } },
  })
  const read = (query: string) => app.inject({ method: 'GET', url: '/api/activities' + query })
  const expected = (start: number, end: number) => cases.filter(a => a.start < end && (a.end ?? a.start + 2 * HOUR) > start)
  for (const [window, start, end] of [['today', day, day + DAY], ['week', week, week + 7 * DAY]] as const) {
    const response = await read(`?status=all&window=${window}`)
    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.deepEqual(body.items.map((a: { id: string }) => a.id).sort(), expected(start, end).map(a => a.id).sort(), window)
    assert.equal(body.total, expected(start, end).length)
  }
  const cancelled = await read('?status=cancelled&window=today')
  assert.equal(cancelled.json().items.length, 1)
  assert.equal(cancelled.json().items[0].effectiveStatus, 'cancelled')
  const filtered = await read(`?status=all&window=today&placeId=${otherPlace}`)
  assert.equal(filtered.json().items.length, 1)
  assert.equal((await read('?window=tomorrow')).statusCode, 400)
  assert.equal((await read('?status=invalid')).statusCode, 400)
  assert.equal((await read('?placeId=invalid')).statusCode, 400)
  for (let i = 0; i < 205; i++) await add(`超出列表上限 ${i}`, day + HOUR, day + 2 * HOUR)
  const limited = await read('?status=all')
  assert.equal(limited.statusCode, 200, limited.body)
  assert.equal(limited.json().items.length, 200)
  assert.equal(limited.json().total, cases.length)
  await pool.query('delete from activities')
  assert.deepEqual((await read('?status=all&window=today')).json(), { items: [], total: 0 })
  console.log('Activity calendar integration passed: day/week boundaries, overlaps, default end, status/place, validation, total/limit and empty results.')
} finally {
  await app.close()
  await pool.end()
  assert(/^activity_calendar_test_[a-f0-9]+$/.test(schema))
  await setup.query(`drop schema ${schema} cascade`)
  await setup.end()
}
