import { useCallback, useEffect, useRef, useState } from 'react'
import { Screen } from '../components/Shell'
import {
  IconChatBubble,
  IconChevronDown,
  IconCompass,
  IconLocation,
  IconPlus,
} from '../components/icons'
import { listPosts } from '../api/client'
import type { ApiPost } from '../api/client'
import type { MapMarker } from '../data/mock'
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

/**
 * 把**权威**帖子派生成地图标记（M5 WO#15）。
 *
 * ## 为什么要有这个函数（而不是直接用 mock.mapMarkers）
 *   改前标记来自 `mock.mapMarkers`：6 条**硬编码**的校园建筑（阳光操场/教育超市/图书馆/…）
 *   带**我们自己编的**坐标与颜色。而原版实测证据指向的是另一种模型：
 *     · `trident-map/baseline.json`：「主体：地图 + 用户头像标记 + 深色气泡卡片」
 *     · `docs/original-interaction-map.md:38`：「照片卡片 + 彩色图钉 + 地点名」
 *     · `supplements/poi-detail.json`：「地图上点『用户发布的照片图钉』的**照片缩略图**
 *       （不是地名文字）」→ 进动态详情
 *   ⇒ 即：**标记 = 一条真实动态锚定在一个真实地点**。而我们服务端**恰好就是这个模型**
 *     （`posts.place_id → places`，且实测 4 条 post 都有地点）。
 *   所以正确做法是**从 posts 派生**，而不是继续渲染一份编造的清单。
 *
 * ## 只保留"能定位"的帖子
 *   必须**同时**有 `placeLat` 与 `placeLng`（服务端 left join places 得到）。
 *   缺任一个 → **不出标记**（而不是给个默认坐标 —— 那会把标记放到几内亚湾，
 *   而且用户无法察觉是假的）。
 *
 * ## 关于 color / x / y（**不夸大的部分**）
 *   · `color`：原版**确实**有红/黄图钉，但**配色规则未知**
 *     （`trident-map/baseline.json` 的 known_unknowns 原话：「具体缩放级别与**标记规则未记录**」）。
 *     ⇒ 因此这里用**单一确定色**，并在代码里显式标注 NOT_EVALUATED，**不假装知道规则**。
 *   · `x` / `y`：只有离线自绘地图（SVG，viewBox 1400×2000）用像素坐标；权威数据只有经纬度，
 *     故按 `CAMPUS_CENTER` 做**线性近似**换算。该换算的**正确性记 NOT_EVALUATED**
 *     （无基线可比），仅用于降级路径不空白。
 */
export function markersFromPosts(
  posts: ApiPost[],
  center: [number, number] = CAMPUS_CENTER,
): MapMarker[] {
  // 像素换算：以校区中心为基准，1 度纬度 ≈ 111_320 m；经度按纬度收缩。
  // 这里只求"方向与相对位置大致正确"，不追求地理精确（见上方 NOT_EVALUATED 说明）。
  const M_PER_DEG_LAT = 111_320
  const M_PER_DEG_LNG = 111_320 * Math.cos((center[0] * Math.PI) / 180)
  // 把"米"映射到 SVG 像素：取 1 px ≈ 1 m 的量级（viewBox 是 1400×2000，
  // 一张校园尺度地图用这个比例刚好铺满中心区域）
  const PX_PER_M = 1
  return posts
    .filter((p) => typeof p.placeLat === 'number' && typeof p.placeLng === 'number')
    .map((p) => {
      const lat = p.placeLat as number
      const lng = p.placeLng as number
      const dxM = (lng - center[1]) * M_PER_DEG_LNG
      const dyM = (lat - center[0]) * M_PER_DEG_LAT
      return {
        id: p.id,
        place: p.place ?? '',
        // ⚠️ 单一确定色：原版配色规则 NOT_EVALUATED（见函数头注释）
        color: '#f5453b',
        userId: p.authorId ?? '',
        postId: p.id,
        // SVG 像素空间：中心 = (700, 1000)；纬度越大越靠北 → y 越小
        x: Math.round(700 + dxM * PX_PER_M),
        y: Math.round(1000 - dyM * PX_PER_M),
        lat,
        lng,
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
 * ⚠️ WO#15：标记**不再**从 `mock.mapMarkers` 读，而是由调用方把**权威派生**的
 *    `markers` 传进来（见 `markersFromPosts`）。空数组 = 没有可显示的标记
 *    （**不回落 mock**）。
 */
function OfflineMap({
  view,
  markers,
  onTilesMeta,
}: {
  view: ViewState
  markers: MapMarker[]
  onTilesMeta?: (el: HTMLDivElement | null) => void
}) {
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
        {markers.map((m) => (
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
  const [markers, setMarkers] = useState<MapMarker[]>([])
  const [markerPhase, setMarkerPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await listPosts()
      if (!alive) return
      if (!r.ok) {
        setMarkers([])
        setMarkerPhase('unavailable')
        return
      }
      // 只保留**能定位**的帖子（同时有 lat/lng）→ 其余不出标记
      setMarkers(markersFromPosts(r.value))
      setMarkerPhase('ready')
    })()
    return () => {
      alive = false
    }
  }, [])
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
  const handleMarkerClick = useCallback((postId: string) => {
    navigate('feed', { id: postId })
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
            <h1 className="map__title">Map</h1>
            <button className="map__region" onClick={() => navigate('poi')}>
              <span>北京交通大学（校本部）</span>
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
        {markerPhase !== 'ready' ? (
          <span className="map__markerBadge" data-marker-phase={markerPhase}>
            {markerPhase === 'loading' ? '标记加载中…' : '标记不可用（读取失败或未登录）'}
          </span>
        ) : markers.length === 0 ? (
          <span className="map__markerBadge" data-marker-phase="empty">
            暂无带地点的动态
          </span>
        ) : (
          <span className="map__markerBadge" data-marker-phase="ready" data-marker-count={String(markers.length)}>
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
