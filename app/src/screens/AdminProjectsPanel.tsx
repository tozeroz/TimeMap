import { useCallback, useEffect, useRef, useState } from 'react'
import { adminListProjects, adminSaveProject, failText, mediaUrl, uploadMedia, type TrainingProject, type TrainingProjectFields } from '../api/client'
import { AdminDialog } from '../components/AdminPrimitives'
import { ProjectCover } from './TrainingProjectsScreen'

const blank: TrainingProjectFields = { name: '', summary: '', groupName: null, memberCount: null, projectUrl: null, experienceUrl: null, coverImageId: null, position: 0, published: false, description: null, category: null, features: [], experienceNotes: null, showcaseImageIds: [] }

export function AdminProjectsPanel() {
  const [items, setItems] = useState<TrainingProject[]>([]), [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState(''), [formError, setFormError] = useState('')
  const [form, setForm] = useState<TrainingProjectFields | null>(null), [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false)
  const alive = useRef(true), locked = useRef(false), requestVersion = useRef(0)
  const load = useCallback(async () => {
    const request = ++requestVersion.current
    setPhase('loading'); setError('')
    const r = await adminListProjects()
    if (!alive.current || request !== requestVersion.current) return
    if (r.ok) { setItems(r.value.items); setPhase('ready') }
    else { setError(failText(r)); setPhase('error') }
  }, [])
  const invalidate = useCallback(() => { alive.current = false; requestVersion.current++ }, [])
  useEffect(() => {
    alive.current = true
    let active = true
    queueMicrotask(() => { if (active) void load() })
    return () => { active = false; invalidate() }
  }, [load, invalidate])
  function edit(item?: TrainingProject) {
    setEditingId(item?.id ?? null); setFormError('')
    setForm(item ? { name: item.name, summary: item.summary, groupName: item.groupName, memberCount: item.memberCount, projectUrl: item.projectUrl, experienceUrl: item.experienceUrl, coverImageId: item.coverImageId, position: item.position, published: item.published, description: item.description ?? null, category: item.category ?? null, features: item.features ?? [], experienceNotes: item.experienceNotes ?? null, showcaseImageIds: item.showcaseImageIds ?? [] } : { ...blank })
  }
  async function upload(file?: File) {
    if (!file || locked.current) return
    locked.current = true; setUploading(true); setFormError('')
    try {
      const r = await uploadMedia(file, 'activity')
      if (!alive.current) return
      if (!r.ok) setFormError(`封面上传失败：${failText(r)}`)
      else setForm(previous => previous ? { ...previous, coverImageId: r.value.id } : previous)
    } finally { locked.current = false; if (alive.current) setUploading(false) }
  }
  async function save() {
    if (!form || locked.current) return
    locked.current = true; setBusy(true); setFormError('')
    try {
      const r = await adminSaveProject(editingId, { ...form, features: (form.features ?? []).map(value => value.trim()).filter(Boolean) })
      if (!alive.current) return
      if (!r.ok) { setFormError(failText(r)); return }
      setForm(null); await load()
    } finally { locked.current = false; if (alive.current) setBusy(false) }
  }
  async function uploadGallery(files: File[]) {
    if (!form || !files.length || locked.current) return
    if ((form.showcaseImageIds?.length ?? 0) + files.length > 8) { setFormError('详情展示图最多 8 张，请减少图片后重试'); return }
    locked.current = true; setUploading(true); setFormError('')
    const failed: string[] = []
    try {
      for (const file of files) {
        const result = await uploadMedia(file, 'activity')
        if (!alive.current) return
        if (result.ok) setForm(previous => previous ? { ...previous, showcaseImageIds: [...(previous.showcaseImageIds ?? []), result.value.id] } : previous)
        else failed.push(`${file.name}：${failText(result)}`)
      }
      if (failed.length) setFormError(`部分展示图上传失败，已成功的图片已保留。${failed.join('；')}`)
    } finally { locked.current = false; if (alive.current) setUploading(false) }
  }
  function moveImage(index: number, step: number) {
    if (!form) return
    const ids = [...(form.showcaseImageIds ?? [])], target = index + step
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setForm({ ...form, showcaseImageIds: ids })
  }
  return <section className="adm__panel admin-projects" aria-labelledby="admin-projects-title">
    <div className="projects__heading"><div><h2 id="admin-projects-title">实训项目管理</h2><p className="adm__modalDesc">统一维护本班项目，调整展示顺序及上下架状态。</p></div><button className="adm__btn adm__btn--primary" onClick={() => edit()}>新建项目</button></div>
    {phase === 'loading' && <p role="status">正在读取项目…</p>}
    {phase === 'error' && <div role="alert"><p>{error}</p><button className="adm__btn" onClick={() => void load()}>重试</button></div>}
    {phase === 'ready' && !items.length && <p className="projects__state">尚未录入项目，点击“新建项目”添加。</p>}
    {phase === 'ready' && <ul className="projects__list">{items.map(item => <li className="projects__row" key={item.id}>
      <ProjectCover key={`${item.id}-${item.coverImageId}`} project={item} />
      <div className="projects__info"><h3>{item.name}</h3><p className="projects__summary">{item.summary}</p><p className="projects__group">{item.groupName || '团队信息待补充'}{item.memberCount != null && ` · ${item.memberCount}人`} · {item.likeCount}赞</p><p className="projects__group">{item.published ? '已上架' : '未上架'} · 展示顺序 {item.position}</p><button className="adm__btn" onClick={() => edit(item)}>编辑项目</button></div>
    </li>)}</ul>}
    {form && <AdminDialog title={editingId ? '编辑实训项目' : '新建实训项目'} onClose={() => { if (!locked.current) setForm(null) }}>
      <form onSubmit={e => { e.preventDefault(); void save() }}>
        <fieldset className="admin-projects__fields" disabled={busy || uploading}>
          <label className="adm__label">项目名称<input className="adm__input" required maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="adm__label">一句话简介<textarea aria-label="一句话简介" className="adm__input" required maxLength={160} rows={2} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></label>
          <label className="adm__label">项目分类<input className="adm__input" maxLength={24} value={form.category ?? ''} onChange={e => setForm({ ...form, category: e.target.value || null })} placeholder="如校园生活、协作解谜" /></label>
          <label className="adm__label">项目介绍<textarea aria-label="项目介绍" className="adm__input" maxLength={4000} rows={5} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value || null })} placeholder="项目面向谁、解决什么问题、如何使用" /></label>
          <label className="adm__label">核心功能（每行一项，最多4项）<textarea aria-label="核心功能（每行一项，最多4项）" className="adm__input" rows={4} value={(form.features ?? []).join('\n')} onChange={e => setForm({ ...form, features: e.target.value.split('\n') })} /></label>
          <label className="adm__label">体验提示<textarea aria-label="体验提示" className="adm__input" maxLength={1000} rows={3} value={form.experienceNotes ?? ''} onChange={e => setForm({ ...form, experienceNotes: e.target.value || null })} placeholder="登录要求、操作方法或当前完成范围" /></label>
          <label className="adm__label">小组名称<input className="adm__input" maxLength={60} placeholder="可后续补充" value={form.groupName ?? ''} onChange={e => setForm({ ...form, groupName: e.target.value || null })} /></label>
          <label className="adm__label">小组人数<input className="adm__input" type="number" min={1} max={100} step={1} placeholder="未知时留空" value={form.memberCount ?? ''} onChange={e => setForm({ ...form, memberCount: e.target.value === '' ? null : e.target.valueAsNumber })} /></label>
          <label className="adm__label">项目链接<input className="adm__input" type="url" maxLength={2048} placeholder="GitHub 或项目介绍网址" value={form.projectUrl ?? ''} onChange={e => setForm({ ...form, projectUrl: e.target.value || null })} /></label>
          <label className="adm__label">体验网址<input className="adm__input" type="url" maxLength={2048} placeholder="可选，仅填写能直接体验的网址" value={form.experienceUrl ?? ''} onChange={e => setForm({ ...form, experienceUrl: e.target.value || null })} /></label>
          <label className="adm__label">列表封面<input className="adm__input" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = '' }} /></label>
          <p className="adm__modalDesc">列表封面用于方形 Logo，完整显示；与下方详情展示图分别保存。</p>
          {form.coverImageId && <img className="admin-projects__preview" src={mediaUrl(form.coverImageId)} alt="项目封面预览" />}
          {form.coverImageId && <button type="button" className="adm__btn" onClick={() => setForm({ ...form, coverImageId: null })}>移除列表封面</button>}
          <label className="adm__label">详情展示图<input className="adm__input" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => { void uploadGallery(Array.from(e.target.files ?? [])); e.target.value = '' }} /></label>
          <p className="adm__modalDesc">最多 8 张，支持横版截图与竖版海报。未上传时详情不显示图库。</p>
          <ol className="admin-projects__gallery">{(form.showcaseImageIds ?? []).map((mediaId, index) => <li key={mediaId}><img src={mediaUrl(mediaId)} alt={`详情展示图 ${index + 1}`} /><div><button type="button" className="adm__btn" aria-label={`上移第${index + 1}张展示图`} disabled={index === 0} onClick={() => moveImage(index, -1)}>上移</button><button type="button" className="adm__btn" aria-label={`下移第${index + 1}张展示图`} disabled={index === (form.showcaseImageIds?.length ?? 0) - 1} onClick={() => moveImage(index, 1)}>下移</button><button type="button" className="adm__btn" aria-label={`移除第${index + 1}张展示图`} onClick={() => setForm({ ...form, showcaseImageIds: form.showcaseImageIds?.filter(id => id !== mediaId) })}>移除</button></div></li>)}</ol>
          <label className="adm__label">展示顺序（数字越小越靠前）<input className="adm__input" type="number" required min={0} max={10000} step={1} value={form.position} onChange={e => setForm({ ...form, position: e.target.valueAsNumber })} /></label>
          <label className="adm__label">展示状态<select aria-label="展示状态" className="adm__input" value={form.published ? 'published' : 'draft'} onChange={e => setForm({ ...form, published: e.target.value === 'published' })}><option value="draft">未上架</option><option value="published">已上架</option></select></label>
        </fieldset>
        {uploading && <p role="status">封面上传中…</p>}
        {formError && <p className="adm__err" role="alert">{formError}</p>}
        <div className="adm__modalActions"><button type="button" className="adm__btn" disabled={busy || uploading} onClick={() => setForm(null)}>取消</button><button type="submit" className="adm__btn adm__btn--primary" disabled={busy || uploading}>{busy ? '保存中…' : '保存项目'}</button></div>
      </form>
    </AdminDialog>}
  </section>
}
