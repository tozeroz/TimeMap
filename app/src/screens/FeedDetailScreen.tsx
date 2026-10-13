import { useCallback, useEffect, useState } from 'react'
import {
  REPORT_REASONS,
  createComment,
  createReport,
  deleteMyComment,
  deleteMyPost,
  favoritePost,
  likePost,
  mediaUrl,
  relativeTime,
  unfavoritePost,
  unlikePost,
  avatarFor,
  type ApiCommentNode,
  type ApiPostDetail,
} from '../api/client'
import { resolvePostAndComments } from '../data/postIdentity'
import { getSession, isLoggedIn } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconComment, IconHeart, IconShare, IconStar } from '../components/icons'
import { goBack, navigate } from '../router'
import './feed.css'

/**
 * 动态详情（原版 `FeedDetailActivity` + TimeMap P0 的 F05 互动 / F07 举报 / 作者删除）。
 *
 * 结构按 M3 Slice 1 实测（docs/pending/m3/MODEL-VALIDATION.md §2.7 + supplements/comment-detail.json）：
 *   - 顶部：返回 + 分享
 *   - 作者行：头像 + 昵称 +「地点 · 时间」
 *   - 正文 + 配图
 *   - **评论区内联在本页**：标题「评论 N」，N 是**含回复**的总数
 *   - 每条顶层评论下是**嵌套的回复列表**；回复行按「<作者> 回复 <目标> · <时间>」渲染
 *   - 底部输入框「留下我的评论...」发顶层评论
 *
 * ## ⭐ P0 新增（每一条都对应一个验收项）
 *   · **收藏**（US-03）：与点赞并列；计数与状态都取**服务端返回值**，不在本地加减
 *   · **举报**（US-08）：选原因码 → 提交。⚠️ 提交成功后**内容仍然公开**
 *     （需求明确："举报成功后进入管理端待处理列表，但**不自动下架内容**"），
 *     所以这里绝不会因为举报成功而把内容藏起来 —— 那会违反需求
 *   · **作者删除**（US-02/US-03）：仅当会话用户就是作者时显示；服务端另有一道 403 校验
 *   · **已下架状态**（US-08 + 需求 4.4）：服务端 410 时显示"内容不存在或已下架"状态页
 *     （改前 410 会落到"网络错误"，把明确的业务状态说成网络故障）
 *
 * 数据来源纪律（审核记录 07）：
 *   在线时 **API = 权威数据源**；失败时只降级到**最后一次成功的 API 快照**并明确标注，
 *   **不塞 mock** —— 否则 UI 会在离线时看起来像在线成功，那是假象。
 */
export function FeedDetailScreen({ id }: { id: string }) {
  const [post, setPost] = useState<ApiPostDetail | null>(null)
  const [comments, setComments] = useState<ApiCommentNode[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<
    'loading' | 'ready' | 'offline' | 'gone' | 'not_found' | 'error'
  >('loading')
  const [fromSnapshot, setFromSnapshot] = useState(false)
  const [errorText, setErrorText] = useState('')

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  /** 回复弹层的目标；null 表示关闭 */
  const [replyTo, setReplyTo] = useState<{ commentId: string; name: string } | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  /** 举报弹层：null 表示关闭 */
  const [reportOpen, setReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0].code)
  const [reportDetail, setReportDetail] = useState('')
  /** 作者删除确认 */
  const [confirmDelete, setConfirmDelete] = useState(false)

  /**
   * 当前会话用户是不是这条内容的作者。
   *
   * ⚠️ 这只决定**要不要显示**删除入口 —— 真正的归属校验在服务端
   *    （`DELETE /api/posts/:id` 只允许作者，否则 403）。
   *    前端绝不能把"藏起按钮"当成权限控制。
   * ⚠️ 历史帖子 authorId 可能为 null（M1 时期没有可信身份）⇒ 那时不显示删除入口
   *    （而不是拿作者名去比对 —— 昵称可以重名）。
   */
  const me = getSession()?.user
  const isAuthor = Boolean(post?.authorId && me?.id && post.authorId === me.id)

  const load = useCallback(async () => {
    /*
      ⭐ WO#17（审核 62 要求③）：身份解析改为调用**共享**的
        `../data/postIdentity` —— 与 CommentsScreen 用**同一处实现**。
      改前这里自己写了一遍 getPost+getComments+快照降级；
      只要还是两套实现，就必然再次分叉（"一真一假"就是这么来的）。
      ⚠️ 行为**保持**：ready / offline（只回落同一 id 的快照）/ error 的语义都没变；
         新增区分 `not_found`（服务端明确说这个 id 不存在）与 `gone`（已下架，410），
         以免把"内容不存在""已下架"和"加载失败"三件事混为一谈。
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
      case 'gone':
        // US-08：管理员下架或作者删除后，服务端回 410 —— 这是**明确的业务状态**，不是网络故障
        setPost(null)
        setComments([])
        setTotal(0)
        setErrorText('内容不存在或已下架')
        setState('gone')
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

  /**
   * 收藏 / 取消收藏（US-03）。
   *
   * 三条纪律：
   *   ① 用**服务端返回**的 favoriteCount / favorited 覆盖本地，不自己 ±1
   *      （撤销、重复收藏、并发下本地推算会失真）
   *   ② 未登录先跳登录，不发必然 401 的请求
   *   ③ 失败**不本地假成功**：提示原因，界面维持服务端已知的状态
   */
  async function toggleFavorite() {
    if (busy || !post) return
    if (!isLoggedIn()) {
      setNotice('请先登录后再收藏')
      navigate('loginselect')
      return
    }
    setBusy(true)
    try {
      const r = post.favoritedByMe ? await unfavoritePost(post.id) : await favoritePost(post.id)
      if (!r.ok) {
        setNotice(r.status === 503 ? '服务暂不可用，请稍后再试' : `操作失败：${r.reason}`)
        return
      }
      setPost({ ...post, favoriteCount: r.value.favoriteCount, favoritedByMe: r.value.favorited })
      setNotice('')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 提交举报（US-08）。
   *
   * ⚠️ 成败都不改变内容的公开状态 —— 需求白纸黑字：
   *    "举报成功后进入管理端待处理列表，但**不自动下架内容**"。
   *    所以这里**只**提示"已提交"，绝不把内容从界面上拿走。
   * ⚠️ 重复举报由服务端去重（同人同目标返回同一条 pending），前端不需要自己挡。
   */
  async function submitReport() {
    if (busy || !post) return
    if (!isLoggedIn()) {
      setNotice('请先登录后再举报')
      navigate('loginselect')
      return
    }
    setBusy(true)
    try {
      const r = await createReport({
        targetType: 'post',
        targetId: post.id,
        reasonCode: reportReason,
        ...(reportDetail.trim() ? { detail: reportDetail.trim() } : {}),
      })
      if (!r.ok) {
        setNotice(r.status === 503 ? '服务暂不可用，请稍后再试' : `举报失败：${r.reason}`)
        return
      }
      setReportOpen(false)
      setReportDetail('')
      setNotice('举报已提交，管理员会在管理端处理（内容暂时保持公开）。')
    } finally {
      setBusy(false)
    }
  }

  /** 删除**自己的**评论（US-03：删除后不计入有效评论量） */
  async function removeComment(commentId: string) {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      const r = await deleteMyComment(commentId)
      if (!r.ok) {
        setNotice(r.status === 403 ? '只能删除自己的评论' : `删除失败：${r.reason}`)
        return
      }
      // 删除会改变有效评论量 ⇒ 必须重新拉取（不能只本地过滤掉那一行）
      await load()
    } finally {
      setBusy(false)
    }
  }

  /** 删除**自己的**帖子（US-02：只有作者能删；服务端另有 403 校验） */
  async function removePost() {
    if (busy || !post) return
    setBusy(true)
    setNotice('')
    try {
      const r = await deleteMyPost(post.id)
      if (!r.ok) {
        setNotice(r.status === 403 ? '只有作者能删除这条内容' : `删除失败：${r.reason}`)
        return
      }
      setConfirmDelete(false)
      // 删除即下架（软删除，退出所有公开面）⇒ 本页转为"已下架"状态页
      setPost(null)
      setErrorText('内容不存在或已下架')
      setState('gone')
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

  /*
    US-08 / 需求 4.4：内容已下架 → **状态页 + 返回入口**。
    ⚠️ 这里刻意与"网络错误"分开：410 是服务端的明确回答，
      说成网络故障会让用户一直点重试（重试永远不会成功）。
  */
  if (state === 'gone') {
    return (
      <Screen header={<TopBar left={<BackBtn />} right={<ShareBtn />} />}>
        <div className="feed__state" data-feed-state="gone">
          <p>内容不存在或已下架</p>
          <p className="feed__state-sub">{errorText}</p>
          <button className="feed__retry" onClick={() => goBack('map')}>
            返回
          </button>
        </div>
      </Screen>
    )
  }

  if (state === 'error' || state === 'not_found' || !post) {
    return (
      <Screen header={<TopBar left={<BackBtn />} right={<ShareBtn />} />}>
        <div className="feed__state" data-feed-state={state}>
          <p>网络错误</p>
          <p className="feed__state-sub">{errorText}</p>
          <button className="feed__retry" onClick={() => void load()}>
            刷新
          </button>
        </div>
      </Screen>
    )
  }

  const header = (
    <TopBar
      left={<BackBtn />}
      right={
        <div className="feed__topActions">
          {/*
            作者删除（US-02：只有作者能够删除自己的帖子）。
            ⚠️ 显示条件与会话身份有关，但这**只是界面**；服务端 DELETE 会独立校验归属。
          */}
          {isAuthor && (
            <button
              className="feed__topBtn"
              data-post-delete
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              删除
            </button>
          )}
          {/* 举报（US-08）：作者举报自己的内容没意义，所以作者不显示 */}
          {!isAuthor && (
            <button
              className="feed__topBtn"
              data-post-report
              onClick={() => {
                setNotice('')
                setReportOpen(true)
              }}
              disabled={busy}
            >
              举报
            </button>
          )}
          <ShareBtn />
        </div>
      }
    />
  )

  return (
    <Screen
      header={header}
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
            收藏（US-03）：与点赞并列，可撤销。
            `data-favorited` 是给验收用的显式钩子 —— 收藏态必须能被机械检查，
            而不是只能靠看图。
          */}
          <button
            className={`feed__action ${post.favoritedByMe ? 'is-faved' : ''}`}
            data-favorite-toggle
            data-favorited={post.favoritedByMe ? '1' : '0'}
            data-favorite-count={String(post.favoriteCount)}
            onClick={() => void toggleFavorite()}
            disabled={busy}
            aria-label={post.favoritedByMe ? '取消收藏' : '收藏'}
          >
            <IconStar size={21} filled={post.favoritedByMe} />
            {post.favoriteCount > 0 && <span>{post.favoriteCount}</span>}
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
                className={`feed__mediaImg ${post.imageMode === 'sticker' ? 'feed__mediaImg--sticker' : ''}`}
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
                {/*
                  资料里没有"评论作者 id"以外的归属信息，用 authorId 与会话 id 比对
                  （**不用昵称比对** —— 昵称可重名）。服务端另有一道 403 校验。
                */}
                {Boolean(c.authorId && me?.id && c.authorId === me.id) && (
                  <button
                    className="cmt__delete"
                    data-comment-delete={c.id}
                    onClick={() => void removeComment(c.id)}
                    disabled={busy}
                  >
                    删除
                  </button>
                )}
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

      {/*
        举报弹层（US-08）。
        ⚠️ 原因用**固定枚举**（REPORT_REASONS）而不是自由文本：管理端要能分类筛选与统计。
        ⚠️ 提交成功**不会**下架内容 —— 界面上必须把这一点说清楚，
           否则用户会以为"举报了就等于删了"。
      */}
      {reportOpen && (
        <div className="feed__replyMask" data-report-modal onClick={() => setReportOpen(false)}>
          <div className="feed__replySheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="feed__replyHead">
              <button className="feed__replyClose" onClick={() => setReportOpen(false)} aria-label="关闭">
                ×
              </button>
              <span className="feed__replyTitle">举报这条内容</span>
              <button className="feed__replyPost" data-report-submit onClick={() => void submitReport()} disabled={busy}>
                提交
              </button>
            </div>
            <div className="feed__reportBody">
              <div className="feed__reportReasons">
                {REPORT_REASONS.map((r) => (
                  <button
                    key={r.code}
                    className={`feed__reportReason ${reportReason === r.code ? 'is-active' : ''}`}
                    data-report-reason={r.code}
                    onClick={() => setReportReason(r.code)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <textarea
                className="feed__reportDetail"
                data-report-detail
                placeholder="补充说明（可选）"
                value={reportDetail}
                onChange={(e) => setReportDetail(e.target.value)}
              />
              <p className="feed__reportNote">
                举报会进入管理端待处理列表；管理员处理前，内容**仍然公开**（举报不会自动下架）。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 作者删除确认（US-02）：删除后内容退出所有公开面，因此必须是显式确认 */}
      {confirmDelete && (
        <div className="feed__replyMask" data-delete-modal onClick={() => setConfirmDelete(false)}>
          <div className="feed__replySheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="feed__replyHead">
              <span className="feed__replyTitle">删除这条内容？</span>
            </div>
            <div className="feed__reportBody">
              <p className="feed__reportNote">
                删除后该内容会退出地图、地点详情、公开列表与收藏，且**无法恢复**。
              </p>
              <div className="feed__deleteActions">
                <button className="feed__cancelBtn" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  取消
                </button>
                <button className="feed__deleteBtn" data-delete-confirm onClick={() => void removePost()} disabled={busy}>
                  {busy ? '删除中…' : '确认删除'}
                </button>
              </div>
            </div>
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
