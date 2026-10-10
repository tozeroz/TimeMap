import { useEffect, useState } from 'react'
import { avatarFor, listMyFavorites, mediaUrl, relativeTime, type ApiPost } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconHeart, IconStar } from '../components/icons'
import { goBack, navigate } from '../router'
import './favorites.css'

/**
 * 我的收藏（F05 / US-03）。
 *
 * 验收标准：「收藏内容可在个人中心查看，**取消后移除**」。
 *
 * ## 两条关键行为
 *   ① 列表只含**仍公开**的帖子 —— 服务端已经按 status='published' 过滤，
 *      被下架/删除的收藏会自然消失。这是 US-08「下架后同步退出各展示入口」的一部分，
 *      **不是**数据丢了，所以空态文案不能说"你还没有收藏"就完事 ——
 *      如果用户确实收藏过、只是内容被下架了，那样说是误导。
 *   ② 取消收藏用**服务端返回的权威计数**，并**重新拉取列表**（而不是本地 filter 掉）。
 *      本地 filter 看起来更"跟手"，但一旦服务端拒绝了这次取消（例如未登录、并发），
 *      界面就会显示一个服务端并不认可的状态 —— 那是假成功。
 */
export function FavoritesScreen() {
  const [items, setItems] = useState<ApiPost[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errText, setErrText] = useState('')

  async function load() {
    setPhase('loading')
    const r = await listMyFavorites()
    if (r.ok) {
      setItems(r.value)
      setPhase('ready')
      setErrText('')
    } else {
      setItems([])
      setErrText(r.status === 401 ? '请先登录后查看收藏' : r.reason)
      setPhase('error')
    }
  }

  useEffect(() => {
    void load()
  }, [])

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

      {phase === 'ready' && items.length === 0 && (
        <div className="fav__state" data-fav-phase="empty">
          <p>还没有收藏内容</p>
          <p className="fav__stateSub">
            在地点详情或帖子页点「收藏」即可加入这里。已下架的内容不会出现在这里。
          </p>
          <button className="fav__retry" onClick={() => navigate('map')}>
            去地图看看
          </button>
        </div>
      )}

      {phase === 'ready' && items.length > 0 && (
        <ul className="fav__list" data-fav-phase="ready" data-fav-count={String(items.length)}>
          {items.map((p) => (
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
    </Screen>
  )
}
