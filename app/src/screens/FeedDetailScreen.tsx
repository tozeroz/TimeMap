import { useCallback, useEffect, useState } from 'react'
import {
  createComment,
  getComments,
  getPost,
  readSnapshot,
  relativeTime,
  avatarFor,
  type ApiCommentNode,
  type ApiPostDetail,
} from '../api/client'
import { isLoggedIn } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconComment, IconHeart, IconShare } from '../components/icons'
import { goBack, navigate } from '../router'
import './feed.css'

/**
 * 动态详情（原版 `FeedDetailActivity`）。
 *
 * 结构按 M3 Slice 1 实测（docs/m3/MODEL-VALIDATION.md §2.7 + supplements/comment-detail.json）：
 *   - 顶部：返回 + 分享
 *   - 作者行：头像 + 昵称 +「地点 · 时间」
 *   - 正文 + 配图
 *   - **评论区内联在本页**：标题「评论 N」，N 是**含回复**的总数
 *   - 每条顶层评论下是**嵌套的回复列表**；回复行按「<作者> 回复 <目标> · <时间>」渲染
 *     —— 那个「回复 <目标>」来自服务端的 replyTo（独立字段），不是把 @某人 拼进正文
 *   - 每条评论/回复都有独立的「回复」入口 → 打开回复弹层（标题「回复 @昵称」）
 *   - 底部输入框「留下我的评论...」发顶层评论
 *
 * 数据来源纪律（审核记录 07）：
 *   在线时 **API = 权威数据源**；失败时只降级到**最后一次成功的 API 快照**并明确标注，
 *   **不塞 mock** —— 否则 UI 会在离线时看起来像在线成功，那是假象。
 */
export function FeedDetailScreen({ id }: { id: string }) {
  const [post, setPost] = useState<ApiPostDetail | null>(null)
  const [comments, setComments] = useState<ApiCommentNode[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading')
  const [fromSnapshot, setFromSnapshot] = useState(false)
  const [errorText, setErrorText] = useState('')

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  /** 回复弹层的目标；null 表示关闭 */
  const [replyTo, setReplyTo] = useState<{ commentId: string; name: string } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  const load = useCallback(async () => {
    // 没有 id 就别发请求：如实说"未指定动态"，不要拿 mock 默认值冒充
    if (!id) {
      setErrorText('未指定动态（缺少 id 参数）')
      setState('error')
      return
    }
    setState('loading')
    const [pr, cr] = await Promise.all([getPost(id), getComments(id)])
    if (pr.ok && cr.ok) {
      setPost(pr.value)
      setComments(cr.value.items)
      setTotal(cr.value.total)
      setFromSnapshot(false)
      setState('ready')
      return
    }
    // 在线取不到 → 只允许降级到"最后一次成功过的快照"
    const ps = readSnapshot<ApiPostDetail>(`post:${id}`)
    const cs = readSnapshot<{ items: ApiCommentNode[]; total: number }>(`comments:${id}`)
    if (ps && cs) {
      setPost(ps.value)
      setComments(cs.value.items)
      setTotal(cs.value.total)
      setFromSnapshot(true)
      setState('offline')
      return
    }
    // 连快照都没有 → 如实报错（不拿 mock 冒充）
    const why = !pr.ok ? `加载失败：${pr.reason}` : !cr.ok ? `评论加载失败：${cr.reason}` : '加载失败'
    setErrorText(why)
    setState('error')
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function submitComment() {
    if (busy) return
    const body = draft.trim()
    if (!body) return
    if (!isLoggedIn()) {
      setNotice('请先登录后再评论')
      navigate('loginselect')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const r = await createComment(id, body)
      if (!r.ok) {
        // 写操作失败**绝不**本地假成功（M1 冻结原则）
        setNotice(r.status === 503 ? '服务暂不可用，请稍后再试' : `评论失败：${r.reason}`)
        return
      }
      setDraft('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function submitReply() {
    if (busy || !replyTo) return
    const body = replyDraft.trim()
    if (!body) return
    setBusy(true)
    try {
      const r = await createComment(id, body, replyTo.commentId)
      if (!r.ok) {
        setNotice(r.status === 503 ? '服务暂不可用，请稍后再试' : `回复失败：${r.reason}`)
        return
      }
      setReplyTo(null)
      setReplyDraft('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') {
    return (
      <Screen header={<TopBar left={<BackBtn />} right={<ShareBtn />} />}>
        <p className="feed__state">加载中…</p>
      </Screen>
    )
  }

  if (state === 'error' || !post) {
    return (
      <Screen header={<TopBar left={<BackBtn />} right={<ShareBtn />} />}>
        <div className="feed__state">
          <p>网络错误</p>
          <p className="feed__state-sub">{errorText}</p>
          <button className="feed__retry" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen
      header={<TopBar left={<BackBtn />} right={<ShareBtn />} />}
      footer={
        <div className="feed__bar">
          <input
            className="feed__input"
            placeholder="留下我的评论..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitComment()
            }}
          />
          <button className="feed__action feed__action--text" onClick={() => void submitComment()} disabled={busy}>
            <IconComment size={21} />
            <span>{busy ? '发送中' : '发送'}</span>
          </button>
        </div>
      }
      scroll
    >
      {fromSnapshot && (
        <p className="feed__offline">
          离线：显示的是**最后一次成功获取的服务器数据**（非本地假数据），可能不是最新
        </p>
      )}

      <article className="feed__post">
        <header className="feed__author">
          <img className="feed__avatar" src={avatarFor(post.author)} alt="" />
          <div className="feed__author-main">
            <div className="feed__author-name">{post.author}</div>
            <div className="feed__author-meta">
              {relativeTime(post.createdAt)}
              {post.place && <span> · {post.place}</span>}
            </div>
          </div>
        </header>

        <p className="feed__text">{post.body}</p>
      </article>

      <section className="feed__comments">
        {/* 原版口径：「评论 N」把回复也算进去 */}
        <h3 className="feed__comments-title">评论 {total}</h3>

        {comments.length === 0 && <p className="feed__noComments">还没有评论，来说点什么吧</p>}

        {comments.map((c) => (
          <div key={c.id} className="cmt" data-comment-id={c.id}>
            <img className="cmt__avatar" src={avatarFor(c.author)} alt="" />
            <div className="cmt__body">
              <div className="cmt__name">{c.author}</div>
              <p className="cmt__text">{c.body}</p>
              <div className="cmt__meta">
                <span>{relativeTime(c.createdAt)}</span>
                <button
                  className="cmt__reply"
                  onClick={() => {
                    setReplyTo({ commentId: c.id, name: c.author })
                    setReplyDraft('')
                  }}
                >
                  回复
                </button>
              </div>

              {/* 回复列表：嵌套在父评论内部（原版就是这么渲染的） */}
              {c.replies.length > 0 && (
                <div className="cmt__replies" data-replies-of={c.id}>
                  {c.replies.map((r) => (
                    <div key={r.id} className="cmt cmt--reply" data-comment-id={r.id}>
                      <img className="cmt__avatar cmt__avatar--sm" src={avatarFor(r.author)} alt="" />
                      <div className="cmt__body">
                        <div className="cmt__replyMeta">
                          <span className="cmt__name">{r.author}</span>
                          {r.replyTo && (
                            <>
                              <span className="cmt__replyLabel">回复</span>
                              <span className="cmt__replyTarget">{r.replyTo}</span>
                            </>
                          )}
                          <span className="cmt__replyTime">· {relativeTime(r.createdAt)}</span>
                        </div>
                        <p className="cmt__text">{r.body}</p>
                        <div className="cmt__meta">
                          <button
                            className="cmt__reply"
                            onClick={() => {
                              setReplyTo({ commentId: r.id, name: r.author })
                              setReplyDraft('')
                            }}
                          >
                            回复
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <span className="cmt__likes">
              <IconHeart size={14} />
            </span>
          </div>
        ))}
      </section>

      {notice && <p className="feed__notice">{notice}</p>}

      {/* 回复弹层：标题「回复 @昵称」（原版实测的形态） */}
      {replyTo && (
        <div className="feed__replyMask" onClick={() => setReplyTo(null)}>
          <div className="feed__replySheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="feed__replyHead">
              <button className="feed__replyClose" onClick={() => setReplyTo(null)} aria-label="关闭">
                ×
              </button>
              <span className="feed__replyTitle">回复 @{replyTo.name}</span>
              <button className="feed__replyPost" onClick={() => void submitReply()} disabled={busy}>
                发布
              </button>
            </div>
            <input
              className="feed__replyInput"
              placeholder="留下我的回复..."
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitReply()
              }}
            />
          </div>
        </div>
      )}
    </Screen>
  )
}

function BackBtn() {
  return (
    <button className="iconbtn" onClick={() => goBack()} aria-label="返回">
      <IconBack size={22} />
    </button>
  )
}

function ShareBtn() {
  return (
    <button className="iconbtn" aria-label="分享">
      <IconShare size={20} />
    </button>
  )
}
