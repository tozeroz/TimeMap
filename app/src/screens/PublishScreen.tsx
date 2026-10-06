import { useCallback, useEffect, useRef, useState } from 'react'
import { createPost, toFeedPost, uploadMedia } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconCamera, IconClose, IconFlip, IconImage, IconLocation, IconMic } from '../components/icons'
import { addMyPost, addServerPost, markPostSynced } from '../data/store'
import { ensureCameraPermission, pickPhoto } from '../native/camera'
import { RecorderError, formatDuration, startRecording, type RecorderSession } from '../native/recorder'
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
 * dataURL → Blob。
 *
 * ⭐ WO#21（Round 319）：发布页的图片在内存里是 **dataURL 字符串**
 *   （`captureFrame()` 返回 dataURL、`pickPhoto()` 返回 `photo.dataUrl`），
 *   而上传接口 `uploadMedia()` 要的是 `File | Blob` ⇒ 需要这一层转换。
 *   ⚠️ 用 `fetch(dataUrl)` 而不是 `atob()` 手工解码：
 *     `atob` 对**非 Latin-1** 的 dataURL 会抛错，而 fetch 走浏览器的标准解码路径。
 */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const r = await fetch(dataUrl)
  return r.blob()
}

/**
 * 发布页（原版点右下角「+」进入）。三模式合成器：
 *
 * - 拍摄：**页内实时取景**（getUserMedia），底部三个键依次是
 *   「相册选图 / 快门拍摄 / 前后置切换」—— 与原版一致。
 *   不用 Capacitor Camera 的原因见 native/liveCamera.ts 顶部注释。
 * - 文字：图文编辑器，「说点什么...」+ 从相册选图 + 字体选择
 * - 语音：**真实录音**（WO#21 起；此前是占位波形）
 *
 * 点「发布」：先把草稿写进本地帖子库（离线也能立刻看到），
 * 再 POST 到后端落库；**媒体（图片/语音）先上传、再随帖一并提交**（WO#21）。
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
  /**
   * ⭐ WO#21：发布流程的**明确错误**（存在即表示"不许显示成功"）。
   * ⚠️ 与既有冻结原则一致：**上传/落库失败绝不本地假成功**。
   */
  const [publishErr, setPublishErr] = useState('')

  /* ---- ⭐ WO#21：语音真实录音（此前是占位波形 + 一句"尚未接入真实麦克风"）---- */
  const [recording, setRecording] = useState(false)
  const [recordSec, setRecordSec] = useState(0)
  /** 录完待上传的语音；null = 还没录 */
  const [voice, setVoice] = useState<{ blob: Blob; durationMs: number } | null>(null)
  const recSessionRef = useRef<RecorderSession | null>(null)
  const recTickRef = useRef<number | null>(null)

  const stopRecTick = useCallback(() => {
    if (recTickRef.current !== null) {
      window.clearInterval(recTickRef.current)
      recTickRef.current = null
    }
  }, [])

  /** 开始录音（与 ChatScreen 语音一致：点一下开始 / 再点一下结束） */
  const onRecordStart = useCallback(async () => {
    if (recording) return
    setPublishErr('')
    try {
      const s = await startRecording()
      recSessionRef.current = s
      setRecording(true)
      setRecordSec(0)
      stopRecTick()
      recTickRef.current = window.setInterval(() => {
        setRecordSec(Math.floor((recSessionRef.current?.elapsedMs() ?? 0) / 1000))
      }, 200)
    } catch (e) {
      recSessionRef.current = null
      setRecording(false)
      stopRecTick()
      const kind = e instanceof RecorderError ? e.kind : 'failed'
      setPublishErr(
        kind === 'permission_denied'
          ? '没有麦克风权限，无法录音（请在系统设置里允许本应用使用麦克风）'
          : kind === 'no_device'
            ? '找不到可用的麦克风'
            : kind === 'unsupported'
              ? '当前环境不支持录音'
              : `录音启动失败：${(e as Error).message}`,
      )
      /* ⚠️ 到这里为止**没有**任何上传/落库 —— 失败不留半成品 */
    }
  }, [recording, stopRecTick])

  /** 结束录音：停止并**本地保留**待发布的语音（发布时才上传） */
  const onRecordEnd = useCallback(async () => {
    const s = recSessionRef.current
    if (!s) return
    recSessionRef.current = null
    stopRecTick()
    setRecording(false)
    try {
      const rec = await s.finish()
      setVoice({ blob: rec.blob, durationMs: rec.durationMs })
    } catch (e) {
      setVoice(null)
      setPublishErr(`录音失败：${(e as Error).message}`)
    }
  }, [stopRecTick])

  /* 卸载时务必中止录音，否则麦克风会被一直占用 */
  useEffect(
    () => () => {
      stopRecTick()
      recSessionRef.current?.abort()
      recSessionRef.current = null
    },
    [stopRecTick],
  )

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
    /* ⭐ WO#21：语音模式下必须有录好的语音才算可发布 */
    if (publishing || (!text.trim() && images.length === 0 && !voice)) return
    void doPublish()
  }

  /**
   * 发布：**先写本地，再上传媒体，最后同步服务器**。
   *
   * 顺序不能反：网络慢或不通时，用户点完发布应该立刻在信息流看到自己的帖子，
   * 而不是对着转圈等 8 秒超时。本地这份是"即时反馈"，服务器那份是"权威副本"；
   * 同步成功后用服务器返回的 id 把两者关联起来，避免同一条帖子显示两张卡。
   *
   * ⭐⭐ WO#21（Round 319）：**媒体先上传、再随帖提交**。
   *   改前：只 `createPost({body, place})` ⇒ **图片与语音都留在本机**，
   *         服务器上只有纯文本（注释写着"图片留在本地"，而 M4 从未接上 post_media）。
   *   现在：① 逐张 `uploadMedia(dataUrl→Blob, 'post')` 拿 mediaIds
   *         ② 语音 `uploadMedia(voice.blob, 'post', voice.durationMs)` 拿 mediaId
   *         ③ `createPost({body, place, mediaIds})` 一并提交
   *   ⚠️ 顺序不能反：服务端**只有"发帖时一并挂媒体"这一条路**，没有"给已有帖子补挂媒体"的接口。
   *   ⚠️ 任何一步失败都**不显示成功**：明确报错（`publishErr`），本地那份仍在（不丢草稿）。
   *      这与本项目已冻结的"**写操作失败绝不本地假成功**"一致。
   */
  async function doPublish() {
    setPublishing(true)
    setPublishErr('')
    const draft = text.trim() || (voice ? '分享了一段语音' : '分享了图片')
    const local = addMyPost({ text: draft, images, place })
    try {
      /* ① 上传媒体（图片 + 语音），收集 mediaIds */
      const mediaIds: string[] = []
      for (const durl of images) {
        try {
          const blob = await dataUrlToBlob(durl)
          const up = await uploadMedia(blob, 'post')
          if (!up.ok) {
            setPublishErr(`图片上传失败：${up.reason}（帖子未发到服务器，草稿仍在本地）`)
            return
          }
          mediaIds.push(up.value.id)
        } catch (e) {
          setPublishErr(`图片处理失败：${(e as Error).message}（帖子未发到服务器）`)
          return
        }
      }
      if (voice) {
        /* ⚠️ 音频**必须**带 durationMs，否则服务端 400（迁移 010 的约束） */
        const up = await uploadMedia(voice.blob, 'post', voice.durationMs)
        if (!up.ok) {
          setPublishErr(`语音上传失败：${up.reason}（帖子未发到服务器，草稿仍在本地）`)
          return
        }
        mediaIds.push(up.value.id)
      }

      /* ② 发帖（媒体一并提交） */
      const result = await createPost({
        body: draft,
        place: place || undefined,
        ...(mediaIds.length > 0 ? { mediaIds } : {}),
      })
      if (result.ok) {
        markPostSynced(local.id, result.value.id)
        addServerPost(toFeedPost(result.value))
      } else if (result.status === 401) {
        setPublishErr('未登录：帖子只存在本地，未同步到服务器')
      } else {
        setPublishErr(`同步到服务器失败：${result.reason}（帖子已存在本地）`)
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

        {/*
          ⭐⭐ WO#21（Round 319）：语音模式从**占位波形**改为**真实录音**。
          改前：28 根按公式算高度的装饰条 + 「（录音功能尚未接入真实麦克风）」。
          现在：真实麦克风（native/recorder.ts，与 ChatScreen 语音同一实现）+ 真实计时。

          ⚠️ 交互形态的口径（不夸大）：原版 `publish` 基线把
             「**语音模式的真实录音交互**」列在 `known_unknowns` 里 ⇒ 原版怎么做**未观察**。
             这里采用**与 ChatScreen 语音一致**的"点一下开始 / 再点一下结束"
             ⇒ 属 **OUR_DESIGN_CHOICE**，**不声称**与原版一致。
          ⚠️ 原版录完之后是入草稿还是直接发帖也**未观察** ⇒ `PUBLISH_VOICE_FLOW: NOT_EVALUATED`。
        */}
        {mode === '语音' && (
          <div className="pub__voice" data-voice-mode>
            <div className="pub__wave" aria-hidden>
              {/* 未录音时给一排静态底纹；录音时按**真实经过时间**点亮，不再是"按公式算的假波形" */}
              {Array.from({ length: 28 }).map((_, i) => {
                const lit = recording && i <= Math.min(27, recordSec * 2)
                return (
                  <span
                    key={i}
                    className={lit ? 'is-lit' : ''}
                    style={{ height: `${12 + ((i * 37) % 46)}px` }}
                  />
                )
              })}
            </div>
            <p className="pub__voiceTip" data-voice-status>
              {recording
                ? `正在录音… ${formatDuration(recordSec * 1000)}（点一下结束）`
                : voice
                  ? `已录制 ${formatDuration(voice.durationMs)}（发布时一并上传）`
                  : '点一下开始录音，最长 60 秒'}
            </p>
            <button
              className="pub__voiceBtn"
              data-voice-toggle
              onClick={() => (recording ? void onRecordEnd() : void onRecordStart())}
            >
              <IconMic size={20} />
              {recording ? '结束录音' : voice ? '重新录音' : '开始录音'}
            </button>
            {voice && !recording && (
              <button className="pub__voiceClear" data-voice-clear onClick={() => setVoice(null)}>
                删除这段语音
              </button>
            )}
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

      {/*
        ⭐ WO#21：发布/上传失败的**明确报错**。
        ⚠️ 存在即表示"不许显示成功" —— 与"写操作失败绝不本地假成功"一致。
      */}
      {publishErr && (
        <p className="pub__err" data-publish-err>
          {publishErr}
        </p>
      )}
    </Screen>
  )
}
