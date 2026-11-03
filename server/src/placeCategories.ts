/**
 * 地点分类（places.category）的唯一来源。
 * ⚠️ 必须与 031_landmark_import.sql 里的 places_category_check 保持一致；
 *    前端同名常量见 app/src/api/client.ts。
 */
export const PLACE_CATEGORIES = ['地标', '教学楼', '活动场地', '运动场地', '食堂'] as const

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number]

export function isPlaceCategory(v: unknown): v is PlaceCategory {
  return typeof v === 'string' && (PLACE_CATEGORIES as readonly string[]).includes(v)
}

/** 校验失败时返回给客户端的说明 */
export const PLACE_CATEGORY_HINT = `category 必须是 ${PLACE_CATEGORIES.map((c) => `'${c}'`).join(' / ')} 之一`
