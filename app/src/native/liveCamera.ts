/**
 * 页内摄像头（getUserMedia）—— 发布页拍摄模式的真实实现。
 *
 * 为什么不用 @capacitor/camera：原版的拍摄页是**页内实时取景**，
 * 底部三个键是「相册 / 快门 / 前后置切换」。Capacitor Camera 插件走的是
 * 「拉起系统相机 App」，那是另一套交互（拍完再回到 App），形态对不上。
 * 页内取景只能用 WebRTC 的 getUserMedia（Capacitor 的 WebView 支持）。
 *
 * 真机注意：
 * - Android WebView 里 getUserMedia 需要宿主 App 持有 CAMERA 权限，
 *   并且 WebChromeClient 要放行 RESOURCE_VIDEO_CAPTURE（Capacitor 已实现）。
 *   所以调用前仍然要先 ensureCameraPermission()。
 * - 页面必须是安全上下文（Capacitor 用 https://localhost，浏览器用 127.0.0.1，都算）。
 */

export type CameraFacing = 'user' | 'environment'

export interface CameraErrorInfo {
  kind: 'unsupported' | 'denied' | 'notfound' | 'inuse' | 'unknown'
  /** 面向用户的说明 */
  message: string
}

/** 把 getUserMedia 的各种报错翻译成能显示给人看的话 */
export function describeCameraError(error: unknown): CameraErrorInfo {
  const name = (error as { name?: string } | null)?.name ?? ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { kind: 'denied', message: '摄像头权限被拒绝，请到系统设置里允许本应用使用摄像头' }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { kind: 'notfound', message: '没有检测到可用摄像头（模拟器通常没有），可以用「相册」选图' }
    case 'NotReadableError':
    case 'AbortError':
      return { kind: 'inuse', message: '摄像头被其它应用占用，请关掉后重试' }
    case 'TimeoutError':
      return { kind: 'inuse', message: '摄像头一直没有响应（可能被其它程序占用），请重试或用「相册」选图' }
    default:
      return {
        kind: 'unknown',
        message: `摄像头打开失败${name ? `（${name}）` : ''}，可以用「相册」选图`,
      }
  }
}

export function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

/**
 * 打开摄像头。先按 facingMode 精确请求，失败再退化成「随便给一个」——
 * 有些设备/WebView 不支持 facingMode 约束，但摄像头本身是好的。
 *
 * 必须带超时：实测某些环境下（例如 Windows 上摄像头被别的进程占用）
 * getUserMedia 既不 resolve 也不 reject，会一直挂着，界面就永远停在「正在打开」。
 */
export async function startCamera(facing: CameraFacing, timeoutMs = 12000): Promise<MediaStream> {
  if (!cameraSupported()) {
    throw Object.assign(new Error('getUserMedia unsupported'), { name: 'NotSupportedError' })
  }
  const attempts: MediaStreamConstraints[] = [
    {
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    },
    { video: { facingMode: facing }, audio: false },
    { video: true, audio: false },
  ]
  let lastError: unknown = null
  // 总时长封顶：三次尝试共用一个预算，避免最坏情况 3×12 秒都耗在「正在打开…」上
  const deadline = Date.now() + timeoutMs
  for (const constraints of attempts) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    try {
      return await withTimeout(navigator.mediaDevices.getUserMedia(constraints), remaining)
    } catch (error) {
      lastError = error
      // 权限被拒就别再试了，重试只会再弹一次
      const name = (error as { name?: string }).name
      if (name === 'NotAllowedError' || name === 'SecurityError') throw error
    }
  }
  throw lastError ?? new Error('camera unavailable')
}

/** 给可能永远不 settle 的 Promise 加超时；超时会顺便把已经拿到的流关掉 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('camera start timed out'), { name: 'TimeoutError' }))
      // 超时之后流可能姗姗来迟，拿到就立刻关掉，避免摄像头一直亮着
      promise.then((value) => {
        const stream = value as unknown as MediaStream
        stream?.getTracks?.().forEach((t) => t.stop())
      }, () => undefined)
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** 设备上有几个摄像头 —— 只有一个时「前后置切换」没有意义 */
export async function countCameras(): Promise<number> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return 0
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'videoinput').length
  } catch {
    return 0
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop())
}

/**
 * 抓取当前取景画面。
 *
 * 注意：前置摄像头的**预览**是镜像的（符合直觉），但**存下来的照片不镜像** ——
 * 这是原生相机的通行做法（存下来的是别人看你的样子），所以这里不做翻转。
 */
export function captureFrame(
  video: HTMLVideoElement,
  maxEdge = 1280,
  quality = 0.72,
): string | null {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return null
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, cw, ch)
  return canvas.toDataURL('image/jpeg', quality)
}

/** 变焦：只有部分设备的 track 支持 zoom，支持才真的改，不支持就返回 false */
export async function applyZoom(stream: MediaStream | null, factor: number): Promise<boolean> {
  const track = stream?.getVideoTracks()[0]
  if (!track?.getCapabilities) return false
  try {
    const caps = track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number } }
    if (!caps.zoom) return false
    const target = Math.min(caps.zoom.max, Math.max(caps.zoom.min, factor))
    // 标准 TS 类型里还没有 zoom 这个约束，运行时才有，所以这里显式绕一下类型
    const constraints = { advanced: [{ zoom: target }] } as unknown as MediaTrackConstraints
    await track.applyConstraints(constraints)
    return true
  } catch {
    return false
  }
}
