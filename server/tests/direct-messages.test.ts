import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { buildServer, type ServerDeps } from '../src/index.ts'

const url=process.env.PROFILE_TEST_DATABASE_URL
assert(url,'Set PROFILE_TEST_DATABASE_URL to local PostgreSQL')
assert(['localhost','127.0.0.1'].includes(new URL(url).hostname))
const schema='dm_test_'+randomUUID().replaceAll('-','')
const setup=new pg.Pool({connectionString:url})
await setup.query(`create schema ${schema}`)
const pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema})
const app=buildServer({db:{pool,status:()=>({ready:true}),noteFailure:()=> 'none'},corsOrigins:[],smsSender:{configured:false},devSink:{},sessionTtlDays:30} as unknown as ServerDeps)
try {
  await pool.query(`
    create table users(id uuid primary key,display_name text,avatar_media_id uuid,handle text default 'test',phone_e164 text,role text default 'student');
    create table sessions(id uuid primary key,user_id uuid,token_hash text,revoked_at timestamptz,expires_at timestamptz);
    create table message_threads(id uuid primary key,kind text,title text,created_at timestamptz default now());
    create table thread_members(id uuid primary key,thread_id uuid references message_threads(id) on delete cascade,user_id uuid references users(id),joined_at timestamptz default now(),unique(thread_id,user_id));
    create table messages(id uuid primary key,thread_id uuid references message_threads(id),sender_id uuid references users(id),body text,kind text default 'text',mentions_all boolean default false,deleted_at timestamptz,created_at timestamptz default now());
    create table media(id uuid primary key,owner_user_id uuid,scope text,mime text,width int,height int,duration_ms int);
    create table message_mentions(id uuid primary key,message_id uuid,mentioned_user_id uuid);
    create table message_media(message_id uuid,media_id uuid,media_scope text,position int);
    create table inbox_reads(user_id uuid,scope text,read_at timestamptz,primary key(user_id,scope));
  `)
  const people=await Promise.all(Array.from({length:15},async(_,index)=>{
    const id=randomUUID(),token=randomUUID()+randomUUID()
    await pool.query('insert into users(id,display_name,avatar_media_id) values($1,$2,$3)',[id,'同学'+index,randomUUID()])
    await pool.query("insert into sessions(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '1 day')",[randomUUID(),id,createHash('sha256').update(token).digest('hex')])
    return {id,headers:{authorization:'Bearer '+token}}
  }))
  const [a,b,c]=people
  const legacy=randomUUID(),legacyMessage=randomUUID()
  await pool.query("insert into message_threads(id,kind) values($1,'direct')",[legacy])
  await pool.query('insert into thread_members(id,thread_id,user_id) values($1,$2,$3),($4,$2,$5)',[randomUUID(),legacy,a.id,randomUUID(),b.id])
  await pool.query("insert into messages(id,thread_id,sender_id,body) values($1,$2,$3,'历史私信')",[legacyMessage,legacy,b.id])
  const migration=readFileSync('src/migrations/046_direct_messages.sql','utf8')
  const auditClient=await pool.connect()
  try {
    await auditClient.query('begin')
    const malformed=randomUUID()
    await auditClient.query("insert into message_threads(id,kind) values($1,'direct')",[malformed])
    await assert.rejects(auditClient.query(migration),/audit required/)
    await auditClient.query('rollback')
    await auditClient.query('begin')
    const duplicate=randomUUID()
    await auditClient.query("insert into message_threads(id,kind) values($1,'direct')",[duplicate])
    await auditClient.query('insert into thread_members(id,thread_id,user_id) values($1,$2,$3),($4,$2,$5)',[randomUUID(),duplicate,a.id,randomUUID(),b.id])
    await assert.rejects(auditClient.query(migration),/unique|duplicate/)
    await auditClient.query('rollback')
  } finally {auditClient.release()}
  await pool.query(migration)
  const call=async(person:typeof a,method:'GET'|'POST'|'DELETE',path:string,payload?:object,status=200)=>{
    const result=await app.inject({method,url:path,headers:person.headers,payload})
    assert.equal(result.statusCode,status,result.body);return result.json()
  }
  const open=async(person:typeof a,peer:string)=>{
    const r=await app.inject({method:'POST',url:'/api/threads/direct',headers:person.headers,payload:{peerId:peer}})
    assert([200,201].includes(r.statusCode),r.body);return r.json()
  }
  assert.equal((await open(a,b.id)).id,legacy,'Existing conversations are preserved')
  const opened=await Promise.all([open(a,c.id),open(c,a.id),open(a,c.id),open(c,a.id)])
  const id=opened[0].id
  assert(opened.every(row=>row.id===id),'Concurrent bidirectional creation must reuse a single pair')
  assert.equal((await pool.query('select count(*)::int as n from thread_members where thread_id=$1',[id])).rows[0].n,2)
  assert(!(await call(a,'GET','/api/threads')).items.some((row:any)=>row.id===id),'Empty threads stay hidden')
  await call(a,'POST','/api/threads/direct',{peerId:a.id},400)
  await call(a,'POST','/api/threads/direct',{peerId:randomUUID()},404)
  await call(a,'POST','/api/threads/direct',{peerId:c.id,senderId:b.id},400)
  assert.equal((await app.inject({method:'POST',url:'/api/threads/direct',payload:{peerId:b.id}})).statusCode,401)
  const requestId=randomUUID(),payload={body:'你好',clientRequestId:requestId}
  const responses=await Promise.all(Array.from({length:4},()=>app.inject({method:'POST',url:`/api/threads/${id}/messages`,headers:a.headers,payload})))
  assert(responses.every(r=>[200,201].includes(r.statusCode)),responses.map(r=>r.body).join('\n'))
  assert.equal(new Set(responses.map(r=>r.json().id)).size,1,'Retry creates only one message')
  assert.equal((await pool.query('select count(*)::int as n from messages where thread_id=$1',[id])).rows[0].n,1)
  await call(a,'POST',`/api/threads/${id}/messages`,{...payload,body:'改变内容'},409)
  await call(a,'POST',`/api/threads/${legacy}/messages`,payload,409)
  const list=await call(c,'GET','/api/threads')
  assert.equal(list.items.find((row:any)=>row.id===id).unreadCount,1)
  const detail=await call(c,'GET',`/api/threads/${id}`)
  assert.equal(detail.peer.id,a.id)
  assert(detail.peer.avatarMediaId)
  await call(b,'GET',`/api/threads/${id}`,undefined,404)
  await call(b,'GET',`/api/threads/${id}/messages?paginate=1`,undefined,404)
  await call(b,'POST',`/api/threads/${id}/messages`,{body:'越权'},404)
  await call(b,'POST',`/api/threads/${id}/read`,{throughSeq:'1'},404)
  await call(c,'POST',`/api/threads/${id}/read`,{throughSeq:'99999'},400)
  await call(c,'POST',`/api/threads/${id}/read`,{throughSeq:'1'})
  await call(c,'POST',`/api/threads/${id}/read`,{throughSeq:'0'})
  assert.equal((await call(c,'GET','/api/threads')).items.find((row:any)=>row.id===id).unreadCount,0)
  // Seed 153 messages through the same database allocation trigger used by all clients.
  for(let i=0;i<153;i++)await pool.query("insert into messages(id,thread_id,sender_id,body,created_at) values($1,$2,$3,$4,'2026-01-01 00:00:00.123456+00')",[randomUUID(),id,c.id,'历史'+i])
  const newest=await call(a,'GET',`/api/threads/${id}/messages?paginate=1`)
  assert.equal(newest.items.length,50);assert.equal(newest.items.at(-1).threadSeq,'154')
  const collected=new Set(newest.items.map((row:any)=>row.id))
  let older=newest.olderCursor,hasMore=newest.hasMore
  while(hasMore){const page=await call(a,'GET',`/api/threads/${id}/messages?paginate=1&beforeSeq=${older}`);for(const item of page.items){assert(!collected.has(item.id));collected.add(item.id)}older=page.olderCursor;hasMore=page.hasMore}
  assert.equal(collected.size,154)
  const incremental:string[]=[];let after='0'
  do {const page=await call(a,'GET',`/api/threads/${id}/messages?paginate=1&afterSeq=${after}`);incremental.push(...page.items.map((row:any)=>row.threadSeq));after=page.newerCursor;hasMore=page.hasMore}while(hasMore)
  assert.equal(incremental.length,154);assert.equal(new Set(incremental).size,154)
  await call(a,'GET',`/api/threads/${id}/messages?paginate=1&beforeSeq=1&afterSeq=2`,undefined,400)
  await call(a,'POST',`/api/users/${c.id}/block`)
  await call(c,'POST',`/api/threads/${id}/messages`,{body:'已拉黑'},403)
  await call(a,'POST','/api/threads/direct',{peerId:c.id},403)
  assert.equal((await call(a,'GET',`/api/threads/${id}`)).blockedByMe,true)
  await call(a,'GET',`/api/threads/${id}/messages?paginate=1`)
  await call(a,'DELETE',`/api/users/${c.id}/block`)
  await call(a,'POST',`/api/threads/${id}/messages`,{body:'恢复发送',clientRequestId:randomUUID()},201)
  // Rate limits apply to new messages, not idempotent repeats.
  await pool.query("insert into messages(id,thread_id,sender_id,body) select gen_random_uuid(),$1,$2,'频率' from generate_series(1,20)",[id,a.id])
  await call(a,'POST',`/api/threads/${id}/messages`,{body:'过快',clientRequestId:randomUUID()},429)
  await call(a,'POST',`/api/threads/${id}/messages`,payload)
  // Database-level direct membership guard rejects a third member.
  await assert.rejects(pool.query('insert into thread_members(id,thread_id,user_id) values($1,$2,$3)',[randomUUID(),id,b.id]))
  const media=randomUUID()
  await pool.query("insert into media(id,owner_user_id,scope,mime,width,height) values($1,$2,'private','image/png',80,80)",[media,c.id])
  const image=await call(c,'POST',`/api/threads/${id}/messages`,{body:'[图片]',kind:'image',mediaId:media,clientRequestId:randomUUID()},201)
  assert.equal(image.mediaId,media)
  await call(c,'POST',`/api/threads/${id}/messages`,{body:'[图片]',kind:'image',mediaId:media,senderId:a.id},400)
  // Forged sender fields are rejected; successful messages use the authenticated session.
  assert.equal((await pool.query('select sender_id from messages where thread_id=$1 order by thread_seq desc limit 1',[id])).rows[0].sender_id,c.id)
  const voiceMedia=randomUUID(),voiceRequest=randomUUID()
  await pool.query("insert into media(id,owner_user_id,scope,mime,duration_ms) values($1,$2,'private','audio/webm',1500)",[voiceMedia,c.id])
  const voice=await call(c,'POST',`/api/threads/${id}/messages`,{body:'[语音]',kind:'voice',mediaId:voiceMedia,clientRequestId:voiceRequest},201)
  assert.equal((await call(c,'POST',`/api/threads/${id}/messages`,{body:'[语音]',kind:'voice',mediaId:voiceMedia,clientRequestId:voiceRequest})).id,voice.id)
  await call(b,'POST',`/api/threads/${legacy}/messages`,{body:'[语音]',kind:'voice',mediaId:voiceMedia},400)
  const group=randomUUID()
  await pool.query("insert into message_threads(id,kind,title) values($1,'group','群聊回归')",[group])
  await pool.query('insert into thread_members(id,thread_id,user_id) values($1,$2,$3),($4,$2,$5)',[randomUUID(),group,b.id,randomUUID(),c.id])
  await call(b,'POST',`/api/threads/${group}/messages`,{body:'群聊消息',mentionsAll:true,clientRequestId:randomUUID()},201)
  assert.equal((await call(c,'GET',`/api/threads/${group}/messages?paginate=1`)).items[0].mentionsAll,true)
  await call(b,'POST',`/api/threads/${legacy}/messages`,{body:'私聊不能@全体',mentionsAll:true},400)
  const tooMany=await Promise.all(people.slice(3).map(person=>app.inject({method:'POST',url:'/api/threads/direct',headers:c.headers,payload:{peerId:person.id}})))
  assert(tooMany.some(r=>r.statusCode===429))
  assert(tooMany.filter(r=>r.statusCode===201).length<=10)
  for(let i=0;i<60;i++) {
    const gid=randomUUID()
    await pool.query("insert into message_threads(id,kind,title) values($1,'group','分页群聊')",[gid])
    await pool.query('insert into thread_members(id,thread_id,user_id) values($1,$2,$3)',[randomUUID(),gid,c.id])
  }
  let threadCursor:string|null=null
  const threadIds=new Set<string>()
  do {
    const page=await call(c,'GET','/api/threads?kind=group'+(threadCursor?'&cursor='+encodeURIComponent(threadCursor):''))
    for(const item of page.items){assert.equal(item.kind,'group');assert(!threadIds.has(item.id));threadIds.add(item.id)}
    threadCursor=page.nextCursor
  }while(threadCursor)
  assert.equal(threadIds.size,61)
  assert.equal((await call(b,'GET','/api/threads?kind=group')).items.length,1)
  console.log('PASS direct messages: legacy backfill, concurrent reuse, empty visibility, retries/conflicts, authorization, 154-message paging, reads, blocks, rate limits, media and membership guards')
} finally {
  await app.close();await pool.end();await setup.query(`drop schema ${schema} cascade`);await setup.end()
}
