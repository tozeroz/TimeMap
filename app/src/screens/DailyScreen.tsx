import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconPlus, IconShare } from '../components/icons'
import { goBack, navigate } from '../router'
import './daily.css'

/**
 * 今日打卡（原版 DailyFeedListActivity）。
 * 按原版实测：顶栏只有返回 + 分享（无标题），
 * 下方是黄色品牌插画区，主体为空白（未打卡时），右下角是「+」悬浮按钮。
 */
export function DailyScreen() {
  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          right={
            <button className="iconbtn" aria-label="分享">
              <IconShare size={20} />
            </button>
          }
        />
      }
      scroll={false}
    >
      <div className="daily">
        {/* 黄色品牌插画区 */}
        <section className="daily__hero">
          <span className="daily__heroBrand">Campus</span>
          <span className="daily__heroMark" aria-hidden>
            <svg width="72" height="52" viewBox="0 0 72 52" fill="none">
              <ellipse cx="36" cy="26" rx="34" ry="24" fill="#2b2b2b" />
              <circle cx="26" cy="24" r="7" fill="#ffd166" />
              <circle cx="46" cy="24" r="7" fill="#ffd166" />
              <circle cx="26" cy="24" r="3" fill="#2b2b2b" />
              <circle cx="46" cy="24" r="3" fill="#2b2b2b" />
              <path d="M28 36c4 4 12 4 16 0" stroke="#ffd166" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </span>
        </section>

        {/* 未打卡时的空态 */}
        <section className="daily__body">
          <p className="daily__empty">今天还没有打卡记录</p>
          <p className="daily__emptySub">点右下角的 + 记录今天的小事</p>
        </section>

        <button className="daily__fab" onClick={() => navigate('publish')} aria-label="记录今天">
          <IconPlus size={22} />
        </button>
      </div>
    </Screen>
  )
}
