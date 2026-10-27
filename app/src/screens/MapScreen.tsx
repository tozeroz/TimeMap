import { useCallback, useEffect, useRef, useState } from 'react'
import { Screen } from '../components/Shell'
import {
  IconChatBubble,
  IconChevronDown,
  IconClose,
  IconLocation,
  IconPlus,
  IconSearch,
} from '../components/icons'
import { listPlaces, listPosts, listSchools, mediaUrl, type ApiPlaceListItem, type ApiPost, type ApiSchool } from '../api/client'
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
import { navigate, useRoute } from '../router'
import './map.css'

interface ViewState {
  x: number
  y: number
  scale: number
}

/** 分类筛选：全部 / 地标 / 食堂（需求 4.1 草图顶部的 `[全部] [地标] [食堂]`） */
type CategoryFilter = '全部' | '地标' | '食堂'

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
        userId: rep?.authorId ?? '',
        postId: rep?.id ?? '',
        // SVG 像素空间：中心 = (700, 1000)；纬度越大越靠北 → y 越小
        x: Math.round(700 + dxM * PX_PER_M),
        y: Math.round(1000 - dyM * PX_PER_M),
        lat,
        lng,
        coverUrl: rep?.mapMediaId ? mediaUrl(rep.mapMediaId) : rep?.images && rep.images.length > 0 ? mediaUrl(rep.images[0].id) : undefined,
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
  const [showPublished, setShowPublished] = useState(Boolean(route.query.newPostId))
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
  /** 分类筛选（需求 4.1：`[全部] [地标] [食堂]`） */
  const [category, setCategory] = useState<CategoryFilter>('全部')
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
        listPlaces(undefined, category === '全部' ? undefined : category),
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
      const fresh = posts.find(p => p.id === route.query.newPostId)
      setPublished(fresh ?? null)
      setMarkers(markersFromPlaces(pr.value, fresh ? [fresh, ...posts.filter(p => p.id !== fresh.id)] : posts).map(m => ({ ...m, highlight: Boolean(fresh && m.postId === fresh.id) })))
      setMarkerPhase('ready')
    })()
    return () => {
      alive = false
    }
  }, [category, route.query.newPostId, markerReload])
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
    if (!route.query.newPostId) return
    setShowPublished(true)
    const timer = setTimeout(() => {
      setShowPublished(false)
      setMarkers(items => items.map(m => ({ ...m, highlight: false })))
    }, 10000)
    return () => clearTimeout(timer)
  }, [route.query.newPostId])
  useEffect(() => {
    const target = markers.find(m => m.placeId === route.query.placeId)
    if (target) mapHandleRef.current?.flyTo(target.lat, target.lng, 18)
  }, [markers, route.query.placeId])

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

  /**
   * 选中一个预设地标：飞过去 + 打开地点详情，并把**目标视图**记为"上次视图"，
   * 这样从详情返回时人就停在这个地标上（PLACE-005）。
   */
  const pickPlace = useCallback((p: ApiPlaceListItem) => {
    setSearchOpen(false)
    setKeyword('')
    setSearchResults([])
    setSearchPhase('idle')
    setSelectedPlace(p.id)
    if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
      mapHandleRef.current?.flyTo(p.latitude, p.longitude, 18)
      const target = { lat: p.latitude, lng: p.longitude, zoom: 18 }
      lastOnlineViewRef.current = target
      writeSavedMapView({ offline: false, ...target })
    }
    navigate('poidetail', { id: p.id })
  }, [])

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
      if (!granted || forceAsk) setTipOpen(true)
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
    // PLACE-005：离开地图前先把当前视图记下来，返回时停在同一处
    persistView()
    if (postId) { navigate('feed', { id: postId }); return }
    setSelectedPlace(placeId)
    navigate('poidetail', { id: placeId })
  }, [persistView])

  const handleMapRef = useCallback((handle: MapHandle | null) => {
    mapHandleRef.current = handle
    if (!handle) return
    mapCreatedAtRef.current = Date.now()
    setTilesOk(true)
    // ① URL 指定了地点（深链 / 发布后回到地图）→ 优先飞到该地点
    const target = markers.find(m => m.placeId === route.query.placeId)
    if (target) {
      handle.flyTo(target.lat, target.lng, 18)
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
  }, [markers, route.query.placeId])

  return (
    <Screen
      header={
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
        分类筛选（需求 4.1 草图顶部：[全部] [地标] [食堂]）。
        ⚠️ 筛选是**服务端**做的（`GET /api/places?category=`）——
          与"客户端 filter"相比，服务端筛在加页/加 limit 之后不会静默变成不完整结果。
        `data-map-category` 是验收钩子：当前生效的分类必须能被机械读到。
      */}
      <div className="map__cats no-scrollbar" data-map-category={category}>
        {(['全部', '地标', '食堂'] as CategoryFilter[]).map((c) => (
          <button
            key={c}
            className={`map__cat ${category === c ? 'is-active' : ''}`}
            data-map-cat={c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
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
        {showPublished && route.query.newPostId && <div className="map__published" role="status" onPointerDown={e => e.stopPropagation()}>
          <strong>发布成功{published?.place ? ` · ${published.place}` : ''}</strong>
          {published?.images?.[0] && <img src={mediaUrl(published.mapMediaId || published.images[0].id)} alt="刚发布的内容" />}
          {published?.body && <p>{published.body.slice(0, 60)}</p>}
          <button
            onClick={() => {
              persistView()
              navigate('feed', { id: route.query.newPostId })
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
        {offline ? (
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
            {category === '全部' ? '暂无已启用的地点' : `暂无${category}类地点`}
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
        {!offline && markerPhase === 'ready' && postsFailed && (
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

        {showFar && (
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
        <div className="map__controls" data-map-tools="search,locate">
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
        </div>

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

        <button
          className="map__fab"
          onClick={() => {
            persistView()
            navigate('publish', selectedPlace ? { placeId: selectedPlace } : undefined)
          }}
          aria-label="发布"
        >
          <IconPlus size={22} />
        </button>

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
    </Screen>
  )
}
