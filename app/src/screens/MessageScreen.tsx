import { useForegroundPoll } from '../data/useForegroundPoll'
import { getSession } from '../api/session'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconClose, IconChevronRight } from '../components/icons'
import { getThreads, mediaUrl, type ApiThread } from '../api/client'
import { getInbox, markInboxRead, type Inbox, type InboxCategory } from '../api/inbox'
import { goBack, navigate } from '../router'
import './message.css'

const categories: { key: InboxCategory; label: string }[] = [
  { key: 'likes', label: '点赞' }, { key: 'favorites', label: '收藏' }, { key: 'comments', label: '评论和@' },
]
export function InboxIcon({ name }: { name: InboxCategory | 'announcements' | 'read' }) {
  return <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    {name === 'likes' && <path fill="currentColor" d="M16 28S3 20 3 11a7 7 0 0 1 13-3 7 7 0 0 1 13 3c0 9-13 17-13 17Z" />}
    {name === 'favorites' && <path fill="currentColor" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" d="m16 3 4 8 9 1-6.5 6.5L24 28l-8-4.5L8 28l1.5-9.5L3 12l9-1Z" />}
    {name === 'comments' && <><path fill="currentColor" d="M29 14c0 7-6 12-13 12-2 0-4-.3-6-1l-7 3 2-7a11 11 0 0 1-2-7C3 7 9 2 16 2s13 5 13 12Z" /><g fill="var(--inbox-blue)"><circle cx="9" cy="14" r="1.5"/><circle cx="16" cy="14" r="1.5"/><circle cx="23" cy="14" r="1.5"/></g></>}
    {name === 'announcements' && <><path fill="currentColor" d="m5 12 15-8v24L5 20Zm-3 0h4v8H2Zm5 8h5l2 9H9Z"/><path stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" d="m25 9 4-3m-4 10h5m-5 7 4 3"/></>}
    {name === 'read' && <><circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2.4"/><path d="m9 16 5 5 9-10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></>}
  </svg>
}
export function inboxTime(value: string) {
  const date = new Date(value), now = new Date()
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  return date.toDateString() === yesterday.toDateString() ? '昨天' : `${date.getMonth() + 1}月${date.getDate()}日`
}
function Badge({ count }: { count: number }) {
  return count > 0 ? <span className="inbox__badge" aria-label={`${count}条未读`}>{count > 99 ? '99+' : count}</span> : null
}
function Avatar({ name, mediaId }: { name: string; mediaId?: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [mediaId])
  const tone = Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4
  return <span className={`inbox__avatar inbox__avatar--${tone}`} aria-hidden="true">
    {mediaId && !failed ? <img src={mediaUrl(mediaId)} alt="" onError={() => setFailed(true)} /> : name.slice(0, 1)}
  </span>
}
export function MessageScreen({ category }: { category?: string }) {
  const active = categories.find(c => c.key === category)
  const announcements = category === 'announcements'
  const [inbox, setInbox] = useState<Inbox | null>(null)
  const [threads, setThreads] = useState<ApiThread[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'unauth'>('loading')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [threadCursor,setThreadCursor]=useState<string|null>(null)
  const [moreBusy,setMoreBusy]=useState(false)
  const threadsRef=useRef<ApiThread[]>([])
  const token=useRef(getSession()?.token)
  const [opened, setOpened] = useState<string | null>(null)
  const loadedPages=useRef(1)
  const loading=useRef(false)
  const mounted = useRef(false), generation = useRef(0)
  const load = useCallback(async (quiet=false) => {
    if(loading.current)return true
    loading.current=true
    try {
    const current = ++generation.current
    if(!quiet)setPhase('loading')
    const [notifications, firstPage] = await Promise.all([getInbox(), getThreads(undefined,'direct')])
    let conversations=firstPage
    if(firstPage.ok && quiet){
      const accumulated=[...firstPage.value.items]
      let cursor=firstPage.value.nextCursor
      for(let page=1;page<loadedPages.current && cursor;page++){
        const next=await getThreads(cursor,'direct')
        if(!next.ok){conversations=next;break}
        accumulated.push(...next.value.items);cursor=next.value.nextCursor
      }
      if(conversations.ok)conversations={ok:true,value:{items:accumulated,nextCursor:cursor}}
    }
    if (!mounted.current || current !== generation.current || getSession()?.token!==token.current) return false
    if (!notifications.ok || !conversations.ok) {
      const failed = !notifications.ok ? notifications : !conversations.ok ? conversations : null
      if(!quiet)setPhase(failed?.status === 401 ? 'unauth' : 'error'); return false
    }
    setInbox(notifications.value)
    const fresh=conversations.value.items.filter(t=>t.kind==='direct')
    const merged=[...new Map(fresh.map(thread=>[thread.id,thread])).values()]
    threadsRef.current=merged;setThreads(merged)
    setThreadCursor(conversations.value.nextCursor??null)
    if(!quiet)loadedPages.current=1
    setPhase('ready')
    return true
    } finally {loading.current=false}
  }, [])
  useEffect(() => {
    mounted.current = true; void load()
    return () => { mounted.current = false; generation.current++ }
  }, [load])
  useForegroundPoll(()=>load(true),10000,phase==='ready')
  async function moreThreads() {
    if(!threadCursor||moreBusy||loading.current)return
    loading.current=true
    setMoreBusy(true);setNotice('')
    try {
      const result=await getThreads(threadCursor,'direct')
      if(!mounted.current||getSession()?.token!==token.current)return
      if(!result.ok){setNotice('更多会话加载失败，请重试');return}
      const merged=[...threadsRef.current,...result.value.items.filter(t=>t.kind==='direct'&&!threadsRef.current.some(old=>old.id===t.id))]
      threadsRef.current=merged;setThreads(merged);setThreadCursor(result.value.nextCursor??null);loadedPages.current++
    } finally {loading.current=false;if(mounted.current)setMoreBusy(false)}
  }
  async function read(scope: string) {
    if (!inbox || busy) return
    setBusy(true); setNotice('')
    const result = await markInboxRead(scope, inbox.through)
    if (mounted.current) {
      setBusy(false)
      if (result.ok) { setNotice('已标记为已读'); await load() }
      else setNotice('标记已读失败，请重试')
    }
  }
  const latest = inbox?.announcements[0], detail = inbox?.announcements.find(a => a.id === opened)
  const title = active?.label || (announcements ? '应用公告' : '消息')
  return <Screen className="inbox" header={<TopBar
    left={<button className="inbox__control" aria-label={category ? '返回消息' : '关闭'} onClick={() => category ? navigate('message') : goBack('campus')}>{category ? <IconBack size={24}/> : <IconClose size={24}/>}</button>}
    center={title}
    right={<button className="inbox__control" aria-label={category ? '标记本类已读' : '全部标记已读'} title="标记已读" disabled={!inbox || busy || phase !== 'ready'} onClick={() => void read(category || 'all')}><InboxIcon name="read"/></button>}
  />}>
    {!category && <>
      <nav className="inbox__shortcuts" aria-label="互动消息">{categories.map(c => <button className="inbox__shortcut" key={c.key} onClick={() => navigate('message', { category: c.key })}>
        <span className={`inbox__tile inbox__tile--${c.key}`}><InboxIcon name={c.key}/><Badge count={phase === 'ready' ? inbox?.counts[c.key] || 0 : 0}/></span><span>{c.label}</span>
      </button>)}</nav>
      <button className="inbox__announcement" onClick={() => navigate('message', { category: 'announcements' })}>
        <span className="inbox__announcementIcon"><InboxIcon name="announcements"/></span>
        <span className="inbox__main"><strong>应用公告</strong><span>{phase === 'loading' ? '加载中…' : phase === 'error' ? '暂时无法加载公告' : phase === 'unauth' ? '登录后查看公告' : latest?.title || '暂无应用公告'}</span></span>
        <span className="inbox__meta">{latest && phase === 'ready' && <time>{inboxTime(latest.createdAt)}</time>}{phase === 'ready' && inbox?.announcements.some(a => a.unread) && <span className="inbox__dot" aria-label="有未读公告"/>}<IconChevronRight size={16}/></span>
      </button><h2 className="inbox__heading">私信</h2>
    </>}
    {notice && <p className="inbox__notice" role="status">{notice}</p>}
    {phase !== 'ready' ? <div className="inbox__state" role="status"><p>{phase === 'loading' ? '加载中…' : phase === 'unauth' ? '登录后查看消息' : '消息加载失败，请稍后重试'}</p>
      {phase !== 'loading' && <button onClick={() => phase === 'unauth' ? navigate('loginselect') : void load()}>{phase === 'unauth' ? '去登录' : '重试'}</button>}
    </div> : !category ? <section className="inbox__conversations" data-list="threads">
      {!threads.length && <p className="inbox__state" data-state="empty">还没有私聊会话</p>}
      {threads.map(t => {
        const name = t.peerName?.trim() || t.title?.trim() || '未命名会话', meta = inbox?.threads.find(item => item.id === t.id), last = t.lastMessage
        return <button key={t.id} className="inbox__conversation" data-thread-id={t.id} data-thread-kind={t.kind} onClick={() => navigate('chat', { id: t.id })}>
          <Avatar name={name} mediaId={t.peerAvatarMediaId ?? meta?.avatarMediaId}/><span className="inbox__main"><strong>{name}</strong><span>{!last ? '暂无消息' : last.kind === 'image' ? '[图片]' : last.kind === 'voice' ? '[语音]' : last.body}</span></span>
          <span className="inbox__conversationMeta"><time>{last?.createdAt ? inboxTime(last.createdAt) : ''}</time><Badge count={t.unreadCount ?? meta?.unreadCount ?? 0}/></span>
        </button>
      })}
      {threadCursor && <button className="inbox__textButton" disabled={moreBusy} onClick={()=>void moreThreads()}>{moreBusy?'加载中…':'加载更多会话'}</button>}
    </section> : announcements ? <section className="inbox__feed">
      {detail ? <article className="inbox__article"><button className="inbox__textButton" onClick={() => setOpened(null)}>返回公告列表</button><h2>{detail.title}</h2><time>{new Date(detail.createdAt).toLocaleString('zh-CN')}</time><p>{detail.body}</p></article>
        : !inbox?.announcements.length ? <p className="inbox__state">暂无应用公告</p> : inbox.announcements.map(a => <button className="inbox__event" key={a.id} onClick={() => setOpened(a.id)}>
          <span className="inbox__main"><strong>{a.title}</strong><span>{a.body}</span><time>{inboxTime(a.createdAt)}</time></span>{a.unread && <span className="inbox__dot" aria-label="未读"/>}<IconChevronRight size={16}/>
        </button>)}
    </section> : <section className="inbox__feed">
      {!inbox?.items.some(e => e.category === category) && <p className="inbox__state">暂无{active?.label}消息</p>}
      {inbox?.items.filter(e => e.category === category).map(e => <button className="inbox__event" key={e.id} onClick={() => e.threadId ? navigate(e.threadKind === 'group' ? 'group' : 'chat', { id: e.threadId }) : e.postId && navigate('feed', { id: e.postId })}>
        <Avatar name={e.actor} mediaId={e.avatarMediaId}/><span className="inbox__main"><strong>{e.actor}</strong><span>{e.action}</span><span>{e.preview}</span><time>{inboxTime(e.createdAt)}</time></span>{e.unread && <span className="inbox__dot" aria-label="未读"/>}
      </button>)}
      {inbox && inbox.items.filter(e => e.category === category).length >= 100 && <p className="inbox__notice">显示最近 100 条互动</p>}
    </section>}
  </Screen>
}
