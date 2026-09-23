import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconHeart, IconStar } from '../components/icons'
import { CommentInput, CommentList, ReportSheet, TagChip, useTm, useToast, Toast } from '../components/TmPostCard'
import { relativeTime } from '../data/timemap'
import {
  commentCount,
  deletePost,
  favoriteCount,
  getPlace,
  getPost,
  likeCount,
  toggleFavorite,
  toggleLike,
  userById,
} from '../data/tmStore'
import { goBack, navigate } from '../router'

/**
 * 帖子详情（US-02/US-03/US-08）：
 * - 作者 / 地点 / 正文或媒体 / 互动与评论
 * - 下架后不显示正文（状态页 + 返回入口，4.4 异常反馈）
 * - 点赞只计一次可取消；收藏可撤销；作者可删除自己的帖子
 * - 普通用户可举报；举报不自动下架
 */
export function FeedDetailScreen({ id }: { id: string }) {
  useTm()
  const post = getPost(id)
  const [reportOpen, setReportOpen] = useState(false)
  const [cmtReport, setCmtReport] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, showToast] = useToast()

  if (!post || post.status === 'removed') {
    return (
      <Screen
        header={
          <TopBar
            left={
              <button className="iconbtn" onClick={() => goBack('map')} aria-label="返回">
                <IconBack size={22} />
              </button>
            }
          />
        }
      >
        <div className="tm__statusPage">
          <h2>内容不存在或已下架</h2>
          <p>该内容已被作者删除或由管理员下架。</p>
          <button className="tm__btnPrimary" onClick={() => navigate('map')}>
            返回地图
          </button>
        </div>
      </Screen>
    )
  }

  const author = userById(post.authorId)
  const place = getPlace(post.placeId)
  const mine = post.authorId === 'me'

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('map')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          right={
            <button className="fd__reportBtn" onClick={() => setReportOpen(true)}>
              举报
            </button>
          }
        />
      }
      footer={
        <div className="fd__bar">
          <CommentInput postId={post.id} />
          <button
            className={`fd__act ${post.likedByMe ? 'is-on' : ''}`}
            onClick={() => toggleLike(post.id)}
            aria-pressed={post.likedByMe}
            aria-label={post.likedByMe ? '取消点赞' : '点赞'}
            data-act="like"
            data-count={likeCount(post)}
          >
            <IconHeart size={20} filled={post.likedByMe} />
            {likeCount(post)}
          </button>
          <button
            className={`fd__act ${post.favoritedByMe ? 'is-fav' : ''}`}
            onClick={() => toggleFavorite(post.id)}
            aria-pressed={post.favoritedByMe}
            aria-label={post.favoritedByMe ? '取消收藏' : '收藏'}
            data-act="favorite"
            data-count={favoriteCount(post)}
          >
            <IconStar size={20} filled={post.favoritedByMe} />
            {favoriteCount(post)}
          </button>
        </div>
      }
    >
      <article className="fd__post">
        <header className="fd__author">
          <img className="fd__avatar" src={author.avatar} alt="" />
          <div className="fd__authorMain">
            <span className="fd__authorName">{author.name}</span>
            <span className="fd__authorMeta">
              {author.college ? `${author.college} · ` : ''}
              {relativeTime(post.createdAt)}
            </span>
          </div>
          {mine &&
            (confirmDelete ? (
              <span className="tm__confirmRow">
                <button
                  className="tm__confirmYes"
                  onClick={() => {
                    setConfirmDelete(false)
                    const res = deletePost(post.id)
                    showToast(res.ok ? '已删除' : (res.error ?? '删除失败'))
                  }}
                >
                  确认删除
                </button>
                <button className="tm__confirmNo" onClick={() => setConfirmDelete(false)}>
                  取消
                </button>
              </span>
            ) : (
              <button className="fd__delBtn" onClick={() => setConfirmDelete(true)}>
                删除
              </button>
            ))}
        </header>

        {place && (
          <button className="fd__place" onClick={() => navigate('place', { id: place.id })}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s6.5-5.4 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.6 12 21 12 21Z" />
              <circle cx="12" cy="10.6" r="2.3" />
            </svg>
            {place.name}
          </button>
        )}

        {post.tags.length > 0 && (
          <div className="tm__postTags">
            {post.tags.map((t) => (
              <TagChip key={t} tag={t} placeCategory={place?.category} />
            ))}
          </div>
        )}

        {post.text && <p className="fd__text">{post.text}</p>}

        {post.images.length > 0 && (
          <div className={`fd__imgs fd__imgs--${post.images.length}`}>
            {post.images.slice(0, 3).map((src, i) => (
              <img key={i} className="fd__img" src={src} alt="" />
            ))}
          </div>
        )}
      </article>

      <section className="fd__comments">
        <h3 className="fd__commentsTitle">评论 {commentCount(post.id)}</h3>
        <CommentList postId={post.id} onReport={(cid) => setCmtReport(cid)} />
      </section>
      <Toast msg={toast} />
      <ReportSheet targetType="post" targetId={reportOpen ? post.id : null} onClose={() => setReportOpen(false)} />
      <ReportSheet targetType="comment" targetId={cmtReport} onClose={() => setCmtReport(null)} />
    </Screen>
  )
}
