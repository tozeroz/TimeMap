import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

/**
 * 真实定位封装（Capacitor Geolocation）。
 *
 * - APK：走系统定位（GPS / 融合 / 基站），首次使用会弹系统授权框。
 * - 浏览器预览：退回 navigator.geolocation，行为等价。
 *
 * 与 camera.ts 的分工一致：这里只负责“拿到坐标”，不做任何 UI。
 */
export interface GeoFix {
  lat: number
  lng: number
  /** 水平精度（米），越小越准 */
  accuracy: number
  /** 精度来源判定：<=100m 视为高精度（gps），否则视为网络粗定位 */
  source: 'gps' | 'network'
  /** 定位时间戳（ms） */
  at: number
}

export type GeoStatus = 'idle' | 'asking' | 'ok' | 'denied' | 'unavailable' | 'timeout'

export const isNativePlatform = (): boolean => Capacitor.isNativePlatform()

/** 只查询是否已授权，不弹窗（用于进入地图时静默判断） */
export async function hasLocationPermission(): Promise<boolean> {
  if (!isNativePlatform()) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return false
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      return status?.state === 'granted'
    } catch {
      // 浏览器不支持 permissions API 时只能等真正调用时才知道
      return false
    }
  }
  try {
    const current = await Geolocation.checkPermissions()
    return current.location === 'granted' || current.coarseLocation === 'granted'
  } catch {
    return false
  }
}

/** 请求定位权限，返回是否已授权 */
export async function ensureLocationPermission(): Promise<boolean> {
  if (!isNativePlatform()) {
    // 浏览器：授权弹窗由 nav.geolocation 自己弹，这里只判断 API 是否存在
    return typeof navigator !== 'undefined' && 'geolocation' in navigator
  }
  try {
    const current = await Geolocation.checkPermissions()
    // Android 12+ 用户可能只给“大致位置”，coarseLocation 也算授权
    if (current.location === 'granted' || current.coarseLocation === 'granted') return true
    const asked = await Geolocation.requestPermissions({ permissions: ['location'] })
    return asked.location === 'granted' || asked.coarseLocation === 'granted'
  } catch (error) {
    console.warn('ensureLocationPermission failed:', error)
    return false
  }
}

function toFix(lat: number, lng: number, accuracy: number): GeoFix {
  const acc = Number.isFinite(accuracy) && accuracy > 0 ? accuracy : 9999
  return { lat, lng, accuracy: acc, source: acc <= 100 ? 'gps' : 'network', at: Date.now() }
}

function webOnce(high: boolean, timeout: number, maximumAge: number): Promise<GeoFix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)),
      (error) => {
        console.warn('web geolocation failed:', error.message)
        resolve(null)
      },
      { enableHighAccuracy: high, timeout, maximumAge },
    )
  })
}

async function nativeOnce(high: boolean, timeout: number, maximumAge: number): Promise<GeoFix | null> {
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: high,
      timeout,
      maximumAge,
    })
    return toFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)
  } catch (error) {
    console.warn('native geolocation failed:', error)
    return null
  }
}

/**
 * 读一次当前位置。
 * 先要高精度（GPS，慢但准），失败后用粗定位（基站/WiFi，快）兜底 —— 这是
 * 地图类 App 的常规策略：宁可先给一个粗略点，也不让蓝点长时间不出现。
 */
export async function getCurrentFix(): Promise<GeoFix | null> {
  const attempts: Array<[boolean, number, number]> = [
    [true, 10000, 60000],
    [false, 15000, 600000],
  ]
  for (const [high, timeout, maximumAge] of attempts) {
    const fix = isNativePlatform()
      ? await nativeOnce(high, timeout, maximumAge)
      : await webOnce(high, timeout, maximumAge)
    if (fix) return fix
  }
  return null
}

/** 持续跟踪位置变化，返回停止函数 */
export async function watchFix(onFix: (fix: GeoFix) => void): Promise<() => void> {
  if (!isNativePlatform()) {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return () => {}
    const id = navigator.geolocation.watchPosition(
      (pos) => onFix(toFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)),
      (error) => console.warn('web watchPosition error:', error.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }
  try {
    const id = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
      (pos, error) => {
        if (error || !pos) return
        onFix(toFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy))
      },
    )
    return () => {
      void Geolocation.clearWatch({ id })
    }
  } catch (error) {
    console.warn('watchPosition failed:', error)
    return () => {}
  }
}

/** 两点球面距离（米）—— 用来判断“我离校园多远” */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 距离的可读文本：近距离给米，远距离给公里 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters / 1000)} km`
}

/** 精度的可读文本（米）。模拟器会给出 0.02m 这种不真实的值，统一显示为 ±1 m */
export function formatAccuracy(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '未知'
  if (meters < 1) return '1 m'
  if (meters < 10) return `${meters.toFixed(1)} m`
  return `${Math.round(meters)} m`
}
