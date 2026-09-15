/**
 * 地图 provider 的统一句柄。
 *
 * 为什么要这层抽象：demo 里同时存在四套底图 ——
 * 腾讯 GL SDK（首选）→ 高德 JS SDK → 栅格瓦片（Leaflet）→ 离线自绘。
 * MapScreen 只依赖这个接口做「回到定位 / 放大」，不关心底下是谁。
 */
export interface MapHandle {
  provider: 'tencent' | 'amap' | 'raster'
  /** 飞过去（带过渡动画） */
  flyTo(lat: number, lng: number, zoom?: number): void
  zoomIn(): void
  getCenter(): { lat: number; lng: number } | null
  getZoom(): number | null
}

export type MapProvider = MapHandle['provider'] | 'offline'
