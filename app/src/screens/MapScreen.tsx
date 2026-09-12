import { useCallback, useEffect, useRef, useState } from 'react'
import type L from 'leaflet'
import { Screen } from '../components/Shell'
import {
  IconChatBubble,
  IconChevronDown,
  IconCompass,
  IconLocation,
  IconPlus,
} from '../components/icons'
import { mapMarkers } from '../data/mock'
import { RealMap } from '../native/RealMap'
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

const MIN_SCALE = 0.6
const MAX_SCALE = 3

/**
 * 离线自绘地图 —— **降级方案**。
 * 在线瓦片连续加载失败（无网络 / 被墙 / 无 key）时使用，保证地图区域不是空白。
 * 拖拽、双击、捏合的数据都在这里处理。
 */
function OfflineMap({ view, onTilesMeta }: { view: ViewState; onTilesMeta?: (el: HTMLDivElement | null) => void }) {
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
        {mapMarkers.map((m) => (
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

  const [view, setView] = useState<ViewState>({ x: -260, y: -700, scale: 1 })
  const [tipOpen, setTipOpen] = useState(true)
  const [tileFailed, setTileFailed] = useState(false)
  const [tilesOk, setTilesOk] = useState<boolean | null>(null)
  const offline = forceOffline || tileFailed
  // ---- 真实定位 ----
  const [fix, setFix] = useState<GeoFix | null>(null)
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle')

  const drag = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const pinch = useRef<{ distance: number; scale: number } | null>(null)
  const lastTap = useRef(0)
  const lastTouch = useRef<{ x: number; y: number; moved: number } | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const leafletRef = useRef<L.Map | null>(null)
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
      setGeoStatus('denied')
      return
    }
    const first = await getCurrentFix()
    if (first) {
      setFix(first)
      setGeoStatus('ok')
    } else {
      setGeoStatus('timeout')
    }
    await startTracking()
  }, [startTracking])

  // 进地图时静默尝试：已授权就直接显示真实位置，未授权不弹系统框，等用户点“授权”
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!(await hasLocationPermission())) return
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
  }, [startTracking])

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
    const map = leafletRef.current
    const target: [number, number] = fix ? [fix.lat, fix.lng] : CAMPUS_CENTER
    if (!offline && map) {
      map.flyTo(target, 16, { duration: 0.6 })
      return
    }
    setView({ x: -260, y: -700, scale: 1 })
  }, [offline, fix])

  const backToCampus = useCallback(() => {
    leafletRef.current?.flyTo(CAMPUS_CENTER, 16, { duration: 0.6 })
  }, [])

  const zoomIn = useCallback(() => {
    const map = leafletRef.current
    if (!offline && map) {
      map.zoomIn()
      return
    }
    setView((v) => ({ ...v, scale: clampScale(v.scale * 1.25) }))
  }, [offline])

  const handleTilesFailed = useCallback(() => {
    setTilesOk(false)
    setTileFailed(true)
  }, [])

  // 注意：这两个回调必须保持稳定引用，否则 RealMap 的建图 effect 会每次渲染都销毁重建地图
  const handleMarkerClick = useCallback((postId: string) => {
    navigate('feed', { id: postId })
  }, [])

  const handleMapRef = useCallback((m: L.Map | null) => {
    leafletRef.current = m
    if (m) setTilesOk(true)
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
          <OfflineMap view={view} />
        ) : (
          <RealMap
            markers={mapMarkers}
            here={fix}
            onMarkerClick={handleMarkerClick}
            onTilesFailed={handleTilesFailed}
            mapRef={handleMapRef}
          />
        )}

        {offline && (
          <span className="map__offlineBadge">
            {forceOffline ? '离线自绘底图（演示模式）' : '离线自绘底图（在线瓦片不可用）'}
          </span>
        )}
        {tilesOk === true && !offline && <span className="map__onlineBadge">在线地图</span>}

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
          <div className="map__modal-wrap">
            <div className="map__modal">
              <h3 className="map__modal-title">授权地理位置</h3>
              <p className="map__modal-desc">在地图上，标记属于你的校园生活</p>
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
                </button>                <button
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
