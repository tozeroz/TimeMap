/**
 * 地图 provider 的统一句柄。
 *
 * 为什么要这层抽象：demo 里同时存在四套底图 ——
 * 腾讯 GL SDK（首选）→ 高德 JS SDK → 栅格瓦片（Leaflet）→ 离线自绘。
 * MapScreen 只依赖这个接口做「回到定位 / 放大」，不关心底下是谁。
 */
export interface MapHandle {
  provider: 'tencent' | 'amap' | 'raster'
  /** 飞过去（带过渡动画） */
  flyTo(lat: number, lng: number, zoom?: number): void
  zoomIn(): void
  getCenter(): { lat: number; lng: number } | null
  getZoom(): number | null
  /*
    地点抽屉（design.md §7.5）：把选中地点移到「抽屉上方露出区域」需要的投影能力。
    偏移算法只写一份（native/mapFocus.ts），各适配器只负责 SDK 投影。
  */
  /** 经纬度 → 地图容器像素 */
  project(lat: number, lng: number): { x: number; y: number } | null
  /** 地图容器像素 → 经纬度 */
  unproject(x: number, y: number): { lat: number; lng: number } | null
  setView(lat: number, lng: number, zoom: number, animate: boolean): void
  getSize(): { width: number; height: number } | null
  /** 容器尺寸变化后通知 SDK（保持中心不变） */
  resize(): void
  /** 高亮选中地点的标记（.rm--selected）；null 取消 */
  setSelected(placeId: string | null): void
  /**
   * 实测标记可见盒相对锚点（经纬度点）向上 / 向下的像素（design-review F1：不假设 100px）。
   * 拿不到时返回 null。
   */
  getMarkerExtent(placeId: string): { above: number; below: number } | null
}

/** 由 `.rm` 内卡片与图钉的实际 rect 和锚点像素算出标记的上下范围（三个适配器共用） */
export function measureMarkerExtent(rm: Element | null | undefined, container: Element, anchor: { x: number; y: number } | null): { above: number; below: number } | null {
  if (!rm || !anchor) return null
  const parts = rm.querySelectorAll('.rm__card, .rm__pin')
  let top = Infinity
  let bottom = -Infinity
  for (const el of Array.from(parts.length ? parts : [rm])) {
    const r = el.getBoundingClientRect()
    if (r.height === 0 && r.width === 0) continue
    top = Math.min(top, r.top)
    bottom = Math.max(bottom, r.bottom)
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null
  const c = container.getBoundingClientRect()
  return { above: anchor.y - (top - c.top), below: bottom - c.top - anchor.y }
}

let instanceCounter = 0
/** 每次建图递增，写到宿主 data-map-instance，验收「地图没有重建」用 */
export function nextMapInstance(): string {
  instanceCounter += 1
  return String(instanceCounter)
}

export type MapProvider = MapHandle['provider'] | 'offline'

/**
 * 地图上的一个标记。**这是生产类型**（三个原生地图实现与 MapScreen 都用它）。
 *
 * ## ⭐ 为什么在 Round 266 把它从 `data/mock.ts` 移到这里
 *   审核记录 58 的 closeout 要求：历史数据可以留，但**不要继续作为生产代码中
 *   `import` 的业务数据**。原状是：
 *     · `MapMarker`（类型）与 `mapMarkers`（6 条**编造的**标记数据）**都**在 `data/mock.ts`
 *     · 三个地图组件与 MapScreen 都写 `import type { MapMarker } from '../data/mock'`
 *   ⇒ 于是**每一个地图相关文件都还牵着 mock 模块**。类型本身没问题，但这种"牵着"很容易
 *     让人下次顺手也把数据 import 进来（本项目已在 CommentsScreen / BoardScreen 上各栽一次）。
 *   ⇒ 移动类型到这里（地图抽象层），让**生产侧的地图代码完全不依赖 mock**；
 *     那 6 条编造数据移到 `scripts/m5/fixtures/legacy-map-markers.json`（不进生产包）。
 *
 * ## 坐标字段的现状（不夸大）
 *   · `lat`/`lng`：**权威**来源是 `posts.place_id → places.latitude/longitude`
 *     （服务端 `/api/posts` 以 `placeLat`/`placeLng` 返回）
 *   · `x`/`y`：**仅离线自绘地图**用的 SVG 像素坐标。⚠️ 目前**没有经过校准的投影**，
 *     因此 Round 266 起 **offline 模式不再渲染权威标记**（见 MapScreen 的说明）。
 */
export interface MapMarker {
  imageMode?: 'photo' | 'sticker'
  likeCount?: number
  highlight?: boolean
  id: string
  place: string
  color: string
  userId: string
  /**
   * ⭐ TimeMap P0：标记的**跳转目标**是**地点**，不是帖子。
   *
   * 为什么改了（这是需求 4.1/4.2 的直接后果）：
   *   P0 之前标记 = 一条带地点的帖子 ⇒ 点开进动态详情。
   *   而需求 4.1 把地图定义为"从地图进入**地点**"的入口：标记按**地点**聚合，
   *   点击进地点详情，再从地点详情看该地点的内容。
   *   ⇒ 所以 marker 必须携带 placeId；`postId` 退化为"可用于展示的代表帖"
   *     （卡片封面/摘要仍来自它），不再是跳转目标。
   */
  placeId: string
  /** 代表帖（用于标记卡片的封面与摘要）；地点聚合后可能是多条帖中最新的那条 */
  postId: string
  /** 离线自绘地图的 SVG 像素坐标（未校准投影，见上） */
  x: number
  y: number
  /** 真实经纬度（权威来源：places.latitude/longitude） */
  lat: number
  lng: number
  /**
   * ⭐ Round 266：标记卡片的封面图 URL（权威来源：该帖的 `images[0]`，经 `mediaUrl(id)`）。
   * ## 为什么把它放进 marker，而不是让地图组件自己去查帖子
   *   改前三个地图实现都写 `posts.find((p) => p.id === m.postId)` —— **去 mock 里查**。
   *   而 WO#15 之后 `m.postId` 是**真实帖子的 UUID**，mock 里的 id 是 `p1`/`p2`…
   *   ⇒ 那个 find **永远返回 undefined** ⇒ 卡片封面与文字都变成空
   *     （标记仍画得出来、地名也在，所以**看起来只是"卡片没内容"**，很难发现）。
   *   ⇒ 正确做法：由**构造标记的那一处**（`MapScreen.markersFromPosts`，它手里就有权威帖子）
   *     把卡片所需的数据一并放进来。地图组件**不再需要知道帖子从哪来** ——
   *     顺便也就**不再 import mock**（这正是审核 58 closeout 第 1 项要的方向）。
   */
  coverUrl?: string
  /** 没有封面图时卡片里显示的正文片段（同样来自权威帖子） */
  excerpt?: string
}
