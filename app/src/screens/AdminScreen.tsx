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
  adminResolveReport,
  adminTakedownPost,
  adminUpdateActivity,
  adminUpdatePlace,
  mediaUrl,
  relativeTime,
  uploadMedia,
  type ApiActivity,
  type ApiAdminPlace,
  type ApiAdminPost,
  type ApiAuditEntry,
  type ApiReport,
  failText,
} from '../api/client'
import { isAdmin } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack } from '../router'
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
 * ## 五个面板
 *   举报处理 / 内容管理 / 活动管理 / 地点管理 / 操作记录
 *
 * ## US-08 的关键规则（本页每一处都对应一条验收）
 *   · 举报**不自动下架**：待处理列表只是列表，内容仍在各处可见
 *   · 「不处理」与「下架」**都必须填原因**（服务端缺 reason 会 400；
 *     本页也在提交前拦住，避免"点完才被告知失败"）
 *   · 下架后内容**同步退出**地图/地点列表/公开列表/收藏 —— 因此下架成功必须**重新拉取**
 *     各列表，而不是只改本地那一行
 *   · 操作记录包含管理员、对象、时间、动作
 */
type PanelKey = 'reports' | 'posts' | 'activities' | 'places' | 'audit'

const PANELS: { key: PanelKey; label: string }[] = [
  { key: 'reports', label: '举报处理' },
  { key: 'posts', label: '内容管理' },
  { key: 'activities', label: '活动管理' },
  { key: 'places', label: '地点管理' },
  { key: 'audit', label: '操作记录' },
]

export function AdminScreen() {
  const [panel, setPanel] = useState<PanelKey>('reports')
  const admin = isAdmin()

  const header = (
    <TopBar
      left={
        <button className="iconbtn" onClick={() => goBack('me')} aria-label="返回">
          <IconBack size={22} />
        </button>
      }
      center={<span className="adm__topTitle">管理端</span>}
    />
  )

  /* ②：非管理员 —— 明确的无权限态，且**不发任何请求** */
  if (!admin) {
    return (
      <Screen header={header} scroll>
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
    <Screen header={header} scroll>
      <nav className="adm__tabs no-scrollbar">
        {PANELS.map((p) => (
          <button
            key={p.key}
            className={`adm__tab ${panel === p.key ? 'is-active' : ''}`}
            data-admin-tab={p.key}
            onClick={() => setPanel(p.key)}
          >
            {p.label}
          </button>
        ))}
      </nav>

      {panel === 'reports' && <ReportsPanel />}
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
    } finally {
      setUploading(false)
    }
  }

  async function submit() {
    if (!form) return
    if (!form.title.trim() || !form.placeId || !form.startsAt) {
      setNotice('标题、地点、开始时间都是必填')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const r = await adminCreateActivity({
        title: form.title.trim(),
        placeId: form.placeId,
        // datetime-local 给的是本地墙上时间；转成 ISO 让服务端按绝对时间存
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.activityType.trim() ? { activityType: form.activityType.trim() } : {}),
        ...(form.organizer.trim() ? { organizer: form.organizer.trim() } : {}),
        ...(form.externalLink.trim() ? { externalLink: form.externalLink.trim() } : {}),
        ...(form.coverImageId ? { coverImageId: form.coverImageId } : {}),
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

  async function setStatus(id: string, status: 'scheduled' | 'cancelled') {
    setBusy(true)
    setNotice('')
    try {
      const r = await adminUpdateActivity(id, { status })
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
        <button className="adm__btn adm__btn--primary" data-admin-new-activity onClick={() => setForm({ ...EMPTY_FORM })}>
          新建活动
        </button>
        <button className="adm__chip adm__chip--ghost" onClick={() => void reload()}>
          刷新
        </button>
      </div>

      <PaneState
        phase={phase}
        err={err}
        onRetry={() => void reload()}
        empty={phase === 'ready' && (data ?? []).length === 0 ? '还没有活动' : undefined}
      />

      {phase === 'ready' && (data ?? []).length > 0 && (
        <ul className="adm__list" data-admin-activities={String((data ?? []).length)}>
          {(data ?? []).map((a) => (
            <li key={a.id} className="adm__card" data-admin-activity={a.id} data-activity-status={a.effectiveStatus}>
              <div className="adm__cardHead">
                <span className="adm__tag">{a.place.name}</span>
                <span className={`adm__tag ${a.status === 'cancelled' ? 'adm__tag--danger' : ''}`}>
                  {a.status === 'cancelled' ? '已取消' : '正常'}
                </span>
                <span className="adm__tag adm__tag--ghost">展示态：{a.effectiveStatus}</span>
              </div>
              <p className="adm__cardBody">{a.title}</p>
              <p className="adm__cardMeta">
                {new Date(a.startsAt).toLocaleString()} · 来源：{a.source}
              </p>
              <div className="adm__actions">
                {a.status === 'scheduled' ? (
                  <button className="adm__btn adm__btn--danger" data-activity-cancel={a.id} disabled={busy} onClick={() => void setStatus(a.id, 'cancelled')}>
                    取消活动
                  </button>
                ) : (
                  <button className="adm__btn" data-activity-restore={a.id} disabled={busy} onClick={() => void setStatus(a.id, 'scheduled')}>
                    恢复
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div className="adm__modalWrap" data-admin-activity-modal>
          <div className="adm__modal">
            <h3 className="adm__modalTitle">新建活动</h3>
            <p className="adm__modalDesc">
              地点必须是**已启用**的预设地点；结束时间可选，但必须晚于开始时间。
            </p>
            <input
              className="adm__input"
              data-activity-title
              placeholder="活动标题（必填）"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <select
              className="adm__input"
              data-activity-place
              value={form.placeId}
              onChange={(e) => setForm({ ...form, placeId: e.target.value })}
            >
              <option value="">选择地点（必填）</option>
              {enabledPlaces.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.category}）
                </option>
              ))}
            </select>
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
              placeholder="活动类型（可选；取值集待评审，暂为自由文本）"
              maxLength={40}
              value={form.activityType}
              onChange={(e) => setForm({ ...form, activityType: e.target.value })}
            />
            <input
              className="adm__input"
              data-activity-organizer
              placeholder="主办方（可选）"
              maxLength={60}
              value={form.organizer}
              onChange={(e) => setForm({ ...form, organizer: e.target.value })}
            />
            <input
              className="adm__input"
              data-activity-external
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
              <button className="adm__btn" onClick={() => setForm(null)} disabled={busy}>
                取消
              </button>
              <button className="adm__btn adm__btn--primary" data-activity-submit onClick={() => void submit()} disabled={busy}>
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
// 地点管理
// ---------------------------------------------------------------------------

function PlacesPanel() {
  const { data, phase, err, reload } = useLoader<ApiAdminPlace[]>(() => adminListPlaces())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<{ name: string; category: '地标' | '食堂'; description: string } | null>(null)

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
              onChange={(e) => setForm({ ...form, category: e.target.value as '地标' | '食堂' })}
            >
              <option value="地标">地标</option>
              <option value="食堂">食堂</option>
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
