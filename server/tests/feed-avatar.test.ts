/** Uses an isolated schema in a local PostgreSQL database. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
    create table users(id uuid primary key, avatar_media_id uuid);
    create table places(id uuid primary key, latitude numeric, longitude numeric);
    create table posts(id uuid primary key, author_name text, author_id uuid, body text default '',
      place text, place_id uuid, created_at timestamptz default now(), image_mode text default 'photo',
      is_anonymous boolean default false, status text default 'published');
    create table likes(post_id uuid, user_id uuid);
    create table comments(post_id uuid, status text);
    create table favorites(post_id uuid, user_id uuid);
    create table media(id uuid primary key, width int, height int, scope text, mime text, duration_ms int);
    create table post_media(post_id uuid, media_id uuid, purpose text, position int);
  `)
  const owner = randomUUID(), id = randomUUID(), anonymousId = randomUUID()
  await pool.query('insert into users values($1,null)', [owner])
  await pool.query(`insert into posts(id,author_id,author_name,is_anonymous) values($1,$2,'tozero',false),($3,$2,'tozero',true)`, [id, owner, anonymousId])
  const read = async (path: string) => {
    const response = await app.inject({ method: 'GET', url: path })
    assert.equal(response.statusCode, 200, response.body)
    return response.json()
  }
  // Existing posts must follow profile changes without rewriting the posts.
  for (const avatar of [null, randomUUID(), randomUUID(), null]) {
    await pool.query('update users set avatar_media_id=$1 where id=$2', [avatar, owner])
    const list = (await read('/api/posts')).items as ApiPost[]
    const post = list.find(post => post.id === id)!
    const detail = await read('/api/posts/' + id)
    for (const value of [post, detail]) {
      assert.equal(value.authorAvatarMediaId, avatar)
      assert.equal(postAvatar(value), avatar ? mediaUrl(avatar) : avatarFor('tozero'))
      assert.equal(toFeedPost(value).author.avatar, postAvatar(value))
    }
    const anonymous = list.find(post => post.id === anonymousId)!
    assert.equal(anonymous.authorAvatarMediaId, null)
    assert.equal(anonymous.authorId, null)
    assert.equal(toFeedPost(anonymous).author.avatar, ANONYMOUS_AVATAR)
    assert.equal((await read('/api/posts/' + anonymousId)).authorAvatarMediaId, null)
    assert.equal(publicAuthor({ author_name: 'tozero', author_id: owner,
      author_avatar_media_id: avatar, is_anonymous: true }, owner).authorAvatarMediaId, null)
  }
  assert.equal(postAvatar({ author: 'legacy' }), avatarFor('legacy'))
  assert.equal(postAvatar({ author: 'tozero', anonymous: true, authorAvatarMediaId: randomUUID() }), ANONYMOUS_AVATAR)
  console.log('PASS feed avatars: existing posts, profile changes/removal, list/detail rendering, anonymous masking and legacy fallback')
} finally {
  await app.close()
  await pool.end()
  await setup.query(`drop schema ${schema} cascade`)
  await setup.end()
}
