import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconChevronRight, IconEdit } from '../components/icons'
import { PostCard, useTm } from '../components/TmPostCard'
import { deletePost, getSession, logout, myFavorites, myPosts } from '../data/tmStore'
import { navigate } from '../router'

/**
 * 我的（F01 账号资料 / US-02 / US-03）：
 * - 个人资料卡（昵称 / 学院 / 年级 / 一句话介绍），可编辑
 * - 我的发布（可删除自己的帖子）、我的收藏（取消收藏即移除）
 * - 学生管理员可见「管理端」入口（US-08 权限边界）
 */
export function MeScreen() {
  useTm()
  const session = getSession()
  const profile = session?.profile
  const [tab, setTab] = useState<'posts' | 'favorites'>('posts')
  const posts = myPosts()
  const favorites = myFavorites()

  if (!profile) return null

  return (
    <Screen header={<TopBar variant="plain" center="我的" />}>
      {/* 资料卡 */}
      <section className="tme__profile">
        <img className="tme__avatar" src={profile.avatar} alt="" />
        <div className="tme__profileMain">
          <h2 className="tme__name">{profile.name}</h2>
          <p className="tme__meta">
            {profile.college}
            {profile.grade ? ` · ${profile.grade}` : ''}
          </p>
          {profile.bio && <p className="tme__bio">{profile.bio}</p>}
        </div>
        <button className="tme__editBtn" onClick={() => navigate('profile-edit')}>
          <IconEdit size={14} />
          编辑资料
        </button>
      </section>

      {session?.role === 'admin' && (
        <button className="tme__adminEntry" onClick={() => navigate('admin')}>
          <span className="tme__adminIcon" aria-hidden>
            ⚙
          </span>
          <span className="tme__adminText">管理端</span>
          <span className="tme__adminSub">举报处理 · 内容 · 地点 · 活动</span>
          <IconChevronRight size={16} />
        </button>
      )}

      {/* 统计 + 列表切换 */}
      <section className="tme__stats">
        <button className={`tme__stat ${tab === 'posts' ? 'is-active' : ''}`} onClick={() => setTab('posts')}>
          <strong>{posts.length}</strong>
          <span>我的发布</span>
        </button>
        <button
          className={`tme__stat ${tab === 'favorites' ? 'is-active' : ''}`}
          onClick={() => setTab('favorites')}
        >
          <strong>{favorites.length}</strong>
          <span>我的收藏</span>
        </button>
      </section>

      <section className="tme__list">
        {tab === 'posts' ? (
          posts.length === 0 ? (
            <div className="tm__empty">
              <p>还没有发布过内容</p>
              <span>从地图选一个地点，留下你的第一条校园记忆</span>
            </div>
          ) : (
            posts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                showPlace
                removedBadge
                onDelete={(id) => deletePost(id)}
              />
            ))
          )
        ) : favorites.length === 0 ? (
          <div className="tm__empty">
            <p>还没有收藏</p>
            <span>在帖子详情点 ☆ 收藏，之后会出现在这里</span>
          </div>
        ) : (
          favorites.map((p) => <PostCard key={p.id} post={p} showPlace />)
        )}
      </section>

      <button className="tme__logout" onClick={() => logout()}>
        退出登录
      </button>
      <div className="tme__spacer" />
    </Screen>
  )
}
