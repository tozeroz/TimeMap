import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import Fastify from 'fastify'
import { registerInboxRoutes } from '../src/inboxRoutes.ts'
import type { TimemapCtx } from '../src/timemap.ts'

const url = process.env.PROFILE_TEST_DATABASE_URL || 'postgresql://postgres@127.0.0.1:15432/postgres'
assert(['localhost','127.0.0.1'].includes(new URL(url).hostname), 'Only an isolated local test schema is allowed')
const schema = 'inbox_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema })
const app = Fastify()
const owner = randomUUID(), other = randomUUID(), post = randomUUID(), thread = randomUUID(), group = randomUUID()
registerInboxRoutes({ app, db: { pool, noteFailure: () => 'none' },
  resolveSession: async auth => auth === 'none' ? { kind: 'none' } : { kind: 'ok', user: { userId: auth === 'other' ? other : owner, role: auth === 'admin' ? 'admin' : 'student' } },
  dbUnavailable: () => ({ error: 'unavailable' }),
} as unknown as TimemapCtx)
const request = async (method: 'GET'|'POST', path: string, auth = 'student', payload?: object) => app.inject({ method, url: path, headers: { authorization: auth }, payload })
try {
  await pool.query(`
    create table users(id uuid primary key,display_name text,avatar_media_id uuid);
    create table posts(id uuid primary key,author_id uuid,body text,status text default 'published');
    create table likes(id uuid primary key,post_id uuid,user_id uuid,created_at timestamptz default now());
    create table favorites(like likes including defaults);
    create table comments(id uuid primary key,post_id uuid,author_id uuid,parent_id uuid,body text,
      created_at timestamptz default now(),is_anonymous boolean default false,status text default 'published');
    create table comment_likes(id uuid primary key,comment_id uuid,user_id uuid,created_at timestamptz default now());
    create table message_threads(id uuid primary key,kind text);
    create table thread_members(thread_id uuid,user_id uuid,joined_at timestamptz default '2000-01-01',last_read_seq bigint default 0);
    create table messages(id uuid primary key,thread_id uuid,sender_id uuid,body text,thread_seq bigint default 1,created_at timestamptz default now(),deleted_at timestamptz,mentions_all boolean default false);
    create table message_mentions(message_id uuid,mentioned_user_id uuid);
  `)
  await pool.query(readFileSync(new URL('../src/migrations/045_inbox.sql',import.meta.url),'utf8'))
  await pool.query("insert into users values($1,'本人',null),($2,'其他同学',$3)",[owner,other,randomUUID()])
  await pool.query("insert into posts values($1,$2,'校园记录','published')",[post,owner])
  await pool.query('insert into likes(id,post_id,user_id) values($1,$2,$3),($4,$2,$5)',[randomUUID(),post,other,randomUUID(),owner])
  await pool.query('insert into favorites(id,post_id,user_id) values($1,$2,$3)',[randomUUID(),post,other])
  await pool.query("insert into comments(id,post_id,author_id,body,is_anonymous) values($1,$2,$3,'匿名评论',true)",[randomUUID(),post,other])
  // 048：别人赞了「本人」的评论 → 应该有一条通知；本人自赞自己的评论 → 不发通知。
  const ownerComment = randomUUID()
  await pool.query("insert into comments(id,post_id,author_id,body) values($1,$2,$3,'我自己的评论')",[ownerComment,post,owner])
  await pool.query('insert into comment_likes(id,comment_id,user_id) values($1,$2,$3),($4,$5,$6)',
    [randomUUID(),ownerComment,other,randomUUID(),ownerComment,owner])
  await pool.query("insert into message_threads values($1,'direct'),($2,'group')",[thread,group])
  await pool.query('insert into thread_members(thread_id,user_id) values($1,$2),($1,$3),($4,$2)',[thread,owner,other,group])
  await pool.query("insert into messages(id,thread_id,sender_id,body,mentions_all) values($1,$2,$3,'私信',false),($4,$5,$3,'所有人',true)",[randomUUID(),thread,other,randomUUID(),group])
  assert.equal((await request('GET','/api/inbox','none')).statusCode,401)
  assert.equal((await request('POST','/api/admin/announcements','student',{title:'公告',body:'正文'})).statusCode,403)
  assert.equal((await request('POST','/api/admin/announcements','admin',{title:' ',body:'正文'})).statusCode,400)
  assert.equal((await request('POST','/api/admin/announcements','admin',{title:'使用指南更新',body:'第一行\n第二行'})).statusCode,201)
  const response = await request('GET','/api/inbox')
  assert.equal(response.statusCode,200,response.body)
  const first = response.json()
  // 048：评论点赞与帖子点赞同属 likes 分类 → 1（帖子赞）+ 1（评论赞）= 2
  assert.deepEqual(first.counts,{likes:2,favorites:1,comments:2})
  assert.equal(first.threads[0].unreadCount,1)
  assert.equal(first.announcements[0].unread,true)
  const anonymous = first.items.find((e: {preview:string}) => e.preview==='匿名评论')
  assert.equal(anonymous.actor,'匿名同学'); assert.equal(anonymous.avatarMediaId,null)
  // 评论点赞：文案与帖子点赞区分开，但落在同一个分类里；自赞不产生通知。
  const commentLikes = first.items.filter((e:{action:string}) => e.action==='赞了你的评论')
  assert.equal(commentLikes.length,1)
  assert.equal(commentLikes[0].category,'likes')
  assert.equal(commentLikes[0].postId,post)
  assert.equal(commentLikes[0].preview,'我自己的评论')
  assert.equal((await request('POST','/api/inbox/read','other',{scope:`thread:${group}`,through:first.through})).statusCode,404)
  assert.equal((await request('POST','/api/inbox/read','student',{scope:'all',through:'2999-01-01'})).statusCode,400)
  assert.equal((await request('POST','/api/inbox/read','student',{scope:'all',through:first.through})).statusCode,200)
  let result = (await request('GET','/api/inbox')).json()
  assert.deepEqual(result.counts,{likes:0,favorites:0,comments:0}); assert.equal(result.threads[0].unreadCount,0)
  assert.equal(result.announcements[0].unread,false)
  // New interactions after the snapshot stay unread, including when an older read is replayed.
  await pool.query("insert into comments(id,post_id,author_id,body) values($1,$2,$3,'新评论')",[randomUUID(),post,other])
  await request('POST','/api/inbox/read','student',{scope:'all',through:first.through})
  result = (await request('GET','/api/inbox')).json()
  assert.equal(result.counts.comments,1)
  assert.equal((await request('GET','/api/inbox','other')).json().counts.likes,0)
  await pool.query("update posts set status='removed' where id=$1",[post])
  result = (await request('GET','/api/inbox')).json()
  assert(!result.items.some((e:{postId:string}) => e.postId===post))
  // 048：评论被作者软删（status='removed'）后，它的点赞也要从消息中心消失 —— 否则
  // 会留下一条点开就跳空的互动（删除是软删，comment_likes 行还在）。
  await pool.query("update posts set status='published' where id=$1",[post])
  await pool.query("update comments set status='removed' where id=$1",[ownerComment])
  result = (await request('GET','/api/inbox')).json()
  assert(!result.items.some((e:{action:string}) => e.action==='赞了你的评论'))
  console.log('PASS inbox: real SQL, self exclusion, anonymous privacy, administrator publication, membership, read snapshots, removed posts, comment likes (048)')
} finally { await app.close(); await pool.end(); await setup.query(`drop schema ${schema} cascade`); await setup.end() }
