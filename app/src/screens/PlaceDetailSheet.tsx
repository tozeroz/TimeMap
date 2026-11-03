import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { mediaUrl, type ApiPlaceDetail } from '../api/client'
import { IconClose, IconEdit, IconLocation } from '../components/icons'
import { PlaceActivitiesSection, PlaceFeedSection } from './PlaceSections'
import { isCoverCandidate, photoSrc, sheetSummary } from './placeIntroModel'
import {
  decideOwner,
  dragVisible,
  isPanelEligible,
  resolveRelease,
  SLOP_PX,
  visibleHeight,
  type Detent,
  type OpenDetent,
  type Owner,
  type Snaps,
  type Zone,
} from './placeSheetModel'
import { usePlaceDetail } from './usePlaceDetail'
import './placesheet.css'

interface Gesture {
  zone: Zone
  scrollable: boolean
  scrollTopAtStart: number
  x0: number
  y0: number
  /** 面板接管时的指针 y：用相对位移，接管瞬间不跳 */
  yTake: number
  startVisible: number
  intercept: boolean | undefined
  owner: Owner | null
  visible: number
  samples: Array<[number, number]>
  pointerId?: number
}

/**
 * 地图地点抽屉（design.md §8、§9、§12）。受控组件：档位由 MapScreen 持有，
 * 这里只负责渲染、拖动手势（松手后通过 onRequestDetent 请求吸附）和正文滚动。
 */
export function PlaceDetailSheet({
  placeId,
  detent,
  closing,
  snaps,
  placeNameHint,
  initialScrollTop,
  onScroll,
  onRequestDetent,
  onRequestClose,
  onNavigate,
  onPlaceLoaded,
}: {
  placeId: string
  detent: Detent
  closing: boolean
  snaps: Snaps
  placeNameHint: string | null
  initialScrollTop: number
  onScroll: (top: number) => void
  onRequestDetent: (d: OpenDetent) => void
  onRequestClose: () => void
  onNavigate: (path: string, query: Record<string, string>) => void
  onPlaceLoaded: (place: ApiPlaceDetail) => void
}) {
  // 抽屉默认「最新」：相对旧详情页默认「近期热门」的有意变更（spec §4、design §7.2）
  const d = usePlaceDetail(placeId, 'latest')
  const { place, phase } = d
  const panelRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const [entered, setEntered] = useState(false)
  const expanded = detent === 'expanded'
  const scrollable = expanded || snaps.single
  const shown: Detent = entered && !closing ? detent : 'closed'
  const transform = transformFor(snaps, visibleHeight(shown, snaps), shown === 'closed')

  // 进场：先以关闭位置渲染一帧，再切到目标档位，让 transform 过渡生效
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    titleRef.current?.focus({ preventScroll: true })
    return () => cancelAnimationFrame(raf)
  }, [])

  // 最新值给原生事件处理器用（它们只注册一次）
  const live = useRef({ detent, snaps, scrollable, onRequestDetent })
  useLayoutEffect(() => { live.current = { detent, snaps, scrollable, onRequestDetent } })

  // ---- 地点切换：回到内容顶部；首个地点按快照恢复滚动 ----
  const restoreRef = useRef<{ placeId: string; top: number } | null>(initialScrollTop > 0 ? { placeId, top: initialScrollTop } : null)
  const lastPlaceRef = useRef(placeId)
  useEffect(() => {
    if (lastPlaceRef.current === placeId) return
    lastPlaceRef.current = placeId
    restoreRef.current = null
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [placeId])
  useEffect(() => {
    if (phase !== 'ready' || !place) return
    onPlaceLoaded(place)
    const r = restoreRef.current
    const body = bodyRef.current
    if (!r || r.placeId !== placeId || !body) return
    restoreRef.current = null
    const content = body.firstElementChild
    const apply = () => { body.scrollTop = r.top }
    const raf = requestAnimationFrame(apply)
    // 图片陆续加载会改变高度：1 秒内跟随内容尺寸重设，用户一操作就停
    const ro = typeof ResizeObserver === 'function' && content ? new ResizeObserver(() => { if (Math.abs(body.scrollTop - r.top) > 2) apply() }) : null
    if (ro && content) ro.observe(content)
    const stop = () => { ro?.disconnect(); window.clearTimeout(timer) }
    const timer = window.setTimeout(stop, 1000)
    body.addEventListener('touchstart', stop, { once: true, passive: true })
    body.addEventListener('wheel', stop, { once: true, passive: true })
    return () => { cancelAnimationFrame(raf); stop(); body.removeEventListener('touchstart', stop); body.removeEventListener('wheel', stop) }
  }, [phase, place, placeId, onPlaceLoaded])

  // ---- 拖动与滚动交接（spec §5.1；design §9.3–9.4） ----
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    let g: Gesture | null = null
    let swallow: ((e: Event) => void) | null = null
    const removeSwallow = () => { if (swallow) { panel.removeEventListener('click', swallow, true); swallow = null } }

    const zoneOf = (t: EventTarget | null): Zone | null => {
      const el = t as Element | null
      if (!el?.closest) return null
      if (el.closest('.ps__close')) return null
      if (el.closest('[data-sheet-handle]')) return 'handle'
      if (el.closest('[data-sheet-body]')) return 'body'
      return null
    }
    const begin = (zone: Zone, x: number, y: number, pointerId?: number) => {
      removeSwallow()
      const { detent: dt, snaps: s, scrollable: sc } = live.current
      const startVisible = visibleHeight(dt, s)
      g = { zone, scrollable: sc, scrollTopAtStart: bodyRef.current?.scrollTop ?? 0, x0: x, y0: y, yTake: y, startVisible, intercept: undefined, owner: null, visible: startVisible, samples: [], pointerId }
    }
    /** 返回 true = 本次移动由面板处理（调用方应 preventDefault） */
    const move = (x: number, y: number, touches: number): boolean => {
      if (!g) return false
      const dx = x - g.x0
      const dy = y - g.y0
      if (g.owner === null) {
        // 第一次有方向的移动时锁定是否拦截（design-review F2）
        if (g.intercept === undefined && Math.abs(dy) >= 1) g.intercept = isPanelEligible(g.zone, g.scrollable, g.scrollTopAtStart, dy)
        if (Math.hypot(dx, dy) < SLOP_PX) return g.intercept === true
        g.owner = decideOwner({ zone: g.zone, scrollable: g.scrollable, scrollTopAtStart: g.scrollTopAtStart, dx, dy, touches })
        if (g.owner !== 'panel') { g.intercept = false; return false }
        g.yTake = y
        panel.dataset.dragging = '1'
      }
      if (g.owner !== 'panel') return false
      g.visible = dragVisible(g.startVisible, y - g.yTake, live.current.snaps)
      panel.style.transform = transformFor(live.current.snaps, g.visible, false)
      const now = performance.now()
      g.samples.push([now, y])
      while (g.samples.length > 2 && now - g.samples[0]![0] > 100) g.samples.shift()
      return true
    }
    const finish = (withVelocity: boolean) => {
      const cur = g
      g = null
      if (!cur || cur.owner !== 'panel') return
      const { detent: dt, snaps: s, onRequestDetent: req } = live.current
      let v = 0
      if (withVelocity && cur.samples.length >= 2) {
        const [t0, y0] = cur.samples[0]!
        const [t1, y1] = cur.samples[cur.samples.length - 1]!
        v = t1 > t0 ? (y1 - y0) / (t1 - t0) : 0
      }
      const from: OpenDetent = dt === 'expanded' ? 'expanded' : 'preview'
      const target = resolveRelease(from, cur.visible, v, s)
      delete panel.dataset.dragging
      panel.style.transform = transformFor(s, visibleHeight(target, s), false)
      // 拖动结束后浏览器可能补发一次 click：只吞这一次，下一个任务就移除
      swallow = (e: Event) => { e.stopPropagation(); e.preventDefault() }
      panel.addEventListener('click', swallow, true)
      window.setTimeout(removeSwallow, 0)
      req(target)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 1) { finish(false); return }
      const zone = zoneOf(e.target)
      const t = e.touches[0]
      if (!zone || !t) { g = null; return }
      begin(zone, t.clientX, t.clientY)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!g) return
      if (e.touches.length > 1) { finish(false); return }
      const t = e.touches[0]
      if (!t) return
      if (move(t.clientX, t.clientY, e.touches.length) && e.cancelable) e.preventDefault()
    }
    const onTouchEnd = () => finish(true)
    const onTouchCancel = () => finish(false)
    // 鼠标 / 触控笔：只从把手区拖动；正文滚轮保持原生
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return
      if (zoneOf(e.target) !== 'handle') return
      begin('handle', e.clientX, e.clientY, e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!g || g.pointerId !== e.pointerId) return
      const wasOwner = g.owner
      if (move(e.clientX, e.clientY, 1) && wasOwner === null && g.owner === 'panel') panel.setPointerCapture?.(e.pointerId)
    }
    const onPointerUp = (e: PointerEvent) => { if (g && g.pointerId === e.pointerId) finish(true) }
    const onPointerCancel = (e: PointerEvent) => { if (g && g.pointerId === e.pointerId) finish(false) }
    const onBlur = () => finish(false)
    const onVis = () => { if (document.visibilityState === 'hidden') finish(false) }

    panel.addEventListener('touchstart', onTouchStart, { passive: true })
    panel.addEventListener('touchmove', onTouchMove, { passive: false })
    panel.addEventListener('touchend', onTouchEnd)
    panel.addEventListener('touchcancel', onTouchCancel)
    panel.addEventListener('pointerdown', onPointerDown)
    panel.addEventListener('pointermove', onPointerMove)
    panel.addEventListener('pointerup', onPointerUp)
    panel.addEventListener('pointercancel', onPointerCancel)
    panel.addEventListener('lostpointercapture', onPointerCancel)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      removeSwallow()
      panel.removeEventListener('touchstart', onTouchStart)
      panel.removeEventListener('touchmove', onTouchMove)
      panel.removeEventListener('touchend', onTouchEnd)
      panel.removeEventListener('touchcancel', onTouchCancel)
      panel.removeEventListener('pointerdown', onPointerDown)
      panel.removeEventListener('pointermove', onPointerMove)
      panel.removeEventListener('pointerup', onPointerUp)
      panel.removeEventListener('pointercancel', onPointerCancel)
      panel.removeEventListener('lostpointercapture', onPointerCancel)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // 预览态 Tab 到被裁掉的控件时自动展开
  const onFocusIn = (e: React.FocusEvent) => {
    // 进场动画期间（面板还在底边以外）和标题自身获得焦点时不判断
    if (detent !== 'preview' || snaps.single || !entered || e.target === titleRef.current) return
    const host = panelRef.current?.parentElement
    if (!host) return
    if ((e.target as Element).getBoundingClientRect().bottom > host.getBoundingClientRect().bottom - 72) onRequestDetent('expanded')
  }

  const cover = place ? place.photos.find(isCoverCandidate) ?? null : null
  const thumb = cover ? photoSrc(cover, mediaUrl) : null
  const summary = place ? sheetSummary(place.description, place.history) : null
  const ready = phase === 'ready' && place
  const name = place?.name ?? placeNameHint ?? '加载中…'

  return <>
    <section
      ref={panelRef}
      className={`ps ${expanded ? 'ps--expanded' : ''}`}
      style={{ height: snaps.expandedH, transform }}
      data-place-sheet
      data-sheet-detent={detent}
      data-sheet-place-id={placeId}
      role="region"
      aria-labelledby="ps-title"
      onFocus={onFocusIn}
    >
      <div className="ps__head" data-sheet-handle>
        {snaps.single
          ? <div className="ps__grabber ps__grabber--static" aria-hidden="true"><span /></div>
          : <button className="ps__grabber" aria-expanded={expanded} aria-label={expanded ? '收起详情' : '展开详情'} onClick={() => onRequestDetent(expanded ? 'preview' : 'expanded')}><span /></button>}
        <div className="ps__titleRow">
          <h2 id="ps-title" ref={titleRef} className="ps__name" tabIndex={-1} data-place-name>{name}</h2>
          {place?.category && <span className="ps__badge">{place.category}</span>}
          {place && !place.enabled && <span className="pd__disabledTag">已停用</span>}
          <button className="ps__close" aria-label="关闭地点详情" onClick={onRequestClose}><IconClose size={22} /></button>
        </div>
      </div>
      <div ref={bodyRef} className={`ps__body ${scrollable ? 'ps__body--scroll' : ''}`} data-sheet-body onScroll={e => onScroll(e.currentTarget.scrollTop)}>
        <div className="ps__content">
          {!ready ? <div className="pd__state" role="status" data-pd-phase={phase}>
            <p>{phase === 'loading' ? '正在寻找这处校园记忆…' : phase === 'not_found' ? '地点不存在或已删除' : '地点加载失败'}</p>
            {phase === 'error' && d.error && <p className="pd__stateSub">{d.error}</p>}
            {phase === 'error' && <button className="pd__retry" onClick={d.retry}>重试</button>}
          </div> : <>
            {place.address && <p className="ps__addr"><IconLocation size={16} />{place.address}</p>}
            <div className="ps__summary">
              <p className={`ps__desc ${summary ? '' : 'ps__desc--empty'}`} data-place-desc>{summary ?? '暂无简介'}</p>
              {expanded && thumb && <ThumbImg src={thumb} />}
            </div>
            <button className="ps__introLink" data-sheet-intro onClick={() => onNavigate('place-intro', { id: place.id })}>地点背景与校园时光 <span aria-hidden="true">→</span></button>
            <PlaceActivitiesSection place={place} onOpenActivity={aid => onNavigate('activity', { id: aid, placeId: place.id })} onOpenAll={() => onNavigate('activities', { placeId: place.id })} />
            <PlaceFeedSection place={place} sort={d.sort} setSort={d.setSort} filter={d.filter} setFilter={d.setFilter} allEmpty={d.allEmpty} feedPhase={d.feedPhase} onRetryFeed={d.retryFeed} showFilter={expanded} layout="split" onOpenPost={pid => onNavigate('feed', { id: pid })} onOpenAll={() => onNavigate('campus', { placeId: place.id })} />
          </>}
          <div className="ps__bodyPad" />
        </div>
      </div>
    </section>
    <div className={`ps__footer ${shown === 'closed' || !ready ? 'ps__footer--hidden' : ''}`}>
      {ready && (place.enabled
        ? <button className="pd__publishBtn" data-pd-publish={place.id} onClick={() => onNavigate('publish', { placeId: place.id, from: 'sheet' })}><IconEdit size={22} />在这里发布</button>
        : <p className="pd__publishHint" data-pd-publish-disabled>该地点已停用，暂时无法在这里发布。</p>)}
    </div>
  </>
}

/** 面板 DOM 高度固定为 expandedH，用 translateY 控制露出高度 */
function transformFor(s: Snaps, visible: number, isClosed: boolean): string {
  return `translateY(${isClosed ? s.expandedH + 24 : s.expandedH - visible}px)`
}

function ThumbImg({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img className="ps__thumb" src={src} alt="" onError={() => setFailed(true)} />
}
