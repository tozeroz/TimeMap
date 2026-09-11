import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconShare } from '../components/icons'
import { dailyFeed } from '../data/mock'
import { goBack, navigate } from '../router'
import './daily.css'

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
          center="今日打卡"
          right={
            <button className="iconbtn" aria-label="分享">
              <IconShare size={20} />
            </button>
          }
        />
      }
      scroll
    >
      <section className="daily__hero">
        <div className="daily__hero-brand">Campus</div>
        <div className="daily__hero-text">记录今天的小事</div>
      </section>

      <div className="daily__list">
        {dailyFeed.map((d) => (
          <button key={d.id} className="daily__card" style={{ background: d.color }}>
            <span className="daily__card-title">{d.title}</span>
            <span className="daily__card-desc">{d.desc}</span>
          </button>
        ))}
      </div>

      <div className="daily__cta">
        <button className="daily__cta-btn" onClick={() => navigate('publish')}>
          开始今天的记录
        </button>
      </div>
    </Screen>
  )
}
