import { useEffect, useRef, useState } from 'react'
import { getPlace, mediaUrl, relativeTime, type ApiPlaceActivity, type ApiPlaceDetail, type ApiPlacePost } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconCalendar, IconChevronRight, IconComment, IconEdit, IconHeart, IconLocation, IconStar } from '../components/icons'
import { goBack, navigate } from '../router'
import { TimeMachine } from './TimeMachine'
import './poidetail.css'

/** Concrete place detail; school-level map aggregation remains in the map domain. */
export function PoiDetailScreen({ id }: { id: string }) {
  const [place, setPlace] = useState<ApiPlaceDetail | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'not_found'>('loading')
  const [error, setError] = useState('')
  // PLACE-002 retains the existing default: recent popular posts.
  const [sort, setSort] = useState<'latest' | 'hot'>('hot')
  const [filter, setFilter] = useState<'all' | 'image'>('all')
  const [allEmpty, setAllEmpty] = useState<boolean | null>(null)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    const version = ++generation.current
    setPhase('loading'); setAllEmpty(null)
    if (!id) { setError('未指定地点'); setPhase('error'); return }
    void (async () => {
      const result = await getPlace(id, sort)
      if (version !== generation.current) return
      if (!result.ok) {
        setError(result.human ?? result.reason)
        setPhase(result.status === 404 ? 'not_found' : 'error'); return
      }
      setPlace(result.value); setPhase('ready')
      // Production's legacy postCount is the returned window size, not an all-time count.
      // Probe latest only for an empty hot window; a failed probe must not claim no content.
      if (sort === 'hot' && result.value.posts.length === 0) {
        const latest = await getPlace(id, 'latest')
        if (version === generation.current && latest.ok) setAllEmpty(latest.value.posts.length === 0)
      } else setAllEmpty(result.value.posts.length === 0)
    })()
    return () => { generation.current++ }
  }, [id, sort, retry])

  const header = <TopBar variant="plain" left={<button className="iconbtn" onClick={() => goBack('map')} aria-label="返回地图"><IconBack size={24} /></button>} center={<span className="pd__topTitle">地点详情</span>} />
  if (phase !== 'ready' || !place) return <Screen className="pd-page" header={header}><div className="pd__state" role="status" data-pd-phase={phase}>
    <p>{phase === 'loading' ? '正在寻找这处校园记忆…' : phase === 'not_found' ? '地点不存在' : '地点加载失败'}</p>
    {phase === 'error' && <p className="pd__stateSub">{error}</p>}
    {phase === 'error' && <button className="pd__retry" onClick={() => setRetry(n => n + 1)}>重试</button>}
    {phase === 'not_found' && <button className="pd__retry" onClick={() => navigate('map')}>返回地图</button>}
  </div></Screen>
  const visible = filter === 'image' ? place.posts.filter(p => p.images?.length) : place.posts
  const filtered = filter === 'image' && place.posts.length > 0
  const emptyTitle = filtered ? '还没有符合筛选的回忆' : allEmpty === true ? '这里还没有人留下回忆' : '近期还没有新的回忆'
  const emptyText = filtered ? '试试查看全部内容，发现更多校园故事。' : allEmpty === true ? '分享一段文字或一张照片，成为第一位记录者。' : '近期热门统计近 7 天的内容，切换「最新」查看过往回忆。'
  return <Screen className="pd-page" header={header} footer={<div className="pd__actions">{place.enabled ? <button className="pd__publishBtn" data-pd-publish={place.id} onClick={() => navigate('publish', { placeId: place.id })}><IconEdit size={25} />在这里发布</button> : <p className="pd__publishHint" data-pd-publish-disabled>该地点已停用，暂时无法在这里发布。</p>}</div>}>
    <article className="pd" data-place-id={place.id} data-place-category={place.category} data-pd-phase="ready">
      <section className="pd__intro">
        <GateArtwork />
        <div className="pd__category" data-place-category-chip><IconLocation size={19} />{place.category}{!place.enabled && <span className="pd__disabledTag">已停用</span>}</div>
        <h1 className="pd__name" data-place-name>{place.name}</h1>
        {place.address && <p className="pd__addr"><IconLocation size={18} />{place.address}</p>}
        {place.description && <p className="pd__desc" data-place-desc>{place.description}</p>}
        <button className="pd__mapLink" onClick={() => navigate('map', { placeId: place.id })}>在地图中查看 <span aria-hidden="true">→</span></button>
      </section>
      <TimeMachine photos={place.photos} history={place.history} />
      <section className="pd__activities" data-place-activities={place.activities.length}>
        <div className="pd__sectionHead"><h2 className="pd__sectionTitle">近期活动</h2><button className="pd__more" data-pd-act-all={place.id} onClick={() => navigate('activities', { placeId: place.id })}>查看全部<IconChevronRight /></button></div>
        {!place.activities.length ? <p className="pd__activityEmpty"><IconCalendar size={26} />近期暂无活动</p> : <ul className="pd__actList">{place.activities.map(a => <li key={a.id}><button className="pd__act" data-place-activity={a.id} onClick={() => navigate('activity', { id: a.id, placeId: place.id })}><span className="pd__actTitle">{a.title}</span><span className="pd__actMeta">{formatWhen(a)}</span><span className={'pd__actBadge pd__actBadge--' + a.status}>{statusLabel(a.status)}</span></button></li>)}</ul>}
      </section>
      <section className="pd__feed">
        <div className="pd__sectionHead"><h2 className="pd__sectionTitle">地点内容</h2><div className="pd__tools"><button className={'pd__more ' + (filter === 'image' ? 'is-active' : '')} aria-pressed={filter === 'image'} data-pd-filter={filter} onClick={() => setFilter(f => f === 'all' ? 'image' : 'all')}><span aria-hidden="true">☷</span>{filter === 'image' ? '仅图文' : '筛选'}</button><span className="pd__separator" /><button className="pd__more" data-pd-all={place.id} onClick={() => navigate('campus', { placeId: place.id })}>查看全部<IconChevronRight /></button></div></div>
        <div className="pd__sorts" aria-label="内容排序">{(['latest', 'hot'] as const).map(key => <button key={key} className={'pd__sort ' + (sort === key ? 'is-active' : '')} aria-pressed={sort === key} data-pd-sort={key} onClick={() => setSort(key)}>{key === 'latest' ? '最新' : '近期热门'}</button>)}</div>
        {visible.length ? <ul className="pd__postList" data-pd-posts={visible.length}>{visible.map(post => <PostRow key={post.id} post={post} />)}</ul> : <div className="pd__empty" role="status" data-pd-posts="empty" data-pd-empty-reason={filtered ? 'filtered' : allEmpty === true ? 'no-content' : 'out-of-hot-window'}><MemoryArtwork /><h3>{emptyTitle}</h3><p>{emptyText}</p>{(filtered || allEmpty !== true) && <button className="pd__mapLink" onClick={() => { setFilter('all'); setSort('latest') }}>查看最新内容 →</button>}</div>}
        <details className="pd__hotNote" data-pd-hot-note><summary><span aria-hidden="true">ⓘ</span>热门如何排序？<span className="pd__disclosure" aria-hidden="true">⌄</span></summary><p>近期热门统计近 7 天发布的内容，按点赞 × 2 + 有效评论 × 3 + 收藏 − 发布超 24 小时后的衰减排序。</p></details>
      </section>
    </article>
  </Screen>
}

function GateArtwork() {
  return <svg className="pd__gate" viewBox="0 0 200 160" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="2.2"><path d="M7 145h186M40 144V65h18v79M142 144V65h18v79M36 65h26v-7H36zM138 65h26v-7h-26zM58 78h84v12H58zM60 143v-39q40-28 80 0v39M88 78V41h24v37M84 41h32v-6H84zM96 35V22h8v13M47 58V46m105 12V46"/><path d="M19 145v-23m-7 6q-12-24 6-29 17 10 10 29zM180 145v-29m-8 9q-12-26 7-39 19 14 9 39z" fill="currentColor" fillOpacity=".18"/></g></svg>
}
function MemoryArtwork() {
  return <svg className="pd__memoryArt" viewBox="0 0 180 110" fill="none" aria-hidden="true"><path d="M12 95c43-38 48 31 94 1s59-21 57-2c-5 29-59 9-66-20-9-37 49-37 37-3-5 14-21 30-28 32" stroke="#a8b6a0" strokeWidth="1.6" strokeDasharray="6 5"/><circle cx="113" cy="65" r="7" stroke="#a8b6a0" strokeWidth="1.6"/><g stroke="#ed7949" strokeWidth="2"><path d="m48 71 25-48q4-7 11-2l2 2q3 2 0 7L61 78 46 88zM51 75l10 3M48 71l9 5 26-49M73 23l12 7M46 88l3-9"/><path d="m139 31 7-9m1 19 10-4" strokeOpacity=".5"/></g></svg>
}

function PostRow({ post }: { post: ApiPlacePost }) {
  const img = post.images && post.images.length > 0 ? mediaUrl(post.images[0]!.id) : null
  return (
    <li>
      <button
        className={`pd__post ${img ? 'pd__post--media' : 'pd__post--text'}`}
        data-pd-post={post.id}
        data-post-favorites={String(post.favoriteCount)}
        onClick={() => navigate('feed', { id: post.id })}
      >
        {img && <img className="pd__postImg" src={img} alt="" loading="lazy" />}
        <span className="pd__postMain">
          <span className="pd__postAuthor">{post.author}</span>
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
