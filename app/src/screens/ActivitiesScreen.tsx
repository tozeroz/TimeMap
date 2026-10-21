import { useCallback, useEffect, useState } from 'react'
import {
  failText,
  favoriteActivity,
  listActivities,
  listPlaces,
  unfavoriteActivity,
  type ActivityEffectiveStatus,
  type ApiActivity,
  type ApiPlaceListItem,
} from '../api/client'
import { isLoggedIn } from '../api/session'
import { Screen } from '../components/Shell'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLocation,
  IconRefresh,
  IconSearch,
  IconStar,
} from '../components/icons'
import { useRoute, navigate } from '../router'
import '../styles/switcher.css'
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
/** 活动状态筛选的取值：'' = 需求默认（即将开始 + 进行中），其余交给服务端 */
type StatusKey = '' | 'upcoming' | 'ongoing' | 'ended' | 'cancelled'

/**
 * 状态筛选项。顺序按需求 §9「默认展示即将开始和进行中；已结束和已取消可通过筛选查看」。
 * ⚠️ 「默认」不是一个状态，而是**服务端默认口径**（upcoming+ongoing）——
 *    文案不能写成"全部"，否则用户会以为点了能看到已结束的活动。
 */
const STATUS_OPTIONS: Array<{ key: StatusKey; label: string }> = [
  { key: '', label: '默认' },
  { key: 'upcoming', label: '即将开始' },
  { key: 'ongoing', label: '进行中' },
  { key: 'ended', label: '已结束' },
  { key: 'cancelled', label: '已取消' },
]

export function ActivitiesScreen() {
  const route = useRoute()
  /** 从地点面板「查看全部」进来时带的 placeId（`#/activities?placeId=`） */
  const [placeId, setPlaceId] = useState(() => route.query.placeId ?? route.path.split('/')[1] ?? '')
  /**
   * 列表数据。改前是 items + items 两份状态：items 由前端 effect
   * 从 items 二次过滤派生（这正是「已结束」恒为 0 的根因）。筛选搬到服务端后
   * 前端不再过滤 —— 只留**一份**状态，收藏状态更新也就不会漏掉列表。
   */
  const [items, setItems] = useState<ApiActivity[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errText, setErrText] = useState('')
  const [win, setWin] = useState<'' | 'today' | 'week'>('')
  /**
   * ⚠️ 状态筛选**必须交给服务端**（改前是前端二次过滤，导致「已结束」恒为 0）：
   *   服务端的默认查询有"近 7 天"窗口，会把更早结束的活动先剔除掉；
   *   前端再怎么 filter 也变不回来。所以「已结束/已取消」要由服务端解除窗口后再查。
   */
  const [status, setStatus] = useState<StatusKey>('')
  /** 地标筛选面板与候选地标（权威列表） */
  const [placeOpen, setPlaceOpen] = useState(false)
  const [places, setPlaces] = useState<ApiPlaceListItem[]>([])
  // 收藏：busy 防止连点；favMsg 用于如实提示失败（不本地假成功）
  const [favBusy, setFavBusy] = useState(false)
  const [favMsg, setFavMsg] = useState('')

  const load = useCallback(async () => {
    setPhase('loading')
    const r = await listActivities({
      ...(win ? { window: win } : {}),
      ...(status ? { status } : {}),
      ...(placeId ? { placeId } : {}),
    })
    if (r.ok) {
      setItems(r.value)
      setPhase('ready')
      setErrText('')
    } else {
      setItems([])
      setErrText(failText(r))
      setPhase('error')
    }
  }, [win, status, placeId])

  useEffect(() => {
    void load()
  }, [load])

  /** 候选地标：失败不影响列表，只是筛选面板里没得选（不编造地标名） */
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await listPlaces()
      if (!alive || !r.ok) return
      setPlaces(r.value)
    })()
    return () => {
      alive = false
    }
  }, [])

  /** 已在活动页时又从地点面板点了「查看全部」：组件不重挂，只能靠 route 同步 */
  const placeIdParam = route.query.placeId ?? ''
  useEffect(() => {
    setPlaceId((prev) => (prev === placeIdParam ? prev : placeIdParam))
  }, [placeIdParam])

  /**
   * 收藏 / 取消收藏（US-04）。三条纪律与帖子收藏一致（见 FeedDetailScreen.toggleFavorite）：
   *   ① 用**服务端返回**的 favorited 覆盖本地，不自己取反（撤销/重复/并发下本地推算会失真）
   *   ② 未登录先跳登录，不发必然 401 的请求
   *   ③ 失败**不本地假成功**：提示原因，界面维持服务端已知的状态
   */
  async function toggleFavorite(a: ApiActivity) {
    if (favBusy) return
    if (!isLoggedIn()) {
      setFavMsg('请先登录后再收藏')
      navigate('loginselect')
      return
    }
    setFavBusy(true)
    try {
      const r = a.favoritedByMe ? await unfavoriteActivity(a.id) : await favoriteActivity(a.id)
      if (!r.ok) {
        setFavMsg(r.status === 503 ? '服务暂不可用，请稍后再试' : `操作失败：${failText(r)}`)
        return
      }
      // 列表只有一份状态 ⇒ 直接更新即可（收藏心形立刻反映，不用重拉）
      setItems((prev) =>
        prev.map((x) => (x.id === a.id ? { ...x, favoritedByMe: r.value.favorited } : x)),
      )
      setFavMsg('')
    } finally {
      setFavBusy(false)
    }
  }

  /** 当前地标筛选的可读名称（面板按钮上要能让用户**认出**筛的是哪个地标） */
  const placeName = placeId ? (places.find((p) => p.id === placeId)?.name ?? '已选地标') : ''

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

      {/* 第二行：状态筛选（服务端过滤；「已结束」「已取消」不再恒为空） */}
      <div className="acts__filters" role="tablist">
        <span className="acts__filterLabel">状态</span>
        {STATUS_OPTIONS.map((f) => (
          <button
            key={f.key || 'default'}
            className={`acts__chip ${status === f.key ? 'is-active' : ''}`}
            data-act-status-filter={f.key || 'all'}
            role="tab"
            aria-selected={status === f.key}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 第三行：地标筛选（ACT-002；从地点面板进来时已生效，可清除） */}
      <div className="acts__filters">
        <span className="acts__filterLabel">地标</span>
        <button
          className={`acts__chip ${placeId ? 'is-active' : ''}`}
          data-act-place-open
          onClick={() => setPlaceOpen(true)}
        >
          {placeName || '全部地标'}
          <IconChevronDown size={13} />
        </button>
        {placeId && (
          <button className="acts__chip" data-act-place-clear onClick={() => setPlaceId('')}>
            清除
          </button>
        )}
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
      {phase === 'ready' && items.length === 0 && (
        <p className="acts__state" data-act-phase="empty">
          {placeId
            ? '这个地标暂无符合条件的活动，可清除地标筛选看全部'
            : win !== ''
              ? '这个时间段没有活动'
              : status === ''
                ? '近期没有活动（更早的活动可用「已结束」查看）'
                : '没有符合条件的活动'}
        </p>
      )}

      {/* 收藏失败的如实提示（不本地假成功） */}
      {favMsg && (
        <p className="acts__favmsg" data-act-fav-msg>
          {favMsg}
        </p>
      )}

      {phase === 'ready' && items.length > 0 && (
        <ul className="acts__list" data-act-phase="ready" data-act-count={String(items.length)}>
          {items.map((a) => (
            <li key={a.id} className="acts__row">
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
                    {/* ACT-003 / 需求 §9.1 草图：列表里地点后面紧跟主办方。没填就不占位 */}
                    {a.organizer && (
                      <>
                        <span className="acts__dot">·</span>
                        <span className="acts__itemOrganizer" data-act-organizer>
                          {a.organizer}
                        </span>
                      </>
                    )}
                  </span>
                  {/* 来源可追溯（US-04 验收项①：列表与详情的来源必须一致） */}
                  <span className="acts__itemSource">{a.source}</span>
                </span>
                <StatusBadge status={a.effectiveStatus} />
                <IconChevronRight size={16} />
              </button>
              {/*
                收藏按钮是**兄弟节点**而不是嵌在那个 button 里 —— 嵌套 button 是无效 HTML，
                点击内层还会连带触发外层 onClick（跳详情）。所以 li 是 flex 行：
                [卡片 flex:1] [收藏按钮]。
                ⚠️ 状态值用服务端返回的 favoritedByMe，不在本地取反。
              */}
              <button
                type="button"
                className={`acts__fav ${a.favoritedByMe ? 'is-on' : ''}`}
                data-act-fav-id={a.id}
                data-act-fav-on={a.favoritedByMe ? 'true' : 'false'}
                aria-pressed={a.favoritedByMe}
                aria-label={a.favoritedByMe ? `取消收藏 ${a.title}` : `收藏 ${a.title}`}
                onClick={() => void toggleFavorite(a)}
              >
                <IconStar size={18} filled={a.favoritedByMe} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {placeOpen && (
        <ActivityPlacePanel
          places={places}
          selected={placeId}
          onPick={(id) => {
            setPlaceId(id)
            setPlaceOpen(false)
          }}
          onClose={() => setPlaceOpen(false)}
        />
      )}
    </Screen>
  )
}

/**
 * 活动页的地标筛选面板（ACT-002：**单选** + 「全部地标」+ 名称搜索）。
 *
 * ## 为什么是单选而不是像校园流那样多选
 *   ACT-002 的原文只要求"支持地标筛选"，并说"从地点面板进入时自动筛选该地标，允许清除"；
 *   帖子那边（CAMP-003）才明确写了单选/多选两种都要。多选活动没有需求依据，
 *   而且"同时看两个地标的近期活动"在活动这种强时间序列的列表里意义不大。
 *   ⚠️ 这是**实现选择**，不是需求结论；若产品后续要改成多选，改这里即可。
 */
function ActivityPlacePanel({
  places,
  selected,
  onPick,
  onClose,
}: {
  places: ApiPlaceListItem[]
  selected: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const keyword = q.trim()
  const list = keyword ? places.filter((p) => p.name.includes(keyword)) : places
  return (
    <div className="switcher" data-act-place-panel>
      <div className="switcher__mask" onClick={onClose} />
      <div className="switcher__panel">
        <p className="switcher__title">按地标筛选活动</p>
        <div className="switcher__search">
          <IconSearch size={17} />
          <input
            className="switcher__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索地标名称"
            data-act-place-search
          />
        </div>
        <ul className="switcher__list no-scrollbar">
          <li>
            <button
              className={`switcher__item ${selected === '' ? 'is-current' : ''}`}
              data-act-place-option=""
              onClick={() => onPick('')}
            >
              <span className="switcher__name">全部地标</span>
            </button>
          </li>
          {list.map((p) => (
            <li key={p.id}>
              <button
                className={`switcher__item ${selected === p.id ? 'is-current' : ''}`}
                data-act-place-option={p.id}
                onClick={() => onPick(p.id)}
              >
                <span className="switcher__name">{p.name}</span>
                <span className="switcher__meta">{p.category}</span>
                {selected === p.id && <IconCheck size={16} />}
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="switcher__empty" data-act-place-empty>
              没有匹配「{keyword}」的地标
            </li>
          )}
        </ul>
      </div>
    </div>
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
