import { anchorForMarker } from '../screens/placeSheetModel'
import type { MapHandle } from './mapApi'

/**
 * 把选中地点移到「抽屉上方露出区域」内（design.md §7.5，偏移算法只写一份）。
 * visibleTop / visibleBottom 是 .map 容器内坐标；visibleBottom 已扣掉与抽屉的 24px 间距。
 * 标记高度用适配器实测值（design-review F1），拿不到时按 above=100、below=0 估算。
 */
export function focusInVisibleArea(
  handle: MapHandle | null,
  target: { lat: number; lng: number; placeId: string },
  opts: { zoom: number; visibleTop: number; visibleBottom: number; animate: boolean },
): { mode: 'projected' | 'skipped'; anchorY: number } {
  const fallback = { above: 100, below: 0 }
  if (!handle) return { mode: 'skipped', anchorY: anchorForMarker(opts.visibleTop, opts.visibleBottom, fallback.above, fallback.below) }
  // Leaflet 缓存容器尺寸：先同步一次（尺寸没变时无副作用）
  handle.resize()
  if (handle.getZoom() !== opts.zoom) handle.setView(target.lat, target.lng, opts.zoom, false)
  const ext = handle.getMarkerExtent(target.placeId) ?? fallback
  const anchorY = anchorForMarker(opts.visibleTop, opts.visibleBottom, ext.above, ext.below)
  const p = handle.project(target.lat, target.lng)
  const size = handle.getSize()
  if (!p || !size) return { mode: 'skipped', anchorY }
  // 让目标点落在 anchorY：新中心 = 目标点像素向下偏移 (H/2 − anchorY)
  const c = handle.unproject(p.x, p.y + size.height / 2 - anchorY)
  if (!c) return { mode: 'skipped', anchorY }
  handle.setView(c.lat, c.lng, opts.zoom, opts.animate)
  return { mode: 'projected', anchorY }
}
