import { useCallback, useEffect, useRef, useState } from 'react'
import { failText, favoriteActivity, listActivityPage, listPlaces, mediaUrl, unfavoriteActivity,
  type ActivityEffectiveStatus, type ApiActivity, type ApiPlaceListItem } from '../api/client'
import { isLoggedIn } from '../api/session'
import { Screen } from '../components/Shell'
import { Button } from '../components/Button'
import { IconCalendar, IconCheck, IconChevronRight, IconClose, IconImage, IconLocation, IconRefresh, IconSearch, IconStar } from '../components/icons'
import { useRoute, navigate } from '../router'
import '../styles/switcher.css'
import './activities.css'

/*
  ACT-001：**默认只看即将开始 + 进行中**（服务端 status 缺省就是这个口径），
  「已结束」「已取消」通过筛选查看 —— 历史活动是长期事实，不该占满默认列表。
  '' = 交给服务端默认；'all' 才是「不按状态过滤」。
*/
type StatusKey = '' | 'all' | 'upcoming' | 'ongoing' | 'ended' | 'cancelled'
const STATUS_OPTIONS: Array<{ key: StatusKey; label: string }> = [
  { key: '', label: '近期' }, { key: 'all', label: '全部' }, { key: 'upcoming', label: '即将开始' },
  { key: 'ongoing', label: '进行中' }, { key: 'ended', label: '已结束' }, { key: 'cancelled', label: '已取消' },
]

/** Public activity catalogue; filtering/status/counts always come from the server. */
export function ActivitiesScreen() {
  const route = useRoute()
  const placeId = route.query.placeId ?? route.path.split('/')[1] ?? ''
  const [items, setItems] = useState<ApiActivity[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errText, setErrText] = useState('')
  const [win, setWin] = useState<'' | 'today' | 'week'>('')
  const [status, setStatus] = useState<StatusKey>('')
  const [placeOpen, setPlaceOpen] = useState(false)
  const [places, setPlaces] = useState<ApiPlaceListItem[]>([])
  const [placePhase, setPlacePhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [favBusy, setFavBusy] = useState<string | null>(null)
  const [favMsg, setFavMsg] = useState('')
  const requestVersion = useRef(0)
  const placeRequestVersion = useRef(0)
  const favoriteLock = useRef(false)
  const favoriteVersion = useRef(0)
  const favoriteUpdates = useRef(new Map<string, { version: number; favorited: boolean }>())

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    const favoritesAtStart = favoriteVersion.current
    setPhase('loading'); setErrText('')
    const r = await listActivityPage({ ...(win ? { window: win } : {}), status, ...(placeId ? { placeId } : {}) })
    if (version !== requestVersion.current) return
    if (r.ok) {
      setItems(r.value.items.map(a => {
        const update = favoriteUpdates.current.get(a.id)
        return update && update.version > favoritesAtStart ? { ...a, favoritedByMe: update.favorited } : a
      }))
      setTotal(r.value.total); setPhase('ready')
    } else { setItems([]); setTotal(null); setErrText(failText(r)); setPhase('error') }
  }, [win, status, placeId])
  const invalidateRequests = useCallback(() => { requestVersion.current++ }, [])
  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void load() })
    return () => { active = false; invalidateRequests() }
  }, [load, invalidateRequests])

  const loadPlaces = useCallback(async () => {
    const version = ++placeRequestVersion.current
    setPlacePhase('loading')
    const r = await listPlaces()
    if (version !== placeRequestVersion.current) return
    if (r.ok) { setPlaces(r.value); setPlacePhase('ready') }
    else setPlacePhase('error')
  }, [])
  const invalidatePlaces = useCallback(() => { placeRequestVersion.current++ }, [])
  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) void loadPlaces() })
    return () => { active = false; invalidatePlaces() }
  }, [loadPlaces, invalidatePlaces])

  async function toggleFavorite(a: ApiActivity) {
    if (favoriteLock.current) return
    if (!isLoggedIn()) { navigate('loginselect'); return }
    favoriteLock.current = true; setFavBusy(a.id)
    try {
      const r = a.favoritedByMe ? await unfavoriteActivity(a.id) : await favoriteActivity(a.id)
      if (!r.ok) { setFavMsg(r.status === 503 ? '服务暂不可用，请稍后再试' : `收藏操作失败：${failText(r)}`); return }
      favoriteUpdates.current.set(a.id, { version: ++favoriteVersion.current, favorited: r.value.favorited })
      setItems(prev => prev.map(x => x.id === a.id ? { ...x, favoritedByMe: r.value.favorited } : x))
      setFavMsg('')
    } finally { favoriteLock.current = false; setFavBusy(null) }
  }
  function pickPlace(id: string) {
    setPlaceOpen(false)
    navigate('activities', id ? { placeId: id } : undefined)
  }
  const placeName = places.find(p => p.id === placeId)?.name ?? '已选地点'
  const listHeading = status === '' || status === 'upcoming' || status === 'ongoing' ? '近期活动' : '活动列表'

  return <Screen className="acts-page" header={<header className="acts__head">
    <div><h1 className="acts__title">校园活动</h1><p className="acts__subtitle">发现校园里的新鲜事</p></div>
    <button className="acts__refresh" onClick={() => void load()} disabled={phase === 'loading'} aria-label="刷新活动" aria-busy={phase === 'loading'}><IconRefresh size={27} /></button>
  </header>} scroll>
    <div className="acts__filterBlock" inert={placeOpen}>
      <div className="acts__filters acts__filters--time" role="group" aria-label="时间筛选">
        <span className="acts__filterLabel">时间</span>
        {([{ key: '', label: '全部' }, { key: 'today', label: '今天' }, { key: 'week', label: '本周' }] as const).map(f => <button key={f.key} className={`acts__chip ${win === f.key ? 'is-active' : ''}`} data-act-filter={f.key || 'all'} aria-pressed={win === f.key} onClick={() => setWin(f.key)}>{f.label}</button>)}
      </div>
      <div className="acts__filters acts__filters--status">
        <span className="acts__filterLabel">状态</span>
        <div className="acts__statusScroll no-scrollbar" role="group" aria-label="状态筛选">{STATUS_OPTIONS.map(f => <button key={f.key} className={`acts__chip ${status === f.key ? 'is-active' : ''}`} data-act-status-filter={f.key} aria-pressed={status === f.key} onClick={e => { setStatus(f.key); e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }}>{f.label}</button>)}</div>
      </div>
      <div className="acts__filters acts__filters--place">
        <span className="acts__filterLabel">地点</span>
        <button className="acts__placeTrigger" data-act-place-open aria-haspopup="dialog" aria-expanded={placeOpen} onClick={() => setPlaceOpen(true)}><IconLocation size={21} /><span>{placeId ? placeName : '全部地点'}</span><IconChevronRight size={21} /></button>
        {placeId && <button className="acts__clearPlace" data-act-place-clear onClick={() => pickPlace('')}>清除</button>}
      </div>
    </div>
    <section className="acts__results" aria-labelledby="acts-list-heading" aria-busy={phase === 'loading'} inert={placeOpen}>
      <div className="acts__sectionHead"><h2 id="acts-list-heading">{listHeading}</h2><span aria-live="polite">{phase === 'ready' ? total === null ? `已加载 ${items.length} 项` : `${total} 项` : phase === 'loading' ? '加载中…' : '暂不可用'}</span></div>
      {phase === 'loading' && <div className="acts__skeletonList" role="status" aria-label="活动加载中">{[0, 1, 2].map(i => <div key={i} className="acts__skeleton" aria-hidden="true"><div /><span /><span /><span /></div>)}</div>}
      {phase === 'error' && <div className="acts__state" data-act-phase="error" role="alert"><p>活动加载失败</p><p className="acts__state-sub">{errText}</p><Button onClick={() => void load()}>重试</Button></div>}
      {phase === 'ready' && !items.length && <div className="acts__state" data-act-phase="empty"><IconCalendar size={32} /><p>暂无符合条件的活动</p><p className="acts__state-sub">试试其他时间、状态或地点。</p><Button variant="text" onClick={() => { setWin(''); setStatus('all'); pickPlace('') }}>重置筛选</Button></div>}
      {favMsg && <p className="acts__favmsg" role="alert" data-act-fav-msg>{favMsg}</p>}
      {phase === 'ready' && items.length > 0 && <ul className="acts__list" data-act-phase="ready" data-act-count={items.length}>
        {items.map(a => {
          const canLocate = a.place.enabled && Number.isFinite(a.place.latitude) && Number.isFinite(a.place.longitude) && a.place.latitude !== null && a.place.longitude !== null
          return <li key={a.id} className="acts__row" data-act-id={a.id} data-act-status={a.effectiveStatus}>
            <button className="acts__poster" aria-label={`查看活动：${a.title}`} onClick={() => navigate('activity', { id: a.id })}><ActivityCover key={a.coverImageId ?? 'none'} activity={a} /></button>
            <div className="acts__info">
              <div className="acts__itemTop"><h3><button className="acts__itemTitle" onClick={() => navigate('activity', { id: a.id })}>{a.title}</button></h3><button type="button" className={`acts__fav ${a.favoritedByMe ? 'is-on' : ''}`} disabled={favBusy !== null} aria-busy={favBusy === a.id} data-act-fav-id={a.id} data-act-fav-on={a.favoritedByMe ? 'true' : 'false'} aria-pressed={a.favoritedByMe} aria-label={a.favoritedByMe ? `取消收藏 ${a.title}` : `收藏 ${a.title}`} onClick={() => void toggleFavorite(a)}><IconStar size={23} filled={a.favoritedByMe} /></button></div>
              <StatusBadge status={a.effectiveStatus} />
              <p className="acts__itemMeta" aria-label={formatActivityTime(a.startsAt, a.endsAt)} title={formatActivityTime(a.startsAt, a.endsAt)}><IconCalendar size={18} /><span>{formatActivitySummaryTime(a.startsAt, a.endsAt)}</span></p>
              <p className="acts__itemMeta"><IconLocation size={18} /><span>{a.place.name}</span></p>
              {a.organizer && <p className="acts__itemOrganizer" data-act-organizer>主办：{a.organizer}</p>}
              <div className="acts__itemBottom"><p className="acts__itemSource">来源：{a.source || '未注明'}</p><button className="acts__mapLink" disabled={!canLocate} aria-label={canLocate ? `在地图查看 ${a.title}` : `${a.title} 的地点暂不可定位`} title={canLocate ? `定位到${a.place.name}` : '地点已停用或缺少有效坐标'} onClick={() => navigate('map', { placeId: a.place.id })}>{canLocate ? '地图查看' : '暂不可定位'}<span aria-hidden="true">→</span></button></div>
            </div>
          </li>
        })}
      </ul>}
      {phase === 'ready' && total !== null && total > items.length && <p className="acts__limitNote">共 {total} 项，当前展示前 {items.length} 项，可通过筛选缩小范围。</p>}
    </section>
    {placeOpen && <ActivityPlacePanel places={places} phase={placePhase} selected={placeId} onPick={pickPlace} onRetry={() => void loadPlaces()} onClose={() => setPlaceOpen(false)} />}
  </Screen>
}

function ActivityCover({ activity }: { activity: ApiActivity }) {
  const [failed, setFailed] = useState(false)
  if (!activity.coverImageId || failed) return <span className="acts__posterEmpty"><IconImage size={30} /><span>{failed ? '封面暂不可用' : '暂无海报'}</span></span>
  return <img src={mediaUrl(activity.coverImageId)} alt={`${activity.title} 海报`} loading="lazy" onError={() => setFailed(true)} />
}

function ActivityPlacePanel({ places, phase, selected, onPick, onClose, onRetry }: {
  places: ApiPlaceListItem[]; phase: 'loading' | 'ready' | 'error'; selected: string
  onPick: (id: string) => void; onClose: () => void; onRetry: () => void
}) {
  const [q, setQ] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const controls = () => Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])
    panel?.querySelector('input')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current() }
      if (e.key !== 'Tab') return
      const items = controls(), first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) { e.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus() }
  }, [])
  const list = places.filter(p => p.name.includes(q.trim()))
  return <div className="switcher acts__placePanel" data-act-place-panel>
    <div className="switcher__mask" onClick={onClose} />
    <div className="switcher__panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="acts-place-heading">
      <div className="acts__panelHead"><h2 id="acts-place-heading">选择活动地点</h2><button aria-label="关闭地点筛选" onClick={onClose}><IconClose size={21} /></button></div>
      <div className="switcher__search"><IconSearch size={17} /><input className="switcher__input" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索地点名称" aria-label="搜索活动地点" data-act-place-search /></div>
      <ul className="switcher__list no-scrollbar"><li><button className={`switcher__item ${!selected ? 'is-current' : ''}`} data-act-place-option="" aria-pressed={!selected} onClick={() => onPick('')}><span className="switcher__name">全部地点</span></button></li>
        {phase === 'ready' && list.map(p => <li key={p.id}><button className={`switcher__item ${selected === p.id ? 'is-current' : ''}`} data-act-place-option={p.id} aria-pressed={selected === p.id} onClick={() => onPick(p.id)}><span className="switcher__name">{p.name}</span><span className="switcher__meta">{p.category}</span>{selected === p.id && <IconCheck size={16} />}</button></li>)}
      </ul>
      {phase === 'loading' && <p className="acts__panelState" role="status">地点加载中…</p>}
      {phase === 'error' && <div className="acts__panelState" role="alert"><p>地点加载失败，活动列表仍可浏览。</p><Button variant="secondary" onClick={onRetry}>重试加载地点</Button></div>}
      {phase === 'ready' && !list.length && <p className="acts__panelState" data-act-place-empty>{q ? `没有匹配“${q}”的地点` : '暂无可选地点'}</p>}
    </div>
  </div>
}

export function StatusBadge({ status }: { status: ActivityEffectiveStatus }) {
  const label: Record<ActivityEffectiveStatus, string> = {
    upcoming: '即将开始',
    ongoing: '进行中',
    ended: '已结束',
    cancelled: '已取消',
  }
  return (
    <span className={`acts__badge acts__badge--${status}`} data-act-badge={status}>
      {label[status]}
    </span>
  )
}


/** Format all campus times in the same timezone as calendar filters. */
function activityDateParts(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return { day: `${get('year')}-${get('month')}-${get('day')}`, short: `${get('month')}.${get('day')}`, hm: `${get('hour')}:${get('minute')}`, year: get('year') }
}
export function formatActivityTime(startsAt: string, endsAt: string | null): string {
  const start = activityDateParts(startsAt), end = endsAt ? activityDateParts(endsAt) : null
  if (!start) return '时间未知'
  return !end ? `${start.day} ${start.hm}` : start.day === end.day ? `${start.day} ${start.hm}–${end.hm}` : `${start.day} ${start.hm} – ${end.day} ${end.hm}`
}
function formatActivitySummaryTime(startsAt: string, endsAt: string | null): string {
  const start = activityDateParts(startsAt), end = endsAt ? activityDateParts(endsAt) : null
  if (!start) return '时间未知'
  const currentYear = activityDateParts(new Date().toISOString())!.year
  const day = (p: NonNullable<ReturnType<typeof activityDateParts>>) => p.year === currentYear && (!end || start.year === end.year) ? p.short : p.day.replaceAll('-', '.')
  return !end ? `${day(start)} ${start.hm}` : start.day === end.day ? `${day(start)} ${start.hm} – ${end.hm}` : `${day(start)} — ${day(end)}`
}
