/** Isolated schema only. Set PROFILE_TEST_DATABASE_URL to a local PostgreSQL. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { buildServer, type ServerDeps } from '../src/index.ts'
import { anonymousPostName } from '../src/anonymous.ts'
import { publicCommentIdentity } from '../src/commentIdentity.ts'

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
  await pool.query(`
    create table users(id uuid primary key, display_name text, avatar_media_id uuid, handle text default 'test', phone_e164 text, role text default 'student');
    create table sessions(id uuid primary key, user_id uuid, token_hash text, revoked_at timestamptz, expires_at timestamptz);
    create table posts(id uuid primary key, author_id uuid references users(id), is_anonymous boolean default false, status text default 'published');
    create table comments(id uuid primary key, post_id uuid references posts(id), author_id uuid references users(id),
      parent_id uuid references comments(id), body text, created_at timestamptz default now(), status text default 'published',
      removed_reason text, removed_by uuid, removed_at timestamptz);
    -- 048：评论点赞。读模型（loadComments）会带上 likeCount/likedByMe，夹具必须同步建表；
    -- 否则整个评论列表接口都会 500（这条测试正好卡在「匿名评论读得到」上）。
    create table comment_likes(id uuid primary key, comment_id uuid references comments(id) on delete cascade,
      user_id uuid references users(id) on delete cascade, created_at timestamptz default now(),
      unique(user_id, comment_id));
  `)
  const migration = readFileSync('src/migrations/042_comment_anonymous.sql', 'utf8')
  await pool.query(migration)
  await pool.query(migration)
  await pool.query(readFileSync('src/migrations/044_post_comment_policy.sql', 'utf8'))
  const people = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
    const id = randomUUID(), token = randomUUID() + randomUUID()
    await pool.query('insert into users(id, display_name) values($1,$2)', [id, `真实昵称${index}`])
    await pool.query("insert into sessions(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '1 day')",
      [randomUUID(), id, createHash('sha256').update(token).digest('hex')])
    return { id, headers: { authorization: 'Bearer ' + token } }
  }))
  const [owner, a, b] = people
  const post = randomUUID(), otherPost = randomUUID()
  await pool.query('insert into posts(id,author_id,is_anonymous) values($1,$2,true),($3,$2,false)', [post, owner.id, otherPost])
  const send = async (person: typeof a, payload: object, postId = post, status = 201) => {
    const r = await app.inject({ method: 'POST', url: `/api/posts/${postId}/comments`, headers: person.headers, payload })
    assert.equal(r.statusCode, status, r.body)
    return r.json()
  }
  const read = async (headers = {}) => {
    const r = await app.inject({ method: 'GET', url: `/api/posts/${post}/comments`, headers })
    assert.equal(r.statusCode, 200, r.body)
    return r.json()
  }
  // Old anonymous-owner comments must be masked too, including reply targets.
  const old = randomUUID()
  await pool.query("insert into comments(id,post_id,author_id,body) values($1,$2,$3,'历史评论')", [old, post, owner.id])
  const first = await send(a, { body: '匿名 A', anonymous: true, parentId: old })
  assert.equal(first.author, '匿名同学 01')
  assert.equal(first.replyTo, anonymousPostName(post))
  assert.equal(first.authorId, null)
  assert.equal(first.isMine, true)
  const second = await send(b, { body: '匿名 B', anonymous: true, parentId: first.id })
  assert.equal(second.author, '匿名同学 02')
  assert.equal(second.replyTo, first.author)
  const mine = await send(owner, { body: '楼主', anonymous: false })
  assert.equal(mine.author, anonymousPostName(post))
  assert.equal(mine.authorId, null)
  assert.equal(mine.anonymous, true)
  assert.equal(mine.isPostAuthor, true)
  const tree = await read()
  assert.equal(tree.total, 4)
  assert.equal(tree.items.find((c: any) => c.id === old).replies[1].replyTo, first.author)
  assert(!JSON.stringify(tree).includes('真实昵称'))
  assert(!JSON.stringify(tree).includes(owner.id))
  assert(!JSON.stringify(tree).includes(a.id))
  assert(tree.items.every((c: any) => !c.isMine))
  const ownTree = await read(a.headers)
  assert.equal(ownTree.items.find((c: any) => c.id === old).replies[0].isMine, true)
  const denied = await app.inject({ method: 'DELETE', url: `/api/comments/${mine.id}`, headers: a.headers })
  assert.equal(denied.statusCode, 403)
  const deleted = await app.inject({ method: 'DELETE', url: `/api/comments/${mine.id}`, headers: owner.headers })
  assert.equal(deleted.statusCode, 200, deleted.body)
  await pool.query("update comments set status='removed' where author_id=$1", [a.id])
  const again = await send(a, { body: '删除后复用', anonymous: true })
  assert.equal(again.author, first.author)
  const cross = await send(b, { body: '另一帖', anonymous: true }, otherPost)
  assert.equal(cross.author, '匿名同学 01')
  const normal = await send(a, { body: '实名' }, otherPost)
  assert.equal(normal.authorId, a.id)
  assert.equal(normal.anonymous, false)
  // The current client always includes this flag, even for ordinary comments.
  const explicitNormal = await send(a, { body: '显式关闭匿名', anonymous: false }, otherPost)
  assert.equal(explicitNormal.authorId, a.id)
  assert.equal(explicitNormal.anonymous, false)
  // Existing comments and immediate creation responses follow current profile avatars.
  for (const avatar of [randomUUID(), randomUUID(), null]) {
    await pool.query('update users set avatar_media_id=$1 where id=$2', [avatar, a.id])
    const created = await send(a, { body: '当前头像' }, otherPost)
    assert.equal(created.authorAvatarMediaId, avatar)
    const response = await app.inject({ method: 'GET', url: `/api/posts/${otherPost}/comments` })
    assert.equal(response.json().items.find((c: any) => c.id === normal.id).authorAvatarMediaId, avatar)
    const masked = await send(a, { body: '仍匿名', anonymous: true })
    assert.equal(masked.authorAvatarMediaId, null)
    const publicTree = await read()
    assert.equal(publicTree.items.find((c: any) => c.id === masked.id).authorAvatarMediaId, null)
  }
  await send(a, { body: 'x', anonymous: 'false' }, post, 400)
  await send(a, { body: 'x', parentId: cross.id }, post, 400)
  await send(a, { body: 'x', parentId: mine.id }, post, 400)
  const noAuth = await app.inject({ method: 'POST', url: `/api/posts/${post}/comments`, payload: { body: 'x' } })
  assert.equal(noAuth.statusCode, 401)
  const concurrent = await Promise.all(people.slice(3).flatMap(person =>
    [send(person, { body: '并发首次', anonymous: true }), send(person, { body: '并发复用', anonymous: true })]))
  assert.equal(new Set(concurrent.map(c => c.author)).size, 4)
  for (let i = 0; i < concurrent.length; i += 2) assert.equal(concurrent[i].author, concurrent[i + 1].author)
  const aliases = await pool.query('select number from post_anonymous_identities where post_id=$1', [post])
  assert.equal(aliases.rows.length, 6)
  assert.equal(new Set(aliases.rows.map(r => r.number)).size, 6)
  await pool.query('update posts set allow_anonymous_comments=false where id=$1', [otherPost])
  const before = await pool.query('select count(*)::int as n from comments where post_id=$1', [otherPost])
  await send(a, { body: '禁止匿名', anonymous: true }, otherPost, 403)
  const after = await pool.query('select count(*)::int as n from comments where post_id=$1', [otherPost])
  assert.equal(after.rows[0].n, before.rows[0].n)
  assert.equal((await send(a, { body: '允许实名', anonymous: false }, otherPost)).anonymous, false)
  assert.equal((await send(a, { body: '旧客户端实名' }, otherPost)).anonymous, false)
  // Anonymous posts always allow anonymous participation, even with contradictory stored data.
  await pool.query('update posts set allow_anonymous_comments=false where id=$1', [post])
  assert.equal((await send(a, { body: '匿名帖', anonymous: true })).anonymous, true)
  await pool.query("update posts set status='removed' where id=$1", [post])
  await send(a, { body: '下架' }, post, 404)
  assert.equal(publicCommentIdentity({ author_id: owner.id, author_name: '秘密', is_anonymous: false,
    post_anonymous: true, post_author_id: owner.id, anonymous_number: null }, null).author, '匿名楼主')
  console.log('PASS anonymous comments: migration, alias reuse/deletion/concurrency, thread scope, owner masking, reply targets, ownership and validation')
} finally {
  await app.close()
  await pool.end()
  await setup.query(`drop schema ${schema} cascade`)
  await setup.end()
}
