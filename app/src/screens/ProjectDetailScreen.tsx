import { useCallback, useEffect, useRef, useState } from 'react'
import { createProjectReview, deleteProjectReview, failText, getTrainingProject, listProjectReviews, mediaUrl, setProjectLike, type ProjectReview, type TrainingProject } from '../api/client'
import { getSession, isLoggedIn } from '../api/session'
import { Screen } from '../components/Shell'
import { AdminDialog } from '../components/AdminPrimitives'
import { IconBack, IconCalendar, IconEdit, IconHeart, IconImage, IconMapTab, IconShare, IconStar, IconUsers } from '../components/icons'
import { navigate } from '../router'
import './projectdetail.css'

const validUrl = (value?: string | null): value is string => !!value && /^https?:\/\//i.test(value)
const featureIcons = [IconMapTab, IconEdit, IconCalendar, IconStar]
export function ProjectDetailScreen({ id }: { id: string }) {
  const [project, setProject] = useState<TrainingProject | null>(null), [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [reviews, setReviews] = useState<ProjectReview[]>([]), [reviewTotal, setReviewTotal] = useState(0), [cursor, setCursor] = useState<string | null>(null)
  const [reviewPhase, setReviewPhase] = useState<'loading' | 'ready' | 'error'>('loading'), [reviewError, setReviewError] = useState('')
  const [composer, setComposer] = useState(false), [draft, setDraft] = useState(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(`timemap.project.draft.${id}`) ?? 'null'); return saved?.userId === getSession()?.user.id ? String(saved.body ?? '') : '' } catch { return '' }
  })
  const [sending, setSending] = useState(false), [liking, setLiking] = useState(false), [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ProjectReview | null>(null), [copyLink, setCopyLink] = useState(false)
  const alive = useRef(true), version = useRef(0), reviewVersion = useRef(0), action = useRef(false), likeLock = useRef(false), reviewLock = useRef(false)
  const reviewRequest = useRef<{ body: string; id: string } | null>(null)
  const load = useCallback(async () => {
    const request = ++version.current
    setPhase('loading'); setError('')
    if (!id) { setPhase('missing'); return }
    const r = await getTrainingProject(id)
    if (!alive.current || request !== version.current) return
    if (r.ok) { setProject(r.value); setReviewTotal(r.value.reviewCount ?? 0); setPhase('ready') }
    else { setError(failText(r)); setPhase(r.status === 404 || r.status === 400 ? 'missing' : 'error') }
  }, [id])
  const loadReviews = useCallback(async (after?: string) => {
    if (reviewLock.current && after) return
    reviewLock.current = true
    const request = ++reviewVersion.current
    setReviewPhase('loading'); setReviewError('')
    try {
      const r = await listProjectReviews(id, after)
      if (!alive.current || request !== reviewVersion.current) return
      if (r.ok) {
        setReviews(previous => after ? [...previous, ...r.value.items.filter(item => !previous.some(old => old.id === item.id))] : r.value.items)
        setCursor(r.value.nextCursor); setReviewTotal(r.value.total); setReviewPhase('ready')
      } else { setReviewError(failText(r)); setReviewPhase('error') }
    } finally { if (request === reviewVersion.current) reviewLock.current = false }
  }, [id])
  const invalidate = useCallback(() => { alive.current = false; version.current++; reviewVersion.current++ }, [])
  useEffect(() => {
    alive.current = true
    let active = true
    queueMicrotask(() => { if (active) void load() })
    return () => { active = false; invalidate() }
  }, [load, invalidate])
  useEffect(() => { if (phase !== 'ready') return; let active = true; queueMicrotask(() => { if (active) void loadReviews() }); return () => { active = false } }, [phase, loadReviews])
  function back() {
    let view = 'all'
    try { if (JSON.parse(sessionStorage.getItem('timemap.projects.return') ?? 'null')?.query?.view === 'popular') view = 'popular' } catch { /* Use all projects. */ }
    navigate('activities', { mode: 'projects', view })
  }
  function login() {
    try { sessionStorage.setItem('timemap.login.return', JSON.stringify({ path: 'project', query: { id } })) } catch { /* Login remains available. */ }
    navigate('loginselect')
  }
  function writeReview() { if (!isLoggedIn()) { login(); return }; setReviewError(''); setComposer(true) }
  function changeDraft(value: string) {
    setDraft(value)
    try { sessionStorage.setItem(`timemap.project.draft.${id}`, JSON.stringify({ userId: getSession()?.user.id, body: value })) } catch { /* Keep in-memory draft. */ }
  }
  async function like() {
    if (!project || likeLock.current) return
    if (!isLoggedIn()) { login(); return }
    likeLock.current = true; setLiking(true); setNotice('')
    try {
      const r = await setProjectLike(id, !project.likedByMe)
      if (!alive.current) return
      if (r.ok) setProject(previous => previous ? { ...previous, ...r.value } : previous)
      else if (r.status === 401) login()
      else if (r.status === 404) { setPhase('missing'); setComposer(false) }
      else setNotice(`点赞操作失败：${failText(r)}`)
    } finally { likeLock.current = false; if (alive.current) setLiking(false) }
  }
  async function submit() {
    if (action.current) return
    const body = draft.trim()
    if (!body || Array.from(body).length > 500) { setReviewError('请输入 1–500 字的评价'); return }
    if (!isLoggedIn()) { login(); return }
    if (!reviewRequest.current || reviewRequest.current.body !== body) reviewRequest.current = { body, id: crypto.randomUUID() }
    action.current = true; setSending(true); setReviewError('')
    try {
      const r = await createProjectReview(id, body, reviewRequest.current.id)
      if (!alive.current) return
      if (!r.ok) {
        if (r.status === 401) { login(); return }
        if (r.status === 404) { setPhase('missing'); setComposer(false); return }
        if (r.status === 409) reviewRequest.current = null
        setReviewError(`评价提交失败：${failText(r)}`); return
      }
      changeDraft(''); reviewRequest.current = null; setComposer(false); setNotice('评价已发布')
      await loadReviews()
    } finally { action.current = false; if (alive.current) setSending(false) }
  }
  async function remove(review: ProjectReview) {
    if (action.current) return
    action.current = true; setDeleting(review.id); setNotice('')
    try {
      const r = await deleteProjectReview(id, review.id)
      if (!alive.current) return
      if (r.ok) { setConfirmDelete(null); setNotice('评价已删除'); await loadReviews() }
      else if (r.status === 401) login()
      else setNotice(`删除失败：${failText(r)}`)
    } finally { action.current = false; if (alive.current) setDeleting(null) }
  }
  async function share() {
    const url = window.location.href
    try {
      if (navigator.share) { await navigator.share({ title: project?.name ?? '实训项目', url }); return }
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); setNotice('项目链接已复制'); return }
    } catch (err) { if ((err as Error).name === 'AbortError') return }
    setCopyLink(true)
  }
  return <Screen className="project-detail" header={<header className="project-detail__top"><button aria-label="返回实训项目" onClick={back}><IconBack size={26} /></button><h1>项目详情</h1><button aria-label="分享项目" disabled={!project || phase !== 'ready'} onClick={() => void share()}><IconShare size={25} /></button></header>}
    footer={phase === 'ready' && project ? <div className="project-detail__actions"><button className={project.likedByMe ? 'is-liked' : ''} disabled={liking} aria-busy={liking} aria-pressed={project.likedByMe} aria-label={`${project.likedByMe ? '取消点赞' : '点赞'}，${project.likeCount} 赞`} onClick={() => void like()}><IconHeart size={25} filled={project.likedByMe} /><span>点赞 {project.likeCount}</span></button><button onClick={writeReview}><IconEdit size={23} /><span>写评价</span></button>{validUrl(project.experienceUrl) && <a href={project.experienceUrl} target="_blank" rel="noopener noreferrer">立即体验 <span aria-hidden="true">↗</span></a>}</div> : undefined}>
    {phase === 'loading' && <div className="project-detail__state" role="status">正在读取项目详情…</div>}
    {phase === 'error' && <div className="project-detail__state" role="alert"><h2>项目加载失败</h2><p>{error}</p><button onClick={() => void load()}>重试</button></div>}
    {phase === 'missing' && <div className="project-detail__state"><h2>项目已下架或不存在</h2><button onClick={back}>返回实训项目</button></div>}
    {phase === 'ready' && project && <>
      {!!project.showcaseImageIds?.length && <ProjectGallery ids={project.showcaseImageIds} name={project.name} />}
      <div className="project-detail__content"><section className="project-detail__identity"><h2>{project.name}</h2><p>{project.summary}</p><div className="project-detail__tags">{project.category && <span>{project.category}</span>}<small>实训项目</small></div></section>
        <section className="project-detail__intro"><h2 className="project-detail__heading">项目介绍</h2><p>{project.description || project.summary}</p>
          {!!project.features?.length && <ul className={`project-detail__features ${project.features.length === 3 ? 'has-three' : ''}`}>{project.features.map((feature, i) => { const Icon = featureIcons[i % featureIcons.length]; return <li key={`${i}-${feature}`}><Icon size={25} /><span>{feature}</span></li> })}</ul>}
          {(project.groupName || project.memberCount != null) && <p className="project-detail__team"><IconUsers size={19} />{project.groupName || '项目团队'}{project.memberCount != null && ` · ${project.memberCount}人`}</p>}
          {project.experienceNotes && <p className="project-detail__notes">{project.experienceNotes}</p>}
          {validUrl(project.projectUrl) && <a className="project-detail__source" href={project.projectUrl} target="_blank" rel="noopener noreferrer">项目链接 · GitHub <span aria-hidden="true">↗</span></a>}
        </section>
        <section className="project-detail__reviews"><div className="project-detail__reviewHead"><h2 className="project-detail__heading">用户评价 <span>（{reviewTotal}）</span></h2><button onClick={writeReview}><IconEdit size={19} />写评价</button></div>
          <button className="project-detail__prompt" onClick={writeReview}>体验怎么样？分享感受或提个建议吧。</button>
          {notice && <p className="project-detail__notice" role="status">{notice}</p>}
          {reviewPhase === 'loading' && <p className="project-detail__muted" role="status">正在读取评价…</p>}
          {reviewPhase === 'error' && <p className="project-detail__notice" role="alert">{reviewError} <button onClick={() => void loadReviews(cursor ?? undefined)}>重试</button></p>}
          {reviewPhase === 'ready' && !reviews.length && <p className="project-detail__empty">还没有评价，来分享你的体验吧。</p>}
          <ul className="project-detail__reviewList">{reviews.map(review => <li key={review.id}><ReviewAvatar review={review} /><div><div className="project-detail__reviewName"><h3>{review.displayName || '同学'}</h3>{review.canDelete && <button aria-label={`删除${review.displayName}的评价`} onClick={() => setConfirmDelete(review)}>删除</button>}</div><time dateTime={review.createdAt}>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(review.createdAt))}</time><p>{review.body}</p></div></li>)}</ul>
          {cursor && reviewPhase !== 'loading' && <button className="project-detail__more" onClick={() => void loadReviews(cursor)}>加载更多评价</button>}
        </section>
      </div>
    </>}
    {composer && <AdminDialog title="写评价" onClose={() => { if (!sending) setComposer(false) }}><form className="project-detail__form" onSubmit={e => { e.preventDefault(); void submit() }}><label htmlFor="project-review-body">分享你的体验或建议</label><textarea id="project-review-body" autoFocus rows={5} maxLength={500} value={draft} disabled={sending} onChange={e => changeDraft(e.target.value)} placeholder="你的体验能帮助同学们改进项目" /><small>{Array.from(draft).length} / 500</small>{reviewError && <p role="alert">{reviewError}</p>}<div><button type="button" disabled={sending} onClick={() => setComposer(false)}>取消</button><button type="submit" disabled={sending}>{sending ? '提交中…' : '发布评价'}</button></div></form></AdminDialog>}
    {confirmDelete && <AdminDialog title="删除评价" onClose={() => { if (!deleting) setConfirmDelete(null) }}><p>确定删除这条评价吗？</p><div className="project-detail__confirm"><button disabled={!!deleting} onClick={() => setConfirmDelete(null)}>取消</button><button disabled={!!deleting} onClick={() => void remove(confirmDelete)}>{deleting ? '删除中…' : '确认删除'}</button></div></AdminDialog>}
    {copyLink && <AdminDialog title="复制项目链接" onClose={() => setCopyLink(false)}><p>请复制以下链接分享给同学：</p><input className="project-detail__copy" aria-label="项目分享链接" readOnly value={window.location.href} onFocus={e => e.currentTarget.select()} /></AdminDialog>}
  </Screen>
}

function ReviewAvatar({ review }: { review: ProjectReview }) {
  const [failed, setFailed] = useState(false)
  return <div className="project-detail__avatar">{review.avatarMediaId && !failed ? <img src={mediaUrl(review.avatarMediaId)} alt="" onError={() => setFailed(true)} /> : <IconUsers size={24} />}</div>
}

function ProjectGallery({ ids, name }: { ids: string[]; name: string }) {
  const [index, setIndex] = useState(0), [expanded, setExpanded] = useState(false), [zoom, setZoom] = useState(1)
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const touch = useRef<number | null>(null), dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null)
  const pick = (next: number) => { setIndex((next + ids.length) % ids.length); setZoom(1) }
  useEffect(() => {
    if (!expanded) return
    const box = dialog.current
    const button = opener.current
    box?.showModal()
    return () => { box?.close(); button?.focus() }
  }, [expanded])
  const controls = <div className="project-detail__galleryControls"><button disabled={ids.length < 2} aria-label="上一张展示图" onClick={() => pick(index - 1)}>←</button><span aria-live="polite">{index + 1} / {ids.length}</span><button disabled={ids.length < 2} aria-label="下一张展示图" onClick={() => pick(index + 1)}>→</button></div>
  return <div className="project-detail__gallery" aria-label="项目详情展示图" onTouchStart={e => { touch.current = e.touches[0]?.clientX ?? null }} onTouchEnd={e => { const x = e.changedTouches[0]?.clientX; if (touch.current !== null && x !== undefined && Math.abs(x - touch.current) > 50) pick(index + (x < touch.current ? 1 : -1)); touch.current = null }}>
    <button ref={opener} className="project-detail__galleryImage" aria-label={`放大查看${name}第${index + 1}张展示图`} onClick={() => { setExpanded(true); setZoom(1) }}>
      {failed.has(ids[index]) ? <span className="project-detail__broken"><IconImage size={32} />展示图暂不可用，点击查看</span> : <img key={ids[index]} src={mediaUrl(ids[index])} alt={`${name}展示图 ${index + 1}`} onError={() => setFailed(previous => new Set(previous).add(ids[index]))} />}
    </button>{ids.length > 1 && controls}
    {expanded && <dialog ref={dialog} className="project-detail__lightbox" aria-label="放大浏览展示图" onCancel={e => { e.preventDefault(); setExpanded(false) }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); pick(index + (e.key === 'ArrowLeft' ? -1 : 1)) } }}>
      <div className="project-detail__lightboxBar"><button onClick={() => setExpanded(false)}>关闭</button><div><button aria-label="缩小图片" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - .5))}>−</button><button aria-label="复位图片" onClick={() => setZoom(1)}>复位</button><button aria-label="放大图片" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + .5))}>＋</button></div></div>
      <div className="project-detail__lightboxStage"><img key={ids[index]} style={{ width: zoom === 1 ? undefined : `${zoom * 100}%`, maxWidth: zoom === 1 ? '100%' : 'none', maxHeight: zoom === 1 ? '100%' : 'none' }} src={mediaUrl(ids[index])} alt={`${name}展示图 ${index + 1}`} /></div>{controls}
    </dialog>}
  </div>
}
