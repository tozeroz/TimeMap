import { useCallback, useEffect, useRef, useState } from 'react'
import {
  REPORT_REASONS,
  createComment,
  createReport,
  deleteMyComment,
  deleteMyPost,
  favoritePost,
  likePost,
  unfavoritePost,
  unlikePost,
  humanizeFailure,
  type ApiCommentNode,
  type ApiPostDetail,
  failText,
} from '../api/client'
import { resolvePostAndComments } from '../data/postIdentity'
import { findLocalPost, removeMyPost, stashRepublish } from '../data/store'
import type { FeedPost } from '../data/types'
import { getSession, isLoggedIn } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { goBack, navigate } from '../router'
import './feed.css'
import { feedBrowse, stepFeed } from '../data/feedBrowse'
import { PostReader } from '../components/PostReader'
import { usePostWheel } from '../components/usePostWheel'

export function FeedDetailScreen({ id }: { id: string }) {
  const [current, setCurrent] = useState(() => {
    const token = new URLSearchParams(window.location.hash.split('?')[1]).get('browse')
    if (!token || token !== feedBrowse.token) {
      feedBrowse.ids = [id]; feedBrowse.drafts = {}; feedBrowse.images = {}; feedBrowse.switched = false
    }
    return id
  })
  const [incoming, setIncoming] = useState(id)
  if (incoming !== id) { setIncoming(id); setCurrent(id) }
  const root = useRef<HTMLDivElement>(null)
  const [showWheelHint, setShowWheelHint] = useState(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false
    try { return sessionStorage.getItem('timemap.post-wheel-hint') !== 'seen' } catch { return true }
  })
  useEffect(() => {
    if (!showWheelHint) return
    try { sessionStorage.setItem('timemap.post-wheel-hint', 'seen') } catch { /* Storage may be disabled. */ }
    const timer = window.setTimeout(() => setShowWheelHint(false), 3200)
    return () => window.clearTimeout(timer)
  }, [showWheelHint])
  const step = (direction: number) => {
    const next = stepFeed(current, direction)
    if (next) { setShowWheelHint(false); feedBrowse.switched = true; setCurrent(next) }
  }
  usePostWheel(root, step)
  return <div className="reader-session" ref={root}>
    <FeedDetail key={current} id={current} onStep={step} />
    {showWheelHint && <p className="reader__wheelHint" role="status">滚动鼠标滚轮切换帖子</p>}
  </div>
}

function FeedDetail({ id, onStep }: { id: string; onStep: (direction: number) => void }) {
  const [post, setPost] = useState<ApiPostDetail | null>(null)
  const [comments, setComments] = useState<ApiCommentNode[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<
    'loading' | 'ready' | 'offline' | 'gone' | 'not_found' | 'error' | 'local'
  >('loading')
  const [fromSnapshot, setFromSnapshot] = useState(false)
  const [errorText, setErrorText] = useState('')
  /**
   * ⭐ 本机遗留帖（`mine-…`）。
   *
   * 这些记录是旧版本"发帖只写本地"留下的，服务端从来没有过它们：
   *   · 改前：照样请求 `/api/posts/mine-…` → 服务端 400 invalid_id → 界面「网络错误」。
   *     用户既不知道原因，也没有任何出口（刷新一百次都是同一个错）。
   *   · 现在：命中本地库就直接渲染本地内容，并**如实说明**它只在这台设备上，
   *     同时给出「重新发布 / 删除」两条自救路径。
   */
  const [localPost, setLocalPost] = useState<FeedPost | null>(null)

  const [draft, setDraft] = useState(() => feedBrowse.drafts[id] ?? '')
  useEffect(() => { feedBrowse.drafts[id] = draft }, [id, draft])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
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
    /*
      缺 id（例如直接打开 `#/feed`）：改前照样发一次请求，拿到的失败被统一说成
      「网络错误」—— 用户看到的是"网络故障"，实际问题在链接里，刷新多少次都没用。
      ⇒ 显式区分"没指定看哪条"，不伪装成网络问题（QA 报告 §12 / P2）。
    */
    if (!id) {
      setPost(null)
      setComments([])
      setTotal(0)
      setErrorText('没有指定要查看哪一条动态')
      setState('not_found')
      return
    }
    /*
      本机遗留帖优先：它**不是**服务器实体（`mine-…` 不是 UUID，服务端会回 400），
      请求必然失败。直接渲染本地那份，并把"仅在这台设备上"说清楚。
    */
    const local = findLocalPost(id)
    if (local) {
      setLocalPost(local)
      setPost(null)
      setComments([])
      setTotal(0)
      setState('local')
      return
    }
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
        setErrorText(humanizeFailure(r.reason))
        setState('error')
    }
  }, [id])

  /**
   * ⭐ POST-006「分享」。
   *
   * 改前是**死按钮**：`ShareBtn` 只有图标、没有 onClick（QA 报告 P1 第 2 条——
   * 点击无请求、无弹层、无提示、剪贴板未写、navigator.share 未调用）。
   *
   * 策略（移动端优先，与需求"App/浏览器分享方式"一致）：
   *   ① 有系统分享面板（`navigator.share`，手机浏览器 / 原生壳都支持）→ 用它；
   *      用户主动取消（AbortError）不算失败，静默返回。
   *   ② 没系统分享（桌面 Chrome 部分版本）→ 复制可分享链接到剪贴板，并明确提示。
   *   ③ 剪贴板也不可用（非 HTTPS 等）→ 如实说失败，**不假装成功**。
   * 链接用 `location.href`：hash 路由里已含帖子 id，别人打开就是这条内容。
   */
  const sharePost = useCallback(async () => {
    const url = window.location.href
    const title = (post?.body ?? '').trim().slice(0, 40) || 'TimeMap 校园动态'
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> }
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title, text: title, url })
        return
      } catch (e) {
        // 用户点"取消"是正常路径，不要弹"分享失败"
        if ((e as Error)?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setNotice('链接已复制，可以粘贴给同学了')
    } catch {
      setNotice('分享失败：当前浏览器不允许访问剪贴板')
    }
  }, [post?.body])

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
    setPost({ ...post, likedByMe: !post.likedByMe, likeCount: Math.max(0, post.likeCount + (post.likedByMe ? -1 : 1)) })
    try {
      const r = post.likedByMe ? await unlikePost(post.id) : await likePost(post.id)
      if (!r.ok) {
        setPost(post)
        setNotice(r.status === 503 ? '服务暂不可用，请稍后再试' : `操作失败：${failText(r)}`)
        return
      }
      // 用服务端权威计数校正即时反馈。
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
    if (!body || Array.from(body).length > 500) return
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
        setNotice(r.status === 503 ? '服务暂不可用，请稍后再试' : `评论失败：${failText(r)}`)
        return
      }
      setComments(items => [{ ...r.value, replies: [] }, ...items])
      setTotal(value => value + 1)
      setDraft('')
      feedBrowse.drafts[id] = ''
      const refreshed = await resolvePostAndComments(id)
      if (refreshed.state === 'ready' || refreshed.state === 'offline') {
        setComments(refreshed.comments)
        setTotal(refreshed.total)
        setPost(refreshed.post)
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * 收藏 / 取消收藏（US-03）。
   *
   * 三条纪律：
   *   ① 用**服务端返回**的 favoriteCount / favorited 校正即时反馈
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
    setPost({ ...post, favoritedByMe: !post.favoritedByMe, favoriteCount: Math.max(0, post.favoriteCount + (post.favoritedByMe ? -1 : 1)) })
    try {
      const r = post.favoritedByMe ? await unfavoritePost(post.id) : await favoritePost(post.id)
      if (!r.ok) {
        setPost(post)
        setNotice(r.status === 503 ? '服务暂不可用，请稍后再试' : `操作失败：${failText(r)}`)
        return
      }
      setPost({ ...post, favoriteCount: r.value.favoriteCount, favoritedByMe: r.value.favorited })
      setNotice(r.value.favorited ? '已收藏' : '已取消收藏')
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
        setNotice(r.status === 503 ? '服务暂不可用，请稍后再试' : `举报失败：${failText(r)}`)
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
        setNotice(r.status === 403 ? '只能删除自己的评论' : `删除失败：${failText(r)}`)
        return
      }
      setComments(items => items.filter(c => c.id !== commentId).map(c => ({ ...c, replies: c.replies.filter(r => r.id !== commentId) })))
      setTotal(value => Math.max(0, value - 1))
      // Refresh the authoritative total (deleting a parent may remove replies too).
      const refreshed = await resolvePostAndComments(id)
      if (refreshed.state === 'ready' || refreshed.state === 'offline') {
        setComments(refreshed.comments)
        setTotal(refreshed.total)
        setPost(refreshed.post)
      }
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
        setNotice(r.status === 403 ? '只有作者能删除这条内容' : `删除失败：${failText(r)}`)
        return
      }
      setConfirmDelete(false)
      // Move through the original order after a successful deletion.
      const at = feedBrowse.ids.indexOf(post.id)
      if (at >= 0 && feedBrowse.ids[at + 1]) { onStep(1); feedBrowse.ids.splice(at, 1); return }
      if (at > 0) { onStep(-1); feedBrowse.ids.splice(at, 1); return }
      if (at >= 0) { feedBrowse.ids.splice(at, 1); goBack('campus'); return }
      setPost(null)
      setErrorText('内容不存在或已下架')
      setState('gone')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') {
    return (
      <Screen header={<TopBar left={<BackBtn />} />}>
        <p className="feed__state">加载中…</p>
      </Screen>
    )
  }

  /*
    US-08 / 需求 4.4：内容已下架 → **状态页 + 返回入口**。
    ⚠️ 这里刻意与"网络错误"分开：410 是服务端的明确回答，
      说成网络故障会让用户一直点重试（重试永远不会成功）。
  */
  /*
    ⭐ 本机遗留帖（旧版本只写本地、从未同步）。
    与普通详情页刻意不同：没有点赞/评论/收藏/举报 —— 那些动作都需要服务器实体，
    在这里摆出来只会再骗用户一次。只给「重新发布 / 删除」两条真实可执行的出口。
  */
  if (state === 'local' && localPost) {
    return (
      <Screen header={<TopBar left={<BackBtn />} />}>
        <div className="feed__local" data-feed-local-post={localPost.id}>
          <p className="feed__localNote" data-feed-local-note>
            这条动态只保存在这台设备上，从来没有同步到服务器（旧版本发帖留下的记录）。
            所以别人看不到它，也没有评论和点赞。想让它真正公开，可以点「重新发布」。
          </p>
          <div className="feed__localCard">
            <p className="feed__localAuthor">{localPost.author.name}</p>
            {localPost.text && <p className="feed__text">{localPost.text}</p>}
            {localPost.images.slice(0, 1).map((src, i) => (
              <img key={i} className="feed__localImg" src={src} alt="" />
            ))}
            {localPost.location && <p className="feed__localMeta">地标：{localPost.location}</p>}
          </div>
          <div className="feed__localActions">
            <button
              className="feed__localPrimary"
              data-feed-local-republish
              onClick={() => {
                // 长文本放不进 URL，用 sessionStorage 交接（store.ts 的 stashRepublish）
                stashRepublish({ text: localPost.text, placeName: localPost.location })
                navigate('publish')
              }}
            >
              重新发布
            </button>
            <button
              className="feed__localDanger"
              data-feed-local-remove
              onClick={() => {
                removeMyPost(localPost.id)
                goBack('campus')
              }}
            >
              删除这条记录
            </button>
          </div>
        </div>
      </Screen>
    )
  }

  if (state === 'gone') {
    return (
      <Screen header={<TopBar left={<BackBtn />} />}>
        <div className="feed__state" data-feed-state="gone">
          <p>内容不存在或已下架</p>{feedBrowse.ids[feedBrowse.ids.indexOf(id) + 1] && <button className="feed__retry" onClick={() => onStep(1)}>下一条帖子</button>}
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
      <Screen header={<TopBar left={<BackBtn />} />}>
        <div className="feed__state" data-feed-state={state} data-feed-missing-id={!id ? '' : undefined}>
          <p>{state === 'not_found' ? '内容不存在' : '网络错误'}</p>
          <p className="feed__state-sub">{errorText}</p>
          {/*
            没指定 id 时"刷新"必然还是这个结果 ⇒ 不给假动作，只给返回。
          */}
          {id ? (
            <button className="feed__retry" onClick={() => void load()}>
              刷新
            </button>
          ) : (
            <button className="feed__retry" onClick={() => goBack('campus')}>
              返回
            </button>
          )}
        </div>
      </Screen>
    )
  }

  return <>
    <PostReader onStep={onStep} post={post} comments={comments} total={total} busy={busy}
      draft={draft} onDraft={setDraft} notice={notice} offline={fromSnapshot}
      onLike={() => void toggleLike()} onFavorite={() => void toggleFavorite()}
      onSend={() => void submitComment()} onDeleteComment={cid => void removeComment(cid)}
      onMore={() => isAuthor ? setConfirmDelete(true) : setReportOpen(true)}
      onShare={() => void sharePost()} />

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
    </>
}

function BackBtn() {
  return (
    <button className="iconbtn" onClick={() => goBack()} aria-label="返回">
      <IconBack size={22} />
    </button>
  )
}
