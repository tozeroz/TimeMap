import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { useTm, useToast, Toast } from '../components/TmPostCard'
import { ACTIVITY_STATUS_LABEL, activityStatus, relativeTime } from '../data/timemap'
import {
  activities,
  addActivity,
  adminOps,
  allReports,
  cancelActivity,
  getPlace,
  isAdmin,
  isPlaceEnabled,
  listPlaces,
  postsAll,
  reportTargetPreview,
  resolveReport,
  restorePost,
  setPlaceEnabled,
  takedownPost,
  userById,
} from '../data/tmStore'
import { navigate } from '../router'

type AdminTab = 'reports' | 'content' | 'places' | 'activities' | 'ops'

/**
 * 管理端（F07 / US-08，学生管理员专用）：
 * - 举报处理：待处理列表；「不处理」或「下架」都必须填写原因
 * - 内容管理：下架/恢复帖子，均记录原因
 * - 地点管理：启用/停用（停用后不能再关联新帖子）
 * - 活动维护：录入（缺时间/地点不能发布）、取消
 * - 操作记录：管理员、对象、时间、动作、原因
 * - 普通用户不能进入（权限边界）
 */
export function AdminScreen() {
  useTm()
  const [tab, setTab] = useState<AdminTab>('reports')
  const [toast, showToast] = useToast()

  if (!isAdmin()) {
    return (
      <Screen
        header={
          <TopBar
            left={
              <button className="iconbtn" onClick={() => navigate('me')} aria-label="返回">
                <IconBack size={22} />
              </button>
            }
            center="管理端"
          />
        }
      >
        <div className="tm__statusPage">
          <h2>无权限</h2>
          <p>管理端仅对学生管理员开放。</p>
          <button className="tm__btnPrimary" onClick={() => navigate('me')}>
            返回我的
          </button>
        </div>
      </Screen>
    )
  }

  const pending = allReports().filter((r) => r.status === 'pending')
  const handled = allReports().filter((r) => r.status !== 'pending')

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => navigate('me')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="管理端"
        />
      }
    >
      <div className="adm__tabs no-scrollbar">
        {(
          [
            ['reports', `举报${pending.length ? ` (${pending.length})` : ''}`],
            ['content', '内容'],
            ['places', '地点'],
            ['activities', '活动'],
            ['ops', '操作记录'],
          ] as [AdminTab, string][]
        ).map(([key, label]) => (
          <button key={key} className={`adm__tab ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'reports' && (
        <section className="adm__section">
          <h3 className="adm__sectionTitle">待处理举报</h3>
          {pending.length === 0 && <div className="tm__empty"><p>没有待处理的举报</p></div>}
          {pending.map((r) => (
            <ReportCard key={r.id} reportId={r.id} onToast={showToast} />
          ))}
          {handled.length > 0 && (
            <>
              <h3 className="adm__sectionTitle">已处理</h3>
              {handled.map((r) => {
                const preview = reportTargetPreview(r)
                return (
                  <div key={r.id} className="adm__handled" data-status={r.status}>
                    <p className="adm__handledLabel">
                      {preview.label}
                      <span className={`adm__handledBadge adm__handledBadge--${r.status}`}>
                        {r.status === 'removed' ? '已下架' : '不处理'}
                      </span>
                    </p>
                    <p className="adm__handledMeta">
                      {r.category} · 原因：{r.handleReason} · {userById(r.reporterId).name} 举报于{' '}
                      {relativeTime(r.createdAt)}
                    </p>
                  </div>
                )
              })}
            </>
          )}
        </section>
      )}

      {tab === 'content' && <ContentTab onToast={showToast} />}
      {tab === 'places' && <PlacesTab onToast={showToast} />}
      {tab === 'activities' && <ActivitiesTab onToast={showToast} />}
      {tab === 'ops' && <OpsTab />}

      <Toast msg={toast} />
    </Screen>
  )
}

/** 单条待处理举报：不处理 / 下架都需要原因 */
function ReportCard({ reportId, onToast }: { reportId: string; onToast: (m: string) => void }) {
  useTm()
  const [mode, setMode] = useState<'none' | 'noaction' | 'remove'>('none')
  const [reason, setReason] = useState('')
  const reports = allReports()
  const r = reports.find((x) => x.id === reportId)
  if (!r || r.status !== 'pending') return null
  const preview = reportTargetPreview(r)

  function submit(action: 'noaction' | 'remove') {
    const res = resolveReport(reportId, action, reason)
    if (!res.ok) {
      onToast(res.error ?? '处理失败')
      return
    }
    onToast(action === 'remove' ? '已下架并记录' : '已标记不处理并记录')
  }

  return (
    <div className="adm__report">
      <p className="adm__reportTarget">{preview.label}</p>
      <p className="adm__reportMeta">
        举报分类：{r.category}
        {r.detail ? ` · 补充：${r.detail}` : ''} · {userById(r.reporterId).name} · {relativeTime(r.createdAt)}
        {preview.meta ? ` · ${preview.meta}` : ''}
      </p>
      {mode === 'none' ? (
        <div className="adm__reportActions">
          <button className="tm__btnGhost" onClick={() => setMode('noaction')}>
            不处理
          </button>
          <button className="tm__btnDanger" onClick={() => setMode('remove')}>
            下架
          </button>
        </div>
      ) : (
        <div className="adm__reasonBox">
          <input
            className="adm__reasonInput"
            placeholder={`填写${mode === 'remove' ? '下架' : '不处理'}原因（必填）`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={60}
          />
          <div className="adm__reportActions">
            <button className="tm__btnGhost" onClick={() => setMode('none')}>
              取消
            </button>
            <button
              className={mode === 'remove' ? 'tm__btnDanger' : 'tm__btnPrimary'}
              onClick={() => submit(mode)}
              disabled={!reason.trim()}
            >
              确认{mode === 'remove' ? '下架' : '不处理'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 内容管理：全部帖子，下架/恢复记录原因 */
function ContentTab({ onToast }: { onToast: (m: string) => void }) {
  useTm()
  const [action, setAction] = useState<{ id: string; kind: 'remove' | 'restore' } | null>(null)
  const [reason, setReason] = useState('')
  const list = postsAll()

  function submit() {
    if (!action) return
    const res =
      action.kind === 'remove' ? takedownPost(action.id, reason) : restorePost(action.id, reason)
    if (!res.ok) {
      onToast(res.error ?? '操作失败')
      return
    }
    onToast(action.kind === 'remove' ? '已下架' : '已恢复')
    setAction(null)
    setReason('')
  }

  return (
    <section className="adm__section">
      <h3 className="adm__sectionTitle">内容管理</h3>
      {list.map((p) => (
        <div key={p.id} className="adm__contentItem" data-status={p.status}>
          <div className="adm__contentMain">
            <p className="adm__contentText">{p.text || `（图文帖 · ${p.images.length} 图）`}</p>
            <p className="adm__contentMeta">
              {getPlace(p.placeId)?.name ?? '未知地点'} · {userById(p.authorId).name} · {relativeTime(p.createdAt)}
            </p>
          </div>
          {p.status === 'published' ? (
            action?.id === p.id && action.kind === 'remove' ? (
              <div className="adm__reasonBox">
                <input
                  className="adm__reasonInput"
                  placeholder="填写下架原因（必填）"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={60}
                />
                <div className="adm__reportActions">
                  <button className="tm__btnGhost" onClick={() => setAction(null)}>
                    取消
                  </button>
                  <button className="tm__btnDanger" onClick={submit} disabled={!reason.trim()}>
                    确认下架
                  </button>
                </div>
              </div>
            ) : (
              <button className="tm__btnDanger tm__btnDanger--sm" onClick={() => { setAction({ id: p.id, kind: 'remove' }); setReason('') }}>
                下架
              </button>
            )
          ) : action?.id === p.id && action.kind === 'restore' ? (
            <div className="adm__reasonBox">
              <input
                className="adm__reasonInput"
                placeholder="填写恢复原因（必填）"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={60}
              />
              <div className="adm__reportActions">
                <button className="tm__btnGhost" onClick={() => setAction(null)}>
                  取消
                </button>
                <button className="tm__btnPrimary" onClick={submit} disabled={!reason.trim()}>
                  确认恢复
                </button>
              </div>
            </div>
          ) : (
            <button className="tm__btnGhost tm__btnGhost--sm" onClick={() => { setAction({ id: p.id, kind: 'restore' }); setReason('') }}>
              恢复
            </button>
          )}
        </div>
      ))}
    </section>
  )
}

/** 地点管理：启用/停用 */
function PlacesTab({ onToast }: { onToast: (m: string) => void }) {
  useTm()
  const places = listPlaces()
  return (
    <section className="adm__section">
      <h3 className="adm__sectionTitle">地点管理</h3>
      <p className="adm__hint">停用后，该地点不能再关联新帖子；已有内容随举报处理另行处置。</p>
      {places.map((p) => {
        const on = isPlaceEnabled(p.id)
        return (
          <div key={p.id} className="adm__placeItem">
            <div className="adm__contentMain">
              <p className="adm__contentText">
                {p.name} <span className="adm__placeCat">（{p.category}）</span>
              </p>
              <p className="adm__contentMeta">{p.intro}</p>
            </div>
            <button
              className={`adm__toggle ${on ? 'is-on' : ''}`}
              onClick={() => {
                const res = setPlaceEnabled(p.id, !on)
                onToast(res.ok ? (on ? '已停用' : '已启用') : (res.error ?? '操作失败'))
              }}
            >
              <span className="adm__toggleKnob" />
              <span className="adm__toggleLabel">{on ? '启用中' : '已停用'}</span>
            </button>
          </div>
        )
      })}
    </section>
  )
}

/** 活动维护：录入 + 取消 */
function ActivitiesTab({ onToast }: { onToast: (m: string) => void }) {
  useTm()
  const [form, setForm] = useState({
    title: '',
    description: '',
    placeId: '',
    start: '',
    end: '',
    organizer: '',
    source: '',
  })
  const [open, setOpen] = useState(false)
  const list = activities()

  const ts = (v: string) => (v ? new Date(v).getTime() : 0)

  function submit() {
    const res = addActivity({
      title: form.title,
      description: form.description,
      placeId: form.placeId,
      startAt: ts(form.start),
      endAt: ts(form.end),
      organizer: form.organizer,
      source: form.source,
    })
    if (!res.ok) {
      onToast(res.error ?? '发布失败')
      return
    }
    onToast('活动已录入')
    setForm({ title: '', description: '', placeId: '', start: '', end: '', organizer: '', source: '' })
    setOpen(false)
  }

  return (
    <section className="adm__section">
      <div className="adm__sectionHead">
        <h3 className="adm__sectionTitle">活动维护</h3>
        <button className="tm__btnPrimary tm__btnPrimary--sm" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '录入活动'}
        </button>
      </div>

      {open && (
        <div className="adm__form">
          <input
            className="adm__input"
            placeholder="活动标题（必填）"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={40}
          />
          <textarea
            className="adm__input adm__input--area"
            placeholder="活动简介（选填）"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={200}
          />
          <select
            className="adm__input"
            value={form.placeId}
            onChange={(e) => setForm({ ...form, placeId: e.target.value })}
          >
            <option value="">选择举办地点（必选）</option>
            {listPlaces().map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（{p.category}）
              </option>
            ))}
          </select>
          <div className="adm__formRow">
            <label className="adm__formField">
              <span>开始时间</span>
              <input
                type="datetime-local"
                className="adm__input"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
              />
            </label>
            <label className="adm__formField">
              <span>结束时间</span>
              <input
                type="datetime-local"
                className="adm__input"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
              />
            </label>
          </div>
          <input
            className="adm__input"
            placeholder="主办方（如：校学生会）"
            value={form.organizer}
            onChange={(e) => setForm({ ...form, organizer: e.target.value })}
            maxLength={24}
          />
          <input
            className="adm__input"
            placeholder="信息来源（如：校学生会公众号）"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            maxLength={40}
          />
          <button className="tm__btnPrimary tm__btnPrimary--block" onClick={submit}>
            发布活动
          </button>
          <p className="adm__hint">缺标题、地点或有效时间的活动不会被发布（US-04）。</p>
        </div>
      )}

      {list.map((a) => {
        const st = activityStatus(a)
        const place = getPlace(a.placeId)
        return (
          <div key={a.id} className="adm__actItem" data-status={st}>
            <div className="adm__contentMain">
              <p className="adm__contentText">{a.title}</p>
              <p className="adm__contentMeta">
                {place?.name} · {a.organizer} · {ACTIVITY_STATUS_LABEL[st]}
              </p>
            </div>
            {!a.cancelled && st !== 'ended' && (
              <button
                className="tm__btnGhost tm__btnGhost--sm"
                onClick={() => {
                  const res = cancelActivity(a.id)
                  onToast(res.ok ? '已取消活动' : (res.error ?? '操作失败'))
                }}
              >
                取消活动
              </button>
            )}
          </div>
        )
      })}
    </section>
  )
}

/** 操作记录：管理员 / 对象 / 时间 / 动作 / 原因 */
function OpsTab() {
  useTm()
  const ops = adminOps()
  if (ops.length === 0) {
    return (
      <section className="adm__section">
        <h3 className="adm__sectionTitle">操作记录</h3>
        <div className="tm__empty">
          <p>还没有管理操作</p>
          <span>处理举报、下架内容、维护地点与活动后，记录会出现在这里</span>
        </div>
      </section>
    )
  }
  return (
    <section className="adm__section">
      <h3 className="adm__sectionTitle">操作记录（{ops.length}）</h3>
      {ops.map((op) => (
        <div key={op.id} className="adm__op">
          <p className="adm__opLine">
            <strong>{op.adminName}</strong> · {op.action} · {op.targetLabel}
          </p>
          <p className="adm__opMeta">
            {relativeTime(op.at)}（{new Date(op.at).toLocaleString()}）
            {op.reason ? ` · 原因：${op.reason}` : ''}
          </p>
        </div>
      ))}
    </section>
  )
}
