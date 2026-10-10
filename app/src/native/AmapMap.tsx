import { useEffect, useRef } from 'react'
import type { MapMarker } from '../native/mapApi'
import type { GeoFix } from './geo'
import { AMAP_JS_KEY, AMAP_SECURITY_CODE, hasAmapKey } from './keys'
import type { MapHandle } from './mapApi'
import { CAMPUS_CENTER } from './mapTiles'
import './realmaps.css'

/**
 * 高德地图 JSAPI —— 第二顺位底图。
 *
 * 为什么它是第二而不是第一：原版 app 用的是腾讯地图，所以腾讯 SDK 优先；
 * 高德在这里的作用是「官方且合规的备份」—— 万一腾讯 key 额度用尽 / 被吊销，
 * 不至于退回未授权的栅格瓦片。
 *
 * 为什么锁 1.4 而不是 2.0（实测结论，别再改回去）：
 * 在 MuMu 的 Android WebView（Chrome 110）里，2.0 的 WebGL 渲染器**完全不响应触摸** ——
 * 单指拖拽时连 touchstart/mapmove 事件都不产生。用一张独立探针地图
 * （自己的容器、画在最上层、getStatus().dragEnable === true）复现了同样的现象，
 * 说明与我们页面的 CSS / 事件处理无关。同一份 key 换成 1.4 后立即正常：
 * touchstart → touchmove → mapmove → moveend 全部触发，中心点真实改变。
 *
 * JSAPI 2.0 还必须额外提供安全密钥（securityJsCode），1.4 不需要；
 * 这里仍然挂上它，方便以后 2.0 修好了直接切回去。
 */

interface AMapPixel {
  new (x: number, y: number): unknown
}

interface AMapLngLat {
  getLat(): number
  getLng(): number
}

interface AMapMapInstance {
  setZoomAndCenter(zoom: number, center: [number, number]): void
  zoomIn(): void
  getZoom(): number
  getCenter(): AMapLngLat
  on(event: string, handler: () => void): void
  add(overlays: unknown[]): void
  remove(overlays: unknown[]): void
  destroy(): void
}

interface AMapSdk {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => AMapMapInstance
  Marker: new (options: Record<string, unknown>) => unknown
  Circle: new (options: Record<string, unknown>) => unknown
  Pixel: AMapPixel
  v?: string
}

declare global {
  interface Window {
    AMap?: AMapSdk
    _AMapSecurityConfig?: { securityJsCode: string }
  }
}

let sdkPromise: Promise<AMapSdk | null> | null = null

/** 只加载一次 SDK；失败返回 null，让上层降级到栅格瓦片 */
export function loadAmapSdk(): Promise<AMapSdk | null> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(null)
      return
    }
    if (window.AMap) {
      resolve(window.AMap)
      return
    }
    // 没配 Key 就别去请求了：注定失败，还会白等一次网络超时
    if (!hasAmapKey()) {
      resolve(null)
      return
    }
    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE }
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=1.4.15&key=${AMAP_JS_KEY}`
    script.async = true
    script.onload = () => resolve(window.AMap ?? null)
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
    setTimeout(() => resolve(window.AMap ?? null), 15000)
  })
  return sdkPromise
}

/** 标记的 DOM 结构：照片卡片 + 图钉 + 地点名（与腾讯 / Leaflet 版同构） */
function buildMarkerElement(m: MapMarker): HTMLDivElement {
    const cover = m.coverUrl
  const el = document.createElement('div')
  el.className = 'rm'
  el.dataset.markerId = m.id

  const card = document.createElement('div')
  card.className = 'rm__card'
  if (cover) {
    const img = document.createElement('img')
    img.className = 'rm__img'
    img.src = cover
    img.alt = ''
    card.appendChild(img)
  } else {
    const span = document.createElement('span')
    span.className = 'rm__img rm__img--text'
    span.textContent = (m.excerpt ?? '').slice(0, 10)
    card.appendChild(span)
  }
  const name = document.createElement('span')
  name.className = 'rm__name'
  name.textContent = m.place
  card.appendChild(name)

  const pin = document.createElement('span')
  pin.className = 'rm__pin'
  pin.style.color = m.color
  pin.innerHTML =
    '<svg width="18" height="24" viewBox="0 0 20 26"><path d="M10 25.5S19 15.6 19 9.6A9 9 0 0 0 1 9.6c0 6 9 15.9 9 15.9Z" fill="currentColor"/><circle cx="10" cy="9.6" r="3.4" fill="#fff"/></svg>'

  el.appendChild(card)
  el.appendChild(pin)
  return el
}

export function AmapMap({
  markers,
  here,
  onMarkerClick,
  onSdkFailed,
  mapRef,
}: {
  markers: MapMarker[]
  here?: GeoFix | null
  /** ⭐ P0：回调参数是**地点 id**（标记按地点聚合，点击进地点详情） */
  onMarkerClick: (placeId: string) => void
  onSdkFailed: () => void
  mapRef?: (handle: MapHandle | null) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapObjRef = useRef<AMapMapInstance | null>(null)
  const pollRef = useRef<number | null>(null)

  // ---- 建图 ----
  useEffect(() => {
    let disposed = false
    let map: AMapMapInstance | null = null
    const overlays: unknown[] = []

    void (async () => {
      const host = hostRef.current
      const AMap = await loadAmapSdk()
      if (disposed || !host) return
      if (!AMap) {
        onSdkFailed()
        return
      }

      map = new AMap.Map(host, {
        zoom: 16,
        center: [CAMPUS_CENTER[1], CAMPUS_CENTER[0]],
        resizeEnable: true,
        viewMode: '2D',
      })
      mapObjRef.current = map

      for (const m of markers) {
        const el = buildMarkerElement(m)
        el.addEventListener('click', () => onMarkerClick(m.placeId))
        // anchor: bottom-center —— 图钉尖端落在坐标点上
        const marker = new AMap.Marker({
          position: [m.lng, m.lat],
          content: el,
          anchor: 'bottom-center',
          offset: new AMap.Pixel(0, 0),
          zIndex: 120,
        })
        overlays.push(marker)
      }
      map.add(overlays)

      const handle: MapHandle = {
        provider: 'amap',
        flyTo: (lat, lng, zoom = 16) => map?.setZoomAndCenter(zoom, [lng, lat]),
        zoomIn: () => map?.zoomIn(),
        getCenter: () => {
          const c = map?.getCenter()
          return c ? { lat: c.getLat(), lng: c.getLng() } : null
        },
        getZoom: () => map?.getZoom() ?? null,
      }
      mapRef?.(handle)

      const sync = () => {
        const c = handle.getCenter()
        const z = handle.getZoom()
        if (c) host.dataset.center = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`
        if (z != null) host.dataset.zoom = String(z)
      }
      for (const ev of ['move', 'zoom', 'moveend', 'zoomend', 'mapmove', 'complete', 'tilesloaded']) {
        map.on(ev, sync)
      }
      // AMap 2.0 的事件名各家不一（拖拽过程只保证 mapmove，有时只在 moveend 才给），
      // 所以再挂一个低频轮询兜底，保证 data-* 始终反映真实视图状态。
      pollRef.current = window.setInterval(sync, 500)
      sync()
    })()

    return () => {
      disposed = true
      if (pollRef.current != null) window.clearInterval(pollRef.current)
      pollRef.current = null
      mapRef?.(null)
      mapObjRef.current = null
      if (map && overlays.length) map.remove(overlays)
      map?.destroy()
    }
  }, [markers, onMarkerClick, onSdkFailed, mapRef])

  // ---- 蓝点跟随真实定位 ----
  useEffect(() => {
    let disposed = false
    const overlays: unknown[] = []

    void (async () => {
      const AMap = await loadAmapSdk()
      const map = mapObjRef.current
      if (disposed || !AMap || !map) return

      const lat = here?.lat ?? CAMPUS_CENTER[0]
      const lng = here?.lng ?? CAMPUS_CENTER[1]
      const acc = here?.accuracy ?? 0

      const dot = document.createElement('div')
      dot.className = 'rm__here'
      dot.dataset.lat = String(lat)
      dot.dataset.lng = String(lng)
      dot.dataset.acc = String(acc)
      dot.dataset.real = here ? '1' : '0'
      dot.innerHTML = '<span class="rm__hereCone"></span><span class="rm__hereDot"></span>'
      overlays.push(
        new AMap.Marker({
          position: [lng, lat],
          content: dot,
          anchor: 'center',
          zIndex: 130,
        }),
      )
      if (here && acc > 0 && acc < 20000) {
        overlays.push(
          new AMap.Circle({
            center: [lng, lat],
            radius: acc,
            strokeColor: 'rgba(47,124,246,0.6)',
            strokeWeight: 1,
            fillColor: 'rgba(47,124,246,0.12)',
            fillOpacity: 1,
            zIndex: 110,
          }),
        )
      }
      map.add(overlays)
    })()

    return () => {
      disposed = true
      const map = mapObjRef.current
      if (map && overlays.length) map.remove(overlays)
    }
  }, [here])

  return <div className="realmaps" data-provider="amap" ref={hostRef} />
}
