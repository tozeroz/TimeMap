import { useEffect, useState } from 'react'
import { failText, listPosts, me as fetchMe, toFeedPost } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconRefresh } from '../components/icons'
import type { FeedPost } from '../data/types'
import { goBack, navigate } from '../router'
import { PostCard } from './CampusScreen'
import './myposts.css'

/**
 * 「我的」→ 我的发布（ME-002）。
 *
 * ## 需求口径
 *   ME-001（已确认）：个人中心包含 **我的发布**。
 *   ME-002（已确认）：我的发布采用**双列瀑布流**。
 *   待讨论（故不实现）：已删除内容是否保留记录、下架内容与原因如何显示、排序与编辑入口。
 *
 * ## 为什么数据走 `GET /api/posts?authorId=…` 而不是新开一个 `/api/me/posts`
 *   服务端**已经有**按作者过滤的公开接口（`authorId` 参数，M5 WO#12 为"他人主页"加的）。
 *   "我的发布"与"TA 的动态"在数据上是**同一个查询**，只差参数 —— 再开一个端点会让
 *   两条路径的字段/过滤/排序各自演化，最后必然出现"我的页面和他看到的页面不一致"。
 *   ⇒ 复用公开接口，用**自己的 id** 过滤。
 *
 * ## 为什么**不**读离线快照（与校园流不同）
 *   校园流在请求失败时会显示"上次成功加载的内容"（快照）。但我自己的发布列表里
 *   **删除/下架是常态**：显示旧快照会让用户看见已经删掉的帖子，以为删除失败。
 *   ⇒ 这里失败就如实报错，不拿快照冒充。
 */
export function MyPostsScreen() {
  const [items, setItems] = useState<FeedPost[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'unauth'>('loading')
  const [errorText, setErrorText] = useState('')

  async function load(): Promise<void> {
    setPhase('loading')
    const u = await fetchMe()
    if (!u) {
      // 未登录：明确告诉用户"需要登录"，而不是显示"没有发布"（那是在撒谎）
      setPhase('unauth')
      return
    }
    const r = await listPosts({ authorId: u.id, sort: 'latest' })
    if (!r.ok) {
      setErrorText(failText(r))
      setPhase('error')
      return
    }
    setItems(r.value.map(toFeedPost))
    setPhase('ready')
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          center={<span className="mp__title" data-myposts-title>我的发布</span>}
        />
      }
      scroll
    >
      {phase === 'loading' && (
        <div className="mp__state" data-myposts-state="loading">
          <p className="mp__stateText">加载中…</p>
        </div>
      )}

      {phase === 'unauth' && (
        <div className="mp__state" data-myposts-state="unauth">
          <p className="mp__stateText">登录后才能查看我的发布</p>
          <button className="mp__primary" data-myposts-login onClick={() => navigate('loginselect')}>
            登录 TimeMap
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="mp__state" data-myposts-state="error">
          <p className="mp__stateText">加载失败：{errorText}</p>
          <button className="mp__primary" data-myposts-retry onClick={() => void load()}>
            <IconRefresh size={17} />
            <span>重试</span>
          </button>
        </div>
      )}

      {phase === 'ready' && (
        <>
          {items.length === 0 ? (
            <div className="mp__state" data-myposts-state="empty">
              <p className="mp__stateText">还没有发布任何内容</p>
              <button className="mp__primary" data-myposts-publish onClick={() => navigate('publish')}>
                去发布
              </button>
            </div>
          ) : (
            <>
              {/* 双列瀑布流（ME-002）：与校园流共用 .campus__grid（column-count: 2）与 PostCard */}
              <div className="campus__grid mp__grid" data-myposts-list>
                {items.map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </div>
              <p className="campus__end" data-myposts-end>
                已加载全部 · {items.length} 条动态
              </p>
            </>
          )}
        </>
      )}
    </Screen>
  )
}
