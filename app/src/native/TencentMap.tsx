import { buildMarkerElement } from './placeMarker'
import { useEffect, useRef } from 'react'
import type { MapMarker } from '../native/mapApi'
import type { GeoFix } from './geo'
import { hasTencentKey, TENCENT_MAP_KEY } from './keys'
import type { MapHandle } from './mapApi'
import { CAMPUS_CENTER } from './mapTiles'
import './realmaps.css'

/**
 * 腾讯位置服务 GL JS SDK —— 首选底图（与原版 app 用的地图服务一致）。
 *
 * 为什么用 SDK 而不是瓦片：腾讯的栅格瓦片域名直连 404，必须走官方 SDK；
 * SDK 自带矢量底图、惯性拖拽、双指缩放等能力。
 *
 * 为什么标记不用 DOMOverlay：实测（tools/checks 里的探针）DOMOverlay 不会给元素写定位
 * （inline style 为 null，元素全部堆在左上角）。所以这里改用官方的
 * `map.projectToContainer(LatLng)` 自己把经纬度投影成容器像素，再 `translate3d` 定位 ——
 * 逻辑完全可控，而且和 Leaflet 版共用同一套 `.rm` DOM 结构与 CSS。
 *
 * 腾讯官方没有随 npm 提供 TypeScript 类型，这里按实测到的 API 面做最小声明。
 */

interface TencentLatLng {
  getLat(): number
  getLng(): number
}

interface TencentPoint {
  x: number
  y: number
}

interface TencentMapInstance {
  setCenter(center: TencentLatLng): void
  getCenter(): TencentLatLng
  setZoom(zoom: number): void
  getZoom(): number
  zoomBy(delta: number): void
  /** 经纬度 → 容器像素坐标 */
  projectToContainer(latLng: TencentLatLng): TencentPoint | null
  on(event: string, handler: () => void): void
  destroy(): void
}

interface TencentOverlay {
  setMap(map: TencentMapInstance | null): void
  destroy?(): void
}

interface TencentSdk {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => TencentMapInstance
  LatLng: new (lat: number, lng: number) => TencentLatLng
  MultiCircle: new (options: Record<string, unknown>) => TencentOverlay
  CircleStyle: new (options: Record<string, unknown>) => unknown
}

declare global {
  interface Window {
    TMap?: TencentSdk
  }
}

let sdkPromise: Promise<TencentSdk | null> | null = null

/** 只加载一次 SDK；失败返回 null，让上层降级到下一个 provider */
export function loadTencentSdk(): Promise<TencentSdk | null> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(null)
      return
    }
    if (window.TMap) {
      resolve(window.TMap)
      return
    }
    // 没配 Key 就别去请求了：注定失败，还会白等一次网络超时
    if (!hasTencentKey()) {
      resolve(null)
      return
    }
    const script = document.createElement('script')
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${TENCENT_MAP_KEY}`
    script.async = true
    script.onload = () => resolve(window.TMap ?? null)
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
    // 网络慢时不无限等：超时按失败处理，交给下一个 provider
    setTimeout(() => resolve(window.TMap ?? null), 15000)
  })
  return sdkPromise
}

interface PlacedItem {
  wrap: HTMLDivElement
  lat: number
  lng: number
}


export function TencentMap({
  markers,
  here,
  onMarkerClick,
  onSdkFailed,
  mapRef,
}: {
  markers: MapMarker[]
  here?: GeoFix | null
  /** ⭐ P0：回调参数是**地点 id**（标记按地点聚合，点击进地点详情） */
  onMarkerClick: (placeId: string, postId?: string) => void
  onSdkFailed: () => void
  mapRef?: (handle: MapHandle | null) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapObjRef = useRef<TencentMapInstance | null>(null)
  const sdkRef = useRef<TencentSdk | null>(null)
  const placedRef = useRef<PlacedItem[]>([])
  const markerItemsRef = useRef<PlacedItem[]>([])
  const hereItemRef = useRef<PlacedItem | null>(null)
  const rafRef = useRef<number | null>(null)

  // ---- 建图 ----
  useEffect(() => {
    let disposed = false
    let map: TencentMapInstance | null = null

    /** 把已登记的 DOM 标记按当前视图重新投影定位 */
    const place = () => {
      rafRef.current = null
      const T = sdkRef.current
      if (!map || !T) return
      for (const item of placedRef.current) {
        const p = map.projectToContainer(new T.LatLng(item.lat, item.lng))
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          item.wrap.style.visibility = 'hidden'
          continue
        }
        item.wrap.style.visibility = ''
        item.wrap.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`
      }
    }
    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(place)
    }

    void (async () => {
      const host = hostRef.current
      const T = await loadTencentSdk()
      if (disposed || !host) return
      if (!T) {
        onSdkFailed()
        return
      }
      sdkRef.current = T

      map = new T.Map(host, {
        center: new T.LatLng(CAMPUS_CENTER[0], CAMPUS_CENTER[1]),
        zoom: 16,
        minZoom: 4,
        maxZoom: 18,
        viewMode: '2D',
        pitch: 0,
        rotation: 0,
        showControl: false,
      })
      mapObjRef.current = map

      // 标记（DOM 自绘 + 自己投影定位）
      for (const m of markers) {
        const wrap = document.createElement('div')
        wrap.className = 'rm__wrap rm__wrap--tmap'
        const el = buildMarkerElement(m)
        /*
         * 监听挂在 wrap 而不是 .rm 上：.rm 有 translate(-50%,-100%)，
         * 真正可点的可视化区域与 wrap 的布局盒错开；而 z-index 抬高的也是 wrap，
         * 所以点击事件的 target 可能是 .rm、.rm__card 甚至 wrap 自己 —— 统一在 wrap 上收口。
         *
         * 另外记录 pointerdown 位置：从标记上起手的拖动不应该导航（浏览器仍会补发 click），
         * 位移超过阈值就丢弃这次 click，避免「想拖地图却进了地点详情」。
         */
        let downX = 0
        let downY = 0
        wrap.addEventListener('pointerdown', (e) => {
          downX = e.clientX
          downY = e.clientY
        })
        wrap.addEventListener('click', (e) => {
          if (e.detail !== 0 && (Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8)) return
          onMarkerClick(m.placeId, (e.target as Element).closest('.rm__card') ? m.postId || undefined : undefined)
        })
        wrap.appendChild(el)
        host.appendChild(wrap)
        const item: PlacedItem = { wrap, lat: m.lat, lng: m.lng }
        markerItemsRef.current.push(item)
        placedRef.current.push(item)
      }

      const handle: MapHandle = {
        provider: 'tencent',
        flyTo: (lat, lng, zoom = 16) => {
          map?.setCenter(new T.LatLng(lat, lng))
          map?.setZoom(zoom)
          schedule()
        },
        zoomIn: () => {
          map?.zoomBy(1)
          schedule()
        },
        getCenter: () => {
          const c = map?.getCenter()
          return c ? { lat: c.getLat(), lng: c.getLng() } : null
        },
        getZoom: () => map?.getZoom() ?? null,
      }
      mapRef?.(handle)

      // 视图变化时：重投影标记 + 把真实状态写进 data-*（验收脚本据此判断拖拽/缩放）
      const sync = () => {
        const c = handle.getCenter()
        const z = handle.getZoom()
        if (c) host.dataset.center = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`
        if (z != null) host.dataset.zoom = String(z)
        schedule()
      }
      for (const ev of [
        'moving',
        'zooming',
        'moveend',
        'zoomend',
        'center_changed',
        'zoom_changed',
        'idle',
        'resize',
        'tilesloaded',
      ]) {
        map.on(ev, sync)
      }
      place()
      sync()
    })()

    return () => {
      disposed = true
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      mapRef?.(null)
      mapObjRef.current = null
      sdkRef.current = null
      // 自己挂上去的 DOM 要自己摘（SDK 不管这些节点）
      for (const item of placedRef.current) item.wrap.remove()
      placedRef.current = []
      markerItemsRef.current = []
      hereItemRef.current = null
      map?.destroy()
    }
  }, [markers, onMarkerClick, onSdkFailed, mapRef])

  // ---- 蓝点跟随真实定位 ----
  useEffect(() => {
    let disposed = false
    let circle: TencentOverlay | null = null

    const place = () => {
      const T = sdkRef.current
      const map = mapObjRef.current
      const item = hereItemRef.current
      if (!T || !map || !item) return
      const p = map.projectToContainer(new T.LatLng(item.lat, item.lng))
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return
      item.wrap.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`
    }

    void (async () => {
      const T = await loadTencentSdk()
      const map = mapObjRef.current
      const host = hostRef.current
      if (disposed || !T || !map || !host) return

      const lat = here?.lat ?? CAMPUS_CENTER[0]
      const lng = here?.lng ?? CAMPUS_CENTER[1]
      const acc = here?.accuracy ?? 0

      const wrap = document.createElement('div')
      wrap.className = 'rm__wrap rm__wrap--tmap'
      const dot = document.createElement('div')
      dot.className = 'rm__here'
      dot.dataset.lat = String(lat)
      dot.dataset.lng = String(lng)
      dot.dataset.acc = String(acc)
      dot.dataset.real = here ? '1' : '0'
      dot.innerHTML = '<span class="rm__hereCone"></span><span class="rm__hereDot"></span>'
      wrap.appendChild(dot)
      host.appendChild(wrap)

      const item: PlacedItem = { wrap, lat, lng }
      hereItemRef.current = item
      placedRef.current.push(item)
      place()

      // 精度圈（画在 GL canvas 上，与 DOM 定位互不影响）
      if (here && acc > 0 && acc < 20000) {
        try {
          circle = new T.MultiCircle({
            map,
            styles: {
              acc: new T.CircleStyle({
                color: 'rgba(47,124,246,0.12)',
                showBorder: true,
                borderColor: 'rgba(47,124,246,0.6)',
                borderWidth: 1,
              }),
            },
            geometries: [{ id: 'acc', styleId: 'acc', center: new T.LatLng(lat, lng), radius: acc }],
          })
        } catch (error) {
          console.warn('Tencent accuracy circle failed:', error)
        }
      }
    })()

    return () => {
      disposed = true
      const item = hereItemRef.current
      if (item) {
        item.wrap.remove()
        placedRef.current = placedRef.current.filter((p) => p !== item)
        hereItemRef.current = null
      }
      circle?.setMap(null)
      circle?.destroy?.()
    }
  }, [here])

  return <div className="realmaps" data-provider="tencent" ref={hostRef} />
}
