import { useEffect, useRef, useState } from 'react'
import { failText, getActivitySubmission, listActivitySubmissions, fetchMediaBlobUrl, type ActivitySubmission, type SubmissionStatus } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChevronRight, IconImage, IconLocation } from '../components/icons'
import { navigate } from '../router'
import './activitysubmissions.css'

const labels = { pending: '待审核', approved: '已通过', rejected: '未通过' }
function submissionDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间待确认'
  const fmt = (d: Date) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(d)
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ...(fmt(date) !== fmt(new Date()) ? { year: 'numeric' as const } : {}), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}
export function SubmissionCover({ id }: { id: string | null }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    let blobUrl = ''
    if (id) void fetchMediaBlobUrl(id).then(result => {
      if (!result.ok) return
      blobUrl = result.value
      if (alive) setUrl(blobUrl)
      else URL.revokeObjectURL(blobUrl)
    })
    return () => { alive = false; if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [id])
  return <div className="submission__cover">{url ? <img src={url} alt="活动封面" loading="lazy" onError={() => setUrl('')} /> : <IconImage size={28} />}</div>
}
function PublicAction({ item }: { item: ActivitySubmission }) {
  return item.publishedActivityId && item.publicationStatus === 'public' ? <button onClick={() => navigate('activity', { id: item.publishedActivityId! })}>查看活动 <IconChevronRight size={16} /></button> : <span className="submission__muted">{item.publicationStatus === 'cancelled' ? '活动已取消' : '公开活动暂不可访问'}</span>
}
export function MyActivitySubmissions({ userId }: { userId: string }) {
  const [filter, setFilter] = useState<SubmissionStatus | ''>('')
  const [items, setItems] = useState<ActivitySubmission[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const epoch = useRef(0)
  useEffect(() => {
    const current = ++epoch.current
    setLoading(true); setError(''); setItems([]); setCursor(null)
    void listActivitySubmissions(filter || undefined).then(result => {
      if (current !== epoch.current) return
      setLoading(false)
      if (result.ok) { setItems(result.value.items); setCursor(result.value.nextCursor || null) }
      else setError(result.status === 404 ? '投稿列表尚未接通，请稍后重试。' : failText(result))
    })
    return () => { epoch.current = current + 1 }
  }, [filter, revision, userId])
  async function more() {
    const current = epoch.current
    setLoading(true); setError('')
    const result = await listActivitySubmissions(filter || undefined, cursor || undefined)
    if (current !== epoch.current) return
    setLoading(false)
    if (!result.ok) { setError(failText(result)); return }
    setItems(old => [...old, ...result.value.items.filter(item => !old.some(existing => existing.id === item.id))]); setCursor(result.value.nextCursor || null)
  }
  return <div className="submissions">
    <div className="submissions__filters" aria-label="审核状态">{(['', 'pending', 'approved', 'rejected'] as const).map(status => <button key={status} aria-pressed={filter === status} onClick={() => setFilter(status)}><span>{status ? labels[status] : '全部'}</span></button>)}</div>
    <div aria-live="polite" aria-busy={loading}>
      {items.map(item => <article className={`submission is-${item.status}`} key={item.id}>
        <SubmissionCover key={item.coverImageId} id={item.coverImageId} />
        <div className="submission__body"><div className="submission__heading"><h2>{item.title}</h2><span className={`submission__badge is-${item.status}`}>{labels[item.status]}</span></div>
          <p className="submission__meta"><IconLocation size={15} /><span>{item.placeName} · {submissionDate(item.startsAt)}</span></p>
          {item.status === 'pending' && <p className="submission__muted">提交于 {submissionDate(item.submittedAt)}<br />等待管理员审核</p>}
          {item.status === 'approved' && <p className="submission__muted">审核通过{item.publicationStatus === 'public' ? ' · 已公开展示' : ''}</p>}
          {item.status === 'rejected' && <p className="submission__reason">审核原因：{item.reviewReason || '请查看提交详情或联系管理员。'}</p>}
          <div className="submission__actions">{item.status === 'approved' && item.publicationStatus === 'public' ? <PublicAction item={item} /> : <button onClick={() => navigate('activity-submission', { id: item.id })}>查看提交 <IconChevronRight size={16} /></button>}
            {item.status === 'rejected' && <button className="submission__resubmit" onClick={() => navigate('activity-submit', { submissionId: item.id })}>修改后重提</button>}
          </div>
        </div>
      </article>)}
      {loading && <div className="submissions__loading" role="status"><i /><i /><span>正在加载提交…</span></div>}
      {error && <div className="me__state" role="status"><h2>暂时无法读取提交</h2><p>{error}</p><button onClick={() => cursor && items.length ? void more() : setRevision(n => n + 1)}>重新加载</button></div>}
      {!loading && !error && !items.length && <div className="me__state"><IconImage size={36} /><h2>{filter ? `暂无${labels[filter]}的提交` : '还没有提交过校园活动'}</h2><p>把校园里的精彩，分享给更多同学。</p><button onClick={() => navigate('activity-submit')}>去提交活动</button></div>}
      {cursor && !loading && !error && <button className="submissions__more" onClick={() => void more()}>加载更多</button>}
      {!!items.length && !loading && <button className="submissions__more" onClick={() => setRevision(n => n + 1)}>刷新审核状态</button>}
    </div>
  </div>
}
export function ActivitySubmissionDetail({ id }: { id: string }) {
  const [item, setItem] = useState<ActivitySubmission | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let alive = true
    setItem(null); setError('')
    if (!id) { setError('未指定投稿'); return }
    void getActivitySubmission(id).then(result => { if (alive) { if (result.ok) setItem(result.value); else setError(failText(result)) } })
    return () => { alive = false }
  }, [id, revision])
  return <Screen className="submission-detail" header={<TopBar variant="plain" left={<button className="iconbtn" aria-label="返回我的提交" onClick={() => navigate('me', { tab: 'submissions' })}><IconBack /></button>} center="提交详情" />}>
    {error ? <div className="me__state" role="status"><p>{error}</p><button onClick={() => setRevision(n => n + 1)}>重试</button></div> : !item ? <p role="status">正在加载提交…</p> : <article>
      <SubmissionCover id={item.coverImageId} /><span className={`submission__badge is-${item.status}`}>{labels[item.status]}</span><h1>{item.title}</h1>
      <p>{item.placeName} · {submissionDate(item.startsAt)}</p>{item.endsAt && <p>结束于 {submissionDate(item.endsAt)}</p>}
      {item.reviewReason && <p className="submission__reason">审核原因：{item.reviewReason}</p>}
      <p className="submission-detail__description">{item.description || '暂无活动简介'}</p>
      <dl>{[['主办方', item.organizer], ['信息来源', item.source], ['活动类型', item.activityType], ['提交时间', submissionDate(item.submittedAt)], ['当前版本', String(item.revision)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '未填写'}</dd></div>)}</dl>
      {/^https?:\/\//i.test(item.externalLink) && <a href={item.externalLink} target="_blank" rel="noopener noreferrer">原文 / 报名链接 ↗</a>}
      {item.history?.length ? <section><h2>审核历史</h2>{item.history.map(history => <p key={history.revision}>版本 {history.revision} · {labels[history.decision]} · {submissionDate(history.reviewedAt)}<br />{history.reason}</p>)}</section> : null}
      <div className="submission__actions">{item.status === 'rejected' && <button className="submission__resubmit" onClick={() => navigate('activity-submit', { submissionId: item.id })}>修改后重提</button>}{item.status === 'approved' && <PublicAction item={item} />}</div>
    </article>}
  </Screen>
}
