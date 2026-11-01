import { useState } from 'react'
import type { FeedPost } from '../data/types'
import { navigate } from '../router'
import { IconHeart, IconImage, IconLocation } from './icons'

/** Shared author label and type-specific surfaces for the campus scrapbook. */
export function CampusPostCard({ post, pending, local, onLike, onRemove, onRepublish }: {
  post: FeedPost
  pending: boolean
  local: boolean
  onLike: () => void
  onRemove: () => void
  onRepublish: () => void
}) {
  const [broken, setBroken] = useState(false)
  const image = post.images[0]
  const sticker = post.imageMode === 'sticker'
  const paperVariant = Array.from(post.id).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 3
  return <article className={`square-card ${image ? 'square-card--image' : 'square-card--text'} ${sticker ? 'square-card--sticker' : ''} square-card--paper-${paperVariant} ${post.text.length <= 45 ? 'square-card--short' : ''}`} data-feed-id={post.id}>
    <button className="square-card__author" onClick={() => navigate('user', { id: post.author.id })} aria-label={`查看${post.author.name}的主页`}>
      <img src={post.author.avatar} alt="" loading="lazy" /><span>{post.author.name}</span>
    </button>
    <a className="square-card__open" href={`#/feed?id=${encodeURIComponent(post.id)}`} aria-label={`查看帖子：${post.text || '校园照片'}`}>
      {image ? <div className="square-card__media" style={{ aspectRatio: post.ratio || (sticker ? '4 / 5' : '1 / 1') }}>
        {broken ? <span className="square-card__unavailable"><IconImage size={28} />图片暂时无法显示</span> : <img src={image} alt={post.text ? '' : '校园照片'} loading="lazy" onError={() => setBroken(true)} />}
      </div> : <div className="square-card__paper"><p>{post.text || '一段校园回忆'}</p><svg viewBox="0 0 140 35" fill="none" aria-hidden="true"><path d="M3 23q22 18 46 0m8 3q18-25 39-12" stroke="currentColor" strokeWidth="1"/><path d="m109 26 19-22-4 15-15 7 2-14 17-8m-19 22-6 6" stroke="#ed6536" strokeWidth="1.5"/></svg></div>}
      {image && post.text && <h2 className="square-card__text">{post.text}</h2>}
    </a>
    <div className="square-card__info">
      {post.location && <p className="square-card__location"><IconLocation size={14} /><span>{post.location}</span></p>}
      <button className={`square-card__like ${post.liked ? 'is-liked' : ''}`} aria-label={`${post.liked ? '取消点赞' : '点赞'}，${post.likes} 赞`} aria-pressed={post.liked} disabled={pending || local} onClick={onLike}>
        <IconHeart size={20} filled={post.liked} /><span>{post.likes}</span>
      </button>
    </div>
    {local && <div className="square-card__local"><span>仅本机</span><button onClick={onRepublish}>重新发布</button><button onClick={onRemove}>删除</button></div>}
  </article>
}
