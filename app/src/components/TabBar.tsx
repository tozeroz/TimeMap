import { useEffect, useState } from 'react'
import { getSession } from '../api/session'
import { navigate } from '../router'
import { IconAt, IconComment, IconMapTab, IconPaw } from './icons'
import './tabbar.css'

/**
 * ⭐ TimeMap 底部四个 tab = **地图 / 帖子 / 活动 / 我**。
 *
 * ## 当前口径（用户 2026-09-26 明确要求，**以此为准**）
 *   需求文档 §4.1 的草图写的是三个 tab（[地图] [活动] [我的]），本轮按用户要求
 *   **加回第 4 个「帖子」**。⚠️ 这是**有意偏离需求草图**，处置方式：
 *   在 docs/test/TIMEMAP-P0-REPORT.md 与 WORKLOG 里**如实登记差异**，
 *   不去改需求文档、也不假装"草图本来就是四个"。
 *
 * ## 「帖子」指向 `#/campus`（校园广场，双列瀑布流）
 *   内容来自 `GET /api/posts` 的**权威数据**（不是 mock）。
 *   为什么不用 `#/feedlist`（校园圈）：那一页顶部是按**子页面**设计的
 *   （左上「关闭」→ 返回上一页），挂成底部 tab 后语义不对 —— tab 不该有"关闭"。
 *
 * ## 为什么删掉 tab 栏上的发布 FAB
 *   ① 地图页内部本来就有发布入口（`.map__fab`），两个悬浮发布按钮是冗余；
 *   ② 4 个 tab + 一个绝对定位 FAB（`.tabbar` 为此留了 72px padding）会把 tab 挤窄，
 *      且 FAB 有**压住最右侧 tab** 的隐患（本仓库为"FAB 压住 tab"已经改过一次 padding）。
 *   ⇒ 发布入口收敛为两种：地图页 FAB、地点详情页「在这里发布」。
 *
 * ⚠️ 边界（不要过度清理）：`campus / chat / board / daily / schools / feedlist` 等页面的
 *   **路由仍然保留**，本轮只改底部 tab 与默认路由。
 */
export type TabKey = 'map' | 'feed' | 'activities' | 'me'

/**
 * 「我的」tab 的文案跟随当前账号昵称（原版第二项就是这么做的：
 * dump 里那一项显示的是账号昵称「自定义名称6」，而不是固定文案）。
 * ⚠️ 不要把昵称硬编码成某个值：换账号就错。
 */
function useTabMeLabel(): string {
  const [label, setLabel] = useState('我')
  useEffect(() => {
    const apply = () => {
      const s = getSession()
      setLabel(s?.user?.displayName?.trim() || '我')
    }
    apply()
    // 登录/退出后要跟着变；用轻量的轮询 + storage 事件覆盖两种来源
    const onStorage = () => apply()
    window.addEventListener('storage', onStorage)
    const t = window.setInterval(apply, 1000)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.clearInterval(t)
    }
  }, [])
  return label
}

export function TabBar({ active }: { active: TabKey }) {
  const meLabel = useTabMeLabel()

  return (
    <nav className="tabbar">
      <button
        className={`tabbar__item ${active === 'map' ? 'is-active' : ''}`}
        data-tab="map"
        onClick={() => navigate('map')}
      >
        <IconMapTab size={22} />
        <span className="tabbar__label">地图</span>
      </button>
      {/*
        「帖子」= 校园广场瀑布流（#/campus）。
        用 IconAt（@）作为图标：IconPaw 是「我的」的语义，两个 tab 用同一个图标会分不清。
      */}
      <button
        className={`tabbar__item ${active === 'feed' ? 'is-active' : ''}`}
        data-tab="feed"
        onClick={() => navigate('campus')}
      >
        <IconAt size={22} />
        <span className="tabbar__label">帖子</span>
      </button>
      <button
        className={`tabbar__item ${active === 'activities' ? 'is-active' : ''}`}
        data-tab="activities"
        onClick={() => navigate('activities')}
      >
        <IconComment size={22} />
        <span className="tabbar__label">活动</span>
      </button>
      <button
        className={`tabbar__item ${active === 'me' ? 'is-active' : ''}`}
        data-tab="me"
        onClick={() => navigate('me')}
      >
        <IconPaw size={22} />
        <span className="tabbar__label">{meLabel}</span>
      </button>
    </nav>
  )
}
