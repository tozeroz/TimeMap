import { useEffect, useRef, useState } from 'react'
import { getPlace, listMapHierarchy, mediaUrl, type ApiPlaceDetail, type ApiPlacePhoto, type MapHierarchyItem } from '../api/client'
import { PhotoViewer, type ViewerPhoto } from '../components/PhotoViewer'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconLocation } from '../components/icons'
import { buildHash, navigate, type Route } from '../router'
import { introHeading, introParagraphs, parsePhotoParam, photoMeta, photoSrc, pickCover } from './placeIntroModel'
import { isPlaceId } from './placeSheetModel'
import './placeintro.css'

/**
 * 地点简介页 #/place-intro?id=（spec §6）：只有封面、简介和相关照片。
 * 不显示活动、帖子、筛选、发布按钮或主导航——这些留在地图地点抽屉。
 * 照片查看器的开合跟随 photo 参数（推入一条历史，后退 / Esc 先关查看器）。
 */
export function PlaceIntroScreen({ id, route }: { id: string; route: Route }) {
  const valid = isPlaceId(id)
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'error' | 'not_found'; place: ApiPlaceDetail | null; error: string | null }>(
    () => (valid ? { phase: 'loading', place: null, error: null } : { phase: 'not_found', place: null, error: null }))
  const [hierarchy, setHierarchy] = useState<Map<string, MapHierarchyItem> | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!valid) return
    let alive = true // 过期响应（重试、卸载）一律丢弃
    void getPlace(id, 'latest').then(r => {
      if (!alive) return
      if (r.ok) setState({ phase: 'ready', place: r.value, error: null })
      else setState({ phase: r.status === 404 ? 'not_found' : 'error', place: null, error: r.human ?? r.reason })
    })
    return () => { alive = false }
  }, [id, valid, retry])
  useEffect(() => {
    if (!valid) return
    let alive = true
    // 层级数据只决定顶栏标题和小字；失败时降级为「地点简介」＋分类，不阻塞页面
    void listMapHierarchy().then(r => { if (alive && r.ok) setHierarchy(r.value) })
    return () => { alive = false }
  }, [valid])

  /*
    加载时就带 photo 的地址（刷新、深链）：去掉参数、不自动打开。
    replaceState 不触发 hashchange，route 会落后于实际地址，所以记下被剥掉的 route 对象，
    与它相同就视为没有 photo（design-review F3）。
  */
  const [strippedRoute] = useState<Route | null>(() => (route.query.photo !== undefined ? route : null))
  useEffect(() => {
    if (strippedRoute) window.history.replaceState(window.history.state, '', buildHash('place-intro', { id }))
  }, [strippedRoute, id])

  const place = state.place
  const { cover, rest } = place ? pickCover(place.photos) : { cover: null, rest: [] as ApiPlacePhoto[] }
  const viewerParam = !place || route === strippedRoute ? null : parsePhotoParam(route.query.photo, rest.length, cover !== null)
  const [localIndex, setLocalIndex] = useState<{ param: string; index: number } | null>(null)
  const album: ApiPlacePhoto[] = viewerParam === 'cover' && cover ? [cover] : rest
  const viewerIndex = viewerParam === null ? 0 : localIndex && localIndex.param === route.query.photo ? localIndex.index : viewerParam === 'cover' ? 0 : viewerParam
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (viewerParam !== null) { wasOpen.current = true; return }
    if (!wasOpen.current) return
    wasOpen.current = false
    const el = openerRef.current
    requestAnimationFrame(() => el?.focus({ preventScroll: true }))
  }, [viewerParam])

  const open = (photo: 'cover' | number, el: HTMLElement) => {
    openerRef.current = el
    setLocalIndex(null)
    navigate('place-intro', { id, photo: String(photo) })
  }
  const back = () => {
    if (window.history.state?.tmIntroFromSheet) window.history.back()
    else window.location.replace(valid ? buildHash('map', { placeId: id, sheet: 'preview' }) : '#/map')
  }

  const heading = place ? introHeading(place.id, hierarchy, place.category) : { title: '地点简介' as const, eyebrow: '' }
  const header = <TopBar variant="plain" left={<button className="iconbtn" onClick={back} aria-label="返回"><IconBack size={24} /></button>} center={<span className="pi__topTitle" data-pi-title>{heading.title}</span>} />

  if (state.phase !== 'ready' || !place) return <Screen className="pi-page" header={header}>
    <div className="pi__state" role="status" data-pi-phase={state.phase}>
      <p>{state.phase === 'loading' ? '正在读取地点资料…' : state.phase === 'not_found' ? '地点不存在或已删除' : '地点加载失败'}</p>
      {state.phase === 'error' && state.error && <p className="pi__stateSub">{state.error}</p>}
      {state.phase === 'error' && <button className="pi__retry" onClick={() => setRetry(n => n + 1)}>重试</button>}
    </div>
  </Screen>

  const paragraphs = introParagraphs(place.description, place.history)
  const viewerPhotos: ViewerPhoto[] = album.map(p => ({ key: p.id, src: photoSrc(p, mediaUrl), title: p.title || place.name, meta: photoMeta(p) }))
  const coverMeta = cover ? [cover.title, photoMeta(cover)].filter(Boolean).join(' · ') : ''

  return <Screen className="pi-page" header={header}>
    <article className="pi" data-place-id={place.id} data-pi-phase="ready">
      {heading.eyebrow && <p className="pi__eyebrow" data-pi-eyebrow>{heading.eyebrow}</p>}
      <h1 className="pi__name" data-place-name>{place.name}</h1>
      <figure className="pi__cover" data-pi-cover={cover ? 'photo' : 'placeholder'}>
        {cover
          ? <button className="pi__coverBtn" aria-label={`查看封面大图：${cover.title || place.name}`} onClick={e => open('cover', e.currentTarget)}><PhotoImg photo={cover} className="pi__coverImg" /></button>
          : <div className="pi__placeholder pi__coverImg" aria-hidden="true">暂无照片</div>}
        {coverMeta && <figcaption className="pi__coverMeta">{coverMeta}</figcaption>}
      </figure>
      <section className="pi__intro">
        <h2 className="pi__h2">简介</h2>
        {paragraphs.length ? paragraphs.map((t, i) => <p key={i} className="pi__p">{t}</p>) : <p className="pi__empty" data-pi-empty="intro">暂无简介</p>}
        {place.address && <p className="pi__addr"><IconLocation size={16} />{place.address}</p>}
      </section>
      <hr className="pi__divider" />
      <section className="pi__photos">
        <h2 className="pi__h2">相关照片</h2>
        {rest.length ? <ul className="pi__grid" data-pi-photos={rest.length}>{rest.map((p, i) => {
          const meta = photoMeta(p)
          return <li key={p.id}>
            <button className="pi__thumb" aria-label={`查看照片：${p.title || place.name}`} onClick={e => open(i, e.currentTarget)}><PhotoImg photo={p} className="pi__thumbImg" /></button>
            <span className="pi__cap">{p.title}</span>
            {meta && <span className="pi__meta">{meta}</span>}
          </li>
        })}</ul> : <p className="pi__empty" data-pi-empty="photos">暂无相关照片</p>}
      </section>
    </article>
    {viewerParam !== null && viewerPhotos.length > 0 && <PhotoViewer
      photos={viewerPhotos}
      index={Math.min(viewerIndex, viewerPhotos.length - 1)}
      label={`${place.name} 照片浏览`}
      onIndexChange={i => {
        // 序号变化只替换当前历史条目；本地状态为准（replaceState 后 route 不会更新）
        setLocalIndex({ param: route.query.photo ?? '', index: i })
        window.history.replaceState(window.history.state, '', buildHash('place-intro', { id, photo: String(i) }))
      }}
      onClose={() => window.history.back()}
    />}
  </Screen>
}

/** 单张图片：加载失败显示同尺寸占位与重试，没有地址显示「暂无图片」 */
function PhotoImg({ photo, className }: { photo: ApiPlacePhoto; className: string }) {
  const src = photoSrc(photo, mediaUrl)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  if (!src) return <span className={`pi__placeholder ${className}`}>暂无图片</span>
  if (failed) return <span className={`pi__placeholder ${className}`}>图片加载失败 <span role="button" tabIndex={0} className="pi__imgRetry" onClick={e => { e.stopPropagation(); setFailed(false); setAttempt(n => n + 1) }} onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); setFailed(false); setAttempt(n => n + 1) } }}>重试</span></span>
  return <img key={attempt} className={className} src={src} alt={photo.title} loading="lazy" onError={() => setFailed(true)} />
}
