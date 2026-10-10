import { useEffect, useState } from 'react'
import { getSession } from '../api/session'
import { navigate } from '../router'
import { IconAt, IconMapTab, IconPaw, IconPlus } from './icons'
import './tabbar.css'

/**
 * ⭐ TimeMap P0：三个 tab = **地图 / 活动 / 我的**（需求 4.1 地图首页草图底部）。
 *
 * 改前是「<昵称> / 校园 / 地图」——那是**复刻的另一个产品**（校园广场信息流）的 tab 栏，
 * 而 TimeMap 的信息架构是"以地点为内容组织单位"：从地图进入地点、再从地点看内容。
 * 需求 4.1 的草图底部逐字写的是 `[地图] [活动] [我的]`，且 4.3 的页面清单里
 * 没有"校园广场"这一类目。
 *
 * ⚠️ 边界（不要过度清理）：「校园广场」等复刻页**仍在仓库里**、路由也保留
 *    （campus/chat/board/daily/schools/… 都能通过 URL 到达），本轮只改**底部 tab 与默认路由**，
 *    没有删除那些页面 —— 删不删是另一件事，需要单独的证据与裁定。
 */
export type TabKey = 'map' | 'activities' | 'me'

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
      <button
        className={`tabbar__item ${active === 'activities' ? 'is-active' : ''}`}
        data-tab="activities"
        onClick={() => navigate('activities')}
      >
        <IconAt size={22} />
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
      {/*
        发布 FAB：
        ⚠️ 它是**通用入口**，不带 placeId —— 真正的"必须选地点"约束在 PublishScreen 内部
          （US-02 验收项①：地点为必填项，只能选择启用地点）。
          地点详情页的「在这里发布」会带 `?placeId=` 过来做预选，但仍可改。
      */}
      <button className="tabbar__fab" onClick={() => navigate('publish')} aria-label="发布">
        <IconPlus size={22} />
      </button>
    </nav>
  )
}
