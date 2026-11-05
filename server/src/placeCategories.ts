/**
 * 地点分类（places.category）的唯一来源。
 * ⚠️ 必须与 032_place_categories_v2.sql 里的 places_category_check 保持一致；
 *    前端同名常量见 app/src/api/client.ts。
 * 顺序即地图「地标标签」面板的按钮顺序（全部之后）。
 */
export const PLACE_CATEGORIES = ['校园地标', '食堂', '教学楼', '运动场', '休闲场所'] as const

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number]

export function isPlaceCategory(v: unknown): v is PlaceCategory {
  return typeof v === 'string' && (PLACE_CATEGORIES as readonly string[]).includes(v)
}

/** 校验失败时返回给客户端的说明 */
export const PLACE_CATEGORY_HINT = `category 必须是 ${PLACE_CATEGORIES.map((c) => `'${c}'`).join(' / ')} 之一`

/**
 * 旧客户端（031 之前 / 之间）的筛选值，只用于**读**接口的 ?category=，写接口不接受。
 *   地标     → 除食堂外的全部（旧版地图只有「全部 / 地标 / 食堂」，地标即非食堂）
 *   活动场地 → 校园地标（图书馆、学生活动中心、天佑会堂、校史馆已并入校园地标）
 *   运动场地 → 运动场
 */
const LEGACY_FILTERS: Record<string, readonly PlaceCategory[]> = {
  地标: ['校园地标', '教学楼', '运动场', '休闲场所'],
  活动场地: ['校园地标'],
  运动场地: ['运动场'],
}

/**
 * 解析读接口的 ?category=：支持逗号分隔（`食堂,教学楼`）与重复参数，结果按 OR 合并。
 * 返回 null = 不筛选（参数缺失或为空）；返回 'invalid' = 含未知值。
 */
export function parseCategoryFilter(raw: unknown): PlaceCategory[] | null | 'invalid' {
  if (raw === undefined) return null
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((v) => (typeof v === 'string' ? v.split(',') : [null]))
  const out = new Set<PlaceCategory>()
  for (const part of parts) {
    if (part === null) return 'invalid'
    const v = part.trim()
    if (!v) continue
    if (isPlaceCategory(v)) out.add(v)
    else if (Object.hasOwn(LEGACY_FILTERS, v)) for (const c of LEGACY_FILTERS[v]!) out.add(c)
    else return 'invalid'
  }
  return out.size ? [...out] : null
}
