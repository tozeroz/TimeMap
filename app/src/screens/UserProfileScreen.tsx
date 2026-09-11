import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChatBubble, IconMore } from '../components/icons'
import { postsByUser, users } from '../data/mock'
import { PostCard } from './CampusScreen'
import { goBack, navigate } from '../router'
import './userprofile.css'

/**
 * 他人主页（原版：在校园广场点作者头像进入）。
 * 展示用户资料 + 他/她的动态，并提供关注/私信。
 */
export function UserProfileScreen({ id }: { id: string }) {
  const user = users[id] ?? users.u1
  const mine = postsByUser(user.id)
  const [followed, setFollowed] = useState(false)

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          right={
            <button className="iconbtn" aria-label="更多">
              <IconMore size={20} />
            </button>
          }
        />
      }
      scroll
    >
      <section className="up__head">
        <img className="up__avatar" src={user.avatar} alt="" />
        <h2 className="up__name">{user.name}</h2>

        {(user.mbti || user.zodiac) && (
          <div className="up__tags">
            {user.mbti && <span className="tag">{user.mbti}</span>}
            {user.zodiac && <span className="tag tag--grey">{user.zodiac}</span>}
          </div>
        )}

        <p className="up__meta">
          {user.school}
          {user.college ? ` · ${user.college}` : ''}
        </p>
        {(user.major || user.grade) && (
          <p className="up__meta">
            {user.major}
            {user.major && user.grade ? ' · ' : ''}
            {user.grade}
          </p>
        )}

        <div className="up__actions">
          <button
            className={`up__follow ${followed ? 'is-on' : ''}`}
            onClick={() => setFollowed((v) => !v)}
          >
            {followed ? '已关注' : '关注'}
          </button>
          <button className="up__msg" onClick={() => navigate('chat', { id: 't1' })}>
            <IconChatBubble size={16} />
            <span>私信</span>
          </button>
        </div>
      </section>

      <section className="up__posts">
        <h3 className="up__section">TA 的动态 · {mine.length}</h3>
        {mine.length === 0 ? (
          <p className="up__empty">TA 还没有发布动态</p>
        ) : (
          <div className="up__grid">
            {mine.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </section>
    </Screen>
  )
}
