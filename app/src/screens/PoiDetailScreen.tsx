import { useCallback, useEffect, useState } from 'react'
import {
  avatarFor,
  getPlace,
  mediaUrl,
  relativeTime,
  type ApiPlaceActivity,
  type ApiPlaceDetail,
  type ApiPlacePost,
} from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconComment, IconHeart, IconStar } from '../components/icons'
import { goBack, navigate } from '../router'
import './poidetail.css'

/**
 * 地点详情（F03 / US-01；按需求 **4.2 的地点详情草图**重做）。
 *
 * ## 为什么重做（不是"再加几个字段"）
 *   改前这一页是按**原版 poi-detail 的控件树**做的（返回 + 地点名 + 距离/地址 +
 *   左侧一张动态图）。那是**另一个产品**的地点页：它只列动态，没有简介、没有校史、
 *   没有老照片、没有活动，也没有"在这里发布"。
 *   而 TimeMap 的需求 4.2 把它定义成"地点的内容中枢"：
 *     ```
 *     ‹ 返回地图            地点名称
 *     [地点封面]
 *     地点名称｜分类
 *     地点简介与校园背景
 *     [校史与老照片]  [在这里发布]
 *     近期活动｜标题 / 时间 / 状态
 *     [最新] [近期热门] [内容筛选]
 *     作者 / 时间  正文或图片预览  点赞 评论 收藏
 *     ```
 *   ⇒ 因此本页按需求重写，而不是在旧结构上打补丁。
 *
 * ## US-01 验收标准逐条落点
 *   ① 「地图标记与地点详情内容一致」→ 两者都读 `GET /api/places` / `:id`，同一份权威数据
 *   ② 「历史照片显示年代和来源，年代不明时如实说明」
 *      → 每张照片都渲染 `yearLabel` 与 `source`；`yearLabel` 是**文本**，
 *        上游写"年代不详"就原样显示（不编年份）
 *   ③ 「地点没有帖子时仍显示基础资料和发布入口」
 *      → 帖子为空只影响帖子区，简介/校史/老照片/发布入口照常渲染
 *   ④ 「返回地图后保留原浏览区域」→ 返回走 `goBack('map')`（浏览器历史），
 *      地图自身的视图状态由 MapScreen 保留（本页不重置它）
 *   ⑤ 「停用地点不能再关联新帖子」→ 服务端强校验；本页对停用地点**隐藏发布入口**
 *      并明确说明原因（而不是留一个点了必然失败的按钮）
 */
export function PoiDetailScreen({ id }: { id: string }) {
  const [place, setPlace] = useState<ApiPlaceDetail | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading')
  const [err, setErr] = useState('')
  /** 帖子区排序：'latest' 最新 | 'hot' 近期热门（排序**由服务端做**） */
  const [sort, setSort] = useState<'latest' | 'hot'>('latest')
  /** 内容筛选：全部 | 带图（US-03「地点页面支持最新、近期热门及食堂标签筛选」） */
  const [filter, setFilter] = useState<'all' | 'image'>('all')

  const load = useCallback(
    async (which: 'latest' | 'hot') => {
      if (!id) {
        setErr('未指定地点（缺少 id 参数）')
        setState('error')
        return
      }
      setState('loading')
      const r = await getPlace(id, which)
      if (r.ok) {
        setPlace(r.value)
        setState('ready')
        return
      }
      if (r.status === 404) {
        setState('not_found')
        return
      }
      setErr(r.reason)
      setState('error')
    },
    [id],
  )

  useEffect(() => {
    void load(sort)
  }, [load, sort])

  const header = (
    <TopBar
      left={
        <button className="iconbtn" onClick={() => goBack('map')} aria-label="返回地图">
          <IconBack size={22} />
        </button>
      }
      center={<span className="pd__topTitle">{place?.name ?? '地点'}</span>}
    />
  )

  if (state === 'loading') {
    return (
      <Screen header={header}>
        <p className="pd__state">加载中…</p>
      </Screen>
    )
  }

  if (state === 'not_found') {
    return (
      <Screen header={header}>
        <div className="pd__state" data-pd-phase="not_found">
          <p>地点不存在</p>
          <button className="pd__retry" onClick={() => navigate('map')}>
            返回地图
          </button>
        </div>
      </Screen>
    )
  }

  if (state === 'error' || !place) {
    return (
      <Screen header={header}>
        <div className="pd__state" data-pd-phase="error">
          <p>地点加载失败</p>
          <p className="pd__stateSub">{err}</p>
          <button className="pd__retry" onClick={() => void load(sort)}>
            重试
          </button>
        </div>
      </Screen>
    )
  }

  const cover = place.photos[0]?.imageUrl ?? null
  const visiblePosts = filter === 'image' ? place.posts.filter((p) => (p.images ?? []).length > 0) : place.posts

  return (
    <Screen header={header} scroll>
      <section className="pd" data-place-id={place.id} data-place-category={place.category}>
        {/* 地点封面（第一张老照片；没有照片就不渲染伪封面） */}
        {cover && <img className="pd__cover" src={cover} alt="" />}

        <div className="pd__head">
          <h2 className="pd__name" data-place-name>
            {place.name}
          </h2>
          <span className="pd__category" data-place-category-chip>
            {place.category}
          </span>
          {!place.enabled && (
            /* US-01⑤：停用地点——明确说明为什么不能在这里发布（而不是留个必然失败的按钮） */
            <span className="pd__disabledTag" data-place-disabled>
              已停用
            </span>
          )}
        </div>
        {place.address && <p className="pd__addr">{place.address}</p>}

        {/* 地点简介与校园背景 */}
        {place.description && <p className="pd__desc" data-place-desc>{place.description}</p>}

        {/*
          校史 + 老照片。
          ⚠️ history 为 null 时**如实说明"暂无校史资料"**，不编造内容（US-01②）。
        */}
        <section className="pd__history" data-place-history={place.history ? 'present' : 'absent'}>
          <h3 className="pd__sectionTitle">校史与老照片</h3>
          {place.history ? (
            <p className="pd__historyText">{place.history}</p>
          ) : (
            <p className="pd__historyEmpty">暂无校史资料</p>
          )}
          {place.photos.length > 0 && (
            <ul className="pd__photos no-scrollbar">
              {place.photos.map((ph) => (
                <li key={ph.id} className="pd__photo" data-photo-year={ph.yearLabel}>
                  {ph.imageUrl && <img className="pd__photoImg" src={ph.imageUrl} alt={ph.title} loading="lazy" />}
                  <span className="pd__photoTitle">{ph.title}</span>
                  {/* 年代与来源**都必须显示**（验收项②） */}
                  <span className="pd__photoYear">{ph.yearLabel}</span>
                  <span className="pd__photoSource" data-photo-source>
                    来源：{ph.source}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 「在这里发布」：带 placeId 预选（US-02：地点必填，但用户仍可在发布页改） */}
        <section className="pd__actions">
          {place.enabled ? (
            <button
              className="pd__publishBtn"
              data-pd-publish={place.id}
              onClick={() => navigate('publish', { placeId: place.id })}
            >
              在这里发布
            </button>
          ) : (
            <p className="pd__publishHint" data-pd-publish-disabled>
              该地点已停用，不能再关联新帖子（已有帖子仍在下方）。
            </p>
          )}
        </section>

        {/* 近期活动：标题 / 时间 / 状态（草图的中间一段） */}
        <section className="pd__activities" data-place-activities={String(place.activities.length)}>
          <h3 className="pd__sectionTitle">近期活动</h3>
          {place.activities.length === 0 ? (
            <p className="pd__empty">近期没有在此地点举办的活动</p>
          ) : (
            <ul className="pd__actList">
              {place.activities.map((a) => (
                <li key={a.id}>
                  <button
                    className="pd__act"
                    data-place-activity={a.id}
                    data-activity-status={a.status}
                    onClick={() => navigate('activity', { id: a.id, placeId: place.id })}
                  >
                    <span className="pd__actTitle">{a.title}</span>
                    <span className="pd__actMeta">{formatWhen(a)}</span>
                    <span className={`pd__actBadge pd__actBadge--${a.status}`}>{statusLabel(a.status)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 帖子：最新 / 近期热门 + 内容筛选 */}
        <section className="pd__feed">
          <div className="pd__feedHead">
            <h3 className="pd__sectionTitle">地点内容</h3>
            <div className="pd__sorts">
              {(
                [
                  { key: 'latest', label: '最新' },
                  { key: 'hot', label: '近期热门' },
                ] as const
              ).map((s) => (
                <button
                  key={s.key}
                  className={`pd__sort ${sort === s.key ? 'is-active' : ''}`}
                  data-pd-sort={s.key}
                  onClick={() => setSort(s.key)}
                >
                  {s.label}
                </button>
              ))}
              <button
                className={`pd__sort ${filter === 'image' ? 'is-active' : ''}`}
                data-pd-filter={filter === 'image' ? 'image' : 'all'}
                onClick={() => setFilter((f) => (f === 'all' ? 'image' : 'all'))}
              >
                {filter === 'image' ? '仅看图文' : '内容筛选'}
              </button>
            </div>
          </div>

          {/*
            US-01③：**没有帖子时仍显示基础资料和发布入口** ——
            所以这里只是一条空态文案，上面的简介/校史/发布按钮都照常存在。

            ⚠️ 空态文案必须**区分三种原因**（2026-10-09 用户实际提问"点近期热门怎么没东西"）：
              ① 这个地点从来没有内容            → 邀请发布
              ② 有内容，但都在 7 天窗口之外      → **说明"近期"的口径**，否则用户会以为坏了
              ③ 有内容，但被「仅看图文」筛掉     → 说明是筛选的锅
            改前只有「没有符合当前筛选的内容」一句 → 用户看到"近期热门"是空的，
            而"最新"里明明有帖子，却没有任何解释。**界面没解释自己的口径 = 看起来像故障。**
          */}
          {visiblePosts.length === 0 ? (
            <p className="pd__empty" data-pd-posts="empty" data-pd-empty-reason={
              place.posts.length === 0 ? 'no-content' : sort === 'hot' ? 'out-of-hot-window' : 'filtered'
            }>
              {place.posts.length === 0
                ? '这个地点还没有内容，来发第一条吧'
                : sort === 'hot'
                  ? `近期热门只统计**近 7 天**发布的内容，这个地点近 7 天没有新帖（下方「最新」里能看到更早的 ${place.posts.length} 条）。`
                  : '没有符合当前筛选的内容'}
            </p>
          ) : (
            <ul className="pd__postList" data-pd-posts={String(visiblePosts.length)}>
              {visiblePosts.map((p) => (
                <PostRow key={p.id} post={p} />
              ))}
            </ul>
          )}

          {/*
            口径说明：**空态时更要显示**（那正是用户需要解释的时候），
            所以它放在空态/列表之外，与 visiblePosts.length 无关。
          */}
          {sort === 'hot' && (
            <p className="pd__hotNote" data-pd-hot-note>
              近期热门 = 近 7 天内发布的内容，按 点赞×2 + 有效评论×3 + 收藏×1 − 发布超 24 小时的衰减 排序。
              {visiblePosts.length === 0 && place.posts.length > 0 && ' 想看过往内容请切到「最新」。'}
            </p>
          )}
        </section>
      </section>
    </Screen>
  )
}

function PostRow({ post }: { post: ApiPlacePost }) {
  const img = post.images && post.images.length > 0 ? mediaUrl(post.images[0]!.id) : null
  return (
    <li>
      <button
        className="pd__post"
        data-pd-post={post.id}
        data-post-favorites={String(post.favoriteCount)}
        onClick={() => navigate('feed', { id: post.id })}
      >
        {img ? (
          <img className="pd__postImg" src={img} alt="" loading="lazy" />
        ) : (
          <img className="pd__postImg pd__postImg--ph" src={avatarFor(post.author)} alt="" />
        )}
        <span className="pd__postMain">
          <span className="pd__postAuthor">{post.author}</span>
          <span className="pd__postBody">{post.body}</span>
          <span className="pd__postTime">{relativeTime(post.createdAt)}</span>
        </span>
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
      </button>
    </li>
  )
}

/** 活动时间：只显示到"分钟"，避免秒位噪音（展示态由服务端给，这里只格式化） */
function formatWhen(a: ApiPlaceActivity): string {
  const s = new Date(a.startsAt)
  if (Number.isNaN(s.getTime())) return '时间未知'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())} ${pad(s.getHours())}:${pad(s.getMinutes())}`
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
