import { useSyncExternalStore } from 'react'

/*
  地点抽屉的跨组件状态（design.md §7.7、§10.4）：
  · sheetOpen：App 据此在地图页隐藏底部主导航（不读 URL，避免返回拦截时闪一帧）。
    MapScreen 卸载时不重置：App 只在 tab === 'map' 时读它，离开地图后保留 true 无影响，
    返回抽屉地址时 TabBar 从第一帧起就不渲染。
  · 快照：离开地图（简介页、帖子、发布页…）时记下地点、档位和正文滚动，返回时恢复。
*/

let open = false
const listeners = new Set<() => void>()

export function setPlaceSheetOpen(next: boolean): void {
  if (open === next) return
  open = next
  for (const l of listeners) l()
}

export function usePlaceSheetOpen(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => open,
    () => false,
  )
}

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const SNAPSHOT_KEY = 'timemap.placeSheet.v2'
const MAX_AGE_MS = 30 * 60 * 1000

export interface SheetSnapshot {
  v: 2
  placeId: string
  detent: 'preview' | 'expanded'
  scrollTop: number
  preOpenView: { lat: number; lng: number; zoom: number } | null
  userMovedMap: boolean
  savedAt: number
}

export function writeSheetSnapshot(s: Omit<SheetSnapshot, 'v' | 'savedAt'>): void {
  try { sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ v: 2, ...s, savedAt: Date.now() })) } catch { /* 隐私模式：忽略 */ }
}

export function clearSheetSnapshot(): void {
  try { sessionStorage.removeItem(SNAPSHOT_KEY) } catch { /* ignore */ }
}

/** 只在 placeId 匹配且 30 分钟内有效时返回；结构按未知数据逐字段校验 */
export function readSheetSnapshot(placeId: string): SheetSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Record<string, unknown>
    if (v.v !== 2 || v.placeId !== placeId) return null
    if (v.detent !== 'preview' && v.detent !== 'expanded') return null
    if (typeof v.scrollTop !== 'number' || !Number.isFinite(v.scrollTop)) return null
    if (typeof v.savedAt !== 'number' || Date.now() - v.savedAt < 0 || Date.now() - v.savedAt > MAX_AGE_MS) return null
    const pv = v.preOpenView as Record<string, unknown> | null
    const preOpenView = pv && typeof pv.lat === 'number' && typeof pv.lng === 'number' && typeof pv.zoom === 'number' ? { lat: pv.lat, lng: pv.lng, zoom: pv.zoom } : null
    return { v: 2, placeId, detent: v.detent, scrollTop: v.scrollTop, preOpenView, userMovedMap: v.userMovedMap === true, savedAt: v.savedAt }
  } catch {
    return null
  }
}
