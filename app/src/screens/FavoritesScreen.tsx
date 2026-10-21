import { useEffect, useState } from 'react'
import {
  avatarFor,
  listMyActivityFavorites,
  listMyFavorites,
  mediaUrl,
  relativeTime,
  type ApiActivity,
  type ApiPost,
  failText,
} from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconHeart, IconStar } from '../components/icons'
import { goBack, navigate } from '../router'
import { StatusBadge, formatActivityTime } from './ActivitiesScreen'
import './favorites.css'

/**
 * 我的收藏（F05 / US-03 帖子；F06 / US-04 活动）。
 *
 * 验收标准：「收藏内容可在个人中心查看，**取消后移除**」。
 *
 * ## 两个 tab
 *   活动与帖子的数据结构差太远（帖子是图片+点赞+评论；活动是时间+地点+状态），
 *   混在一个列表里排版会很别扭 ⇒ 分 tab。**默认落在「活动」**。
 *
 * ## 关键行为
 *   ① **帖子**：列表只含**仍公开**的帖子 —— 服务端已按 status='published' 过滤，
 *      被下架/删除的收藏会自然消失。这是 US-08「下架后同步退出各展示入口」的一部分，
 *      **不是**数据丢了，所以空态文案不能说"你还没有收藏"就完事 ——
 *      如果用户确实收藏过、只是内容被下架了，那样说是误导。
 *   ② **活动**：与帖子**有意不同** —— 已结束/已取消的活动**保留**在列表里。
 *      活动状态是服务端按时间推导的，大量活动会自然结束；收藏了却找不到才是
 *      真的坏体验。⇒ 靠 `effectiveStatus` 的状态徽标告知"这个已经不能去了"。
 *   ③ 取消收藏用**服务端返回的权威计数**，并**重新拉取列表**（而不是本地 filter 掉）。
 *      本地 filter 看起来更"跟手"，但一旦服务端拒绝了这次取消（例如未登录、并发），
 *      界面就会显示一个服务端并不认可的状态 —— 那是假成功。
 */
type FavTab = 'activity' | 'post'

export function FavoritesScreen() {
  const [tab, setTab] = useState<FavTab>('activity')
  const [posts, setPosts] = useState<ApiPost[]>([])
  const [acts, setActs] = useState<ApiActivity[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errText, setErrText] = useState('')

  async function load() {
    setPhase('loading')
    // 两个列表一起拉：tab 切换才能是瞬时的，不用每次转圈
    const [pr, ar] = await Promise.all([listMyFavorites(), listMyActivityFavorites()])
    if (!pr.ok || !ar.ok) {
      setPosts([])
      setActs([])
      const status = !pr.ok ? pr.status : !ar.ok ? ar.status : undefined
      const reason = !pr.ok ? failText(pr) : !ar.ok ? failText(ar) : ''
      setErrText(status === 401 ? '请先登录后查看收藏' : reason)
      setPhase('error')
      return
    }
    setPosts(pr.value)
    setActs(ar.value)
    setErrText('')
    setPhase('ready')
  }

  useEffect(() => {
    void load()
  }, [])

  const activeCount = tab === 'activity' ? acts.length : posts.length

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('me')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center={<span className="fav__topTitle">我的收藏</span>}
        />
      }
      scroll
    >
      {phase === 'loading' && <p className="fav__state">加载中…</p>}

      {phase === 'error' && (
        <div className="fav__state" data-fav-phase="error">
          <p>收藏加载失败</p>
          <p className="fav__stateSub">{errText}</p>
          <button className="fav__retry" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <>
          <div className="fav__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'activity'}
              className={`fav__tab ${tab === 'activity' ? 'is-active' : ''}`}
              data-fav-tab="activity"
              onClick={() => setTab('activity')}
            >
              活动 ({acts.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'post'}
              className={`fav__tab ${tab === 'post' ? 'is-active' : ''}`}
              data-fav-tab="post"
              onClick={() => setTab('post')}
            >
              帖子 ({posts.length})
            </button>
          </div>

          {activeCount === 0 && (
            <div className="fav__state" data-fav-phase="empty" data-fav-empty-tab={tab}>
              {tab === 'activity' ? (
                <>
                  <p>还没有收藏的活动</p>
                  <p className="fav__stateSub">
                    在活动页点「收藏」即可加入这里。已结束或已取消的活动也会保留，并标出状态。
                  </p>
                  <button className="fav__retry" onClick={() => navigate('activities')}>
                    去活动页看看
                  </button>
                </>
              ) : (
                <>
                  <p>还没有收藏内容</p>
                  <p className="fav__stateSub">
                    在地点详情或帖子页点「收藏」即可加入这里。已下架的内容不会出现在这里。
                  </p>
                  <button className="fav__retry" onClick={() => navigate('map')}>
                    去地图看看
                  </button>
                </>
              )}
            </div>
          )}

          {tab === 'activity' && acts.length > 0 && (
            <ul
              className="fav__list"
              data-fav-phase="ready"
              data-fav-list="activity"
              data-fav-count={String(acts.length)}
            >
              {acts.map((a) => (
                <li key={a.id}>
                  <button
                    className="fav__item"
                    data-fav-act-id={a.id}
                    data-fav-act-status={a.effectiveStatus}
                    onClick={() => navigate('activity', { id: a.id })}
                  >
                    <span className="fav__main">
                      <span className="fav__author">{a.title}</span>
                      <span className="fav__body">{formatActivityTime(a.startsAt, a.endsAt)}</span>
                      <span className="fav__meta">
                        <span className="fav__place">{a.place.name}</span>
                        <span>{a.source}</span>
                      </span>
                    </span>
                    {/* 展示态用与活动列表/详情**同一个** StatusBadge，三处不会漂移 */}
                    <StatusBadge status={a.effectiveStatus} />
                    {/* 这里每一条都必然是"我收藏过"的，所以恒亮 */}
                    <span className="fav__marks">
                      <span className="fav__mark fav__mark--on">
                        <IconStar size={13} filled />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {tab === 'post' && posts.length > 0 && (
            <ul
              className="fav__list"
              data-fav-phase="ready"
              data-fav-list="post"
              data-fav-count={String(posts.length)}
            >
              {posts.map((p) => (
                <li key={p.id}>
                  <button
                    className="fav__item"
                    data-fav-id={p.id}
                    data-fav-count={String(p.favoriteCount ?? 0)}
                    onClick={() => navigate('feed', { id: p.id })}
                  >
                    <img className="fav__avatar" src={avatarFor(p.author)} alt="" />
                    <span className="fav__main">
                      <span className="fav__author">{p.author}</span>
                      <span className="fav__body">{p.body}</span>
                      <span className="fav__meta">
                        {p.place && <span className="fav__place">{p.place}</span>}
                        <span>{relativeTime(p.createdAt)}</span>
                      </span>
                    </span>
                    {p.images && p.images.length > 0 && (
                      <img className="fav__thumb" src={mediaUrl(p.images[0]!.id)} alt="" loading="lazy" />
                    )}
                    <span className="fav__marks">
                      {(p.likeCount ?? 0) > 0 && (
                        <span className="fav__mark">
                          <IconHeart size={13} />
                          {p.likeCount}
                        </span>
                      )}
                      {/* 这里每一条都必然是"我收藏过"的，所以恒亮 —— 但**值**仍来自服务端 */}
                      <span className="fav__mark fav__mark--on">
                        <IconStar size={13} filled={p.favoritedByMe !== false} />
                        {p.favoriteCount ?? 0}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Screen>
  )
}
