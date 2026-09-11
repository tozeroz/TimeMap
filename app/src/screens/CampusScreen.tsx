import { useState } from 'react'
import { BigTitle, Screen } from '../components/Shell'
import { IconChevronDown, IconChatBubble, IconHeart, IconComment } from '../components/icons'
import { campusInfo, posts, type FeedPost } from '../data/mock'
import { navigate } from '../router'
import './campus.css'

/** 瀑布流卡片 —— 有图无图两种形态 */
export function PostCard({ post }: { post: FeedPost }) {
  const [liked, setLiked] = useState(post.liked)
  const [likes, setLikes] = useState(post.likes)

  function toggleLike(e: React.MouseEvent) {
    e.stopPropagation()
    setLiked((v) => !v)
    setLikes((n) => (liked ? n - 1 : n + 1))
  }

  return (
    <article className="pcard" onClick={() => navigate('feed', { id: post.id })}>
      {post.images.length > 0 && (
        <div className={`pcard__media pcard__media--${Math.min(post.images.length, 2)}`}>
          {post.images.slice(0, 2).map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" />
          ))}
        </div>
      )}
      <div className="pcard__body">
        <p className="pcard__text">{post.text}</p>
        {post.topic && <span className="pcard__topic">{post.topic}</span>}
        <footer className="pcard__foot">
          <span className="pcard__author">
            <img className="pcard__avatar" src={post.author.avatar} alt="" />
            <span className="pcard__name">{post.author.name}</span>
          </span>
          <span className="pcard__meta">
            <button className={`pcard__like ${liked ? 'is-liked' : ''}`} onClick={toggleLike}>
              <IconHeart size={15} filled={liked} />
              <span>{likes}</span>
            </button>
            <span className="pcard__comment">
              <IconComment size={15} />
              <span>{post.comments}</span>
            </span>
          </span>
        </footer>
      </div>
    </article>
  )
}

export function CampusScreen() {
  const [tab, setTab] = useState<'推荐' | '最新' | '关注'>('推荐')

  return (
    <Screen
      header={
        <>
          <header className="campus__head">
            <BigTitle title="Campus" sub="校园广场" />
            <button className="iconbtn campus__msg" onClick={() => navigate('message')} aria-label="消息">
              <IconChatBubble size={22} />
            </button>
          </header>
          <div className="campus__filters no-scrollbar">
            {(['推荐', '最新', '关注'] as const).map((t) => (
              <button
                key={t}
                className={`campus__filter ${tab === t ? 'is-active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
            <button className="campus__filter campus__filter--more">
              <IconChevronDown size={13} />
            </button>
          </div>
        </>
      }
      scroll
    >
      <div className="campus__grid">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} />
        ))}
        <p className="campus__end">
          已加载全部 · {campusInfo.posts} 条动态
          <br />
          {campusInfo.name} · {campusInfo.members} 位同学
        </p>
      </div>
    </Screen>
  )
}
