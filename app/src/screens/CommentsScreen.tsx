import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconComment, IconHeart, IconShare } from '../components/icons'
import { comments, posts } from '../data/mock'
import { goBack } from '../router'
import './comments.css'

/**
 * 评论详情（原版 CommentDetailActivity）。
 * 按原版实测：顶部是「返回 + 作者头像/昵称/日期 + 分享」，
 * 中部标题为「评论 N」，无评论时显示气泡图标 +「留下你的评论吧～」，
 * 底部输入框提示语「留下我的评论...」。
 */
export function CommentsScreen({ id }: { id: string }) {
  const post = posts.find((p) => p.id === id) ?? posts[0]
  // 有评论时展示列表；清空后即出现原版的空态（气泡 +「留下你的评论吧～」）
  const [list, setList] = useState(comments)
  const [draft, setDraft] = useState('')

  function send() {
    const text = draft.trim()
    if (!text) return
    setList((prev) => [...prev, { id: `c${Date.now()}`, author: post.author, text, time: '刚刚', likes: 0 }])
    setDraft('')
  }

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('feed')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center={
            <div className="cd__head">
              <img className="cd__avatar" src={post.author.avatar} alt="" />
              <div className="cd__headText">
                <span className="cd__name">{post.author.name}</span>
                <span className="cd__date">09-02</span>
              </div>
            </div>
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
          <input
            className="feed__input"
            placeholder="留下我的评论..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
          />
          <button className="cd__send" onClick={send} disabled={!draft.trim()}>
            发送
          </button>
        </div>
      }
      scroll
    >
      <div className="cd__body">
        <h3 className="cd__count">评论 {list.length}</h3>

        {list.length === 0 ? (
          <div className="cd__empty">
            <span className="cd__emptyIcon" aria-hidden>
              <IconComment size={44} />
            </span>
            <p className="cd__emptyText">留下你的评论吧～</p>
          </div>
        ) : (
          <div className="cd__list">
            {list.map((c) => (
              <div key={c.id} className="cmt">
                <img className="cmt__avatar" src={c.author.avatar} alt="" />
                <div className="cmt__body">
                  <div className="cmt__name">{c.author.name}</div>
                  <p className="cmt__text">{c.text}</p>
                  <div className="cmt__meta">
                    <span>{c.time}</span>
                  </div>
                </div>
                <span className="cmt__likes">
                  <IconHeart size={14} />
                  {c.likes}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Screen>
  )
}
