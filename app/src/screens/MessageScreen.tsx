import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconChatBubble, IconClose, IconPlus, IconSearch } from '../components/icons'
import { groups, me, threads, users, type User } from '../data/mock'
import { goBack, navigate } from '../router'
import './message.css'

/**
 * 聊天页（原版 MessageActivity）。
 * 按原版实测：
 * - 顶部：左上关闭、中间「聊天」、右上加号
 * - 邀请卡：「分享我的校园卡」+「邀请同学一起加入 Campus!」+ 按钮「邀请同学」
 * - 更多同学：每行头像 + 昵称 + 标签/学院/年级 + **添加**按钮 + **移除**按钮
 *   - 点「添加」弹出「好友申请」弹窗（输入框预填「你好我是{我的昵称}」，字数 x/30，取消/发送）
 *   - 点「移除」把该同学从推荐列表移除，列表自动补位
 */
export function MessageScreen() {
  const [suggestions, setSuggestions] = useState<User[]>([
    users.u5,
    users.u6,
    users.u7,
    users.u8,
    users.u9,
    users.u10,
    users.u11,
    users.u1,
    users.u2,
  ])
  const [applied, setApplied] = useState<Record<string, boolean>>({})
  const [target, setTarget] = useState<User | null>(null)
  const [request, setRequest] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)

  function openRequest(user: User) {
    setTarget(user)
    setRequest(`你好我是${me.name}`)
  }

  function sendRequest() {
    if (!target) return
    setApplied((prev) => ({ ...prev, [target.id]: true }))
    setTarget(null)
    setRequest('')
  }

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
        <button className="invite__btn" onClick={() => setInviteOpen(true)}>
          邀请同学
        </button>
      </section>

      {/* 群聊入口 */}
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
            <button
              className={`srow__btn ${applied[u.id] ? 'is-done' : ''}`}
              onClick={() => !applied[u.id] && openRequest(u)}
            >
              {applied[u.id] ? '已申请' : '添加'}
            </button>
            <button
              className="srow__remove"
              onClick={() => setSuggestions((prev) => prev.filter((x) => x.id !== u.id))}
              aria-label="移除"
            >
              <IconClose size={16} />
            </button>
          </div>
        ))}
        {suggestions.length === 0 && <p className="suggest__empty">暂时没有更多推荐了</p>}
      </section>

      {/* 好友申请弹窗（原版实测：点「添加」后弹出） */}
      {target && (
        <div className="dialog">
          <div className="dialog__mask" onClick={() => setTarget(null)} />
          <div className="dialog__panel">
            <h3 className="dialog__title">好友申请</h3>
            <textarea
              className="dialog__input"
              value={request}
              maxLength={30}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="说一句话介绍自己"
            />
            <div className="dialog__count">
              {request.length}/30
            </div>
            <div className="dialog__actions">
              <button className="dialog__btn" onClick={() => setTarget(null)}>
                取消
              </button>
              <button className="dialog__btn dialog__btn--primary" onClick={sendRequest}>
                发送
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 邀请分享面板 */}
      {inviteOpen && (
        <div className="dialog">
          <div className="dialog__mask" onClick={() => setInviteOpen(false)} />
          <div className="dialog__sheet">
            <div className="dialog__sheetTitle">分享我的校园卡</div>
            <div className="dialog__targets">
              {['微信好友', '朋友圈', 'QQ', '复制链接', '二维码'].map((t) => (
                <button
                  key={t}
                  className="dialog__target"
                  onClick={() => setInviteOpen(false)}
                >
                  <span className="dialog__targetIcon">{t.slice(0, 1)}</span>
                  <span className="dialog__targetLabel">{t}</span>
                </button>
              ))}
            </div>
            <button className="dialog__cancel" onClick={() => setInviteOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </Screen>
  )
}
