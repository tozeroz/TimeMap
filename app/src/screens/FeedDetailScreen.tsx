import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconComment, IconHeart, IconShare } from '../components/icons'
import { comments, posts } from '../data/mock'
import { goBack, navigate } from '../router'
import './feed.css'

/**
 * 动态详情（原版 FeedDetailActivity）。
 * 结构按原版实测：
 * - 顶部：返回 + 分享
 * - 作者行：头像 + 昵称 +「学校(校区) · 时间」
 * - 正文 + 配图
 * - 底部互动条：输入框「留下我的评论...」+ 点赞（心形+数字）+「评论」按钮
 */
export function FeedDetailScreen({ id }: { id: string }) {
  const post = posts.find((p) => p.id === id) ?? posts[0]
  const [liked, setLiked] = useState(post.liked)
  const likes = post.likes + (liked ? 1 : 0) - (post.liked ? 1 : 0)

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack()} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          right={
            <button className="iconbtn" aria-label="分享">
              <IconShare size={20} />
            </button>
          }
        />
      }
      footer={
        <div className="feed__bar">
          <input className="feed__input" placeholder="留下我的评论..." />
          <button
            className={`feed__action ${liked ? 'is-liked' : ''}`}
            onClick={() => setLiked((v) => !v)}
          >
            <IconHeart size={21} filled={liked} />
            <span>{likes}</span>
          </button>
          <button className="feed__action feed__action--text" onClick={() => navigate('comments', { id: post.id })}>
            <IconComment size={21} />
            <span>评论</span>
          </button>
        </div>
      }
      scroll
    >
      <article className="feed__post">
        <header className="feed__author">
          <img className="feed__avatar" src={post.author.avatar} alt="" />
          <div className="feed__author-main">
            <div className="feed__author-name">{post.author.name}</div>
            <div className="feed__author-meta">
              {post.author.school ?? '北京交通大学'} · {post.createdAt}
            </div>
          </div>
        </header>

        <p className="feed__text">{post.text}</p>
        {post.topic && <span className="feed__topic">{post.topic}</span>}

        {post.images.map((src, i) => (
          <img
            key={i}
            className="feed__image"
            src={src}
            alt=""
            onClick={() => navigate('media', { post: post.id, i: String(i) })}
          />
        ))}
      </article>

      <section className="feed__comments">
        <h3 className="feed__comments-title">共 {post.comments} 条评论</h3>
        {comments.map((c) => (
          <div key={c.id} className="cmt">
            <img className="cmt__avatar" src={c.author.avatar} alt="" />
            <div className="cmt__body">
              <div className="cmt__name">{c.author.name}</div>
              <p className="cmt__text">{c.text}</p>
              <div className="cmt__meta">
                <span>{c.time}</span>
                <span className="cmt__reply">回复</span>
              </div>
              {c.replies?.map((r) => (
                <div key={r.id} className="cmt cmt--reply">
                  <img className="cmt__avatar cmt__avatar--sm" src={r.author.avatar} alt="" />
                  <div className="cmt__body">
                    <div className="cmt__name">{r.author.name}</div>
                    <p className="cmt__text">{r.text}</p>
                    <div className="cmt__meta">
                      <span>{r.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <span className="cmt__likes">
              <IconHeart size={14} />
              {c.likes}
            </span>
          </div>
        ))}
      </section>
    </Screen>
  )
}
