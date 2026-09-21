import { useEffect, useState } from 'react'
import { getSession } from '../api/session'
import { navigate } from '../router'
import { IconAt, IconMapTab, IconPaw, IconPlus } from './icons'
import './tabbar.css'

export type TabKey = 'me' | 'campus' | 'map'

/**
 * 底部 tab 栏。
 *
 * ## 证据（**2026-09-22 用 bounds 重读 dump 后更正**）
 *
 * 原版底部 tab 是 **3 项**：`<当前账号昵称>` / `校园` / `地图`
 *
 * 判据 = 把 dump 里**底部导航区（y≥1750）**的 text 节点连同 bounds 一起读出来：
 * ```
 * text='自定义名称6'  bounds=[100,249][1829,1868]
 * text='校园'         bounds=[360,414][1829,1868]
 * text='地图'         bounds=[572,626][1829,1868]
 * ```
 * 恰好 3 项，与我方一致。
 *
 * 第二项的文案**动态跟随当前账号昵称**（dump 里那个账号昵称恰好是「自定义名称6」）；
 * 若把它硬编码成某个昵称，就是我们自己的 bug（换账号就错）。
 *
 * ## ⚠️ 关于「校园广场」——它**不是** tab
 *
 * 本文件此前曾写着"原版 4 项、缺第一项「校园广场」、已登记 deviation"，
 * **那是错的，已撤回**。原因是当时**只数了 text 节点名、没有读 bounds**：
 * ```
 * text='校园广场'     bounds=[28,130][116,157]    ← y=130..157 → **顶部标题区**
 * ```
 * 「校园广场」是该页的**页面标题**（那一页就叫校园广场），不是底部 tab。
 * 因此 `TAB_ITEM_COUNT_CONFORMANCE = 一致（3 vs 3）`，**不存在**要补的 tab。
 *
 * 教训（值得留在代码里）：**几何/结构类结论必须读 bounds，不能只数节点名**；
 * 以及 **"引用了 raw_evidence" ≠ "读了 raw_evidence"**。
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
