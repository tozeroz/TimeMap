import { useEffect, useState } from 'react'
import {
  failText,
  favoriteActivity,
  getActivity,
  mediaUrl,
  unfavoriteActivity,
  type ApiActivity,
} from '../api/client'
import { isLoggedIn } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChevronRight, IconLocation, IconStar } from '../components/icons'
import { goBack, navigate } from '../router'
import { StatusBadge, formatActivityTime } from './ActivitiesScreen'
import './activities.css'

/**
 * 活动详情（F06 / US-04）。
 *
 * 验收标准逐条落点：
 *   ① 「活动列表和详情中的标题、时间、地点、来源及状态一致」
 *      ⇒ 本页与列表页**渲染同一组字段**（并且用同一个 StatusBadge 与时间格式化函数）。
 *        这一点是刻意做的：如果详情页自己写一套格式化，两边迟早会不一致。
 *   ② 「可从活动详情进入正确的举办地点」
 *      ⇒ 底部「查看地点」按服务端返回的 `place.id` 跳地点详情。
 *        ⚠️ 用 **id** 而不是地名文本 —— 地名可能重复/被改名，按文本跳会跳错地点。
 *   ③ 「缺少必要时间或地点时不能作为正式活动发布」
 *      ⇒ 这是**服务端**的约束（activities.place_id NOT NULL、starts_at NOT NULL，
 *        且 ends_at > starts_at 有 CHECK）。前端不重复实现该规则，只负责显示。
 *   ④ 「学生不能修改活动数据，首版没有报名和支付入口」
 *      ⇒ 本页**没有任何**编辑/报名/支付控件（有意为之，不是还没做）。
 *   ⑤ 「收藏内容可在个人中心查看」（契约 §4.5）
 *      ⇒ 标题右侧的星标可收藏/取消收藏。收藏按钮**不属于** ④ 的限制：
 *        收藏是对**自己的**书签，不改动活动数据。
 *        ⚠️ 收藏状态一律用服务端返回的 `favoritedByMe`，不在本地取反。
 */
export function ActivityDetailScreen({ id }: { id: string }) {
  const [act, setAct] = useState<ApiActivity | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading')
  const [errText, setErrText] = useState('')
  const [favBusy, setFavBusy] = useState(false)
  const [favMsg, setFavMsg] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!id) {
        setErrText('未指定活动（缺少 id 参数）')
        setPhase('error')
        return
      }
      setPhase('loading')
      const r = await getActivity(id)
      if (!alive) return
      if (r.ok) {
        setAct(r.value)
        setPhase('ready')
        return
      }
      // 404 = 这个活动确实不存在；其它失败 = 我们**不知道**是否存在（不许混为一谈）
      if (r.status === 404) {
        setPhase('not_found')
        return
      }
      setErrText(failText(r))
      setPhase('error')
    })()
    return () => {
      alive = false
    }
  }, [id])

  /**
   * 收藏 / 取消收藏（US-04）。与帖子收藏同三条纪律：
   *   ① 用服务端返回的 favorited 覆盖本地，不自己取反
   *   ② 未登录先跳登录，不发必然 401 的请求
   *   ③ 失败不本地假成功
   */
  async function toggleFavorite() {
    if (favBusy || !act) return
    if (!isLoggedIn()) {
      setFavMsg('请先登录后再收藏')
      navigate('loginselect')
      return
    }
    setFavBusy(true)
    try {
      const r = act.favoritedByMe ? await unfavoriteActivity(act.id) : await favoriteActivity(act.id)
      if (!r.ok) {
        setFavMsg(r.status === 503 ? '服务暂不可用，请稍后再试' : `操作失败：${failText(r)}`)
        return
      }
      setAct({ ...act, favoritedByMe: r.value.favorited })
      setFavMsg('')
    } finally {
      setFavBusy(false)
    }
  }

  const header = (
    <TopBar
      left={
        <button className="iconbtn" onClick={() => goBack('activities')} aria-label="返回">
          <IconBack size={22} />
        </button>
      }
    />
  )

  if (phase === 'loading') {
    return (
      <Screen header={header}>
        <p className="acts__state">加载中…</p>
      </Screen>
    )
  }

  if (phase === 'not_found') {
    return (
      <Screen header={header}>
        <div className="acts__state" data-act-phase="not_found">
          <p>活动不存在（可能已下架）</p>
          <button className="acts__retry" onClick={() => navigate('activities')}>
            返回活动列表
          </button>
        </div>
      </Screen>
    )
  }

  if (phase === 'error' || !act) {
    return (
      <Screen header={header}>
        <div className="acts__state" data-act-phase="error">
          <p>活动加载失败</p>
          <p className="acts__state-sub">{errText}</p>
          <button className="acts__retry" onClick={() => navigate('activities')}>
            返回活动列表
          </button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen header={header} scroll>
      <section className="actd" data-act-id={act.id} data-act-status={act.effectiveStatus}>
        {/*
          ACT-003：活动详情要含**封面**。
          没有封面时改前直接不渲染 ⇒ 详情页顶部空一块，字段看起来"缺了"。
          这里给一个**如实的占位**（纯色底 + 图标 + 文字），不塞任何假图。
        */}
        {act.coverImageId ? (
          <img
            className="actd__cover"
            data-act-cover={act.coverImageId}
            src={mediaUrl(act.coverImageId)}
            alt={`${act.title} 封面`}
          />
        ) : (
          <div className="actd__cover actd__cover--empty" data-act-cover="none">
            <span className="actd__coverEmptyText">暂无封面</span>
          </div>
        )}
        <div className="actd__titleRow">
          <h2 className="actd__title">{act.title}</h2>
          <StatusBadge status={act.effectiveStatus} />
          {/* 收藏（US-04）。状态值来自服务端 favoritedByMe，不在本地取反 */}
          <button
            type="button"
            className={`actd__fav ${act.favoritedByMe ? 'is-on' : ''}`}
            data-act-fav-id={act.id}
            data-act-fav-on={act.favoritedByMe ? 'true' : 'false'}
            aria-pressed={act.favoritedByMe}
            aria-label={act.favoritedByMe ? '取消收藏' : '收藏'}
            onClick={() => void toggleFavorite()}
          >
            <IconStar size={20} filled={act.favoritedByMe} />
          </button>
        </div>

        {favMsg && (
          <p className="actd__favmsg" data-act-fav-msg>
            {favMsg}
          </p>
        )}

        <dl className="actd__facts">
          <div className="actd__fact">
            <dt>时间</dt>
            <dd data-act-time>{formatActivityTime(act.startsAt, act.endsAt)}</dd>
          </div>
          <div className="actd__fact">
            <dt>地点</dt>
            <dd data-act-place={act.place.id}>{act.place.name}</dd>
          </div>
          {/* ACT-003：主办方。没有就不渲染这一行（不显示"—"之类的空占位） */}
          {act.organizer && (
            <div className="actd__fact">
              <dt>主办方</dt>
              <dd data-act-organizer>{act.organizer}</dd>
            </div>
          )}
          {/*
            ⚠️ 活动类型的**取值集**在 ACT-002 里是「待讨论」，所以这一行只是如实回显
               管理员填的自由文本；**没有**按它筛选/分组的功能，也**不是**枚举。
          */}
          {act.activityType && (
            <div className="actd__fact">
              <dt>类型</dt>
              <dd data-act-type>{act.activityType}</dd>
            </div>
          )}
          <div className="actd__fact">
            <dt>来源</dt>
            <dd data-act-source>{act.source}</dd>
          </div>
        </dl>

        {act.description && <p className="actd__desc">{act.description}</p>}

        {/*
          ACT-003：参与方式 = **仅展示外部链接**（不做站内报名）。
          ⚠️ 文档把「打开方式和风险提示」列为**待讨论** ⇒ 这里只取**最保守的默认**：
             普通锚点 + `target="_blank" rel="noreferrer noopener"`（新标签页、不带 referrer），
             **不**加任何自造的风险提示文案，也**不**做可达性探测（探测等于主动请求外站）。
             评审定下口径后，这个 `target` 与提示文案按结论改。
        */}
        {act.externalLink && (
          <p className="actd__link" data-act-external>
            <span className="actd__linkLabel">参与方式</span>
            <a className="actd__linkUrl" href={act.externalLink} target="_blank" rel="noreferrer noopener">
              {act.externalLink}
            </a>
          </p>
        )}

        {/*
          已取消/已结束的**显式提示**：不能只靠徽标颜色。
          已取消与已结束是不同的后果（取消是人工覆盖，可能改期重发）。
        */}
        {act.effectiveStatus === 'cancelled' && (
          <p className="actd__notice actd__notice--cancelled" data-act-notice="cancelled">
            该活动已取消，请勿按原时间前往。
          </p>
        )}
        {act.effectiveStatus === 'ended' && (
          <p className="actd__notice" data-act-notice="ended">
            该活动已结束。
          </p>
        )}

        {/* ②：从活动详情进入**正确的**举办地点（按 place.id 跳，不按地名） */}
        <button
          className="actd__placeBtn"
          data-act-goto-place={act.place.id}
          onClick={() => navigate('poidetail', { id: act.place.id })}
        >
          <IconLocation size={16} />
          <span>查看地点</span>
          <IconChevronRight size={16} />
        </button>

        {/*
          ④：首版**没有**报名/支付/投稿入口。这里不是"忘了做"，
             而是需求 §3.2 明确：「活动由管理员录入，首版不提供报名、支付和学生投稿」。
             写出来是为了让后续维护者一眼看到这是有意的边界。
        */}
        <p className="actd__nofeature">首版不提供站内报名、支付入口；参与方式仅展示外部链接。</p>
      </section>
    </Screen>
  )
}
