import { useCallback, useEffect, useRef, useState } from 'react'
import { Screen } from '../components/Shell'
import {
  IconChatBubble,
  IconChevronDown,
  IconCompass,
  IconLocation,
  IconPlus,
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
        // ⭐ 跳转目标是地点（P0 的核心改动）
        placeId: p.id,
        place: p.name,
        // ⚠️ 单一确定色：原版配色规则 NOT_EVALUATED（见函数头注释）
        color: '#f5453b',
        userId: rep?.authorId ?? '',
        postId: rep?.id ?? '',
        // SVG 像素空间：中心 = (700, 1000)；纬度越大越靠北 → y 越小
        x: Math.round(700 + dxM * PX_PER_M),
        y: Math.round(1000 - dyM * PX_PER_M),
        lat,
        lng,
        coverUrl: rep?.images && rep.images.length > 0 ? mediaUrl(rep.images[0].id) : undefined,
        excerpt: rep?.body ? rep.body.slice(0, 10) : undefined,
      }
    })
}

const MIN_SCALE = 0.6
const MAX_SCALE = 3

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

  const [view, setView] = useState<ViewState>({ x: -260, y: -700, scale: 1 })
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
  const [markerPhase, setMarkerPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  /** 分类筛选（需求 4.1：`[全部] [地标] [食堂]`） */
  const [category, setCategory] = useState<CategoryFilter>('全部')

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
        setMarkerPhase('unavailable')
        return
      }
      setMarkers(markersFromPlaces(pr.value, po.ok ? po.value : []))
      setMarkerPhase('ready')
    })()
    return () => {
      alive = false
    }
  }, [category])
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

  const backToCampus = useCallback(() => {
    mapHandleRef.current?.flyTo(CAMPUS_CENTER[0], CAMPUS_CENTER[1], 16)
  }, [])

  const zoomIn = useCallback(() => {
    const handle = mapHandleRef.current
    if (!offline && handle) {
      handle.zoomIn()
      return
    }
    setView((v) => ({ ...v, scale: clampScale(v.scale * 1.25) }))
  }, [offline])

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
  const handleMarkerClick = useCallback((placeId: string) => {
    /*
      ⭐ P0：点击标记进**地点详情**（不再是动态详情）。
      理由见 markersFromPlaces 的说明：地图的组织单位是地点（需求 4.1/4.2）。
      ⚠️ 不回落到 postId —— 两者的语义不同，混用会让"点进哪个地点"变得不可预测。
    */
    navigate('poidetail', { id: placeId })
  }, [])

  const handleMapRef = useCallback((handle: MapHandle | null) => {
    mapHandleRef.current = handle
    if (handle) setTilesOk(true)
  }, [])

  return (
    <Screen
      header={
        <header className="map__head">
          <div className="map__titlewrap">
            <h1 className="map__title">BJTU TimeMap</h1>
            <button
              className="map__region"
              data-region-phase={schoolPhase}
              onClick={() => navigate('poi')}
            >
              {/* 权威学校名（GET /api/schools）；读不到时**不显示**编造文案 */}
              <span data-region-school>
                {schoolPhase === 'ready' && school ? school.name : '学校未知'}
              </span>
              <IconChevronDown size={13} />
            </button>
          </div>
          <button className="iconbtn map__msg" onClick={() => navigate('message')} aria-label="消息">
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
      <div
        className="map"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
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
          <span className="map__markerBadge" data-marker-phase={markerPhase}>
            {markerPhase === 'loading' ? '标记加载中…' : '标记不可用（读取失败或未登录）'}
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
        {offline && (
          <span className="map__offlineBadge">
            {forceOffline ? '离线自绘底图（演示模式）' : '离线自绘底图（在线瓦片不可用）'}
          </span>
        )}
        {tilesOk === true && !offline && (
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
          <div className="map__geoFar">
            <span>当前位置距校园 {formatDistance(farFromCampus)}</span>
            <button className="map__geoFarBtn" onClick={backToCampus}>
              回校园
            </button>
          </div>
        )}

        <div className="map__controls">
          <button className="map__ctrl" onClick={recenter} aria-label="回到定位">
            <IconLocation size={20} />
          </button>
          <button className="map__ctrl" onClick={zoomIn} aria-label="放大">
            <IconCompass size={20} />
          </button>
        </div>

        <button className="map__fab" onClick={() => navigate('publish')} aria-label="发布">
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
