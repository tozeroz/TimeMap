import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapMarker } from '../native/mapApi'
import type { GeoFix } from './geo'
import { measureMarkerExtent, nextMapInstance, type MapHandle } from './mapApi'
import { markerClickPostId, markerHasPost, markerHtml, markerIconBox } from './markerDom'
import { activeTileConfig, CAMPUS_CENTER } from './mapTiles'
import './realmaps.css'


/**
 * 栅格瓦片地图（Leaflet + 可配置瓦片源）—— 官方 SDK 不可用时的兜底。
 *
 * 为什么保留它：不需要 key、不依赖任何厂商 SDK 域名，只要瓦片能下就能出图；
 * 瓦片连续加载失败时回调 onTilesFailed，让上层退回离线自绘地图。
 *
 * 标记沿用原版形态：照片卡片 + 彩色图钉 + 地点名（用 divIcon 自绘）。
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

    host.dataset.mapInstance = nextMapInstance()
    const byPlace = new Map<string, L.Marker>()
    let selected: string | null = null
    const rmOf = (placeId: string) => byPlace.get(placeId)?.getElement()?.querySelector('.rm') ?? null

    // 标记：照片卡片 + 图钉 + 地点名
    for (const m of markers) {
      /* 共用构造器：有帖子 ⇒ 卡片；没帖子 ⇒ 只有名称标签（不再画空白卡片） */
      const box = markerIconBox(m)
      const icon = L.divIcon({
        html: markerHtml(m),
        className: 'rm__wrap',
        iconSize: box.size,
        iconAnchor: box.anchor,
      })
      const marker = L.marker([m.lat, m.lng], { icon, zIndexOffset: markerHasPost(m) ? 200 : 0 })
      marker.on('click', (e) => {
        const native = e.originalEvent
        const el = (native?.target instanceof Element ? native.target : document.body) as HTMLElement
        const cardEl = (el.closest('.rm') as HTMLElement | null) ?? el
        onMarkerClick(m.placeId, markerClickPostId(cardEl, m, { target: native?.target ?? null, clientX: native?.clientX ?? 0, clientY: native?.clientY ?? 0 }))
      })
      marker.addTo(map)
      byPlace.set(m.placeId, marker)
    }

    mapObjRef.current = map
    setReady(true)
    /** 动画平移结束后的精确对齐（Leaflet 会把平移量取整到整像素） */
    let exactFix: (() => void) | null = null
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
      project: (lat, lng) => {
        const p = map.latLngToContainerPoint([lat, lng])
        return { x: p.x, y: p.y }
      },
      unproject: (x, y) => {
        const c = map.containerPointToLatLng([x, y])
        return { lat: c.lat, lng: c.lng }
      },
      setView: (lat, lng, zoom, animate) => {
        if (exactFix) { map.off('moveend', exactFix); exactFix = null }
        if (!animate) { map.setView([lat, lng], zoom, { animate: false }); return }
        /*
          先 stop() 结束上一段动画（它会同步触发 moveend），再注册监听、再 setView（design-review F6）。
          不能放到 setView 之后：平移量取整为 0 时 Leaflet 会在 setView 内部同步触发 moveend。
        */
        map.stop()
        const fix = () => {
          exactFix = null
          const c = map.latLngToContainerPoint([lat, lng])
          const m = map.latLngToContainerPoint(map.getCenter())
          // 只补齐取整误差；用户中途拖动或缩放过就不把地图拽回去
          // reset: true —— 不到 1px 的偏移 Leaflet 的普通 setView 会直接忽略（平移量取整为 0）
          if (map.getZoom() === zoom && Math.hypot(c.x - m.x, c.y - m.y) <= 1.5) map.setView([lat, lng], zoom, { reset: true } as L.ZoomPanOptions)
        }
        exactFix = fix
        map.once('moveend', fix)
        map.setView([lat, lng], zoom, { animate: true, duration: 0.3 })
      },
      getSize: () => {
        const s = map.getSize()
        return { width: s.x, height: s.y }
      },
      // pan: true 保持中心不变（pan: false 会保持左上角，容器变高时中心漂移）
      resize: () => { map.invalidateSize({ pan: true, animate: false }) },
      setSelected: (placeId) => {
        if (selected) { rmOf(selected)?.classList.remove('rm--selected'); byPlace.get(selected)?.setZIndexOffset(0) }
        selected = placeId
        if (placeId) { rmOf(placeId)?.classList.add('rm--selected'); byPlace.get(placeId)?.setZIndexOffset(1000) }
      },
      getMarkerExtent: (placeId) => {
        const mk = byPlace.get(placeId)
        if (!mk) return null
        const p = map.latLngToContainerPoint(mk.getLatLng())
        return measureMarkerExtent(rmOf(placeId), map.getContainer(), p)
      },
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

