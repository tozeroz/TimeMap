/**
 * 地点抽屉的纯逻辑（不 import 任何模块，便于 node --experimental-strip-types 直接测试）。
 * 依据：.agents/tasks/place-sheet-ui/design.md §8–§10。
 */

export type Detent = 'closed' | 'preview' | 'expanded'
export type OpenDetent = Exclude<Detent, 'closed'>

export const SLOP_PX = 8
export const DOMINANCE = 1.2
export const TOP_TOLERANCE_PX = 2
export const FLING_PX_PER_MS = 0.5
export const RUBBER_FACTOR = 0.35
export const MAX_DIP_PX = 40
export const DURATION_MS = 300
export const EASE = 'cubic-bezier(.22,1,.36,1)'
/** 选中标记底端与抽屉上边缘的最小间距 */
export const MARKER_GAP_PX = 24

export interface Snaps { previewH: number; expandedH: number; single: boolean }

/** H = 地图页可用高度；headH = 地图头部（标题 + 分类条）高度，预览态时它仍可见。 */
export function computeSnaps(H: number, headH: number): Snaps {
  let previewH = Math.min(H - 64, Math.max(300, Math.round(0.53 * H)))
  const expandedH0 = Math.max(Math.round(0.82 * H), previewH)
  previewH = Math.min(previewH, H - headH)
  const expandedH = Math.max(expandedH0, previewH)
  if (expandedH - previewH < 80) return { previewH: H - 64, expandedH: H - 64, single: true }
  return { previewH, expandedH, single: false }
}

export function visibleHeight(detent: Detent, s: Snaps): number {
  return detent === 'closed' ? 0 : detent === 'expanded' ? s.expandedH : s.previewH
}

export type Zone = 'handle' | 'body'
export type Owner = 'panel' | 'content' | 'none'

/** 在第一次有方向的移动时调用一次：是否先拦截原生滚动（design-review F2：锁定一次）。 */
export function isPanelEligible(zone: Zone, scrollable: boolean, scrollTopAtStart: number, dy: number): boolean {
  return zone === 'handle' || !scrollable || (scrollTopAtStart <= TOP_TOLERANCE_PX && dy > 0)
}

/** 位移第一次超过 SLOP_PX 时决定本次手势归属，之后不再改变。 */
export function decideOwner(i: { zone: Zone; scrollable: boolean; scrollTopAtStart: number; dx: number; dy: number; touches: number }): Owner {
  if (i.touches > 1) return 'none'
  if (Math.abs(i.dy) <= DOMINANCE * Math.abs(i.dx)) return 'none'
  if (i.zone === 'handle') return 'panel'
  if (!i.scrollable) return 'panel'
  if (i.dy < 0) return 'content'
  return i.scrollTopAtStart <= TOP_TOLERANCE_PX ? 'panel' : 'content'
}

/** 拖动中的可见高度：上限 expandedH，低于 previewH 时加阻尼，最多下沉 MAX_DIP_PX。 */
export function dragVisible(startVisible: number, dy: number, s: Snaps): number {
  const raw = startVisible - dy
  if (raw > s.expandedH) return s.expandedH
  if (raw < s.previewH) return s.previewH - Math.min(MAX_DIP_PX, (s.previewH - raw) * RUBBER_FACTOR)
  return raw
}

/** 松手吸附；结果永远不是 closed（关闭只能靠按钮、返回或 Esc）。v 为 px/ms，向下为正。 */
export function resolveRelease(from: OpenDetent, visible: number, v: number, s: Snaps): OpenDetent {
  if (s.single) return 'preview'
  if (from === 'expanded') {
    if (v >= FLING_PX_PER_MS) return 'preview'
    if (v <= -FLING_PX_PER_MS) return 'expanded'
    return Math.abs(visible - s.expandedH) <= Math.abs(visible - s.previewH) ? 'expanded' : 'preview'
  }
  return v <= -FLING_PX_PER_MS || visible > (s.previewH + s.expandedH) / 2 ? 'expanded' : 'preview'
}

const UUID = /^[0-9a-f-]{36}$/i
export const isPlaceId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** #/map 的抽屉参数。null = 地址里没有合法的抽屉状态。 */
export function parseSheetQuery(q: Record<string, string>): { placeId: string; detent: OpenDetent } | null {
  if (q.sheet === undefined || !isPlaceId(q.placeId)) return null
  return { placeId: q.placeId, detent: q.sheet === 'expanded' ? 'expanded' : 'preview' }
}

/**
 * 选中标记在露出区域内的锚点 y（容器像素，即经纬度点的位置）。
 * above / below = 标记可见盒相对锚点向上 / 向下的实测像素（design-review F1：实测，不假设 100px）。
 * 放得下时让整个标记在 [visibleTop, visibleBottom] 内垂直居中；放不下时保证底端贴住 visibleBottom。
 */
export function anchorForMarker(visibleTop: number, visibleBottom: number, above: number, below: number): number {
  const avail = visibleBottom - visibleTop
  const box = above + below
  if (avail >= box) return visibleTop + (avail - box) / 2 + above
  return visibleBottom - below
}
