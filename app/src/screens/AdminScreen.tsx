import { useCallback, useEffect, useState } from 'react'
import {
  REPORT_REASONS,
  adminCreateActivity,
  adminCreatePlace,
  adminListActivities,
  adminListAuditLog,
  adminListPlaces,
  adminListPosts,
  adminListReports,
  adminGetActivitySubmission,
  adminListActivitySubmissions,
  adminReviewActivitySubmission,
  adminResolveReport,
  adminTakedownPost,
  adminUpdateActivity,
  adminUpdatePlace,
  mediaUrl,
  PLACE_CATEGORIES,
  relativeTime,
  uploadMedia,
  type ApiActivity,
  type ApiAdminPlace,
  type PlaceCategory,
  type ApiAdminPost,
  type AdminActivitySubmission,
  type SubmissionStatus,
  type ApiAuditEntry,
  type ApiReport,
  failText,
} from '../api/client'
import { isAdmin } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack, navigate } from '../router'
import { AdminDialog, AdminIcon } from '../components/AdminPrimitives'
import { SubmissionCover } from './MyActivitySubmissions'
import './admin.css'

/**
 * 管理端（F07 / US-08；需求 3.1 的「举报处理管理端」）。
 *
 * ## 权限：两层，且**不互相替代**
 *   ① 服务端 —— 每个 `/api/admin/*` 都独立校验 `role='admin'`，非管理员一律 403。
 *      这是**唯一**的权限边界。
 *   ② 本页 —— 非 admin 进来时显示明确的无权限态，**并且一个请求都不发**
 *      （不发请求就不能靠"403 也算发生了"来侧信道探测管理端有哪些数据）。
 *   ⚠️ 隐藏入口（MeScreen 里那个）只是**界面便利**，绝不能被当成权限控制。
 *
 * ## 六个面板
 *   举报处理 / 投稿审核 / 内容管理 / 活动管理 / 地点管理 / 操作记录
 *
 * ## US-08 的关键规则（本页每一处都对应一条验收）
 *   · 举报**不自动下架**：待处理列表只是列表，内容仍在各处可见
 *   · 「不处理」与「下架」**都必须填原因**（服务端缺 reason 会 400；
 *     本页也在提交前拦住，避免"点完才被告知失败"）
 *   · 下架后内容**同步退出**地图/地点列表/公开列表/收藏 —— 因此下架成功必须**重新拉取**
 *     各列表，而不是只改本地那一行
 *   · 操作记录包含管理员、对象、时间、动作
 */
type PanelKey = 'reports' | 'submissions' | 'posts' | 'activities' | 'places' | 'audit'

const PANELS: { key: PanelKey; label: string }[] = [
  { key: 'reports', label: '举报处理' },
  { key: 'submissions', label: '投稿审核' },
  { key: 'posts', label: '内容管理' },
  { key: 'activities', label: '活动管理' },
  { key: 'places', label: '地点管理' },
  { key: 'audit', label: '操作记录' },
]

export function AdminScreen() {
  const [panel, setPanel] = useState<PanelKey>(() => { const key = new URLSearchParams(window.location.hash.split('?')[1]).get('panel'); return PANELS.some(p => p.key === key) ? key as PanelKey : 'reports' })
  const admin = isAdmin()

  const header = (
    <TopBar
      left={
        <button className="iconbtn" onClick={() => goBack('me')} aria-label="返回">
          <IconBack size={22} />
        </button>
      }
      center={<div className="adm__brand"><span className="adm__topTitle">管理中心</span><small>时光坐标 · 校园记忆地图</small></div>}
      right={<span className="adm__shield" role="img" aria-label="管理员"><AdminIcon name="shield" /></span>}
    />
  )

  /* ②：非管理员 —— 明确的无权限态，且**不发任何请求** */
  if (!admin) {
    return (
      <Screen className="admin-reference" header={header} scroll>
        <div className="adm__denied" data-admin-denied>
          <p className="adm__deniedTitle">无权限</p>
          <p className="adm__deniedSub">
            管理端只对学生管理员开放。当前账号不是管理员，本页不会请求任何管理数据。
          </p>
        </div>
      </Screen>
    )
  }

  return (
    <Screen className="admin-reference" header={header} scroll>
      <nav className="adm__tabs no-scrollbar" aria-label="管理分类">
        {PANELS.map((p) => (
          <button
            key={p.key}
            className={`adm__tab ${panel === p.key ? 'is-active' : ''}`}
            data-admin-tab={p.key}
            aria-current={panel === p.key ? 'page' : undefined}
            onClick={event => { setPanel(p.key); window.history.replaceState(null, '', `#/admin?panel=${p.key}`); event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' }) }}
          >
            {p.label}
          </button>
        ))}
      </nav>

      {panel === 'reports' && <ReportsPanel />}
      {panel === 'submissions' && <SubmissionsPanel />}
      {panel === 'posts' && <PostsPanel />}
      {panel === 'activities' && <ActivitiesPanel />}
      {panel === 'places' && <PlacesPanel />}
      {panel === 'audit' && <AuditPanel />}
    </Screen>
  )
}

/** 面板共用的三态包装：加载中 / 失败（带原因与重试）/ 就绪 */
function useLoader<T>(load: () => Promise<{ ok: true; value: T } | { ok: false; reason: string }>) {
  const [data, setData] = useState<T | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')
  const run = useCallback(async () => {
    setPhase('loading')
    const r = await load()
    if (r.ok) {
      setData(r.value)
      setPhase('ready')
      setErr('')
    } else {
      setData(null)
      setErr(failText(r))
      setPhase('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void run()
  }, [run])
  return { data, phase, err, reload: run }
}

function PaneState({
  phase,
  err,
  onRetry,
  empty,
}: {
  phase: 'loading' | 'ready' | 'error'
  err?: string
  onRetry: () => void
  empty?: string
}) {
  if (phase === 'loading') return <p className="adm__state">加载中…</p>
  if (phase === 'error')
    return (
      <div className="adm__state" data-admin-error>
        <p>加载失败</p>
        <p className="adm__stateSub">{err}</p>
        <button className="adm__btn" onClick={onRetry}>
          重试
        </button>
      </div>
    )
  if (empty) return <p className="adm__state">{empty}</p>
  return null
}

// ---------------------------------------------------------------------------
// 举报处理
// ---------------------------------------------------------------------------

function ReportsPanel() {
  const [status, setStatus] = useState<'pending' | 'resolved'>('pending')
  const [items, setItems] = useState<ApiReport[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')
  /** 正在填写处理原因的那条举报；reason 为该条的原因草稿 */
  const [handling, setHandling] = useState<{ id: string; resolution: 'no_action' | 'removed'; reason: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setPhase('loading')
    const r = await adminListReports(status)
    if (r.ok) {
      setItems(r.value)
      setPhase('ready')
      setErr('')
    } else {
      setItems([])
      setErr(failText(r))
      setPhase('error')
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    if (!handling) return
    const reason = handling.reason.trim()
    /*
      ⚠️ 前端也拦一次（不是只靠服务端）：
      需求原文「管理员选择不处理或下架时必须记录原因」。
      只在服务端拦的话，用户的体验是"填了半天空的原因，点提交才被拒"。
    */
    if (!reason) {
      setNotice('必须填写处理原因（不处理与下架都要记录）')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const r = await adminResolveReport(handling.id, handling.resolution, reason)
      if (!r.ok) {
        setNotice(`处理失败：${failText(r)}`)
        return
      }
      setHandling(null)
      // 下架会改变内容的公开状态 ⇒ 必须**重新拉取**列表（不能只改本地那一行）
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm__pane">
      <div className="adm__row">
        {(['pending', 'resolved'] as const).map((s) => (
          <button
            key={s}
            className={`adm__chip ${status === s ? 'is-active' : ''}`}
            data-report-status={s}
            onClick={() => setStatus(s)}
          >
            {s === 'pending' ? '待处理' : '已处理'}
          </button>
        ))}
        <button className="adm__chip adm__chip--ghost" onClick={() => void load()}>
          刷新
        </button>
      </div>

      <PaneState
        phase={phase}
        err={err}
        onRetry={() => void load()}
        empty={phase === 'ready' && items.length === 0 ? (status === 'pending' ? '没有待处理举报' : '还没有处理过的举报') : undefined}
      />

      {phase === 'ready' && items.length > 0 && (
        <ul className="adm__list" data-report-count={String(items.length)}>
          {items.map((r) => (
            <li key={r.id} className="adm__card" data-report-id={r.id} data-report-state={r.status}>
              <div className="adm__cardHead">
                <span className="adm__tag">{r.targetType === 'post' ? '帖子' : '评论'}</span>
                <span className="adm__tag adm__tag--reason">{reasonLabel(r.reasonCode)}</span>
                <span className="adm__time">{relativeTime(r.createdAt)}</span>
              </div>
              {r.detail && <p className="adm__cardBody">{r.detail}</p>}
              <p className="adm__cardMeta">
                目标 <code className="adm__code">{r.targetId}</code>
              </p>
              {r.reporterName && <p className="adm__cardMeta">举报人：{r.reporterName}</p>}

              {r.status === 'resolved' ? (
                <p className="adm__cardResult" data-report-resolution={r.resolution ?? ''}>
                  处理结果：{r.resolution === 'removed' ? '已下架' : '不处理'} · 原因：{r.handleReason ?? '（未记录）'}
                </p>
              ) : (
                <div className="adm__actions">
                  <button
                    className="adm__btn"
                    data-report-action="no_action"
                    onClick={() => setHandling({ id: r.id, resolution: 'no_action', reason: '' })}
                  >
                    不处理
                  </button>
                  <button
                    className="adm__btn adm__btn--danger"
                    data-report-action="removed"
                    onClick={() => setHandling({ id: r.id, resolution: 'removed', reason: '' })}
                  >
                    下架内容
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {handling && (
        <div className="adm__modalWrap" data-admin-reason-modal={handling.resolution}>
          <div className="adm__modal">
            <h3 className="adm__modalTitle">
              {handling.resolution === 'removed' ? '下架内容' : '不处理'}
            </h3>
            <p className="adm__modalDesc">
              {handling.resolution === 'removed'
                ? '下架后该内容会同步退出地图、地点详情、公开列表与收藏。'
                : '内容将保持公开。'}
              {' '}无论哪种处理，都必须记录原因（会写入操作记录）。
            </p>
            <textarea
              className="adm__textarea"
              data-admin-reason-input
              placeholder="请填写处理原因（必填）"
              value={handling.reason}
              onChange={(e) => setHandling({ ...handling, reason: e.target.value })}
              autoFocus
            />
            {notice && <p className="adm__err">{notice}</p>}
            <div className="adm__modalActions">
              <button className="adm__btn" onClick={() => setHandling(null)} disabled={busy}>
                取消
              </button>
              <button className="adm__btn adm__btn--primary" data-admin-reason-submit onClick={() => void submit()} disabled={busy}>
                {busy ? '提交中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!handling && notice && <p className="adm__err">{notice}</p>}
    </section>
  )
}

function reasonLabel(code: string): string {
  return REPORT_REASONS.find((r) => r.code === code)?.label ?? code
}

// ---------------------------------------------------------------------------
// 内容管理
// ---------------------------------------------------------------------------

function PostsPanel() {
  const { data, phase, err, reload } = useLoader<ApiAdminPost[]>(() => adminListPosts())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [takedown, setTakedown] = useState<{ id: string; reason: string } | null>(null)

  async function submit() {
    if (!takedown) return
    const reason = takedown.reason.trim()
    if (!reason) {
      setNotice('下架必须记录原因')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const r = await adminTakedownPost(takedown.id, reason)
      if (!r.ok) {
        setNotice(`下架失败：${failText(r)}`)
        return
      }
      setTakedown(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm__pane">
      <PaneState
        phase={phase}
        err={err}
        onRetry={() => void reload()}
        empty={phase === 'ready' && (data ?? []).length === 0 ? '还没有帖子' : undefined}
      />
      {phase === 'ready' && (data ?? []).length > 0 && (
        <ul className="adm__list" data-admin-posts={String((data ?? []).length)}>
          {(data ?? []).map((p) => (
            <li key={p.id} className="adm__card" data-admin-post={p.id} data-post-status={p.status}>
              <div className="adm__cardHead">
                <span className="adm__tag">{p.author}</span>
                <span className={`adm__tag ${p.status === 'removed' ? 'adm__tag--danger' : ''}`}>
                  {p.status === 'removed' ? '已下架' : '公开'}
                </span>
                <span className="adm__time">{relativeTime(p.createdAt)}</span>
              </div>
              <p className="adm__cardBody">{p.body}</p>
              <p className="adm__cardMeta">地点：{p.place ?? '（无）'}</p>
              {p.removedReason && <p className="adm__cardResult">下架原因：{p.removedReason}</p>}
              {p.status === 'published' && (
                <div className="adm__actions">
                  <button
                    className="adm__btn adm__btn--danger"
                    data-admin-takedown={p.id}
                    onClick={() => {
                      setNotice('')
                      setTakedown({ id: p.id, reason: '' })
                    }}
                  >
                    下架
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {takedown && (
        <div className="adm__modalWrap" data-admin-takedown-modal>
          <div className="adm__modal">
            <h3 className="adm__modalTitle">下架帖子</h3>
            <p className="adm__modalDesc">下架后该帖同步退出所有公开面。原因会写入操作记录。</p>
            <textarea
              className="adm__textarea"
              data-admin-takedown-reason
              placeholder="请填写下架原因（必填）"
              value={takedown.reason}
              onChange={(e) => setTakedown({ ...takedown, reason: e.target.value })}
              autoFocus
            />
            {notice && <p className="adm__err">{notice}</p>}
            <div className="adm__modalActions">
              <button className="adm__btn" onClick={() => setTakedown(null)} disabled={busy}>
                取消
              </button>
              <button className="adm__btn adm__btn--primary" data-admin-takedown-submit onClick={() => void submit()} disabled={busy}>
                {busy ? '提交中…' : '确认下架'}
              </button>
            </div>
          </div>
        </div>
      )}
      {!takedown && notice && <p className="adm__err">{notice}</p>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 活动管理
// ---------------------------------------------------------------------------

function ActivitiesPanel() {
  const { data, phase, err, reload } = useLoader<ApiActivity[]>(() => adminListActivities())
  const places = useLoader<ApiAdminPlace[]>(() => adminListPlaces())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  /** 022：ACT-003 新增 activityType / organizer / externalLink / coverImageId 四项 */
  type ActivityForm = {
    title: string
    placeId: string
    startsAt: string
    endsAt: string
    description: string
    activityType: string
    organizer: string
    externalLink: string
    coverImageId: string | null
  }
  const EMPTY_FORM: ActivityForm = {
    title: '',
    placeId: '',
    startsAt: '',
    endsAt: '',
    description: '',
    activityType: '',
    organizer: '',
    externalLink: '',
    coverImageId: null,
  }
  const [form, setForm] = useState<ActivityForm | null>(null)
  const [uploading, setUploading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setFilterStatus] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState({ placeId: '', from: '', to: '' })
  const [filterDraft, setFilterDraft] = useState(filters)
  const [filterError, setFilterError] = useState('')
  const [more, setMore] = useState<ApiActivity | null>(null)
  const [confirmAction, setConfirmAction] = useState<ApiActivity | null>(null)
  const [success, setSuccess] = useState('')
  const statusLabels: Record<string, string> = { all: '全部', upcoming: '即将开始', ongoing: '进行中', ended: '已结束', cancelled: '已取消' }
  const dateParts = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const dateKey = (value: string) => { const parts = dateParts(value); return ['year', 'month', 'day'].map(key => parts.find(p => p.type === key)?.value).join('-') }
  const localInput = (value: string | null) => value ? `${dateKey(value)}T${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))}` : ''
  const filtered = (data ?? []).filter(activity => {
    const day = dateKey(activity.startsAt)
    return (status === 'all' || activity.effectiveStatus === status)
      && (!query.trim() || `${activity.title} ${activity.place.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      && (!filters.placeId || activity.place.id === filters.placeId)
      && (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to)
  })
  const filterCount = Number(Boolean(filters.placeId)) + Number(Boolean(filters.from || filters.to))
  function openEditor(activity?: ApiActivity) {
    setEditingId(activity?.id ?? null); setNotice(''); setSuccess('')
    setForm(activity ? { title: activity.title, placeId: activity.place.id, startsAt: localInput(activity.startsAt), endsAt: localInput(activity.endsAt), description: activity.description ?? '', activityType: activity.activityType ?? '', organizer: activity.organizer ?? '', externalLink: activity.externalLink ?? '', coverImageId: activity.coverImageId } : { ...EMPTY_FORM })
  }


  const enabledPlaces = (places.data ?? []).filter((p) => p.enabled)

  /**
   * 封面上传（022）。
   *
   * 先上传拿 media id，再把 id 填进表单 —— 和发布页同一套流程：**先传媒体、后提交实体**，
   * 这样实体创建失败时不会留下半个引用。
   * purpose 用 'activity' ⇒ 服务端映射到 scope='public'（见 POST /api/media）。
   */
  async function pickCover(file: File) {
    setUploading(true)
    setNotice('')
    try {
      const r = await uploadMedia(file, 'activity')
      if (!r.ok) {
        // 上传失败**不清空**已选内容，也不假装成功
        setNotice(`封面上传失败：${failText(r)}`)
        return
      }
      setForm((f) => (f ? { ...f, coverImageId: r.value.id } : f))
    } catch { setNotice('封面上传失败，请检查网络后重试。') } finally {
      setUploading(false)
    }
  }

  async function submit() {
    if (!form || busy || uploading) return
    if (!form.title.trim() || !form.placeId || !form.startsAt) {
      setNotice('标题、地点、开始时间都是必填')
      return
    }
    const startsAt = new Date(`${form.startsAt}:00+08:00`)
    const endsAt = form.endsAt ? new Date(`${form.endsAt}:00+08:00`) : null
    if (!Number.isFinite(startsAt.getTime()) || (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt))) {
      setNotice('请填写有效时间，结束时间必须晚于开始时间'); return
    }
    setBusy(true)
    setNotice('')
    try {
      const input = {
        title: form.title.trim(),
        placeId: form.placeId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt?.toISOString() ?? null,
        description: form.description.trim() || null,
        activityType: form.activityType.trim() || null,
        organizer: form.organizer.trim() || null,
        externalLink: form.externalLink.trim() || null,
        coverImageId: form.coverImageId,
      }
      const r = editingId ? await adminUpdateActivity(editingId, input) : await adminCreateActivity({ ...input, description: input.description ?? undefined, activityType: input.activityType ?? undefined, organizer: input.organizer ?? undefined, externalLink: input.externalLink ?? undefined })
      if (!r.ok) {
        setNotice(`保存失败：${failText(r)}`)
        return
      }
      setForm(null)
      setSuccess(editingId ? '活动修改已保存' : '活动已创建')
      await reload()
    } catch { setNotice('保存失败，请检查网络后重试，填写内容已保留。') } finally {
      setBusy(false)
    }
  }

  async function setStatus(id: string, status: 'scheduled' | 'cancelled') {
    if (busy) return
    setBusy(true)
    setNotice('')
    setSuccess('')
    try {
      const r = await adminUpdateActivity(id, { status })
      if (!r.ok) {
        setNotice(`操作失败：${failText(r)}`)
        return
      }
      setConfirmAction(null)
      setSuccess(status === 'cancelled' ? '活动已取消' : '活动已恢复')
      await reload()
    } catch { setNotice('操作失败，请检查网络后重试。') } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm__pane adm-activities" aria-labelledby="admin-activity-title">
      <div className="adm-activities__heading">
        <div><h1 id="admin-activity-title">活动管理</h1><p>维护校园活动信息</p></div>
        <button className="adm-activities__create" data-admin-new-activity onClick={() => openEditor()}><AdminIcon name="plus" />新建活动</button>
      </div>
      <div className="adm-activities__search"><AdminIcon name="search" /><input aria-label="搜索活动名称、地点" placeholder="搜索活动名称、地点" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}>×</button>}</div>
      <div className="adm-activities__filterbar">
        <div className="adm-activities__statuses no-scrollbar" aria-label="活动状态">{Object.entries(statusLabels).map(([key, label]) => <button key={key} className={status === key ? 'is-active' : ''} aria-pressed={status === key} onClick={() => setFilterStatus(key)}>{label}</button>)}</div>
        <button className={`adm-activities__filter ${filterCount ? 'is-active' : ''}`} onClick={() => { setFilterDraft(filters); setFilterError(''); setFiltersOpen(true) }}><AdminIcon name="filter" />筛选{filterCount > 0 && <span>{filterCount}</span>}</button>
      </div>
      <div className="adm-activities__summary"><span>{phase === 'ready' ? `当前已加载 ${filtered.length} 项活动` : phase === 'loading' ? '正在读取活动…' : '活动读取失败'}</span><button disabled={phase === 'loading' || busy} onClick={() => { setSuccess(''); void reload() }}><AdminIcon name="refresh" />刷新</button></div>
      {success && <p className="adm-activities__success" role="status">{success}</p>}
      <PaneState phase={phase} err={err} onRetry={() => void reload()} />
      {phase === 'ready' && filtered.length === 0 && <div className="adm-activities__empty"><AdminIcon name="search" /><h2>{(data ?? []).length ? '没有匹配的活动' : '暂无活动'}</h2><p>{(data ?? []).length ? '试试其他关键词，或清除筛选条件。' : '新建一项活动，让校园里的精彩被看见。'}</p><button className="adm__btn" onClick={() => { if (!(data ?? []).length) openEditor(); else { setQuery(''); setFilterStatus('all'); setFilters({ placeId: '', from: '', to: '' }) } }}>{(data ?? []).length ? '清除条件' : '新建活动'}</button></div>}
      {phase === 'ready' && filtered.length > 0 && <ul className="adm-activities__list" data-admin-activities={String(filtered.length)}>
        {filtered.map(activity => {
          const [year, month, day] = dateKey(activity.startsAt).split('-')
          return <li className="adm-activity" key={activity.id} data-admin-activity={activity.id} data-activity-status={activity.effectiveStatus}>
            <div className="adm-activity__main">
              <div className="adm-activity__date" aria-label={`${year}年${month}月${day}日`}><span>{Number(month)}月</span><strong>{day}</strong><small>{year}</small></div>
              <div className="adm-activity__info">
                <div className="adm-activity__titleRow"><h2>{activity.title}</h2><span className={`adm-activity__status is-${activity.effectiveStatus}`}>{statusLabels[activity.effectiveStatus]}</span></div>
                <div className="adm-activity__metadata"><p><AdminIcon name="clock" /><span>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(activity.startsAt))}</span></p><p><AdminIcon name="link" /><span>来源：{activity.source || '未填写'}</span></p></div>
                <p className="adm-activity__place"><AdminIcon name="pin" /><span>{activity.place.name}{!activity.place.enabled && '（地点已停用）'}</span></p>
              </div>
            </div>
            <div className="adm-activity__actions"><button onClick={() => navigate('activity', { id: activity.id })}><AdminIcon name="eye" />查看详情</button><button disabled={busy} onClick={() => openEditor(activity)}><AdminIcon name="edit" />编辑</button><button aria-label={`更多操作：${activity.title}`} onClick={() => { setNotice(''); setMore(activity) }}><AdminIcon name="more" />更多</button></div>
          </li>
        })}
      </ul>}
      <p className="adm-activities__footnote">仅展示已录入活动。</p>
      {filtersOpen && <AdminDialog title="筛选活动" onClose={() => setFiltersOpen(false)}>
        <form onSubmit={event => { event.preventDefault(); if (filterDraft.from && filterDraft.to && filterDraft.from > filterDraft.to) { setFilterError('结束日期不能早于开始日期'); return } setFilters(filterDraft); setFiltersOpen(false) }}>
          <label className="adm__label">活动地点<select className="adm__input" value={filterDraft.placeId} onChange={event => setFilterDraft({ ...filterDraft, placeId: event.target.value })}><option value="">全部地点</option>{(places.data ?? []).map(place => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>
          {places.phase === 'error' && <p className="adm__err">地点读取失败 <button type="button" className="adm__btn" onClick={() => void places.reload()}>重试</button></p>}
          <label className="adm__label">开始日期（起）<input className="adm__input" type="date" value={filterDraft.from} onChange={event => setFilterDraft({ ...filterDraft, from: event.target.value })} /></label>
          <label className="adm__label">开始日期（止）<input className="adm__input" type="date" value={filterDraft.to} onChange={event => setFilterDraft({ ...filterDraft, to: event.target.value })} /></label>
          <p className="adm__modalDesc">按北京时间筛选已加载活动的开始日期。</p>{filterError && <p className="adm__err" role="alert">{filterError}</p>}
          <div className="adm__modalActions"><button type="button" className="adm__btn" onClick={() => { setFilterDraft({ placeId: '', from: '', to: '' }); setFilterError('') }}>重置</button><button className="adm__btn adm__btn--primary" type="submit">应用筛选</button></div>
        </form>
      </AdminDialog>}
      {more && <AdminDialog title="更多操作" onClose={() => setMore(null)}><p className="adm__modalDesc">{more.title}</p><button className="adm-activities__menuAction" onClick={() => { setConfirmAction(more); setMore(null) }}>{more.status === 'cancelled' ? '恢复活动' : '取消活动'}</button></AdminDialog>}
      {confirmAction && <AdminDialog title={confirmAction.status === 'cancelled' ? '恢复活动' : '取消活动'} onClose={() => { if (!busy) setConfirmAction(null) }}><p className="adm__modalDesc">确定{confirmAction.status === 'cancelled' ? '恢复' : '取消'}“{confirmAction.title}”吗？{confirmAction.status !== 'cancelled' && '活动将标记为已取消，仍可查看详情。'}</p>{notice && <p className="adm__err" role="alert">{notice}</p>}<div className="adm__modalActions"><button className="adm__btn" disabled={busy} onClick={() => setConfirmAction(null)}>返回</button><button className="adm__btn adm__btn--primary" disabled={busy} data-activity-cancel={confirmAction.status === 'scheduled' ? confirmAction.id : undefined} data-activity-restore={confirmAction.status === 'cancelled' ? confirmAction.id : undefined} onClick={() => void setStatus(confirmAction.id, confirmAction.status === 'cancelled' ? 'scheduled' : 'cancelled')}>{busy ? '提交中…' : '确认'}</button></div></AdminDialog>}

      {form && (
        <AdminDialog title={editingId ? '编辑活动' : '新建活动'} onClose={() => { if (!busy && !uploading) setForm(null) }}>
          <fieldset className="adm-activities__fields" disabled={busy || uploading} data-admin-activity-modal>
            <p className="adm__modalDesc">
              请选择已启用的地点，时间按北京时间填写；结束时间需晚于开始时间。
            </p>
            <input
              aria-label="活动标题"
              className="adm__input"
              data-activity-title
              placeholder="活动标题（必填）"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <select
              aria-label="活动地点"
              className="adm__input"
              data-activity-place
              value={form.placeId}
              onChange={(e) => setForm({ ...form, placeId: e.target.value })}
            >
              <option value="">选择地点（必填）</option>
              {form.placeId && !enabledPlaces.some(p => p.id === form.placeId) && <option value={form.placeId}>当前地点已停用，请重新选择</option>}
              {enabledPlaces.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.category}）
                </option>
              ))}
            </select>
            {places.phase === 'error' && <p className="adm__err">地点读取失败 <button className="adm__btn" onClick={() => void places.reload()}>重试</button></p>}
            <label className="adm__label">
              开始时间
              <input
                className="adm__input"
                type="datetime-local"
                data-activity-start
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </label>
            <label className="adm__label">
              结束时间（可选）
              <input
                className="adm__input"
                type="datetime-local"
                data-activity-end
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </label>
            <textarea
              aria-label="活动说明"
              className="adm__textarea"
              data-activity-desc
              placeholder="活动说明（可选）"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            {/*
              022 / ACT-003 新增四项。
              ⚠️ 「活动类型」输入框刻意**没有下拉选项** —— 取值集在 ACT-002 里是
                 「待讨论」，由开发自己编一套枚举就是文档明令禁止的行为。
                 现在只能手填自由文本；等评审定下取值后再换成枚举 + 筛选。
            */}
            <input
              className="adm__input"
              data-activity-type
              aria-label="活动类型"
              placeholder="活动类型（可选；取值集待评审，暂为自由文本）"
              maxLength={40}
              value={form.activityType}
              onChange={(e) => setForm({ ...form, activityType: e.target.value })}
            />
            <input
              className="adm__input"
              data-activity-organizer
              aria-label="主办方"
              placeholder="主办方（可选）"
              maxLength={60}
              value={form.organizer}
              onChange={(e) => setForm({ ...form, organizer: e.target.value })}
            />
            <input
              className="adm__input"
              data-activity-external
              aria-label="参与方式外部链接"
              type="url"
              placeholder="参与方式外部链接（可选，http(s)://；仅展示，不做站内报名）"
              maxLength={500}
              value={form.externalLink}
              onChange={(e) => setForm({ ...form, externalLink: e.target.value })}
            />
            <label className="adm__label">
              封面图（可选）
              <input
                className="adm__input"
                type="file"
                accept="image/*"
                data-activity-cover
                disabled={uploading || busy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void pickCover(f)
                }}
              />
            </label>
            {uploading && <p className="adm__modalDesc">封面上传中…</p>}
            {form.coverImageId && (
              <img
                className="adm__coverPreview"
                data-activity-cover-preview={form.coverImageId}
                src={mediaUrl(form.coverImageId)}
                alt="封面预览"
              />
            )}
            {notice && <p className="adm__err">{notice}</p>}
            <div className="adm__modalActions">
              <button className="adm__btn" onClick={() => setForm(null)} disabled={busy || uploading}>
                取消
              </button>
              <button className="adm__btn adm__btn--primary" data-activity-submit onClick={() => void submit()} disabled={busy || uploading}>
                {busy ? '保存中…' : editingId ? '保存修改' : '创建'}
              </button>
            </div>
          </fieldset>
        </AdminDialog>
      )}
      {!form && notice && <p className="adm__err">{notice}</p>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 地点管理
// ---------------------------------------------------------------------------

function PlacesPanel() {
  const { data, phase, err, reload } = useLoader<ApiAdminPlace[]>(() => adminListPlaces())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<{ name: string; category: PlaceCategory; description: string } | null>(null)

  async function submit() {
    if (!form) return
    if (!form.name.trim()) {
      setNotice('地点名称必填')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const r = await adminCreatePlace({
        name: form.name.trim(),
        category: form.category,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      })
      if (!r.ok) {
        setNotice(`创建失败：${failText(r)}`)
        return
      }
      setForm(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function toggle(p: ApiAdminPlace) {
    setBusy(true)
    setNotice('')
    try {
      const r = await adminUpdatePlace(p.id, { enabled: !p.enabled })
      if (!r.ok) {
        setNotice(`操作失败：${failText(r)}`)
        return
      }
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm__pane">
      <div className="adm__row">
        <button className="adm__btn adm__btn--primary" data-admin-new-place onClick={() => setForm({ name: '', category: '地标', description: '' })}>
          新建地点
        </button>
        <button className="adm__chip adm__chip--ghost" onClick={() => void reload()}>
          刷新
        </button>
      </div>

      <PaneState phase={phase} err={err} onRetry={() => void reload()} />

      {phase === 'ready' && (
        <ul className="adm__list" data-admin-places={String((data ?? []).length)}>
          {(data ?? []).map((p) => (
            <li key={p.id} className="adm__card" data-admin-place={p.id} data-place-enabled={String(p.enabled)}>
              <div className="adm__cardHead">
                <span className="adm__tag">{p.category}</span>
                <span className={`adm__tag ${p.enabled ? '' : 'adm__tag--danger'}`}>
                  {p.enabled ? '启用中' : '已停用'}
                </span>
                <span className="adm__tag adm__tag--ghost">{p.postCount} 条公开帖子</span>
              </div>
              <p className="adm__cardBody">{p.name}</p>
              {p.address && <p className="adm__cardMeta">{p.address}</p>}
              <div className="adm__actions">
                <button
                  className={`adm__btn ${p.enabled ? 'adm__btn--danger' : ''}`}
                  data-place-toggle={p.id}
                  disabled={busy}
                  onClick={() => void toggle(p)}
                >
                  {p.enabled ? '停用' : '启用'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="adm__modalWrap" data-admin-place-modal>
          <div className="adm__modal">
            <h3 className="adm__modalTitle">新建地点</h3>
            <input
              className="adm__input"
              data-place-name
              placeholder="地点名称（必填）"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select
              className="adm__input"
              data-place-category
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as PlaceCategory })}
            >
              {PLACE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <textarea
              className="adm__textarea"
              data-place-desc
              placeholder="地点简介（可选）"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            {notice && <p className="adm__err">{notice}</p>}
            <div className="adm__modalActions">
              <button className="adm__btn" onClick={() => setForm(null)} disabled={busy}>
                取消
              </button>
              <button className="adm__btn adm__btn--primary" data-place-submit onClick={() => void submit()} disabled={busy}>
                {busy ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
      {!form && notice && <p className="adm__err">{notice}</p>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 操作记录
// ---------------------------------------------------------------------------

function AuditPanel() {
  const { data, phase, err, reload } = useLoader<ApiAuditEntry[]>(() => adminListAuditLog())
  return (
    <section className="adm__pane">
      <PaneState
        phase={phase}
        err={err}
        onRetry={() => void reload()}
        empty={phase === 'ready' && (data ?? []).length === 0 ? '还没有操作记录' : undefined}
      />
      {phase === 'ready' && (data ?? []).length > 0 && (
        <ul className="adm__list" data-admin-audit={String((data ?? []).length)}>
          {(data ?? []).map((e) => (
            <li key={e.id} className="adm__card" data-audit-action={e.action}>
              <div className="adm__cardHead">
                {/* US-08：操作记录必须包含**管理员**、对象、时间、动作 */}
                <span className="adm__tag adm__tag--actor">{e.actorName}</span>
                <span className="adm__tag">{e.action}</span>
                <span className="adm__time">{relativeTime(e.createdAt)}</span>
              </div>
              <p className="adm__cardMeta">
                {e.targetType}
                {e.targetId ? <code className="adm__code"> {e.targetId}</code> : null}
              </p>
              {e.reason && <p className="adm__cardResult">原因：{e.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 投稿审核（ACT-005）
// ---------------------------------------------------------------------------
/*
  这一面板是"审核动作的**唯一**入口"，三条规则都直接对应执行文档：
    ① 通过 / 驳回都必须**看着具体版本**做（expectedRevision 由服务端比对）；
       别人先处理过 → 409，界面刷新并说明，而不是把旧决定盖上去。
    ② 驳回必须写原因（前端先拦一次，服务端再拦一次）。
    ③ 通过后活动由服务端生成，这里只负责刷新 —— 不本地拼一条"看起来成功了"的数据。
  列表状态与服务端一致：pending / approved / rejected，筛选走**服务端**参数。
*/

const SUB_LABELS: Record<SubmissionStatus, string> = { pending: '待审核', approved: '已通过', rejected: '未通过' }

function fmtDateTime(value: string | null | undefined) {
  if (!value) return '未填写'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '时间待确认'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d)
}

function SubmissionsPanel() {
  const [filter, setFilter] = useState<SubmissionStatus>('pending')
  const [items, setItems] = useState<AdminActivitySubmission[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  /* 审核结果提示放在**面板层**：成功后卡片会离开当前筛选（服务端按状态过滤），
     卡片内的提示会随卡片一起卸载，等于没有反馈。 */
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setPhase('loading')
    const r = await adminListActivitySubmissions(filter)
    if (r.ok) {
      setItems(r.value.items)
      setNextCursor(r.value.nextCursor ?? null)
      setPhase('ready')
      setErr('')
    } else {
      setItems([])
      setNextCursor(null)
      setErr(failText(r))
      setPhase('error')
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    const r = await adminListActivitySubmissions(filter, nextCursor)
    setLoadingMore(false)
    if (!r.ok) {
      setErr(failText(r))
      return
    }
    setItems((old) => [...old, ...r.value.items.filter((i) => !old.some((o) => o.id === i.id))])
    setNextCursor(r.value.nextCursor ?? null)
  }

  return (
    <section className="adm__pane">
      <div className="adm__row">
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <button
            key={s}
            className={`adm__chip ${filter === s ? 'is-active' : ''}`}
            data-sub-filter={s}
            onClick={() => {
              setFilter(s)
              setNotice('')
            }}
          >
            {SUB_LABELS[s]}
          </button>
        ))}
        <button className="adm__chip adm__chip--ghost" onClick={() => void load()}>
          刷新
        </button>
      </div>

      {notice && (
        <p className="adm__cardResult" data-sub-panel-notice role="status">
          {notice}
        </p>
      )}

      <PaneState
        phase={phase}
        err={err}
        onRetry={() => void load()}
        empty={phase === 'ready' && items.length === 0 ? `没有${SUB_LABELS[filter]}的投稿` : undefined}
      />

      {phase === 'ready' && items.length > 0 && (
        <>
          <p className="adm__cardMeta" data-sub-count={String(items.length)}>
            共 {items.length} 条{nextCursor ? '（还有更多）' : ''}
          </p>
          <ul className="adm__list">
            {items.map((item) => (
              <SubmissionCard key={item.id} item={item} onHandled={load} onReviewed={setNotice} />
            ))}
          </ul>
          {nextCursor && (
            <button className="adm__btn" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          )}
        </>
      )}
    </section>
  )
}

function SubmissionCard({
  item,
  onHandled,
  onReviewed,
}: {
  item: AdminActivitySubmission
  onHandled: () => Promise<void>
  onReviewed: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<AdminActivitySubmission | null>(null)
  const [detailErr, setDetailErr] = useState('')
  /** 'approve' = 正在确认通过；'reject' = 正在填驳回原因 */
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const shown = detail ?? item

  async function refreshDetail() {
    const r = await adminGetActivitySubmission(item.id)
    if (r.ok) {
      setDetail(r.value)
      setDetailErr('')
    } else {
      setDetailErr(failText(r))
    }
  }

  async function toggle() {
    const next = !open
    setOpen(next)
    setNotice('')
    if (next) await refreshDetail()
  }

  async function submit() {
    if (!acting || busy) return
    const trimmed = reason.trim()
    // ② 前端先拦一次：空原因提交后才被拒的体验很差
    if (acting === 'reject' && !trimmed) {
      setNotice('驳回必须填写原因，请写明需要修改的地方。')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const r = await adminReviewActivitySubmission(shown.id, {
        decision: acting === 'approve' ? 'approved' : 'rejected',
        reason: trimmed || undefined,
        expectedRevision: shown.revision,
      })
      if (!r.ok) {
        /*
          ① 冲突（409）：别人已经处理过、或版本已变。
          这里必须**重新拉详情与列表**，让界面显示真实状态，而不是停在一个过期视图上。
        */
        if (r.status === 409) {
          setNotice('这条投稿已被处理过或版本已变化，已为你刷新到最新状态，请重新确认。')
          await refreshDetail()
          await onHandled()
          setActing(null)
          return
        }
        setNotice(`审核失败：${failText(r)}`)
        return
      }
      setDetail(r.value)
      setActing(null)
      setReason('')
      onReviewed(acting === 'approve' ? '已通过：公开活动已生成，投稿人可在「我的提交」看到。' : '已驳回：投稿人能看到你填写的原因。')
      // ③ 通过会改变公开列表与地点活动区 ⇒ 队列重新拉取
      await onHandled()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="adm__card" data-sub-id={item.id} data-sub-status={shown.status}>
      <div className="adm__cardHead">
        <span className={`adm__tag ${shown.status === 'pending' ? 'adm__tag--reason' : ''}`} data-sub-badge={shown.status}>
          {SUB_LABELS[shown.status]}
        </span>
        <span className="adm__tag adm__tag--actor">{shown.submitter?.displayName || '未知提交人'}</span>
        <span className="adm__time">{relativeTime(shown.submittedAt)}</span>
      </div>
      <p className="adm__cardBody">{shown.title}</p>
      <p className="adm__cardMeta">
        {shown.placeName} · 开始 {fmtDateTime(shown.startsAt)} · 版本 {shown.revision}
      </p>

      {shown.status !== 'pending' && (
        <p className="adm__cardResult" data-sub-result={shown.status}>
          {shown.status === 'approved'
            ? `已通过${shown.publicationStatus === 'cancelled' ? '（活动已被取消）' : shown.publicationStatus === 'public' ? ' · 已公开展示' : ''}`
            : `已驳回 · 原因：${shown.reviewReason || shown.history?.find((h) => h.revision === shown.revision)?.reason || '（未记录）'}`}
        </p>
      )}

      <div className="adm__actions">
        <button className="adm__btn" data-sub-open onClick={() => void toggle()}>
          {open ? '收起详情' : '查看详情'}
        </button>
        {shown.status === 'approved' && shown.publishedActivityId && (
          <button className="adm__btn" data-sub-goto-activity onClick={() => navigate('activity', { id: shown.publishedActivityId! })}>
            查看公开活动
          </button>
        )}
      </div>

      {open && (
        <div className="adm__subDetail" data-sub-detail>
          {detailErr && <p className="adm__stateSub">{detailErr}</p>}
          <div className="adm__subCover">
            <SubmissionCover id={shown.coverImageId} />
          </div>
          <dl className="adm__subFields">
            <div>
              <dt>提交人</dt>
              <dd>
                {shown.submitter?.displayName || '未知'}
                {shown.submitter?.handle ? `（@${shown.submitter.handle}）` : ''}
              </dd>
            </div>
            <div>
              <dt>地点</dt>
              <dd>{shown.placeName}</dd>
            </div>
            <div>
              <dt>开始 / 结束</dt>
              <dd>
                {fmtDateTime(shown.startsAt)} — {shown.endsAt ? fmtDateTime(shown.endsAt) : '未填写'}
              </dd>
            </div>
            <div>
              <dt>简介</dt>
              <dd>{shown.description || '未填写'}</dd>
            </div>
            <div>
              <dt>主办方 / 类型</dt>
              <dd>
                {shown.organizer || '未填写'} · {shown.activityType || '未填写'}
              </dd>
            </div>
            <div>
              <dt>信息来源</dt>
              <dd>{shown.source || '未填写'}</dd>
            </div>
            <div>
              <dt>原文 / 报名链接</dt>
              <dd>
                {/^https?:\/\//i.test(shown.externalLink) ? (
                  <a href={shown.externalLink} target="_blank" rel="noreferrer noopener">
                    {shown.externalLink}
                  </a>
                ) : (
                  '未填写'
                )}
              </dd>
            </div>
            <div>
              <dt>当前版本 / 提交时间</dt>
              <dd>
                第 {shown.revision} 版 · {fmtDateTime(shown.submittedAt)}
              </dd>
            </div>
          </dl>

          {!!shown.history?.length && (
            <div className="adm__subHistory" data-sub-history={String(shown.history.length)}>
              <p className="adm__cardMeta">审核历史</p>
              <ul>
                {shown.history.map((h) => (
                  <li key={`${h.revision}-${h.reviewedAt}`}>
                    第 {h.revision} 版 · {SUB_LABELS[h.decision]} · {fmtDateTime(h.reviewedAt)}
                    {h.reason ? ` · ${h.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notice && (
            <p className="adm__cardResult" data-sub-notice role="status">
              {notice}
            </p>
          )}

          {shown.status === 'pending' && (
            <div className="adm__subActions">
              {acting === null ? (
                <>
                  <button className="adm__btn" data-sub-approve onClick={() => setActing('approve')}>
                    通过
                  </button>
                  <button className="adm__btn adm__btn--danger" data-sub-reject onClick={() => setActing('reject')}>
                    驳回
                  </button>
                </>
              ) : (
                <>
                  {acting === 'reject' && (
                    <textarea
                      className="adm__subReason"
                      data-sub-reason
                      rows={3}
                      maxLength={500}
                      placeholder="写明需要修改的地方（投稿人能看到这段原因）"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  )}
                  <p className="adm__cardMeta">
                    {acting === 'approve'
                      ? `将按第 ${shown.revision} 版内容通过，并生成一条公开活动。`
                      : `将按第 ${shown.revision} 版驳回，原因会展示给投稿人。`}
                  </p>
                  <div className="adm__actions">
                    <button className="adm__btn" data-sub-confirm disabled={busy} onClick={() => void submit()}>
                      {busy ? '提交中…' : acting === 'approve' ? '确认通过' : '确认驳回'}
                    </button>
                    <button
                      className="adm__btn adm__btn--ghost"
                      disabled={busy}
                      onClick={() => {
                        setActing(null)
                        setNotice('')
                      }}
                    >
                      取消
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}
