/**
 * 管理端内容维护（047）：校园故事标记 + 拍照打卡精选。
 *
 * 这是一条**核对现状**的测试，不是新功能：筛选能力（curationRoutes.ts、047 迁移、
 * AdminCuration.tsx）已经实现，但此前只有浏览器脚本（tools/checks/*.mjs）在真实
 * 服务上跑，没有一条能进 CI 的、针对 SQL 与准入规则的用例。这里补上，重点盯住
 * 那几个"看起来能过、实际会串数据"的边界：
 *   · 给**已下架**的帖子设故事 → 必须 409（否则它一重新公开就带着旧标记上首页）
 *   · 打卡照片用了**别的地点**的帖子 → 必须 409（否则照片会挂到错误的地点上）
 *   · 版本冲突（两个人同时编辑）→ 必须 409，不能后写覆盖
 *   · 地点停用后仍设 active → 必须 409（否则公开侧查不到、管理端却显示"推荐中"）
 *   · 帖子下架后，已选的照片自动失效 → validPhotos 归零（VALID_CHECKIN_PHOTO 谓词）
 *
 * 只连本地隔离 schema。
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import Fastify from 'fastify'
import { registerCurationRoutes } from '../src/curationRoutes.ts'
import type { TimemapCtx } from '../src/timemap.ts'

const url = process.env.PROFILE_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:15432/postgres'
assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Only an isolated local test schema is allowed')
const schema = 'curation_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema })
const app = Fastify()
const state = { role: 'admin', userId: '' as string }
const admin_ = randomUUID(), student = randomUUID()
state.userId = admin_
registerCurationRoutes({
  app, db: { pool, noteFailure: () => 'none' },
  resolveSession: async auth => auth === 'none' ? { kind: 'none' }
    : { kind: 'ok', user: { userId: state.role === 'admin' ? admin_ : student, role: state.role } },
  dbUnavailable: () => ({ error: 'unavailable' }),
} as unknown as TimemapCtx)
const call = (method: 'GET' | 'PUT', path: string, payload?: object) =>
  app.inject({ method, url: path, headers: { authorization: 'student' }, payload })

try {
  await pool.query(`
    create table users(id uuid primary key, display_name text, avatar_media_id uuid, handle text default 'test',
      phone_e164 text, role text default 'student');
    create table places(id uuid primary key, name text, address text, enabled boolean default true,
      latitude double precision, longitude double precision, category text default '校园地标');
    create table posts(id uuid primary key, author_id uuid references users(id), author_name text, body text,
      place_id uuid references places(id), status text default 'published', is_anonymous boolean default false,
      created_at timestamptz default now(), removed_reason text);
    create table media(id uuid primary key, scope text default 'public', mime text default 'image/jpeg',
      width integer, height integer);
    create table post_media(post_id uuid references posts(id) on delete cascade,
      media_id uuid references media(id) on delete cascade, purpose text default 'post', position integer default 0);
    create table audit_log(id uuid primary key, actor_id uuid, action text, target_type text, target_id uuid, reason text);
  `)
  await pool.query(readFileSync('src/migrations/047_map_curation.sql', 'utf8'))
  await pool.query('insert into users(id,display_name) values($1,$2),($3,$4)', [admin_, '管理员', student, '同学'])
  const place = randomUUID(), otherPlace = randomUUID(), disabledPlace = randomUUID()
  await pool.query('insert into places(id,name,address,enabled) values($1,$2,$3,true),($4,$5,$6,true),($7,$8,$9,false)',
    [place, '银杏大道', '芳华园与明湖分界', otherPlace, '明湖', '湖边', disabledPlace, '停用地点', '某处'])
  const post = randomUUID(), removedPost = randomUUID(), otherPlacePost = randomUUID()
  await pool.query("insert into posts(id,author_id,author_name,body,place_id,status) values($1,$2,'同学','银杏黄了',$3,'published'),($4,$2,'同学','已下架帖',$3,'removed'),($5,$2,'同学','明湖的帖子',$6,'published')",
    [post, admin_, place, removedPost, otherPlacePost, otherPlace])
  const media = randomUUID(), otherMedia = randomUUID()
  await pool.query("insert into media(id,width,height) values($1,100,120),($2,100,120)", [media, otherMedia])
  await pool.query("insert into post_media(post_id,media_id,purpose) values($1,$2,'post'),($3,$4,'post')", [post, media, otherPlacePost, otherMedia])

  // 未登录 / 非管理员 → 拒绝
  state.role = 'student'
  assert.equal((await call('GET', '/api/admin/curation/posts')).statusCode, 403)
  assert.equal((await call('GET', '/api/admin/curation/places')).statusCode, 403)
  assert.equal((await call('PUT', `/api/admin/curation/posts/${post}/story`, { enabled: true })).statusCode, 403)
  state.role = 'admin'

  // 故事标记：下架帖不能设（409），非法载荷 400
  assert.equal((await call('PUT', `/api/admin/curation/posts/${removedPost}/story`, { enabled: true })).statusCode, 409)
  assert.equal((await call('PUT', `/api/admin/curation/posts/${post}/story`, { enabled: 'yes' })).statusCode, 400)
  assert.equal((await call('PUT', `/api/admin/curation/posts/${post}/story`, { enabled: true })).statusCode, 200)

  // 只筛「校园故事」时只出现被挑中的那条
  const stories = (await call('GET', '/api/admin/curation/posts?story=yes')).json()
  assert.deepEqual(stories.items.map((item: { id: string }) => item.id), [post])
  assert.equal(stories.items[0].campusStory, true)
  const unlabeled = (await call('GET', '/api/admin/curation/posts?story=no')).json()
  assert(!unlabeled.items.some((item: { id: string }) => item.id === post))

  // 取消标记
  assert.equal((await call('PUT', `/api/admin/curation/posts/${post}/story`, { enabled: false })).statusCode, 200)
  assert.equal((await call('GET', '/api/admin/curation/posts?story=yes')).json().items.length, 0)

  // 打卡：照片必须属于该地点（跨地点 409）、版本冲突 409、停用地点不能设 active 409
  const checkinBody = (photos: object[], active = true, version = 0, description = '秋天最美的一段路') =>
    ({ active, version, description, photos })
  assert.equal((await call('PUT', `/api/admin/curation/places/${place}`,
    checkinBody([{ postId: otherPlacePost, mediaId: otherMedia }]))).statusCode, 409)
  assert.equal((await call('PUT', `/api/admin/curation/places/${place}`,
    checkinBody([{ postId: post, mediaId: media }], true, 7))).statusCode, 409)
  assert.equal((await call('PUT', `/api/admin/curation/places/${disabledPlace}`,
    checkinBody([{ postId: post, mediaId: media }]))).statusCode, 409)
  // active 但没有照片 → 400（公开侧会显示一个空封面卡片）
  assert.equal((await call('PUT', `/api/admin/curation/places/${place}`, checkinBody([]))).statusCode, 400)

  // 正常保存
  const saved = await call('PUT', `/api/admin/curation/places/${place}`,
    checkinBody([{ postId: post, mediaId: media }]))
  assert.equal(saved.statusCode, 200, saved.body)
  assert.equal(saved.json().version, 1)

  let list = (await call('GET', '/api/admin/curation/places?checkin=active')).json()
  const curated = list.items.find((item: { id: string }) => item.id === place)
  assert.equal(curated.active, true)
  assert.equal(curated.validPhotos, 1)
  assert.equal(curated.version, 1)
  // 未设置的地点不该出现在「推荐中」里
  assert(!list.items.some((item: { id: string }) => item.id === otherPlace))

  const detail = (await call('GET', `/api/admin/curation/places/${place}`)).json()
  assert.deepEqual(detail.photos.map((photo: { postId: string }) => photo.postId), [post])
  assert.equal(detail.photos[0].valid, true)

  // 帖子下架后，精选照片自动失效（公开侧与 validPhotos 用同一个谓词）
  await pool.query("update posts set status='removed' where id=$1", [post])
  list = (await call('GET', '/api/admin/curation/places?checkin=active')).json()
  assert.equal(list.items.find((item: { id: string }) => item.id === place).validPhotos, 0)
  assert.equal((await call('GET', `/api/admin/curation/places/${place}`)).json().photos[0].valid, false)
  // 失效照片不能再被保存进去
  assert.equal((await call('PUT', `/api/admin/curation/places/${place}`,
    checkinBody([{ postId: post, mediaId: media }], true, 1))).statusCode, 409)

  // 审计：每次写操作都留痕
  const audit = await pool.query('select action from audit_log order by action')
  assert.deepEqual(audit.rows.map((row: { action: string }) => row.action).sort(),
    ['checkin_update', 'story_set', 'story_unset'])

  console.log('PASS curation: admin-only, story labelling on published posts, checkin photo ownership, version conflicts, disabled place, invalidated photos, audit trail')
} finally {
  await app.close(); await pool.end()
  await setup.query(`drop schema ${schema} cascade`); await setup.end()
}
