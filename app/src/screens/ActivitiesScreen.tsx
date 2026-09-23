import { useMemo, useState } from 'react'
import { Screen } from '../components/Shell'
import { IconChevronRight } from '../components/icons'
import { useTm } from '../components/TmPostCard'
import { ACTIVITY_STATUS_LABEL, activityStatus, formatRange } from '../data/timemap'
import { activities, getPlace } from '../data/tmStore'
import { navigate } from '../router'

type RangeFilter = '全部' | '今天' | '本周'

const dayStart = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 近期活动列表（F06 / US-04）：
 * - 默认按「进行中 → 即将开始」时间优先排序；已结束/已取消退出近期列表，收纳到底部并醒目标注
 * - 支持按 今天 / 本周 筛选
 * - 每条活动展示 标题 / 时间 / 地点 / 状态，点击进入详情后可跳转举办地点
 */
export function ActivitiesScreen() {
  useTm()
  const [range, setRange] = useState<RangeFilter>('全部')
  const all = activities()

  const filtered = useMemo(() => {
    const now = Date.now()
    return all.filter((a) => {
      const st = activityStatus(a, now)
      if (st === 'cancelled' || st === 'ended') return range === '全部' // 历史区只在「全部」出现
      if (range === '今天') return a.startAt < dayStart(now) + 24 * 3600 * 1000 && a.endAt >= dayStart(now)
      if (range === '本周') return a.startAt < dayStart(now) + 7 * 24 * 3600 * 1000 && a.endAt >= now
      return true
    })
  }, [all, range])

  const current = filtered.filter((a) => {
    const st = activityStatus(a)
    return st === 'upcoming' || st === 'ongoing'
  })
  const history = filtered.filter((a) => {
    const st = activityStatus(a)
    return st === 'ended' || st === 'cancelled'
  })

  return (
    <Screen
      header={
        <header className="act__head">
          <div className="act__titlewrap">
            <h1 className="act__title">近期活动</h1>
            <button className="act__sub" onClick={() => navigate('map')}>
              <span>校园活动 · 时间优先</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 15.5 5.5 9h13L12 15.5Z" />
              </svg>
            </button>
          </div>
        </header>
      }
    >
      <div className="act__filters no-scrollbar">
        {(['全部', '今天', '本周'] as RangeFilter[]).map((r) => (
          <button key={r} className={`tm__chipBtn act__chip ${range === r ? 'is-active' : ''}`} onClick={() => setRange(r)}>
            {r}
          </button>
        ))}
      </div>

      {current.length === 0 && history.length === 0 && (
        <div className="tm__empty">
          <p>这个范围内暂无活动</p>
          <span>活动由学生管理员录入，信息标注来源与更新时间</span>
        </div>
      )}

      <div className="act__list">
        {current.map((a) => (
          <ActivityRow key={a.id} id={a.id} />
        ))}
      </div>

      {history.length > 0 && (
        <>
          <h3 className="act__historyTitle">已结束 / 已取消</h3>
          <div className="act__list act__list--history">
            {history.map((a) => (
              <ActivityRow key={a.id} id={a.id} />
            ))}
          </div>
        </>
      )}
      <div className="act__spacer" />
    </Screen>
  )
}

function ActivityRow({ id }: { id: string }) {
  useTm()
  const a = activities().find((x) => x.id === id)
  if (!a) return null
  const st = activityStatus(a)
  const place = getPlace(a.placeId)
  return (
    <button className="act__item" onClick={() => navigate('activity', { id: a.id })} data-status={st}>
      <div className="act__itemMain">
        <span className="act__itemTitle">{a.title}</span>
        <span className="act__itemTime">{formatRange(a.startAt, a.endAt)}</span>
        <span className="act__itemPlace">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s6.5-5.4 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.6 12 21 12 21Z" />
            <circle cx="12" cy="10.6" r="2.3" />
          </svg>
          {place?.name ?? '未知地点'} · {a.organizer}
        </span>
      </div>
      <span className={`tm__actBadge tm__actBadge--${st}`}>{ACTIVITY_STATUS_LABEL[st]}</span>
      <IconChevronRight size={16} />
    </button>
  )
}
