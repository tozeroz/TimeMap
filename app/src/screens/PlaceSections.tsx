import { feedBrowse, openFeed } from '../data/feedBrowse'
import { mediaUrl, relativeTime, type ApiPlaceActivity, type ApiPlaceDetail, type ApiPlacePost } from '../api/client'
import { IconCalendar, IconChevronRight, IconComment, IconHeart, IconStar } from '../components/icons'
import type { PlaceFilter, PlaceSort } from './usePlaceDetail'
import './poidetail.css'

/** 地点详情的分区组件：抽屉（PlaceDetailSheet）与 #/poidetail 共用。data-pd-* 钩子保持不变。 */

export function PlaceActivitiesSection({ place, onOpenActivity, onOpenAll }: {
  place: ApiPlaceDetail
  onOpenActivity: (id: string) => void
  onOpenAll: () => void
}) {
  return <section className="pd__activities" data-place-activities={place.activities.length}>
    <div className="pd__sectionHead"><h2 className="pd__sectionTitle">近期活动</h2><button className="pd__more" data-pd-act-all={place.id} onClick={onOpenAll}>查看全部<IconChevronRight /></button></div>
    {!place.activities.length ? <p className="pd__activityEmpty"><IconCalendar size={26} />近期暂无活动</p> : <ul className="pd__actList">{place.activities.map(a => <li key={a.id}><button className="pd__act" data-place-activity={a.id} onClick={() => onOpenActivity(a.id)}><span className="pd__actTitle">{a.title}</span><span className="pd__actMeta">{formatWhen(a)}</span><span className={'pd__actBadge pd__actBadge--' + a.status}>{statusLabel(a.status)}</span></button></li>)}</ul>}
  </section>
}

export function PlaceFeedSection({ place, sort, setSort, filter, setFilter, allEmpty, feedPhase, onRetryFeed, showFilter, layout, onOpenPost, onOpenAll }: {
  place: ApiPlaceDetail
  sort: PlaceSort
  setSort: (s: PlaceSort) => void
  filter: PlaceFilter
  setFilter: (f: PlaceFilter | ((f: PlaceFilter) => PlaceFilter)) => void
  allEmpty: boolean | null
  feedPhase: 'ready' | 'loading' | 'error'
  onRetryFeed: () => void
  showFilter: boolean
  /** columns = 旧页面的 CSS 多列（按列排）；split = 抽屉的左右两列，按原始顺序交替 */
  layout: 'columns' | 'split'
  onOpenPost: (id: string, browse: string) => void
  onOpenAll: () => void
}) {
  const visible = filter === 'image' ? place.posts.filter(p => p.images?.length) : place.posts
  const filtered = filter === 'image' && place.posts.length > 0
  const emptyTitle = filtered ? '还没有符合筛选的回忆' : allEmpty === true ? '这里还没有人留下回忆' : sort === 'latest' ? '这里还没有人留下回忆' : '近期还没有新的回忆'
  const emptyText = filtered ? '试试查看全部内容，发现更多校园故事。' : allEmpty === true || sort === 'latest' ? '分享一段文字或一张照片，成为第一位记录者。' : '近期热门统计近 7 天的内容，切换「最新」查看过往回忆。'
  const reason = filtered ? 'filtered' : allEmpty === true || sort === 'latest' ? 'no-content' : 'out-of-hot-window'
  let list
  if (feedPhase === 'error') list = <p className="pd__feedError" role="status">加载失败 · <button className="pd__mapLink" onClick={onRetryFeed}>重试</button></p>
  else if (!visible.length) list = <div className="pd__empty" role="status" data-pd-posts="empty" data-pd-empty-reason={reason}><MemoryArtwork /><h3>{emptyTitle}</h3><p>{emptyText}</p>{(filtered || reason === 'out-of-hot-window') && <button className="pd__mapLink" onClick={() => { setFilter('all'); setSort('latest') }}>查看最新内容 →</button>}</div>
  else if (layout === 'split') list = <div className="pd__postSplit" data-pd-posts={visible.length}>
    {[0, 1].map(col => <ul key={col} className="pd__postCol">{visible.map((post, i) => i % 2 === col ? <PostRow key={post.id} post={post} index={i} onOpen={id => { openFeed(id, visible.map(item => item.id)); onOpenPost(id, feedBrowse.token) }} /> : null)}</ul>)}
  </div>
  else list = <ul className="pd__postList" data-pd-posts={visible.length}>{visible.map((post, i) => <PostRow key={post.id} post={post} index={i} onOpen={id => { openFeed(id, visible.map(item => item.id)); onOpenPost(id, feedBrowse.token) }} />)}</ul>
  return <section className="pd__feed">
    <div className="pd__sectionHead"><h2 className="pd__sectionTitle">地点内容</h2><div className="pd__tools">{showFilter && <><button className={'pd__more ' + (filter === 'image' ? 'is-active' : '')} aria-pressed={filter === 'image'} data-pd-filter={filter} onClick={() => setFilter(f => f === 'all' ? 'image' : 'all')}><span aria-hidden="true">☷</span>{filter === 'image' ? '仅图文' : '筛选'}</button><span className="pd__separator" /></>}<button className="pd__more" data-pd-all={place.id} onClick={onOpenAll}>查看全部<IconChevronRight /></button></div></div>
    <div className="pd__sorts" aria-label="内容排序">{(['latest', 'hot'] as const).map(key => <button key={key} className={'pd__sort ' + (sort === key ? 'is-active' : '')} aria-pressed={sort === key} data-pd-sort={key} onClick={() => setSort(key)}>{key === 'latest' ? '最新' : '近期热门'}</button>)}</div>
    <div className="pd__feedList" aria-busy={feedPhase === 'loading'}>{list}</div>
    <details className="pd__hotNote" data-pd-hot-note><summary><span aria-hidden="true">ⓘ</span>热门如何排序？<span className="pd__disclosure" aria-hidden="true">⌄</span></summary><p>近期热门统计近 7 天发布的内容，按点赞 × 2 + 有效评论 × 3 + 收藏 − 发布超 24 小时后的衰减排序。</p></details>
  </section>
}

export function MemoryArtwork() {
  return <svg className="pd__memoryArt" viewBox="0 0 180 110" fill="none" aria-hidden="true"><path d="M12 95c43-38 48 31 94 1s59-21 57-2c-5 29-59 9-66-20-9-37 49-37 37-3-5 14-21 30-28 32" stroke="#a8b6a0" strokeWidth="1.6" strokeDasharray="6 5"/><circle cx="113" cy="65" r="7" stroke="#a8b6a0" strokeWidth="1.6"/><g stroke="#ed7949" strokeWidth="2"><path d="m48 71 25-48q4-7 11-2l2 2q3 2 0 7L61 78 46 88zM51 75l10 3M48 71l9 5 26-49M73 23l12 7M46 88l3-9"/><path d="m139 31 7-9m1 19 10-4" strokeOpacity=".5"/></g></svg>
}

export function PostRow({ post, index, onOpen }: { post: ApiPlacePost; index: number; onOpen: (id: string) => void }) {
  const first = post.images && post.images.length > 0 ? post.images[0]! : null
  const img = first ? mediaUrl(first.id) : null
  const sized = first && typeof first.width === 'number' && typeof first.height === 'number' && first.width > 0 && first.height > 0
  return (
    <li>
      <button
        className={`pd__post ${img ? 'pd__post--media' : 'pd__post--text'}`}
        data-pd-post={post.id}
        data-index={index}
        data-post-favorites={String(post.favoriteCount)}
        onClick={() => onOpen(post.id)}
      >
        {img && <img className="pd__postImg" src={img} alt="" loading="lazy" {...(sized ? { width: first.width!, height: first.height! } : {})} />}
        <span className="pd__postMain">
          <span className="pd__postAuthor">{post.author}{post.anonymous && <span className="anon-tag" data-anon-tag>匿名</span>}</span>
          <span className="pd__postBody">{post.body}</span>
          <span className="pd__postTime">{relativeTime(post.createdAt)}</span>
          <span className="pd__postStats">
            {/* 0 赞/0 评论时不渲染计数（沿用既有口径）；收藏数同理 */}
            {post.likeCount > 0 && (
              <span className="pd__postStat">
                <IconHeart size={13} />
                {post.likeCount}
              </span>
            )}
            {post.commentCount > 0 && (
              <span className="pd__postStat">
                <IconComment size={13} />
                {post.commentCount}
              </span>
            )}
            <span className={`pd__postStat ${post.favoritedByMe ? 'is-on' : ''}`}>
              <IconStar size={13} filled={post.favoritedByMe} />
              {post.favoriteCount > 0 ? post.favoriteCount : ''}
            </span>
          </span>
        </span>
      </button>
    </li>
  )
}

/** 活动时间：只显示到"分钟"，避免秒位噪音（展示态由服务端给，这里只格式化） */
function formatWhen(a: ApiPlaceActivity): string {
  const s = new Date(a.startsAt)
  if (Number.isNaN(s.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(s)
}

function statusLabel(status: ApiPlaceActivity['status']): string {
  return status === 'ongoing'
    ? '进行中'
    : status === 'upcoming'
      ? '即将开始'
      : status === 'ended'
        ? '已结束'
        : '已取消'
}
