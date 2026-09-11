import { Screen, TopBar } from '../components/Shell'
import { IconChatBubble, IconClose, IconPlus, IconSearch } from '../components/icons'
import { groups, me, threads, users } from '../data/mock'
import { goBack, navigate } from '../router'
import './message.css'

export function MessageScreen() {
  const suggestions = [users.u5, users.u6, users.u7, users.u8, users.u9, users.u10, users.u11]

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center="聊天"
          right={
            <button className="iconbtn" aria-label="新建">
              <IconPlus size={22} />
            </button>
          }
        />
      }
      scroll
    >
      {/* 校园卡邀请卡 */}
      <section className="invite">
        <div className="invite__head">
          <img className="invite__avatar" src={me.avatar} alt="" />
          <div>
            <div className="invite__title">分享我的校园卡</div>
            <div className="invite__sub">邀请同学一起加入 Campus!</div>
          </div>
        </div>
        <div className="invite__card">
          <div className="invite__brand">Campus</div>
          <div className="invite__info">
            <div className="invite__name">{me.name}</div>
            <div className="invite__meta">
              {me.college} · {me.grade}
            </div>
          </div>
        </div>
        <button className="invite__btn">邀请同学</button>
      </section>

      {/* 群聊入口（原版 campusx://group） */}
      <section className="list">
        {groups.map((g) => (
          <button key={g.id} className="row" onClick={() => navigate('group', { id: g.id })}>
            <span className="row__groupIcon" aria-hidden>
              <IconChatBubble size={22} />
            </span>
            <div className="row__main">
              <div className="row__title">{g.name}</div>
              <div className="row__sub">{g.notice}</div>
            </div>
            <div className="row__time">{g.memberCount} 人</div>
          </button>
        ))}
      </section>

      {/* 会话列表 */}
      <section className="list">
        {threads.map((t) => (
          <button key={t.id} className="row" onClick={() => navigate('chat', { id: t.id })}>
            <img className="row__avatar" src={t.peer.avatar} alt="" />
            <div className="row__main">
              <div className="row__title">
                {t.peer.name}
                <span className="tag tag--grey">相同学校</span>
              </div>
              <div className="row__sub">{t.lastMessage}</div>
            </div>
            <div className="row__time">
              {t.time}
              {t.unread > 0 && (
                <div style={{ marginTop: 5, display: 'flex', justifyContent: 'flex-end' }}>
                  <span className="badge">{t.unread}</span>
                </div>
              )}
            </div>
          </button>
        ))}
      </section>

      {/* 可能认识的同学 */}
      <section className="suggest">
        <header className="suggest__head">
          <h3 className="suggest__title">更多同学</h3>
          <button className="iconbtn" aria-label="搜索">
            <IconSearch size={18} />
          </button>
        </header>
        {suggestions.map((u) => (
          <div key={u.id} className="srow">
            <img className="srow__avatar" src={u.avatar} alt="" />
            <div className="srow__main">
              <div className="srow__name">
                {u.name}
                <span className="tag tag--grey">相同学校</span>
              </div>
              {u.mbti && (
                <div className="srow__meta">
                  {u.mbti} {u.zodiac}
                </div>
              )}
              <div className="srow__meta">
                {u.college}
                {u.major ? `-${u.major}` : ''}
              </div>
              <div className="srow__meta">{u.grade}</div>
            </div>
            <button className="srow__btn">打招呼</button>
          </div>
        ))}
      </section>
    </Screen>
  )
}
