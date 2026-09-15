import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack } from '../router'
import './announce.css'

const ANNOUNCEMENTS = [
  {
    id: 'a1',
    title: '校园广场内容规范更新',
    time: '今天 10:00',
    body: '为维护良好的校园交流氛围，我们对动态发布规范做了更新，请勿发布与校园生活无关的营销内容。',
    tag: '公告',
  },
  {
    id: 'a2',
    title: '图书馆四楼自习区开放时间调整',
    time: '昨天 18:30',
    body: '自本周起，四楼自习区开放时间调整为 7:30 - 22:30，请同学们合理安排。',
    tag: '通知',
  },
  {
    id: 'a3',
    title: '新生校园卡领取提醒',
    time: '3 天前',
    body: '尚未领取校园卡的同学请携带学生证到学生服务中心 2 号窗口领取。',
    tag: '提醒',
  },
]

export function AnnounceScreen() {
  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="校园公告"
        />
      }
      scroll
    >
      <div className="ann">
        {ANNOUNCEMENTS.map((a) => (
          <article key={a.id} className="ann__item">
            <header className="ann__head">
              <span className="ann__tag">{a.tag}</span>
              <span className="ann__time">{a.time}</span>
            </header>
            <h3 className="ann__title">{a.title}</h3>
            <p className="ann__body">{a.body}</p>
          </article>
        ))}
      </div>
    </Screen>
  )
}
