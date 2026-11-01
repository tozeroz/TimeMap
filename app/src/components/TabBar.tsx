import { navigate } from '../router'
import { IconCalendar, IconLocation, IconUser, IconUsers } from './icons'
import './tabbar.css'

/** Shared navigation; the visual labels keep their existing route destinations. */
export type TabKey = 'map' | 'feed' | 'activities' | 'me'
const tabs = [
  { key: 'map', route: 'map', label: '地图', Icon: IconLocation },
  { key: 'feed', route: 'campus', label: '广场', Icon: IconUsers },
  { key: 'activities', route: 'activities', label: '活动', Icon: IconCalendar },
  { key: 'me', route: 'me', label: '我的', Icon: IconUser },
] as const

export function TabBar({ active }: { active: TabKey }) {
  return <nav className={`tabbar ${active === 'activities' ? 'tabbar--activities' : ''}`} aria-label="主导航">
    {tabs.map(({ key, route, label, Icon }) => <button key={key}
      className={`tabbar__item ${active === key ? 'is-active' : ''}`} data-tab={key}
      aria-current={active === key ? 'page' : undefined} onClick={() => navigate(route)}>
      <Icon size={23} /><span className="tabbar__label">{label}</span>
    </button>)}
  </nav>
}
