import { useEffect, useRef, useState, type ReactNode } from 'react'
import { failText, getActivitySubmission, listPlaces, submitActivity, uploadMedia, type ActivitySubmission, type ActivitySubmissionFields, type ApiPlaceListItem } from '../api/client'
import { getSession } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconCalendar, IconChevronRight, IconImage, IconLocation } from '../components/icons'
import { goBack, navigate, registerNavigationGuard } from '../router'
import { SubmissionCover } from './MyActivitySubmissions'
import './activitysubmit.css'

const empty = { title: '', placeId: '', startsAt: '', endsAt: '', description: '', organizer: '', source: '', externalLink: '', activityType: '', coverImageId: null as string | null }
type Draft = typeof empty
const count = (text: string) => Array.from(text).length
const localTime = (iso: string | null) => iso ? new Date(new Date(iso).getTime() + 8 * 3600000).toISOString().slice(0, 16) : ''
function NoteIcon({ clock = false }: { clock?: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" />{clock ? <path d="M12 6v6l4 2" /> : <path d="M12 10v7m0-11v1" />}</svg> }
function LinkIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 15 6-6m-5-3 2-2a5 5 0 0 1 7 7l-3 3m-2 4-2 2a5 5 0 0 1-7-7l3-3" /></svg> }
function Group({ number, title, children }: { number: string; title: string; children: ReactNode }) { return <section className="activity-submit__group"><h2><span>{number}</span>{title}{number === '01' && <small><em>必填</em> 3 项</small>}</h2>{children}</section> }
export function ActivitySubmitScreen({ submissionId = '' }: { submissionId?: string }) {
  const user = getSession()?.user
  const [draft, setDraft] = useState<Draft>(empty)
  const [baseline, setBaseline] = useState(JSON.stringify(empty))
  const [original, setOriginal] = useState<ActivitySubmission | null>(null)
  const [loading, setLoading] = useState(!!submissionId)
  const [places, setPlaces] = useState<ApiPlaceListItem[]>([])
  const [placeState, setPlaceState] = useState('loading')
  const [retry, setRetry] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const busyRef = useRef(false)
  const leaveAllowed = useRef(false)
  const uploadEpoch = useRef(0)
  const requestKey = useRef({ body: '', id: '' })
  const input = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const dirty = JSON.stringify(draft) !== baseline || !!file
  const key = `timemap.activity-draft.${user?.id || 'anonymous'}.${submissionId || 'new'}`
  useEffect(() => {
    let alive = true
    setPlaceState('loading')
    void listPlaces().then(result => { if (alive) { setPlaceState(result.ok ? 'ready' : 'error'); if (result.ok) setPlaces(result.value.filter(place => place.enabled)) } })
    return () => { alive = false }
  }, [retry])
  useEffect(() => {
    let alive = true
    if (!user?.id) return
    if (submissionId) {
      setLoading(true); setError('')
      void getActivitySubmission(submissionId).then(result => {
        if (!alive) return
        setLoading(false)
        if (!result.ok) { setError(failText(result)); return }
        if (result.value.status !== 'rejected') { setError('只有未通过的投稿可以修改重提。'); return }
        setOriginal(result.value)
        const value: Draft = { ...Object.fromEntries(Object.keys(empty).map(field => [field, result.value[field as keyof Draft]])) as Draft, startsAt: localTime(result.value.startsAt), endsAt: localTime(result.value.endsAt) }
        setBaseline(JSON.stringify(value)); setDraft(value)
        try { const saved = sessionStorage.getItem(key); if (saved) setDraft(JSON.parse(saved)) } catch { /* Discard malformed draft. */ }
      })
    } else {
      try { const saved = sessionStorage.getItem(key); if (saved) setDraft(JSON.parse(saved)) } catch { /* Discard malformed draft. */ }
    }
    return () => { alive = false }
  }, [submissionId, user, key, retry])
  useEffect(() => { if (user && !loading && dirty) { try { sessionStorage.setItem(key, JSON.stringify(draft)) } catch { /* Form stays available in memory. */ } } }, [draft, dirty, loading, key, user])
  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  useEffect(() => {
    const currentHash = window.location.hash
    const remove = registerNavigationGuard(target => {
      if (target === currentHash || leaveAllowed.current) return true
      if (busyRef.current || (dirty && !window.confirm('活动内容尚未提交，确定离开吗？已填写文字将保存在本次会话中。'))) { window.history.replaceState(null, '', currentHash); return false }
      return true
    })
    const unload = (event: BeforeUnloadEvent) => { if (!leaveAllowed.current && (dirty || busyRef.current)) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { remove(); window.removeEventListener('beforeunload', unload) }
  }, [dirty])
  useEffect(() => () => { uploadEpoch.current++ }, [])
  function change<K extends keyof Draft>(field: K, value: Draft[K]) { setDraft(old => ({ ...old, [field]: value })); setErrors(old => ({ ...old, [field]: '' })) }
  function login() { sessionStorage.setItem('timemap.login.return', JSON.stringify({ path: 'activity-submit', query: submissionId ? { submissionId } : {} })); leaveAllowed.current = true; navigate('loginselect') }
  async function upload(selected: File) {
    const epoch = ++uploadEpoch.current
    setUploadError(''); setFile(selected); change('coverImageId', null)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || selected.size > 10 * 1024 * 1024) { setUploadError('请选择 10 MB 以内的 JPG、PNG 或 WebP 图片。'); return }
    setUploading(true)
    // Dedicated private purpose; the backend must support this before upload succeeds.
    const result = await uploadMedia(selected, 'activity-submission')
    if (epoch !== uploadEpoch.current) return
    setUploading(false)
    if (result.ok) change('coverImageId', result.value.id)
    else setUploadError('海报上传失败，请重试或移除后继续。' + failText(result))
  }
  async function submit() {
    if (busyRef.current) return
    const invalid: Record<string, string> = {}
    if (!draft.title.trim() || count(draft.title.trim()) > 60) invalid.title = '请填写 1–60 字的活动名称'
    if (!places.some(place => place.id === draft.placeId)) invalid.placeId = '请选择已启用的校园地点'
    const start = new Date(`${draft.startsAt}:00+08:00`)
    const end = draft.endsAt ? new Date(`${draft.endsAt}:00+08:00`) : null
    if (!draft.startsAt || !Number.isFinite(start.getTime())) invalid.startsAt = '请选择有效的开始时间'
    if (end && (!Number.isFinite(end.getTime()) || end <= start)) invalid.endsAt = '结束时间须晚于开始时间'
    if (count(draft.description) > 300) invalid.description = '活动简介最多 300 字'
    if (draft.externalLink.trim()) { try { if (!['http:', 'https:'].includes(new URL(draft.externalLink.trim()).protocol)) throw Error() } catch { invalid.externalLink = '请输入有效的 HTTP 或 HTTPS 链接' } }
    if (file && !draft.coverImageId) invalid.coverImageId = '请等待海报上传成功，或移除后再提交'
    setErrors(invalid)
    if (Object.keys(invalid).length) { form.current?.querySelector<HTMLElement>(`#activity-${Object.keys(invalid)[0]}`)?.focus(); return }
    if (!getSession()) { setError('登录已过期，填写内容已保留，请重新登录。'); return }
    const fields: ActivitySubmissionFields = { ...draft, title: draft.title.trim(), startsAt: start.toISOString(), endsAt: end?.toISOString() || null, organizer: draft.organizer.trim(), source: draft.source.trim(), externalLink: draft.externalLink.trim(), activityType: draft.activityType.trim() }
    const body = JSON.stringify(fields)
    if (body !== requestKey.current.body) requestKey.current = { body, id: crypto.randomUUID() }
    busyRef.current = true; setBusy(true); setError('')
    const result = await submitActivity(fields, requestKey.current.id, original || undefined)
    busyRef.current = false; setBusy(false)
    if (!result.ok) { setError(result.status === 404 ? '活动投稿服务尚未接通，内容已保留，请稍后重试。' : failText(result)); return }
    if (!result.value.id || result.value.status !== 'pending') { setError('提交结果未确认，请保留内容后重试。'); return }
    sessionStorage.removeItem(key); leaveAllowed.current = true; navigate('me', { tab: 'submissions' })
  }
  function row(field: keyof Draft, label: string, control: ReactNode, hint?: string, required = false, optional = false) {
    return <div className="activity-submit__row"><label htmlFor={`activity-${field}`}>{label}{required && <b aria-hidden="true"> *</b>}{optional && <span>（选填）</span>}</label><div className="activity-submit__field">{control}{hint && <p id={`hint-${field}`}>{hint}</p>}{errors[field] && <p className="activity-submit__field-error" id={`error-${field}`} role="alert">{errors[field]}</p>}</div></div>
  }
  const props = (field: keyof Draft) => ({ id: `activity-${field}`, 'aria-invalid': !!errors[field], 'aria-describedby': errors[field] ? `error-${field}` : undefined })
  return <Screen className="activity-submit" header={<TopBar variant="plain" left={<button className="iconbtn" aria-label="返回" onClick={() => goBack('activities')}><IconBack /></button>} center={original ? '修改活动' : '提交活动'} right={<button className="activity-submit__my" onClick={() => navigate('me', { tab: 'submissions' })}>我的提交</button>} />}>
    <div className="activity-submit__content"><h1>把校园里的精彩，分享出来。</h1><p className="activity-submit__notice"><NoteIcon clock />提交后由管理员审核，通过后公开展示。</p>
      {!user ? <div className="activity-submit__state"><h2>登录后提交校园活动</h2><p>分享活动，随时查看审核进度。</p><button onClick={login}>登录 TimeMap</button></div> : loading ? <p role="status">正在读取提交…</p> : submissionId && !original ? <div className="activity-submit__state" role="status"><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>重试</button></div> : <form ref={form} noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
      {original?.reviewReason && <p className="activity-submit__notice">审核原因：{original.reviewReason}</p>}
      <fieldset disabled={busy}>
      <Group number="01" title="基本信息">
        {row('title', '活动名称', <div className="activity-submit__line"><input {...props('title')} required value={draft.title} placeholder="填写活动名称" onChange={e => change('title', e.target.value)} /><span className="activity-submit__count">{count(draft.title)} / 60</span></div>, undefined, true)}
        {row('placeId', '活动地点', <div className="activity-submit__line"><IconLocation size={21} /><select {...props('placeId')} required value={draft.placeId} onChange={e => change('placeId', e.target.value)} disabled={placeState !== 'ready'}><option value="">{placeState === 'loading' ? '正在加载地点…' : placeState === 'error' ? '地点加载失败' : places.length ? '请选择校园地点' : '暂无可选地点'}</option>{draft.placeId && !places.some(p => p.id === draft.placeId) && <option value={draft.placeId}>原地点不可用，请重新选择</option>}{places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select><IconChevronRight size={16} /></div>, '请选择已启用的校园地点', true)}
        {placeState === 'error' && <button className="activity-submit__retry" type="button" onClick={() => setRetry(n => n + 1)}>重新加载地点</button>}
        {(['startsAt', 'endsAt'] as const).map(field => <div key={field}>{row(field, field === 'startsAt' ? '开始时间' : '结束时间', <div className="activity-submit__line"><IconCalendar size={21} /><input {...props(field)} type="datetime-local" required={field === 'startsAt'} value={draft[field]} onChange={e => change(field, e.target.value)} /></div>, field === 'startsAt' ? '北京时间 UTC+8' : '须晚于开始时间', field === 'startsAt', field === 'endsAt')}</div>)}
      </Group>
      <Group number="02" title="活动介绍">
        {row('description', '活动简介', <div className="activity-submit__textarea"><textarea {...props('description')} value={draft.description} placeholder="介绍活动内容，邀请同学一起参加…" rows={3} onChange={e => change('description', e.target.value)} /><span className="activity-submit__count">{count(draft.description)} / 300</span></div>)}
        {row('coverImageId', '封面图片', <><input ref={input} id="activity-coverImageId" className="activity-submit__file" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e => { const selected = e.target.files?.[0]; if (selected) void upload(selected); e.target.value = '' }} /><button className="activity-submit__upload" type="button" disabled={uploading} onClick={() => input.current?.click()}>{preview || draft.coverImageId ? <>{preview ? <img src={preview} alt="所选活动海报" /> : <SubmissionCover key={draft.coverImageId} id={draft.coverImageId} />}</> : <IconImage size={29} />}<span>{uploading ? '正在上传…' : preview || draft.coverImageId ? '更换活动海报' : '上传活动海报'}</span></button>{uploading && <progress aria-label="海报上传中" />}{(file || draft.coverImageId) && <button className="activity-submit__retry" type="button" onClick={() => { uploadEpoch.current++; setUploading(false); setFile(null); setUploadError(''); change('coverImageId', null) }}>移除海报</button>}{uploadError && <p className="activity-submit__field-error" role="alert">{uploadError}{file && <button type="button" className="activity-submit__retry" onClick={() => void upload(file)}>重试上传</button>}</p>}</>, '建议添加，方便同学了解活动。', false, true)}
      </Group>
      <Group number="03" title="补充资料">
        {(['organizer', 'source', 'externalLink', 'activityType'] as const).map(field => <div key={field}>{row(field, { organizer: '主办方', source: '信息来源', externalLink: '原文 / 报名链接', activityType: '活动类型' }[field], <div className="activity-submit__line">{field === 'externalLink' && <LinkIcon />}<input {...props(field)} type={field === 'externalLink' ? 'url' : 'text'} value={draft[field]} placeholder={{ organizer: '填写主办方', source: '填写信息来源', externalLink: '粘贴 HTTP 或 HTTPS 链接', activityType: '如：讲座、文体、展览' }[field]} onChange={e => change(field, e.target.value)} /></div>, field === 'externalLink' ? '报名通过外部链接完成。' : undefined)}</div>)}
      </Group>
      </fieldset>
      {error && <p className="activity-submit__error" role="alert">{error}<button type="button" onClick={login}>重新登录</button></p>}
      <p className="activity-submit__footnote"><NoteIcon />审核进度可在“我的提交”中查看。</p>
      <button className="activity-submit__submit" type="submit" disabled={busy || uploading}>{busy ? '提交中…' : '提交审核'}</button>
      </form>}
    </div>
  </Screen>
}
