import type { Db } from './db.ts'
import type { PostRow } from './mapRoutes.ts'
import { VALID_CHECKIN_PHOTO } from './curationRoutes.ts'

export async function checkinDiscovery(db:Db,q:Record<string,string>,limit:number,bounds:number[]|undefined,near:number[]|undefined,categorySql:string,select:string,serialize:(row:PostRow,me:string|null)=>unknown) {
  const key=JSON.stringify(['checkins-v1',q.bounds||'',q.near||'',q.category||'',q.schoolId||'',q.placeId||'',q.q||''])
  let cursor:{key:string;id:string;name:string}|null=null
  if(q.cursor){
    try{cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString())}catch{return null}
    if(!cursor||cursor.key!==key||typeof cursor.name!=='string'||!/^[0-9a-f-]{36}$/i.test(cursor.id)||q.cursor.length>2000)return null
  }
  const valid=`exists(select 1 from place_checkin_photos cp join posts p on p.id=cp.post_id join post_media pm on pm.post_id=p.id and pm.media_id=cp.media_id join media m on m.id=pm.media_id where cp.place_id=pl.id and ${VALID_CHECKIN_PHOTO}
    and ($5::uuid is null or p.school_campus_id is null or exists(select 1 from campuses c where c.id=p.school_campus_id and c.school_id=$5)))`
  const where=`pl.enabled and c.active and pl.latitude is not null and pl.longitude is not null and ${categorySql} and ${valid}
    and ($1::double precision[] is null or (pl.latitude between ($1::double precision[])[1] and ($1::double precision[])[3] and pl.longitude between ($1::double precision[])[2] and ($1::double precision[])[4]))
    and ($2::double precision[] is null or (6371000*2*asin(least(1,sqrt(power(sin(radians(pl.latitude-($2::double precision[])[1])/2),2)+cos(radians(pl.latitude))*cos(radians(($2::double precision[])[1]))*power(sin(radians(pl.longitude-($2::double precision[])[2])/2),2)))))<=($2::double precision[])[3])
    and ($3::uuid is null or pl.id=$3) and ($4='' or position(lower($4) in lower(pl.name||' '||c.description))>0)`
  const args=[bounds||null,near||null,q.placeId||null,q.q?.trim()||'',q.schoolId||null]
  const found=await db.pool.query(`select pl.*,c.description as recommendation from places pl join place_checkins c on c.place_id=pl.id
    where ${where} and ($6::uuid is null or (pl.name,pl.id)>($7,$6)) order by pl.name,pl.id limit $8`,[...args,cursor?.id||null,cursor?.name||'',limit+1])
  const total=await db.pool.query(`select count(*)::int as total from places pl join place_checkins c on c.place_id=pl.id where ${where}`,args)
  const places=found.rows.slice(0,limit),ids=places.map(p=>p.id)
  const photos=await db.pool.query<PostRow & {chosen_image:string;position:number}>(`select ${select},cp.media_id as chosen_image,cp.position
    from place_checkin_photos cp join posts p on p.id=cp.post_id join places pl on pl.id=p.place_id
    join post_media pm on pm.post_id=p.id and pm.media_id=cp.media_id join media m on m.id=pm.media_id
    where cp.place_id=any($1::uuid[]) and ${VALID_CHECKIN_PHOTO} and ($2::uuid is null or p.school_campus_id is null or exists(select 1 from campuses c where c.id=p.school_campus_id and c.school_id=$2))
    order by cp.place_id,cp.position`,[ids,q.schoolId||null])
  const last=places.at(-1)
  return {asOf:new Date().toISOString(),total:total.rows[0].total,totalKind:'places',placesTruncated:false,
    nextCursor:found.rows.length>limit&&last?Buffer.from(JSON.stringify({key,id:last.id,name:last.name})).toString('base64url'):null,
    places:places.map(p=>({id:p.id,name:p.name,address:p.address,latitude:Number(p.latitude),longitude:Number(p.longitude),category:p.category,enabled:p.enabled,
      description:p.recommendation,updatedAt:null,postCount:photos.rows.filter(row=>row.place_id===p.id).length,coverMediaId:photos.rows.find(row=>row.place_id===p.id)?.chosen_image||null})),
    items:places.flatMap(place=>photos.rows.filter(p=>p.place_id===place.id).map(p=>({...serialize(p,null) as object,place:place.name,
      images:(p.images as {id:string}[]).filter(image=>image.id===p.chosen_image)}))) }
}
