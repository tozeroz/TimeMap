/** Uses an isolated schema in a local PostgreSQL database. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { buildServer, type ServerDeps } from '../src/index.ts'
import { anonymousPostName, publicAuthor } from '../src/anonymous.ts'
import { ANONYMOUS_AVATAR, commentAvatar, avatarFor, mediaUrl, postAvatar, toFeedPost, type ApiPost } from '../../app/src/api/client.ts'

const url = process.env.PROFILE_TEST_DATABASE_URL
assert(url, 'Set PROFILE_TEST_DATABASE_URL to a local test database')
assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname))
const schema = 'avatar_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema })
const app = buildServer({ db: { pool, status: () => ({ ready: true }), noteFailure: () => 'none' },
  corsOrigins: [], smsSender: { configured: false }, devSink: {}, sessionTtlDays: 30,
} as unknown as ServerDeps)
try {
  await pool.query(`
    create table users(id uuid primary key, avatar_media_id uuid, display_name text,
      handle text default 'test', phone_e164 text, role text default 'student', bio text default '',
      school_campus_id uuid, college_id uuid, enrollment_year int, updated_at timestamptz default now());
    create table sessions(id uuid primary key, user_id uuid, token_hash text,
      revoked_at timestamptz, expires_at timestamptz);
    create table places(id uuid primary key, latitude numeric, longitude numeric);
    create table posts(id uuid primary key, author_name text, author_id uuid, body text default '',
      place text, place_id uuid, created_at timestamptz default now(), image_mode text default 'photo',
      is_anonymous boolean default false, allow_anonymous_comments boolean default true, status text default 'published', open_count int default 0);
    create table post_daily_stats(post_id uuid, day date, impressions int, opens int);
    create table likes(post_id uuid, user_id uuid);
    create table comments(post_id uuid, status text);
    create table favorites(post_id uuid, user_id uuid, created_at timestamptz default now());
    create table media(id uuid primary key, width int, height int, scope text, mime text, duration_ms int);
    create table post_media(post_id uuid, media_id uuid, purpose text, position int);
  `)
  const owner = randomUUID(), id = randomUUID(), anonymousId = randomUUID()
  await pool.query("insert into users(id,display_name) values($1,'tozero')", [owner])
  const token = randomUUID() + randomUUID()
  const headers = { authorization: 'Bearer ' + token }
  await pool.query("insert into sessions(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '1 day')",
    [randomUUID(), owner, createHash('sha256').update(token).digest('hex')])
  await pool.query(`insert into posts(id,author_id,author_name,is_anonymous) values($1,$2,'tozero',false),($3,$2,'tozero',true)`, [id, owner, anonymousId])
  await pool.query('insert into favorites(post_id,user_id) values($1,$2),($3,$2)', [id, owner, anonymousId])
  const read = async (path: string, requestHeaders: Record<string, string> = {}) => {
    const response = await app.inject({ method: 'GET', url: path, headers: requestHeaders })
    assert.equal(response.statusCode, 200, response.body)
    return response.json()
  }
  // Filtering by a real author must never reveal their anonymous posts to visitors.
  const visitor = randomUUID(), anonymousOnlyOwner = randomUUID(), anonymousOnlyPost = randomUUID()
  const visitorToken = randomUUID() + randomUUID()
  const visitorHeaders = { authorization: 'Bearer ' + visitorToken }
  await pool.query("insert into users(id,display_name) values($1,'访客'),($2,'仅匿名用户')", [visitor, anonymousOnlyOwner])
  await pool.query("insert into sessions(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '1 day')",
    [randomUUID(), visitor, createHash('sha256').update(visitorToken).digest('hex')])
  await pool.query("insert into posts(id,author_id,author_name,is_anonymous) values($1,$2,'仅匿名用户',true)",
    [anonymousOnlyPost, anonymousOnlyOwner])
  for (const sort of ['latest', 'hot']) {
    for (const pagination of ['', '&paginate=1']) {
      const path = `/api/posts?authorId=${owner}&sort=${sort}${pagination}`
      for (const viewer of [{}, visitorHeaders]) {
        const profile = await read(path, viewer)
        assert.deepEqual(profile.items.map((post: ApiPost) => post.id), [id])
        assert.equal((await read(`/api/posts?authorId=${anonymousOnlyOwner}&sort=${sort}${pagination}`, viewer)).items.length, 0)
      }
      const own = await read(path, headers)
      assert.deepEqual(new Set(own.items.map((post: ApiPost) => post.id)), new Set([id, anonymousId]),
        'My posts must still include my anonymous posts')
    }
  }
  // Existing posts must follow profile changes without rewriting the posts.
  for (const [avatar, name] of [[null, 'tozero'], [randomUUID(), '新昵称'], [randomUUID(), '再次改名'], [null, null]] as const) {
    await pool.query('update users set avatar_media_id=$1 where id=$2', [avatar, owner])
    if (name !== null) {
      const saved = await app.inject({ method: 'PATCH', url: '/api/users/me', headers, payload: { displayName: name } })
      assert.equal(saved.statusCode, 200, saved.body)
      assert.equal(saved.json().displayName, name)
    } else {
      await pool.query('update users set display_name=null where id=$1', [owner])
    }
    const card = await read('/api/users/' + owner)
    assert.equal(card.avatarMediaId, avatar)
    assert.deepEqual(Object.keys(card).sort(), ['avatarMediaId', 'displayName', 'id'])
    const list = (await read('/api/posts')).items as ApiPost[]
    const post = list.find(post => post.id === id)!
    const detail = await read('/api/posts/' + id)
    const favorites = await app.inject({ method: 'GET', url: '/api/me/favorites', headers })
    assert.equal(favorites.statusCode, 200, favorites.body)
    const favoritePosts = favorites.json().items as ApiPost[]
    assert.equal(favoritePosts.find(post => post.id === anonymousId)!.author, anonymousPostName(anonymousId))
    for (const value of [post, detail, favoritePosts.find(post => post.id === id)!]) {
      assert.equal(value.author, name ?? 'tozero')
      assert.equal(toFeedPost(value).author.name, name ?? 'tozero')
      assert.equal(value.authorAvatarMediaId, avatar)
      assert.equal(postAvatar(value), avatar ? mediaUrl(avatar) : avatarFor(name ?? 'tozero'))
      assert.equal(toFeedPost(value).author.avatar, postAvatar(value))
    }
    const anonymous = list.find(post => post.id === anonymousId)!
    assert.equal(anonymous.author, anonymousPostName(anonymousId))
    assert.equal(toFeedPost(anonymous).author.name, anonymous.author)
    assert.notEqual(anonymousPostName(id), anonymous.author)
    assert.equal(anonymousPostName(anonymousId), anonymousPostName(anonymousId))
    assert.equal(anonymous.authorAvatarMediaId, null)
    assert.equal(anonymous.authorId, null)
    assert.equal(toFeedPost(anonymous).author.avatar, ANONYMOUS_AVATAR)
    const anonymousDetail = await read('/api/posts/' + anonymousId)
    assert.equal(anonymousDetail.author, anonymousPostName(anonymousId))
    assert.equal(anonymousDetail.authorAvatarMediaId, null)
    assert.equal(publicAuthor({ id: anonymousId, author_name: 'tozero', author_id: owner,
      author_avatar_media_id: avatar, is_anonymous: true }, owner).authorAvatarMediaId, null)
  }
  assert.equal((await pool.query('select author_name from posts where id=$1', [id])).rows[0].author_name, 'tozero',
    'Renaming must not require rewriting the post snapshot')
  assert.equal(postAvatar({ author: 'legacy' }), avatarFor('legacy'))
  assert.equal(postAvatar({ author: 'tozero', anonymous: true, authorAvatarMediaId: randomUUID() }), ANONYMOUS_AVATAR)
  await pool.query('update posts set allow_anonymous_comments=false where id=$1', [id])
  assert.equal((await read('/api/posts/' + id)).allowAnonymousComments, false)
  assert.equal((await read('/api/posts/' + anonymousId)).allowAnonymousComments, true)
  const commentAvatarId = randomUUID()
  assert.equal(commentAvatar({ author: '评论者', anonymous: false, authorAvatarMediaId: commentAvatarId }), mediaUrl(commentAvatarId))
  assert.equal(commentAvatar({ author: '评论者', authorAvatarMediaId: null }), avatarFor('评论者'))
  assert.equal(commentAvatar({ author: '匿名同学 01', anonymous: true, authorAvatarMediaId: commentAvatarId }),
    commentAvatar({ author: '匿名同学 01', anonymous: true, authorAvatarMediaId: null }))
  // More than two full pages: latest and hot must eventually expose every published post.
  for (let i = 0; i < 126; i++) await pool.query(
    `insert into posts(id,author_id,author_name,created_at,status) values($1,$2,'分页',now()-($3::text||' hours')::interval,$4)`,
    [randomUUID(), owner, i + 1, i === 125 ? 'removed' : 'published'])
  await pool.query("update posts set created_at='2026-01-01 12:00:00.123456+00' where author_name='分页'")
  const expected = Number((await pool.query("select count(*)::int as n from posts where status='published'")).rows[0].n)
  for (const sort of ['latest', 'hot']) {
    const all: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = await read(`/api/posts?paginate=1&sort=${sort}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`)
      assert(page.items.length <= 50)
      all.push(...page.items.map((post: any) => post.id))
      cursor = page.nextCursor
      assert(++pages < 10, 'Pagination must end')
    } while (cursor)
    assert.equal(all.length, expected, sort + ': all published posts must be reachable')
    assert.equal(new Set(all).size, expected, sort + ': no duplicates between pages')
    assert(pages >= 3)
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/posts?paginate=1&cursor=invalid' })).statusCode, 400)
  console.log('PASS post profiles: author-filter anonymous privacy for guests/other users, owner access, latest/hot/pagination, nickname PATCH, list/detail/favorites, avatars and legacy fallback')
} finally {
  await app.close()
  await pool.end()
  await setup.query(`drop schema ${schema} cascade`)
  await setup.end()
}
