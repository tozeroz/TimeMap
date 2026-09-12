/**
 * 地图瓦片源配置。
 *
 * 这里是"真实地图"的唯一开关点：换 provider 或填 key 只改这个文件。
 *
 * 现状（2026-09-12 实测可达性）：
 * - 高德栅格瓦片（无需 key）：✅ 可达，已作为默认
 * - 天地图 WMTS（需免费 key）：服务可达，但无 key 时返回 418
 * - 腾讯 gtimg 瓦片：直连 404，需要走官方 JS SDK（需 key + 域名白名单）
 * - OpenStreetMap：本机网络超时不可达
 *
 * ⚠️ 关于合规：直接引用高德瓦片域名属于"未授权调用"，
 * 仅适合本地演示。要正式使用请到 lbs.amap.com / lbs.qq.com 申请 key
 * （需要账号与实名认证），拿到后填进下面的 amapKey / tiandituKey 即可切换。
 */
export type TileProvider = 'amap-unofficial' | 'tianditu' | 'tencent-js'

export interface TileConfig {
  provider: TileProvider
  urlTemplate: string
  subdomains: string[]
  attribution: string
  maxZoom: number
  /** 天地图 / 腾讯等需要 key 的服务填这里 */
  key?: string
}

/** 高德栅格瓦片（无 key，演示用） */
const AMAP_UNOFFICIAL: TileConfig = {
  provider: 'amap-unofficial',
  urlTemplate: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  subdomains: ['1', '2', '3', '4'],
  attribution: '© 高德地图',
  maxZoom: 18,
}

/** 天地图矢量底图（免费注册送 key，官方且合规） */
export function tiandituConfig(key: string): TileConfig {
  return {
    provider: 'tianditu',
    urlTemplate: `https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${key}`,
    subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
    attribution: '© 天地图',
    maxZoom: 18,
    key,
  }
}

/** 用户填了天地图 key 就用天地图，否则用高德演示瓦片 */
export const TIANDITU_KEY = '' // ← 拿到 key 后填这里

export function activeTileConfig(): TileConfig {
  return TIANDITU_KEY ? tiandituConfig(TIANDITU_KEY) : AMAP_UNOFFICIAL
}

/** 北京交通大学（校本部）坐标 */
export const CAMPUS_CENTER: [number, number] = [39.9503, 116.3396]
