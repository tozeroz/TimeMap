import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { useTm } from '../components/TmPostCard'
import { ACTIVITY_STATUS_LABEL, activityStatus, formatRange, relativeTime } from '../data/timemap'
import { getActivity, getPlace } from '../data/tmStore'
import { goBack, navigate } from '../router'

/**
 * 活动详情（F06 / US-04）：
 * - 标题 / 时间 / 地点 / 主办方 / 来源与更新时间 / 状态 完整一致
 * - [查看举办地点] → 地点详情（从地点还能回到地图）
 * - 已取消醒目标注；已结束仍可查看但明确标注状态
 * - 首版无报名、无支付、学生不可修改活动数据
 */
export function ActivityDetailScreen({ id }: { id: string }) {
  useTm()
  const a = getActivity(id)

  if (!a) {
    return (
      <Screen
        header={
          <TopBar
            left={
              <button className="iconbtn" onClick={() => goBack('activities')} aria-label="返回">
                <IconBack size={22} />
              </button>
            }
          />
        }
      >
        <div className="tm__statusPage">
          <h2>活动不存在</h2>
          <p>该活动可能已被移除。</p>
          <button className="tm__btnPrimary" onClick={() => navigate('activities')}>
            返回活动列表
          </button>
        </div>
      </Screen>
    )
  }

  const st = activityStatus(a)
  const place = getPlace(a.placeId)

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('activities')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="活动详情"
        />
      }
      footer={
        place ? (
          <div className="tm__placeFoot">
            <button className="tm__btnPrimary tm__btnPrimary--block" onClick={() => navigate('place', { id: place.id })}>
              查看举办地点 · {place.name}
            </button>
          </div>
        ) : undefined
      }
    >
      <article className="acd">
        <header className="acd__head">
          <h2 className="acd__title">{a.title}</h2>
          <span className={`tm__actBadge tm__actBadge--${st} tm__actBadge--big`}>{ACTIVITY_STATUS_LABEL[st]}</span>
        </header>

        <div className="acd__rows">
          <div className="acd__row">
            <span className="acd__label">时间</span>
            <span className="acd__value">{formatRange(a.startAt, a.endAt)}</span>
          </div>
          <div className="acd__row">
            <span className="acd__label">地点</span>
            <button className="acd__placeBtn" onClick={() => place && navigate('place', { id: place.id })}>
              {place?.name ?? '未知地点'}
              {place ? ` · ${place.category}` : ''}
            </button>
          </div>
          <div className="acd__row">
            <span className="acd__label">主办方</span>
            <span className="acd__value">{a.organizer}</span>
          </div>
          <div className="acd__row">
            <span className="acd__label">信息来源</span>
            <span className="acd__value">
              {a.source}（更新于 {relativeTime(a.sourceUpdatedAt)}）
            </span>
          </div>
        </div>

        <p className="acd__desc">{a.description}</p>

        {a.cancelled && (
          <p className="acd__cancelledNote">该活动已取消：取消的活动会醒目标注，并退出近期推荐。</p>
        )}
        {st === 'ended' && <p className="acd__endedNote">活动已结束，信息保留供查看。</p>}

        <p className="acd__note">
          首版仅提供活动浏览与地点导航，不提供报名、支付入口；如信息有变化，以主办方最新通知为准。
        </p>
      </article>
    </Screen>
  )
}
