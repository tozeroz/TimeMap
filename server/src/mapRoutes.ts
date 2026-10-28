import type { FastifyInstance } from 'fastify'
import type { Db } from './db.ts'
import { randomUUID } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Each enabled ancestor sees posts attached to itself or enabled descendants.
// JSON field lookup also permits read-only previews of databases predating the display migration.
// Missing display metadata is an explicit concrete-place default, never an inferred hierarchy.
const BJTU_ID = 'aaaaaaaa-1111-4111-8111-000000000011'
// Opt-in read projection for the local read-only preview; never writes remote rows.
const previewPlaces = `map_places as (
  select id, name, address, latitude, longitude, category, enabled, sort_order,
    display_level, min_display_zoom, display_priority,
    case when id in (${Array.from({ length: 9 }, (_, i) => `'aaaaaaaa-1111-4111-8111-${String(i + 1).padStart(12, '0')}'::uuid`).join(',')})
      and not exists(select 1 from stored_places where id='${BJTU_ID}')
      then '${BJTU_ID}'::uuid else parent_place_id end as parent_place_id
  from stored_places
  union all
  select '${BJTU_ID}'::uuid, '北京交通大学', '北京市海淀区上园村3号',
    39.9503, 116.3396, '地标', true, 0, 'school', 4::double precision, 0, null::uuid
  where not exists(select 1 from stored_places where id='${BJTU_ID}')
),`
function placeTree(previewHierarchy = false) { return `with recursive stored_places as (
  select pl.id, pl.name, pl.address, pl.latitude, pl.longitude, pl.category, pl.enabled, pl.sort_order,
    coalesce(to_jsonb(pl)->>'display_level','place') as display_level,
    (to_jsonb(pl)->>'min_display_zoom')::double precision as min_display_zoom,
    coalesce((to_jsonb(pl)->>'display_priority')::int,0) as display_priority,
    (to_jsonb(pl)->>'parent_place_id')::uuid as parent_place_id
  from places pl
), ${previewHierarchy ? previewPlaces : 'map_places as (select * from stored_places),'} tree(root, id) as (
  select id, id from map_places where enabled
  union
  select t.root, p.id from tree t join map_places p on p.parent_place_id=t.id where p.enabled
)` }
const POST_SELECT = `p.id, p.author_name, p.author_id, p.body, p.place, p.place_id, p.created_at, p.image_mode,
  pl.latitude as place_lat, pl.longitude as place_lng,
  (select count(*)::int from likes l where l.post_id=p.id) as like_count,
  (select count(*)::int from comments c where c.post_id=p.id and c.status='published') as comment_count,
  (select pm.media_id from post_media pm join media m on m.id=pm.media_id
    where pm.post_id=p.id and pm.purpose='map' and m.scope='public' and m.mime like 'image/%' limit 1) as map_media_id,
  coalesce((select json_agg(json_build_object('id',m.id,'width',m.width,'height',m.height) order by pm.position)
    from post_media pm join media m on m.id=pm.media_id
    where pm.post_id=p.id and pm.purpose='post' and m.scope='public' and m.mime like 'image/%'), '[]') as images`
const ORDER = `(q.created_at >= $2::timestamptz - interval '30 days') desc,
  q.like_count desc, q.created_at desc, q.id asc`

interface PostRow {
  id: string; author_name: string; author_id: string | null; body: string; place: string | null;
  place_id: string; created_at: Date | string; image_mode: string; place_lat: number | null;
  place_lng: number | null; like_count: number; comment_count: number; map_media_id: string | null; images: unknown
}
function post(row: PostRow) {
  return { id: row.id, author: row.author_name, authorId: row.author_id, body: row.body,
    place: row.place, placeId: row.place_id, createdAt: new Date(row.created_at).toISOString(),
    imageMode: row.image_mode, placeLat: row.place_lat === null ? null : Number(row.place_lat),
    placeLng: row.place_lng === null ? null : Number(row.place_lng), likeCount: Number(row.like_count),
    commentCount: Number(row.comment_count), mapMediaId: row.map_media_id, images: row.images }
}

export function registerMapRoutes(app: FastifyInstance, db: Db, options: { previewHierarchy?: boolean } = {}) {
  const TREE = placeTree(options.previewHierarchy)
  const snapshots = new Map<string, { placeId: string; asOf: string; ids: string[]; expires: number; truncated: boolean }>()
  app.get('/api/map/places', async (req, reply) => {
    const category = (req.query as { category?: string }).category
    if (category !== undefined && category !== '地标' && category !== '食堂') return reply.code(400).send({ error: 'bad_category' })
    const asOf = new Date().toISOString()
    try {
      const result = await db.pool.query<{
        id: string; name: string; address: string | null; latitude: number | null; longitude: number | null;
        category: string; enabled: boolean; display_level: string; min_display_zoom: number | null;
        display_priority: number; parent_place_id: string | null; post_count: number; previews: PostRow[]
      }>(`${TREE}
        select pl.*, (select count(*)::int from posts p join tree t on t.id=p.place_id
          where t.root=pl.id and p.status='published') as post_count,
          coalesce((select json_agg(candidate) from (
            select q.* from (select ${POST_SELECT} from posts p join map_places pl on pl.id=p.place_id
              where p.status='published' and p.created_at <= $2::timestamptz
                and p.place_id in (select t.id from tree t where t.root=outer_place.id)) q
              order by ${ORDER} limit 12
          ) candidate), '[]') as previews
        from map_places pl cross join lateral (select pl.id) outer_place
        where pl.enabled and ($1::text is null or pl.category=$1)
        order by pl.display_priority desc, pl.sort_order, pl.name, pl.id limit 501`, [category ?? null, asOf])
      return { asOf, truncated: result.rows.length > 500, items: result.rows.slice(0, 500).map(row => ({
        id: row.id, name: row.name, address: row.address,
        latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude),
        category: row.category, enabled: row.enabled, displayLevel: row.display_level,
        minDisplayZoom: row.min_display_zoom, displayPriority: row.display_priority, parentPlaceId: row.parent_place_id,
        postCount: row.post_count, previews: row.previews.map(post),
      })) }
    } catch (error) {
      req.log.error({ err: error }, 'Map places query failed')
      const transient = db.noteFailure(error) === 'transient'
      return reply.code(transient ? 503 : 500).send({ error: transient ? 'db_unavailable' : 'map_read_failed' })
    }
  })

  app.get('/api/map/posts', async (req, reply) => {
    if (Object.values(req.query as Record<string, unknown>).some(value => typeof value !== 'string')) {
      return reply.code(400).send({ error: 'invalid_map_query' })
    }
    const q = req.query as { placeId?: string; offset?: string; asOf?: string; exclude?: string; limit?: string; snapshot?: string }
    const offset = Number(q.offset ?? 0)
    const limit = Number(q.limit ?? 20)
    const asOf = q.asOf ?? new Date().toISOString()
    const exclude = q.exclude ? q.exclude.split(',') : []
    if (!q.placeId || !UUID.test(q.placeId) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isFinite(Date.parse(asOf)) ||
      Date.parse(asOf) > Date.now() + 60000 || exclude.length > 200 || exclude.some(id => !UUID.test(id))) {
      return reply.code(400).send({ error: 'invalid_map_query' })
    }
    try {
      const place = await db.pool.query<{ name: string }>(`${TREE} select name from map_places where id=$1 and enabled`, [q.placeId])
      if (!place.rows.length) return reply.code(404).send({ error: 'place_unavailable' })
      let token = q.snapshot
      let snapshot = token ? snapshots.get(token) : undefined
      if (token && (!snapshot || snapshot.expires < Date.now() || snapshot.placeId !== q.placeId)) {
        return reply.code(409).send({ error: 'map_snapshot_expired' })
      }
      if (!snapshot) {
        for (const [key, value] of snapshots) if (value.expires < Date.now()) snapshots.delete(key)
        while (snapshots.size >= 100) snapshots.delete(snapshots.keys().next().value!)
        const ranked = await db.pool.query<{ id: string }>(`${TREE} select q.id from (
          select p.id, p.created_at, (select count(*)::int from likes l where l.post_id=p.id) as like_count
          from posts p where p.status='published' and p.created_at <= $2::timestamptz
            and p.place_id in (select id from tree where root=$1::uuid)
            and not (p.id=any($3::uuid[]))
          ) q order by ${ORDER} limit 10001`, [q.placeId, asOf, exclude])
        snapshot = { placeId: q.placeId, asOf, ids: ranked.rows.slice(0, 10000).map(p => p.id),
          expires: Date.now() + 30 * 60 * 1000, truncated: ranked.rows.length > 10000 }
        token = randomUUID()
        snapshots.set(token, snapshot)
      }
      const pageIds = snapshot.ids.slice(offset, offset + limit)
      const result = await db.pool.query<PostRow>(`${TREE} select q.* from (
        select ${POST_SELECT} from posts p join map_places pl on pl.id=p.place_id
        where p.status='published' and p.created_at <= $2::timestamptz
          and p.place_id in (select id from tree where root=$1::uuid)
          and p.id=any($3::uuid[])
        ) q order by array_position($3::uuid[], q.id)`, [q.placeId, snapshot.asOf, pageIds])
      const count = await db.pool.query<{ total: number }>(`${TREE} select count(*)::int as total from posts p
        join tree t on t.id=p.place_id where t.root=$1::uuid and p.status='published'`, [q.placeId])
      return { name: place.rows[0]!.name, total: count.rows[0]!.total, asOf: snapshot.asOf,
        snapshot: token, truncated: snapshot.truncated,
        items: result.rows.map(post), nextOffset: snapshot.ids.length > offset + limit ? offset + limit : null }
    } catch (error) {
      req.log.error({ err: error }, 'Map posts query failed')
      const transient = db.noteFailure(error) === 'transient'
      return reply.code(transient ? 503 : 500).send({ error: transient ? 'db_unavailable' : 'map_read_failed' })
    }
  })
}
