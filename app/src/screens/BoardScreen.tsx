import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconClose } from '../components/icons'
import { boardEmojis, boardNotes, me } from '../data/mock'
import { goBack } from '../router'
import './board.css'

export function BoardScreen() {
  const [notes, setNotes] = useState(boardNotes)
  const [draft, setDraft] = useState('')

  function post() {
    const text = draft.trim()
    if (!text) return
    setNotes((prev) => [
      { id: `b${Date.now()}`, author: me, text, time: '刚刚', color: '#ffd9e8' },
      ...prev,
    ])
    setDraft('')
  }

  return (
    <Screen
      header={
        <TopBar
          variant="plain"
          left={
            <button className="iconbtn" onClick={() => goBack('map')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center={
            <div className="board__headtitle">
              <span className="board__title">留言</span>
              <span className="board__sub">仅双方可见</span>
            </div>
          }
        />
      }
      footer={
        <div className="board__bar">
          <div className="board__emojis no-scrollbar">
            {boardEmojis.map((e) => (
              <button key={e} className="board__emoji" onClick={() => setDraft((d) => d + e)}>
                {e}
              </button>
            ))}
          </div>
          <div className="board__inputrow">
            <input
              className="board__input"
              placeholder="可以给同学留言噢"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') post()
              }}
            />
            <button className="board__send" onClick={post}>
              留言
            </button>
          </div>
        </div>
      }
      scroll
    >
      <div className="board__notes">
        {notes.map((n) => (
          <div key={n.id} className="note" style={{ background: n.color }}>
            <p className="note__text">{n.text}</p>
            <div className="note__foot">
              <img className="note__avatar" src={n.author.avatar} alt="" />
              <span className="note__name">{n.author.name}</span>
              <span className="note__time">{n.time}</span>
            </div>
          </div>
        ))}
        <p className="board__hint">留言仅双方可见</p>
      </div>
    </Screen>
  )
}
