import { useEffect, useRef, useState, type ReactNode } from 'react'
import { avatarFor, mediaUrl, relativeTime, type ApiPostDetail, type ApiCommentNode } from '../api/client'
import { getSession } from '../api/session'
import { feedBrowse } from '../data/feedBrowse'
import { goBack, navigate } from '../router'
import { IconBack, IconClose, IconComment, IconEdit, IconHeart, IconLocation } from './icons'
import { PhotoViewer } from './PhotoViewer'
import './postreader.css'

interface Props {
  post: ApiPostDetail; comments: ApiCommentNode[]; total: number; busy: boolean
  draft: string; onDraft: (value: string) => void; notice: string; offline: boolean
  onLike: () => void; onFavorite: () => void; onSend: () => void
  onDeleteComment: (id: string) => void; onMore: () => void; onShare: () => void
  onStep: (direction: number) => void
}

function Bookmark({ filled }: { filled: boolean }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 3.5h12v17l-6-4-6 4z" strokeLinejoin="round" /></svg>
}

/** Focus-contained sheet. Background is inert while it is open. */
function Sheet({ title, children, onClose, focusInput = false }: { title: string; children: ReactNode; onClose: () => void; focusInput?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const start = useRef(0)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const content = document.querySelector('.reader__base')
    content?.setAttribute('inert', '')
    const target = focusInput ? ref.current?.querySelector<HTMLElement>('textarea') : ref.current?.querySelector<HTMLElement>('button')
    target?.focus()
    return () => { content?.removeAttribute('inert'); previous?.focus() }
  }, [focusInput])
  useEffect(() => {
    const viewport = window.visualViewport
    const update = () => {
      const root = document.querySelector('.reader')?.getBoundingClientRect()
      setKeyboardInset(root && viewport ? Math.max(0, root.bottom - viewport.height - viewport.offsetTop) : 0)
    }
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    update()
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update) }
  }, [])
  return <div className="reader__scrim" style={{ bottom: keyboardInset }} onClick={onClose}>
    <section className="reader__sheet" ref={ref} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key !== 'Tab') return
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),textarea,a[href]') ?? [])
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }}>
      <div className="reader__handle" onTouchStart={e => { start.current = e.touches[0].clientY }} onTouchEnd={e => { if (e.changedTouches[0].clientY - start.current > 60) onClose() }}><span /></div>
      <header className="reader__sheetHead"><h2>{title}</h2><button onClick={onClose} aria-label="关闭面板"><IconClose size={22} /></button></header>
      {children}
    </section>
  </div>
}

export function PostReader(p: Props) {
  const { post } = p
  const images = post.images ?? []
  const [index, setIndex] = useState(() => Math.min(feedBrowse.images[post.id] ?? 0, Math.max(0, images.length - 1)))
  const [sheet, setSheet] = useState<'comments' | 'body' | 'more' | null>(null)
  const [preview, setPreview] = useState(false)
  const [focusInput, setFocusInput] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [hint, setHint] = useState('')

  const gesture = useRef<{ x: number; y: number; time: number; axis: 'x' | 'y' | null } | null>(null)
  const moved = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const wasBusy = useRef(false)
  const list = useRef<HTMLDivElement>(null)
  const sourceIndex = feedBrowse.ids.indexOf(post.id)
  const chars = Array.from(p.draft.trim()).length
  const me = getSession()?.user
  const image = images[index]
  const close = () => { setSheet(null); setDeleteId(null); input.current?.blur() }
  const openComments = (focus: boolean) => { setFocusInput(focus); setSheet('comments') }
  const changeImage = (next: number) => { if (next >= 0 && next < images.length) { setIndex(next); feedBrowse.images[post.id] = next } }
  const step = (direction: number) => {
    if (sourceIndex < 0 || !feedBrowse.ids[sourceIndex + direction]) { setHint(direction > 0 ? '已经到底啦' : '已经是第一条了'); return }
    feedBrowse.switched = true
    p.onStep(direction)
  }
  const overlayOpen = Boolean(sheet || preview)
  useEffect(() => {
    if (!overlayOpen) return
    const token = crypto.randomUUID()
    window.history.pushState({ readerOverlay: token }, '', window.location.href)
    const back = () => { setSheet(null); setPreview(false); setDeleteId(null) }
    window.addEventListener('popstate', back)
    return () => {
      window.removeEventListener('popstate', back)
      if (window.history.state?.readerOverlay === token) window.history.back()
    }
  }, [overlayOpen])
  useEffect(() => { feedBrowse.images[post.id] = index }, [post.id, index])
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sheet) { e.preventDefault(); close(); return }
      if (sheet || preview || (e.target as HTMLElement).matches('input,textarea')) return
      if (e.key === 'ArrowLeft') changeImage(index - 1)
      if (e.key === 'ArrowRight') changeImage(index + 1)
      if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
      if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  })
  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => setHint(''), 2200)
    return () => clearTimeout(timer)
  }, [hint])
  useEffect(() => {
    if (wasBusy.current && !p.busy && sheet === 'comments') input.current?.focus()
    wasBusy.current = p.busy
  }, [p.busy, sheet])
  useEffect(() => { if (!p.draft && list.current) list.current.scrollTop = 0 }, [p.draft])

  return <div className="reader" data-feed-id={post.id}>
    <div className="reader__base">
      <header className="reader__header">
        <button onClick={() => goBack('campus')} aria-label="返回"><IconBack size={26} /></button>
        <img src={avatarFor(post.author)} className="reader__avatar" alt="" />
        <span className="reader__author">{post.author}</span>
        <button onClick={() => setSheet('more')} aria-label="更多操作"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="4" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="20" cy="12" r="1.8"/></svg></button>
      </header>
      {p.offline && <p className="reader__offline">当前离线 · 显示上次加载的内容</p>}
      <main className="reader__content" key={post.id} onTouchStart={e => {
        if (e.touches.length !== 1 || (e.target as HTMLElement).closest('button,a')) { gesture.current = null; return }
        const t = e.touches[0]; gesture.current = { x: t.clientX, y: t.clientY, time: Date.now(), axis: null }; moved.current = false
      }} onTouchMove={e => {
        const g = gesture.current; if (!g || e.touches.length !== 1) return
        const x = Math.abs(e.touches[0].clientX - g.x), y = Math.abs(e.touches[0].clientY - g.y)
        if (Math.max(x, y) > 12) { moved.current = true; if (!g.axis) { if (x > y * 1.3) g.axis = 'x'; else if (y > x * 1.3) g.axis = 'y' } }
      }} onTouchCancel={() => { gesture.current = null }} onTouchEnd={e => {
        const g = gesture.current; gesture.current = null; if (!g || sheet || preview) return
        const t = e.changedTouches[0], dx = t.clientX - g.x, dy = t.clientY - g.y
        if (g.axis === 'x' && Math.abs(dx) > 45 && (e.target as HTMLElement).closest('.reader__media')) changeImage(index + (dx < 0 ? 1 : -1))
        if (g.axis === 'y' && (Math.abs(dy) > e.currentTarget.clientHeight * .2 || (Math.abs(dy) > 48 && Math.abs(dy) / (Date.now() - g.time) > .5))) step(dy < 0 ? 1 : -1)
      }}>
        {image ? <div className={`reader__media ${post.imageMode === 'sticker' ? 'reader__media--sticker' : ''}`}>
          {broken === image.id ? <div className="reader__imageError"><p>图片加载失败</p><button onClick={() => { setBroken(null); setAttempt(a => a + 1) }}>重新加载</button></div> : <img key={`${image.id}:${attempt}`} src={mediaUrl(image.id)} tabIndex={0} role="button" onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreview(true) } }} alt={`${post.place ?? '校园'}的照片，第 ${index + 1} 张`} onError={() => setBroken(image.id)} onClick={() => { if (!moved.current) setPreview(true) }} />}
          {images.length > 1 && <><span className="reader__counter">{index + 1}/{images.length}</span><div className="reader__imageNav"><button aria-label="上一张图片" disabled={index === 0} onClick={() => changeImage(index - 1)}>‹</button><button aria-label="下一张图片" disabled={index === images.length - 1} onClick={() => changeImage(index + 1)}>›</button></div><div className="reader__dots" aria-hidden="true">{images.map((m, i) => <i className={i === index ? 'active' : ''} key={m.id} />)}</div></>}
          {image.height && image.width && image.height / image.width > 2.5 ? <span className="reader__swipeHint">点击查看长图</span> : sourceIndex >= 0 && sourceIndex < feedBrowse.ids.length - 1 && !feedBrowse.switched && <span className="reader__swipeHint"><span>⌃</span>上滑浏览下一条</span>}
        </div> : <div className="reader__paper"><span className="reader__eyebrow">CAMPUS MEMORIES · 校园记忆</span><p>{post.body}</p><span className="reader__paperMark">BJTU TimeMap</span><button onClick={() => setSheet('body')}>展开全文</button></div>}
        {images.length > 0 && post.body && <section className="reader__caption">
          <button className="reader__bodyOpen" onClick={() => setSheet('body')} aria-label="展开全文"><p>{post.body}</p>{post.body.length > 70 && <span>展开全文</span>}</button>
        </section>}
      </main>
      {post.place && <div className="reader__location">
        <button className="reader__place" onClick={() => post.placeId ? navigate('poidetail', { id: post.placeId }) : setHint('该地点暂不可查看')}><IconLocation size={16}/>{post.place}</button>
      </div>}
      <footer className="reader__bar">
        <button className="reader__write" onClick={() => openComments(true)}><IconEdit size={18}/><span>留下我的评论…</span></button>
        <button className={`reader__action ${post.likedByMe ? 'is-liked' : ''}`} aria-label={post.likedByMe ? '取消点赞' : '点赞'} aria-pressed={post.likedByMe} disabled={p.busy} onClick={p.onLike}><IconHeart size={24} filled={post.likedByMe}/><span>{post.likeCount}</span></button>
        <button className={`reader__action ${post.favoritedByMe ? 'is-saved' : ''}`} data-favorite-toggle data-favorited={post.favoritedByMe ? '1' : '0'} data-favorite-count={post.favoriteCount} aria-label={post.favoritedByMe ? '取消收藏' : '收藏'} aria-pressed={post.favoritedByMe} disabled={p.busy} onClick={p.onFavorite}><Bookmark filled={post.favoritedByMe}/><span>{post.favoriteCount}</span></button>
        <button className="reader__action" aria-label="评论" onClick={() => openComments(false)}><IconComment size={24}/><span>{p.total}</span></button>
      </footer>
    </div>
    {(p.notice || hint) && <p className="reader__toast" role="status">{hint || p.notice}</p>}
    {sheet && <Sheet title={sheet === 'comments' ? `评论 ${p.total}` : sheet === 'body' ? '校园记忆' : '更多操作'} onClose={close} focusInput={sheet === 'comments' && focusInput}>
      {sheet === 'comments' && <>
        <div className="reader__comments" ref={list}>
          {!p.comments.length && <p className="reader__empty">还没有评论，来留下第一条校园记忆吧</p>}
          {p.comments.flatMap(c => [c, ...c.replies]).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(c => <article className="reader__comment" key={c.id} data-comment-id={c.id}>
            <img src={avatarFor(c.author)} alt=""/><div><h3>{c.author}</h3><p>{c.body}</p><div className="reader__commentMeta"><time>{relativeTime(c.createdAt)}</time>{c.authorId && c.authorId === me?.id && <button disabled={p.busy} data-comment-delete={c.id} onClick={() => setDeleteId(c.id)}>删除</button>}</div></div>
          </article>)}
        </div>
        {deleteId && <div className="reader__deleteConfirm" role="alert"><span>删除这条评论？</span><button onClick={() => setDeleteId(null)}>取消</button><button disabled={p.busy} onClick={() => { p.onDeleteComment(deleteId); setDeleteId(null) }}>删除</button></div>}
        <form className="reader__compose" onSubmit={e => { e.preventDefault(); if (!p.busy && chars > 0 && chars <= 500) p.onSend() }}>
          <label className="reader__draft"><IconEdit size={18}/><textarea ref={input} rows={1} aria-label="写下你的评论" placeholder="写下你的评论…" value={p.draft} onChange={e => p.onDraft(e.target.value)} /></label>
          <button type="submit" disabled={p.busy || !chars || chars > 500}>{p.busy ? '发送中' : '发送'}</button>
          {chars > 450 && <p className="reader__limit" role="status">{chars}/500{chars > 500 ? '，请缩减后发送' : ''}</p>}
        </form>
      </>}
      {sheet === 'body' && <div className="reader__fullBody"><p>{post.body}</p><time>{relativeTime(post.createdAt)}{post.place ? ` · ${post.place}` : ''}</time></div>}
      {sheet === 'more' && <div className="reader__menu"><button data-feed-share onClick={() => { close(); p.onShare() }}>分享这段记忆</button><button onClick={() => { close(); p.onMore() }}>{post.authorId === me?.id ? '删除帖子' : '举报帖子'}</button></div>}
    </Sheet>}
    {preview && <PhotoViewer label="帖子图片预览" photos={images.map((m, i) => ({ key: m.id, src: mediaUrl(m.id), title: `第 ${i + 1} 张`, meta: post.place }))} index={index} onIndexChange={changeImage} onClose={() => setPreview(false)} />}
  </div>
}
