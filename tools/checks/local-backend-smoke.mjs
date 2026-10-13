import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
const api='http://127.0.0.1:3002'
async function json(path,body,token){const response=await fetch(api+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});const result=await response.json();assert(response.ok,`${path}: ${response.status} ${JSON.stringify(result)}`);return result}
const ready=await json('/api/ready');assert.equal(ready.status,'ready');assert.equal(ready.migrations.applied,ready.migrations.expected)
const places=await json('/api/places');assert(places.items.length>0)
const phone='19900000001'
const delivery=await json('/api/auth/request-code',{phone});assert.equal(delivery.delivery,'dev-sink')
const code=JSON.parse(fs.readFileSync('.local/login-codes/latest.json','utf8')).code
const session=await json('/api/auth/verify-code',{phone,code});assert(session.token)
fs.writeFileSync('.local/test-session.json',JSON.stringify(session))
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWQAAAABJRU5ErkJggg==','base64')
const form=new FormData();form.append('purpose','post');form.append('uploadRequestId',crypto.randomUUID());form.append('file',new Blob([png],{type:'image/png'}),'local-test.png')
const uploaded=await fetch(api+'/api/media',{method:'POST',headers:{authorization:`Bearer ${session.token}`},body:form});const media=await uploaded.json();assert(uploaded.ok,JSON.stringify(media))
const input={body:'',placeId:places.items[0].id,mediaIds:[media.id],clientRequestId:crypto.randomUUID(),imageMode:'photo'}
const post=await json('/api/posts',input,session.token);const replay=await json('/api/posts',input,session.token);assert.equal(post.id,replay.id)
const image=await fetch(api+'/api/media/'+media.id);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert(Buffer.from(await image.arrayBuffer()).equals(png))
const detail=await json('/api/posts/'+post.id,undefined,session.token);assert.equal(detail.body,'');assert.equal(detail.images[0].id,media.id)
fs.writeFileSync('.local/local-smoke-result.json',JSON.stringify({postId:post.id,mediaId:media.id,ready,passed:true},null,2))
console.log(`PASS: real local database (${ready.migrations.applied} migrations), dev-sink login, upload, pure-image post, idempotent retry, image delivery, post detail. No cutout service invoked.`)
