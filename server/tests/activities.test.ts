/**
 * 校园活动体检（ACT-001/002/003、F06 收藏）：列表/详情/收藏 + 管理端录入。
 *
 * 「维护一下校园活动」= 体检：把学生侧与管理员侧的链路各跑一遍，确认没有坏，
 * 并且把历史上真出过问题的地方钉成断言（见 ACTIVITY_EFF_STATUS_SQL 与
 * /api/activities 里的注释）：
 *   · 默认列表只给 即将开始 + 进行中（已结束/已取消要靠筛选才看得到）
 *   · 「已结束」筛选**不能**恒为空 —— 曾经因为默认窗口里混了 `ends_at > now() - 7d`
 *     又被前端二次过滤，导致这个筛选永远一条不剩
 *   · 缺 ends_at 时按 2 小时推导展示态
 *   · 收藏幂等、未登录 401、取消收藏幂等
 *
 * 只连本地隔离 schema。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import Fastify from 'fastify'
import { registerTimemapRoutes } from '../src/timemap.ts'
import type { TimemapCtx } from '../src/timemap.ts'

const url = process.env.PROFILE_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:15432/postgres'
assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Only an isolated local test schema is allowed')
const schema = 'activity_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema })
const app = Fastify()
const admin_ = randomUUID(), student = randomUUID()
registerTimemapRoutes({
  app, db: { pool, noteFailure: () => 'none' },
  // 桩必须与真实 resolveSession 同构：**没有 Authorization 头**（undefined / 'none'）
  // 就是未登录。写成 `auth !== 'none'` 会把"没带 token"当成已登录，
  // 于是 favoritedByMe 这条断言会假绿。
  resolveSession: async auth => (auth === undefined || auth === null || auth === 'none') ? { kind: 'none' }
    : { kind: 'ok', user: { userId: auth === 'admin' ? admin_ : student, role: auth === 'admin' ? 'admin' : 'student' } },
  dbUnavailable: () => ({ error: 'unavailable' }),
} as unknown as TimemapCtx)
const get = (path: string, auth?: string) => app.inject({ method: 'GET', url: path, headers: auth ? { authorization: auth } : {} })
const send = (method: 'POST' | 'PATCH' | 'DELETE', path: string, payload?: object, auth = 'student') =>
  app.inject({ method, url: path, headers: { authorization: auth }, payload })

try {
  await pool.query(`
    create table users(id uuid primary key, display_name text, avatar_media_id uuid, handle text default 'test',
      phone_e164 text, role text default 'student');
    create table sessions(id uuid primary key, user_id uuid, token_hash text, revoked_at timestamptz, expires_at timestamptz);
    create table places(id uuid primary key, name text, address text, enabled boolean default true,
      latitude double precision, longitude double precision, category text default '校园地标');
    create table media(id uuid primary key, scope text default 'public', mime text default 'image/jpeg',
      width integer, height integer);
    create table activities(id uuid primary key, title text not null, description text,
      place_id uuid not null references places(id), starts_at timestamptz not null, ends_at timestamptz,
      source text not null default '管理员录入', status text not null default 'scheduled',
      created_by uuid references users(id), created_at timestamptz default now(), updated_at timestamptz default now(),
      activity_type text, organizer text, external_link text, cover_image_id uuid references media(id));
    create table activity_favorites(id uuid primary key, activity_id uuid references activities(id) on delete cascade,
      user_id uuid references users(id) on delete cascade, created_at timestamptz default now(),
      unique(user_id, activity_id));
    -- 管理端录入活动会写操作记录（audit_log），夹具要跟着建
    create table audit_log(id uuid primary key, actor_id uuid, action text, target_type text, target_id uuid, reason text);
  `)
  await pool.query('insert into users(id,display_name) values($1,$2),($3,$4)', [admin_, '管理员', student, '同学'])
  const place = randomUUID(), otherPlace = randomUUID()
  await pool.query("insert into places(id,name,address) values($1,'银杏大道','芳华园'),($2,'明湖','湖边')",
    [place, otherPlace])

  const upcoming = randomUUID(), ongoing = randomUUID(), ended = randomUUID(), cancelled = randomUUID(), farFuture = randomUUID()
  /** 相对"现在"的 ISO 时间（分钟），避免把 SQL 表达式当参数传进去 */
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
  const insert = (id: string, title: string, startsMin: number, endsMin: number | null, status = 'scheduled', placeId = place) =>
    pool.query('insert into activities(id,title,place_id,starts_at,ends_at,status) values($1,$2,$3,$4,$5,$6)',
      [id, title, placeId, at(startsMin), endsMin === null ? null : at(endsMin), status])
  await insert(upcoming, '下周摄影征集', 3 * 1440, null)
  await insert(ongoing, '进行中的社团活动', -60, 60)
  await insert(ended, '上周已结束的展览', -10 * 1440, -9 * 1440)
  await insert(cancelled, '已取消的纳凉晚会', 5 * 1440, null, 'cancelled')
  await insert(farFuture, '很远将来的活动', 200 * 1440, null, 'scheduled', otherPlace)

  // ---- 列表：默认只给 upcoming + ongoing，按开始时间升序 ----
  // farFuture 虽然远，但它确实是 upcoming ⇒ 默认列表里应该有它（按 starts_at 升序排在最后）
  let list = (await get('/api/activities')).json()
  assert.deepEqual(list.items.map((item: { id: string }) => item.id), [ongoing, upcoming, farFuture])
  assert.equal(list.items[0].effectiveStatus, 'ongoing')
  assert.equal(list.items[1].effectiveStatus, 'upcoming')
  assert.equal(list.items[2].effectiveStatus, 'upcoming')

  // ---- 「已结束」筛选必须真的查得到（历史回归点）----
  list = (await get('/api/activities?status=ended')).json()
  assert.deepEqual(list.items.map((item: { id: string }) => item.id), [ended])
  assert.equal(list.items[0].effectiveStatus, 'ended')

  // ---- 已取消：人工覆盖优先于时间推导 ----
  list = (await get('/api/activities?status=cancelled')).json()
  assert.deepEqual(list.items.map((item: { id: string }) => item.id), [cancelled])
  assert.equal((await get(`/api/activities?status=all`)).json().items.length, 5)

  // ---- 缺 ends_at 按 2 小时推导：刚结束 1 小时的活动应仍是 ongoing ----
  const justStarted = randomUUID()
  await insert(justStarted, '刚开始且没填结束时间', -60, null)
  const detailJust = (await get(`/api/activities/${justStarted}`)).json()
  assert.equal(detailJust.effectiveStatus, 'ongoing')
  const sixtyOneMinutes = randomUUID()
  await insert(sixtyOneMinutes, '两小时前开始且没填结束时间', -121, null)
  assert.equal((await get(`/api/activities/${sixtyOneMinutes}`)).json().effectiveStatus, 'ended')

  // ---- 时间窗口 today/week 只保留与窗口相交的活动 ----
  // 用标题断言而不是 id 顺序：窗口边界依赖"今天是周几"（date_trunc('week') 从周一起算），
  // 按 id 比对会让这条测试在周一/周日给出不同结果 —— 一条会自己变红的测试不是回归防线。
  const titlesOf = async (path: string) =>
    ((await get(path)).json().items as { title: string }[]).map(item => item.title)
  // 本周窗口：正在进行的活动必然相交；远在 200 天后的必然不相交
  const week = await titlesOf('/api/activities?window=week')
  assert(week.includes('进行中的社团活动'), '本周窗口必须包含进行中的活动')
  assert(!week.includes('很远将来的活动'), '本周窗口不该包含 200 天后的活动')
  // 今天窗口：进行中的一定在；3 天后的不在
  const today = await titlesOf('/api/activities?window=today')
  assert(today.includes('进行中的社团活动'), '今天窗口必须包含进行中的活动')
  assert(!today.includes('下周摄影征集'), '今天窗口不该包含 3 天后的活动')

  // ---- 地点筛选 + 参数校验 ----
  assert.deepEqual((await get(`/api/activities?placeId=${otherPlace}`)).json().items
    .map((item: { id: string }) => item.id), [farFuture])
  assert.equal((await get('/api/activities?placeId=not-a-uuid')).statusCode, 400)
  assert.equal((await get('/api/activities?status=weird')).statusCode, 400)
  assert.equal((await get('/api/activities?window=month')).statusCode, 400)

  // ---- 详情 ----
  assert.equal((await get(`/api/activities/${randomUUID()}`)).statusCode, 404)
  assert.equal((await get('/api/activities/not-a-uuid')).statusCode, 400)

  // ---- 收藏：未登录 401，登录幂等，未登录也能看列表 ----
  assert.equal((await send('POST', `/api/activities/${upcoming}/favorite`, {}, 'none')).statusCode, 401)
  assert.equal((await send('DELETE', `/api/activities/${upcoming}/favorite`, undefined, 'none')).statusCode, 401)
  let fav = await send('POST', `/api/activities/${upcoming}/favorite`)
  assert.equal(fav.statusCode, 201, fav.body)
  assert.deepEqual({ favorited: fav.json().favorited, favoriteCount: fav.json().favoriteCount },
    { favorited: true, favoriteCount: 1 })
  // 重复收藏幂等：不报错、不重复计数
  assert.equal((await send('POST', `/api/activities/${upcoming}/favorite`)).json().favoriteCount, 1)
  assert.equal((await get(`/api/activities/${upcoming}`, 'student')).json().favoritedByMe, true)
  assert.equal((await get(`/api/activities/${upcoming}`)).json().favoritedByMe, false)
  fav = await send('DELETE', `/api/activities/${upcoming}/favorite`)
  assert.equal(fav.statusCode, 200, fav.body)
  assert.deepEqual({ favorited: fav.json().favorited, favoriteCount: fav.json().favoriteCount },
    { favorited: false, favoriteCount: 0 })
  // 取消收藏幂等
  assert.equal((await send('DELETE', `/api/activities/${upcoming}/favorite`)).json().favoriteCount, 0)

  // ---- 管理端录入：非管理员 403；缺字段 400；非法外链 400；正常创建 201 ----
  const created = await send('POST', '/api/admin/activities', {
    title: '新录入的校园活动', placeId: place, startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 90000000).toISOString(), description: '说明',
    organizer: '学生会', activityType: '展览', externalLink: 'https://example.com/act',
  }, 'admin')
  assert.equal(created.statusCode, 201, created.body)
  const newId = created.json().id
  assert.equal((await send('POST', '/api/admin/activities', {
    title: '非管理员创建', placeId: place, startsAt: new Date().toISOString() }, 'student')).statusCode, 403)
  assert.equal((await send('POST', '/api/admin/activities', { placeId: place, startsAt: new Date().toISOString() }, 'admin')).statusCode, 400)
  assert.equal((await send('POST', '/api/admin/activities', {
    title: '带凭证的外链', placeId: place, startsAt: new Date().toISOString(),
    externalLink: 'https://user:pw@example.com/x' }, 'admin')).statusCode, 400)

  // 修改：改成 cancelled 后，展示态立刻变 cancelled 并退出默认列表
  assert.equal((await send('PATCH', `/api/admin/activities/${newId}`, { status: 'cancelled' }, 'admin')).statusCode, 200)
  assert.equal((await get(`/api/activities/${newId}`)).json().effectiveStatus, 'cancelled')
  assert(!(await get('/api/activities')).json().items.some((item: { id: string }) => item.id === newId))

  console.log('PASS activities: default/ended/cancelled lists, 2h end fallback, today/week windows, place filter, detail, idempotent favorites, admin create validation, cancellation')
} finally {
  await app.close(); await pool.end()
  await setup.query(`drop schema ${schema} cascade`); await setup.end()
}
