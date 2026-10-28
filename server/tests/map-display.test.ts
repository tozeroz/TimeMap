/** Run against an isolated local PostgreSQL: MAP_TEST_DATABASE_URL=... node --experimental-strip-types tests/map-display.test.ts */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import Fastify from 'fastify'
import { registerMapRoutes } from '../src/mapRoutes.ts'
import { layoutMarkers, type LayoutCandidate } from '../../app/src/native/markerLayout.ts'
import type { Db } from '../src/db.ts'

const url = process.env.MAP_TEST_DATABASE_URL
assert(url, 'Set MAP_TEST_DATABASE_URL to an isolated local test database')
assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Tests require a local PostgreSQL')
const schema = 'map_ui_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema + ',public' })
const app = Fastify({ logger: true })
try {
  await pool.query(`
    create table places(id uuid primary key, name text, address text, latitude numeric, longitude numeric,
      category text default '地标', enabled boolean default true, sort_order int default 0, description text);
    create table posts(id uuid primary key, author_name text default '测试同学', author_id uuid, body text,
      place text, place_id uuid references places, created_at timestamptz, image_mode text default 'photo', status text default 'published');
    create table likes(post_id uuid, user_id uuid);
    create table comments(post_id uuid, status text);
    create table media(id uuid primary key, width int, height int, scope text, mime text);
    create table post_media(post_id uuid, media_id uuid, purpose text, position int);
  `)
  await pool.query(await readFile(new URL('../src/migrations/026_map_display.sql', import.meta.url), 'utf8'))
  const school = randomUUID(), area = randomUUID(), library = randomUUID(), disabled = randomUUID()
  for (const [id, name, lat, lng, level, parent, enabled] of [
    [school, '北京交通大学', 39.9503, 116.3396, 'school', null, true],
    [area, '教学区', 39.9515, 116.3416, 'area', school, true],
    [library, '图书馆', 39.9495, 116.3376, 'place', area, true],
    [disabled, '停用地点', 39.95, 116.34, 'place', school, false],
  ]) await pool.query('insert into places(id,name,latitude,longitude,display_level,parent_place_id,enabled) values($1,$2,$3,$4,$5,$6,$7)', [id,name,lat,lng,level,parent,enabled])
  const recent = randomUUID(), second = randomUUID(), old = randomUUID(), removed = randomUUID(), hidden = randomUUID()
  for (const [id, place, days, status, body] of [
    [recent, library, 1, 'published', '图书馆窗边的校园日常'],
    [second, library, 2, 'published', '今天也要好好学习'],
    [old, library, 90, 'published', '一张旧照片'],
    [removed, library, 0, 'removed', '已删除'],
    [hidden, disabled, 0, 'published', '停用地点的帖子'],
  ]) await pool.query("insert into posts(id,place_id,created_at,status,body) values($1,$2,now()-$3::int*interval '1 day',$4,$5)", [id,place,days,status,body])
  await pool.query('insert into likes(post_id) select $1 from generate_series(1,20)', [old])
  await pool.query('insert into likes(post_id) select $1 from generate_series(1,3)', [recent])
  registerMapRoutes(app, { pool, noteFailure: () => 'terminal' } as unknown as Db)
  app.get('/api/schools', async () => ({ items: [{ id: school, name: '北京交通大学' }] }))
  app.addHook('onRequest', async (_req, reply) => { reply.header('access-control-allow-origin', '*') })
  const get = async (url: string) => {
    const r = await app.inject(url)
    assert.equal(r.statusCode, 200, r.body)
    return r.json()
  }
  const places = await get('/api/map/places')
  assert.equal(places.items.length, 3)
  for (const place of places.items) {
    assert.equal(place.postCount, 3, 'count includes enabled descendants only')
    assert.deepEqual(place.previews.map((p: { id: string }) => p.id), [recent, second, old])
  }
  assert.equal((await app.inject('/api/map/posts?placeId=invalid')).statusCode, 400)
  assert.equal((await app.inject('/api/map/posts?placeId=' + disabled)).statusCode, 404)
  assert.equal((await app.inject('/api/map/places?category=invalid')).statusCode, 400)
  const first = await get('/api/map/posts?placeId=' + school + '&limit=1')
  assert.equal(first.items[0].id, recent)
  await pool.query('insert into likes(post_id) select $1 from generate_series(1,50)', [second])
  const page = await get('/api/map/posts?placeId=' + school + '&limit=1&offset=1&snapshot=' + first.snapshot)
  assert.equal(page.items[0].id, second, 'like changes do not reorder an existing pagination snapshot')
  const fresh = await get('/api/map/posts?placeId=' + school)
  assert.equal(fresh.items[0].id, second, 'new snapshots use current popularity')
  await pool.query("update posts set status='removed' where id=$1", [recent])
  const reread = await get('/api/map/posts?placeId=' + school + '&snapshot=' + first.snapshot)
  assert(!reread.items.some((p: { id: string }) => p.id === recent), 'snapshots do not leak removed posts')
  assert.equal(reread.total, 2)
  await assert.rejects(pool.query('update places set parent_place_id=$1 where id=$2', [library, school]), (e: unknown) => (e as { code: string }).code === '23514')
  await assert.rejects(pool.query('update places set min_display_zoom=99 where id=$1', [library]))

  const candidate = (id: string, level: 'school' | 'place', x: number, min?: number): LayoutCandidate => ({
    marker: { id, placeId: id, place: id, postId: '', lat: 0, lng: 0, x: 0, y: 0, color: '', userId: '', displayLevel: level,
      minDisplayZoom: min, previews: [{ id: 'shared', excerpt: 'text' }, { id: id + '-other', excerpt: 'text' }] },
    base: { left: x, top: 200, right: x + 100, bottom: 290 }, stack: { left: x, top: 60, right: x + 100, bottom: 180 }, x, y: 200,
  })
  const view = { left: 0, top: 0, right: 800, bottom: 600 }
  const fallback = layoutMarkers([candidate('building', 'place', 20)], 15, view, '', new Set())
  assert(fallback.visible.has('building'), 'missing area falls back to concrete places')
  assert.equal(layoutMarkers([candidate('building', 'place', 20, 17)], 15, view, '', new Set()).visible.size, 0)
  const result = layoutMarkers([candidate('parent', 'school', 20), candidate('child', 'place', 250)], 18, view, '', new Set())
  assert.equal(result.previews.get('child')?.[0].id, 'shared')
  assert(!result.previews.get('parent')?.some(p => p.id === 'shared'))
  const collision = layoutMarkers([candidate('a', 'place', 20), candidate('b', 'place', 20)], 18, view, 'b', new Set(['a']))
  assert.deepEqual([...collision.visible], ['b'])
  // The inventory migration must link exactly the confirmed nine, leaving others alone.
  const inventoryIds = Array.from({ length: 9 }, (_, i) => `aaaaaaaa-1111-4111-8111-${String(i + 1).padStart(12, '0')}`)
  for (const id of inventoryIds) await pool.query('insert into places(id,name,latitude,longitude) values($1,$2,39.95,116.34)', [id, id])
  const inventoryPost = randomUUID()
  await pool.query("insert into posts(id,place_id,created_at,body) values($1,$2,now(),'学校汇总测试')", [inventoryPost, inventoryIds[0]])
  const previewApp = Fastify()
  registerMapRoutes(previewApp, { pool, noteFailure: () => 'terminal' } as unknown as Db, { previewHierarchy: true })
  try {
    const preview = await previewApp.inject('/api/map/places')
    assert.equal(preview.statusCode, 200, preview.body)
    const previewSchool = preview.json().items.find((p: { id: string }) => p.id.endsWith('000000000011'))
    assert.equal(previewSchool.postCount, 1)
    assert.equal(previewSchool.displayLevel, 'school')
    const previewPosts = await previewApp.inject('/api/map/posts?placeId=' + previewSchool.id)
    assert.equal(previewPosts.statusCode, 200, previewPosts.body)
    assert.equal(previewPosts.json().items[0].id, inventoryPost)
    assert.equal((await pool.query('select id from places where id=$1', [previewSchool.id])).rowCount, 0, 'preview must not insert school')
    assert.equal((await pool.query('select parent_place_id from places where id=$1', [inventoryIds[0]])).rows[0].parent_place_id, null, 'preview must not update parent')
  } finally { await previewApp.close() }
  await pool.query(await readFile(new URL('../src/migrations/027_bjtu_parent_place.sql', import.meta.url), 'utf8'))
  const bjtuId = 'aaaaaaaa-1111-4111-8111-000000000011'
  const linked = await pool.query('select id from places where parent_place_id=$1', [bjtuId])
  assert.deepEqual(linked.rows.map(p => p.id).sort(), inventoryIds.sort())
  const bjtu = (await get('/api/map/places')).items.find((p: { id: string }) => p.id === bjtuId)
  assert.equal(bjtu.displayLevel, 'school')
  assert.equal(bjtu.minDisplayZoom, 4)
  assert.equal(bjtu.postCount, 1)
  assert.equal(bjtu.previews[0].id, inventoryPost)
  assert.equal((await get('/api/map/posts?placeId=' + bjtuId)).items[0].id, inventoryPost)
  assert.equal((await pool.query('select parent_place_id from places where id=$1', [library])).rows[0].parent_place_id, area)
  console.log('PASS: BJTU inventory migration, exact nine parents, school count, previews and expanded posts')
  console.log('PASS: real PostgreSQL hierarchy, counts, hot sorting, stable pagination, deletion visibility, cycle rejection and layout fallback/collisions/deduplication')

  if (process.env.MAP_TEST_SERVE === '1') {
    // Browser fixture server uses the same real map routes and isolated test schema.
    await pool.query("update posts set status='published' where id=$1", [recent])
    const photo = randomUUID(), sticker = randomUUID()
    await pool.query("insert into media(id,width,height,scope,mime) values($1,300,300,'public','image/png'),($2,300,300,'public','image/png')", [photo, sticker])
    await pool.query("insert into post_media(post_id,media_id,purpose,position) values($1,$2,'map',0),($3,$4,'map',0)", [recent, photo, old, sticker])
    await pool.query("update posts set image_mode='sticker' where id=$1", [old])
    for (let i = 0; i < 23; i++) await pool.query("insert into posts(id,place_id,created_at,body) values($1,$2,now()-interval '3 days',$3)", [randomUUID(), library, '校园日常分享 ' + i])
    await app.listen({ host: '127.0.0.1', port: 3009 })
    console.log(JSON.stringify({ browserPlaceId: library, schoolId: school }))
    await new Promise<void>(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
  }
} finally {
  await app.close(); await pool.end()
  assert(/^map_ui_test_[0-9a-f]{32}$/.test(schema))
  await setup.query(`drop schema ${schema} cascade`)
  await setup.end()
}
