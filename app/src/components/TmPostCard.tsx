import { useState, useSyncExternalStore } from 'react'
import { IconComment, IconHeart, IconStar } from './icons'
import { CATEGORY_COLOR, relativeTime, type TmPost } from '../data/timemap'
import {
  addComment,
  commentCount,
  commentsOf,
  deleteComment,
  favoriteCount,
  getPlace,
  getPost,
  getTmVersion,
  likeCount,
  report,
  subscribeTm,
  toggleFavorite,
  toggleLike,
  userById,
} from '../data/tmStore'
import { REPORT_CATEGORIES } from '../data/timemap'
import { navigate } from '../router'

/**
 * 订阅 TimeMap 状态的便捷 hook。
 * 返回版本号而不是 state 本身 —— store 是就地更新的，
 * 只有版本号能满足 useSyncExternalStore「变了才换引用」的要求。
 */
export function useTm() {
  return useSyncExternalStore(subscribeTm, getTmVersion)
}

/** 通用轻提示（自动消失） */
export function useToast(): [string, (msg: string) => void] {
  const [msg, setMsg] = useState('')
  const show = (m: string) => {
    setMsg(m)
    window.setTimeout(() => setMsg(''), 2200)
  }
  return [msg, show]
}

export function Toast({ msg }: { msg: string }) {
  if (!msg) return null
  return <div className="tm__toast">{msg}</div>
}

/** 标签小徽章 */
export function TagChip({ tag, placeCategory }: { tag: string; placeCategory?: string }) {
  const color = placeCategory === '食堂' ? '#b7791f' : '#5b6b8c'
  return (
    <span className="tm__tag" style={{ color }}>
      {tag}
    </span>
  )
}

/**
 * 帖子卡片（地点详情 / 我的发布 / 我的收藏 共用）。
 * 互动按钮直接反映 store 状态：点赞只计一次、可取消（US-03）。
 */
export function PostCard({
  post,
  showPlace = false,
  removedBadge = false,
  onDelete,
}: {
  post: TmPost
  showPlace?: boolean
  removedBadge?: boolean
  onDelete?: (id: string) => void
}) {
  useTm()
  const author = userById(post.authorId)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <article className="tm__post" data-post-id={post.id} data-status={post.status}>
      <header className="tm__postHead">
        <img className="tm__postAvatar" src={author.avatar} alt="" />
        <div className="tm__postHeadMain">
          <span className="tm__postAuthor">{author.name}</span>
          <span className="tm__postTime">{relativeTime(post.createdAt)}</span>
        </div>
        {removedBadge && post.status === 'removed' && (
          <span className="tm__removedBadge">已下架</span>
        )}
      </header>

      {post.tags.length > 0 && (
        <div className="tm__postTags">
          {post.tags.map((t) => (
            <TagChip key={t} tag={t} />
          ))}
        </div>
      )}

      <button className="tm__postBody" onClick={() => navigate('feed', { id: post.id })}>
        {post.text && <p className="tm__postText">{post.text}</p>}
        {post.images.length > 0 && (
          <div className={`tm__postImgs tm__postImgs--${post.images.length}`}>
            {post.images.slice(0, 3).map((src, i) => (
              <img key={i} src={src} alt="" />
            ))}
          </div>
        )}
      </button>

      <footer className="tm__postFoot">
        {showPlace && <PlaceChip postId={post.id} />}
        <button
          className={`tm__postAct ${post.likedByMe ? 'is-on' : ''}`}
          onClick={() => toggleLike(post.id)}
          aria-pressed={post.likedByMe}
          aria-label={post.likedByMe ? '取消点赞' : '点赞'}
          data-act="like"
          data-count={likeCount(post)}
        >
          <IconHeart size={17} filled={post.likedByMe} />
          {likeCount(post)}
        </button>
        <button
          className="tm__postAct"
          onClick={() => navigate('comments', { id: post.id })}
          aria-label="查看评论"
          data-act="comment"
          data-count={commentCount(post.id)}
        >
          <IconComment size={17} />
          {commentCount(post.id)}
        </button>
        <button
          className={`tm__postAct ${post.favoritedByMe ? 'is-fav' : ''}`}
          onClick={() => toggleFavorite(post.id)}
          aria-pressed={post.favoritedByMe}
          aria-label={post.favoritedByMe ? '取消收藏' : '收藏'}
          data-act="favorite"
          data-count={favoriteCount(post)}
        >
          <IconStar size={17} filled={post.favoritedByMe} />
          {favoriteCount(post)}
        </button>
        {onDelete && post.status !== 'removed' && (
          confirmDelete ? (
            <span className="tm__confirmRow">
              <button className="tm__confirmYes" onClick={() => { setConfirmDelete(false); onDelete(post.id) }}>
                确认删除
              </button>
              <button className="tm__confirmNo" onClick={() => setConfirmDelete(false)}>
                取消
              </button>
            </span>
          ) : (
            <button className="tm__postAct tm__postAct--danger" onClick={() => setConfirmDelete(true)}>
              删除
            </button>
          )
        )}
      </footer>
    </article>
  )
}

/** 帖子卡片上的地点小徽章（跨地点列表用） */
function PlaceChip({ postId }: { postId: string }) {
  useTm()
  const post = getPost(postId)
  const place = post ? getPlace(post.placeId) : undefined
  if (!place) return null
  return (
    <span className="tm__placeChip">
      <span className="tm__placeDot" style={{ background: CATEGORY_COLOR[place.category] }} />
      {place.name}
    </span>
  )
}

/**
 * 评论区（帖子详情页内嵌 + 评论页共用）。
 * 仅本人可删除自己的评论；删除后不计入有效评论量（US-03）。
 * 每条他人评论可举报（US-08）。
 */
export function CommentList({
  postId,
  onReport,
}: {
  postId: string
  onReport?: (commentId: string) => void
}) {
  useTm()
  const list = commentsOf(postId)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (list.length === 0) {
    return (
      <div className="tm__cmtEmpty">
        <IconComment size={36} />
        <p>还没有评论，来抢沙发</p>
      </div>
    )
  }
  return (
    <div className="tm__cmts">
      {list.map((c) => {
        const author = userById(c.authorId)
        return (
          <div key={c.id} className="tm__cmt" data-comment-id={c.id}>
            <img className="tm__cmtAvatar" src={author.avatar} alt="" />
            <div className="tm__cmtBody">
              <span className="tm__cmtName">{author.name}</span>
              <p className="tm__cmtText">{c.text}</p>
              <div className="tm__cmtMeta">
                <span>{relativeTime(c.createdAt)}</span>
                {c.authorId === 'me' &&
                  (confirmId === c.id ? (
                    <span className="tm__confirmRow">
                      <button
                        className="tm__confirmYes"
                        onClick={() => {
                          setConfirmId(null)
                          deleteComment(c.id)
                        }}
                      >
                        确认删除
                      </button>
                      <button className="tm__confirmNo" onClick={() => setConfirmId(null)}>
                        取消
                      </button>
                    </span>
                  ) : (
                    <button className="tm__cmtDel" onClick={() => setConfirmId(c.id)}>
                      删除
                    </button>
                  ))}
                {c.authorId !== 'me' && onReport && (
                  <button className="tm__cmtReport" onClick={() => onReport(c.id)}>
                    举报
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 评论输入条 */
export function CommentInput({ postId }: { postId: string }) {
  useTm()
  const [draft, setDraft] = useState('')
  const [, toast] = useToast()

  function send() {
    const res = addComment(postId, draft)
    if (!res.ok) {
      toast(res.error ?? '发送失败')
      return
    }
    setDraft('')
  }

  return (
    <div className="tm__cmtInput">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send()
        }}
        placeholder="写下你的评论..."
      />
      <button onClick={send} disabled={!draft.trim()}>
        发送
      </button>
    </div>
  )
}

/**
 * 举报弹层（US-08）：提交后进入管理端待处理列表，
 * 内容不会被自动下架 —— 由管理员核实后处理。
 */
export function ReportSheet({
  targetType,
  targetId,
  onClose,
}: {
  targetType: 'post' | 'comment'
  targetId: string | null
  onClose: () => void
}) {
  const [category, setCategory] = useState('')
  const [detail, setDetail] = useState('')
  const [error, setError] = useState('')
  const [, toast] = useToast()
  if (!targetId) return null

  function submit() {
    const res = report({ targetType, targetId: targetId!, category, detail })
    if (!res.ok) {
      setError(res.error ?? '举报失败')
      return
    }
    toast('举报成功，已提交管理端处理')
    onClose()
  }

  return (
    <div className="tm__sheetMask" onClick={onClose}>
      <div className="tm__sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="tm__sheetTitle">举报{targetType === 'post' ? '帖子' : '评论'}</h3>
        <p className="tm__sheetDesc">举报后内容不会被自动下架，将由学生管理员核实处理。</p>
        <div className="tm__chipRow">
          {REPORT_CATEGORIES.map((c) => (
            <button
              key={c}
              className={`tm__chipBtn ${category === c ? 'is-active' : ''}`}
              onClick={() => {
                setCategory(c)
                setError('')
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <textarea
          className="tm__textarea"
          placeholder="补充说明（选填）"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={120}
        />
        {error && <p className="tm__error">{error}</p>}
        <div className="tm__sheetActions">
          <button className="tm__btnGhost" onClick={onClose}>
            取消
          </button>
          <button className="tm__btnPrimary" onClick={submit} disabled={!category}>
            提交举报
          </button>
        </div>
      </div>
    </div>
  )
}
