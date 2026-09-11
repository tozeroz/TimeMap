import { Screen } from '../components/Shell'
import { IconChevronRight } from '../components/icons'
import { upgradeInfo } from '../data/mock'
import { navigate } from '../router'
import './upgrade.css'

/** 升级弹窗（对应原版 campusx://upgradeAlert / AppUpdateDialogActivity） */
export function UpgradeDialog() {
  return (
    <Screen className="up" scroll={false}>
      <div className="up__mask">
        <div className="up__dialog">
          <div className="up__hero" aria-hidden>
            <span className="up__hero-text">Campus</span>
            <span className="up__hero-sub">发现新版本</span>
          </div>

          <div className="up__body">
            <h2 className="up__title">v{upgradeInfo.version}</h2>
            <p className="up__size">安装包 {upgradeInfo.size}</p>
            <ul className="up__list">
              {upgradeInfo.highlights.map((h) => (
                <li key={h} className="up__item">
                  <span className="up__dot" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="up__actions">
            <button className="up__later" onClick={() => navigate('campus')}>
              稍后再说
            </button>
            <button className="up__now" onClick={() => navigate('campus')}>
              立即更新
              <IconChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </Screen>
  )
}
