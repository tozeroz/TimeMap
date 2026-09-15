import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconEmoji, IconMore, IconPlus } from '../components/icons'
import { groups, me, type ChatMessage } from '../data/mock'
import { goBack, navigate } from '../router'
import './chat.css'
import './group.css'

/**
 * 群聊（对应原版 campusx://group），含 @面板（campusx://group/atPanel）。
 * 原版把 @面板做成了独立 Activity，这里用底部抽屉等价实现。
 */
export function GroupChatScreen() {
  const group = groups[0]
  const [messages, setMessages] = useState<ChatMessage[]>(group.messages)
  const [draft, setDraft] = useState('')
  const [atOpen, setAtOpen] = useState(false)

  function send() {
    const text = draft.trim()
    if (!text) return
    setMessages((prev) => [...prev, { id: `gm${Date.now()}`, from: 'me', text, time: '刚刚' }])
    setDraft('')
    setAtOpen(false)
  }

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('message')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center={
            <button className="grp__title" onClick={() => navigate('announce')}>
              <span className="grp__name">{group.name}</span>
              <span className="grp__count">{group.memberCount} 人</span>
            </button>
          }
          right={
            <button className="iconbtn" aria-label="更多">
              <IconMore size={20} />
            </button>
          }
        />
      }
      footer={
        <div className="grp__composer">
          {atOpen && (
            <div className="grp__atpanel no-scrollbar">
              {group.members.map((u) => (
                <button
                  key={u.id}
                  className="grp__at-item"
                  onClick={() => {
                    setDraft((d) => `${d}@${u.name} `)
                    setAtOpen(false)
                  }}
                >
                  <img src={u.avatar} alt="" />
                  <span>{u.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="chatbar">
            <button className="iconbtn" aria-label="表情">
              <IconEmoji size={22} />
            </button>
            <button
              className={`grp__at ${atOpen ? 'is-active' : ''}`}
              onClick={() => setAtOpen((v) => !v)}
              aria-label="@ 提醒"
            >
              @
            </button>
            <input
              className="chatbar__input"
              placeholder="发消息..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send()
              }}
            />
            <button className="iconbtn" aria-label="更多">
              <IconPlus size={22} />
            </button>
          </div>
        </div>
      }
      scroll
    >
      {group.notice && (
        <button className="grp__notice" onClick={() => navigate('announce')}>
          <span className="grp__notice-tag">群公告</span>
          <span className="grp__notice-text">{group.notice}</span>
        </button>
      )}

      <div className="chat">
        {messages.map((m) => (
          <div key={m.id} className={`chat__row chat__row--${m.from}`}>
            <img
              className="chat__avatar"
              src={m.from === 'me' ? me.avatar : group.members[0].avatar}
              alt=""
            />
            <div className={`bubble bubble--${m.from}`}>
              <span className="bubble__text">{m.text}</span>
              <span className="bubble__time">{m.time}</span>
            </div>
          </div>
        ))}
      </div>
    </Screen>
  )
}
