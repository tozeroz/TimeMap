/**
 * 地点简介页 / 抽屉缩略图的纯逻辑（不 import 任何模块）。
 * 依据：.agents/tasks/place-sheet-ui/design.md §7.1、§12、§13。
 */

export interface PhotoLike {
  mediaId?: string | null
  imageUrl?: string | null
  source?: string | null
}

/** 只接受媒体管线 ID、http(s)、站内绝对路径和 data:image/ */
export const hasSrc = (p: PhotoLike): boolean =>
  (typeof p.mediaId === 'string' && p.mediaId.trim() !== '') ||
  (typeof p.imageUrl === 'string' && /^(https?:\/\/|\/|data:image\/)/i.test(p.imageUrl.trim()))

/** 来源以「演示素材」开头的照片（与 tools/import-place-photos 的判定一致）。不作缩略图/封面。 */
export const isDemoPhoto = (p: PhotoLike): boolean => typeof p.source === 'string' && p.source.trim().startsWith('演示素材')

/** 可作为封面 / 缩略图的照片 */
export const isCoverCandidate = (p: PhotoLike): boolean => hasSrc(p) && !isDemoPhoto(p)

export function photoSrc(p: PhotoLike, mediaUrl: (id: string) => string): string | null {
  if (!hasSrc(p)) return null
  if (typeof p.mediaId === 'string' && p.mediaId.trim() !== '') return mediaUrl(p.mediaId)
  return (p.imageUrl as string).trim()
}

/** 封面 = 第一张可用照片；rest = 其余照片（保持接口顺序，网格不重复封面）。 */
export function pickCover<T extends PhotoLike>(photos: T[]): { cover: T | null; rest: T[] } {
  const i = photos.findIndex(isCoverCandidate)
  if (i < 0) return { cover: null, rest: photos.slice() }
  return { cover: photos[i], rest: photos.filter((_, j) => j !== i) }
}

/** description + history 拆成普通段落，去空、去重，保持顺序。 */
export function introParagraphs(description: string | null | undefined, history: string | null | undefined): string[] {
  const d = (description ?? '').trim()
  const h = (history ?? '').trim()
  const parts = [d, h === d ? '' : h].flatMap(t => t.split(/\n+/)).map(t => t.trim()).filter(Boolean)
  return parts.filter((t, i) => parts.indexOf(t) === i)
}

export function sheetSummary(description: string | null | undefined, history: string | null | undefined): string | null {
  const d = (description ?? '').trim()
  if (d) return d
  return introParagraphs(description, history)[0] ?? null
}

/** 「{年代} · {来源}」，缺值项省略 */
export function photoMeta(p: { yearLabel?: string | null; source?: string | null }): string | null {
  const parts = [p.yearLabel, p.source].map(v => (v ?? '').trim()).filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** photo 参数：'cover'（有封面时）或 0 ≤ n < restLength；不合法返回 null。 */
export function parsePhotoParam(value: string | undefined, restLength: number, hasCover: boolean): 'cover' | number | null {
  if (value === undefined) return null
  if (value === 'cover') return hasCover ? 'cover' : null
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  return n < restLength ? n : null
}

export interface HierarchyItem { id: string; name: string; displayLevel: string; parentPlaceId: string | null }

export function introHeading(placeId: string, hierarchy: Map<string, HierarchyItem> | null, category: string): { title: '校园简介' | '地点简介'; eyebrow: string } {
  const self = hierarchy?.get(placeId)
  if (!self) return { title: '地点简介', eyebrow: category }
  if (self.displayLevel === 'school') return { title: '校园简介', eyebrow: category }
  const parent = self.parentPlaceId ? hierarchy?.get(self.parentPlaceId) : undefined
  if (parent) return { title: '地点简介', eyebrow: category ? `${parent.name} · ${category}` : parent.name }
  return { title: '地点简介', eyebrow: category }
}
