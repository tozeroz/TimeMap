import { useCallback, useEffect, useState } from 'react'
import {
  createComment,
  likePost,
  mediaUrl,
  relativeTime,
  unlikePost,
  avatarFor,
  type ApiCommentNode,
  type ApiPostDetail,
} from '../api/client'
import { resolvePostAndComments } from '../data/postIdentity'
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
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'not_found' | 'error'>('loading')
  const [fromSnapshot, setFromSnapshot] = useState(false)
  const [errorText, setErrorText] = useState('')

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  /** 回复弹层的目标；null 表示关闭 */
  const [replyTo, setReplyTo] = useState<{ commentId: string; name: string } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')

  const load = useCallback(async () => {
    /*
      ⭐ WO#17（审核 62 要求③）：身份解析改为调用**共享**的
        `../data/postIdentity` —— 与 CommentsScreen 用**同一处实现**。
      改前这里自己写了一遍 getPost+getComments+快照降级；
      只要还是两套实现，就必然再次分叉（"一真一假"就是这么来的）。
      ⚠️ 行为**保持**：ready / offline（只回落同一 id 的快照）/ error 的语义都没变；
         新增区分 `not_found`（服务端明确说这个 id 不存在），
         以免把"内容不存在"和"加载失败"混为一谈。
      ⚠️ **绝不**在取不到时显示**另一条**动态 —— 那是身份篡改。
    */
    setState('loading')
    const r = await resolvePostAndComments(id)
    switch (r.state) {
      case 'ready':
      case 'offline':
        setPost(r.post)
        setComments(r.comments)
        setTotal(r.total)
        setFromSnapshot(r.fromSnapshot)
        setState(r.state)
        return
      case 'not_found':
        setPost(null)
        setComments([])
        setTotal(0)
        setErrorText('这条动态不存在（可能已被删除）')
        setState('not_found')
        return
      default:
        setPost(null)
        setComments([])
        setTotal(0)
        setErrorText(r.reason)
        setState('error')
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 点赞（M3 Slice 2）。
   *
   * 展示规则来自原版**只读**观察（supplements/slice2-likes-readonly.json）：
   *   - 点赞区是整块热区；计数是**纯数字无单位**
   *   - **0 赞时不渲染计数控件**（不是显示 0）
   *   - 评论数在 0 时显示的是**文字「评论」**（与点赞的规则不同）
   *
   * 注意：点赞是**写操作**，失败绝不本地假成功（M1 冻结原则）。
   */
  async function toggleLike() {
    if (busy || !post) return
    if (!isLoggedIn()) {
      setNotice('请先登录后再点赞')
      navigate('loginselect')
      return
    }
    setBusy(true)
    try {
      const r = post.likedByMe ? await unlikePost(post.id) : await likePost(post.id)
      if (!r.ok) {
        setNotice(r.status === 503 ? '服务暂不可用，请稍后再试' : `操作失败：${r.reason}`)
        return
      }
      // 用服务端返回的权威计数覆盖本地，而不是自己加减
      setPost({
        ...post,
        likeCount: r.value.likeCount,
        likedByMe: r.value.likedByMe,
      })
      setNotice('')
    } finally {
      setBusy(false)
    }
  }

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

  if (state === 'error' || state === 'not_found' || !post) {
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
          {/* 点赞：整块热区；0 赞时刻意**不渲染计数**（对齐原版：那时没有计数控件） */}
          <button
            className={`feed__action ${post.likedByMe ? 'is-liked' : ''}`}
            onClick={() => void toggleLike()}
            disabled={busy}
            aria-label="点赞"
          >
            <IconHeart size={21} filled={post.likedByMe} />
            {post.likeCount > 0 && <span>{post.likeCount}</span>}
          </button>
          {/*
            评论数：0 → 显示「评论」二字；>0 → 显示数字（含回复）。
            **简化说明**：原版是先点输入框打开评论编辑器、在编辑器里发送；
            这里草稿非空时点这个按钮即发送（回车等价），避免再造一个弹层。
            这是本 demo 的有意简化，不声称与原版一致。
          */}
          <button
            className="feed__action feed__action--text"
            onClick={() => {
              if (draft.trim()) void submitComment()
            }}
            disabled={busy}
            aria-label="评论"
          >
            <IconComment size={21} />
            <span>{post.commentCount > 0 ? post.commentCount : '评论'}</span>
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

        {/* M4：详情页的帖子图片。与列表同口径 —— 统一走 mediaUrl(id)，
            公图 302 → Nginx 静态、私图 X-Accel，前端不关心区别。
            图片给出宽高（来自 media 行）以便按原版比例占位，避免加载时跳动。 */}
        {(post.images ?? []).length > 0 && (
          <div className="feed__media">
            {(post.images ?? []).map((m) => (
              <img
                key={m.id}
                className="feed__mediaImg"
                src={mediaUrl(m.id)}
                alt=""
                data-media-id={m.id}
                width={m.width ?? undefined}
                height={m.height ?? undefined}
                loading="lazy"
              />
            ))}
          </div>
        )}
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
