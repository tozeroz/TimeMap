import { useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconBack } from '../components/icons'
import { CommentInput, CommentList, ReportSheet, useTm } from '../components/TmPostCard'
import { relativeTime } from '../data/timemap'
import { commentCount, getPost, userById } from '../data/tmStore'
import { goBack, navigate } from '../router'

/**
 * 评论详情页（US-03/US-08）：
 * - 顶部为帖子作者与日期；评论仅本人可删除，删除后不计入有效评论量
 * - 每条评论可举报；举报后进入管理端待处理列表，不自动下架
 */
export function CommentsScreen({ id }: { id: string }) {
  useTm()
  const post = getPost(id)
  const [reportTarget, setReportTarget] = useState<string | null>(null)

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
            <div className="cd__head">
              <img className="cd__avatar" src={author.avatar} alt="" />
              <div className="cd__headText">
                <span className="cd__name">{author.name}</span>
                <span className="cd__date">{relativeTime(post.createdAt)}</span>
              </div>
            </div>
          }
        />
      }
      footer={<CommentInput postId={post.id} />}
    >
      <div className="cd__body">
        <h3 className="cd__count">评论 {commentCount(post.id)}</h3>
        <CommentList postId={post.id} onReport={(cid) => setReportTarget(cid)} />
      </div>
      <ReportSheet targetType="comment" targetId={reportTarget} onClose={() => setReportTarget(null)} />
    </Screen>
  )
}
