import { useState } from 'react'
import { BigTitle, Screen } from '../components/Shell'
import { IconChatBubble, IconHeart, IconComment } from '../components/icons'
import { campusInfo, posts, type FeedPost } from '../data/mock'
import { navigate } from '../router'
import './campus.css'

/**
 * 瀑布流卡片。
 * 对齐原版的两个关键点：
 * 1) 无图帖子 = 白底圆角卡片，文案 + 底部作者行
 * 2) 有图帖子 = 图片铺满，文案与作者信息**悬浮在图片上方**（不是图下白条）
 */
export function PostCard({ post }: { post: FeedPost }) {
  const [liked, setLiked] = useState(post.liked)
  const [likes, setLikes] = useState(post.likes)
  const hasImage = post.images.length > 0

  function toggleLike(e: React.MouseEvent) {
    e.stopPropagation()
    setLiked((v) => !v)
    setLikes((n) => (liked ? n - 1 : n + 1))
  }

  return (
    <article
      className={`pcard ${hasImage ? 'pcard--media' : 'pcard--text'}`}
      onClick={() => navigate('feed', { id: post.id })}
    >
      {hasImage ? (
        <>
          <img
            className="pcard__cover"
            src={post.images[0]}
            alt=""
            loading="lazy"
            style={post.ratio ? { aspectRatio: post.ratio } : undefined}
          />
          {/* 作者行悬浮在图片上方（原版：头像昵称在图片顶部） */}
          <div className="pcard__author-chip">
            <img className="pcard__avatar" src={post.author.avatar} alt="" />
            <span className="pcard__author-name">{post.author.name}</span>
          </div>
          {/* 正文压在底部深色蒙层上 */}
          <div className="pcard__overlay">
            <p className="pcard__overlay-text">{post.text}</p>
            <div className="pcard__overlay-foot">
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
            <img className="pcard__avatar" src={post.author.avatar} alt="" />
            <span className="pcard__name">{post.author.name}</span>
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

export function CampusScreen() {
  return (
    <Screen
      header={
        <header className="campus__head">
          <BigTitle title="Campus" sub="校园广场" />
          <button className="iconbtn campus__msg" onClick={() => navigate('message')} aria-label="消息">
            <IconChatBubble size={22} />
          </button>
        </header>
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
