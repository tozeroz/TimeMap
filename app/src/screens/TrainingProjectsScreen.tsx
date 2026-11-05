import { useCallback, useEffect, useRef, useState } from 'react'
import { failText, listTrainingProjects, mediaUrl, setProjectLike, type TrainingProject } from '../api/client'
import { isLoggedIn } from '../api/session'
import { Screen } from '../components/Shell'
import { ActivityModeTitle } from '../components/ActivityModeTitle'
import { IconHeart, IconImage, IconRefresh, IconUsers } from '../components/icons'
import { navigate, useRoute } from '../router'
import './trainingprojects.css'

const projectNames = new Intl.Collator('zh-CN', { sensitivity: 'variant', numeric: false })

export function TrainingProjectsScreen() {
  const route = useRoute(), view = route.query.view === 'popular' ? 'popular' : 'all'
  const [items, setItems] = useState<TrainingProject[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [pending, setPending] = useState<Set<string>>(new Set())
  const locks = useRef(new Set<string>()), version = useRef(0), alive = useRef(true)
  const updates = useRef(new Map<string, { likeCount: number; likedByMe: boolean; version: number }>())
  const mutationVersion = useRef(0)
  const load = useCallback(async (quiet = false) => {
    const request = ++version.current, atStart = mutationVersion.current
    if (!quiet) { setPhase('loading'); setError('') }
    const result = await listTrainingProjects('all')
    if (!alive.current || request !== version.current) return
    if (!result.ok) {
      if (quiet) setNotice(`榜单刷新失败：${failText(result)}，请刷新重试`)
      else { setPhase('error'); setError(failText(result)); setItems([]) }
      return
    }
    setItems(result.value.items.map(item => {
      const update = updates.current.get(item.id)
      return update && update.version > atStart ? { ...item, likeCount: update.likeCount, likedByMe: update.likedByMe } : item
    }))
    setPhase('ready')
  }, [])
  const invalidate = useCallback(() => { alive.current = false; version.current++ }, [])
  useEffect(() => {
    alive.current = true
    let active = true
    queueMicrotask(() => { if (active) void load() })
    return () => { active = false; invalidate() }
  }, [load, invalidate])
  function login() {
    try { sessionStorage.setItem('timemap.login.return', JSON.stringify({ path: 'activities', query: { mode: 'projects', view } })) } catch { /* Login still available. */ }
    navigate('loginselect')
  }
  async function like(project: TrainingProject) {
    if (locks.current.has(project.id)) return
    if (!isLoggedIn()) { login(); return }
    locks.current.add(project.id); setPending(new Set(locks.current)); setNotice('')
    try {
      const result = await setProjectLike(project.id, !project.likedByMe)
      if (!alive.current) return
      if (!result.ok) {
        if (result.status === 401) { login(); return }
        setNotice(result.status === 404 ? '这个项目已不可用，列表已刷新' : `点赞操作失败：${failText(result)}`)
        if (result.status === 404) void load()
        return
      }
      updates.current.set(project.id, { ...result.value, version: ++mutationVersion.current })
      setItems(previous => previous.map(item => item.id === project.id ? { ...item, ...result.value } : item))
      // Re-read the complete server-ordered catalogue after a mutation.
      void load(true)
    } finally { locks.current.delete(project.id); if (alive.current) setPending(new Set(locks.current)) }
  }
  // Both views use the complete catalogue, including stable ties after a local update.
  const visible = view === 'popular' ? [...items].sort((a, b) => b.likeCount - a.likeCount || projectNames.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : items
  return <Screen className="acts-page projects-page" header={<header className="acts__head">
    <div><ActivityModeTitle /><p className="acts__subtitle">看见同学们的创意，为喜欢的项目点赞</p></div>
    <button className="acts__refresh" aria-label="刷新项目" aria-busy={phase === 'loading'} disabled={phase === 'loading'} onClick={() => { setNotice(''); void load() }}><IconRefresh size={27} /></button>
  </header>}>
    <div className="projects__filters">
      <div className="projects__tabs" role="tablist" aria-label="项目展示方式" onKeyDown={e => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
          e.preventDefault()
          const next = e.key === 'Home' ? 'all' : e.key === 'End' ? 'popular' : view === 'all' ? 'popular' : 'all'
          navigate('activities', { ...route.query, mode: 'projects', view: next })
          document.getElementById(`projects-tab-${next}`)?.focus()
        }
      }}>{(['all', 'popular'] as const).map(tab => <button key={tab} id={`projects-tab-${tab}`} role="tab" aria-selected={view === tab} aria-controls="projects-panel" tabIndex={view === tab ? 0 : -1} className={view === tab ? 'is-active' : ''} onClick={() => navigate('activities', { ...route.query, mode: 'projects', view: tab })}>{tab === 'all' ? '全部项目' : '人气榜'}</button>)}</div>
      <p>每个项目可点赞一次，支持取消</p>
    </div>
    <section className="projects__results" id="projects-panel" role="tabpanel" aria-labelledby={`projects-tab-${view}`} aria-busy={phase === 'loading'}>
      <div className="projects__heading"><h2>{view === 'all' ? '全部项目' : '项目人气榜'}</h2><span>{view === 'popular' ? '按点赞数排序' : phase === 'ready' ? `${items.length} 个项目` : phase === 'loading' ? '加载中…' : '暂不可用'}</span></div>
      {notice && <p className="projects__notice" role="alert">{notice}</p>}
      {phase === 'loading' && <div role="status" aria-label="项目加载中" className="projects__skeletons">{[0, 1, 2].map(i => <div key={i} className="projects__skeleton"><span /><div><i /><i /><i /></div></div>)}</div>}
      {phase === 'error' && <div className="projects__state" role="alert"><IconImage size={32} /><h3>项目加载失败</h3><p>{error}</p><button onClick={() => void load()}>重试</button></div>}
      {phase === 'ready' && !items.length && <div className="projects__state"><IconImage size={36} /><h3>暂无实训项目</h3><p>项目由管理员统一录入，敬请期待</p></div>}
      {phase === 'ready' && items.length > 0 && <ol className={`projects__list ${view === 'popular' ? 'is-popular' : ''}`}>
        {visible.map((project, index) => <li key={project.id} className="projects__row" data-project-id={project.id}>
          {view === 'popular' && <span className={`projects__rank ${index < 3 ? `is-medal is-rank-${index + 1}` : ''}`} aria-label={`第 ${index + 1} 名`}><span>{index + 1}</span></span>}
          <ProjectCover key={`${project.id}-${project.coverImageId}`} project={project} />
          <div className="projects__info"><h3>{project.name}</h3><p className="projects__summary">{project.summary}</p><p className="projects__group"><IconUsers size={18} /><span>{project.groupName || '团队信息待补充'}{project.memberCount != null && ` · ${project.memberCount}人`}</span></p>
            <div className="projects__links">
              {project.projectUrl && /^https?:\/\//i.test(project.projectUrl) && <a className="projects__source" href={project.projectUrl} target="_blank" rel="noopener noreferrer">项目链接 <span aria-hidden="true">↗</span></a>}
              {project.experienceUrl && /^https?:\/\//i.test(project.experienceUrl) && <a className="projects__experience" href={project.experienceUrl} target="_blank" rel="noopener noreferrer">体验项目 <span aria-hidden="true">↗</span></a>}
            </div>
          </div>
          <button className={`projects__like ${project.likedByMe ? 'is-liked' : ''}`} aria-label={`${project.likedByMe ? '取消点赞' : '点赞'} ${project.name}，${project.likeCount} 赞`} aria-pressed={project.likedByMe} aria-busy={pending.has(project.id)} disabled={pending.has(project.id)} onClick={() => void like(project)}><span><IconHeart size={24} filled={project.likedByMe} /><span>{project.likeCount}</span></span>{project.likedByMe && <small>已点赞</small>}</button>
        </li>)}
      </ol>}
    </section>
  </Screen>
}

export function ProjectCover({ project }: { project: TrainingProject }) {
  const [failed, setFailed] = useState(false)
  return <div className="projects__cover">{project.coverImageId && !failed ? <img src={mediaUrl(project.coverImageId)} alt={`${project.name}封面`} loading="lazy" onError={() => setFailed(true)} /> : <span><IconImage size={28} /><small>{failed ? '封面暂不可用' : '暂无封面'}</small></span>}</div>
}
