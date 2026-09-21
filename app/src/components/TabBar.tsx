import { useEffect, useState } from 'react'
import { getSession } from '../api/session'
import { navigate } from '../router'
import { IconAt, IconMapTab, IconPaw, IconPlus } from './icons'
import './tabbar.css'

export type TabKey = 'me' | 'campus' | 'map'

/**
 * 底部第一个 tab 的文案 = **当前登录用户的昵称**。
 *
 * 1:1 依据（只读观察原版 TridentActivity 的底部导航 dump）：
 *   原版三个 tab 的文案就是「<当前账号昵称> / 校园 / 地图」——
 *   当时那个账号的昵称恰好是「自定义名称6」，所以看到的字面值就是它。
 *   **要点是"跟随登录身份"，不是那个字符串本身**：
 *   如果把它硬编码成某个昵称，就是我们自己的 bug（换个账号就错了）。
 *   未登录时给一个中性默认值。
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
        className={`tabbar__item ${active === 'me' ? 'is-active' : ''}`}
        onClick={() => navigate('me')}
      >
        <IconPaw size={22} />
        <span className="tabbar__label">{meLabel}</span>
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
