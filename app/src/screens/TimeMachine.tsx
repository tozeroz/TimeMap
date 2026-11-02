import { useEffect, useMemo, useRef, useState } from 'react'
import { placePhotoSrc, type ApiPlacePhoto } from '../api/client'
import { navigate } from '../router'

/**
 * 时光机：同一机位的「过去 vs 现在」对照（029）。
 *
 * 数据规则（验收判据）：
 *   · 对比组只在同一个 `viewKey` 内取，**绝不跨机位拼图**。没有 viewKey 的照片不进时光机
 *     （它们仍在下方「老照片」列表里正常展示）。
 *   · 胶片带按 `yearSort` 的年代（十年）排开，从该机位最早一张到最晚一张；中间缺的年代
 *     **单独占一格并写「该年代暂无影像」**，不拿相邻年代的图顶替。
 *   · `yearSort` 为 null 的照片归入「年代不详」一格，可以查看，但不参与默认的「过去 vs 现在」配对。
 *   · 画面上所有年份文字都直接来自数据库字段 `yearLabel`；年代格的标题由 `yearSort` 算出十年段。
 */

type Frame =
  | { kind: 'decade'; decade: number; photos: ApiPlacePhoto[] }
  | { kind: 'unknown'; photos: ApiPlacePhoto[] }

interface View {
  key: string
  photos: ApiPlacePhoto[]
  dated: ApiPlacePhoto[]
  frames: Frame[]
}

function buildViews(photos: ApiPlacePhoto[]): View[] {
  const byKey = new Map<string, ApiPlacePhoto[]>()
  for (const ph of photos) {
    if (!ph.viewKey || !placePhotoSrc(ph)) continue
    const list = byKey.get(ph.viewKey) ?? []
    list.push(ph)
    byKey.set(ph.viewKey, list)
  }
  const views: View[] = []
  for (const [key, list] of byKey) {
    const dated = list
      .filter((p): p is ApiPlacePhoto & { yearSort: number } => typeof p.yearSort === 'number')
      .sort((a, b) => a.yearSort - b.yearSort)
    const unknown = list.filter((p) => typeof p.yearSort !== 'number')
    const frames: Frame[] = []
    if (dated.length) {
      const first = Math.floor(dated[0]!.yearSort / 10) * 10
      const last = Math.floor(dated[dated.length - 1]!.yearSort / 10) * 10
      for (let d = first; d <= last; d += 10)
        frames.push({ kind: 'decade', decade: d, photos: dated.filter((p) => Math.floor(p.yearSort / 10) * 10 === d) })
    }
    if (unknown.length) frames.push({ kind: 'unknown', photos: unknown })
    views.push({ key, photos: list, dated, frames })
  }
  return views
}

function decadeLabel(d: number): string {
  return `${d}年代`
}

export function TimeMachine({ photos }: { photos: ApiPlacePhoto[] }) {
  const views = useMemo(() => buildViews(photos), [photos])
  const [viewIdx, setViewIdx] = useState(0)
  const view = views[Math.min(viewIdx, views.length - 1)]

  if (!view) {
    return (
      <section className="tm" data-tm-state="no-view">
        <h3 className="pd__sectionTitle">时光机</h3>
        <p className="tm__empty" data-tm-empty>
          这个地点还没有「同一机位」的新旧照片，暂时做不了过去与现在的对照。
          这里不会拿别处或别的角度的图来凑。
        </p>
      </section>
    )
  }

  return (
    <section className="tm" data-tm-state="ready" data-tm-view={view.key}>
      <h3 className="pd__sectionTitle">时光机</h3>
      {views.length > 1 && (
        <div className="tm__views no-scrollbar" role="tablist" aria-label="机位">
          {views.map((v, i) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={v === view}
              className={`tm__viewChip${v === view ? ' is-on' : ''}`}
              data-tm-view-chip={v.key}
              onClick={() => setViewIdx(i)}
            >
              {(v.dated[0] ?? v.photos[0])!.title}
            </button>
          ))}
        </div>
      )}
      {/* key：切机位时重置内部选中状态，避免把上一个机位的选择带过来 */}
      <ViewCompare key={view.key} view={view} />
    </section>
  )
}

const PLAY_STEP_MS = 1800

function ViewCompare({ view }: { view: View }) {
  const present = view.dated[view.dated.length - 1] ?? null
  // 默认「过去」= 最早一张有年份的；只有一张有年份的照片时没有可对比的另一端
  const [pastId, setPastId] = useState<string | null>(view.dated.length >= 2 ? view.dated[0]!.id : null)
  const [mode, setMode] = useState<'slide' | 'fade'>('slide')
  const [pos, setPos] = useState(50)
  const [dragging, setDragging] = useState(false)
  // 播放：按 yearSort 顺序逐张交叉淡入；null = 没在播
  const [playIdx, setPlayIdx] = useState<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const past = view.photos.find((p) => p.id === pastId) ?? null
  const canCompare = Boolean(past && present && past.id !== present.id)
  const playing = playIdx !== null

  useEffect(() => {
    if (playIdx === null) return
    const t = window.setTimeout(
      () => setPlayIdx(playIdx + 1 < view.dated.length ? playIdx + 1 : null),
      // 最后一张多停一会儿再回到对比
      playIdx + 1 < view.dated.length ? PLAY_STEP_MS : PLAY_STEP_MS * 1.5,
    )
    return () => window.clearTimeout(t)
  }, [playIdx, view.dated.length])

  /*
    直接在照片上拖：滑动模式下分割线跟手；淡入模式下横向拖动 = 调透明度。
    用 pointer 事件 + setPointerCapture，手指拖出照片范围也不会断。
    touch-action: pan-y（见 CSS）保证竖向仍能滚动页面，只有横向拖动归时光机。
  */
  function posFromEvent(clientX: number) {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    setPos(Math.round(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100))))
  }
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (playing || (e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    posFromEvent(e.clientX)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging) posFromEvent(e.clientX)
  }
  function endDrag() {
    setDragging(false)
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - step))
    else if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + step))
    else if (e.key === 'Home') setPos(0)
    else if (e.key === 'End') setPos(100)
    else return
    e.preventDefault()
  }
  // pos = 「过去」的占比：滑动 = 分割线位置（左边是过去）；淡入 = 老照片不透明度。往右拖都是看到更多过去
  const showAllPast = () => setPos(100)
  const showAllPresent = () => setPos(0)
  const playPhoto = playIdx !== null ? view.dated[playIdx] : null

  return (
    <>
      {canCompare && past && present ? (
        <>
          <div
            ref={stageRef}
            className={`tm__stage${dragging ? ' is-dragging' : ''}${playing ? ' is-playing' : ''}`}
            data-tm-compare
            data-tm-mode={mode}
            data-tm-pos={pos}
            data-tm-playing={playing ? playPhoto!.yearLabel : undefined}
            style={{ ['--tm-pos' as string]: `${pos}%` }}
            role="slider"
            tabIndex={0}
            aria-label={mode === 'slide' ? '左右拖动分割线，对比过去与现在' : '左右拖动，在过去与现在之间淡入淡出'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pos}
            aria-valuetext={`${past.yearLabel} ${pos}%，${present.yearLabel} ${100 - pos}%`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
          >
            <img className="tm__img tm__img--present" src={placePhotoSrc(present)!} alt={present.title} draggable={false} />
            <img
              className="tm__img tm__img--past"
              src={placePhotoSrc(past)!}
              alt={past.title}
              draggable={false}
              style={mode === 'fade' ? { opacity: pos / 100 } : undefined}
            />
            {mode === 'slide' && (
              <span className="tm__divider" aria-hidden>
                <span className="tm__handle">
                  <span className="tm__chev">‹</span>
                  <span className="tm__chev">›</span>
                </span>
              </span>
            )}
            <button
              className="tm__tag tm__tag--past"
              data-tm-past-year={past.yearLabel}
              onClick={showAllPast}
              aria-label={`只看 ${past.yearLabel}`}
            >
              {past.yearLabel}
            </button>
            <button
              className="tm__tag tm__tag--present"
              data-tm-present-year={present.yearLabel}
              onClick={showAllPresent}
              aria-label={`只看 ${present.yearLabel}`}
            >
              {present.yearLabel}
            </button>

            {/* 播放层：这个机位所有有年份的照片叠在一起，只有当前一张不透明 */}
            {playing && (
              <div className="tm__play" aria-live="polite">
                {view.dated.map((ph, i) => (
                  <img
                    key={ph.id}
                    className={`tm__img tm__playImg${i === playIdx ? ' is-on' : ''}`}
                    src={placePhotoSrc(ph)!}
                    alt={i === playIdx ? `${ph.yearLabel} ${ph.title}` : ''}
                    draggable={false}
                  />
                ))}
                <span className="tm__playYear" key={playIdx} data-tm-play-year={playPhoto!.yearLabel}>
                  {playPhoto!.yearLabel}
                </span>
                <span className="tm__playDots" aria-hidden>
                  {view.dated.map((ph, i) => (
                    <span key={ph.id} className={i <= playIdx! ? 'is-done' : ''} />
                  ))}
                </span>
              </div>
            )}
            {!playing && pos === 50 && !dragging && (
              <span className="tm__hint" aria-hidden>
                ← 拖动照片对比 →
              </span>
            )}
          </div>
          <div className="tm__controls">
            <button
              className="tm__play-btn"
              onClick={() => setPlayIdx(playing ? null : 0)}
              data-tm-play-btn
              disabled={view.dated.length < 2}
            >
              {playing ? '■ 停止' : `▶ 按年代播放（${view.dated.length}）`}
            </button>
            <div className="tm__modes" role="group" aria-label="对比方式">
              <button className={mode === 'slide' ? 'is-on' : ''} onClick={() => setMode('slide')} data-tm-mode-btn="slide" aria-pressed={mode === 'slide'}>
                滑动
              </button>
              <button className={mode === 'fade' ? 'is-on' : ''} onClick={() => setMode('fade')} data-tm-mode-btn="fade" aria-pressed={mode === 'fade'}>
                淡入
              </button>
            </div>
          </div>
          <p className="tm__caption">
            <span>
              {past.yearLabel} · 来源：{past.source}
            </span>
            <span>
              {present.yearLabel} · 来源：{present.source}
              {present.postId && (
                <button className="tm__postLink" onClick={() => navigate('feed', { id: present.postId! })}>
                  看原帖
                </button>
              )}
            </span>
          </p>
        </>
      ) : (
        <p className="tm__empty" data-tm-empty>
          {past && present && past.id === present.id
            ? '选中的就是最新一张，请在胶片带里选一个更早的年代来对比。'
            : '这个机位目前只有一个年代的影像（或年代不详），还凑不成「过去 vs 现在」。'}
        </p>
      )}

      {/* 胶片带：按年代排开，缺的年代如实写「该年代暂无影像」 */}
      <ol className="tm__strip no-scrollbar" data-tm-strip>
        {view.frames.map((f) => {
          const label = f.kind === 'decade' ? decadeLabel(f.decade) : '年代不详'
          const key = f.kind === 'decade' ? String(f.decade) : 'unknown'
          if (!f.photos.length) {
            return (
              <li key={key} className="tm__frame tm__frame--empty" data-tm-frame={key} data-tm-frame-empty>
                <span className="tm__frameDecade">{label}</span>
                <span className="tm__frameNone">该年代暂无影像</span>
              </li>
            )
          }
          return f.photos.map((ph) => {
            const on = ph.id === pastId || ph.id === present?.id
            const isPresent = ph.id === present?.id
            return (
              <li key={ph.id} className={`tm__frame${on ? ' is-on' : ''}`} data-tm-frame={key}>
                <button
                  className="tm__frameBtn"
                  onClick={() => !isPresent && setPastId(ph.id)}
                  disabled={isPresent}
                  aria-label={`${ph.yearLabel} ${ph.title}`}
                  data-tm-photo={ph.id}
                  data-tm-photo-year={ph.yearLabel}
                >
                  <img className="tm__frameImg" src={placePhotoSrc(ph)!} alt="" loading="lazy" />
                  <span className="tm__frameDecade">{label}</span>
                  <span className="tm__frameYear">{ph.yearLabel}</span>
                  {isPresent && <span className="tm__frameNow">最新</span>}
                </button>
              </li>
            )
          })
        })}
      </ol>
    </>
  )
}
