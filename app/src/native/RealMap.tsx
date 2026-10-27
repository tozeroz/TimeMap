import { buildMarkerElement } from './placeMarker'
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapMarker } from '../native/mapApi'
import type { GeoFix } from './geo'
import type { MapHandle } from './mapApi'
import { activeTileConfig, CAMPUS_CENTER } from './mapTiles'
import './realmaps.css'


/**
 * 栅格瓦片地图（Leaflet + 可配置瓦片源）—— 官方 SDK 不可用时的兜底。
 *
 * 为什么保留它：不需要 key、不依赖任何厂商 SDK 域名，只要瓦片能下就能出图；
 * 瓦片连续加载失败时回调 onTilesFailed，让上层退回离线自绘地图。
 *
 * 标记使用分类 PNG 与透明地点名；代表帖卡片独立显示（用 divIcon 自绘）。
 * 蓝点用真实定位坐标（here），拿不到时退回校园中心，绝不留空白。
 */
export function RealMap({
  markers,
  here,
  onMarkerClick,
  onTilesFailed,
  mapRef,
}: {
  markers: MapMarker[]
  /** 真实定位结果；null = 尚未拿到，蓝点先停在校园中心 */
  here?: GeoFix | null
  /** ⭐ P0：回调参数是**地点 id**（标记按地点聚合，点击进地点详情） */
  onMarkerClick: (placeId: string, postId?: string) => void
  onTilesFailed: () => void
  mapRef?: (handle: MapHandle | null) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const failedRef = useRef(0)
  const mapObjRef = useRef<L.Map | null>(null)
  const hereLayerRef = useRef<{ marker: L.Marker; circle: L.Circle | null } | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const cfg = activeTileConfig()
    const map = L.map(host, {
      center: CAMPUS_CENTER,
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
      // 触屏拖拽/双指缩放由 Leaflet 原生处理
    })

    const layer = L.tileLayer(cfg.urlTemplate, {
      subdomains: cfg.subdomains,
      maxZoom: cfg.maxZoom,
      crossOrigin: true,
    })
    layer.on('tileerror', () => {
      failedRef.current += 1
      // 连续失败说明瓦片源不可用（无网络/被墙/无 key），交给上层降级
      if (failedRef.current >= 3) onTilesFailed()
    })
    layer.addTo(map)

    // Shared place symbol and independent representative-post control.
    for (const m of markers) {
      const icon = L.divIcon({
        html: buildMarkerElement(m),
        className: 'rm__wrap',
        iconSize: [104, 80],
        iconAnchor: [52, 80],
      })
      const marker = L.marker([m.lat, m.lng], { icon, keyboard: false })
      marker.on('click', (e) => onMarkerClick(m.placeId, (e.originalEvent.target as Element)?.closest('.rm__card') ? m.postId || undefined : undefined))
      marker.addTo(map)
    }

    mapObjRef.current = map
    setReady(true)
    mapRef?.({
      provider: 'raster',
      flyTo: (lat, lng, zoom = 16) => {
        map.flyTo([lat, lng], zoom, { duration: 0.6 })
      },
      zoomIn: () => map.zoomIn(),
      getCenter: () => {
        const c = map.getCenter()
        return { lat: c.lat, lng: c.lng }
      },
      getZoom: () => map.getZoom(),
    })

    // 把地图真实状态写到 data-*，验收脚本据此判断拖拽/缩放（provider 无关）
    const sync = () => {
      const c = map.getCenter()
      host.dataset.center = `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`
      host.dataset.zoom = String(map.getZoom())
    }
    map.on('move zoom moveend zoomend', sync)
    sync()

    return () => {
      // remove() can finish a pending pan/resize after its panes are gone.
      // Detach our observer before teardown so a marker click can safely navigate.
      map.off('move zoom moveend zoomend', sync)
      mapObjRef.current = null
      hereLayerRef.current = null
      mapRef?.(null)
      map.remove()
    }
  }, [markers, onMarkerClick, onTilesFailed, mapRef])

  // 蓝点：跟随真实定位。坐标写进 data-* ，便于验收脚本读取实际落点。
  useEffect(() => {
    const map = mapObjRef.current
    if (!map || !ready) return

    if (hereLayerRef.current) {
      hereLayerRef.current.marker.remove()
      hereLayerRef.current.circle?.remove()
      hereLayerRef.current = null
    }

    const lat = here?.lat ?? CAMPUS_CENTER[0]
    const lng = here?.lng ?? CAMPUS_CENTER[1]
    const acc = here?.accuracy ?? 0
    const hereIcon = L.divIcon({
      html: `<div class="rm__here" data-lat="${lat}" data-lng="${lng}" data-acc="${acc}" data-real="${here ? 1 : 0}"><span class="rm__hereCone"></span><span class="rm__hereDot"></span></div>`,
      className: 'rm__wrap',
      iconSize: [80, 80],
      iconAnchor: [40, 40],
    })
    const marker = L.marker([lat, lng], { icon: hereIcon, interactive: false }).addTo(map)
    // 精度圈：让“这个点有多可信”看得见
    const circle =
      here && acc > 0 && acc < 20000
        ? L.circle([lat, lng], {
            radius: acc,
            color: '#2f7cf6',
            weight: 1,
            fillColor: '#2f7cf6',
            fillOpacity: 0.12,
          }).addTo(map)
        : null
    hereLayerRef.current = { marker, circle }
  }, [here, ready])

  return <div className="realmaps" data-provider="raster" ref={hostRef} />
}

