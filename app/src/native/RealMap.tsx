import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapMarker } from '../data/mock'
import { posts } from '../data/mock'
import { activeTileConfig, CAMPUS_CENTER } from './mapTiles'
import './realmaps.css'

/**
 * 真实在线地图（Leaflet + 可配置瓦片源）。
 *
 * 为什么用 Leaflet：拖拽/缩放/惯性由它原生实现，跨 WebView 稳定；
 * 瓦片源在 mapTiles.ts 里配置，拿到官方 key 后可一处切换。
 *
 * 标记沿用原版形态：照片卡片 + 彩色图钉 + 地点名（用 divIcon 自绘）。
 * 瓦片连续加载失败时回调 onTilesFailed，让上层退回离线自绘地图。
 */
export function RealMap({
  markers,
  onMarkerClick,
  onTilesFailed,
  mapRef,
}: {
  markers: MapMarker[]
  onMarkerClick: (postId: string) => void
  onTilesFailed: () => void
  mapRef?: (map: L.Map | null) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const failedRef = useRef(0)

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

    // 标记：照片卡片 + 图钉 + 地点名
    for (const m of markers) {
      const post = posts.find((p) => p.id === m.postId)
      const cover = post?.images[0]
      const body = cover
        ? `<img class="rm__img" src="${cover}" alt="" />`
        : `<span class="rm__img rm__img--text">${(post?.text ?? '').slice(0, 10)}</span>`
      const html = `
        <div class="rm">
          <div class="rm__card">${body}<span class="rm__name">${m.place}</span></div>
          <span class="rm__pin" style="color:${m.color}">
            <svg width="18" height="24" viewBox="0 0 20 26"><path d="M10 25.5S19 15.6 19 9.6A9 9 0 0 0 1 9.6c0 6 9 15.9 9 15.9Z" fill="currentColor"/><circle cx="10" cy="9.6" r="3.4" fill="#fff"/></svg>
          </span>
        </div>`
      const icon = L.divIcon({
        html,
        className: 'rm__wrap',
        iconSize: [76, 100],
        iconAnchor: [38, 100],
      })
      const marker = L.marker([m.lat, m.lng], { icon })
      marker.on('click', () => onMarkerClick(m.postId))
      marker.addTo(map)
    }

    // 当前位置：蓝点 + 方向扇形
    const hereIcon = L.divIcon({
      html: `<div class="rm__here"><span class="rm__hereCone"></span><span class="rm__hereDot"></span></div>`,
      className: 'rm__wrap',
      iconSize: [80, 80],
      iconAnchor: [40, 40],
    })
    L.marker(CAMPUS_CENTER, { icon: hereIcon, interactive: false }).addTo(map)

    mapRef?.(map)

    return () => {
      mapRef?.(null)
      map.remove()
    }
  }, [markers, onMarkerClick, onTilesFailed, mapRef])

  return <div className="realmaps" ref={hostRef} />
}
