import { useEffect, useState } from 'react'
import { listPosts, readSnapshot, toFeedPost } from '../api/client'
import { BigTitle, Screen } from '../components/Shell'
import { IconChatBubble, IconComment, IconHeart, IconSearch } from '../components/icons'
// 注意：这里**不再** import mock 的 `posts` —— 校园页已迁移到真实 API，
// 在线时 API 是权威数据源（审核记录 07 的降级边界：已迁移页面不得混入 synthetic mock）。
import { campusInfo, schools, type FeedPost } from '../data/mock'
import { feedAuthoritative, setServerPosts, subscribeMyPosts } from '../data/store'
import { navigate } from '../router'
import './campus.css'

/**
 * 瀑布流卡片。
 * 对齐原版：
 * 1) 有图卡片：作者行在图片**上方**，正文压在图片底部
 * 2) 无图卡片：白底圆角，正文 + 作者行 + 互动数
 * 3) 点作者行进入 TA 的主页；点卡片进动态详情；点心形是点赞
 */
export function PostCard({
  post,
  liked: likedProp,
  onLike,
}: {
  post: FeedPost
  liked?: boolean
  onLike?: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
}) {
  const [localLiked, setLocalLiked] = useState(post.liked)
  const liked = likedProp ?? localLiked
  const likes = post.likes + (liked ? 1 : 0) - (post.liked ? 1 : 0)
  const hasImage = post.images.length > 0

  function toggleLike(e: React.MouseEvent) {
    e.stopPropagation()
    if (onLike) onLike((prev) => ({ ...prev, [post.id]: !liked }))
    else setLocalLiked((v) => !v)
  }

  function openAuthor(e: React.MouseEvent) {
    e.stopPropagation()
    navigate('user', { id: post.author.id })
  }

  return (
    <article
      className={`pcard ${hasImage ? 'pcard--media' : 'pcard--text'}`}
      onClick={() => navigate('feed', { id: post.id })}
    >
      {hasImage ? (
        <>
          <button className="pcard__author" onClick={openAuthor}>
            <img className="pcard__avatar" src={post.author.avatar} alt="" />
            <span className="pcard__author-name">{post.author.name}</span>
          </button>
          <div className="pcard__mediaWrap">
            <img
              className="pcard__cover"
              src={post.images[0]}
              alt=""
              loading="lazy"
              style={post.ratio ? { aspectRatio: post.ratio } : undefined}
            />
            <div className="pcard__overlay">
              <p className="pcard__overlay-text">{post.text}</p>
              <button
                className={`pcard__like pcard__like--on-image ${liked ? 'is-liked' : ''}`}
                onClick={toggleLike}
              >
                <IconHeart size={13} filled={liked} />
                <span>{likes}</span>
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="pcard__body">
          <p className="pcard__text">{post.text}</p>
          {post.topic && <span className="pcard__topic">{post.topic}</span>}
          <div className="pcard__foot">
            <button className="pcard__authorBtn" onClick={openAuthor}>
              <img className="pcard__avatar" src={post.author.avatar} alt="" />
              <span className="pcard__name">{post.author.name}</span>
            </button>
            <span className="pcard__meta">
              <button className={`pcard__like ${liked ? 'is-liked' : ''}`} onClick={toggleLike}>
                <IconHeart size={14} filled={liked} />
                <span>{likes}</span>
              </button>
              <span className="pcard__comment">
                <IconComment size={14} />
                <span>{post.comments}</span>
              </span>
            </span>
          </div>
        </div>
      )}
    </article>
  )
}

/** 学校切换面板（原版：点「校园广场 ▼」后出现「搜索其他学校」） */
function SchoolSwitcher({
  current,
  onPick,
  onClose,
}: {
  current: string
  onPick: (name: string) => void
  onClose: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const list = schools.filter((s) => (keyword ? s.name.includes(keyword) || s.region.includes(keyword) : true))

  return (
    <div className="switcher">
      <div className="switcher__mask" onClick={onClose} />
      <div className="switcher__panel">
        <div className="switcher__search">
          <IconSearch size={17} />
          <input
            className="switcher__input"
            placeholder="搜索其他学校"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            autoFocus
          />
        </div>
        <ul className="switcher__list no-scrollbar">
          {list.map((s) => (
            <li key={s.id}>
              <button
                className={`switcher__item ${s.name === current ? 'is-current' : ''}`}
                onClick={() => onPick(s.name)}
              >
                <span className="switcher__name">{s.name}</span>
                <span className="switcher__meta">
                  {s.region} · {s.members} 位同学
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="switcher__empty">没有找到「{keyword}」相关的学校</li>}
        </ul>
      </div>
    </div>
  )
}

export function CampusScreen() {
  const [school, setSchool] = useState(campusInfo.name)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [likedIds, setLikedIds] = useState<Record<string, boolean>>({})
  /**
   * 信息流状态（M3 Slice 1 收紧）：
   *   在线 → **API 是权威数据源**（不再混入 mock，避免"双真源"）
   *   离线 → 只降级到**最后一次成功的 API 快照**，并明确标注
   *   既无网络也无快照 → 显示「网络错误 + 刷新」（原版在这点上的行为就是这个）
   */
  const [feed, setFeed] = useState<FeedPost[]>(() => readSnapshot<FeedPost[]>('feed')?.value ?? [])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'offline' | 'error'>(() =>
    readSnapshot<FeedPost[]>('feed') ? 'offline' : 'loading',
  )

  useEffect(() => subscribeMyPosts(() => setFeed(feedAuthoritative())), [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const result = await listPosts()
      if (!alive) return
      if (result.ok) {
        const postsFromServer = result.value.map(toFeedPost)
        setServerPosts(postsFromServer)
        // 只在**成功**时写快照 —— 快照永远是"曾经真实成功过的响应"
        writeFeedSnapshot(feedAuthoritative())
        setFeed(feedAuthoritative())
        setPhase('ready')
      } else {
        // 失败时**不塞 mock**：有快照就显示快照，没有就如实报错
        const snap = readSnapshot<FeedPost[]>('feed')
        setFeed(snap?.value ?? [])
        setPhase(snap ? 'offline' : 'error')
        console.warn('[campus] 拉取帖子失败：', result.reason)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <Screen
      header={
        <header className="campus__head">
          <BigTitle title="Campus" sub={school} onSubClick={() => setSwitcherOpen(true)} />
          <button className="iconbtn campus__msg" onClick={() => navigate('message')} aria-label="消息">
            <IconChatBubble size={22} />
          </button>
        </header>
      }
      scroll
    >
      {phase === 'offline' && (
        <p className="campus__offline">
          离线：显示的是最后一次成功获取的服务器数据（非本地假数据），可能不是最新
        </p>
      )}

      {phase === 'error' && (
        <div className="campus__error">
          <p>网络错误</p>
          <button
            className="campus__retry"
            onClick={() => {
              setPhase('loading')
              void (async () => {
                const r = await listPosts()
                if (r.ok) {
                  setServerPosts(r.value.map(toFeedPost))
                  writeFeedSnapshot(feedAuthoritative())
                  setFeed(feedAuthoritative())
                  setPhase('ready')
                } else {
                  setPhase('error')
                }
              })()
            }}
          >
            刷新
          </button>
        </div>
      )}

      <div className="campus__grid">
        {feed.map((p) => (
          <PostCard key={p.id} post={p} liked={likedIds[p.id]} onLike={setLikedIds} />
        ))}
        {phase === 'ready' && (
          <p className="campus__end">
            已加载全部 · {feed.length} 条动态
            <br />
            {school}
          </p>
        )}
      </div>

      {switcherOpen && (
        <SchoolSwitcher
          current={school}
          onPick={(name) => {
            setSchool(name)
            setSwitcherOpen(false)
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
    </Screen>
  )
}

/** 信息流快照（只在 API 成功时写；见 readSnapshot 的说明） */
function writeFeedSnapshot(list: FeedPost[]): void {
  try {
    localStorage.setItem(
      'campus.demo.snapshot.v1:feed',
      JSON.stringify({ at: Date.now(), value: list }),
    )
  } catch {
    /* 容量满/隐私模式：快照是"最好有" */
  }
}
