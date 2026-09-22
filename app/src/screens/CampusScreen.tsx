import { useEffect, useState } from 'react'
import { likePost, listPosts, readSnapshot, toFeedPost, unlikePost } from '../api/client'
import { isLoggedIn } from '../api/session'
import { BigTitle, Screen } from '../components/Shell'
import { IconChatBubble, IconComment, IconHeart } from '../components/icons'
// 注意：这里**不再** import mock 的 `posts` —— 校园页已迁移到真实 API，
// 在线时 API 是权威数据源（审核记录 07 的降级边界：已迁移页面不得混入 synthetic mock）。
import type { FeedPost } from '../data/mock'
import { feedAuthoritative, setServerPosts, subscribeMyPosts } from '../data/store'
import { navigate } from '../router'
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
function SchoolPickerUnavailable({ onClose }: { onClose: () => void }) {
  return (
    <div className="switcher" data-school-picker="unavailable">
      <div className="switcher__mask" onClick={onClose} />
      <div className="switcher__panel">
        <p className="switcher__empty" data-school-picker-note>
          学校与校区数据尚未接入
        </p>
      </div>
    </div>
  )
}

/**
 * 顶部副标题：**逐字**取自基线。
 *   `screens/trident-campus/baseline.json` interactions[1] =
 *   「顶部：大标题 Campus + **副标题「校园广场 ▼」** + 右上消息气泡」
 * ⚠️ 「▼」不是本常量的一部分 —— 它由 `BigTitle` 组件自己附加（渲染一个 chevron）。
 * ⚠️ 这里**刻意不写学校名**：按审核 60，原版该位置是固定标签而非当前学校名。
 */
const CAMPUS_SUBTITLE = '校园广场'

export function CampusScreen() {
  /*
    ⭐ WO#16 层 A（审核 60）：这里原先有一个 `school` state，初值取自 **mock** 的
    `campusInfo.name`（"北京交通大学"），并把它显示为顶部副标题。
      · 按基线（trident-campus/baseline.json interactions[1]）副标题应是「**校园广场** ▼」，
        那是**固定标签**，不是学校名 —— 显示 mock 学校名本身即偏差；
      · 而 mock 学校数据按审核 60 一律**不得**再用于界面。
    ⇒ 删掉该 state；副标题改用基线逐字支持的常量（见下方 CAMPUS_SUBTITLE）。
  */
  const [pickerOpen, setPickerOpen] = useState(false)
  /**
   * 信息流状态（M3 Slice 1 收紧）：
   *   在线 → **API 是权威数据源**（不再混入 mock，避免"双真源"）
   *   离线 → 只降级到**最后一次成功的 API 快照**，并明确标注
   *   既无网络也无快照 → 显示「网络错误 + 刷新」（原版在这点上的行为就是这个）
   */
  const [feed, setFeed] = useState<FeedPost[]>(() => readSnapshot<FeedPost[]>('feed')?.value ?? [])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'offline' | 'error'>(() =>
    readSnapshot<FeedPost[]>('feed') ? 'offline' : 'loading',
  )

  useEffect(() => subscribeMyPosts(() => setFeed(feedAuthoritative())), [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const result = await listPosts()
      if (!alive) return
      if (result.ok) {
        const postsFromServer = result.value.map(toFeedPost)
        setServerPosts(postsFromServer)
        // 只在**成功**时写快照 —— 快照永远是"曾经真实成功过的响应"
        writeFeedSnapshot(feedAuthoritative())
        setFeed(feedAuthoritative())
        setPhase('ready')
      } else {
        // 失败时**不塞 mock**：有快照就显示快照，没有就如实报错
        const snap = readSnapshot<FeedPost[]>('feed')
        setFeed(snap?.value ?? [])
        setPhase(snap ? 'offline' : 'error')
        console.warn('[campus] 拉取帖子失败：', result.reason)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

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
      {phase === 'offline' && (
        <p className="campus__offline">
          离线：显示的是最后一次成功获取的服务器数据（非本地假数据），可能不是最新
        </p>
      )}

      {phase === 'error' && (
        <div className="campus__error">
          <p>网络错误</p>
          <button
            className="campus__retry"
            onClick={() => {
              setPhase('loading')
              void (async () => {
                const r = await listPosts()
                if (r.ok) {
                  setServerPosts(r.value.map(toFeedPost))
                  writeFeedSnapshot(feedAuthoritative())
                  setFeed(feedAuthoritative())
                  setPhase('ready')
                } else {
                  setPhase('error')
                }
              })()
            }}
          >
            刷新
          </button>
        </div>
      )}

      <div className="campus__grid">
        {feed.map((p) => (
          <PostCard key={p.id} post={p} liked={p.liked} onLike={() => void onToggleLike(p)} />
        ))}
        {phase === 'ready' && (
          <p className="campus__end">
            已加载全部 · {feed.length} 条动态
          </p>
        )}
      </div>

      {pickerOpen && <SchoolPickerUnavailable onClose={() => setPickerOpen(false)} />}
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
