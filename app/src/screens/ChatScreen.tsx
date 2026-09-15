import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconEmoji, IconMore, IconPlus } from '../components/icons'
import { me, threads, type ChatMessage } from '../data/mock'
import { goBack } from '../router'
import './chat.css'

export function ChatScreen({ id }: { id: string }) {
  const thread = threads.find((t) => t.id === id) ?? threads[0]
  const [messages, setMessages] = useState<ChatMessage[]>(thread.messages)
  const [draft, setDraft] = useState('')

  function send() {
    const text = draft.trim()
    if (!text) return
    setMessages((prev) => [
      ...prev,
      { id: `m${prev.length + 1}-${Date.now()}`, from: 'me', text, time: '刚刚' },
    ])
    setDraft('')
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
          center={thread.peer.name}
          right={
            <button className="iconbtn" aria-label="更多">
              <IconMore size={20} />
            </button>
          }
        />
      }
      footer={
        <div className="chatbar">
          <button className="iconbtn" aria-label="表情">
            <IconEmoji size={22} />
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
      }
      scroll
    >
      <div className="chat">
        {messages.map((m) => (
          <div key={m.id} className={`chat__row chat__row--${m.from}`}>
            {m.from === 'peer' && <img className="chat__avatar" src={thread.peer.avatar} alt="" />}
            {m.from === 'me' && <img className="chat__avatar" src={me.avatar} alt="" />}
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
