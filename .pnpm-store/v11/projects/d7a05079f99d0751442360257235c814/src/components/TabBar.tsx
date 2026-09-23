import { navigate } from '../router'
import { IconMapTab, IconPlus } from './icons'
import { IconFlag } from './icons-flag'
import { IconUser } from './icons-user'
import './tabbar.css'

/** 一级入口（设计文档 2.2 信息架构）：地图 / 活动 / 我的（管理端从「我的」进入） */
export type TabKey = 'map' | 'activities' | 'me'

export function TabBar({ active }: { active: TabKey }) {
  return (
    <nav className="tabbar">
      <button
        className={`tabbar__item ${active === 'map' ? 'is-active' : ''}`}
        onClick={() => navigate('map')}
      >
        <IconMapTab size={22} />
        <span className="tabbar__label">地图</span>
      </button>
      <button
        className={`tabbar__item ${active === 'activities' ? 'is-active' : ''}`}
        onClick={() => navigate('activities')}
      >
        <IconFlag size={22} />
        <span className="tabbar__label">活动</span>
      </button>
      <button
        className={`tabbar__item ${active === 'me' ? 'is-active' : ''}`}
        onClick={() => navigate('me')}
      >
        <IconUser size={22} />
        <span className="tabbar__label">我的</span>
      </button>
      <button className="tabbar__fab" onClick={() => navigate('publish')} aria-label="发布">
        <IconPlus size={22} />
      </button>
    </nav>
  )
}
