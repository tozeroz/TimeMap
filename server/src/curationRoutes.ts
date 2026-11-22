import { randomUUID } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { TimemapCtx } from './timemap.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const VALID_CHECKIN_PHOTO = `p.status='published' and p.place_id=cp.place_id and pm.purpose='post' and m.scope='public' and m.mime like 'image/%'`
// Public and admin lists share the same validity predicate; no cached private media references.
export function registerCurationRoutes(ctx: TimemapCtx) {
  const { app, db } = ctx
  async function admin(req: FastifyRequest, reply: any) {
    reply.header('cache-control','private, no-store')
    const s = await ctx.resolveSession(req.headers.authorization)
    if (s.kind !== 'ok') { reply.code(s.kind==='db_down'?503:401).send({error:s.kind==='db_down'?'not_ready':'unauthorized'}); return null }
    if (s.user.role !== 'admin') { reply.code(403).send({error:'forbidden'}); return null }
    return s.user
  }
  function failure(reply: any, error: unknown) {
    if (db.noteFailure(error)==='transient') return ctx.dbUnavailable(reply,error)
    return reply.code(500).send({error:'curation_failed'})
  }
  function params(raw: unknown) {
    const q = raw as Record<string,string>
    if (Object.values(q).some(value=>typeof value!=='string') || (q.q||'').length>100 ||
      q.placeId && !UUID.test(q.placeId)) return null
    const limit=Number(q.limit||30)
    if (!Number.isInteger(limit)||limit<1||limit>50) return null
    let cursor: any = null
    const key=JSON.stringify([q.q||'',q.placeId||'',q.status||'',q.story||'',q.checkin||'',q.photos||''])
    if(q.cursor)try {
      if(q.cursor.length>2000) return null
      cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString())
      if(cursor.key!==key||!UUID.test(cursor.id)||typeof cursor.name!=='string')return null
    }catch{return null}
    return {q,limit,cursor,key}
  }
  function page(rows:any[],p:NonNullable<ReturnType<typeof params>>) {
    const items=rows.slice(0,p.limit),last=items.at(-1)
    return {items,nextCursor:rows.length>p.limit&&last?Buffer.from(JSON.stringify({key:p.key,id:last.id,name:last.cursor_name})).toString('base64url'):null}
  }
  app.get('/api/admin/curation/posts',async(req,reply)=>{
    if(!await admin(req,reply))return
    const p=params(req.query)
    if(!p||p.cursor&&!Number.isFinite(Date.parse(p.cursor.name))||!['all','yes','no',''].includes(p.q.story||'')||!['published','removed','all',''].includes(p.q.status||''))return reply.code(400).send({error:'invalid_query'})
    try {
      const r=await db.pool.query(`select p.id,p.body,p.place_id as "placeId",pl.name as place,p.status,p.is_anonymous as anonymous,
        coalesce(u.display_name,p.author_name) as author,p.created_at as "createdAt",p.removed_reason as "removedReason",
        coalesce(s.enabled,false) as "campusStory",p.created_at::text as cursor_name,
        coalesce((select json_agg(json_build_object('id',m.id,'width',m.width,'height',m.height) order by pm.position)
          from post_media pm join media m on m.id=pm.media_id where pm.post_id=p.id and pm.purpose='post' and m.scope='public' and m.mime like 'image/%'),'[]') as images
        from posts p left join users u on u.id=p.author_id left join places pl on pl.id=p.place_id left join post_story_labels s on s.post_id=p.id
        where ($1='' or position(lower($1) in lower(p.body||' '||coalesce(u.display_name,p.author_name,'')))>0)
          and ($2::uuid is null or p.place_id=$2) and ($3='all' or p.status=$3)
          and ($4='all' or coalesce(s.enabled,false)=($4='yes'))
          and ($5::uuid is null or (p.created_at,p.id)<($8::timestamptz,$5))
          and (not $6::boolean or exists(select 1 from post_media pm join media m on m.id=pm.media_id where pm.post_id=p.id and pm.purpose='post' and m.scope='public' and m.mime like 'image/%'))
        order by p.created_at desc,p.id desc limit $7`,[p.q.q||'',p.q.placeId||null,p.q.status||'published',p.q.story||'all',p.cursor?.id||null,p.q.photos==='1',p.limit+1,p.cursor?.name||null])
      return page(r.rows,p)
    }catch(error){return failure(reply,error)}
  })
  app.put('/api/admin/curation/posts/:id/story',async(req,reply)=>{
    const user=await admin(req,reply);if(!user)return
    const {id}=req.params as {id:string},body=req.body as {enabled?:unknown}
    if(!UUID.test(id)||typeof body?.enabled!=='boolean')return reply.code(400).send({error:'invalid_payload'})
    const client=await db.pool.connect()
    try {
      await client.query('begin')
      const post=await client.query('select status from posts where id=$1 for update',[id])
      if(!post.rowCount){await client.query('rollback');return reply.code(404).send({error:'not_found'})}
      if(body.enabled&&post.rows[0].status!=='published'){await client.query('rollback');return reply.code(409).send({error:'post_not_public'})}
      const result=await client.query(`insert into post_story_labels(post_id,enabled,updated_by) values($1,$2,$3)
        on conflict(post_id) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now()
        where post_story_labels.enabled is distinct from excluded.enabled returning post_id`,[id,body.enabled,user.userId])
      if(result.rowCount)await client.query('insert into audit_log(id,actor_id,action,target_type,target_id,reason) values($1,$2,$3,$4,$5,$6)',[randomUUID(),user.userId,body.enabled?'story_set':'story_unset','post',id,body.enabled?'设为校园故事':'取消校园故事'])
      await client.query('commit');return {ok:true}
    }catch(error){await client.query('rollback');return failure(reply,error)}finally{client.release()}
  })
  app.get('/api/admin/curation/places',async(req,reply)=>{
    if(!await admin(req,reply))return
    const p=params(req.query)
    if(!p||!['all','active','paused','unset',''].includes(p.q.checkin||'')||!['enabled','disabled','all',''].includes(p.q.status||''))return reply.code(400).send({error:'invalid_query'})
    try {
      const r=await db.pool.query(`select pl.id,pl.name,pl.name as cursor_name,pl.enabled,pl.address,c.active,coalesce(c.version,0) as version,coalesce(c.description,'') as description,
        (select count(*)::int from place_checkin_photos cp join posts p on p.id=cp.post_id join post_media pm on pm.post_id=p.id and pm.media_id=cp.media_id join media m on m.id=pm.media_id
          where cp.place_id=pl.id and ${VALID_CHECKIN_PHOTO}) as "validPhotos"
        from places pl left join place_checkins c on c.place_id=pl.id
        where ($1='' or position(lower($1) in lower(pl.name))>0) and ($2='all' or pl.enabled=($2='enabled'))
        and ($3='all' or $3='unset' and c.place_id is null or $3='active' and c.active or $3='paused' and not c.active)
        and ($4::uuid is null or (pl.name,pl.id)>($5,$4)) order by pl.name,pl.id limit $6`,[p.q.q||'',p.q.status||'enabled',p.q.checkin||'all',p.cursor?.id||null,p.cursor?.name||'',p.limit+1])
      return page(r.rows,p)
    }catch(error){return failure(reply,error)}
  })
  app.get('/api/admin/curation/places/:id',async(req,reply)=>{
    if(!await admin(req,reply))return
    const {id}=req.params as {id:string};if(!UUID.test(id))return reply.code(400).send({error:'invalid_query'})
    try {
      const r=await db.pool.query(`select pl.id,pl.name,coalesce(c.active,false) as active,coalesce(c.version,0) as version,coalesce(c.description,'') as description,
        coalesce((select json_agg(json_build_object('postId',cp.post_id,'mediaId',cp.media_id,'valid',exists(select 1 from posts p join post_media pm on pm.post_id=p.id join media m on m.id=pm.media_id where p.id=cp.post_id and pm.media_id=cp.media_id and ${VALID_CHECKIN_PHOTO})) order by cp.position) from place_checkin_photos cp where cp.place_id=pl.id),'[]') as photos
        from places pl left join place_checkins c on c.place_id=pl.id where pl.id=$1`,[id])
      return r.rowCount?r.rows[0]:reply.code(404).send({error:'not_found'})
    }catch(error){return failure(reply,error)}
  })
  app.put('/api/admin/curation/places/:id',async(req,reply)=>{
    const user=await admin(req,reply);if(!user)return
    const {id}=req.params as {id:string},b=req.body as {active?:unknown;version?:unknown;description?:unknown;photos?:any[]}
    if(!UUID.test(id)||typeof b?.active!=='boolean'||!Number.isInteger(b.version)||Number(b.version)<0||typeof b.description!=='string'||b.description.length>300||!Array.isArray(b.photos)||b.photos.length>9||b.active&&!b.photos.length||b.photos.some(p=>!p||!UUID.test(p.postId)||!UUID.test(p.mediaId))||new Set(b.photos.map(p=>p.postId)).size!==b.photos.length)return reply.code(400).send({error:'invalid_payload'})
    const client=await db.pool.connect()
    try {
      await client.query('begin')
      const pl=await client.query('select enabled from places where id=$1 for update',[id])
      if(!pl.rowCount){await client.query('rollback');return reply.code(404).send({error:'not_found'})}
      const old=await client.query('select version from place_checkins where place_id=$1',[id])
      if((old.rows[0]?.version||0)!==b.version){await client.query('rollback');return reply.code(409).send({error:'version_conflict'})}
      if(b.active&&!pl.rows[0].enabled){await client.query('rollback');return reply.code(409).send({error:'place_disabled'})}
      for(const photo of b.photos){
        const valid=await client.query(`select p.id from posts p join post_media pm on pm.post_id=p.id join media m on m.id=pm.media_id
          where p.id=$1 and p.place_id=$2 and pm.media_id=$3 and p.status='published' and pm.purpose='post' and m.scope='public' and m.mime like 'image/%' for share of p,m`,[photo.postId,id,photo.mediaId])
        if(!valid.rowCount){await client.query('rollback');return reply.code(409).send({error:'invalid_photo'})}
      }
      await client.query(`insert into place_checkins(place_id,active,description,updated_by) values($1,$2,$3,$4)
        on conflict(place_id) do update set active=excluded.active,description=excluded.description,updated_by=excluded.updated_by,updated_at=now(),version=place_checkins.version+1`,[id,b.active,b.description.trim(),user.userId])
      await client.query('delete from place_checkin_photos where place_id=$1',[id])
      for(const [i,photo] of b.photos.entries())await client.query('insert into place_checkin_photos values($1,$2,$3,$4)',[id,photo.postId,photo.mediaId,i])
      await client.query('insert into audit_log(id,actor_id,action,target_type,target_id,reason) values($1,$2,$3,$4,$5,$6)',[randomUUID(),user.userId,'checkin_update','place',id,`${b.active?'推荐中':'暂停'}；${b.photos.length}张照片；版本${Number(b.version)+1}`])
      await client.query('commit');return {ok:true,version:Number(b.version)+1}
    }catch(error){await client.query('rollback');return failure(reply,error)}finally{client.release()}
  })
}
