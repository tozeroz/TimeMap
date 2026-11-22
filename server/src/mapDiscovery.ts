import type { FastifyInstance } from 'fastify'
import type { Db } from './db.ts'
import type { PostRow } from './mapRoutes.ts'
import { parseCategoryFilter } from './placeCategories.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function registerMapDiscovery(app: FastifyInstance, db: Db, tree: string, select: string, serialize: (row: PostRow, me: string | null) => unknown) {
  app.get('/api/map/discover', async (req, reply) => {
    reply.header('cache-control', 'no-store')
    const q = req.query as Record<string, string>
    if (Object.values(q).some(v => typeof v !== 'string')) return reply.code(400).send({ error: 'invalid_query' })
    const filter = q.filter || 'all', sort = q.sort || 'latest', keyword = (q.q || '').trim()
    const limit = Number(q.limit || 20)
    const bounds = q.bounds?.split(',').map(Number)
    const near = q.near?.split(',').map(Number)
    const categories = parseCategoryFilter(q.category)
    if (categories === 'invalid') return reply.code(400).send({ error:'bad_category' })
    // Only canonical, validated category values enter this SQL fragment.
    const categorySql = categories?.length ? `pl.category in (${categories.map(c=>`'${c.replaceAll("'","''")}'`).join(',')})` : 'true'
    if (!['all','photos','recent'].includes(filter) || !['latest','hot'].includes(sort) || keyword.length > 100 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      q.placeId && !UUID.test(q.placeId) || bounds && (bounds.length !== 4 || bounds.some(v => !Number.isFinite(v)) || bounds[0]! < -90 || bounds[2]! > 90 || bounds[1]! < -180 || bounds[3]! > 180 || bounds[0]! >= bounds[2]! || bounds[1]! >= bounds[3]!) ||
      near && (near.length !== 3 || near.some(v => !Number.isFinite(v)) || Math.abs(near[0]!) > 90 || Math.abs(near[1]!) > 180 || near[2]! < 100 || near[2]! > 50000) || bounds && near) {
      return reply.code(400).send({ error: 'invalid_query' })
    }
    const key = JSON.stringify(['heat-v2',filter,sort,keyword,q.bounds||'',q.near||'',q.placeId||'',q.schoolId||'',q.category||''])
    if (q.schoolId && !UUID.test(q.schoolId)) return reply.code(400).send({ error: 'invalid_query' })
    let cursor: { key: string; asOf: string; time: string; id: string; score: number; fresh: number } | null = null
    if (q.cursor) {
      try {
        if (q.cursor.length > 4000) throw new Error()
        cursor = JSON.parse(Buffer.from(q.cursor, 'base64url').toString())
        if (!cursor || cursor.key !== key || !Number.isFinite(Date.parse(cursor.time)) || !UUID.test(cursor.id) ||
          !Number.isFinite(Date.parse(cursor.asOf)) || Date.parse(cursor.asOf) > Date.now()+1000 || !Number.isFinite(cursor.score) || ![0,1].includes(cursor.fresh)) throw new Error()
      } catch { return reply.code(400).send({ error: 'invalid_cursor' }) }
    }
    const asOf = cursor?.asOf || new Date().toISOString()
    // All filters are applied before aggregation and pagination. The same CTE powers both.
    const args = [asOf,filter,keyword,q.placeId||null,bounds||null,near||null,q.schoolId||null]
    const cte = `${tree}, matched as (
      select ${select}, p.created_at::text as cursor_time,
        case when p.created_at >= $1::timestamptz - interval '30 days' then 1 else 0 end as fresh
      from posts p join places pl on pl.id=p.place_id
      where p.status='published' and pl.enabled and ${categorySql} and p.created_at <= $1::timestamptz
        ${sort==='hot'?"and p.created_at >= $1::timestamptz - interval '7 days'":''}
        and ($2<>'recent' or p.created_at >= $1::timestamptz - interval '7 days')
        and ($2<>'photos' or exists(select 1 from post_media pm join media m on m.id=pm.media_id
          where pm.post_id=p.id and pm.purpose='post' and m.scope='public' and m.mime like 'image/%'))
        and ($3='' or position(lower($3) in lower(p.body))>0)
        and ($4::uuid is null or p.place_id in(select id from tree where root=$4::uuid))
        and ($5::double precision[] is null or (pl.latitude between ($5::double precision[])[1] and ($5::double precision[])[3]
          and pl.longitude between ($5::double precision[])[2] and ($5::double precision[])[4]))
        and ($6::double precision[] is null or (6371000*2*asin(least(1,sqrt(
          power(sin(radians(pl.latitude-($6::double precision[])[1])/2),2)+cos(radians(pl.latitude))*cos(radians(($6::double precision[])[1]))*
          power(sin(radians(pl.longitude-($6::double precision[])[2])/2),2))))) <= ($6::double precision[])[3])
        and ($7::uuid is null or exists(select 1 from campuses c where c.id=p.school_campus_id and c.school_id=$7::uuid)
          or p.school_campus_id is null)
    )`
    try {
      const latest = sort === 'latest'
      const order = latest ? 'created_at desc,id desc' : 'hot_score desc,created_at desc,id desc'
      const tail = latest ? '(created_at,id)<($8::timestamptz,$9::uuid)' : '(hot_score,created_at,id)<($11::double precision,$8::timestamptz,$9::uuid)'
      // Same interaction weights as the existing place feed; snapshot time fixes age decay across pages.
      const rows = await db.pool.query<PostRow & {cursor_time:string;fresh:number;hot_score:number}>(`${cte}, ranked as (
        select matched.*, (like_count*2 + comment_count*3 +
          (select count(*) from favorites f where f.post_id=matched.id) -
          greatest(0,extract(epoch from ($1::timestamptz-created_at))/3600-24))::double precision as hot_score
        from matched
      ) select * from ranked
        where ($8::timestamptz is null or ${tail}) and $10::int>=0 and $11::double precision is not null order by ${order} limit $12`,
        [...args,cursor?.time||null,cursor?.id||null,cursor?.fresh||0,cursor?.score??0,limit+1])
      const places = await db.pool.query(`${cte} select pl.id,pl.name,pl.address,pl.latitude,pl.longitude,pl.category,pl.enabled,
        info.description, count(m.id)::int as post_count,max(m.created_at) as updated_at,
        (array_agg(m.map_media_id order by m.created_at desc,m.id desc) filter(where m.map_media_id is not null))[1] as map_media_id,
        (array_agg(m.images order by m.created_at desc,m.id desc) filter(where json_array_length(m.images)>0))[1] as images
        from map_places pl join places info on info.id=pl.id left join tree t on t.root=pl.id
        left join matched m on m.place_id=t.id
        where pl.enabled and ${categorySql} and pl.latitude is not null and pl.longitude is not null
          and ($6::double precision[] is null or (6371000*2*asin(least(1,sqrt(
            power(sin(radians(pl.latitude-($6::double precision[])[1])/2),2)+cos(radians(pl.latitude))*cos(radians(($6::double precision[])[1]))*
            power(sin(radians(pl.longitude-($6::double precision[])[2])/2),2))))) <= ($6::double precision[])[3])
          and ($5::double precision[] is null or (pl.latitude between ($5::double precision[])[1] and ($5::double precision[])[3]
            and pl.longitude between ($5::double precision[])[2] and ($5::double precision[])[4]))
        group by pl.id,pl.name,pl.address,pl.latitude,pl.longitude,pl.category,pl.enabled,info.description
        having ($2='all' and $3='' or count(m.id)>0) order by post_count desc,pl.name,pl.id limit 501`, args)
      const total = await db.pool.query(`${cte} select count(*)::int as total from matched`,args)
      const items = rows.rows.slice(0,limit), last = items.at(-1)
      const nextCursor = rows.rows.length>limit && last ? Buffer.from(JSON.stringify({key,asOf,time:last.cursor_time,id:last.id,score:Number(last.hot_score),fresh:last.fresh})).toString('base64url') : null
      return { asOf,total:total.rows[0]?.total||0,items:items.map(p=>serialize(p,null)),nextCursor,
        placesTruncated:places.rows.length>500,places:places.rows.slice(0,500).map(p=>({id:p.id,name:p.name,address:p.address,
          latitude:Number(p.latitude),longitude:Number(p.longitude),category:p.category,enabled:p.enabled,
          description:p.description,postCount:p.post_count,updatedAt:p.updated_at ? new Date(p.updated_at).toISOString():null,
          coverMediaId:p.map_media_id || p.images?.[0]?.id || null})) }
    } catch (error) {
      req.log.error({err:error},'Map discovery query failed')
      const unavailable=db.noteFailure(error)==='transient'
      return reply.code(unavailable?503:500).send({error:unavailable?'db_unavailable':'discovery_failed'})
    }
  })
}
