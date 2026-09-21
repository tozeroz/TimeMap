import { useEffect, useState } from 'react'
import { getSession } from '../api/session'
import { navigate } from '../router'
import { IconAt, IconMapTab, IconPaw, IconPlus } from './icons'
import './tabbar.css'

export type TabKey = 'me' | 'campus' | 'map'

/**
 * 底部 tab 栏。
 *
 * ## 证据（2026-09-21 用可复核 dump 更正过）
 *
 * 原版底部 tab 是 **4 项**：`校园广场` / `<当前账号昵称>` / `校园` / `地图`
 * —— 见 docs/original-baseline/raw-dumps/board-observation-1.xml（已入库可复核）。
 * 第二项的文案**动态跟随当前账号昵称**（dump 里那个账号昵称恰好是「自定义名称6」）；
 * 若把它硬编码成某个昵称，就是我们自己的 bug（换账号就错）。
 *
 * ⚠ **已知 deviation（见 docs/AUDIT-M0-M4.md 的 M5 deviation 登记）**：
 * 我们目前只有 **3 项**（昵称 / 校园 / 地图），**缺第一项「校园广场」**。
 * 这说明此前"原版三个 tab"的结论是**错的**（那份没有可复核产物，已被 supersede）。
 * 补这一项需要先只读观察原版「校园广场」页的内容与入口，不能凭猜 —— 另立一单。
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
