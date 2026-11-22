import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import Fastify from 'fastify'
import { registerMapRoutes } from '../src/mapRoutes.ts'
import type { Db } from '../src/db.ts'
const url=process.env.MAP_TEST_DATABASE_URL
assert(url&&['127.0.0.1','localhost'].includes(new URL(url).hostname),'Use an isolated local test database')
const schema='discovery_test_'+randomUUID().replaceAll('-','')
const setup=new pg.Pool({connectionString:url});await setup.query(`create schema ${schema}`)
const pool=new pg.Pool({connectionString:url,options:'-c search_path='+schema})
const app=Fastify({logger:{level:'error'}})
registerMapRoutes(app,{pool,noteFailure:()=> 'none'} as unknown as Db)
try{
  await pool.query(`
    create table users(id uuid primary key,display_name text,avatar_media_id uuid);
    create table campuses(id uuid primary key,school_id uuid);
    create table places(id uuid primary key,name text,address text,latitude numeric,longitude numeric,category text default '校园地标',enabled boolean default true,sort_order int default 0,description text);
    create table posts(id uuid primary key,author_id uuid,author_name text default '同学',is_anonymous boolean default false,allow_anonymous_comments boolean default true,open_count int default 0,body text,place text,place_id uuid,created_at timestamptz default now(),image_mode text default 'photo',status text default 'published',school_campus_id uuid);
    create table likes(post_id uuid,user_id uuid);
    create table favorites(post_id uuid,user_id uuid);
    create table comments(post_id uuid,status text);
    create table media(id uuid primary key,width int,height int,scope text,mime text);
    create table post_media(post_id uuid,media_id uuid,purpose text,position int);
  `)
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
  console.log('PASS map discovery: full counts, filtering, range/nearby, stable pagination, sorting, search, anonymous/avatar privacy, disabled/removed/private media and malformed queries')
}finally{await app.close();await pool.end();await setup.query(`drop schema ${schema} cascade`);await setup.end()}
