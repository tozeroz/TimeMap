/** Run only against local PostgreSQL; creates and drops its own isolated schema. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import pg from 'pg'
import { registerProfileRoutes } from '../src/profileRoutes.ts'
import type { Db } from '../src/db.ts'

const url = process.env.PROFILE_TEST_DATABASE_URL
assert(url, 'Set PROFILE_TEST_DATABASE_URL to a local test database')
assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Only local PostgreSQL is allowed')
const schema = 'profile_test_' + randomUUID().replaceAll('-', '')
const setup = new pg.Pool({ connectionString: url })
await setup.query(`create schema ${schema}`)
const pool = new pg.Pool({ connectionString: url, options: '-c search_path=' + schema + ',public' })
const app = Fastify()
try {
  await pool.query(`
    create table schools(id uuid primary key, name text not null);
    create table campuses(id uuid primary key, school_id uuid references schools(id), name text);
    create table colleges(id uuid primary key, school_id uuid references schools(id), name text, sort_order int default 0);
    create table media(id uuid primary key, owner_user_id uuid, scope text, mime text, unique(id,scope));
    create table users(id uuid primary key, display_name text, school_campus_id uuid references campuses(id), updated_at timestamptz default now());
  `)
  const [a,b,school,otherSchool,campus,otherCampus,college,otherCollege,avatar,foreignAvatar,privateAvatar,audio] = Array.from({length:12},()=>randomUUID())
  await pool.query('insert into schools values($1,$2),($3,$4)',[school,'北京交通大学',otherSchool,'其他学校'])
  await pool.query('insert into campuses values($1,$2,$3),($4,$5,$6)',[campus,school,'校本部',otherCampus,otherSchool,'其他校区'])
  await pool.query('insert into colleges values($1,$2,$3,0),($4,$5,$6,0)',[college,school,'学院一',otherCollege,otherSchool,'其他学院'])
  await pool.query('insert into users(id,display_name,school_campus_id) values($1,$2,$3),($4,$5,null)',[a,'用户A',campus,b,'用户B'])
  const migration = readFileSync(new URL('../src/migrations/030_user_profiles.sql',import.meta.url),'utf8')
  await pool.query('begin');await pool.query(migration);await pool.query('commit')
  assert.equal((await pool.query('select profile_school_id from users where id=$1',[a])).rows[0].profile_school_id,school)
  assert.equal((await pool.query('select profile_school_id from users where id=$1',[b])).rows[0].profile_school_id,null)
  await pool.query(`insert into media values($1,$2,'public','image/png'),($3,$4,'public','image/png'),($5,$2,'private','image/png'),($6,$2,'public','audio/webm')`,[avatar,a,foreignAvatar,b,privateAvatar,audio])
  registerProfileRoutes({app,db:{pool,noteFailure:()=> 'none'} as unknown as Db,resolveSession:async auth=>auth==='Bearer a'||auth==='Bearer b'?{kind:'ok',user:{sessionId:randomUUID(),userId:auth==='Bearer a'?a:b,handle:'test',displayName:'test',phone:null,role:'student'}}:{kind:'none'},unauthorized:reply=>{reply.code(401);return{error:'unauthorized'}},dbUnavailable:reply=>{reply.code(503);return{error:'unavailable'}}},school)
  const request=(method:'GET'|'PATCH',payload?:unknown,token='a',path=method==='GET'?'/api/users/me/profile':'/api/users/me')=>app.inject({method,url:path,headers:token?{authorization:'Bearer '+token}:{},...(payload!==undefined?{payload:payload as object}:{})})
  assert.equal((await request('GET',undefined,'')).statusCode,401)
  assert.equal((await request('PATCH',{displayName:'hack'},'')).statusCode,401)
  let r=await request('GET');assert.equal(r.statusCode,200,r.body);assert.equal(r.json().school.id,school);assert.equal(r.json().options.campuses.length,1)
  const update={displayName:' 新昵称 ',bio:' 校园生活 ',avatarMediaId:avatar,campusId:campus,collegeId:college,enrollmentYear:2026}
  r=await request('PATCH',update);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().displayName,'新昵称');assert.equal(r.json().bio,'校园生活');assert.equal(r.json().avatarMediaId,avatar)
  assert.equal((await request('GET')).json().enrollmentYear,2026)
  assert.equal((await request('GET',undefined,'b')).json().avatarMediaId,null)
  for(const invalid of [{collegeId:otherCollege},{campusId:otherCampus},{avatarMediaId:foreignAvatar},{avatarMediaId:privateAvatar},{avatarMediaId:audio},{avatarMediaId:randomUUID()},{enrollmentYear:2101},{enrollmentYear:'2026'},{bio:'长'.repeat(161)},{displayName:' '},{userId:b},{schoolId:otherSchool},{campusId:'bad'}]){
    r=await request('PATCH',{displayName:'不能部分保存',...invalid});assert.equal(r.statusCode,400,r.body);assert.equal((await request('GET')).json().displayName,'新昵称')
  }
  r=await request('PATCH',{displayName:'旧客户端'});assert.deepEqual(r.json(),{id:a,displayName:'旧客户端'})
  r=await request('PATCH',{bio:'',avatarMediaId:null,campusId:null,collegeId:null,enrollmentYear:null});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().bio,'');assert.equal(r.json().campusId,null);assert.equal(r.json().avatarMediaId,null)
  await assert.rejects(pool.query('update users set college_id=$1,profile_school_id=$2 where id=$3',[otherCollege,school,a]),/foreign key/)
  await assert.rejects(pool.query('update users set bio=$1 where id=$2',['长'.repeat(161),a]),/check constraint/)
  const results=await Promise.all([request('PATCH',{bio:'并发简介'}),request('PATCH',{enrollmentYear:2025})]);assert.ok(results.every(response=>response.statusCode===200));const saved=(await request('GET')).json();assert.equal(saved.bio,'并发简介');assert.equal(saved.enrollmentYear,2025)
  console.log('PASS profile PostgreSQL: migration/backfill, read/write/reload, ownership/auth, school consistency, invalid payload atomicity, image constraints, clear optional values, old nickname clients and concurrent partial updates.')
} finally {
  await app.close();await pool.end();assert(/^profile_test_[a-f0-9]+$/.test(schema));await setup.query(`drop schema ${schema} cascade`);await setup.end()
}
