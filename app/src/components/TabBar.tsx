import { navigate } from '../router'
import { IconAt, IconMapTab, IconPaw, IconPlus } from './icons'
import './tabbar.css'

export type TabKey = 'me' | 'campus' | 'map'

export function TabBar({ active }: { active: TabKey }) {
  return (
    <nav className="tabbar">
      <button
        className={`tabbar__item ${active === 'me' ? 'is-active' : ''}`}
        onClick={() => navigate('me')}
      >
        <IconPaw size={22} />
        <span className="tabbar__label">自定义名称6</span>
      </button>
      <button
        className={`tabbar__item ${active === 'campus' ? 'is-active' : ''}`}
        onClick={() => navigate('campus')}
      >
        <IconAt size={22} />
        <span className="tabbar__label">校园</span>
      </button>
      <button
        className={`tabbar__item ${active === 'map' ? 'is-active' : ''}`}
        onClick={() => navigate('map')}
      >
        <IconMapTab size={22} />
        <span className="tabbar__label">地图</span>
      </button>
      <button className="tabbar__fab" onClick={() => navigate('publish')} aria-label="发布">
        <IconPlus size={22} />
      </button>
    </nav>
  )
}
