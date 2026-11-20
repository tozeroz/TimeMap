/** Uses an isolated schema in a local PostgreSQL database. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { buildServer, type ServerDeps } from '../src/index.ts'
import { publicAuthor } from '../src/anonymous.ts'
import { ANONYMOUS_AVATAR, avatarFor, mediaUrl, postAvatar, toFeedPost, type ApiPost } from '../../app/src/api/client.ts'

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
      is_anonymous boolean default false, status text default 'published', open_count int default 0);
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
  const read = async (path: string) => {
    const response = await app.inject({ method: 'GET', url: path })
    assert.equal(response.statusCode, 200, response.body)
    return response.json()
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
    const list = (await read('/api/posts')).items as ApiPost[]
    const post = list.find(post => post.id === id)!
    const detail = await read('/api/posts/' + id)
    const favorites = await app.inject({ method: 'GET', url: '/api/me/favorites', headers })
    assert.equal(favorites.statusCode, 200, favorites.body)
    const favoritePosts = favorites.json().items as ApiPost[]
    assert.equal(favoritePosts.find(post => post.id === anonymousId)!.author, '匿名同学')
    for (const value of [post, detail, favoritePosts.find(post => post.id === id)!]) {
      assert.equal(value.author, name ?? 'tozero')
      assert.equal(toFeedPost(value).author.name, name ?? 'tozero')
      assert.equal(value.authorAvatarMediaId, avatar)
      assert.equal(postAvatar(value), avatar ? mediaUrl(avatar) : avatarFor(name ?? 'tozero'))
      assert.equal(toFeedPost(value).author.avatar, postAvatar(value))
    }
    const anonymous = list.find(post => post.id === anonymousId)!
    assert.equal(anonymous.author, '匿名同学')
    assert.equal(anonymous.authorAvatarMediaId, null)
    assert.equal(anonymous.authorId, null)
    assert.equal(toFeedPost(anonymous).author.avatar, ANONYMOUS_AVATAR)
    const anonymousDetail = await read('/api/posts/' + anonymousId)
    assert.equal(anonymousDetail.author, '匿名同学')
    assert.equal(anonymousDetail.authorAvatarMediaId, null)
    assert.equal(publicAuthor({ author_name: 'tozero', author_id: owner,
      author_avatar_media_id: avatar, is_anonymous: true }, owner).authorAvatarMediaId, null)
  }
  assert.equal((await pool.query('select author_name from posts where id=$1', [id])).rows[0].author_name, 'tozero',
    'Renaming must not require rewriting the post snapshot')
  assert.equal(postAvatar({ author: 'legacy' }), avatarFor('legacy'))
  assert.equal(postAvatar({ author: 'tozero', anonymous: true, authorAvatarMediaId: randomUUID() }), ANONYMOUS_AVATAR)
  console.log('PASS post profiles: nickname PATCH, repeated renames, list/detail/favorites, avatar changes/removal, anonymous masking and legacy fallback')
} finally {
  await app.close()
  await pool.end()
  await setup.query(`drop schema ${schema} cascade`)
  await setup.end()
}
