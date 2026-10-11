import { useCallback, useEffect, useState } from 'react'
import { listActivities, type ActivityEffectiveStatus, type ApiActivity } from '../api/client'
import { Screen } from '../components/Shell'
import { IconChevronRight, IconLocation, IconRefresh } from '../components/icons'
import { useRoute, navigate } from '../router'
import './activities.css'

/**
 * 活动列表（F06 / US-04；需求 4.1 底部 tab 的第二项）。
 *
 * ## 数据纪律
 *   三态显式：loading / ready / error，**没有** mock 回落。
 *   ⚠️ 刻意**没有** `|| mockActivities` 这类兜底 —— 那正是本项目反复修掉的
 *      "用编造数据冒充真实"（WO#12/#13/#14 冻结的原则）。
 *
 * ## 状态与筛选
 *   · 状态徽标用服务端的 `effectiveStatus`（展示态），**不是** `status`（库存态）。
 *     两者不同：cancelled 活动在库存态里是 `cancelled`，而一条 `scheduled` 的活动
 *     现在可能正在 `ongoing`。前端按本地时间算会因为客户端时钟偏差而说谎。
 *   · 今天/本周筛选交给**服务端**（`window=today|week`）—— 与地点/帖子同一纪律：
 *     不在客户端 filter，否则加页之后会静默变成"不完整但看起来完整"。
 *   · 默认只展示"即将开始"和"进行中"的活动，由前端过滤实现。
 *   · 地点筛选：支持从地点详情页跳转时自动筛选该地点的活动。
 */
export function ActivitiesScreen() {
  const route = useRoute()
  const placeId = route.query.placeId ?? route.param ?? '' // 接收placeId参数
  const [items, setItems] = useState<ApiActivity[]>([])
  const [displayItems, setDisplayItems] = useState<ApiActivity[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errText, setErrText] = useState('')
  const [win, setWin] = useState<'' | 'today' | 'week'>('')
  const [statusFilter, setStatusFilter] = useState<ActivityEffectiveStatus[]>([])

  const load = useCallback(async () => {
    setPhase('loading')
    const r = await listActivities(win === '' ? undefined : win)
    if (r.ok) {
      setItems(r.value)
      setPhase('ready')
      setErrText('')
    } else {
      setItems([])
      setErrText(r.reason)
      setPhase('error')
    }
  }, [win])

  // 筛选逻辑
  useEffect(() => {
    let filtered = items

    // 地点筛选：如果从地点详情跳转而来，只显示该地点的活动
    if (placeId) {
      filtered = filtered.filter((a) => a.place.id === placeId)
    }

    // 状态筛选
    if (statusFilter.length === 0) {
      // "全部"状态：默认只显示即将开始和进行中的活动
      filtered = filtered.filter((a) => a.effectiveStatus === 'upcoming' || a.effectiveStatus === 'ongoing')
    } else {
      // 选择了特定状态
      filtered = filtered.filter((a) => statusFilter.includes(a.effectiveStatus))
    }

    setDisplayItems(filtered)
  }, [items, statusFilter, placeId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Screen
      header={
        <header className="acts__head">
          <h1 className="acts__title">活动</h1>
          <button className="iconbtn" onClick={() => void load()} aria-label="刷新">
            <IconRefresh size={20} />
          </button>
        </header>
      }
      scroll
    >
      {/* 第一行：时间筛选 */}
      <div className="acts__filters" role="tablist">
        <span className="acts__filterLabel">时间</span>
        {(
          [
            { key: '', label: '全部' },
            { key: 'today', label: '今天' },
            { key: 'week', label: '本周' },
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            className={`acts__chip ${win === f.key ? 'is-active' : ''}`}
            data-act-filter={f.key || 'all'}
            role="tab"
            aria-selected={win === f.key}
            onClick={() => setWin(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 第二行：状态筛选 */}
      <div className="acts__filters" role="tablist">
        <span className="acts__filterLabel">状态</span>
        <button
          className={`acts__chip ${statusFilter.length === 0 ? 'is-active' : ''}`}
          data-act-status-filter="all"
          onClick={() => setStatusFilter([])}
        >
          默认
        </button>
        <button
          className={`acts__chip ${statusFilter.includes('upcoming') && statusFilter.length === 1 ? 'is-active' : ''}`}
          data-act-status-filter="upcoming"
          onClick={() => setStatusFilter(['upcoming'])}
        >
          即将开始
        </button>
        <button
          className={`acts__chip ${statusFilter.includes('ongoing') && statusFilter.length === 1 ? 'is-active' : ''}`}
          data-act-status-filter="ongoing"
          onClick={() => setStatusFilter(['ongoing'])}
        >
          进行中
        </button>
        <button
          className={`acts__chip ${statusFilter.includes('ended') && statusFilter.length === 1 ? 'is-active' : ''}`}
          data-act-status-filter="ended"
          onClick={() => setStatusFilter(['ended'])}
        >
          已结束
        </button>
        <button
          className={`acts__chip ${statusFilter.includes('cancelled') && statusFilter.length === 1 ? 'is-active' : ''}`}
          data-act-status-filter="cancelled"
          onClick={() => setStatusFilter(['cancelled'])}
        >
          已取消
        </button>
      </div>

      {phase === 'loading' && <p className="acts__state">加载中…</p>}

      {phase === 'error' && (
        <div className="acts__state" data-act-phase="error">
          <p>活动加载失败</p>
          <p className="acts__state-sub">{errText}</p>
          <button className="acts__retry" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      {/*
        "诚实的空"：服务端确实没有近期活动时，这**不是**错误。
        ⚠️ 文案要说明**默认窗口的口径**（未结束的 + 7 天内结束的 + 近期取消的），
           否则用户会以为"学校没有活动"，而事实可能是"更早的活动按设计不在这里"。
      */}
      {phase === 'ready' && displayItems.length === 0 && (
        <p className="acts__state" data-act-phase="empty">
          {win === '' && statusFilter.length === 0
            ? '近期没有活动（更早的活动已退出近期列表）'
            : win === ''
            ? '没有符合条件的活动'
            : '这个时间段没有活动'}
        </p>
      )}

      {phase === 'ready' && displayItems.length > 0 && (
        <ul className="acts__list" data-act-phase="ready" data-act-count={String(displayItems.length)}>
          {displayItems.map((a) => (
            <li key={a.id}>
              <button
                className="acts__item"
                data-act-id={a.id}
                data-act-status={a.effectiveStatus}
                onClick={() => navigate('activity', { id: a.id })}
              >
                <span className="acts__itemMain">
                  <span className="acts__itemTitle">{a.title}</span>
                  <span className="acts__itemMeta">
                    <span>{formatActivityTime(a.startsAt, a.endsAt)}</span>
                    <span className="acts__dot">·</span>
                    <span className="acts__itemPlace">
                      <IconLocation size={13} />
                      {a.place.name}
                    </span>
                  </span>
                  {/* 来源可追溯（US-04 验收项①：列表与详情的来源必须一致） */}
                  <span className="acts__itemSource">{a.source}</span>
                </span>
                <StatusBadge status={a.effectiveStatus} />
                <IconChevronRight size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  )
}

/**
 * 状态徽标（US-04 验收项③：「已结束或取消活动按规则退出推荐或**明确标注**」）。
 *
 * ⚠️ `ended` 与 `cancelled` 都必须**明确标注**，而不是靠位置/颜色暗示：
 *    取消不是"结束了"，两者的后续行为不同（取消可能还会重排，结束不会）。
 */
export function StatusBadge({ status }: { status: ActivityEffectiveStatus }) {
  const label: Record<ActivityEffectiveStatus, string> = {
    upcoming: '即将开始',
    ongoing: '进行中',
    ended: '已结束',
    cancelled: '已取消',
  }
  return (
    <span className={`acts__badge acts__badge--${status}`} data-act-badge={status}>
      {label[status]}
    </span>
  )
}

/**
 * 时间展示：跨天时显示完整日期区间，同一天只显示一次日期。
 * ⚠️ 用**本地时区**格式化（用户看到的是自己的墙上时间）。
 */
export function formatActivityTime(startsAt: string, endsAt: string | null): string {
  const s = new Date(startsAt)
  if (Number.isNaN(s.getTime())) return '时间未知'
  const day = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`
  const hm = `${pad(s.getHours())}:${pad(s.getMinutes())}`
  if (!endsAt) return `${day} ${hm}`
  const e = new Date(endsAt)
  if (Number.isNaN(e.getTime())) return `${day} ${hm}`
  const sameDay =
    s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate()
  return sameDay
    ? `${day} ${hm}–${pad(e.getHours())}:${pad(e.getMinutes())}`
    : `${day} ${hm} – ${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())} ${pad(e.getHours())}:${pad(e.getMinutes())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
