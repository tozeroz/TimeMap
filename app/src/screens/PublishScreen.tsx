import { useCallback, useEffect, useRef, useState } from 'react'
import { createPost, toFeedPost } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconCamera, IconClose, IconFlip, IconImage, IconLocation, IconMic } from '../components/icons'
import { addMyPost, addServerPost, markPostSynced } from '../data/store'
import { ensureCameraPermission, pickPhoto } from '../native/camera'
import {
  applyZoom,
  cameraSupported,
  captureFrame,
  countCameras,
  describeCameraError,
  startCamera,
  stopStream,
  type CameraErrorInfo,
  type CameraFacing,
} from '../native/liveCamera'
import { goBack, navigate, useRoute } from '../router'
import './publish.css'

type Mode = '语音' | '拍摄' | '文字'

const FONTS = ['经典', '黑体', '宋体', '手写体'] as const
const ZOOM_STEPS = ['1x', '2x', '5x'] as const

/**
 * 发布页（原版点右下角「+」进入）。三模式合成器：
 *
 * - 拍摄：**页内实时取景**（getUserMedia），底部三个键依次是
 *   「相册选图 / 快门拍摄 / 前后置切换」—— 与原版一致。
 *   不用 Capacitor Camera 的原因见 native/liveCamera.ts 顶部注释。
 * - 文字：图文编辑器，「说点什么...」+ 从相册选图 + 字体选择
 * - 语音：录音波形（占位，未接真实录音）
 *
 * 点「发布」：先把草稿写进本地帖子库（离线也能立刻看到），
 * 再 POST 到后端落库（M1 的垂直切片）；返回校园页后帖子在信息流最前面。
 */
export function PublishScreen() {
  const route = useRoute()
  const [mode, setMode] = useState<Mode>('拍摄')
  const [zoom, setZoom] = useState<(typeof ZOOM_STEPS)[number]>('1x')
  const [text, setText] = useState('')
  const [font, setFont] = useState<(typeof FONTS)[number]>('经典')
  const [place, setPlace] = useState(route.query.place ?? '北京交通大学')
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [flash, setFlash] = useState(false)

  // ---- 实时取景 ----
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [facing, setFacing] = useState<CameraFacing>('environment')
  const [camState, setCamState] = useState<'idle' | 'starting' | 'live' | 'error'>('idle')
  const [camError, setCamError] = useState<CameraErrorInfo | null>(null)
  const [camCount, setCamCount] = useState(0)

  const stopCamera = useCallback(() => {
    stopStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamState('idle')
  }, [])

  const startCameraStream = useCallback(async () => {
    if (!cameraSupported()) {
      setCamState('error')
      setCamError({ kind: 'unsupported', message: '当前环境不支持页内取景，可以用「相册」选图' })
      return
    }
    setCamState('starting')
    setCamError(null)
    try {
      // 原生端必须先拿到系统相机权限，否则 WebView 的 getUserMedia 会被拒
      await ensureCameraPermission()
      const stream = await startCamera(facing)
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => undefined)
      }
      setCamState('live')
      setCamCount(await countCameras())
    } catch (error) {
      console.warn('live camera failed:', error)
      setCamState('error')
      setCamError(describeCameraError(error))
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [facing])

  // 进入拍摄模式才开摄像头；离开就关掉（省电，也避免和别的 App 抢摄像头）
  useEffect(() => {
    if (mode !== '拍摄') {
      stopCamera()
      return
    }
    void startCameraStream()
    return () => stopCamera()
  }, [mode, startCameraStream, stopCamera])

  const flipCamera = useCallback(() => {
    setFacing((f) => (f === 'environment' ? 'user' : 'environment'))
  }, [])

  useEffect(() => {
    if (camState === 'live') void applyZoom(streamRef.current, Number(zoom.replace('x', '')))
  }, [zoom, camState])

  /** 快门：抓当前取景画面进草稿 */
  const shoot = useCallback(() => {
    const video = videoRef.current
    if (!video || camState !== 'live') return
    const frame = captureFrame(video)
    if (!frame) return
    setImages((prev) => [frame, ...prev])
    setFlash(true)
    window.setTimeout(() => setFlash(false), 160)
  }, [camState])

  const addFromGallery = useCallback(async () => {
    setBusy(true)
    try {
      const photo = await pickPhoto()
      if (photo) setImages((prev) => [...prev, photo.dataUrl])
    } finally {
      setBusy(false)
    }
  }, [])

  function publish() {
    if (publishing || (!text.trim() && images.length === 0)) return
    void doPublish()
  }

  /**
   * 发布：**先写本地，再同步服务器**。
   *
   * 顺序不能反：网络慢或不通时，用户点完发布应该立刻在信息流看到自己的帖子，
   * 而不是对着转圈等 8 秒超时。本地这份是"即时反馈"，服务器那份是"权威副本"；
   * 同步成功后用服务器返回的 id 把两者关联起来，避免同一条帖子显示两张卡。
   *
   * M1 只同步文本（图片上传是 M4）。带图的帖子：图片留在本地，
   * 文字部分同样会进服务器。
   */
  async function doPublish() {
    setPublishing(true)
    const draft = text.trim() || '分享了图片'
    const local = addMyPost({ text, images, place })
    try {
      const result = await createPost({ body: draft, place: place || undefined })
      if (result.ok) {
        markPostSynced(local.id, result.value.id)
        addServerPost(toFeedPost(result.value))
      } else if (result.status === 401) {
        // M2 起发帖需要会话；登录界面在 M3 接。这里如实区分"没登录"与"网络不通"，
        // 免得线上排障时把两种情况混成一句"同步失败"。
        console.warn('[publish] 未登录（401），帖子只存在本地；登录功能将在 M3 接入')
      } else {
        console.warn('[publish] 同步到服务器失败，帖子已存在本地：', result.reason)
      }
    } finally {
      setPublishing(false)
      navigate('campus')
    }
  }

  const canPublish = text.trim().length > 0 || images.length > 0
  const live = camState === 'live'
  const canFlip = camCount > 1

  return (
    <Screen
      className="pub"
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn pub__close" onClick={() => goBack('campus')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center={
            <span className="pub__poiWrap">
              <button className="pub__poi" onClick={() => navigate('poi')}>
                <IconLocation size={13} />
                <span>{place || '添加地点'}</span>
              </button>
              {place && (
                <button className="pub__poiClear" onClick={() => setPlace('')} aria-label="移除地点">
                  <IconClose size={12} />
                </button>
              )}
            </span>
          }
          right={
            <button
              className={`pub__publish ${canPublish ? 'is-on' : ''}`}
              onClick={publish}
              disabled={!canPublish || publishing}
              data-publishing={publishing ? '1' : '0'}
            >
              {publishing ? '发布中' : '发布'}
            </button>
          }
        />
      }
      scroll={false}
    >
      <div className="pub__body">
        {mode === '拍摄' && (
          <div className="pub__viewfinder">
            <video
              ref={videoRef}
              className={`pub__video ${facing === 'user' ? 'is-mirrored' : ''}`}
              playsInline
              muted
              autoPlay
              data-cam-state={camState}
              data-facing={facing}
            />
            {!live && (
              <div className="pub__camFallback">
                <span className="pub__camFallbackIcon" aria-hidden>
                  <IconCamera size={30} />
                </span>
                <p className="pub__camFallbackText">
                  {camState === 'starting' ? '正在打开摄像头…' : (camError?.message ?? '')}
                </p>
                {camState === 'error' && (
                  <button className="pub__camRetry" onClick={() => void startCameraStream()}>
                    重试
                  </button>
                )}
              </div>
            )}
            <div className="pub__gridlines" />
            {flash && <div className="pub__flash" />}
            <div className="pub__zooms">
              {ZOOM_STEPS.map((z) => (
                <button
                  key={z}
                  className={`pub__zoom ${zoom === z ? 'is-active' : ''}`}
                  onClick={() => setZoom(z)}
                  disabled={!live}
                >
                  {z}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === '文字' && (
          <div className="pub__editor">
            <textarea
              className="pub__textarea"
              placeholder="说点什么..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="pub__thumbs">
              {images.map((src, i) => (
                <img key={i} className="pub__thumbImg" src={src} alt="" />
              ))}
              <button className="pub__thumbAdd" onClick={addFromGallery} aria-label="添加图片">
                <IconImage size={20} />
              </button>
            </div>
            <div className="pub__fonts no-scrollbar">
              {FONTS.map((f) => (
                <button
                  key={f}
                  className={`pub__font ${font === f ? 'is-active' : ''}`}
                  onClick={() => setFont(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === '语音' && (
          <div className="pub__voice">
            <div className="pub__wave" aria-hidden>
              {Array.from({ length: 28 }).map((_, i) => (
                <span key={i} style={{ height: `${12 + ((i * 37) % 46)}px` }} />
              ))}
            </div>
            <p className="pub__voiceTip">按住说话，最长 60 秒</p>
            <p className="pub__voiceTip">（录音功能尚未接入真实麦克风）</p>
          </div>
        )}
      </div>

      {/*
        底栏主键区：与原版一致 —— 左「相册选图」，中「快门」，右「前后置切换」。
        模式切换单独放一行，避免和这三个键抢位置。
      */}
      <div className="pub__controls">
        <button className="pub__side" onClick={addFromGallery} aria-label="相册" disabled={busy}>
          <IconImage size={22} />
        </button>

        {mode === '拍摄' && (
          <button
            className="pub__shutter"
            onClick={shoot}
            disabled={!live}
            aria-label="拍摄"
          >
            <span className="pub__shutterInner" />
          </button>
        )}

        {mode === '语音' && (
          <button className="pub__shutter pub__shutter--voice" aria-label="按住说话" disabled>
            <IconMic size={26} />
          </button>
        )}

        {mode === '文字' && (
          <button className="pub__send" onClick={publish} disabled={!canPublish || publishing}>
            {publishing ? '发布中' : '发布'}
          </button>
        )}

        {mode === '拍摄' ? (
          <button
            className={`pub__side ${canFlip ? '' : 'is-off'}`}
            onClick={flipCamera}
            aria-label="切换前后置摄像头"
            disabled={!live || !canFlip}
          >
            <IconFlip size={22} />
          </button>
        ) : (
          <span className="pub__side pub__side--ghost" aria-hidden />
        )}
      </div>

      <div className="pub__modesRow">
        {(['语音', '拍摄', '文字'] as Mode[]).map((m) => (
          <button
            key={m}
            className={`pub__mode ${mode === m ? 'is-active' : ''}`}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {images.length > 0 && (
        <div className="pub__draftBar no-scrollbar">
          {images.map((src, i) => (
            <div key={i} className="pub__draftItem">
              <img src={src} alt="" />
              <button
                className="pub__draftRemove"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="移除"
              >
                <IconClose size={12} />
              </button>
            </div>
          ))}
          <span className="pub__draftCount">
            {mode === '拍摄' ? `已拍 ${images.length} 张` : `已选 ${images.length} 张`}
          </span>
        </div>
      )}
    </Screen>
  )
}
