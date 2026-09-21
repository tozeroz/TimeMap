import { useEffect, useState } from 'react'
import { getBoardNotes, postBoardNote, relativeTime, type ApiBoardNote } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconClose } from '../components/icons'
import { boardEmojis, me } from '../data/mock'
import { goBack } from '../router'
import './board.css'

/**
 * 留言板（对应原版 message-board），M5 Slice 1：接真实 API。
 *
 * 一致性依据是**可采信**的只读证据（supplements/message-board.json）：
 *   标题「留言」+ 副标题「仅双方可见」、空态「可以给同学留言噢」、
 *   输入框占位「留言仅双方可见」、按钮「留言」。
 * 服务端也返回同样的口径字段（visibleTo / emptyText），前端直接沿用返回文案，
 * **避免把文案在前后端各写一份、将来漂移**。
 *
 * 隐私模型：只有**双方**能读到（服务端强制）。第三方拿到对方 user id 也只会得到空列表，
 * 而且返回 200 而不是 403 —— 不泄漏"这两人之间有没有留言"。
 *
 * ⚠ 已知缺口（如实记录，不在本文件里蒙混过去）
 *
 * 1) 【已解决 —— 此处原为过期结论，2026-09-21 更正】
 *    本注释曾写「只读证据记录原版**表情行恰好 7 个**，而 boardEmojis 是 6 个」。
 *    那是**照一条不可复算的旧记录下的判断**，它一度导致实现被错误地改成 7 个。
 *    回到可复核产物后确认：**原版就是 6 项** ——
 *      · `raw-dumps/message-board-dump.xml` 里 `emotion_image` 出现 **6** 次（可复算）
 *      · 且若存在第 7 项，按恒定 112 间距应位于 x=693..763，实测不存在
 *      · `docs/conformance/FINDING-board-emojis.md`: `ORIGINAL_TOTAL_EMOJI_COUNT: 6`
 *    → **项数这一条已经对齐**（我们 6 项、原版 6 项）。
 *
 * 2) 【仍未对齐，且属于结构层】形态不同：
 *    原版表情项在控件树里是 **`android.widget.ImageView`**（渲染随包 webp 图片），
 *    而这里把 emoji **字符**当文字直接渲染（`{e}`）。
 *    → 已按审核记录 30 收口：`C4_EMOJI_RENDERING_KIND: CONFIRMED — image-based`；
 *      结构层修复**已解冻**并另立 WO#4
 *      （`docs/m5/WO4-PLAN-emoji-rendering-structure.md`）。
 *      **具体用哪 6 张图仍未捕获**（`C4_EXACT_6_ASSETS: NOT_CAPTURED`），不得凭印象选。
 */
export function BoardScreen({ peerId }: { peerId: string }) {
  const [notes, setNotes] = useState<ApiBoardNote[]>([])
  const [draft, setDraft] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')
  const [emptyText, setEmptyText] = useState('可以给同学留言噢')
  const [busy, setBusy] = useState(false)

  async function load() {
    setState('loading')
    const r = await getBoardNotes(peerId)
    if (r.ok) {
      setNotes(r.value.items)
      setEmptyText(r.value.emptyText)
      setState('ready')
    } else {
      setErr(r.reason)
      setState('error')
    }
  }

  useEffect(() => {
    void load()
    // peerId 变化时重新拉取（同一页面切换留言对象）
  }, [peerId])

  async function post() {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    // **只提交 body**：当前用户永远来自 session，客户端不提交 from_user_id。
    // 服务端对这类字段是**严格拒绝**（出现即 400 from_user_id_not_accepted），
    // 而不是静默忽略 —— 由 verify-board-notes.sh 的 B8 组断言（已在真实服务器上验证）。
    const r = await postBoardNote(peerId, text)
    setBusy(false)
    if (r.ok) {
      setDraft('')
      // 重新拉取而不是本地插入：保证界面显示的是**服务端真实状态**
      // （排序、可见性、字段都由服务端决定，本地插入容易和服务端不一致）
      await load()
    } else {
      setErr(r.reason)
      setState('error')
    }
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
              placeholder="留言仅双方可见"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void post()
              }}
            />
            <button className="board__send" onClick={() => void post()} disabled={busy}>
              留言
            </button>
          </div>
        </div>
      }
      scroll
    >
      {state === 'loading' && <p className="board__hint">加载中…</p>}
      {state === 'error' && (
        <div className="board__empty">
          <p className="board__emptyText">网络错误</p>
          <p className="board__hint">{err}</p>
        </div>
      )}
      {state === 'ready' && notes.length === 0 && (
        <div className="board__empty">
          <p className="board__emptyText">{emptyText}</p>
        </div>
      )}
      {state === 'ready' && notes.length > 0 && (
        <div className="board__notes">
          {notes.map((n) => (
            <div key={n.id} className="note" data-note-id={n.id}>
              <p className="note__text">{n.body}</p>
              <div className="note__foot">
                <img className="note__avatar" src={me.avatar} alt="" />
                {/* 双方便签：显示实际发送者。mine=true 是我发的，false 是对方发的 */}
                <span className="note__name">{n.fromName ?? (n.mine ? '我' : '同学')}</span>
                <span className="note__time">{relativeTime(n.createdAt)}</span>
              </div>
            </div>
          ))}
          <p className="board__hint">留言仅双方可见</p>
        </div>
      )}
    </Screen>
  )
}
