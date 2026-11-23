/**
 * 048 评论点赞：接口契约。
 *
 * 为什么值得单独一条测试：评论点赞是**写操作**，而它的对象是**可能被软删**的评论
 * （timemap.ts 的 DELETE 只把 status 改成 'removed'）。一旦漏掉 status 校验，
 * 「给一条已删除的评论点赞」就会一次次成功并留下指向空气的互动记录，
 * 而这类缺陷在只测 happy path 的用例里完全看不出来。
 *
 * 只连本地隔离 schema（PROFILE_TEST_DATABASE_URL），不碰任何线上库。
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { buildServer, type ServerDeps } from '../src/index.ts'

const url = process.env.PROFILE_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:15432/postgres'
assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Only an isolated local test schema is allowed')
const schema = 'comment_likes_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema })
const app = buildServer({ db: { pool, status: () => ({ ready: true }), noteFailure: () => 'none' },
  corsOrigins: [], smsSender: { configured: false }, devSink: {}, sessionTtlDays: 30,
} as unknown as ServerDeps)

try {
  await pool.query(`
    create table users(id uuid primary key, display_name text, avatar_media_id uuid, handle text default 'test',
      phone_e164 text, role text default 'student');
    create table sessions(id uuid primary key, user_id uuid, token_hash text, revoked_at timestamptz, expires_at timestamptz);
    create table posts(id uuid primary key, author_id uuid references users(id), is_anonymous boolean default false,
      status text default 'published');
    create table comments(id uuid primary key, post_id uuid references posts(id), author_id uuid references users(id),
      parent_id uuid references comments(id), body text, created_at timestamptz default now(),
      status text default 'published', is_anonymous boolean default false,
      removed_reason text, removed_by uuid, removed_at timestamptz);
    create table post_anonymous_identities(post_id uuid, user_id uuid, number integer, primary key(post_id, user_id));
    create table comment_likes(id uuid primary key, comment_id uuid references comments(id) on delete cascade,
      user_id uuid references users(id) on delete cascade, created_at timestamptz default now(),
      unique(user_id, comment_id));
  `)

  const people = await Promise.all(['楼主', '甲', '乙', '丙'].map(async name => {
    const id = randomUUID(), token = randomUUID() + randomUUID()
    await pool.query('insert into users(id, display_name) values($1,$2)', [id, name])
    await pool.query("insert into sessions(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '1 day')",
      [randomUUID(), id, createHash('sha256').update(token).digest('hex')])
    return { id, headers: { authorization: 'Bearer ' + token } }
  }))
  const [owner, a, b, c] = people
  const post = randomUUID(), removedPost = randomUUID()
  await pool.query("insert into posts(id,author_id) values($1,$2),($3,$2)", [post, owner.id, removedPost])
  const top = randomUUID(), reply = randomUUID(), gone = randomUUID(), goneByPost = randomUUID()
  await pool.query("insert into comments(id,post_id,author_id,body) values($1,$2,$3,'顶层评论')", [top, post, a.id])
  await pool.query("insert into comments(id,post_id,author_id,parent_id,body) values($1,$2,$3,$4,'回复')", [reply, post, b.id, top])
  await pool.query("insert into comments(id,post_id,author_id,body) values($1,$2,$3,'将被删除')", [gone, post, a.id])
  await pool.query("insert into comments(id,post_id,author_id,body) values($1,$2,$3,'挂在下架帖上')", [goneByPost, removedPost, a.id])

  const like = (person: typeof a, id: string) => app.inject({
    method: 'POST', url: `/api/comments/${id}/like`, headers: person.headers, payload: {} })
  const unlike = (person: typeof a, id: string) => app.inject({
    method: 'DELETE', url: `/api/comments/${id}/like`, headers: person.headers })
  const comments = async (person?: typeof a) => {
    const r = await app.inject({ method: 'GET', url: `/api/posts/${post}/comments`, headers: person?.headers })
    assert.equal(r.statusCode, 200, r.body)
    const body = r.json() as { items: Array<{ id: string; likeCount: number; likedByMe: boolean;
      replies: Array<{ id: string; likeCount: number; likedByMe: boolean }> }> }
    const flat = body.items.flatMap(root => [root, ...root.replies])
    return (id: string) => flat.find(item => item.id === id)!
  }

  // 未登录一律 401（与帖子点赞同型）
  assert.equal((await app.inject({ method: 'POST', url: `/api/comments/${top}/like`, payload: {} })).statusCode, 401)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/comments/${top}/like` })).statusCode, 401)

  // 非法 id → 400，不存在的评论 → 404
  assert.equal((await like(a, 'not-a-uuid')).statusCode, 400)
  assert.equal((await like(a, randomUUID())).statusCode, 404)

  // 正常点赞 + 幂等：重复点赞不重复计数
  let r = await like(a, top)
  assert.equal(r.statusCode, 200, r.body)
  assert.deepEqual({ liked: r.json().liked, likeCount: r.json().likeCount, likedByMe: r.json().likedByMe },
    { liked: true, likeCount: 1, likedByMe: true })
  assert.equal((await like(a, top)).json().likeCount, 1)

  // 第二个人点赞 → 计数累加
  assert.equal((await like(b, top)).json().likeCount, 2)

  // 评论树读模型：计数与「我赞过没」逐条正确，回复独立计数
  let find = await comments(b)
  assert.equal(find(top).likeCount, 2)
  assert.equal(find(top).likedByMe, true)
  assert.equal(find(reply).likeCount, 0)
  assert.equal(find(reply).likedByMe, false)
  assert.equal((await comments(c))(top).likedByMe, false, '没赞过的人 likedByMe 必须是 false')
  assert.equal((await comments())(top).likeCount, 2, '未登录也要能看到计数')
  assert.equal((await comments())(top).likedByMe, false, '未登录 likedByMe 必须 false')

  // 取消点赞 + 幂等（没赞过也不报错）
  r = await unlike(a, top)
  assert.equal(r.statusCode, 200, r.body)
  assert.equal(r.json().likeCount, 1)
  assert.equal(r.json().likedByMe, false)
  assert.equal((await unlike(a, top)).json().likeCount, 1)

  // 软删的评论不可再点赞（否则会留下指向空气的互动）
  await pool.query("update comments set status='removed' where id=$1", [gone])
  assert.equal((await like(b, gone)).statusCode, 404)
  // 但可以收回自己已经给出的赞：删除后 comment_likes 行还在，必须留这个出口
  await pool.query('insert into comment_likes(id,comment_id,user_id) values($1,$2,$3)', [randomUUID(), gone, b.id])
  assert.equal((await unlike(b, gone)).json().likeCount, 0)

  // 下架帖下的评论不可点赞（F07 同型：下架帖不再产生互动）
  await pool.query("update posts set status='removed' where id=$1", [removedPost])
  assert.equal((await like(b, goneByPost)).statusCode, 404)

  // 下架帖的评论列表本身不可读
  const removed = await app.inject({ method: 'GET', url: `/api/posts/${removedPost}/comments` })
  assert.equal(removed.statusCode, 404)

  console.log('PASS comment-likes: auth, validation, idempotent like/unlike, per-comment state, soft-deleted comment, removed post')
} finally {
  await app.close(); await pool.end()
  await setup.query(`drop schema ${schema} cascade`); await setup.end()
}
