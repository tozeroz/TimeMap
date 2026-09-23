import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Screen, TopBar } from '../components/Shell'
import { IconClose } from '../components/icons'
import { ensureCameraPermission } from '../native/camera'
import {
  cameraSupported,
  describeCameraError,
  startCamera,
  stopStream,
  type CameraErrorInfo,
} from '../native/liveCamera'
import { goBack } from '../router'
import './scanner.css'

/**
 * 扫码（对应原版 `campusx://scanner`；入口 = 抽屉里的「扫一扫」）。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ WO#22（Round 319，Owner 裁定 ①：扫码**必须实现体验等价**）
 * ════════════════════════════════════════════════════════════════════
 * 本屏经历三个阶段（都如实留痕，避免日后误解）：
 * ```
 *   ① 最初：**伪造** —— 5.2s 定时**无条件**报「识别成功」+ 假取景框/扫描线（fake-success）
 *   ② Round 319 早段：删掉伪造，改为如实显示「扫码功能尚未实现」（诚实但**没有能力**）
 *   ③ 现在（本 WO）：**真实扫码** —— 复用 native/liveCamera.ts（getUserMedia，与发布页同一实现）
 *      + 纯 JS 的 jsQR 解码；解出内容后**如实展示**解到的文本
 * ```
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️ 术语口径（不夸大）—— 哪些是"已实现"、哪些**不是**
 * ════════════════════════════════════════════════════════════════════
 * ```
 *   SCANNER_CAMERA_AND_DECODE:     **实现**（真实取景 + 真实 QR 解码）
 *   SCANNER_ENTRY:                 MATCH（抽屉「扫一扫」；Round 318 已确认）
 *   SCANNER_TARGET_SCAN_FLOW:      **NOT_EVALUATED**
 *       原版扫到码之后**跳到哪个页面/做什么**，在只读约束下**不可观察**
 *       （要点开原版扫码并真的扫一个码，而"扫码"可能触发业务写入）
 *       ⇒ 所以我**不发明**一个"结果页"，只**如实显示解到的内容**
 *   SCANNER_SCANNED_RESULT_UI:     **OUR_DESIGN_CHOICE**（不声称与原版一致）
 * ```
 *
 * ⚠️ 解码范围：jsQR 只解 **QR 码**。原版是否也支持条形码（EAN / Code128）**未观察**
 *    ⇒ `SCANNER_OTHER_SYMBOLOGIES: NOT_EVALUATED`（不声称支持，也不声称不支持）。
 *
 * ⚠️ 隐私：摄像头画面**只在内存里**逐帧交给解码器，**不上传、不落盘、不留存**。
 *    解出的文本只显示在界面上。
 */
type Phase = 'idle' | 'unsupported' | 'denied' | 'error' | 'scanning' | 'found'

export function ScannerScreen() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<CameraErrorInfo | null>(null)
  const [result, setResult] = useState<string | null>(null)
  /**
   * ⭐ 可观测性：已解码的**帧数**。
   *
   * 为什么需要它：门禁要能区分"**解码循环真的在跑**"与"只是写了一行 rAF 调用"。
   * 只断言"页面上有 video 元素"是不够的 —— 那证明不了逐帧解码在发生。
   * ⇒ 每帧把计数写进 `data-scanner-frames`，门禁读它并断言**持续增长**。
   * ⚠️ 它不是业务状态，只是可观测计数；不影响任何行为。
   */
  const framesRef = useRef(0)
  const [frames, setFrames] = useState(0)

  const stopAll = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    stopStream(streamRef.current)
    streamRef.current = null
  }, [])

  /** 逐帧：把视频画到 canvas → 交给 jsQR → 解到就停并展示 */
  const tick = useCallback(() => {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return
    if (v.readyState >= 2 /* HAVE_CURRENT_DATA */ && v.videoWidth > 0) {
      const w = v.videoWidth
      const h = v.videoHeight
      if (c.width !== w || c.height !== h) {
        c.width = w
        c.height = h
      }
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(v, 0, 0, w, h)
        /* ⭐ 每**真正取到一帧像素**才计数（证明解码循环在跑，不是空转） */
        framesRef.current += 1
        setFrames(framesRef.current)
        try {
          const img = ctx.getImageData(0, 0, w, h)
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (code && code.data) {
            /* ⭐ 解到真码 —— 停止取景与解码，展示**解到的内容本身** */
            stopAll()
            setResult(code.data)
            setPhase('found')
            return
          }
        } catch {
          /* getImageData 可能因尺寸/跨源问题抛错；忽略这一帧，继续扫 */
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopAll])

  useEffect(() => {
    let alive = true

    async function boot() {
      if (!cameraSupported()) {
        if (alive) setPhase('unsupported')
        return
      }
      /* ⚠️ 权限：先显式请求（与发布页一致）；被拒就**明确说明**，不假装在扫 */
      const ok = await ensureCameraPermission().catch(() => false)
      if (!alive) return
      if (!ok) {
        setPhase('denied')
        return
      }
      try {
        const stream = await startCamera('environment')
        if (!alive) {
          stopStream(stream)
          return
        }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => undefined)
        }
        setPhase('scanning')
        rafRef.current = requestAnimationFrame(tick)
      } catch (e) {
        if (!alive) return
        setErr(describeCameraError(e))
        setPhase('error')
      }
    }

    void boot()
    return () => {
      alive = false
      stopAll()
    }
  }, [tick, stopAll])

  return (
    <Screen className="scan" scroll={false}>
      <TopBar
        variant="plain"
        left={
          <button className="iconbtn scan__btn" onClick={() => goBack('campus')} aria-label="关闭">
            <IconClose size={22} />
          </button>
        }
      />

      <div className="scan__stage">
        {/* 取景与解码都在这一屏内完成；canvas 隐藏（只为取像素） */}
        <div className="scan__frame" data-scanner={phase} data-scanner-frames={frames}>
          <video ref={videoRef} className="scan__video" playsInline muted autoPlay data-scanner-video />
          {phase === 'scanning' && <span className="scan__line" />}
          <span className="scan__corner scan__corner--tl" />
          <span className="scan__corner scan__corner--tr" />
          <span className="scan__corner scan__corner--bl" />
          <span className="scan__corner scan__corner--br" />
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden />

        {/* ---------- 状态文案（每种都**如实**）---------- */}
        {phase === 'idle' && <p className="scan__hint">正在准备摄像头…</p>}
        {phase === 'scanning' && <p className="scan__hint">将二维码放入框内，即可自动识别</p>}
        {phase === 'unsupported' && (
          <p className="scan__unavailableHint" data-scanner-unsupported>
            当前环境不支持摄像头，无法扫码。
          </p>
        )}
        {phase === 'denied' && (
          <p className="scan__unavailableHint" data-scanner-denied>
            没有摄像头权限，无法扫码（请在系统设置里允许本应用使用摄像头）。
          </p>
        )}
        {phase === 'error' && (
          <p className="scan__unavailableHint" data-scanner-error>
            摄像头启动失败：{err?.message ?? '未知原因'}
          </p>
        )}
        {phase === 'found' && (
          <div className="scan__result" data-scanner-result>
            <p className="scan__resultLabel">已识别到内容：</p>
            <p className="scan__resultText" data-scanner-result-text>
              {result}
            </p>
            {/*
              ⚠️ 原版**扫到码之后做什么**在只读约束下不可观察 ⇒ 这里**不发明**"结果页"，
                 只如实展示解到的内容，并明说我们不知道原版会怎样。
            */}
            <p className="scan__resultNote">原版扫码后的去向未观察，因此本页只如实显示识别内容。</p>
            <button className="scan__again" data-scanner-again onClick={() => window.location.reload()}>
              再扫一次
            </button>
          </div>
        )}
      </div>
    </Screen>
  )
}
