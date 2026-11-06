import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Screen } from '../components/Shell'
import {
  IconChatBubble,
  IconChevronDown,
  IconClose,
  IconLocation,
  IconPlus,
  IconSearch,
  IconSliders,
} from '../components/icons'
import {
  listPlaces,
  listPosts,
  listSchools,
  mediaUrl,
  PLACE_CATEGORIES,
  type ApiPlaceListItem,
  type ApiPost,
  type ApiSchool,
  type PlaceCategory,
} from '../api/client'
import type { MapMarker } from '../native/mapApi'
import { AmapMap } from '../native/AmapMap'
import { RealMap } from '../native/RealMap'
import { TencentMap } from '../native/TencentMap'
import type { MapHandle } from '../native/mapApi'
import { CAMPUS_CENTER } from '../native/mapTiles'
import {
  distanceMeters,
  ensureLocationPermission,
  formatAccuracy,
  formatDistance,
  getCurrentFix,
  hasLocationPermission,
  watchFix,
  type GeoFix,
  type GeoStatus,
} from '../native/geo'
import { buildHash, navigate, useRoute } from '../router'
import type { ApiPlaceDetail } from '../api/client'
import {
  clearSheetSnapshot,
  prefersReducedMotion,
  readSheetSnapshot,
  setPlaceSheetOpen,
  writeSheetSnapshot,
} from '../data/placeSheetState'
import { focusInVisibleArea } from '../native/mapFocus'
import { PlaceDetailSheet } from './PlaceDetailSheet'
import {
  computeSnaps,
  DURATION_MS,
  MARKER_GAP_PX,
  parseSheetQuery,
  visibleHeight,
  type Detent,
  type OpenDetent,
} from './placeSheetModel'
import './map.css'

/** 地点抽屉状态（design.md §8.1）：placeId 只在 closing 结束时置空 */
interface SheetState {
  placeId: string | null
  detent: Detent
  phase: 'opening' | 'open' | 'closing'
  token: number
}
const DEBUG_KEYS = ['offline', 'raster', 'amap'] as const

interface ViewState {
  x: number
  y: number
  scale: number
}

/**
 * 地标标签多选（地图页面复刻说明 §4）：按钮顺序 全部、校园地标、食堂 / 教学楼、运动场、休闲场所。
 * 空数组 = 「全部」；「全部」只是筛选操作，不存进地点数据。
 */
type TagOption = '全部' | PlaceCategory
const TAG_OPTIONS: TagOption[] = ['全部', ...PLACE_CATEGORIES]
/** 草稿切换：点「全部」清空；点具体类别增删；全部取消时自然回到「全部」 */
function toggleTag(draft: readonly PlaceCategory[], tag: TagOption): PlaceCategory[] {
  if (tag === '全部') return []
  const next = draft.includes(tag) ? draft.filter(c => c !== tag) : [...draft, tag]
  return PLACE_CATEGORIES.filter(c => next.includes(c))
}

/**
 * 把**权威地点**派生成地图标记（TimeMap P0 / F02 + US-01）。
 *
 * ## ⭐ 为什么改了（改前是按**帖子**派生）
 *   改前 `markersFromPosts()` 把每条带坐标的帖子变成一个标记 ⇒ 同一地点有多少条帖子
 *   就有多少个标记叠在一起。而需求 4.1 的草图与 4.2 的信息架构是：
 *     地图 → **地点**（标记）→ 地点详情 → 该地点的内容
 *   即"以地点为内容组织单位"。所以正确做法是**按地点聚合**：一个地点一个标记。
 *
 *   `MapMarker.placeId` 因此成为**跳转目标**（点击进地点详情）；
 *   `postId`/`excerpt`/`coverUrl` 退化为"代表帖"的展示信息 ——
 *   取该地点最新一条有内容的帖子，让卡片不至于空着。
 *
 * ## 只保留"能定位"的地点
 *   必须**同时**有 latitude 与 longitude。缺任一个就**不出标记**
 *   （而不是给个默认坐标 —— 那会把标记放到几内亚湾，且用户无法察觉是假的）。
 *
 * ## 关于 color（**不夸大的部分**）
 *   原版**确实**有红/黄图钉，但**配色规则未知**（trident-map/baseline.json 的
 *   known_unknowns：「具体缩放级别与**标记规则未记录**」）。
 *   ⇒ 这里用**单一确定色**，并显式标注 NOT_EVALUATED，**不假装知道规则**。
 *   （P0 起分类筛选已经**明确**，本可以按分类配色，但那仍是"我们自己定的规则"；
 *     在没有基线的情况下换色只会让"看起来有依据"。故保持单色。）
 */
/** 卡片封面允许的最小边长（像素）。小于它的图当"没有合适图片"处理。 */
const MIN_COVER_EDGE_PX = 32

/**
 * 从代表帖里挑一个**可用**的封面。
 *
 * ⚠️ 只判断"有没有图"不够：库里可能躺着一张 1×1 的占位图（smoke 测试就会发这种），
 *    直接拿来当封面会渲染成一片白框。文档 §9 的纪律是「没有合适图片不生成占位照片」，
 *    所以这里按**尺寸**筛一遍；宽高未知时不擅自排除（避免误杀正常图）。
 */
function coverUrlOf(rep: ApiPost | undefined): string | undefined {
  if (!rep) return undefined
  if (rep.mapMediaId) return mediaUrl(rep.mapMediaId)
  const img = rep.images?.[0]
  if (!img) return undefined
  if (typeof img.width === "number" && typeof img.height === "number") {
    if (img.width < MIN_COVER_EDGE_PX || img.height < MIN_COVER_EDGE_PX) return undefined
  }
  return mediaUrl(img.id)
}

export function markersFromPlaces(
  places: ApiPlaceListItem[],
  posts: ApiPost[],
  center: [number, number] = CAMPUS_CENTER,
): MapMarker[] {
  // 像素换算：以校区中心为基准，1 度纬度 ≈ 111_320 m；经度按纬度收缩。
  // 仅离线自绘底图用；该换算的正确性记 NOT_EVALUATED（无基线可比）。
  const M_PER_DEG_LAT = 111_320
  const M_PER_DEG_LNG = 111_320 * Math.cos((center[0] * Math.PI) / 180)
  const PX_PER_M = 1
  return places
    .filter((p) => typeof p.latitude === 'number' && typeof p.longitude === 'number')
    .map((p) => {
      const lat = p.latitude as number
      const lng = p.longitude as number
      const dxM = (lng - center[1]) * M_PER_DEG_LNG
      const dyM = (lat - center[0]) * M_PER_DEG_LAT
      // 代表帖：该地点最新的一条（posts 已按时间倒序），用于卡片封面/摘要
      const rep = posts.find((post) => post.placeId === p.id || post.place === p.name)
      return {
        id: p.id,
        imageMode: rep?.imageMode,
        likeCount: rep?.likeCount ?? 0,
        // ⭐ 跳转目标是地点（P0 的核心改动）
        placeId: p.id,
        place: p.name,
        category: p.category,
        // ⚠️ 单一确定色：原版配色规则 NOT_EVALUATED（见函数头注释）
        color: '#f5453b',
        // 匿名帖（2026-11-05）：不带作者 id —— 地图卡片上点作者不该能定位到人
        userId: rep?.anonymous ? '' : rep?.authorId ?? '',
        postId: rep?.id ?? '',
        // SVG 像素空间：中心 = (700, 1000)；纬度越大越靠北 → y 越小
        x: Math.round(700 + dxM * PX_PER_M),
        y: Math.round(1000 - dyM * PX_PER_M),
        lat,
        lng,
        coverUrl: coverUrlOf(rep),
        excerpt: rep?.body ? rep.body.slice(0, 10) : undefined,
      }
    })
}

const MIN_SCALE = 0.6
const MAX_SCALE = 3

/* ============================================================================
   PLACE-005：从地点详情等页面返回地图时，保留打开前的位置与缩放
   ============================================================================
   ## 为什么要持久化，而不是"把状态留在组件里"
     路由切换会**卸载** `MapScreen`（`App.tsx` 按路由 switch 渲染），
     所以 `view` 与地图实例里的 center/zoom 在离开那一刻就没了。
     需求 5.4（PLACE-005）明确要求：从地点面板返回地图时保留打开前的位置与缩放。

   ## 存在哪、活多久
     · 地图视图 → `sessionStorage`：本次会话内有效。关掉 App 再进来会回到
       默认主校区视角 —— 这是 MAP-001「进入地图默认展示主校区」的要求，
       不是"忘记保存"。
     · 解析失败/隐私模式禁用存储 → 静默忽略（地图退化为默认视角，不影响使用）。**

   ## 为什么在线底图要**每秒采样**，而不是在卸载时读句柄
     `MapHandle` 只有 `getCenter()/getZoom()`，没有事件订阅；而且卸载时的 cleanup
     顺序不受我们控制（地图组件会先把句柄置 null）。所以按秒把当前视图采样进 ref，
     离开时直接用最后一次采样值，**不依赖卸载那一刻句柄是否还活着**。
     采样只在底图就绪后进行，开销是一次 getCenter/getZoom。
*/
const MAP_VIEW_KEY = 'campus.demo.mapView.v1'

interface SavedOfflineView {
  offline: true
  x: number
  y: number
  scale: number
}

interface SavedOnlineView {
  offline: false
  lat: number
  lng: number
  zoom: number
}

function readSavedMapView(): SavedOfflineView | SavedOnlineView | null {
  try {
    const raw = sessionStorage.getItem(MAP_VIEW_KEY)
    if (!raw) return null
    // 刻意按"未知结构"解析再逐字段校验：sessionStorage 里的东西可能被旧版本/手工改过
    const v = JSON.parse(raw) as Record<string, unknown>
    if (v.offline === true) {
      const { x, y, scale } = v
      if (typeof x === 'number' && typeof y === 'number' && typeof scale === 'number') {
        return { offline: true, x, y, scale }
      }
      return null
    }
    const { lat, lng, zoom } = v
    if (typeof lat === 'number' && typeof lng === 'number' && typeof zoom === 'number') {
      return { offline: false, lat, lng, zoom }
    }
    return null
  } catch {
    return null
  }
}

function writeSavedMapView(v: SavedOfflineView | SavedOnlineView): void {
  try {
    sessionStorage.setItem(MAP_VIEW_KEY, JSON.stringify(v))
  } catch {
    /* 隐私模式/配额满：忽略，地图退化为默认视角 */
  }
}

/**
 * 离线自绘地图 —— **降级方案**。
 * 在线瓦片连续加载失败（无网络 / 被墙 / 无 key）时使用，保证地图区域不是空白。
 * 拖拽、双击、捏合的数据都在这里处理。
 *
 * ⭐⭐ Round 266（审核记录 58 closeout 第 2 项）：**本组件不渲染权威标记**。
 *
 * ## 为什么（这是 correctness，不只是"原版一致性未评估"）
 *   · 权威数据只有 **lat/lng**（`posts.place_id → places`）
 *   · 而本组件是 **SVG 像素坐标系**（viewBox 1400×2000），需要 **x/y**
 *   · 我先前用"按 CAMPUS_CENTER 线性近似"把 lat/lng 换成 x/y，
 *     但**那个投影从未校准**（没有地理 bounds、没有参考锚点、没有误差 Gate）
 *   ⇒ 只要换算不准，标记就**画在错误位置**，而用户**无法察觉** ——
 *     这比"不显示"更糟：**它展示的是看似可信但可能错位的空间信息**。
 *     实测那 4 条权威标记里还有「广州达美乐」一项，而本底图是**校园级**的，
 *     一个未验证的换算更不可能安全表达它。
 *
 * ## 审核 58 的裁定（二选一）
 *   A（**已采用**）：offline 模式**不渲染**权威 geo 标记，并明确说明"离线不支持标记"
 *   B（将来可做）：定义 SVG 的地理 bounds / 投影 / 参考锚点 → 做**误差 Gate** → 再允许渲染
 *   ⚠️ 审核 58 特别指出：**不能**只把 `OFFLINE_MAP_PROJECTION_CONFORMANCE` 写成 NOT_EVALUATED
 *      却仍把标记画给用户看 —— 未评估的是"与原版是否一致"，
 *      而这里首先是"**我们画的位置对不对**"的 correctness 问题。
 *
 * 因此下面渲染 `offlineRenderable`（**恒为空**），并在页面上给出明确说明。
 * 将来若做 B，应把换算连同它的**误差 Gate** 一起加回来。
 */
function OfflineMap({
  view,
  markers,
  onTilesMeta,
}: {
  view: ViewState
  /** 权威派生的标记；**本组件刻意不渲染它们**（见上方说明） */
  markers: MapMarker[]
  onTilesMeta?: (el: HTMLDivElement | null) => void
}) {
  const offlineRenderable: MapMarker[] = []
  void markers
  const inv = 1 / view.scale
  return (
    <div
      className="map__world"
      style={{
        transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
        transformOrigin: '0 0',
      }}
    >
      <svg className="map__canvas" viewBox="0 0 1400 2000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="blocks" width="120" height="120" patternUnits="userSpaceOnUse">
            <rect width="120" height="120" fill="#f2f1ec" />
            <rect x="6" y="6" width="108" height="108" rx="4" fill="#eceae4" />
          </pattern>
        </defs>
        <rect x="-600" y="-600" width="2600" height="3200" fill="url(#blocks)" />
        <g stroke="#ffffff" strokeLinecap="round" fill="none">
          <path d="M-300 420 H1900" strokeWidth="26" />
          <path d="M-300 880 H1900" strokeWidth="34" />
          <path d="M-300 1320 H1900" strokeWidth="22" />
          <path d="M240 -300 V2200" strokeWidth="30" />
          <path d="M700 -300 V2200" strokeWidth="24" />
        </g>
        <path d="M-300 1520 C 200 1480, 620 1600, 1000 1520 S 1600 1430, 1900 1480" stroke="#bcd8ef" strokeWidth="44" fill="none" />
        <rect x="820" y="500" width="330" height="260" rx="14" fill="#d9e9cd" />
        <g fill="#8b8578" fontSize="26" fontFamily="PingFang SC, sans-serif">
          <text x="320" y="404">西直门外上园村路</text>
          <text x="980" y="864">高粱桥斜街</text>
        </g>
        <g fill="#4a4a4a" fontSize="24" fontFamily="PingFang SC, sans-serif">
          <text x="360" y="800">北京交通大学</text>
          <text x="800" y="1020">逸夫教学楼</text>
        </g>
      </svg>
      <div className="map__markers" ref={onTilesMeta}>
        {/* ⭐ Round 266：恒为空 —— 未校准投影前不计渲染权威标记（见组件头说明） */}
        {offlineRenderable.map((m) => (
          <div
            key={m.id}
            className="map__marker"
            style={{
              left: m.x,
              top: m.y,
              transform: `translate(-50%, -100%) scale(${inv})`,
              transformOrigin: '50% 100%',
            }}
          >
            <button className="map__markerCard" onClick={() => navigate('feed', { id: m.postId })}>
              <span className="map__markerImg map__markerImg--text">{m.place}</span>
              <span className="map__markerName">{m.place}</span>
            </button>
            <span className="map__pin" style={{ color: m.color }} aria-hidden>
              <svg width="20" height="26" viewBox="0 0 20 26">
                <path d="M10 25.5S19 15.6 19 9.6A9 9 0 0 0 1 9.6c0 6 9 15.9 9 15.9Z" fill="currentColor" />
                <circle cx="10" cy="9.6" r="3.4" fill="#fff" />
              </svg>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ============================================================================
   地图标记的缩放分级与避让
   ----------------------------------------------------------------------------
   修的是两个显示问题（见桌面 bugfix/图1、图2）：
     · 图1：30 个标记按经纬度直接摆，卡片互相叠成一坨。
     · 图2：没有帖子的地点也画白卡片，卡片里没有图/摘要 ⇒ 一片空白。

   ⚠️ 为什么不用「过滤 markers 数组」来实现：三个适配器的建图 effect 依赖 markers，
      换数组会让地图**重建**（文档 §10 明确警告过）。所以这里只在 **DOM 层**开关
      `.rm--hidden`，底图和标记实例都不动。

   ⚠️ 为什么是轮询：MapHandle 只有 getCenter/getZoom，没有视图订阅事件。
      每 250ms 读一次很便宜（30 个标记），且只在真正变化时重算。

   ⚠️ 分级阈值是**首轮取值**，没有真机校准过。各 provider 的 zoom 语义略有差异，
      拿到实机效果后应回写这里。
   ============================================================================ */

/** 没有 displayTier 数据时的兜底优先级：数字越小越优先留下 */
const MAP_CATEGORY_RANK: Record<string, number> = {
  校园地标: 1,
  食堂: 2,
  教学楼: 3,
  运动场: 4,
  休闲场所: 5,
}

const MAP_MARKER_LEVELS = {
  /** 低于此缩放：只显示帖子最多 / 类别最靠前的少数几个（校园总览） */
  overviewMaxZoom: 16.4,
  /** 低于此缩放：显示视口内前 localCount 个；达到或超过：显示视口内全部（局部 / 近景） */
  localMaxZoom: 17.4,
  overviewCount: 4,
  localCount: 10,
} as const

/** 排序键：有帖子 > 类别顺序 > 名称（保证同样输入下顺序稳定） */
function markerRank(m: MapMarker): [number, number, string] {
  return [m.postId ? 0 : 1, MAP_CATEGORY_RANK[m.category ?? ''] ?? 9, m.place]
}

function markersByPriority(markers: MapMarker[]): MapMarker[] {
  return [...markers].sort((a, b) => {
    const ra = markerRank(a)
    const rb = markerRank(b)
    if (ra[0] !== rb[0]) return ra[0] - rb[0]
    if (ra[1] !== rb[1]) return ra[1] - rb[1]
    return ra[2].localeCompare(rb[2], 'zh-CN')
  })
}

/** 当前缩放下应该显示哪些标记 */
function visibleMarkerIds(markers: MapMarker[], handle: MapHandle | null, zoom: number): Set<string> {
  const sorted = markersByPriority(markers)
  const size = handle?.getSize()
  const inViewport = (m: MapMarker) => {
    if (!handle || !size) return true
    const p = handle.project(m.lat, m.lng)
    if (!p) return true
    const pad = 80
    return p.x >= -pad && p.x <= size.width + pad && p.y >= -pad && p.y <= size.height + pad
  }
  if (zoom < MAP_MARKER_LEVELS.overviewMaxZoom) {
    return new Set(sorted.slice(0, MAP_MARKER_LEVELS.overviewCount).map((m) => m.placeId))
  }
  const inArea = sorted.filter(inViewport)
  if (zoom < MAP_MARKER_LEVELS.localMaxZoom) {
    return new Set(inArea.slice(0, MAP_MARKER_LEVELS.localCount).map((m) => m.placeId))
  }
  return new Set(inArea.map((m) => m.placeId))
}

/** 把可见集合写到 DOM 上（三套底图的标记都带 data-place-id） */
function applyMarkerVisibility(root: ParentNode | null, visible: Set<string>): void {
  if (!root) return
  root.querySelectorAll<HTMLElement>('.rm[data-place-id]').forEach((el) => {
    el.classList.toggle('rm--hidden', !visible.has(el.dataset.placeId ?? ''))
  })
}

/**
 * 避让：按优先级依次摆放，后放的只要和已放下的框相交就隐藏。
 * 只比较「卡片 / 名称标签」的盒子 —— 图钉很小，重叠也不影响读名字。
 */
function declutterMarkers(root: ParentNode | null, order: MapMarker[]): void {
  if (!root) return
  /*
    ⚠️ 先清掉上一轮的「只收起名称」。被收起的元素 display:none，量不到尺寸；
    不清就会永远保持收起。清 → 量 → 收 全在同一次同步调用里，浏览器不会中途绘制，所以不会闪。
  */
  root.querySelectorAll<HTMLElement>('.rm--collapsed').forEach((el) => el.classList.remove('rm--collapsed'))
  const placed: Array<{ left: number; right: number; top: number; bottom: number }> = []
  for (const m of order) {
    const el = root.querySelector<HTMLElement>(`.rm[data-place-id="${cssEscape(m.placeId)}"]`)
    if (!el || el.classList.contains('rm--hidden')) continue
    const box = (el.querySelector('.rm__card, .rm__label') as HTMLElement | null) ?? el
    const r = box.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const overlap = placed.some((p) => !(r.right < p.left || r.left > p.right || r.bottom < p.top || r.top > p.bottom))
    // ★ 放不下时**只收起名称/卡片，保留图钉** —— 用户仍能看到该地点、可点击进详情
    if (overlap) el.classList.add('rm--collapsed')
    else placed.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }
}

/** 地点 id 是 UUID，正常无需转义；这里仍兜底处理，避免拼选择器出错 */
function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`)
}

/** 定位状态徽标：把“是否真的拿到定位”显式显示出来，避免蓝点静默不动 */
function GeoBadge({
  status,
  fix,
  onRetry,
}: {
  status: GeoStatus
  fix: GeoFix | null
  onRetry: () => void
}) {
  if (status === 'idle') return null
  if (status === 'asking') return <span className="map__geoBadge">正在获取真实定位…</span>
  if (status === 'ok' && fix) {
    const source = fix.source === 'gps' ? 'GPS' : '网络定位'
    return (
      <span
        className="map__geoBadge"
        data-lat={fix.lat}
        data-lng={fix.lng}
        data-acc={fix.accuracy}
      >
        {`已定位 · ${source} ±${formatAccuracy(fix.accuracy)}`}
      </span>
    )
  }
  return (
    <button className="map__geoBadge map__geoBadge--action" onClick={onRetry}>
      {status === 'denied' ? '未授权定位 · 点击授权' : '定位超时 · 点击重试'}
    </button>
  )
}

export function MapScreen() {
  const route = useRoute()
  // #/map?offline=1 → 强制走离线自绘底图（用来演示/验收无网降级）
  const forceOffline = route.query.offline === '1'
  // #/map?raster=1 / ?amap=1 → 强制走指定兜底底图（用来验收各条降级路径）
  const forced = route.query.raster === '1' ? 'raster' : route.query.amap === '1' ? 'amap' : null
  // #/map?ask=1 → 强制弹出定位授权说明（验收真实触摸用；正常只在未授权时弹）
  const forceAsk = route.query.ask === '1'

  const [view, setView] = useState<ViewState>(() => {
    // PLACE-005：离线自绘底图的视图状态同样要保留（在线底图由句柄采样保存）
    const saved = readSavedMapView()
    return saved?.offline ? { x: saved.x, y: saved.y, scale: saved.scale } : { x: -260, y: -700, scale: 1 }
  })
  const [tipOpen, setTipOpen] = useState(false)
  const [tileFailed, setTileFailed] = useState(false)
  const [tilesOk, setTilesOk] = useState<boolean | null>(null)
  /** 在线底图来源：腾讯官方 SDK → 高德官方 SDK → 栅格瓦片 */
  const [providerState, setProviderState] = useState<'tencent' | 'amap' | 'raster'>('tencent')
  const provider = forced ?? providerState
  const offline = forceOffline || tileFailed

  /*
    ⭐ WO#15：标记改由**权威**数据派生（`GET /api/posts` 里带坐标的那些帖子）。
    ## 三态与"不撒谎"的纪律（与 WO#12/#13/#14 同一冻结）
      loading      → 明确"加载中"，**不显示标记**（不拿 mock 顶上）
      ready        → 显示派生标记（可能为空数组 —— 那是**诚实的空**，不是错误）
      unavailable  → 读到失败/未登录 → 明确不可用态 + **不显示标记**
    ⚠️ 刻意**没有** `|| mapMarkers` 这种回落：那正是 WO#12/#14 反复修掉的
       "用编造数据冒充真实"。
  */
  /*
    ⭐ WO#16 层 B 第 4 条：地区控件改接**权威实体**。
    ⚠️ 只取**学校名** —— 「当前选中校区」按审核 60 是 **DO NOT INFER**
      （没有任何依据说当前选的是校本部），所以**不**显示"（校本部）"。
      该差异登记为 MAP_REGION_CAMPUS_PART: OMITTED_NO_AUTHORITATIVE_SELECTION。
    ⚠️ 读不到时**不回落硬编码文案**（那会退回"看起来有数据"）⇒ 显示明确"学校未知"。
  */
  const [school, setSchool] = useState<ApiSchool | null>(null)
  const [schoolPhase, setSchoolPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    void (async () => {
      const r = await listSchools()
      if (r.ok && r.value.length > 0) {
        setSchool(r.value[0])
        setSchoolPhase('ready')
      } else {
        setSchool(null)
        setSchoolPhase('unavailable')
      }
    })()
  }, [])

  const [markers, setMarkers] = useState<MapMarker[]>([])
  const [published, setPublished] = useState<ApiPost | null>(null)
  /*
    发布成功落地的新帖 id 在挂载时固定（design §11.1）：打开抽屉会把 newPostId 从地址里去掉，
    若标记 effect 依赖 route.query.newPostId，就会重新请求、产生新数组并重建地图。
  */
  const [publishedPostId] = useState<string | null>(() => route.query.newPostId ?? null)
  const [showPublished, setShowPublished] = useState(Boolean(publishedPostId))
  const [selectedPlace, setSelectedPlace] = useState(route.query.placeId ?? '')
  const [markerPhase, setMarkerPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  /**
   * 重试计数器：`/api/places` 或 `/api/posts` 读失败时，用户可以**主动重试**。
   * 改前失败态只有一行「标记不可用（读取失败或未登录）」——**没有任何动作**，
   * 用户只能靠刷新整页（§12 要求"加载失败给明确反馈**并可重试**"）。
   */
  const [markerReload, setMarkerReload] = useState(0)
  /**
   * 帖子列表单独失败标记：地点能读到、帖子读不到时，改前是**静默降级**
   * （`const posts = po.ok ? po.value : []`），地图上看起来"这些地点都没有内容"。
   * 那是把"读不到"伪装成"没有"——必须显式说出来。
   */
  const [postsFailed, setPostsFailed] = useState(false)
  /*
    地标标签（复刻说明 §4）：applied = 已生效，draft = 面板草稿，只有「确定」才把草稿提交为 applied。
    面板打开时推入一条带 tmTags 标记的历史：系统返回 = 关闭并放弃草稿（与地点抽屉同一做法）。
  */
  const [appliedTags, setAppliedTags] = useState<PlaceCategory[]>([])
  const [draftTags, setDraftTags] = useState<PlaceCategory[]>([])
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsOpenRef = useRef(false)
  const tagsBtnRef = useRef<HTMLButtonElement | null>(null)
  const appliedKey = appliedTags.join(',')
  const appliedLabel = appliedTags.length ? appliedTags.join('、') : '全部'
  /*
    MAP-002 / MAP-003：地图内的「搜索地标」工具。

    ## 数据来源
      `GET /api/places?q=`（服务端子串匹配 name/address），只返回**团队维护的预设地点**
      ⇒ 天然满足 MAP-003「只允许搜索和选择预设地标」。
    ## 选中之后
      MAP-003 要求"地图移动并放大到该地标，同时打开该地点底部面板"。
      地点底部面板（PLACE-001）的形态要等地标详情那边一起定（见
      `docs/zjx/地图模块缺口登记-2026-10-19.md`），所以本轮先落到
      **飞到该地标 + 打开现有地点详情页**，并把目标视图存进会话，
      返回地图时人就停在这个地标上（PLACE-005）。
  */
  const [searchOpen, setSearchOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<ApiPlaceListItem[]>([])
  const [searchPhase, setSearchPhase] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')

  /*
    ⭐ P0：标记来源改为**地点**（按地点聚合），代表帖信息来自帖子列表。
    两者都走权威接口：
      · `GET /api/places`（**默认只返回启用地点** —— 停用地点自动退出地图，US-01⑤）
      · `GET /api/posts`（取每个地点的最新一条，用于标记卡片封面/摘要；可以为空）
    ⚠️ 分类筛选在**服务端**做（`?category=`）—— 与地点/帖子列表同一纪律。
    ⚠️ 刻意**没有** `|| mockMarkers` 这种回落：那正是 WO#12/#14 反复修掉的
       "用编造数据冒充真实"。空标记是**诚实的空**。
  */
  useEffect(() => {
    let alive = true
    void (async () => {
      setMarkerPhase('loading')
      const [pr, po] = await Promise.all([
        listPlaces(undefined, appliedKey ? (appliedKey.split(',') as PlaceCategory[]) : undefined),
        listPosts(),
      ])
      if (!alive) return
      if (!pr.ok) {
        setMarkers([])
        setPostsFailed(false)
        setMarkerPhase('unavailable')
        return
      }
      const posts = po.ok ? po.value : []
      setPostsFailed(!po.ok)
      const fresh = publishedPostId ? posts.find(p => p.id === publishedPostId) : undefined
      setPublished(fresh ?? null)
      setMarkers(markersFromPlaces(pr.value, fresh ? [fresh, ...posts.filter(p => p.id !== fresh.id)] : posts).map(m => ({ ...m, highlight: Boolean(fresh && m.postId === fresh.id) })))
      setMarkerPhase('ready')
    })()
    return () => {
      alive = false
    }
  }, [appliedKey, publishedPostId, markerReload])

  /*
    缩放分级 + 避让的驱动。
    只在 zoom / 中心 / 标记数量变化时重算，避免每 250ms 都读一遍布局。
  */
  useEffect(() => {
    if (markerPhase !== 'ready' || markers.length === 0) return
    let lastZoom = Number.NaN
    let lastCenter = ''
    let lastCount = -1
    /* ⚠️ 地图实例号也要进判断键：provider 降级 / 重建时标记 DOM 会被重新创建，
       新元素没有 rm--hidden；只看 zoom/中心会误判"没变化"而跳过重算。 */
    let lastInstance = ''

    const apply = () => {
      const handle = mapHandleRef.current
      const stage = stageRef.current
      if (!handle || !stage) return
      const zoom = handle.getZoom() ?? 16
      const center = handle.getCenter()
      const centerKey = center ? `${center.lat.toFixed(5)},${center.lng.toFixed(5)}` : ''
      const instance = stage.querySelector('[data-map-instance]')?.getAttribute('data-map-instance') ?? ''
      if (
        zoom === lastZoom &&
        centerKey === lastCenter &&
        markers.length === lastCount &&
        instance === lastInstance
      )
        return
      lastZoom = zoom
      lastCenter = centerKey
      lastCount = markers.length
      lastInstance = instance

      const visible = visibleMarkerIds(markers, handle, zoom)
      applyMarkerVisibility(stage, visible)
      /* 测试钩子（文档 §11 建议的可读状态）：当前缩放与可见标记数，便于机械校验分级是否生效 */
      stage.dataset.mapZoom = String(zoom)
      stage.dataset.mapVisibleCount = String(visible.size)
      declutterMarkers(
        stage,
        markersByPriority(markers).filter((m) => visible.has(m.placeId)),
      )
    }

    apply()
    const timer = window.setInterval(apply, 250)
    return () => window.clearInterval(timer)
  }, [markers, markerPhase])
  // ---- 真实定位 ----
  const [fix, setFix] = useState<GeoFix | null>(null)
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle')
  /** 被系统拒绝过至少一次 —— 此时再点“授权”不会弹框，需要引导去系统设置 */
  const [deniedOnce, setDeniedOnce] = useState(false)

  const drag = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const pinch = useRef<{ distance: number; scale: number } | null>(null)
  const lastTap = useRef(0)
  const lastTouch = useRef<{ x: number; y: number; moved: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const mapHandleRef = useRef<MapHandle | null>(null)
  const stopWatchRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!publishedPostId) return
    // 只收起提示，不再 setMarkers 清高亮：新数组会让地图重建（高亮是 6 次的 CSS 动画，自行停止）
    const timer = setTimeout(() => setShowPublished(false), 10000)
    return () => clearTimeout(timer)
  }, [publishedPostId])
  const markersRef = useRef(markers)
  const routeRef = useRef(route)
  useLayoutEffect(() => { markersRef.current = markers }, [markers])
  /** 只有 placeId、没有 sheet 的地址（发布后落地 / 「在地图中查看」）：每个 placeId 只飞一次 */
  const lastFlownRef = useRef<string | null>(null)
  useEffect(() => {
    const pid = route.query.placeId
    if (!pid || route.query.sheet !== undefined || lastFlownRef.current === pid) return
    const target = markers.find(m => m.placeId === pid)
    if (target && mapHandleRef.current) {
      mapHandleRef.current.flyTo(target.lat, target.lng, 18)
      lastFlownRef.current = pid
    }
  }, [markers, route.query.placeId, route.query.sheet])

  // ---- PLACE-005：视图采样 + 离开前保存（见文件头 MAP_VIEW_KEY 处的说明） ----
  const offlineRef = useRef(offline)
  const viewRef = useRef(view)
  /*
    ⚠️ 不在 render 期间写 ref（React 规则：ref 只在事件处理器/副作用里读写）⇒ 用 effect 同步。
    这两个 ref 只服务于 persistView（在事件处理器与定时器里读）。
  */
  useEffect(() => {
    offlineRef.current = offline
  }, [offline])
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const lastOnlineViewRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null)
  /** 底图实例创建时刻 —— persistView 用它区分"刚建图（位置还是默认值）"与"用户真的看过这里" */
  const mapCreatedAtRef = useRef(0)
  /** 仅用于验收钩子：本次进入地图是否恢复了上次的视图 */
  const [viewRestored, setViewRestored] = useState<'none' | 'offline' | 'online'>('none')

  /** 把"当前地图视图"写进会话存储。离开地图去别处之前调用一次。 */
  const persistView = useCallback(() => {
    if (offlineRef.current) {
      const v = viewRef.current
      writeSavedMapView({ offline: true, x: v.x, y: v.y, scale: v.scale })
      return
    }
    /*
      ## 为什么要有 1.5s 的"刚建图"窗口
        底图实例刚创建时它的 center 是**默认校园中心**，而我们的恢复（flyTo）还在飞。
        dev 的 StrictMode 会 double-invoke effect（挂载→立即清理→再挂载），
        清理时若直接读句柄，就会把"默认中心"当成用户视图写进存储 ——
        实测表现：从详情返回地图后被立刻重置回默认位置（2026-10-19 浏览器实测）。
      ⇒ 窗口内一律用"上一次采样/恢复值"，窗口外才用活的句柄（这样拖动后的精确位置也不会丢）。
    */
    const handle = mapHandleRef.current
    const last = lastOnlineViewRef.current
    const justCreated = Date.now() - mapCreatedAtRef.current < 1500
    const liveCenter = justCreated ? null : handle?.getCenter()
    const liveZoom = justCreated ? null : handle?.getZoom()
    const center = liveCenter ?? (last ? { lat: last.lat, lng: last.lng } : null)
    const zoom = typeof liveZoom === 'number' ? liveZoom : last?.zoom
    if (center && typeof zoom === 'number') {
      writeSavedMapView({ offline: false, lat: center.lat, lng: center.lng, zoom })
    }
  }, [])

  /*
    在线底图：每秒采样一次当前中心/缩放（理由见文件头：卸载时句柄可能已被置 null）。
    ⚠️ 条件只有 `!offline` —— 不能等"标记 ready"：标记读不到（未登录/后端不可用）时
       地图照样可以拖动缩放，而那时恰恰更需要采样兜住卸载瞬间的视图。
  */
  useEffect(() => {
    if (offline) return
    const timer = window.setInterval(() => {
      const h = mapHandleRef.current
      const center = h?.getCenter()
      const zoom = h?.getZoom()
      if (center && typeof zoom === 'number') lastOnlineViewRef.current = { lat: center.lat, lng: center.lng, zoom }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [offline])

  // 离线底图：初始 view 已在 useState 初始化时恢复；这里只登记验收状态
  useEffect(() => {
    const saved = readSavedMapView()
    if (offline && saved?.offline) setViewRestored('offline')
  }, [offline])

  /*
    切换底部 tab（不经过本页任何按钮）或关闭页面时也要保存一次视图。
    这条不依赖句柄是否还活着：persistView 用的是每秒采样的 lastOnlineViewRef。
  */
  useEffect(() => {
    const onHide = () => persistView()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      persistView()
    }
  }, [persistView])

  // MAP-003：搜索走服务端（与地点列表同一纪律：不在客户端 filter）
  useEffect(() => {
    if (!searchOpen) return
    let alive = true
    setSearchPhase('loading')
    const timer = window.setTimeout(() => {
      void (async () => {
        const r = await listPlaces(keyword || undefined)
        if (!alive) return
        if (!r.ok) {
          setSearchResults([])
          setSearchPhase('unavailable')
          return
        }
        setSearchResults(r.value)
        setSearchPhase('ready')
      })()
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [searchOpen, keyword])

  /* ==========================================================================
     地点抽屉（spec 2026-11-02；design.md §7–§11）
     ==========================================================================
     · 状态只在这里（SheetState），URL #/map?placeId=&sheet= 只做镜像：
       打开推入一条带 tmSheet 标记的历史；档位变化、切换地点用 replaceState。
     · 地图不重建：handleMapRef / handleMarkerClick 是空依赖的稳定回调，经 ref 读最新值。
     · 选中地点移到露出区域：native/mapFocus.ts，按实测标记高度计算。
  */
  const [sheetInit] = useState(() => {
    const q = parseSheetQuery(route.query)
    return { q, snap: q ? readSheetSnapshot(q.placeId) : null }
  })
  const [sheet, setSheet] = useState<SheetState>(() => sheetInit.q
    ? { placeId: sheetInit.q.placeId, detent: sheetInit.q.detent, phase: 'opening', token: 1 }
    : { placeId: null, detent: 'closed', phase: 'open', token: 0 })
  const sheetRef = useRef(sheet)
  const commitSheet = useCallback((next: SheetState) => { sheetRef.current = next; setSheet(next) }, [])
  const preOpenViewRef = useRef(sheetInit.snap?.preOpenView ?? null)
  const userMovedMapRef = useRef(sheetInit.snap?.userMovedMap ?? false)
  const userMovedSinceFocusRef = useRef(false)
  /** 从快照恢复后，用户第一次操作前不做自动定位，避免覆盖恢复的视野 */
  const suppressAutoFocusRef = useRef(Boolean(sheetInit.snap))
  /** 深链 / 快照恢复的首次定位要等地图句柄（和坐标）就绪 */
  const focusPendingRef = useRef<'restore' | 'deeplink' | null>(sheetInit.q ? (sheetInit.snap ? 'restore' : 'deeplink') : null)
  const contentScrollTopRef = useRef(sheetInit.snap?.scrollTop ?? 0)
  const [initialScrollTop] = useState(() => sheetInit.snap?.scrollTop ?? 0)
  const closingRef = useRef(false)
  const pendingRestoreRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const coordsRef = useRef(new Map<string, { lat: number; lng: number }>())
  const lastFocusRef = useRef<{ placeId: string | null; detent: Detent; key: string }>({ placeId: sheetInit.q?.placeId ?? null, detent: sheetInit.q?.detent ?? 'closed', key: '' })
  const tipPendingRef = useRef(false)
  const sheetHostRef = useRef<HTMLDivElement | null>(null)
  const [dims, setDims] = useState(() => ({ H: typeof window === 'undefined' ? 800 : window.innerHeight - 58, headH: 108 }))
  const snaps = useMemo(() => computeSnaps(dims.H, dims.headH), [dims.H, dims.headH])
  const snapsRef = useRef(snaps)
  const sheetOpen = sheet.placeId !== null
  const sheetActive = sheetOpen && sheet.phase !== 'closing'
  const headerHidden = sheetActive && (sheet.detent === 'expanded' || snaps.single)

  useLayoutEffect(() => { routeRef.current = route }, [route])
  useLayoutEffect(() => { snapsRef.current = snaps }, [snaps])
  // App 据此隐藏底部主导航；卸载时不重置（design §7.7）
  useLayoutEffect(() => { setPlaceSheetOpen(sheetOpen) }, [sheetOpen])

  const debugQuery = useCallback((): Record<string, string> => {
    const q: Record<string, string> = {}
    for (const k of DEBUG_KEYS) { const v = routeRef.current.query[k]; if (v !== undefined) q[k] = v }
    return q
  }, [])
  const sheetHash = useCallback((placeId: string, detent: OpenDetent) => buildHash('map', { placeId, sheet: detent, ...debugQuery() }), [debugQuery])
  /** 推入一条抽屉历史并打标记：后退会关闭抽屉而不是离开应用 */
  const pushSheetEntry = useCallback((placeId: string, detent: OpenDetent) => {
    navigate('map', { placeId, sheet: detent, ...debugQuery() })
    window.history.replaceState({ ...(window.history.state ?? {}), tmSheet: 1 }, '', window.location.hash)
  }, [debugQuery])

  const coordsOf = useCallback((placeId: string) => {
    const m = markersRef.current.find(x => x.placeId === placeId)
    return m ? { lat: m.lat, lng: m.lng } : coordsRef.current.get(placeId) ?? null
  }, [])

  /** 把选中地点移到抽屉上方露出区域（每次档位稳定、切换地点、尺寸变化时调用） */
  const runFocus = useCallback((reason: 'select' | 'detent' | 'resize' | 'deeplink') => {
    const s = sheetRef.current
    const h = mapHandleRef.current
    const stage = stageRef.current
    const host = sheetHostRef.current
    if (!s.placeId || s.detent === 'closed' || !h || !stage || !host) return
    h.setSelected(s.placeId)
    const c = coordsOf(s.placeId)
    if (!c) return
    // 用当前 DOM 重算高度：主导航刚隐藏时 state 里的 H 可能还没更新
    const page = stage.closest('.map-page') as HTMLElement | null
    const sn = page ? computeSnaps(page.clientHeight, dims.headH) : snapsRef.current
    const mapRect = stage.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const visibleTop = 8
    const visibleBottom = Math.round(hostRect.bottom - visibleHeight(s.detent, sn) - mapRect.top - MARKER_GAP_PX)
    const key = `${s.placeId}|${s.detent}|${visibleBottom}|${Math.round(mapRect.height)}`
    if (reason === 'resize' && key === lastFocusRef.current.key) return
    lastFocusRef.current = { ...lastFocusRef.current, key }
    const animate = (reason === 'select' || reason === 'detent') && !prefersReducedMotion()
    const r = focusInVisibleArea(h, { ...c, placeId: s.placeId }, { zoom: reason === 'deeplink' ? 18 : h.getZoom() ?? 16, visibleTop, visibleBottom, animate })
    userMovedSinceFocusRef.current = false
    stage.dataset.focusTop = String(visibleTop)
    stage.dataset.focusBottom = String(visibleBottom)
    stage.dataset.focusAnchor = String(Math.round(r.anchorY))
    stage.dataset.focusAnimate = String(animate)
    stage.dataset.focusMode = r.mode
  }, [coordsOf, dims.headH])

  /** 关闭后恢复打开前的视野（用户在抽屉打开期间没有操作过地图时） */
  const restorePreOpenView = useCallback(() => {
    const r = pendingRestoreRef.current
    const h = mapHandleRef.current
    if (!r || !h || sheetRef.current.placeId !== null) return
    pendingRestoreRef.current = null
    h.resize()
    h.setView(r.lat, r.lng, r.zoom, !prefersReducedMotion())
  }, [])

  const startClose = useCallback(() => {
    const s = sheetRef.current
    if (!s.placeId || s.phase === 'closing') return
    mapHandleRef.current?.setSelected(null)
    pendingRestoreRef.current = !userMovedMapRef.current && preOpenViewRef.current ? preOpenViewRef.current : null
    preOpenViewRef.current = null
    userMovedMapRef.current = false
    userMovedSinceFocusRef.current = false
    suppressAutoFocusRef.current = false
    focusPendingRef.current = null
    clearSheetSnapshot()
    commitSheet({ ...s, detent: 'closed', phase: 'closing', token: s.token + 1 })
  }, [commitSheet])

  const beginOpen = useCallback((placeId: string, detent: OpenDetent) => {
    const s = sheetRef.current
    const h = mapHandleRef.current
    const c = h?.getCenter()
    const z = h?.getZoom()
    preOpenViewRef.current = c && typeof z === 'number' ? { lat: c.lat, lng: c.lng, zoom: z } : null
    userMovedMapRef.current = false
    userMovedSinceFocusRef.current = false
    suppressAutoFocusRef.current = false
    focusPendingRef.current = null
    pendingRestoreRef.current = null
    contentScrollTopRef.current = 0
    if (s.phase !== 'closing') returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelectedPlace(placeId)
    commitSheet({ placeId, detent, phase: 'opening', token: s.token + 1 })
  }, [commitSheet])

  /** 点击标记 / 搜索选中：关闭态打开，打开态切换地点（回到预览），同一地点不变 */
  const openOrSwitch = useCallback((placeId: string, coords?: { lat: number; lng: number } | null) => {
    if (coords) coordsRef.current.set(placeId, coords)
    const s = sheetRef.current
    if (s.placeId === placeId && s.phase !== 'closing') return
    if (s.placeId === null || s.phase === 'closing') {
      pushSheetEntry(placeId, 'preview')
      beginOpen(placeId, 'preview')
      return
    }
    suppressAutoFocusRef.current = false
    contentScrollTopRef.current = 0
    setSelectedPlace(placeId)
    window.history.replaceState(window.history.state, '', sheetHash(placeId, 'preview'))
    commitSheet({ ...s, placeId, detent: 'preview' })
  }, [beginOpen, commitSheet, pushSheetEntry, sheetHash])

  const requestDetent = useCallback((d: OpenDetent) => {
    const s = sheetRef.current
    if (!s.placeId || s.phase === 'closing') return
    suppressAutoFocusRef.current = false
    if (d === s.detent) return
    window.history.replaceState(window.history.state, '', sheetHash(s.placeId, d))
    commitSheet({ ...s, detent: d })
  }, [commitSheet, sheetHash])

  const requestClose = useCallback(() => {
    const s = sheetRef.current
    if (!s.placeId || s.phase === 'closing') return
    if (window.history.state?.tmSheet === 1) {
      closingRef.current = true
      window.history.back()
      return
    }
    window.history.replaceState(null, '', buildHash('map', debugQuery()))
    startClose()
  }, [debugQuery, startClose])

  // 地址变化（后退 / 前进 / 深链）：以自身状态为准对比（design §10.3）
  useEffect(() => {
    // 正在离开地图（简介页、帖子、发布页…）：不是后退拦截，什么都不做；快照由卸载时写入
    if (route.path !== 'map') return
    const target = parseSheetQuery(route.query)
    const s = sheetRef.current
    const active = s.placeId !== null && s.phase !== 'closing'
    if (!target) {
      if (route.query.sheet !== undefined) window.history.replaceState(null, '', buildHash('map', debugQuery()))
      if (!active) return
      if (s.detent === 'expanded' && !closingRef.current) {
        // 后退顺序：展开 → 预览 → 关闭
        pushSheetEntry(s.placeId!, 'preview')
        commitSheet({ ...s, detent: 'preview' })
      } else {
        closingRef.current = false
        startClose()
      }
      return
    }
    // 没有标记的抽屉地址（深链、从其他页面 navigate 过来）：先把当前条目改成关闭态地图再推入（幂等）
    if (window.history.state?.tmSheet !== 1) {
      window.history.replaceState(null, '', buildHash('map', debugQuery()))
      pushSheetEntry(target.placeId, target.detent)
    }
    if (active && s.placeId === target.placeId && s.detent === target.detent) return
    if (!active) beginOpen(target.placeId, target.detent)
    else commitSheet({ ...s, placeId: target.placeId, detent: target.detent })
  }, [route, beginOpen, commitSheet, debugQuery, pushSheetEntry, startClose])

  // 动画阶段：不依赖 transitionend（减少动效下不会触发），由定时器结束
  useEffect(() => {
    if (sheet.phase === 'open') return
    const timer = window.setTimeout(() => {
      const s = sheetRef.current
      if (s.phase === 'opening') { commitSheet({ ...s, phase: 'open' }); return }
      if (s.phase !== 'closing') return
      commitSheet({ placeId: null, detent: 'closed', phase: 'open', token: s.token })
      // 打开前的视野在主导航恢复、.map 变矮之后由 ResizeObserver 恢复；尺寸没变时由这里兜底
      window.setTimeout(restorePreOpenView, 200)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = returnFocusRef.current
        returnFocusRef.current = null
        if (el && el.isConnected && el.getClientRects().length > 0) el.focus({ preventScroll: true })
        else document.querySelector<HTMLElement>('[data-map-tool="search"]')?.focus({ preventScroll: true })
        if (tipPendingRef.current) { tipPendingRef.current = false; setTipOpen(true) }
      }))
    }, prefersReducedMotion() ? 0 : DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [sheet.phase, sheet.token, commitSheet, restorePreOpenView])

  // 档位稳定、切换地点、可用高度变化 → 重新定位
  useEffect(() => {
    if (!sheet.placeId || sheet.detent === 'closed' || sheet.phase === 'closing') return
    const last = lastFocusRef.current
    const reason = last.placeId !== sheet.placeId ? 'select' : last.detent !== sheet.detent ? 'detent' : 'resize'
    lastFocusRef.current = { ...last, placeId: sheet.placeId, detent: sheet.detent }
    if (focusPendingRef.current) return
    if (reason !== 'select' && (userMovedSinceFocusRef.current || suppressAutoFocusRef.current)) return
    const raf = requestAnimationFrame(() => runFocus(reason))
    return () => cancelAnimationFrame(raf)
  }, [sheet.placeId, sheet.detent, sheet.phase, snaps.previewH, snaps.expandedH, headerHidden, runFocus])

  // 可用高度 H（.map-page）与头部高度；.map 尺寸变化时通知地图 SDK
  useLayoutEffect(() => {
    const stage = stageRef.current
    const page = stage?.closest('.map-page') as HTMLElement | null
    if (!stage || !page) return
    const measure = () => {
      const head = page.querySelector<HTMLElement>('.map__head')
      const cats = page.querySelector<HTMLElement>('.map__toolbar')
      setDims(prev => {
        const H = page.clientHeight || prev.H
        const headH = head ? head.offsetHeight + (cats?.offsetHeight ?? 0) : prev.headH
        return H === prev.H && headH === prev.headH ? prev : { H, headH }
      })
    }
    measure()
    if (typeof ResizeObserver !== 'function') return
    let raf = 0
    const ro = new ResizeObserver(entries => {
      measure()
      if (entries.some(e => e.target === stage)) {
        mapHandleRef.current?.resize()
        restorePreOpenView()
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          const s = sheetRef.current
          if (!s.placeId || s.phase === 'closing' || userMovedSinceFocusRef.current || suppressAutoFocusRef.current || focusPendingRef.current) return
          runFocus('resize')
        })
      }
    })
    ro.observe(page)
    ro.observe(stage)
    for (const el of page.querySelectorAll('.map__head, .map__toolbar')) ro.observe(el)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [headerHidden, runFocus, restorePreOpenView])

  // 抽屉打开期间：用户拖动 / 缩放地图（> 8px、双指、滚轮）后关闭时保留其视野
  useEffect(() => {
    const stage = stageRef.current
    if (!sheetActive || !stage) return
    const downs = new Map<number, { x: number; y: number }>()
    const mark = () => { userMovedMapRef.current = true; userMovedSinceFocusRef.current = true; suppressAutoFocusRef.current = false }
    const onDown = (e: PointerEvent) => { downs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (downs.size > 1) mark() }
    const onMove = (e: PointerEvent) => { const d = downs.get(e.pointerId); if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) mark() }
    const onUp = (e: PointerEvent) => { downs.delete(e.pointerId) }
    stage.addEventListener('pointerdown', onDown, true)
    stage.addEventListener('pointermove', onMove, true)
    stage.addEventListener('pointerup', onUp, true)
    stage.addEventListener('pointercancel', onUp, true)
    stage.addEventListener('wheel', mark, { capture: true, passive: true })
    return () => {
      stage.removeEventListener('pointerdown', onDown, true)
      stage.removeEventListener('pointermove', onMove, true)
      stage.removeEventListener('pointerup', onUp, true)
      stage.removeEventListener('pointercancel', onUp, true)
      stage.removeEventListener('wheel', mark, { capture: true })
    }
  }, [sheetActive])

  // 离开地图时记下抽屉快照（返回时恢复地点、档位、正文滚动）
  useEffect(() => () => {
    const s = sheetRef.current
    if (!s.placeId || s.phase === 'closing' || s.detent === 'closed') return
    writeSheetSnapshot({ placeId: s.placeId, detent: s.detent, scrollTop: contentScrollTopRef.current, preOpenView: preOpenViewRef.current, userMovedMap: userMovedMapRef.current })
  }, [])

  /** 抽屉内跳转：先保存地图视野，再进入目标页 */
  const leaveSheetTo = useCallback((path: string, query: Record<string, string>) => {
    persistView()
    navigate(path, query)
    if (path === 'place-intro') window.history.replaceState({ tmIntroFromSheet: 1 }, '', window.location.hash)
  }, [persistView])

  const onSheetPlaceLoaded = useCallback((p: ApiPlaceDetail) => {
    if (typeof p.latitude !== 'number' || typeof p.longitude !== 'number') return
    const had = coordsOf(p.id) !== null
    coordsRef.current.set(p.id, { lat: p.latitude, lng: p.longitude })
    if (had || sheetRef.current.placeId !== p.id) return
    // 标记列表里没有这个地点（被分类筛掉或尚未加载）：用详情坐标补一次定位
    if (focusPendingRef.current === 'deeplink' && mapHandleRef.current) {
      focusPendingRef.current = null
      requestAnimationFrame(() => runFocus('deeplink'))
    } else if (!focusPendingRef.current && !suppressAutoFocusRef.current) {
      requestAnimationFrame(() => runFocus('select'))
    }
  }, [coordsOf, runFocus])

  /**
   * 搜索选中一个预设地标：关闭搜索面板，打开（或切换到）该地点的抽屉。
   * 坐标优先取标记，其次取搜索结果；分类不切换（design §11.2）。
   */
  const pickPlace = useCallback((p: ApiPlaceListItem) => {
    setSearchOpen(false)
    setKeyword('')
    setSearchResults([])
    setSearchPhase('idle')
    const coords = typeof p.latitude === 'number' && Number.isFinite(p.latitude) && typeof p.longitude === 'number' && Number.isFinite(p.longitude)
      ? { lat: p.latitude, lng: p.longitude } : null
    openOrSwitch(p.id, coords)
  }, [openOrSwitch])

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

  const startTracking = useCallback(async () => {
    stopWatchRef.current?.()
    stopWatchRef.current = await watchFix((next) => {
      setFix(next)
      setGeoStatus('ok')
    })
  }, [])

  /** 走完整的“请求权限 → 取一次坐标 → 持续跟踪”流程 */
  const requestGeo = useCallback(async () => {
    setGeoStatus('asking')
    const granted = await ensureLocationPermission()
    if (!granted) {
      // 系统已经拒绝过（或用户勾了“不再询问”）时，requestPermissions 不会再弹框，
      // 这时只能明确告诉用户去哪里手动开，不要让人对着一个没反应的按钮反复点。
      setGeoStatus('denied')
      setDeniedOnce(true)
      return
    }
    setDeniedOnce(false)
    const first = await getCurrentFix()
    if (first) {
      setFix(first)
      setGeoStatus('ok')
    } else {
      setGeoStatus('timeout')
    }
    await startTracking()
  }, [startTracking])

  // 进地图时静默判断：已授权就直接显示真实位置且不打扰；未授权才弹说明。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const granted = await hasLocationPermission()
      if (cancelled) return
      if (!granted || forceAsk) {
        // 抽屉开着时不自动弹（会被抽屉盖住），关闭后补弹一次
        if (sheetRef.current.placeId) tipPendingRef.current = true
        else setTipOpen(true)
      }
      if (!granted) return
      const first = await getCurrentFix()
      if (cancelled) return
      if (first) {
        setFix(first)
        setGeoStatus('ok')
      }
      if (cancelled) return
      await startTracking()
    })()
    return () => {
      cancelled = true
      stopWatchRef.current?.()
      stopWatchRef.current = null
    }
  }, [startTracking, forceAsk])

  /** 我离校园有多远 —— 模拟器/异地定位时提示，避免蓝点“凭空消失” */
  const farFromCampus = fix ? distanceMeters(fix.lat, fix.lng, CAMPUS_CENTER[0], CAMPUS_CENTER[1]) : 0
  const showFar = Boolean(fix) && farFromCampus > 20000

  // ---- 离线地图手势（在线时由 Leaflet 接管）----
  const registerTap = useCallback((moved: number) => {
    if (moved > 8) return
    const now = Date.now()
    if (now - lastTap.current < 320) {
      setView((v) => ({ ...v, scale: clampScale(v.scale >= 2 ? 1 : v.scale * 1.6) }))
      lastTap.current = 0
      return
    }
    lastTap.current = now
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!offline) return
      if (e.pointerType === 'touch' && e.isPrimary === false) return
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, originX: view.x, originY: view.y }
    },
    [offline, view.x, view.y],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current
      if (!offline || !d || d.id !== e.pointerId) return
      setView((v) => ({ ...v, x: d.originX + (e.clientX - d.startX), y: d.originY + (e.clientY - d.startY) }))
    },
    [offline],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current
      if (!offline || !d || d.id !== e.pointerId) return
      drag.current = null
      registerTap(Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY))
    },
    [offline, registerTap],
  )

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!offline) return
      const t = e.touches[0]
      if (!t) return
      lastTouch.current = { x: t.clientX, y: t.clientY, moved: 0 }
    },
    [offline],
  )

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!offline) return
      const start = lastTouch.current
      const first = e.touches[0]
      if (start && first) {
        start.moved = Math.max(start.moved, Math.hypot(first.clientX - start.x, first.clientY - start.y))
      }
      if (e.touches.length !== 2) return
      const [a, b] = [e.touches[0], e.touches[1]]
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      if (pinch.current === null) {
        pinch.current = { distance, scale: view.scale }
        return
      }
      const base = pinch.current
      setView((v) => ({ ...v, scale: clampScale(base.scale * (distance / base.distance)) }))
    },
    [offline, view.scale],
  )

  const onTouchEnd = useCallback(() => {
    if (!offline) return
    pinch.current = null
    const t = lastTouch.current
    if (t) registerTap(t.moved)
    lastTouch.current = null
  }, [offline, registerTap])

  // 桌面滚轮缩放（仅离线地图需要；在线时 Leaflet 自带）
  useEffect(() => {
    if (!offline) return
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => ({ ...v, scale: clampScale(v.scale * (e.deltaY > 0 ? 0.9 : 1.1)) }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [offline])

  /** 回到“我的位置”：有真实坐标就去真实坐标，否则回校园中心 */
  const recenter = useCallback(() => {
    const handle = mapHandleRef.current
    const target: [number, number] = fix ? [fix.lat, fix.lng] : CAMPUS_CENTER
    if (!offline && handle) {
      handle.flyTo(target[0], target[1], 16)
      return
    }
    setView({ x: -260, y: -700, scale: 1 })
  }, [offline, fix])

  const handleTilesFailed = useCallback(() => {
    setTilesOk(false)
    setTileFailed(true)
  }, [])

  /** 腾讯 SDK 加载失败 → 退回高德官方 SDK */
  const handleTencentFailed = useCallback(() => {
    console.warn('Tencent GL SDK unavailable, falling back to Amap JSAPI')
    setProviderState('amap')
  }, [])

  /** 高德 SDK 也失败 → 退回无 key 的栅格瓦片 */
  const handleAmapFailed = useCallback(() => {
    console.warn('Amap JSAPI unavailable, falling back to raster tiles')
    setProviderState('raster')
  }, [])

  // 注意：这两个回调必须保持稳定引用，否则地图组件的建图 effect 会每次渲染都销毁重建地图
  const handleMarkerClick = useCallback((placeId: string, postId?: string) => {
    /*
      ⭐ P0：点击标记进**地点详情**（不再是动态详情）。
      理由见 markersFromPlaces 的说明：地图的组织单位是地点（需求 4.1/4.2）。
      ⚠️ 不回落到 postId —— 两者的语义不同，混用会让"点进哪个地点"变得不可预测。
    */
    // 代表帖卡片仍进帖子详情（离开前保存视图，返回时停在同一处）；地点区域打开地点抽屉
    if (postId) { persistView(); navigate('feed', { id: postId }); return }
    openOrSwitch(placeId)
  }, [persistView, openOrSwitch])

  /*
    ⚠️ 空依赖的稳定回调：三个地图组件的建图 effect 依赖它，依赖 markers / placeId
       会让每次打开抽屉、切换地点都销毁重建地图（design §11.1）。最新值经 ref 读取。
  */
  const handleMapRef = useCallback((handle: MapHandle | null) => {
    mapHandleRef.current = handle
    if (!handle) return
    mapCreatedAtRef.current = Date.now()
    setTilesOk(true)
    const s = sheetRef.current
    if (s.placeId && s.phase !== 'closing') {
      const pending = focusPendingRef.current
      if (pending === 'restore') {
        // 从简介页等返回：恢复离开前保存的视野，不重新定位
        const v = readSavedMapView()
        if (v && !v.offline) {
          handle.setView(v.lat, v.lng, v.zoom, false)
          lastOnlineViewRef.current = { lat: v.lat, lng: v.lng, zoom: v.zoom }
          setViewRestored('online')
        }
        focusPendingRef.current = null
      } else if (pending === 'deeplink') {
        const c = coordsOf(s.placeId)
        if (c) {
          handle.setView(c.lat, c.lng, 18, false)
          focusPendingRef.current = null
          requestAnimationFrame(() => runFocus('deeplink'))
        }
      } else if (lastOnlineViewRef.current) {
        const l = lastOnlineViewRef.current
        handle.setView(l.lat, l.lng, l.zoom, false)
      }
      handle.setSelected(s.placeId)
      return
    }
    // ① URL 只指定了地点（发布后回到地图）→ 飞到该地点，每个 placeId 只飞一次
    const pid = routeRef.current.query.placeId
    const target = pid ? markersRef.current.find(m => m.placeId === pid) : undefined
    if (target && lastFlownRef.current !== pid) {
      handle.flyTo(target.lat, target.lng, 18)
      lastFlownRef.current = pid ?? null
      lastOnlineViewRef.current = { lat: target.lat, lng: target.lng, zoom: 18 }
      return
    }
    /*
      ② 恢复视图（PLACE-005）。
      ⚠️ 这里**每次地图实例重建**都要恢复，不能"只恢复一次"：三个底图组件的建图 effect
         把 `markers` 放在依赖里，标记刷新会导致**地图实例重建**、回到默认中心。
         实测踩到：恢复成功后标记一刷新，人又被拽回校园中心（2026-10-19 浏览器实测）。
      ⇒ 优先级：本实例内累计的最新视图（lastOnlineViewRef，含用户刚拖到的地方）
               > 会话里存的离开前视图。
    */
    const live = lastOnlineViewRef.current
    const saved = live ?? (() => {
      const v = readSavedMapView()
      return v && !v.offline ? { lat: v.lat, lng: v.lng, zoom: v.zoom } : null
    })()
    if (saved) {
      lastOnlineViewRef.current = saved
      handle.flyTo(saved.lat, saved.lng, saved.zoom)
      setViewRestored('online')
    }
  }, [coordsOf, runFocus])

  // ---- 地标标签面板（复刻说明 §4）----
  const openTags = useCallback(() => {
    setDraftTags(appliedTags)
    tagsOpenRef.current = true
    setTagsOpen(true)
    navigate('map', { ...debugQuery(), tags: '1' })
    window.history.replaceState({ ...(window.history.state ?? {}), tmTags: 1 }, '', window.location.hash)
  }, [appliedTags, debugQuery])
  /** 收起：apply=true 提交草稿（确定）；否则放弃草稿。弹掉打开时推入的那条历史。 */
  const closeTags = useCallback((apply: boolean) => {
    if (!tagsOpenRef.current) return
    tagsOpenRef.current = false
    setTagsOpen(false)
    if (apply) setAppliedTags(draftTags)
    if (window.history.state?.tmTags === 1) window.history.back()
  }, [draftTags])
  // 系统返回 / 地址里已没有 tags：关闭并放弃草稿；地址残留 tags（刷新、前进）但面板未开：清掉
  useEffect(() => {
    if (route.path !== 'map') return
    if (route.query.tags === undefined) {
      if (tagsOpenRef.current) { tagsOpenRef.current = false; setTagsOpen(false) }
    } else if (!tagsOpenRef.current) {
      window.history.replaceState(null, '', buildHash('map', debugQuery()))
    }
  }, [route, debugQuery])
  // 打开搜索或地点抽屉时收起筛选（放弃草稿），避免面板相互遮挡
  useEffect(() => {
    if ((sheetActive || searchOpen) && tagsOpenRef.current) { tagsOpenRef.current = false; setTagsOpen(false) }
  }, [sheetActive, searchOpen])
  // Esc：收起并放弃草稿
  useEffect(() => {
    if (!tagsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      closeTags(false)
      tagsBtnRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tagsOpen, closeTags])

  // Esc：与后退一致（展开 → 预览 → 关闭）；搜索面板或定位授权弹窗打开时不处理
  useEffect(() => {
    if (!sheetActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || searchOpen || tipOpen) return
      e.preventDefault()
      if (sheetRef.current.detent === 'expanded' && !snapsRef.current.single) requestDetent('preview')
      else requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetActive, searchOpen, tipOpen, requestDetent, requestClose])

  return (
    <Screen
      className="map-page"
      header={headerHidden ? undefined :
        <header className="map__head">
          <div className="map__titlewrap">
            <h1 className="map__title">BJTU TimeMap</h1>
            <button
              className="map__region"
              data-region-phase={schoolPhase}
              onClick={() => {
                persistView()
                navigate('poi')
              }}
            >
              {/* 权威学校名（GET /api/schools）；读不到时**不显示**编造文案 */}
              <span data-region-school>
                {schoolPhase === 'ready' && school ? school.name : '学校未知'}
              </span>
              <IconChevronDown size={13} />
            </button>
          </div>
          <button
            className="iconbtn map__msg"
            onClick={() => {
              persistView()
              navigate('message')
            }}
            aria-label="消息"
          >
            <IconChatBubble size={22} />
          </button>
        </header>
      }
      scroll={false}
    >
      {/*
        工具栏：「地标标签」胶囊（复刻说明 §2–§4），展开的面板覆盖在地图上方（见 .map 内）。
        ⚠️ 筛选是**服务端**做的（`GET /api/places?category=a,b`，多选取并集）——
          与"客户端 filter"相比，服务端筛在加页/加 limit 之后不会静默变成不完整结果。
        `data-map-category` 是验收钩子：当前生效的分类（逗号分隔，或「全部」）。
        地点抽屉打开时胶囊不可用：抽屉与筛选不同时出现。
      */}
      {!headerHidden && <div className="map__toolbar" data-map-category={appliedKey || '全部'}>
        <button
          ref={tagsBtnRef}
          className={`map__tagsBtn ${tagsOpen ? 'is-open' : ''} ${appliedTags.length ? 'is-filtered' : ''}`}
          data-map-tags-toggle
          aria-expanded={tagsOpen}
          aria-controls="map-tags-panel"
          aria-label={`地标标签：${appliedLabel}`}
          disabled={sheetOpen}
          onClick={() => (tagsOpen ? closeTags(false) : openTags())}
        >
          <IconSliders size={18} />
          <span>地标标签</span>
          <span className="map__tagsChevron"><IconChevronDown size={14} /></span>
        </button>
      </div>}
      {/*
        ⚠️ 这里**没有**「文字弹幕」开关（原来有一个，但它只是给根节点加 `.map--hide-text`
        隐藏栅格底图上的文字卡片，并不是需求 MAP-005 要求的弹幕滚动）。
        纯文字弹幕是 F13（P1 / 迭代一，见 `需求分析与产品设计文档` §3.3），
        需要"只播当前可见区域内、关联有效地点、公开可见的纯文字帖"的候选接口，
        在迭代一实现时连同真实开关一起加回来。
        与其留一个点了没反应、看起来像有功能的开关，不如先撤掉 —— 见
        `docs/zjx/地图模块缺口登记-2026-10-19.md`。
      */}
      <div
        className="map"
        data-map-view-restored={viewRestored}
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {showPublished && publishedPostId && <div className="map__published" role="status" onPointerDown={e => e.stopPropagation()}>
          <strong>发布成功{published?.place ? ` · ${published.place}` : ''}</strong>
          {published?.images?.[0] && <img src={mediaUrl(published.mapMediaId || published.images[0].id)} alt="刚发布的内容" />}
          {published?.body && <p>{published.body.slice(0, 60)}</p>}
          <button
            onClick={() => {
              persistView()
              navigate('feed', { id: publishedPostId })
            }}
          >
            查看帖子
          </button>
          <button aria-label="关闭发布提示" onClick={() => setShowPublished(false)}>关闭</button>
        </div>}
        {offline ? (
          <OfflineMap view={view} markers={markers} />
        ) : provider === 'tencent' ? (
          <TencentMap
            markers={markers}
            here={fix}
            onMarkerClick={handleMarkerClick}
            onSdkFailed={handleTencentFailed}
            mapRef={handleMapRef}
          />
        ) : provider === 'amap' ? (
          <AmapMap
            markers={markers}
            here={fix}
            onMarkerClick={handleMarkerClick}
            onSdkFailed={handleAmapFailed}
            mapRef={handleMapRef}
          />
        ) : (
          <RealMap
            markers={markers}
            here={fix}
            onMarkerClick={handleMarkerClick}
            onTilesFailed={handleTilesFailed}
            mapRef={handleMapRef}
          />
        )}

        {/*
          ⭐ WO#15：标记来源的**诚实状态**。三种态都要能被看见（也给出 Gate 一个 DOM 钩子）：
            loading     → 加载中（**不显示标记**）
            ready + 0   → "暂无带地点的动态"（**诚实的空**，不是错误）
            ready + n   → 显示 n 个标记（数据来自 GET /api/posts）
            unavailable → 读不到 → 明确说"标记不可用"，**不回落 mock**
          ⚠️ 刻意**不**写成"没有标记就显示演示数据"那一套 —— 那正是 WO#12/#14 反复修掉的行为。
        */}
        {/*
          ⭐ Round 266：**离线模式单独一条说明**（审核 58 closeout 第 2 项）。
          为什么要显式说：offline 下我们**不渲染**权威标记（未校准投影），
          如果不说明，用户会以为"这块校园没人发过带地点的动态" ——
          而事实是"**离线底图不支持标记**"。这两件事必须能被区分。
        */}
        {/* 抽屉打开时，地图底部的状态条、工具和 FAB 会被压住，一律不渲染（design §11.4） */}
        {sheetOpen ? null : offline ? (
          <span className="map__markerBadge" data-marker-phase="offline-unsupported">
            离线底图不支持标记显示
          </span>
        ) : markerPhase !== 'ready' ? (
          <span
            className={`map__markerBadge ${markerPhase === 'unavailable' ? 'map__markerBadge--action' : ''}`}
            data-marker-phase={markerPhase}
          >
            {markerPhase === 'loading' ? (
              '标记加载中…'
            ) : (
              <>
                标记读取失败
                <button
                  className="map__markerRetry"
                  data-marker-retry
                  onClick={() => setMarkerReload((n) => n + 1)}
                >
                  重试
                </button>
              </>
            )}
          </span>
        ) : markers.length === 0 ? (
          <span className="map__markerBadge" data-marker-phase="empty">
            {appliedTags.length ? `暂无${appliedLabel}类地点` : '暂无已启用的地点'}
          </span>
        ) : (
          /*
            ⭐ `data-marker-places`：**测试钩子**，把"标记地点名"显式暴露出来。
            为什么需要它（Round 266 的一次**假 FAIL**）：门禁原本用"整页文本里是否出现
            mock 地名"来判断"是否仍在渲染 mock 地点"，结果**权威帖子的正文**里
            出现了「图书馆四楼靠窗的位置」—— 那个"图书馆"是**帖子内容**，不是标记地点。
            ⇒ 于是门禁把一个正确的实现判成 FAIL。
            正确做法：断言**标记的地点名集合**，而不是"整页出现过某个词"。
            （同类教训本会话已出现：WO#14 用整页 imgCount===0 判断头像，被帖子图片干扰。）
          */
          <span
            className="map__markerBadge"
            data-marker-phase="ready"
            data-marker-count={String(markers.length)}
            data-marker-places={markers.map((m) => m.place).join('\u001f')}
            /* ⭐ P0：标记的**地点 id** 也暴露出来 —— 验收要能证明"点标记进的是这个地点" */
            data-marker-place-ids={markers.map((m) => m.placeId).join('\u001f')}
          >
            {markers.length} 个标记
          </span>
        )}
        {/* 帖子读取失败时的**显式降级说明**（不把"读不到"说成"没有内容"） */}
        {!sheetOpen && !offline && markerPhase === 'ready' && postsFailed && (
          <span className="map__postsFailed" data-marker-posts-failed>
            帖子内容读取失败，标记未显示照片与点赞
            <button
              className="map__markerRetry"
              data-marker-posts-retry
              onClick={() => setMarkerReload((n) => n + 1)}
            >
              重试
            </button>
          </span>
        )}

        {offline && (
          <span className="map__offlineBadge">
            {forceOffline ? '离线自绘底图（演示模式）' : '离线自绘底图（在线瓦片不可用）'}
          </span>
        )}        {tilesOk === true && !offline && (
          <span className="map__onlineBadge" data-provider={provider}>
            {provider === 'tencent' ? '腾讯地图' : provider === 'amap' ? '高德地图' : '在线地图'}
          </span>
        )}

        <GeoBadge
          status={geoStatus}
          fix={fix}
          onRetry={() => {
            // 未授权：先把“为什么要定位”的说明弹回来，再让用户点授权；
            // 定位超时：直接重试，不用再解释一遍。
            if (geoStatus === 'denied') setTipOpen(true)
            else void requestGeo()
          }}
        />

        {showFar && !sheetOpen && (
          /*
            MAP-002：地图工具只有「搜索地标」与「定位当前位置」，
            **不提供**单独的"回到校园全景"工具 ⇒ 这里移除原来的「回校园」按钮，
            只保留距离提示（告诉用户蓝点为什么不在画面里，但不给回校园的入口）。
          */
          <div className="map__geoFar" data-map-far="1">
            <span>当前位置距校园 {formatDistance(farFromCampus)}</span>
          </div>
        )}

        {/*
          MAP-002 / MAP-003：地图工具 = 搜索地标 + 定位当前位置（顺序与需求一致）。
          ⚠️ 原来的「放大」控件已移除：需求把工具清单限定为这两项，缩放手势由底图自己负责
          （Leaflet 滚轮/双指，SDK 底图同理）。
        */}
        {!sheetOpen && <div className="map__controls" data-map-tools="search,locate">
          <button
            className="map__ctrl"
            data-map-tool="search"
            onClick={() => {
              setKeyword('')
              setSearchPhase('idle')
              setSearchOpen(true)
            }}
            aria-label="搜索地标"
          >
            <IconSearch size={20} />
          </button>
          <button className="map__ctrl" data-map-tool="locate" onClick={recenter} aria-label="定位当前位置">
            <IconLocation size={20} />
          </button>
        </div>}

        {/* MAP-003：搜索面板（只列团队维护的预设地标；选中后飞到该地标并打开地点详情） */}
        {searchOpen && (
          <div
            className="map__search"
            data-map-search-open="1"
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <div className="map__searchHead">
              <IconSearch size={18} />
              <input
                className="map__searchInput"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索地标"
                aria-label="搜索地标关键词"
                autoFocus
              />
              <button
                className="iconbtn"
                onClick={() => {
                  setSearchOpen(false)
                  setKeyword('')
                }}
                aria-label="关闭搜索"
              >
                <IconClose size={20} />
              </button>
            </div>
            <div
              className="map__searchBody"
              data-map-search-state={searchPhase}
              data-map-search-count={String(searchResults.length)}
            >
              {searchPhase === 'loading' && <p className="map__searchEmpty">搜索中…</p>}
              {searchPhase === 'unavailable' && (
                <p className="map__searchEmpty" data-map-search-empty="unavailable">
                  地标读取失败，请重试
                </p>
              )}
              {searchPhase === 'ready' && searchResults.length === 0 && (
                <p className="map__searchEmpty" data-map-search-empty="no-match">
                  {keyword.trim() ? `没有找到「${keyword.trim()}」相关的地标` : '暂无已启用的地标'}
                </p>
              )}
              <ul className="map__searchList" data-map-search-results>
                {searchResults.map((p) => (
                  <li key={p.id}>
                    <button className="map__searchRow" data-map-search-result={p.id} onClick={() => pickPlace(p)}>
                      <span className="map__searchName">{p.name}</span>
                      <span className="map__searchAddr">{p.address ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {!sheetOpen && <button
          className="map__fab"
          onClick={() => {
            persistView()
            navigate('publish', selectedPlace ? { placeId: selectedPlace } : undefined)
          }}
          aria-label="发布"
        >
          <IconPlus size={22} />
        </button>}

        {/*
          地标标签面板（复刻说明 §3–§4）：覆盖在地图上方、不推挤地图（地图实例不重建）。
          透明遮罩接住面板外的点按：收起并放弃草稿，且不把点按传给底图／地点标记。
        */}
        {tagsOpen && <>
          <div
            className="map__tagsScrim"
            data-map-tags-scrim
            aria-hidden="true"
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={() => closeTags(false)}
          />
          <div
            id="map-tags-panel"
            className="map__tags"
            role="dialog"
            aria-label="选择地标标签"
            data-map-tags-open="1"
            data-map-tags-draft={draftTags.join(',') || '全部'}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="map__tagsBody">
              <div className="map__tagsHead">
                <h2 className="map__tagsTitle">选择地标标签</h2>
                <span className="map__tagsHint">可多选</span>
              </div>
              <div className="map__tagsGrid" role="group" aria-label="地标标签">
                {TAG_OPTIONS.map((t) => {
                  const on = t === '全部' ? draftTags.length === 0 : draftTags.includes(t)
                  return (
                    <button
                      key={t}
                      className={`map__tag ${on ? 'is-on' : ''}`}
                      data-map-tag={t}
                      aria-pressed={on}
                      onClick={() => setDraftTags((d) => toggleTag(d, t))}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="map__tagsFoot">
              <button className="map__tagsReset" data-map-tags-reset onClick={() => setDraftTags([])}>
                重置
              </button>
              <button className="map__tagsApply" data-map-tags-apply onClick={() => closeTags(true)}>
                确定
              </button>
            </div>
          </div>
        </>}

        {tipOpen && (
          /*
            ⭐ 给"自动弹出的阻断式覆盖层"一个**显式登记位**（M5 WO15.6）：
            收尾脚本 `scripts/m5/dismiss-blocking-modals.mjs` 会按
            `[data-blocking-modal]` 找到它并点里面的关闭控件。
            为什么要有这个通用钩子：以后新增同类弹窗时只要带上这个属性就会被自动清理，
            **不必回来改清理脚本**（而"忘了改"正是 WO#15 那次跨 Gate 残留的成因）。
            ⚠️ 注意注释不能写成 JSX 的那种花括号注释形式并放在括号表达式的第一位 ——
              那不是合法 JSX（括号里必须是单个元素）。用普通块注释即可。
            ⚠️ 另：注释正文里也**不要**写出"斜杠星号"那种字符组合 ——
              它会**提前结束本块注释**，把后面的内容变成代码。
              （我今天在 JSDoc 里写 `screens/*` + `/baseline.json` 时刚踩过同一个坑。）
          */
          <div className="map__modal-wrap" data-blocking-modal="geo-permission">
            <div className="map__modal">
              <h3 className="map__modal-title">授权地理位置</h3>
              <p className="map__modal-desc">在地图上，标记属于你的校园生活</p>
              {deniedOnce && (
                <p className="map__modal-desc map__modal-desc--warn">
                  系统已拒绝定位权限，再点授权不会弹框。
                  请到「设置 → 应用 → 校园 → 权限」里手动打开定位，然后回到本页。
                </p>
              )}
              <div className="map__modal-actions">
                <button
                  className="map__modal-btn"
                  onClick={() => {
                    setTipOpen(false)
                    // 明确拒绝过就给出提示条，避免蓝点静默停在校门口
                    setGeoStatus((s) => (s === 'ok' ? s : 'denied'))
                  }}
                >
                  暂时不要
                </button>
                <button
                  className="map__modal-btn map__modal-btn--primary"
                  onClick={() => {
                    setTipOpen(false)
                    void requestGeo()
                  }}
                >
                  授权
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="ps-host" ref={sheetHostRef} data-sheet-phase={sheetOpen ? sheet.phase : undefined} inert={tipOpen && sheetOpen ? true : undefined}>
        {sheet.placeId && <PlaceDetailSheet
          placeId={sheet.placeId}
          detent={sheet.detent}
          closing={sheet.phase === 'closing'}
          snaps={snaps}
          placeNameHint={markers.find(m => m.placeId === sheet.placeId)?.place ?? null}
          initialScrollTop={initialScrollTop}
          onScroll={top => { contentScrollTopRef.current = top }}
          onRequestDetent={requestDetent}
          onRequestClose={requestClose}
          onNavigate={leaveSheetTo}
          onPlaceLoaded={onSheetPlaceLoaded}
        />}
      </div>
    </Screen>
  )
}
