import { useEffect, useState } from 'react'
import { getBoardNotes, postBoardNote, relativeTime, type ApiBoardNote } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconClose } from '../components/icons'
import { boardEmojis } from '../data/mock'
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
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'no-peer'>('loading')
  const [err, setErr] = useState('')
  const [emptyText, setEmptyText] = useState('可以给同学留言噢')
  const [busy, setBusy] = useState(false)

  async function load() {
    /*
      ⭐ M5 Round 266：**没有指定留言对象**时不得去请求、也不得假装"空板"。
      留言板是**双方**语义（`board_notes.from/to`，服务端不允许自指），
      所以缺 peerId 时正确处置是**明确的不可用态**，而不是：
        · 拿一个硬编码 id 兜底（改前 App.tsx 就是这么做的，后果是板为空且看不出原因）
        · 或者显示"可以给同学留言噢"（那会让人以为**真的没人留言**）
      —— 与 WO#12/#14 的"不回落、不假装有数据"是同一条纪律。
    */
    if (!peerId) {
      setNotes([])
      setState('no-peer')
      return
    }
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
        /*
          ⭐ M5 Round 266：**没有留言对象时不得让人能发**。
          改前这里无条件渲染 composer；而从抽屉入口进来时 peerId 为空
          （改前是硬编码兜底成"我自己的 id"，同样发不出去），
          用户敲了字按「留言」只会得到一个 404 —— 典型的"界面允许、后端拒绝"。
          ⇒ 这里按 state 决定：no-peer / error 时**不渲染 composer**，
            而是给出与主区域一致的明确说明。
        */
        state === 'no-peer' || state === 'error' ? (
          <div className="board__bar board__bar--disabled" data-board-composer="disabled">
            <span className="board__hint">
              {state === 'no-peer' ? '未指定留言对象，无法留言' : '当前无法留言'}
            </span>
          </div>
        ) : (
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
        )
      }
      scroll
    >
      {state === 'loading' && <p className="board__hint">加载中…</p>}
      {/*
        ⭐ M5 Round 266：**未指定留言对象**的明确不可用态。
        为什么单独一态而不是复用"空板"：留言板是双方语义，缺 peerId 时
        "板为空"与"还没选人"是**两件不同的事** —— 混在一起会让人以为真的没人留言
        （改前的硬编码兜底正是制造了这种含混：板为空但看不出原因）。
      */}
      {state === 'no-peer' && (
        <div className="board__empty" data-board-state="no-peer">
          <p className="board__emptyText">未指定留言对象</p>
          <p className="board__hint">留言板是双方可见的便签，请从对方的个人主页进入</p>
        </div>
      )}
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
                {/*
                  ⚠️⚠️ 改前这里写的是 `<img className="note__avatar" src={me.avatar} alt="" />` ——
                  两个问题叠在一起：

                  ① **每条留言都渲染"我"的 mock 头像**（`mock.ts` 的
                     `me = { name:'自定义名称6', avatar: avatar('我','#6b7cff') }`）。
                     而紧邻的 `note__name` 却**正确区分**了双方
                     （`n.fromName ?? (n.mine ? '我' : '同学')`）——
                     于是**对方发的留言也显示我的头像**，**头像与名字自相矛盾**。
                  ② 它是 **mock 生成的身份**，与 WO#12/#14 已冻结的处置冲突
                     （users 表**没有 avatar 列** ⇒ 用**首字占位**）。

                  ⇒ 处置（沿用已冻结的先例，与本仓库另外 5 处一致）：
                     **按"这一条留言实际显示的作者名"取首字**做占位。
                     这样"我"与"对方"的占位字母**不同**，不再自相矛盾。
                */}
                <span className="note__avatar note__avatar--ph" aria-hidden data-note-avatar-placeholder>
                  {(n.fromName ?? (n.mine ? '我' : '同学')).trim().slice(0, 1)}
                </span>
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
