import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconBack, IconChevronRight, IconClose } from './icons'
import './photoviewer.css'

export interface ViewerPhoto {
  key: string
  src: string | null
  title: string
  meta: string | null
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const STEP = 1.5
interface View { s: number; x: number; y: number }
const IDENTITY: View = { s: 1, x: 0, y: 0 }
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/**
 * 通用照片查看器（spec §6.3；design §14）。只负责展示和交互，打开 / 关闭与历史记录由调用方处理。
 * 挂到 .shell__viewport，打开期间给 .shell__body 设 inert：底层不可点、不可聚焦、滚动位置不变。
 */
export function PhotoViewer({ photos, index, onIndexChange, onClose, label = '照片浏览' }: {
  photos: ViewerPhoto[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  label?: string
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [view, setView] = useState<View>(IDENTITY)
  const [loadState, setLoadState] = useState<{ key: string; state: 'loading' | 'loaded' | 'error'; attempt: number }>({ key: '', state: 'loading', attempt: 0 })
  const photo = photos[index]
  const multi = photos.length > 1
  const status = loadState.key === photo?.key ? loadState : { key: photo?.key ?? '', state: 'loading' as const, attempt: 0 }

  // 切换图片：缩放与平移归位
  const [shownKey, setShownKey] = useState(photo?.key)
  if (shownKey !== photo?.key) { setShownKey(photo?.key); setView(IDENTITY) }

  const viewRef = useRef(view)
  useEffect(() => { viewRef.current = view }, [view])

  /** 平移边界：缩放后图片超出舞台的一半 */
  const clampPan = (v: View): View => {
    const stage = stageRef.current
    const img = imgRef.current
    if (!stage || !img || v.s <= 1) return { s: v.s, x: 0, y: 0 }
    const maxX = Math.max(0, (img.offsetWidth * v.s - stage.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * v.s - stage.clientHeight) / 2)
    return { s: v.s, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) }
  }
  /** 以舞台中心为原点的点 (px, py) 为中心缩放 */
  const zoomAround = (v: View, px: number, py: number, nextScale: number): View => {
    const s = clampScale(nextScale)
    const k = s / v.s
    return clampPan({ s, x: px - (px - v.x) * k, y: py - (py - v.y) * k })
  }
  const toStage = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 }
  }
  const zoomBy = (factor: number) => setView(v => zoomAround(v, 0, 0, v.s * factor))
  const reset = () => setView(IDENTITY)
  const go = (d: number) => { const n = index + d; if (n >= 0 && n < photos.length) onIndexChange(n) }

  // 底层 inert + 初始焦点；关闭时恢复
  useEffect(() => {
    const body = document.querySelector('.shell__body')
    body?.setAttribute('inert', '')
    closeRef.current?.focus()
    return () => body?.removeAttribute('inert')
  }, [])

  // 键盘：Esc 关闭、←/→ 切换、+/-/0 缩放、Tab 焦点陷阱
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowLeft') { go(-1); return }
      if (e.key === 'ArrowRight') { go(1); return }
      if (e.key === '+' || e.key === '=') { zoomBy(STEP); return }
      if (e.key === '-') { zoomBy(1 / STEP); return }
      if (e.key === '0') { reset(); return }
      if (e.key === 'Tab') {
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])
        if (!items.length) return
        const first = items[0]!
        const last = items[items.length - 1]!
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [])

  // 手势：双指捏合、放大后平移、1 倍时横滑切换、双击 / 双指快速轻点两次、滚轮缩放
  const goRef = useRef(go)
  useEffect(() => { goRef.current = go })
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const pts = new Map<number, { x: number; y: number }>()
    let start: { x: number; y: number; t: number; view: View } | null = null
    let pinch: { d: number; view: View; mid: { x: number; y: number } } | null = null
    let moved = 0
    let lastTap = { t: 0, x: 0, y: 0 }
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y) }
    const mid = () => { const [a, b] = [...pts.values()]; return toStage((a!.x + b!.x) / 2, (a!.y + b!.y) / 2) }
    const onDown = (e: PointerEvent) => {
      // 舞台里的按钮（上一张 / 下一张 / 重试）走自己的点击，不参与手势
      if ((e.target as Element).closest('button')) return
      stage.setPointerCapture?.(e.pointerId)
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) { start = { x: e.clientX, y: e.clientY, t: performance.now(), view: viewRef.current }; moved = 0 }
      if (pts.size === 2) { pinch = { d: dist(), view: viewRef.current, mid: mid() }; start = null }
    }
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch && pts.size === 2) {
        const p = pinch
        setView(zoomAround(p.view, p.mid.x, p.mid.y, p.view.s * (dist() / p.d)))
        return
      }
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      moved = Math.max(moved, Math.hypot(dx, dy))
      if (start.view.s > 1) setView(clampPan({ s: start.view.s, x: start.view.x + dx, y: start.view.y + dy }))
    }
    const onUp = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.delete(e.pointerId)
      if (pinch) { if (pts.size < 2) pinch = null; return }
      const st = start
      start = null
      if (!st) return
      const dx = e.clientX - st.x
      const dt = Math.max(1, performance.now() - st.t)
      if (st.view.s === 1 && Math.abs(dx) > Math.abs(e.clientY - st.y) && (Math.abs(dx) > 60 || Math.abs(dx) / dt >= 0.5) && moved > 12) {
        goRef.current(dx < 0 ? 1 : -1)
        return
      }
      if (moved > 10) return
      const now = performance.now()
      if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
        lastTap = { t: 0, x: 0, y: 0 }
        const p = toStage(e.clientX, e.clientY)
        setView(v => (v.s > 1 ? IDENTITY : zoomAround(v, p.x, p.y, 2.5)))
      } else lastTap = { t: now, x: e.clientX, y: e.clientY }
    }
    const onCancel = (e: PointerEvent) => { pts.delete(e.pointerId); start = null; pinch = null }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = toStage(e.clientX, e.clientY)
      setView(v => zoomAround(v, p.x, p.y, v.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
    }
    stage.addEventListener('pointerdown', onDown)
    stage.addEventListener('pointermove', onMove)
    stage.addEventListener('pointerup', onUp)
    stage.addEventListener('pointercancel', onCancel)
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stage.removeEventListener('pointerdown', onDown)
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerup', onUp)
      stage.removeEventListener('pointercancel', onCancel)
      stage.removeEventListener('wheel', onWheel)
    }
    // toStage / zoomAround / clampPan 只读 ref，不依赖渲染值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!photo) return null
  const target = document.querySelector('.shell__viewport') ?? document.body
  return createPortal(
    <div ref={rootRef} className="pv" role="dialog" aria-modal="true" aria-label={label} data-photo-viewer data-pv-index={index} data-pv-scale={view.s.toFixed(2)}>
      <div className="pv__top">
        <button ref={closeRef} className="pv__btn" aria-label="关闭照片" onClick={onClose}><IconClose size={22} /></button>
        <span className="pv__count" aria-live="polite" data-pv-count>{index + 1} / {photos.length}</span>
        <span className="pv__spacer" />
      </div>
      <div ref={stageRef} className="pv__stage">
        {photo.src && status.state !== 'error' && <img
          key={`${photo.key}:${status.attempt}`}
          ref={imgRef}
          className="pv__img"
          src={photo.src}
          alt={photo.title}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
          onLoad={() => setLoadState({ key: photo.key, state: 'loaded', attempt: status.attempt })}
          onError={() => setLoadState({ key: photo.key, state: 'error', attempt: status.attempt })}
        />}
        {photo.src && status.state === 'loading' && <p className="pv__note" role="status">图片加载中…</p>}
        {(!photo.src || status.state === 'error') && <div className="pv__note" role="status">
          <p>{photo.src ? '图片加载失败' : '暂无图片'}</p>
          {photo.src && <button className="pv__retry" onClick={() => setLoadState({ key: photo.key, state: 'loading', attempt: status.attempt + 1 })}>重试</button>}
        </div>}
        {multi && <button className="pv__btn pv__nav pv__nav--prev" aria-label="上一张" disabled={index === 0} onClick={() => go(-1)}><IconBack size={22} /></button>}
        {multi && <button className="pv__btn pv__nav pv__nav--next" aria-label="下一张" disabled={index === photos.length - 1} onClick={() => go(1)}><IconChevronRight size={22} /></button>}
      </div>
      <div className="pv__bottom">
        <div className="pv__caption">
          <strong>{photo.title}</strong>
          {photo.meta && <span>{photo.meta}</span>}
        </div>
        <div className="pv__zoom">
          <button className="pv__btn" aria-label="缩小" disabled={view.s <= MIN_SCALE} onClick={() => zoomBy(1 / STEP)}>−</button>
          <button className="pv__btn" aria-label="放大" disabled={view.s >= MAX_SCALE} onClick={() => zoomBy(STEP)}>＋</button>
          {view.s > 1 && <button className="pv__btn pv__reset" aria-label="还原" onClick={reset}>1×</button>}
        </div>
      </div>
    </div>,
    target,
  )
}
