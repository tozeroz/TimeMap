import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import Fastify from 'fastify'
import { registerMapRoutes } from '../src/mapRoutes.ts'
import type { Db } from '../src/db.ts'
import { registerCurationRoutes } from '../src/curationRoutes.ts'
import { readFileSync } from 'node:fs'
const url=process.env.MAP_TEST_DATABASE_URL
assert(url&&['127.0.0.1','localhost'].includes(new URL(url).hostname),'Use an isolated local test database')
const schema='discovery_test_'+randomUUID().replaceAll('-','')
const setup=new pg.Pool({connectionString:url});await setup.query(`create schema ${schema}`)
const pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema})
const app=Fastify({logger:{level:'error'}})
registerMapRoutes(app,{pool,noteFailure:()=> 'none'} as unknown as Db)
const adminId=randomUUID()
registerCurationRoutes({app,db:{pool,noteFailure:()=> 'none'} as unknown as Db,
  resolveSession:async auth=>auth==='admin'?{kind:'ok',user:{userId:adminId,role:'admin'} as any}:auth==='student'?{kind:'ok',user:{userId:adminId,role:'student'} as any}:{kind:'none'},
  unauthorized:reply=>reply.code(401),dbUnavailable:reply=>reply.code(503)})
try{
  await pool.query(`
    create table users(id uuid primary key,display_name text,avatar_media_id uuid);
    create table campuses(id uuid primary key,school_id uuid);
    create table places(id uuid primary key,name text,address text,latitude numeric,longitude numeric,category text default '校园地标',enabled boolean default true,sort_order int default 0,description text);
    create table posts(id uuid primary key,author_id uuid,author_name text default '同学',is_anonymous boolean default false,allow_anonymous_comments boolean default true,open_count int default 0,body text,place text,place_id uuid,created_at timestamptz default now(),image_mode text default 'photo',status text default 'published',removed_reason text,school_campus_id uuid);
    create table likes(post_id uuid,user_id uuid);
    create table favorites(post_id uuid,user_id uuid);
    create table comments(post_id uuid,status text);
    create table media(id uuid primary key,width int,height int,scope text,mime text);
    create table post_media(post_id uuid,media_id uuid,purpose text,position int);
    create table audit_log(id uuid,actor_id uuid,action text,target_type text,target_id uuid,reason text);
  `)
  await pool.query("insert into users values($1,'管理员',null)",[adminId])
  await pool.query(readFileSync(new URL('../src/migrations/047_map_curation.sql',import.meta.url),'utf8'))
  const a=randomUUID(),b=randomUUID(),hidden=randomUUID(),owner=randomUUID(),image=randomUUID(),privateImage=randomUUID(),avatar=randomUUID()
  await pool.query("insert into users values($1,'真实姓名',$2)",[owner,avatar])
  await pool.query("insert into places(id,name,latitude,longitude,enabled,description) values($1,'银杏大道',39.9503,116.3396,true,'校园里的银杏步道'),($2,'远处地点',40.9503,117.3396,true,null),($3,'停用地点',39.95,116.34,false,null)",[a,b,hidden])
  await pool.query("insert into media values($1,800,600,'public','image/jpeg'),($2,800,600,'private','image/jpeg')",[image,privateImage])
  const ids=[]
  for(let i=0;i<27;i++){
    const id=randomUUID();ids.push(id)
    await pool.query("insert into posts(id,author_id,body,place_id,created_at,is_anonymous) values($1,$2,$3,$4,now()-($5::int*interval '1 hour'),$6)",[id,owner,`记录${i}`,a,i,i===0])
    if(i%2===0)await pool.query("insert into post_media values($1,$2,'post',0)",[id,image])
  }
  const old=randomUUID(),removed=randomUUID()
  await pool.query("insert into posts(id,body,place_id,created_at,status) values($1,'旧记录',$2,now()-interval '40 days','published'),($3,'已下架',$2,now(),'removed'),($4,'远处记录',$5,now(),'published'),($6,'停用地点的记录',$7,now(),'published')",[old,a,removed,randomUUID(),b,randomUUID(),hidden])
  await pool.query('insert into likes values($1,$2),($1,$3)',[ids[5],randomUUID(),randomUUID()])
  const read=async(query:string)=>{const r=await app.inject('/api/map/discover?bounds=39.94,116.33,39.96,116.35&'+query);assert.equal(r.statusCode,200,r.body);return r.json()}
  const first=await read('')
  assert.equal(first.total,28);assert.equal(first.items.length,20);assert(first.nextCursor)
  assert.equal(first.places.find((p:{id:string})=>p.id===a).postCount,28)
  assert(!first.places.some((p:{id:string})=>p.id===b||p.id===hidden))
  assert.equal(first.items[0].anonymous,true);assert.equal(first.items[0].authorId,null);assert.equal(first.items[0].authorAvatarMediaId,null)
  assert.equal(first.items[1].authorAvatarMediaId,avatar)
  const second=await read('cursor='+encodeURIComponent(first.nextCursor));assert.equal(second.items.length,8);assert.equal(second.nextCursor,null)
  assert.equal(new Set([...first.items,...second.items].map(p=>p.id)).size,28)
  assert.equal((await read('filter=photos')).total,14)
  assert.equal((await read('filter=recent')).total,27)
  assert.equal((await read('q='+encodeURIComponent('旧记录'))).total,1)
  assert.equal((await read('sort=hot')).items[0].id,ids[5])
  await pool.query("insert into comments values($1,'published'),($1,'published'),($2,'removed'),($2,'removed'),($2,'removed')",[ids[4],ids[0]])
  assert.equal((await read('sort=hot')).items[0].id,ids[4],'comments contribute to heat; removed comments do not')
  await pool.query('insert into favorites select $1,unnest($2::uuid[])',[ids[3],Array.from({length:7},()=>randomUUID())])
  await pool.query('insert into likes select $1,unnest($2::uuid[])',[old,Array.from({length:100},()=>randomUUID())])
  const hot=await read('sort=hot')
  assert.equal(hot.items[0].id,ids[3],'favorites contribute to heat')
  assert.equal(hot.total,27,'hot uses a strict seven-day window')
  assert(!hot.items.some((p:{id:string})=>p.id===old),'old highly-liked posts stay out of recent hot')
  assert.equal((await read('')).items[0].id,ids[0],'latest still follows publication time')
  const hotTail=await read('sort=hot&cursor='+encodeURIComponent(hot.nextCursor))
  assert.equal(new Set([...hot.items,...hotTail.items].map(p=>p.id)).size,27,'hot pagination includes fractional/negative age-decay scores without duplication')
  assert.equal((await read('placeId='+a)).total,28)
  const nearby=await app.inject('/api/map/discover?near=39.9503,116.3396,1000')
  assert.equal(nearby.statusCode,200,nearby.body);assert.equal(nearby.json().total,28)
  assert(!nearby.json().places.some((p:{id:string})=>p.id===b))
  assert.equal((await read('category='+encodeURIComponent('食堂'))).total,0)
  for(const q of ['filter=story','bounds=0,0,0,0','near=1,2,0','limit=500','cursor=bad','q='+ 'x'.repeat(101)])assert.equal((await app.inject('/api/map/discover?'+q)).statusCode,400,q)
  assert.equal((await app.inject('/api/map/discover?filter=photos&cursor='+encodeURIComponent(first.nextCursor))).statusCode,400)
  // A public post with only private media must not enter the image filter.
  const textId=ids[1];await pool.query("insert into post_media values($1,$2,'post',0)",[textId,privateImage])
  assert.equal((await read('filter=photos')).total,14)
  await pool.query("update posts set status='removed' where id=$1",[ids[0]])
  assert.equal((await read('')).total,27)
  const adminRequest=async(method:'GET'|'PUT',url:string,payload?:unknown)=>app.inject({method,url,headers:{authorization:'admin'},payload})
  assert.equal((await app.inject('/api/admin/curation/posts')).statusCode,401)
  assert.equal((await app.inject({url:'/api/admin/curation/places',headers:{authorization:'student'}})).statusCode,403)
  assert.equal((await app.inject({method:'PUT',url:`/api/admin/curation/posts/${old}/story`,payload:{enabled:true},headers:{authorization:'student'}})).statusCode,403)
  const mark=await adminRequest('PUT',`/api/admin/curation/posts/${old}/story`,{enabled:true});assert.equal(mark.statusCode,200,mark.body)
  await adminRequest('PUT',`/api/admin/curation/posts/${old}/story`,{enabled:true})
  assert.equal((await pool.query("select * from audit_log where action='story_set'")).rowCount,1,'retries do not duplicate story audit')
  assert.equal((await read('filter=stories')).items[0].id,old,'old stories do not expire after seven days')
  assert.equal((await read('filter=stories&sort=hot')).total,1)
  const adminStories=await adminRequest('GET','/api/admin/curation/posts?story=yes');assert.equal(adminStories.statusCode,200,adminStories.body);assert.equal(adminStories.json().items.length,1)
  const allAdmin=await adminRequest('GET','/api/admin/curation/posts?limit=10')
  const adminTail=await adminRequest('GET','/api/admin/curation/posts?limit=10&cursor='+encodeURIComponent(allAdmin.json().nextCursor));assert.equal(adminTail.statusCode,200,adminTail.body)
  assert.equal(new Set([...allAdmin.json().items,...adminTail.json().items].map((p:any)=>p.id)).size,20)
  await adminRequest('PUT',`/api/admin/curation/posts/${old}/story`,{enabled:false});assert.equal((await read('filter=stories')).total,0)
  assert.equal((await adminRequest('PUT',`/api/admin/curation/posts/${removed}/story`,{enabled:true})).statusCode,409)
  const chosen={active:true,description:'真实维护说明',version:0,photos:[{postId:ids[2],mediaId:image}]}
  let saved=await adminRequest('PUT',`/api/admin/curation/places/${a}`,chosen);assert.equal(saved.statusCode,200,saved.body)
  assert.equal((await adminRequest('PUT',`/api/admin/curation/places/${a}`,chosen)).statusCode,409,'stale versions cannot overwrite')
  let cards=await read('filter=checkins');assert.equal(cards.totalKind,'places');assert.equal(cards.total,1);assert.equal(cards.items.length,1);assert.equal(cards.places[0].name,'银杏大道');assert.equal(cards.items[0].images[0].id,image)
  assert.equal((await read('filter=checkins&category='+encodeURIComponent('食堂'))).total,0)
  assert.equal((await adminRequest('GET',`/api/admin/curation/places/${a}`)).json().photos[0].valid,true)
  assert.equal((await adminRequest('PUT',`/api/admin/curation/places/${a}`,{...chosen,version:1,photos:[{postId:ids[1],mediaId:privateImage}]})).statusCode,409,'private images cannot be selected')
  assert.equal((await adminRequest('PUT',`/api/admin/curation/places/${b}`,chosen)).statusCode,409,'a photo from another place cannot be selected')
  await pool.query("update posts set status='removed' where id=$1",[ids[2]])
  assert.equal((await read('filter=checkins')).total,0,'removed cover invalidates the only public photo')
  assert.equal((await adminRequest('GET',`/api/admin/curation/places/${a}`)).json().photos[0].valid,false)
  await pool.query("update posts set status='published',is_anonymous=true where id=$1",[ids[2]])
  cards=await read('filter=checkins');assert.equal(cards.items[0].authorId,null);assert.equal(cards.items[0].authorAvatarMediaId,null)
  saved=await adminRequest('PUT',`/api/admin/curation/places/${a}`,{...chosen,version:1,active:false});assert.equal(saved.statusCode,200,saved.body)
  assert.equal((await read('filter=checkins')).total,0,'paused places disappear')
  assert.equal((await adminRequest('GET','/api/admin/curation/places?checkin=paused')).json().items.length,1)
  assert.equal((await read('filter=recent')).total,26,'existing recent feed keeps its original scope')
  const two={...chosen,version:2,photos:[{postId:ids[2],mediaId:image},{postId:ids[4],mediaId:image}]}
  const conflict=await Promise.all([adminRequest('PUT',`/api/admin/curation/places/${a}`,two),adminRequest('PUT',`/api/admin/curation/places/${a}`,two)])
  assert.deepEqual(conflict.map(r=>r.statusCode).sort(),[200,409],'concurrent saves preserve exactly one version')
  await pool.query("update posts set status='removed' where id=$1",[ids[2]])
  cards=await read('filter=checkins');assert.equal(cards.total,1);assert.equal(cards.items.length,1);assert.equal(cards.items[0].id,ids[4],'the next valid photo replaces an invalid cover')
  const farPost=(await pool.query('select id from posts where place_id=$1',[b])).rows[0].id
  await pool.query("insert into post_media values($1,$2,'post',0)",[farPost,image])
  saved=await adminRequest('PUT',`/api/admin/curation/places/${b}`,{...chosen,photos:[{postId:farPost,mediaId:image}]});assert.equal(saved.statusCode,200,saved.body)
  const allCheckins=await app.inject('/api/map/discover?filter=checkins&limit=1')
  assert.equal(allCheckins.statusCode,200,allCheckins.body);assert.equal(allCheckins.json().total,2);assert(allCheckins.json().nextCursor)
  const tailCheckins=await app.inject('/api/map/discover?filter=checkins&limit=1&cursor='+encodeURIComponent(allCheckins.json().nextCursor))
  assert.equal(tailCheckins.statusCode,200,tailCheckins.body);assert.notEqual(tailCheckins.json().places[0].id,allCheckins.json().places[0].id)
  assert.equal((await app.inject('/api/map/discover?filter=checkins&q=changed&cursor='+encodeURIComponent(allCheckins.json().nextCursor))).statusCode,400)
  await pool.query('update places set enabled=false where id=$1',[a]);assert.equal((await read('filter=checkins')).total,0,'disabled places disappear')
  console.log('PASS curation: admin permissions, story classification and non-expiry, filtering/pagination, idempotence/audit, check-in versions, public photo ownership, withdrawal, pause and anonymous identity')
  console.log('PASS map discovery: full counts, filtering, range/nearby, stable pagination, sorting, search, anonymous/avatar privacy, disabled/removed/private media and malformed queries')
}finally{await app.close();await pool.end();await setup.query(`drop schema ${schema} cascade`);await setup.end()}
