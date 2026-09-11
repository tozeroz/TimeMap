import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChevronDown, IconPlus, IconRefresh } from '../components/icons'
import { campusInfo, posts } from '../data/mock'
import { goBack, navigate } from '../router'
import { PostCard } from './CampusScreen'
import './feedlist.css'

/**
 * 校园圈（对应原版 campusx://feed/list）。
 *
 * 如实还原：原版这一页强依赖后端，在无网络/无登录时进入就是「网络错误」页
 * （路障图标 + 「网络不给力，点击刷新试试」+「刷新」按钮）——
 * 这是我们在模拟器上实测到的真实界面。
 * demo 是纯本地的，所以点「刷新」后展示本地 mock 内容，把这个状态闭环掉。
 */
export function FeedListScreen() {
  const [failed, setFailed] = useState(true)

  if (failed) {
    return (
      <Screen
        header={
          <TopBar
            left={
              <button className="iconbtn" onClick={() => goBack('campus')} aria-label="返回">
                <IconBack size={22} />
              </button>
            }
            center={
              <button className="fl__school">
                <span>{campusInfo.name}</span>
                <IconChevronDown size={13} />
              </button>
            }
            right={
              <button className="iconbtn" onClick={() => navigate('publish')} aria-label="发布">
                <IconPlus size={22} />
              </button>
            }
          />
        }
        scroll={false}
      >
        <div className="fl__error">
          <div className="fl__barrier" aria-hidden>
            <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M4 19h16" strokeLinecap="round" />
              <path d="M6.5 19 8 7.5h8L17.5 19" strokeLinejoin="round" />
              <path d="M9.5 7.5V5h5v2.5" />
              <path d="M8.6 11h6.8M8.3 14.5h7.4" strokeLinecap="round" />
              <circle cx="6" cy="20.6" r="1" />
              <circle cx="18" cy="20.6" r="1" />
            </svg>
          </div>
          <h2 className="fl__error-title">网络错误</h2>
          <p className="fl__error-desc">网络不给力，点击刷新试试</p>
          <button className="fl__retry" onClick={() => setFailed(false)}>
            <IconRefresh size={17} />
            <span>刷新</span>
          </button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center={
            <button className="fl__school">
              <span>{campusInfo.name}</span>
              <IconChevronDown size={13} />
            </button>
          }
          right={
            <button className="iconbtn" onClick={() => navigate('publish')} aria-label="发布">
              <IconPlus size={22} />
            </button>
          }
        />
      }
      scroll
    >
      <div className="campus__grid fl__grid">
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
