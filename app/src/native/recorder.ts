/**
 * 语音录制封装（MediaRecorder）。
 *
 * 与 `camera.ts` / `geo.ts` 的分工一致：这里**只负责"录出一段音频 + 时长"**，不做任何 UI。
 *
 * ---------------------------------------------------------------------------
 * 为什么时长必须在这里用**单调时钟**测，而不是从音频文件里读
 * ---------------------------------------------------------------------------
 * WO#5 第二轮探针实测（docs/m5/PROBE2-recording-capture.md）：
 *   `<audio>` 能成功 loadedmetadata，但 **`audio.duration === null`**。
 * 原因：MediaRecorder 产出的是"live/流式" WebM，**文件头不含 duration**，
 *       不 seek 时读到 null/Infinity（WebM 已知特性）。
 * → 因此时长**不可能**从音频文件解码得到，只能：
 *     1) 在录音时用 `performance.now()`（单调时钟，不受系统时间跳变影响）记录起止；
 *     2) 随上传一起持久化到 `media.duration_ms`；
 *     3) 渲染时从服务端读回（**刷新后不必重新下载音频**）。
 *
 * ---------------------------------------------------------------------------
 * 实测环境约束（同一次探针，全部实测而非假设）
 * ---------------------------------------------------------------------------
 *   · WebView 里 MediaRecorder 存在、isSecureContext=true（https://localhost）
 *   · **只支持 `audio/webm`（及 `audio/webm;codecs=opus`）**，不支持 mp4/aac/ogg
 *   · `navigator.permissions` **不存在** → **无法静默预检权限**，
 *     只能"直接调用并捕获错误"来判定拒绝（见 classifyRecorderError）
 *   · 本设备（MuMu A12/SDK32）录制时**不弹系统授权框**，权限被静默授予；
 *     ⚠ 这是**设备特性**，不得推广到真机 —— 所以下面的代码
 *     **不依赖"系统一定会弹框"**，只处理"成功 / 失败"两条路。
 */

/** 一次录音的结果 */
export interface Recording {
  /** 录到的音频数据（实测 mime 为 audio/webm） */
  blob: Blob
  /** 时长（毫秒）—— 由**单调时钟**测得，见文件头 */
  durationMs: number
  /** 实际使用的 mime（来自 MediaRecorder.mimeType，不是我们声明的） */
  mime: string
}

/** 录音失败的原因分类 —— 便于 UI 给出**明确**提示，而不是笼统"出错了" */
export type RecorderErrorKind =
  /** 用户/系统拒绝了麦克风权限（NotAllowedError） */
  | 'permission_denied'
  /** 设备没有可用麦克风（NotFoundError / OverconstrainedError） */
  | 'no_device'
  /** 这段 WebView 不支持录音 API */
  | 'unsupported'
  /** 其它（含 MediaRecorder 运行时错误） */
  | 'failed'

export class RecorderError extends Error {
  readonly kind: RecorderErrorKind
  constructor(kind: RecorderErrorKind, message: string) {
    super(message)
    this.name = 'RecorderError'
    this.kind = kind
  }
}

/** 把 DOMException / 任意错误映射成我们的分类 */
function classifyRecorderError(e: unknown): RecorderError {
  const err = e as { name?: string; message?: string }
  const name = err?.name ?? ''
  const msg = err?.message ?? String(e)
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new RecorderError('permission_denied', msg)
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return new RecorderError('no_device', msg)
  }
  return new RecorderError('failed', `${name || 'Error'}: ${msg}`)
}

/** 这段运行环境是否具备录音所需的 API（**能力检测，不代表已获授权**） */
export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  )
}

/**
 * 选区一个可用的 mimeType。
 * 实测本环境只支持 webm/opus；这里按优先级探测而不是硬编码，
 * 以免将来换设备时写死一个不被支持的类型（MediaRecorder 会直接抛错）。
 */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm']
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c
    } catch {
      /* 某些实现会抛错，忽略后继续试下一个 */
    }
  }
  return undefined // 交给浏览器用默认类型
}

/** 一次录音会话（按下时创建，松手时 finish/abort） */
export interface RecorderSession {
  /** 停止录音并返回结果（松手发送） */
  finish(): Promise<Recording>
  /** 放弃这段录音（例如上滑取消 / 组件卸载），不返回数据 */
  abort(): void
  /** 已录时长（毫秒），用于录制中的计时显示 */
  elapsedMs(): number
}

/**
 * 开始一次录音。
 *
 * 调用方负责在"松手"时 `finish()`、在"取消/卸载"时 `abort()`。
 * **必须**保证二者之一被调用，否则麦克风会一直占用（`abort()` 里会 stop 所有 track）。
 */
export async function startRecording(): Promise<RecorderSession> {
  if (!isRecordingSupported()) {
    throw new RecorderError('unsupported', '此环境不支持 MediaRecorder / getUserMedia')
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    // ⚠ 拒绝路径在这里收敛：调用方据此显示明确提示，并且**不得**继续走上传/发消息
    throw classifyRecorderError(e)
  }

  const mimeType = pickMimeType()
  let recorder: MediaRecorder
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop())
    throw classifyRecorderError(e)
  }

  const chunks: Blob[] = []
  const startedAt = performance.now() // ★ 单调时钟起点
  let stoppedAt: number | null = null
  let aborted = false

  recorder.ondataavailable = (ev: BlobEvent) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data)
  }

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      stoppedAt = performance.now()
      resolve()
    }
  })

  /** 统一收尾：停 track（释放麦克风指示） */
  const releaseTracks = () => {
    for (const t of stream.getTracks()) t.stop()
  }

  recorder.start()

  return {
    elapsedMs: () => (stoppedAt ?? performance.now()) - startedAt,

    async finish(): Promise<Recording> {
      if (aborted) throw new RecorderError('failed', '这段录音已被取消')
      // 可能松手极快（< 一次 timeslice），仍在 recording 状态
      if (recorder.state === 'recording') recorder.stop()
      await stopped
      releaseTracks()

      const actualMime = recorder.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type: actualMime })
      const durationMs = Math.max(1, Math.round((stoppedAt ?? performance.now()) - startedAt))

      if (blob.size === 0) {
        // **不返回空音频**：宁可明确失败，也不要让"空语音"发出去（验收 ⑦ 的精神）
        throw new RecorderError('failed', '没有录到音频数据（blob 为空）')
      }
      return { blob, durationMs, mime: actualMime }
    },

    abort(): void {
      aborted = true
      try {
        if (recorder.state === 'recording') recorder.stop()
      } catch {
        /* 已停止则忽略 */
      }
      releaseTracks()
    },
  }
}

/** 时长的可读文本：与语音气泡的显示口径一致（四舍五入到秒，最少 1″） */
export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) return '--″'
  const sec = Math.max(1, Math.round(durationMs / 1000))
  return `${sec}″`
}
