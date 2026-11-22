import { useEffect, useState } from 'react'
import { getInbox, publishAnnouncement, type AppAnnouncement } from '../api/inbox'
import { failText } from '../api/client'

export function AdminAnnouncementsPanel() {
  const [title, setTitle] = useState(''), [body, setBody] = useState('')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [items, setItems] = useState<AppAnnouncement[]>([])
  const [phase, setPhase] = useState('loading')
  async function load() {
    setPhase('loading')
    const r = await getInbox()
    if (r.ok) { setItems(r.value.announcements); setPhase('ready') }
    else { setPhase('error'); setNotice(`公告加载失败：${failText(r)}`) }
  }
  useEffect(() => { void load() }, [])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !title.trim() || !body.trim()) return
    setBusy(true); setNotice('')
    const r = await publishAnnouncement(title.trim(), body.trim())
    setBusy(false)
    if (r.ok) { setTitle(''); setBody(''); setNotice('公告已发布'); await load() }
    else setNotice(`发布失败：${failText(r)}`)
  }
  return <section className="adm__pane">
    <form className="adm__card" onSubmit={event => void submit(event)}>
      <h2 className="adm__cardHead">发布应用公告</h2>
      <p className="adm__cardMeta">发布后，所有登录用户可在消息页查看。</p>
      <label>公告标题<input className="adm__input" value={title} maxLength={80} required disabled={busy} onChange={e => setTitle(e.target.value)} placeholder="请输入公告标题（最多80字）" /></label>
      <label>公告正文<textarea className="adm__textarea" value={body} maxLength={5000} required disabled={busy} onChange={e => setBody(e.target.value)} placeholder="请输入公告内容（最多5000字）" /></label>
      <button className="adm__btn adm__btn--primary" type="submit" disabled={busy || !title.trim() || !body.trim()}>{busy ? '发布中…' : '发布公告'}</button>
    </form>
    {notice && <p className="adm__state" role="status">{notice}</p>}
    <div className="adm__row"><h3>已发布公告</h3><button className="adm__btn" onClick={() => void load()}>刷新</button></div>
    {phase === 'loading' && <p className="adm__state">加载中…</p>}
    {phase === 'error' && <button className="adm__btn" onClick={() => void load()}>重试</button>}
    {phase === 'ready' && !items.length && <p className="adm__state">暂无应用公告</p>}
    {phase === 'ready' && items.map(item => <article className="adm__card" key={item.id}><h3>{item.title}</h3><time className="adm__time">{new Date(item.createdAt).toLocaleString('zh-CN')}</time><p className="adm__cardBody" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.body}</p></article>)}
  </section>
}
