import { useCallback, useEffect, useRef, useState } from 'react'
import {
  failText,
  likePost,
  listPlaces,
  listPosts,
  listSchoolCampuses,
  listSchools,
  readSnapshot,
  toFeedPost,
  unlikePost,
  type ApiCampus,
  type ApiPlaceListItem,
  type ApiSchool,
} from '../api/client'
import { isLoggedIn } from '../api/session'
import { BigTitle, Screen } from '../components/Shell'
import {
  IconChatBubble,
  IconCheck,
  IconChevronDown,
  IconComment,
  IconHeart,
  IconSearch,
} from '../components/icons'
// 注意：这里**不再** import mock 的 `posts` —— 校园页已迁移到真实 API，
// 在线时 API 是权威数据源（审核记录 07 的降级边界：已迁移页面不得混入 synthetic mock）。
import type { FeedPost } from '../data/types'
import { feedAuthoritative, setServerPosts, subscribeMyPosts } from '../data/store'
import { navigate, useRoute } from '../router'
import '../styles/switcher.css'
import './campus.css'

/**
 * 瀑布流卡片。
 * 对齐原版：
 * 1) 有图卡片：作者行在图片**上方**，正文压在图片底部
 * 2) 无图卡片：白底圆角，正文 + 作者行 + 互动数
 * 3) 点作者行进入 TA 的主页；点卡片进动态详情；点心形是点赞
 */
export function PostCard({
  post,
  liked: likedProp,
  onLike,
}: {
  post: FeedPost
  /** 是否已点赞（M3 Slice 2 起由服务端的 likedByMe 决定） */
  liked?: boolean
  /** 点赞/取消点赞；由外层调真实接口，卡片自己不做本地假切换 */
  onLike?: () => void
}) {
  const liked = likedProp ?? post.liked
  /**
   * 计数一律用服务端返回值（post.likes）。
   * **不再本地加减**：原版侧看不到切换行为（写操作禁止取证），
   * 与其猜"点一下数字怎么变"，不如让服务端返回权威计数 —— 也避免了
   * "本地 +1、服务端没变"这种假成功。
   */
  const likes = post.likes
  const hasImage = post.images.length > 0

  function toggleLike(e: React.MouseEvent) {
    e.stopPropagation()
    onLike?.()
  }

  function openAuthor(e: React.MouseEvent) {
    e.stopPropagation()
    navigate('user', { id: post.author.id })
  }

  return (
    <article
      className={`pcard ${hasImage ? 'pcard--media' : 'pcard--text'}`}
      /*
        稳定业务身份的测试钩子（M5 WO#11 加）：
        卡片的 id 此前只存在于 onClick 里，DOM 上无迹可寻 ——
        于是 Gate 只能靠"第几行/文案"去认卡片，那正是审核 47 禁止的
        "按偶然位置选择测试对象"。加 data-feed-id 后，设备侧可以按**帖子 id**做集合比对
        （CampusScreen 与 FeedListScreen 共用本组件，两边都受益）。
        ⚠️ 它纯粹是测试钩子，不携带任何行为。
      */
      data-feed-id={post.id}
      onClick={() => navigate('feed', { id: post.id })}
    >
      {hasImage ? (
        <>
          <button className="pcard__author" onClick={openAuthor}>
            <img className="pcard__avatar" src={post.author.avatar} alt="" />
            <span className="pcard__author-name">{post.author.name}</span>
          </button>
          <div className="pcard__mediaWrap">
            <img
              className="pcard__cover"
              src={post.images[0]}
              alt=""
              loading="lazy"
              style={post.ratio ? { aspectRatio: post.ratio } : undefined}
            />
            <div className="pcard__overlay">
              <p className="pcard__overlay-text">{post.text}</p>
              <button
                className={`pcard__like pcard__like--on-image ${liked ? 'is-liked' : ''}`}
                onClick={toggleLike}
              >
                <IconHeart size={13} filled={liked} />
                <span>{likes}</span>
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="pcard__body">
          <p className="pcard__text">{post.text}</p>
          {post.topic && <span className="pcard__topic">{post.topic}</span>}
          <div className="pcard__foot">
            <button className="pcard__authorBtn" onClick={openAuthor}>
              <img className="pcard__avatar" src={post.author.avatar} alt="" />
              <span className="pcard__name">{post.author.name}</span>
            </button>
            <span className="pcard__meta">
              <button className={`pcard__like ${liked ? 'is-liked' : ''}`} onClick={toggleLike}>
                <IconHeart size={14} filled={liked} />
                <span>{likes}</span>
              </button>
              <span className="pcard__comment">
                <IconComment size={14} />
                <span>{post.comments}</span>
              </span>
            </span>
          </div>
        </div>
      )}
    </article>
  )
}

/**
 * 学校/校区数据**尚未接入**时的面板（M5 WO#16 · 层 A，审核 60 批准）
 *
 * ## 为什么不再是原来那个"学校切换面板"
 *   原实现渲染 `mock.schools` 的 **8 个学校**，每行还带 `region` 与 `members`
 *   （如 `'12,486'`）—— 这些**都没有出处**（`schools` / `campuses` 两表为空、
 *   三个用户 `school_campus_id` 全为 NULL）。
 *   审核 60 明确：**不许**继续用 mock 学校数据。
 *
 * ## 但**不能**把整个控件删掉（这是审核 60 对我原计划的修正）
 *   基线证明「**校园广场 ▼**」这个入口**本身存在**：
 *     `screens/trident-campus/baseline.json` interactions[1] =
 *     「顶部：大标题 Campus + 副标题「校园广场 ▼」+ 右上消息气泡」
 *   ⇒ 所以**保留入口形态**，只**移除伪造数据**。
 *   （审核原话："FeedList 的 HIDE/DEFER 裁定**不能机械复制**成
 *     'CampusScreen 整块顶部控件消失'"。）
 *
 * ## 为什么显示"尚未接入"而不是"0 条校园圈"
 *   审核 60 的计数策略 A：**无法由权威归属计算时给 null —— 不给 0、不推断、不伪造**；
 *   并建议"计数字段干脆不渲染"。这里连权威实体都还没有，所以只给一个**明确状态**。
 *
 * ⚠️ `OUR_DESIGN_CHOICE`：**这不是原版的呈现** —— 原版此处是一个校区列表
 *    （校本部/威海校区/东校区 + 「搜索其他学校」）。
 *    我们因为**没有权威数据**而暂时显示状态说明；层 B 接入
 *    `GET /api/schools` + `GET /api/schools/:id/campuses` 后应改为真列表。
 *    ⇒ 措辞上**不得**把本状态说成"原版就是这么显示的"。
 */
/**
 * 校区选择面板（WO#16 层 B；审核 61 批准）—— 点 CampusScreen 的「校园广场 ▼」后打开。
 *
 * ## 基线依据
 * `docs/test/original-baseline/supplements/schools.json` 的 campus_picker：
 * ```
 * 标题：「北京交通大学（当前学校）」
 * 项： 校本部 ／ 威海校区 ／ 东校区 ／ **搜索其他学校**
 * ```
 * ⇒ 本组件按此渲染：**标题 = 当前学校名**、**项 = 该校校区**、**末尾 = 「搜索其他学校」入口**。
 *
 * ## ⚠️ 两处与基线不同之处（都是数据驱动，且已获批登记）
 * 1. **计数不渲染**：基线的搜索页行有「N条校园圈」，而这里（校区列表面板）基线**未记计数**；
 *    即便有，我们的 `campusCircleCount` 目前是 `null`（无权威归属）⇒ 一律不渲染。
 * 2. **规模**：我们只有 1 所学校（种子）⇒ 列表很短。
 *    审核 61 `SEARCH_CONTENT_SCALE_DIFFERENCE: ACCEPTABLE / DOCUMENTED`。
 *
 * ## 与 D-004 的关系
 * 层 A 时这个面板只是个"尚未接入"的占位（登记为 D-004 TEMPORARY）。
 * **本组件（层 B）就是 D-004 的恢复**：面板改为渲染**权威实体**。
 * ⚠️ 但 D-004 的"恢复"指的是**内容**变了；**计数**仍为 null（归属未建模），
 *    因此 `CAMPUS_CIRCLE_COUNT_NULL_NOT_ZERO` 仍成立。
 */
function CampusPickerPanel({ onClose }: { onClose: () => void }) {
  const [schools, setSchools] = useState<ApiSchool[]>([])
  const [campuses, setCampuses] = useState<ApiCampus[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  useEffect(() => {
    void (async () => {
      setState('loading')
      const sr = await listSchools()
      if (!sr.ok) {
        setErr(failText(sr))
        setState('error')
        return
      }
      setSchools(sr.value)
      const first = sr.value[0]
      if (!first) {
        setCampuses([])
        setState('ready')
        return
      }
      const cr = await listSchoolCampuses(first.id)
      if (!cr.ok) {
        setErr(failText(cr))
        setState('error')
        return
      }
      setCampuses(cr.value.items)
      setState('ready')
    })()
  }, [])

  const current = schools[0]

  return (
    <div className="switcher" data-school-picker="campuses">
      <div className="switcher__mask" onClick={onClose} />
      <div className="switcher__panel">
        {state === 'loading' && <p className="switcher__empty">加载中…</p>}
        {state === 'error' && (
          <p className="switcher__empty" data-school-picker-note>
            网络错误：{err}
          </p>
        )}
        {state === 'ready' && (
          <>
            {/* 标题逐字照基线：「<学校名>（当前学校）」 */}
            {current && (
              <p className="switcher__title" data-school-picker-title>
                {current.name}（当前学校）
              </p>
            )}
            <ul className="switcher__list no-scrollbar" data-school-picker-list>
              {campuses.map((c) => (
                <li key={c.id}>
                  <button className="switcher__item" data-campus-row onClick={onClose}>
                    <span className="switcher__name">{c.name}</span>
                    {/*
                      ⭐ 计数只在**权威可算**时渲染。
                      当前 campusCircleCount === null（无权威归属）⇒ **不渲染**，
                      而不是显示"0条校园圈"（那会把"不知道"说成"没有"）。
                    */}
                    {c.campusCircleCount !== null && (
                      <span className="switcher__meta">{c.campusCircleCount}条校园圈</span>
                    )}
                  </button>
                </li>
              ))}
              {campuses.length === 0 && (
                <li className="switcher__empty">暂无可选校区</li>
              )}
            </ul>
            {/* 基线里这是面板内的**一个入口项**，不是搜索框的 placeholder */}
            <button
              className="switcher__item switcher__item--entry"
              data-school-search-entry
              onClick={() => navigate('schools')}
            >
              搜索其他学校
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * 地标筛选面板（CAMP-003）。
 *
 * ## 需求口径（已确认项，逐字来自《详细功能设计文档》CAMP-003）
 *   · 入口在校园页**右上角**，支持**单选、多选、全部地标**，以及**地标名称搜索**
 *   · 从地点面板「查看全部」进入时**自动选中该地标**
 *   · 可以**清除筛选**恢复全部
 *   · 多选的语义（建议待评审，本实现采用）：「属于**任意一个**所选地标」，
 *     并与排序（热门/最新）**同时生效** —— 由服务端 `placeIds` + `sort` 一起做，
 *     不在客户端二次过滤（否则一旦有 limit，客户端筛会静默变成"不完整列表"）。
 *
 * ## 为什么"全部地标"是**清空选择**而不是"选中全部 10 个"
 *   两者最终结果相同，但清空选择才能让 URL 里不带 placeId、让服务端少传 10 个 UUID，
 *   更重要的是：将来新增地标时，它自动落在"全部"里，不会因为快照里漏了 id 而被过滤掉。
 */
function PlaceFilterPanel({
  places,
  selected,
  onApply,
  onClose,
}: {
  places: ApiPlaceListItem[]
  selected: string[]
  onApply: (ids: string[]) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<string[]>(selected)
  const keyword = q.trim()
  const list = keyword ? places.filter((p) => p.name.includes(keyword)) : places

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div className="switcher" data-campus-place-panel>
      <div className="switcher__mask" onClick={onClose} />
      <div className="switcher__panel">
        <p className="switcher__title">按地标筛选</p>
        <div className="switcher__search">
          <IconSearch size={17} />
          <input
            className="switcher__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索地标名称"
            data-campus-place-search
          />
        </div>
        <ul className="switcher__list no-scrollbar">
          <li>
            <button
              className={`switcher__item pf__item ${draft.length === 0 ? 'is-current' : ''}`}
              data-campus-place-all
              aria-pressed={draft.length === 0}
              onClick={() => setDraft([])}
            >
              <span className="switcher__name">全部地标</span>
              <span className="switcher__meta">不筛选地标，显示所有地点的帖子</span>
            </button>
          </li>
          {list.map((p) => {
            const on = draft.includes(p.id)
            return (
              <li key={p.id}>
                <button
                  className={`switcher__item pf__item ${on ? 'is-current' : ''}`}
                  data-campus-place-option={p.id}
                  aria-pressed={on}
                  onClick={() => toggle(p.id)}
                >
                  <span className="switcher__name">{p.name}</span>
                  <span className="switcher__meta">{p.category}</span>
                  {on && <IconCheck size={16} />}
                </button>
              </li>
            )
          })}
          {list.length === 0 && (
            <li className="switcher__empty" data-campus-place-empty>
              没有匹配「{keyword}」的地标
            </li>
          )}
        </ul>
        <div className="pf__foot">
          {draft.length > 0 && (
            <button className="pf__clear" data-campus-place-reset onClick={() => setDraft([])}>
              清除
            </button>
          )}
          <button className="pf__done" data-campus-place-done onClick={() => onApply(draft)}>
            完成{draft.length > 0 ? `（已选 ${draft.length}）` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

const CAMPUS_SUBTITLE = '校园广场'

/** URL 里的 placeId 允许逗号分隔（`#/campus?placeId=a,b`） */
function parsePlaceIds(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function CampusScreen() {
  /*
    ⭐ WO#16 层 A（审核 60）：这里原先有一个 `school` state，初值取自 **mock** 的
    `campusInfo.name`（"北京交通大学"），并把它显示为顶部副标题。
      · 按基线（trident-campus/baseline.json interactions[1]）副标题应是「**校园广场** ▼」，
        那是**固定标签**，不是学校名 —— 显示 mock 学校名本身即偏差；
      · 而 mock 学校数据按审核 60 一律**不得**再用于界面。
    ⇒ 删掉该 state；副标题改用基线逐字支持的常量（见上方 CAMPUS_SUBTITLE）。
  */
  const route = useRoute()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)

  /**
   * CAMP-002：排序切换。**首次默认「热门」**（需求原文：首次进入默认按热门排序）。
   * ⚠️ 服务端默认仍是 `latest`（其它调用方按"时间线"语义用它），
   *    所以这里必须**显式**传 `sort: 'hot'`，不能依赖默认值。
   */
  const [sort, setSort] = useState<'hot' | 'latest'>('hot')

  /**
   * CAMP-003：地标筛选（多选）。**空数组 = 全部地标**（不向服务端传过滤参数）。
   * 初值来自 URL：`#/campus?placeId=xxx`（地点面板「查看全部」会带这个参数），
   * 因此从地点面板进来时筛选是**已经生效**的，界面上也有可识别的当前地标。
   */
  const [placeIds, setPlaceIds] = useState<string[]>(() => parsePlaceIds(route.query.placeId))

  /** 筛选面板的候选地标：直接取权威地点列表（一次拉全，不在客户端猜有哪些地标） */
  const [places, setPlaces] = useState<ApiPlaceListItem[]>([])

  /**
   * 信息流状态（M3 Slice 1 收紧）：
   *   在线 → **API 是权威数据源**（不再混入 mock，避免"双真源"）
   *   离线 → 只降级到**最后一次成功的 API 快照**，并明确标注
   *   既无网络也无快照 → 显示「网络错误 + 刷新」（原版在这点上的行为就是这个）
   */
  const [feed, setFeed] = useState<FeedPost[]>(() =>
    parsePlaceIds(route.query.placeId).length === 0
      ? (readSnapshot<FeedPost[]>('feed')?.value ?? [])
      : [],
  )
  const [phase, setPhase] = useState<'loading' | 'ready' | 'offline' | 'error'>(() =>
    parsePlaceIds(route.query.placeId).length === 0 && readSnapshot<FeedPost[]>('feed')
      ? 'offline'
      : 'loading',
  )
  /** 失败原因的人类可读文案（§12：不得把 `TypeError: Failed to fetch` 这类技术串直接给用户） */
  const [errText, setErrText] = useState('')

  /**
   * 默认视图 = 热门 + 全部地标。
   *
   * 为什么只有默认视图才读写快照（localStorage）：
   *   快照的用途是"断网时还能看到上次的列表"，它是一份**没有筛选维度**的裸列表。
   *   若把筛选后的结果也写进快照，下次默认进入时就会把"某个地标的前 20 条"当成全站列表；
   *   反过来，若筛选失败时回落到全站快照，用户会看到**不符合当前筛选**的帖子 —— 那是假数据。
   *   ⇒ 非默认视图失败就如实报错，不回落快照。
   */
  const isDefaultView = sort === 'hot' && placeIds.length === 0
  const defaultViewRef = useRef(isDefaultView)
  useEffect(() => {
    defaultViewRef.current = isDefaultView
  }, [isDefaultView])

  /**
   * 拉列表。`sort` + `placeIds` 都交给服务端（不在客户端二次过滤：
   * 服务端有 limit，客户端筛会静默变成"不完整列表"）。
   */
  const loadFeed = useCallback(async () => {
    setPhase((prev) => (prev === 'ready' ? 'ready' : 'loading'))
    const result = await listPosts({ sort, placeIds })
    if (result.ok) {
      const postsFromServer = result.value.map(toFeedPost)
      setServerPosts(postsFromServer)
      // 只在**成功**时写快照 —— 快照永远是"曾经真实成功过的响应"
      if (isDefaultView) writeFeedSnapshot(postsFromServer)
      setFeed(isDefaultView ? feedAuthoritative() : postsFromServer)
      setErrText('')
      setPhase('ready')
    } else {
      // 失败时**不塞 mock**：默认视图有快照就显示快照，否则如实报错
      const snap = isDefaultView ? readSnapshot<FeedPost[]>('feed') : null
      setFeed(snap?.value ?? [])
      setErrText(failText(result))
      setPhase(snap ? 'offline' : 'error')
      console.warn('[campus] 拉取帖子失败：', result.reason)
    }
  }, [sort, placeIds, isDefaultView])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  /** 候选地标（筛选面板用）。失败不影响主列表，只在面板里显示"地标列表加载失败" */
  useEffect(() => {
    let alive = true
    void (async () => {
      const r = await listPlaces()
      if (!alive || !r.ok) return
      setPlaces(r.value)
    })()
    return () => {
      alive = false
    }
  }, [])

  /** 本地新发的帖子（store）只在默认视图下并入列表；筛选视图要按筛选条件重新拉 */
  useEffect(
    () =>
      subscribeMyPosts(() => {
        if (defaultViewRef.current) setFeed(feedAuthoritative())
      }),
    [],
  )

  /**
   * URL 里的 placeId 变化 → 同步筛选。
   * 场景：已经在校园页，又从地点面板点了「查看全部」（同一个 hash 路径、不同 query），
   * 这时组件**不会重新挂载**，只能靠这个 effect 把筛选更新上去。
   */
  const placeIdParam = route.query.placeId ?? ''
  useEffect(() => {
    const next = parsePlaceIds(placeIdParam)
    setPlaceIds((prev) => (prev.join(',') === next.join(',') ? prev : next))
  }, [placeIdParam])

  /**
   * 点赞（M3 Slice 2）：调真实接口，用**服务端返回的权威计数**覆盖本地。
   * 不本地假成功；未登录时提示并去登录页。
   */
  async function onToggleLike(post: FeedPost) {
    if (!isLoggedIn()) {
      navigate('loginselect')
      return
    }
    const r = post.liked ? await unlikePost(post.id) : await likePost(post.id)
    if (!r.ok) {
      console.warn('[campus] 点赞失败：', r.reason)
      return
    }
    setFeed((prev) =>
      prev.map((p) =>
        p.id === post.id ? { ...p, likes: r.value.likeCount, liked: r.value.likedByMe } : p,
      ),
    )
  }

  /** 当前筛选的可读标签（面板按钮与筛选条都用它，保证两处永远一致） */
  const selectedNames = placeIds
    .map((id) => places.find((p) => p.id === id)?.name)
    .filter((n): n is string => Boolean(n))
  const filterLabel =
    placeIds.length === 0
      ? '全部地标'
      : placeIds.length === 1
        ? (selectedNames[0] ?? '已选 1 个地标')
        : `已选 ${placeIds.length} 个地标`

  return (
    <Screen
      header={
        <header className="campus__head">
          {/* 副标题**逐字**用基线的「校园广场」；▼ 由 BigTitle 自己附加（它渲染一个 chevron） */}
          <BigTitle title="Campus" sub={CAMPUS_SUBTITLE} onSubClick={() => setPickerOpen(true)} />
          <button className="iconbtn campus__msg" onClick={() => navigate('message')} aria-label="消息">
            <IconChatBubble size={22} />
          </button>
        </header>
      }
      scroll
    >
      <div
        className="campus__view"
        data-campus-phase={phase}
        data-campus-sort={sort}
        data-campus-place-ids={placeIds.join(',')}
        data-campus-count={feed.length}
      >
        {/* CAMP-002 / CAMP-003 工具条：排序 + 地标筛选（需求要求筛选入口在右上角） */}
        <div className="campus__bar">
          <div className="campus__sorts" role="tablist" aria-label="排序">
            {(['hot', 'latest'] as const).map((key) => (
              <button
                key={key}
                className={`campus__sort ${sort === key ? 'is-active' : ''}`}
                role="tab"
                aria-selected={sort === key}
                data-campus-sort-option={key}
                onClick={() => setSort(key)}
              >
                {key === 'hot' ? '热门' : '最新'}
              </button>
            ))}
          </div>
          <button
            className={`campus__filterBtn ${placeIds.length > 0 ? 'is-active' : ''}`}
            data-campus-filter-open
            onClick={() => setFilterOpen(true)}
          >
            {filterLabel}
            <IconChevronDown size={14} />
          </button>
        </div>

        {placeIds.length > 0 && (
          <div className="campus__activeFilter" data-campus-filter-active>
            <span className="campus__activeFilterText">地标筛选：{filterLabel}</span>
            <button
              className="campus__filterClear"
              data-campus-filter-clear
              onClick={() => setPlaceIds([])}
            >
              清除筛选
            </button>
          </div>
        )}

        {phase === 'offline' && (
          <p className="campus__offline">
            离线：显示的是最后一次成功获取的服务器数据（非本地假数据），可能不是最新
          </p>
        )}

        {phase === 'error' && (
          <div className="campus__error">
            <p className="campus__errorText" data-campus-error>
              网络错误：{errText || '请检查网络后重试'}
            </p>
            <button
              className="campus__retry"
              onClick={() => {
                setPhase('loading')
                void loadFeed()
              }}
            >
              刷新
            </button>
          </div>
        )}

        {phase === 'loading' && feed.length === 0 && (
          <p className="campus__loading" data-campus-loading>
            加载中…
          </p>
        )}

        {phase === 'ready' && feed.length === 0 && (
          <div className="campus__empty" data-campus-empty>
            <p>
              {placeIds.length > 0
                ? `「${filterLabel}」下还没有帖子`
                : '还没有人发过帖子，来发第一条吧'}
            </p>
            {placeIds.length > 0 ? (
              <button className="campus__filterClear" onClick={() => setPlaceIds([])}>
                清除筛选
              </button>
            ) : (
              <button className="campus__retry" onClick={() => navigate('publish')}>
                去发布
              </button>
            )}
          </div>
        )}

        <div className="campus__grid">
          {feed.map((p) => (
            <PostCard key={p.id} post={p} liked={p.liked} onLike={() => void onToggleLike(p)} />
          ))}
          {phase === 'ready' && feed.length > 0 && (
            <p className="campus__end">
              已加载全部 · {feed.length} 条动态
            </p>
          )}
        </div>
      </div>

      {pickerOpen && <CampusPickerPanel onClose={() => setPickerOpen(false)} />}
      {filterOpen && (
        <PlaceFilterPanel
          places={places}
          selected={placeIds}
          onClose={() => setFilterOpen(false)}
          onApply={(ids) => {
            setPlaceIds(ids)
            setFilterOpen(false)
          }}
        />
      )}
    </Screen>
  )
}

/** 信息流快照（只在 API 成功时写；见 readSnapshot 的说明） */
function writeFeedSnapshot(list: FeedPost[]): void {
  try {
    localStorage.setItem(
      'campus.demo.snapshot.v1:feed',
      JSON.stringify({ at: Date.now(), value: list }),
    )
  } catch {
    /* 容量满/隐私模式：快照是"最好有" */
  }
}
