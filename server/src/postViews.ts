/**
 * 帖子曝光/点击记录（2026-11-06，配合迁移 036 / 037）
 *
 * 为什么写在这个文件里而不是直接写在路由里：
 *   ①「曝光」与「点开」两条路径要共用同一套去重口径，写在两处必然分叉；
 *   ②计数逻辑有三步（去重台账 → 按天统计 → posts.open_count），任何一步漏了都会让
 *     列表里的「点击数」和排序用的点击率对不上，集中一处才好核对。
 *
 * 去重口径（关键，"点击数"之所以可信全靠它）：
 *   · 登录用户：subject = 'u:<userId>'，同一用户同一天对同一帖只计一次曝光/一次点开
 *   · 未登录用户：subject = 'v:<visitorId>'，visitorId 由客户端 localStorage 生成
 *   · 没有 visitorId 的匿名请求不计数（宁可少算，也不要让爬虫/刷新把数字刷上去）
 *
 * 位置与会话（迁移 037，影子数据）：
 *   · slot   本次曝光的视觉位次，用来量化「第 1 槽 vs 第 18 槽」的点击率差；
 *   · surface 是哪个界面（campus/place/...），不同界面的 CTR 不能混着比；
 *   · 两者都只记录、不参与当前排序 —— 等数据攒够再决定质量门与份额怎么用。
 */
import type { Pool } from 'pg'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** visitorId 允许 uuid 或 8–64 位的十六进制串（客户端可能用短 id） */
const VISITOR_RE = /^[0-9a-f-]{8,64}$/i
const SESSION_RE = /^[0-9a-f-]{8,64}$/i

export const MAX_IMPRESSION_BATCH = 50
/** 位次上限：一屏最多几十张卡，超过这个数的 slot 一律当未知，避免脏数据进库 */
const MAX_SLOT = 200

export const SURFACES = ['campus', 'place', 'favorites', 'myposts', 'user', 'map', 'other'] as const
export type Surface = (typeof SURFACES)[number]

export interface ImpressionItem {
  postId: string
  /** 视觉位次，1 = 第一屏第一个；客户端没给就是 null（只当作没有位置信息） */
  slot: number | null
}

function toSlot(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  const n = Math.trunc(raw)
  if (n < 1 || n > MAX_SLOT) return null
  return n
}

/**
 * 解析一次曝光上报。
 * 接受两种形状：`['uuid', ...]`（旧客户端）与 `[{ postId, slot }, ...]`（带位置）。
 */
export function normalizeImpressionItems(raw: unknown): ImpressionItem[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const out: ImpressionItem[] = []
  const seen = new Set<string>()
  for (const v of list) {
    let postId = ''
    let slot: number | null = null
    if (typeof v === 'string') {
      postId = v.trim()
    } else if (v && typeof v === 'object') {
      const o = v as { postId?: unknown; slot?: unknown }
      postId = typeof o.postId === 'string' ? o.postId.trim() : ''
      slot = toSlot(o.slot)
    }
    if (!UUID_RE.test(postId)) continue
    if (seen.has(postId)) continue
    seen.add(postId)
    out.push({ postId, slot })
    if (out.length >= MAX_IMPRESSION_BATCH) break
  }
  return out
}

/** 只要 id 列表（点开接口用，它一次只涉及一条） */
export function normalizePostIds(raw: unknown): string[] {
  return normalizeImpressionItems(raw).map((i) => i.postId)
}

export function normalizeSurface(raw: unknown): Surface {
  return typeof raw === 'string' && (SURFACES as readonly string[]).includes(raw) ? (raw as Surface) : 'other'
}

export function normalizeSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  return SESSION_RE.test(v) ? v : null
}

/** 由会话与 visitorId 决定这次上报记在谁头上；两者都没有返回 null（不计数） */
export function eventSubject(userId: string | null, visitorId: unknown): string | null {
  if (userId) return `u:${userId}`
  if (typeof visitorId === 'string' && VISITOR_RE.test(visitorId.trim())) return `v:${visitorId.trim().toLowerCase()}`
  return null
}

export interface RecordViewsResult {
  /** 真正产生了新计数的帖子数 */
  counted: number
  /** 被去重（当天已经看过）或没有权限计数的帖子数 */
  skipped: number
}

/**
 * 记录一批帖子的曝光或点开。
 *
 * 幂等：同一 subject 同一天重复上报只算一次；点开状态一旦从 false 翻成 true，
 * 即使再传 100 次也不会再加计数（这也是"刷新不会让点击数涨"的原因）。
 */
export async function recordPostViews(
  pool: Pool,
  opts: {
    items: ImpressionItem[]
    subject: string
    opened: boolean
    surface: Surface
    sessionId: string | null
  },
): Promise<RecordViewsResult> {
  const { items, subject, opened, surface, sessionId } = opts
  if (!items.length || !subject) return { counted: 0, skipped: items.length }

  const postIds = items.map((i) => i.postId)
  const slotOf = new Map(items.map((i) => [i.postId, i.slot]))

  // 只给仍然公开的帖子计数：已下架/删除的帖子不该再积累数字
  const alive = await pool.query<{ id: string }>(
    "select id from posts where id = any($1::uuid[]) and status = 'published'",
    [postIds],
  )
  const aliveIds = new Set(alive.rows.map((r) => r.id))

  let counted = 0
  let skipped = items.length - aliveIds.size

  for (const postId of postIds) {
    if (!aliveIds.has(postId)) continue

    // 第一步：台账插入（不存在才算"新的一天第一次看到"）
    const ins = await pool.query(
      `insert into post_events (post_id, day, subject, seen, opened, slot, surface, session_id)
       values ($1::uuid, current_date, $2, true, $3, $4, $5, $6::uuid)
       on conflict (post_id, day, subject) do nothing
       returning 1 as inserted`,
      [postId, subject, opened, slotOf.get(postId) ?? null, surface, sessionId],
    )
    const isNewSubjectDay = ins.rowCount === 1

    // 第二步：老记录里"看过但没点开"→ 点开，需要把 opened 翻上去并补计一次
    let flipped = false
    if (!isNewSubjectDay && opened) {
      const upd = await pool.query(
        `update post_events set opened = true
          where post_id = $1::uuid and day = current_date and subject = $2 and opened = false
          returning 1 as flipped`,
        [postId, subject],
      )
      flipped = upd.rowCount === 1
    }

    const addImpression = isNewSubjectDay ? 1 : 0
    const addOpen = isNewSubjectDay && opened ? 1 : flipped ? 1 : 0

    if (!addImpression && !addOpen) {
      skipped += 1
      continue
    }

    // 第三步：按天统计 + 帖子上的展示计数器
    await pool.query(
      `insert into post_daily_stats (post_id, day, impressions, opens)
       values ($1::uuid, current_date, $2, $3)
       on conflict (post_id, day) do update
         set impressions = post_daily_stats.impressions + excluded.impressions,
             opens       = post_daily_stats.opens + excluded.opens`,
      [postId, addImpression, addOpen],
    )
    if (addOpen) {
      await pool.query('update posts set open_count = open_count + 1 where id = $1::uuid', [postId])
    }
    counted += 1
  }

  return { counted, skipped }
}
