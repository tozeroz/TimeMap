import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'

/**
 * 摄像头 / 相册封装。
 *
 * - 原生（APK）：走 Capacitor Camera 插件，真正调用系统相机与相册。
 * - 浏览器预览：退回 <input type="file">，行为等价（选图/拍照由浏览器决定）。
 *
 * 返回压缩后的 dataURL，便于直接存进本地帖子库并离线显示。
 */
export interface CapturedImage {
  dataUrl: string
  format: string
}

const MAX_EDGE = 1280
const JPEG_QUALITY = 0.72

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

/** 用 canvas 把图片压到合理尺寸，避免本地存储被大图撑爆 */
async function compress(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/** 浏览器兜底：文件选择（可选 capture 走摄像头） */
function pickViaInput(capture: boolean): Promise<CapturedImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (capture) input.capture = 'environment'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = async () => resolve({ dataUrl: await compress(String(reader.result)), format: 'jpeg' })
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** 拍一张照片 */
export async function takePhoto(): Promise<CapturedImage | null> {
  if (!isNative()) return pickViaInput(true)
  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      saveToGallery: false,
    })
    if (!photo.dataUrl) return null
    return { dataUrl: await compress(photo.dataUrl), format: photo.format ?? 'jpeg' }
  } catch (error) {
    // 用户取消不应该抛到界面上
    console.warn('takePhoto cancelled/failed:', error)
    return null
  }
}

/** 从相册选一张照片 */
export async function pickPhoto(): Promise<CapturedImage | null> {
  if (!isNative()) return pickViaInput(false)
  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Photos,
      saveToGallery: false,
    })
    if (!photo.dataUrl) return null
    return { dataUrl: await compress(photo.dataUrl), format: photo.format ?? 'jpeg' }
  } catch (error) {
    console.warn('pickPhoto cancelled/failed:', error)
    return null
  }
}

/** 请求相机/相册权限（原生） */
export async function ensureCameraPermission(): Promise<boolean> {
  if (!isNative()) return true
  try {
    const status = await Camera.checkPermissions()
    if (status.camera === 'granted' || status.photos === 'granted') return true
    const req = await Camera.requestPermissions({ permissions: ['camera', 'photos'] })
    return req.camera === 'granted' || req.photos === 'granted'
  } catch {
    return false
  }
}
