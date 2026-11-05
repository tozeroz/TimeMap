import { useFeedSourceRestore } from '../data/feedBrowse'
import { openFeed } from '../data/feedBrowse'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { failText, getMyIdentity, listMyFavorites, listPosts, logout, mediaUrl, type ApiPost } from '../api/client'
import type { SessionUser } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { Drawer } from '../components/Drawer'
import { IconChatBubble, IconEdit, IconHeart, IconImage, IconLocation, IconMenu } from '../components/icons'
import { navigate } from '../router'
import { clearLocalCaches } from '../data/store'
import './me.css'
import { MyActivitySubmissions } from './MyActivitySubmissions'

type Tab = 'posts' | 'favorites' | 'submissions'
const tabs = [{ key: 'posts', label: '我的发布' }, { key: 'favorites', label: '我的收藏' }, { key: 'submissions', label: '我的提交' }] as const
type Collection = { phase: 'loading' | 'ready' | 'error'; items: ApiPost[]; error?: string }
const initialCollection: Collection = { phase: 'loading', items: [] }
const tabKey = 'timemap.me.tab'

/** Personal memories use authoritative identity and independent private collections. */
export function MeScreen({ requestedTab = '' }: { requestedTab?: string }) {
  useFeedSourceRestore()
  const [identity, setIdentity] = useState<SessionUser | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unauth' | 'error'>('loading')
  const [identityError, setIdentityError] = useState('')
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [tab, setTab] = useState<Tab>(() => { const saved = requestedTab || sessionStorage.getItem(tabKey); return saved === 'submissions' || saved === 'favorites' ? saved : 'posts' })
  const [collections, setCollections] = useState<Record<'posts' | 'favorites', Collection>>({ posts: initialCollection, favorites: initialCollection })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [cacheMsg, setCacheMsg] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const identityEpoch = useRef(0)
  const cacheDialog = useRef<HTMLDialogElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const activeTab = useRef(tab)
  const positions = useRef<Record<Tab, number>>({ posts: 0, favorites: 0, submissions: 0 })

  useEffect(() => {
    let alive = true
    const epoch = ++identityEpoch.current
    void getMyIdentity().then(result => {
      if (!alive || epoch !== identityEpoch.current) return
      if (!result.ok) {
        setIdentity(null)
        setIdentityError(failText(result))
        setPhase(result.status === 401 ? 'unauth' : 'error')
        return
      }
      setIdentity(result.value)
      setPhase('ready')
    })
    return () => { alive = false }
  }, [revision])

  useEffect(() => {
    if (!identity) return
    let alive = true
    const load = async (which: 'posts' | 'favorites') => {
      const result = which === 'posts' ? await listPosts({ authorId: identity.id, sort: 'latest' }) : await listMyFavorites()
      if (!alive) return
      setCollections(current => ({ ...current, [which]: result.ok
        ? { phase: 'ready', items: result.value }
        : { phase: 'error', items: [], error: result.status === 401 ? '登录已过期，请重新登录' : failText(result) } }))
    }
    void load('posts'); void load('favorites')
    return () => { alive = false }
  }, [identity])

  useEffect(() => {
    const body = contentRef.current?.closest('.screen__body')
    if (!body || !identity) return
    const key = `timemap.me.scroll.${identity.id}`
    try { positions.current = JSON.parse(sessionStorage.getItem(key) || '{"posts":0,"favorites":0}') } catch { /* Invalid view metadata is disposable. */ }
    const save = () => {
      positions.current[activeTab.current] = body.scrollTop
      sessionStorage.setItem(key, JSON.stringify(positions.current))
    }
    body.addEventListener('scroll', save, { passive: true })
    return () => { body.removeEventListener('scroll', save) }
  }, [identity])

  const collection = tab === 'submissions' ? { phase: 'ready' as const, items: [] } : collections[tab]
  useLayoutEffect(() => {
    if (phase === 'ready' && collection.phase === 'ready') {
      const body = contentRef.current?.closest('.screen__body')
      if (body) body.scrollTop = positions.current[tab] || 0
    }
  }, [tab, phase, collection.phase])

  function retryCollection() {
    // Reload identity as well, so a revoked session never reuses cached private content.
    setCollections({ posts: initialCollection, favorites: initialCollection })
    setRevision(value => value + 1)
  }

  function switchTab(next: Tab) {
    if (next === tab) return
    const body = contentRef.current?.closest('.screen__body')
    if (body) positions.current[tab] = body.scrollTop
    activeTab.current = next
    sessionStorage.setItem(tabKey, next)
    setTab(next)
  }

  useEffect(() => {
    if (requestedTab === 'submissions' || requestedTab === 'favorites' || requestedTab === 'posts') switchTab(requestedTab)
  }, [requestedTab])

  async function share() {
    const url = new URL(import.meta.env.BASE_URL, window.location.href)
    url.hash = '/map'; url.search = ''
    try {
      if (navigator.share) await navigator.share({ title: 'BJTU TimeMap', text: '把校园里的每一刻，存成回忆。', url: url.href })
      else { await navigator.clipboard.writeText(url.href); setNotice('TimeMap 链接已复制') }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setNotice('分享暂时不可用，请复制浏览器中的站点地址')
    }
  }

  const displayName = identity?.displayName ?? ''
  const initial = Array.from(displayName.trim())[0] || '?'
  const menuActions = [
    { label: '我的发布', action: () => switchTab('posts') },
    { label: '我的收藏', action: () => switchTab('favorites') },
    { label: '我的提交', action: () => switchTab('submissions') },
    { label: '活动收藏', action: () => navigate('favorites') },
    { label: '清除本机缓存', action: () => { setCacheMsg(''); cacheDialog.current?.showModal() } },
    ...(identity?.role === 'admin' ? [{ label: '管理端', action: () => navigate('admin') }] : []),
    { label: loggingOut ? '正在退出…' : identity ? '退出登录' : '登录 TimeMap', action: () => {
      if (!identity) { navigate('loginselect'); return }
      if (loggingOut) return
      setLoggingOut(true)
      identityEpoch.current++
      void logout().finally(() => {
        setIdentity(null); setCollections({ posts: initialCollection, favorites: initialCollection })
        positions.current = { posts: 0, favorites: 0, submissions: 0 }
        setPhase('unauth'); setLoggingOut(false)
      })
    } },
  ]

  return <Screen className="me-page" header={<TopBar variant="plain" left={<>
    <button ref={menuButton} className="iconbtn" aria-label="菜单" onClick={() => setDrawerOpen(true)}><IconMenu size={23} /></button>
    <button className="iconbtn" aria-label="分享 TimeMap" onClick={() => void share()}><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 10 8-5M8 14l8 5"/><circle cx="5" cy="12" r="3"/><circle cx="19" cy="3.5" r="3"/><circle cx="19" cy="20.5" r="3"/></svg></button>
  </>} right={<button className="iconbtn" aria-label="消息" onClick={() => navigate('message')}><IconChatBubble size={24} /></button>} />}>
    <div ref={contentRef} className="me__content">
      <section className="me__profile" aria-label="个人资料">
        <div className={`me__avatar${phase === 'loading' ? ' is-loading' : ''}`} aria-hidden="true" data-me-avatar-placeholder>{phase === 'ready' && identity?.avatarMediaId && brokenAvatar !== identity.avatarMediaId ? <img src={mediaUrl(identity.avatarMediaId)} alt="" onError={() => setBrokenAvatar(identity.avatarMediaId ?? null)} /> : phase === 'loading' ? '' : initial}</div>
        <LeafArtwork />
        <h1 className="me__name" data-me-name>{phase === 'ready' ? displayName : phase === 'loading' ? '加载中…' : phase === 'unauth' ? '未登录' : '资料加载失败'}</h1>
        {phase === 'ready' && identity?.bio && <p className="me__bio">{identity.bio}</p>}
        <button className="me__edit" data-me-entry="edit-profile" disabled={phase === 'loading'} onClick={() => { if (phase === 'error') { setPhase('loading'); setRevision(value => value + 1) } else navigate(identity ? 'profile-edit' : 'loginselect') }}><IconEdit size={16} /><span>{identity ? '编辑资料' : phase === 'loading' ? '读取资料…' : phase === 'error' ? '重新加载' : '登录 TimeMap'}</span></button>
      </section>
      <div className="me__tabs" role="tablist" aria-label="我的校园记忆">
        {tabs.map(item => <button
          key={item.key} id={`me-tab-${item.key}`} role="tab" aria-selected={tab === item.key} aria-controls="me-memory-panel"
          tabIndex={tab === item.key ? 0 : -1} className={tab === item.key ? 'is-active' : ''}
          onClick={() => switchTab(item.key)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const index = tabs.findIndex(item => item.key === tab)
            const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].key
            switchTab(next); document.getElementById(`me-tab-${next}`)?.focus()
          }}>{item.label}</button>)}
      </div>
      <section className="me__panel" id="me-memory-panel" role="tabpanel" aria-labelledby={`me-tab-${tab}`} tabIndex={0}>
        {phase === 'unauth' ? <div className="me__state"><IconImage size={36} /><h2>校园记忆，等你续写</h2><p>登录后查看自己的发布、收藏与活动投稿。</p><button onClick={() => navigate('loginselect')}>登录 TimeMap</button></div>
          : phase === 'error' ? <div className="me__state" role="status"><h2>暂时无法读取资料</h2><p>{identityError}</p><button onClick={() => { setPhase('loading'); setRevision(value => value + 1) }}>重试</button></div>
          : tab === 'submissions' && phase === 'ready' && identity ? <MyActivitySubmissions key={identity.id} userId={identity.id} /> : <>
            {tab === 'favorites' && <button className="me__activityLink" onClick={() => navigate('favorites')}>活动收藏 <span aria-hidden="true">→</span></button>}
            {(phase === 'loading' || collection.phase === 'loading') ? <div className="me__skeleton" aria-label="正在加载校园记忆" role="status"><i /><i /><i /><i /></div>
              : collection.phase === 'error' ? <div className="me__state" role="status"><h2>记忆暂时没能加载</h2><p>{collection.error}</p><button onClick={() => void retryCollection()}>重新加载</button><button className="me__textButton" onClick={() => navigate('loginselect')}>重新登录</button></div>
              : collection.items.length ? <MemoryGrid posts={collection.items} />
              : <div className="me__state"><IconImage size={36} /><h2>{tab === 'posts' ? '还没有留下校园记忆' : '暂无可展示的收藏内容'}</h2><p>{tab === 'posts' ? '一张照片，一段心情，都是校园里的独家记忆。' : '遇见喜欢的校园故事，可以收藏在这里。'}</p><button onClick={() => navigate(tab === 'posts' ? 'publish' : 'campus')}>{tab === 'posts' ? '记录第一段回忆' : '去广场看看'}</button></div>}
          </>}
      </section>
    </div>
    {notice && <div className="me__notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
    <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} actions={menuActions} />
    <dialog ref={cacheDialog} onClose={() => menuButton.current?.focus()} className="me__dialog" aria-labelledby="me-cache-title" onClick={event => { if (event.target === event.currentTarget) cacheDialog.current?.close() }}>
      <h2 id="me-cache-title">清除本机缓存？</h2><p>会清掉本机旧动态与页面缓存，登录状态和地图视图不受影响。</p>
      {cacheMsg && <p role="status" data-cache-result>{cacheMsg}</p>}
      <div><button onClick={() => cacheDialog.current?.close()}>取消</button><button onClick={() => { const result = clearLocalCaches(); setCacheMsg(`已清除：本机旧动态 ${result.posts} 条、页面缓存 ${result.snapshots} 份`) }}>清除</button></div>
    </dialog>
  </Screen>
}

function LeafArtwork() {
  return <svg className="me__leaf" viewBox="0 0 46 64" fill="none" aria-hidden="true"><g fill="currentColor"><path d="M9 58C17 43 27 28 37 7" stroke="currentColor" strokeWidth="1.2" /><path d="M32 20Q29 8 40 2Q41 14 32 20ZM25 32Q24 20 35 18Q35 28 25 32ZM18 44Q17 33 29 31Q28 40 18 44ZM26 28Q15 25 17 13Q25 17 26 28ZM17 42Q7 39 10 28Q18 32 17 42ZM12 53Q14 43 25 44Q20 52 12 53Z" /></g></svg>
}

/** Row spans preserve source order while each visual column flows independently. */
function MemoryGrid({ posts }: { posts: ApiPost[] }) {
  const grid = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = grid.current
    if (!element) return
    const resize = () => {
      const gap = parseFloat(getComputedStyle(element).rowGap) || 10
      const nextRow = [1, 1]
      element.querySelectorAll<HTMLElement>('.memory-card').forEach((card, index) => {
        const content = card.firstElementChild as HTMLElement
        const column = index % 2
        const span = Math.ceil((content.getBoundingClientRect().height + gap) / (2 + gap))
        card.style.gridColumn = String(column + 1)
        card.style.gridRow = `${nextRow[column]} / span ${span}`
        nextRow[column]! += span
      })
    }
    const observer = new ResizeObserver(resize)
    element.querySelectorAll('.memory-card > a').forEach(card => observer.observe(card))
    observer.observe(element)
    resize()
    return () => observer.disconnect()
  }, [posts])
  return <div className="me__grid" ref={grid}>{posts.map(post => <MemoryCard key={post.id} post={post} browseIds={posts.map(item => item.id)} />)}</div>
}

function MemoryCard({ post, browseIds }: { post: ApiPost; browseIds: string[] }) {
  const [broken, setBroken] = useState(false)
  const photo = post.images?.[0]
  const sticker = post.imageMode === 'sticker'
  const date = new Date(post.createdAt)
  const year = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date())
  const validDate = !Number.isNaN(date.getTime())
  const shortDate = validDate ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ...(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(date) !== year ? { year: 'numeric' as const } : {}), month: 'long', day: 'numeric' }).format(date) : ''
  const tall = !!photo?.width && !!photo?.height && photo.height / photo.width > 1.1
  return <article className={`memory-card ${photo ? 'memory-card--photo' : 'memory-card--text'}${sticker ? ' memory-card--sticker' : ''}${tall ? ' memory-card--tall' : ''}`}>
    <a onClick={e => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) { e.preventDefault(); openFeed(post.id, browseIds) } }} href={`#/feed?id=${encodeURIComponent(post.id)}`} aria-label={`查看记忆：${post.body || post.place || '校园照片'}`}>
      {photo && <div className="memory-card__media" style={{ aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : '1 / 1' }}>
        {broken ? <span className="memory-card__broken"><IconImage size={26} />照片暂时无法显示</span> : <img src={mediaUrl(photo.id)} alt="" loading="lazy" onError={() => setBroken(true)} />}
        {!tall && post.place && <span className="memory-card__overlay"><IconLocation size={13} />{post.place}</span>}
      </div>}
      <div className="memory-card__body">
        {post.body && <p className="memory-card__title">{post.body}</p>}
        <div className="memory-card__meta">
          {(!photo || tall) && post.place && <span className="memory-card__place"><IconLocation size={13} /><span>{post.place}</span></span>}
          {photo ? <span className="memory-card__likes"><IconHeart size={17} filled={post.likedByMe} /><span>{post.likeCount ?? 0}</span></span> : <time dateTime={validDate ? post.createdAt : undefined}>{shortDate}</time>}
        </div>
      </div>
    </a>
  </article>
}
