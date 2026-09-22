import { useCallback, useEffect, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconComment, IconHeart, IconShare } from '../components/icons'
import { createComment, type ApiCommentNode } from '../api/client'
import { resolvePostAndComments } from '../data/postIdentity'
import { isLoggedIn } from '../api/session'
import { goBack } from '../router'
import './comments.css'

/**
 * 评论详情（原版 `com.kairuotu.feed.detail.CommentDetailActivity`，基线屏 `comment-detail`）。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⭐⭐ WO#17（审核 62 定为**第一优先**）：修掉**身份篡改**与**双数据源**
 * ════════════════════════════════════════════════════════════════════
 * 改前（我原来的实现，两处真实缺陷）：
 * ```
 * const post = posts.find((p) => p.id === id) ?? posts[0]   ← ① 静默兜底
 * const [list, setList] = useState(comments)                ← ② mock 评论
 * ```
 * ① **身份篡改**（identity corruption）：请求 `#/comments?id=A`，若 A 不在 mock 里，
 *    页面会**显示 post[0]** 的内容 —— 请求的是 A、看到的是 B。
 *    审核 62：这与 WO#12 的 `users[id] ?? users.u1` **完全同型**，
 *    比"显示假数据"更危险（假数据至少不冒充另一个真实实体）。
 * ② **双数据源**：同一原版屏有"一真一假"两份实现 ——
 *    `FeedDetailScreen` 用 `getPost/getComments`（真），本屏用 mock（假）。
 *
 * ⇒ 现在：**身份解析只留一处**（`../data/postIdentity`），本屏与 FeedDetailScreen 共用。
 *    本屏**不再 import 任何 mock**。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️ 两处**未解决**的保真问题（如实登记，**不**擅自改）
 * ════════════════════════════════════════════════════════════════════
 * ① **空态呈现冲突**：本屏原注释称"无评论时显示气泡图标 +「留下你的评论吧～」"，
 *    而基线 `screens/comment-detail/baseline.json` 记录的空态是
 *    「**页面全白，无列表内容**」（evidence=normal.png）—— 两者**不一致**。
 *    ⇒ 本 WO 只改**数据源**，**不动**视觉呈现；该冲突交由 A3/A4 的有界只读观察裁定。
 * ② **评论作者头像无权威来源**：`ApiComment` 只有 `author`（昵称）**没有头像字段**
 *    ⇒ 改前用 mock 的 `author.avatar`；现在**不渲染头像**（不用编造/占位图冒充）。
 *    这是**能力缺口**（需要服务端补字段），已登记，不在 WO#17 范围内解决。
 *
 * ════════════════════════════════════════════════════════════════════
 * ⚠️ 发送评论：改前是**本地假追加**
 * ════════════════════════════════════════════════════════════════════
 * ```
 * setList(prev => [...prev, { ... }])   ← 不发请求就"成功"了
 * ```
 * 这违反本项目已冻结的原则（写操作失败绝不本地假成功）。
 * ⇒ 现在走**真实** `createComment`；失败时**如实报错**、**不**追加。
 *   （仍**不**重做评论形态 / 不新增评论 UI 能力 —— 审核 62："不要趁机重做整个评论系统"。）
 */
export function CommentsScreen({ id }: { id: string }) {
  const [post, setPost] = useState<{ id: string; author: string; body: string } | null>(null)
  const [list, setList] = useState<ApiCommentNode[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'not_found' | 'error'>('loading')
  const [errorText, setErrorText] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setState('loading')
    setNotice('')
    const r = await resolvePostAndComments(id)
    if (r.state === 'ready' || r.state === 'offline') {
      setPost({ id: r.post.id, author: r.post.author, body: r.post.body })
      setList(r.comments)
      setState(r.state)
      return
    }
    if (r.state === 'not_found') {
      /* ⭐ 关键：**不**回落到任何其它动态 —— 这正是被修的身份篡改 */
      setPost(null)
      setList([])
      setState('not_found')
      return
    }
    setPost(null)
    setList([])
    setErrorText(r.reason)
    setState('error')
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function send() {
    const text = draft.trim()
    if (!text || !post || busy) return
    setBusy(true)
    setNotice('')
    const r = await createComment(post.id, text)
    setBusy(false)
    if (!r.ok) {
      /* 写操作失败 → 如实报错，**绝不**本地假追加 */
      setNotice(r.reason)
      return
    }
    setDraft('')
    // 重新拉一次，以服务端为准（不靠本地拼接伪造）
    await load()
  }

  const count = list.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0)

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('feed')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center={
            post ? (
              <div className="cd__head" data-cd-author={post.author}>
                {/* ⚠️ 不渲染头像：ApiComment/ApiPostDetail 无权威头像字段（见文件头 ②） */}
                <div className="cd__headText">
                  <span className="cd__name">{post.author}</span>
                </div>
              </div>
            ) : null
          }
          right={
            <button className="iconbtn" aria-label="分享">
              <IconShare size={20} />
            </button>
          }
        />
      }
      footer={
        state === 'ready' || state === 'offline' ? (
          <div className="feed__bar">
            <input
              className="feed__input"
              placeholder="留下我的评论..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send()
              }}
            />
            <button className="cd__send" onClick={() => void send()} disabled={!draft.trim() || busy}>
              发送
            </button>
          </div>
        ) : null
      }
      scroll
    >
      <div className="cd__body">
        {state === 'loading' && <p className="cd__emptyText">加载中…</p>}
        {state === 'not_found' && (
          <div className="cd__empty" data-cd-state="not_found">
            <p className="cd__emptyText">这条动态不存在（可能已被删除）</p>
          </div>
        )}
        {state === 'error' && (
          <div className="cd__empty" data-cd-state="error">
            <p className="cd__emptyText">{errorText || '加载失败'}</p>
            <button className="cd__send" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}
        {state === 'offline' && (
          <p className="cd__emptyText" data-cd-state="offline">
            离线：显示的是最后一次成功加载的内容
          </p>
        )}
        {notice && (
          <p className="cd__emptyText" data-cd-notice>
            发送失败：{notice}
          </p>
        )}
        {(state === 'ready' || state === 'offline') && (
          <>
            <h3 className="cd__count" data-cd-count>
              评论 {count}
            </h3>

            {count === 0 ? (
              <div className="cd__empty" data-cd-state="empty">
                <span className="cd__emptyIcon" aria-hidden>
                  <IconComment size={44} />
                </span>
                <p className="cd__emptyText">留下你的评论吧～</p>
              </div>
            ) : (
              <div className="cd__list">
                {list.map((c) => (
                  <div key={c.id} className="cmt" data-cmt-body={c.body}>
                    {/* ⚠️ 无头像：ApiComment 不含头像字段（见文件头 ②） */}
                    <div className="cmt__body">
                      <div className="cmt__name">{c.author}</div>
                      <p className="cmt__text">{c.body}</p>
                      <div className="cmt__meta">
                        <span>{c.createdAt.slice(5, 10)}</span>
                      </div>
                    </div>
                    <span className="cmt__likes">
                      <IconHeart size={14} />
                      {/* 评论点赞数：服务端未提供 ⇒ 不渲染数字（不编造） */}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!isLoggedIn() && (
              <p className="cd__emptyText">登录后才能发表评论</p>
            )}
          </>
        )}
      </div>
    </Screen>
  )
}
