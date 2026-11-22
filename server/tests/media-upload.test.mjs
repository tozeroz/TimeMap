/** Run after build. Real multipart parsing and image probing; no DB or disk writes. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { buildServer } from '../dist/index.mjs'

const userId=randomUUID(), mediaId=randomUUID()
const app=buildServer({db:{status:()=>({ready:true}),noteFailure:()=> 'none',pool:{
  async query(sql) {
    if(sql.includes('from sessions'))return {rows:[{session_id:randomUUID(),user_id:userId,display_name:'管理员',handle:'admin',role:'admin'}]}
    if(sql.includes('upload_request_id'))return {rows:[{id:mediaId,storage_key:'existing.jpg',mime:'image/jpeg'}]}
    throw new Error('Unexpected database query: '+sql)
  },
}},corsOrigins:[],smsSender:{configured:false},devSink:{},sessionTtlDays:30})

const jpeg=readFileSync(new URL('../../assets/training-projects/foodtime-neo/logo.jpg',import.meta.url))
function form(bytes,{fileFirst=false,purpose='activity',requestId=randomUUID()}={}) {
  const boundary='upload-test-'+randomUUID()
  const field=(name,value)=>Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  const file=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),bytes,Buffer.from('\r\n')])
  const metadata=[field('purpose',purpose),...(requestId?[field('uploadRequestId',requestId)]:[])]
  return {method:'POST',url:'/api/media',headers:{authorization:'Bearer '+'a'.repeat(32),'content-type':'multipart/form-data; boundary='+boundary},payload:Buffer.concat([...(fileFirst?[file,...metadata]:[...metadata,file]),Buffer.from(`--${boundary}--\r\n`)])}
}
try {
  for(const fileFirst of [false,true]) {
    for(const bytes of [jpeg,Buffer.concat([jpeg,Buffer.from([0,0,0xff,0x20,0x0d,0x0a])])]) {
      const response=await app.inject(form(bytes,{fileFirst}))
      assert.equal(response.statusCode,200,response.body)
      assert.equal(response.json().id,mediaId)
      assert.equal(response.json().scope,'public')
    }
    const privateUpload=await app.inject(form(jpeg,{fileFirst,purpose:'chat'}))
    assert.equal(privateUpload.statusCode,200,privateUpload.body)
    assert.equal(privateUpload.json().scope,'private','Late purpose must not default to public')
  }
  const malformed=await app.inject(form(jpeg.subarray(0,jpeg.length-2)))
  assert.equal(malformed.statusCode,400);assert.equal(malformed.json().error,'not_an_image')
  const appended=await app.inject(form(Buffer.concat([jpeg,Buffer.from('<script>invalid</script>')])))
  assert.equal(appended.statusCode,400)
  const empty=await app.inject(form(Buffer.alloc(0)))
  assert.equal(empty.statusCode,400);assert.equal(empty.json().error,'empty_file')
  const missing=await app.inject(form(jpeg,{fileFirst:true,requestId:null}))
  assert.equal(missing.statusCode,400);assert.equal(missing.json().error,'missing_upload_request_id')
  const oversized=await app.inject(form(Buffer.alloc(5*1024*1024+1)))
  assert.equal(oversized.statusCode,413,oversized.body)
  const anonymous=form(jpeg);delete anonymous.headers.authorization
  assert.equal((await app.inject(anonymous)).statusCode,401)
  console.log('PASS media upload: JPEG/padded JPEG, both multipart orders, private scope, corrupt/empty/oversized files and authentication')
} finally {await app.close()}
