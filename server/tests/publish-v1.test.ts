import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { buildServer } from '../src/index.ts'
import type { ServerDeps } from '../src/index.ts'
import { registerCutoutRoutes } from '../src/cutout.ts'
import Fastify from 'fastify'

const owner = randomUUID(), placeId = randomUUID(), mediaId = randomUUID(), mapId = randomUUID()
let mapOwner: string | undefined
const posts = new Map<string, { id: string }>()
let inserts = 0, mediaMime = 'image/png', mediaOwner = owner
async function query(sql: string, values: unknown[] = []) {
  let rows: unknown[] = []
  if (sql.includes('from sessions')) rows = [{session_id:randomUUID(),user_id:owner,handle:'test',display_name:'测试',role:'student'}]
  else if (sql.includes('select id from posts where client_request_id')) rows = posts.has(String(values[0])) ? [posts.get(String(values[0]))] : []
  else if (sql.includes('select name, enabled from places')) rows = [{name:'图书馆',enabled:true}]
  else if (sql.includes('select id, owner_user_id, scope, mime')) rows = (values[0] as string[]).map(id=>({id,owner_user_id:id===mapId ? mapOwner ?? owner : mediaOwner,scope:'public',mime:mediaMime}))
  else if (sql.includes('insert into posts')) {
    inserts++
    const post={id:String(values[0]),author_name:'测试',author_id:owner,body:values[3],place:'图书馆',created_at:new Date(),image_mode:values[7]}
    posts.set(String(values[6]),post);rows=[post]
  }
  return {rows}
}
const db = { pool:{query,connect:async()=>({query,release(){}})},status:()=>({ready:true}),noteFailure:()=> 'transient' }
const app = buildServer({db,loginRequestMax:5,loginWindowSeconds:300,loginVerifyMaxAttempts:5,corsOrigins:[],smsSender:{configured:false},devSink:{},sessionTtlDays:30} as unknown as ServerDeps)
const submit = (payload: unknown) => app.inject({method:'POST',url:'/api/posts',headers:{authorization:'Bearer test-token-0000000000000000'},payload})
assert.equal((await submit({body:'  ',placeId})).statusCode,400)
assert.equal((await submit({body:'😀'.repeat(501),placeId})).statusCode,400)
assert.equal((await submit({body:'text',placeId,mediaIds:[mediaId,randomUUID()]})).statusCode,400)
assert.equal((await submit({body:'text',placeId:'',mediaIds:[]})).statusCode,400)
const key=randomUUID()
const image=await submit({body:'',placeId,mediaIds:[mediaId],imageMode:'sticker',clientRequestId:key})
assert.equal(image.statusCode,201,image.body)
assert.equal(image.json().imageMode,'sticker')
const replay=await submit({body:'',placeId,mediaIds:[mediaId],imageMode:'sticker',clientRequestId:key})
assert.equal(replay.statusCode,200)
assert.equal(replay.json().id,image.json().id)
assert.equal(inserts,1)
mediaMime='audio/webm'
assert.equal((await submit({body:'text',placeId,mediaIds:[mediaId]})).statusCode,400)
mediaMime='image/jpeg'
assert.equal((await submit({body:'text',placeId,mediaIds:[mediaId],imageMode:'sticker'})).statusCode,400)
mediaOwner=randomUUID()
assert.equal((await submit({body:'text',placeId,mediaIds:[mediaId]})).statusCode,403)
const unicode=await submit({body:'😀'.repeat(500),placeId,clientRequestId:randomUUID()})
assert.equal(unicode.statusCode,201)
mediaOwner=owner;mediaMime='image/png'
assert.equal((await submit({body:'text',placeId,mapMediaId:mapId})).statusCode,400)
assert.equal((await submit({body:'text',placeId,mediaIds:[mediaId],mapMediaId:mediaId})).statusCode,400)
mapOwner=randomUUID()
assert.equal((await submit({body:'text',placeId,mediaIds:[mediaId],mapMediaId:mapId})).statusCode,403)
mapOwner=owner
const captionPost=await submit({body:'text',placeId,mediaIds:[mediaId],mapMediaId:mapId})
assert.equal(captionPost.statusCode,201,captionPost.body)
assert.equal(captionPost.json().mapMediaId,mapId)
await app.close()

// Paid calls are not made in tests. Verify service-off, cache, ownership and pending semantics.
let jobs: any[]=[]
const cutoutApp=Fastify()
registerCutoutRoutes(cutoutApp,{pool:{query:async()=>({rows:jobs})}} as any,'unused',async()=>owner)
const cutout=()=>cutoutApp.inject({method:'POST',url:'/api/media/cutout',payload:{mediaId,requestId:randomUUID()}})
const oldKey=process.env.BAIDU_CUTOUT_API_KEY
process.env.BAIDU_CUTOUT_API_KEY=''
assert.equal((await cutout()).statusCode,503)
jobs=[{owner_id:owner,media_id:mediaId,status:'done',result_base64:'fixture'}]
assert.equal((await cutout()).json().dataUrl,'data:image/png;base64,fixture')
jobs=[{owner_id:owner,media_id:mediaId,status:'processing',created_at:new Date()}]
assert.equal((await cutout()).statusCode,409)
jobs=[{owner_id:randomUUID(),media_id:mediaId,status:'done'}]
assert.equal((await cutout()).statusCode,403)
if(oldKey===undefined) delete process.env.BAIDU_CUTOUT_API_KEY
else process.env.BAIDU_CUTOUT_API_KEY=oldKey
await cutoutApp.close()
console.log('PASS: 18 backend cases (content, ownership, media type, Unicode limit, idempotency, map image validation/ownership, cutout configuration/cache/pending)')
