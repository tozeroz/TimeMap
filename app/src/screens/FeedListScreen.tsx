import { useEffect, useState } from 'react'
import { listPosts, readSnapshot, toFeedPost } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconClose, IconPlus, IconRefresh } from '../components/icons'
import type { FeedPost } from '../data/types'
import { feedAuthoritative, setServerPosts, subscribeMyPosts } from '../data/store'
import { goBack, navigate } from '../router'
import { PostCard } from './CampusScreen'
import './feedlist.css'

/**
 * 校园圈（对应原版 campusx://feed/list）—— M5 WO#11 接线完成。
 *
 * ## 原版基线（证据级）
 * `docs/original-baseline/screens/feed-list/baseline.json`：
 *   title        = "校园圈"
 *   activity     = com.kairuotu.feed.list.FeedActivity
 *   interactions = ["顶部「校园圈」+「北京交通大学 ▼」+ 左上关闭",
 *                   "中央：网络错误图标 + 「网络不给力，点击刷新试试」+ 刷新按钮"]
 *   navigation   = ["关闭 → 返回上一页", "刷新 → 重新请求"]
 *   states       = loading/empty/**normal 全部 not_reproducible**；仅 error 是 observed
 *   known_unknowns = ["有后端且已登录时的正常列表长什么样（本机无法进入）"]
 *
 * ## 本页此前的问题（WO#11 改前实测）
 *   · 整页读 mock（`import { posts } from '../data/mock'`）
 *   · 点「刷新」**零网络请求**（fetchDelta = 0）却渲染 **12 条编造动态**
 *   · 页面上出现**编造的统计数字**：「已加载全部 · 38920 条动态 / 北京交通大学 · 12486 位同学」
 *     （真实库当时只有 users=3、posts=24 —— 差几个数量级；这是"假权威"，比未接线更危险）
 *   · 顶部缺标题「校园圈」；左上用返回箭头（原版是**关闭**）
 *
 * ## 本次改动
 *   ① 列表改接 **GET /api/posts**（经 listPosts/toFeedPost，与 CampusScreen 同一套权威数据源）
 *   ② 三态明确：loading ／ ready ／ error（**成功但为空**是"空态"，与"失败"严格区分）
 *   ③ 「刷新」**真的发请求**（原版 navigation 明确"刷新 → 重新请求"）
 *   ④ 移除编造的统计数字（假权威）
 *   ⑤ 顶部标题「校园圈」；左上改为**关闭**语义；关闭 → **返回上一页**（goBack 主行为即 history.back()）
 *   ⑥ 顶部学校名 + ▼ 下拉：**隐藏**（无权威来源 —— schools/campuses 两表存在但数据为空，
 *      三个用户 school_campus_id 全为 NULL）。按审核记录 52：authoritative data unavailable → HIDE/DEFER，
 *      **不填静态"北京交通大学"、也不临时 seed 学校数据**
 *   ⑦ 右上「发布」按钮：原版基线**未提及**右侧控件 → 按审核记录 52
 *      `ORIGINAL_RIGHT_ACTION: NOT_EVALUATED` ＋ `PRODUCT: UNCHANGED`，**保持不动**
 *
 * ## 明确**不**主张的事（范围限制）
 *   `ORIGINAL_NORMAL_LIST: NOT_EVALUATED` —— 原版正常列表从未被观察到
 *   （baseline 的 normal 是 not_reproducible）。因此本页只能声称"数据来源真实"，
 *   **不得**声称"条目形态与原版一致"。
 */

/** 信息流快照（只在 API **成功**时写；与 CampusScreen 同一约定） */
function writeFeedSnapshot(list: FeedPost[]): void {
  try {
    localStorage.setItem('campus.demo.snapshot.v1:feed', JSON.stringify({ at: Date.now(), value: list }))
  } catch {
    /* 容量满/隐私模式：快照是"最好有"，失败不影响主流程 */
  }
}

export function FeedListScreen() {
  /*
    三态 + 一个"有快照的离线态"（沿用 CampusScreen 的既有约定）：
      loading  → 还不知道
      ready    → 拿到了（feed 为空就是**真的没有动态** → 显示空态）
      offline  → 请求失败但**有历史快照**（显示快照，并明确标注这是快照）
      error    → 请求失败且**无快照**（显示错误态 + 刷新）
    ⚠️ 'error' 与"空"不得混同：把失败显示成"没有动态"等于告诉用户"这里本来就没内容"。
  */
  const [feed, setFeed] = useState<FeedPost[]>(() => readSnapshot<FeedPost[]>('feed')?.value ?? [])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'offline' | 'error'>(() =>
    readSnapshot<FeedPost[]>('feed') ? 'offline' : 'loading',
  )

  useEffect(() => subscribeMyPosts(() => setFeed(feedAuthoritative())), [])

  /** 拉取帖子（初次加载与「刷新」共用同一实现，避免两条路径行为不一致） */
  async function load(): Promise<void> {
    const r = await listPosts()
    if (r.ok) {
      setServerPosts(r.value.map(toFeedPost))
      // 只在**成功**时写快照 —— 快照永远是"曾经真实成功过的响应"
      writeFeedSnapshot(feedAuthoritative())
      setFeed(feedAuthoritative())
      setPhase('ready')
    } else {
      // 失败时**不塞 mock / 不塞旧数据冒充成功**：有快照走 offline，没有就如实报错
      const snap = readSnapshot<FeedPost[]>('feed')
      if (snap) {
        setFeed(snap.value)
        setPhase('offline')
      } else {
        setFeed([])
        setPhase('error')
      }
    }
  }

  useEffect(() => {
    /*
      只在挂载时拉一次；「刷新」由用户显式触发。
      ⚠️ 初版这里写了一个"alive 标志 + 卸载后不改状态"的骨架，但 `load()` 内部
         拿不到那个标志，于是那几行是**死代码**（`void before` 之类）。
         死代码比没有更糟：它看起来像在做卸载保护，实际什么也没做。
         如将来确实需要卸载保护，应把取消信号**传进** load()（例如 AbortController）。
    */
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 「刷新」：**真实重新请求**（原版 navigation 明确写"刷新 → 重新请求"） */
  function onRefresh(): void {
    setPhase('loading')
    void load()
  }

  return (
    <Screen
      header={
        <TopBar
          left={
            /*
              原版基线 interactions 写的是「**左上关闭**」，navigation 写「关闭 → 返回上一页」。
              → 图标用关闭（X）；语义是"关闭本页"。
              goBack() 的主行为是 history.back()（真后退），'campus' 只是**空历史时的回落**
              —— 该回落目标是我们自己的选择（基线未涉及空历史情形），标 NOT_EVALUATED。
            */
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center={
            /*
              原版此处是「校园圈」标题 **加**「北京交通大学 ▼」学校切换。
              学校名无权威来源（schools/campuses 空、用户未关联）→ 按审核 52 HIDE/DEFER：**不渲染学校切换**。
              标题「校园圈」有基线逐字支持 → 渲染。
              → 于是这里只显示标题；学校切换作为已知的"待有来源后再补"记入 KNOWN_DEVIATIONS。
            */
            <span className="fl__title" data-feed-title>
              校园圈
            </span>
          }
          right={
            /* 原版基线**未提及**右侧控件 → NOT_EVALUATED ／ PRODUCT: UNCHANGED（不删、不改） */
            <button className="iconbtn" onClick={() => navigate('publish')} aria-label="发布">
              <IconPlus size={22} />
            </button>
          }
        />
      }
      scroll
    >
      {phase === 'loading' && (
        <div className="fl__state" data-feed-state="loading">
          <p className="fl__state-text">加载中…</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="fl__error" data-feed-state="error">
          <div className="fl__barrier" aria-hidden>
            <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M4 19h16" strokeLinecap="round" />
              <path d="M6.5 19 8 7.5h8L17.5 19" strokeLinejoin="round" />
              <path d="M9.5 7.5V5h5v2.5" />
              <path d="M8.6 11h6.8M8.3 14.5h7.4" strokeLinecap="round" />
              <circle cx="6" cy="20.6" r="1" />
              <circle cx="18" cy="20.6" r="1" />
            </svg>
          </div>
          <h2 className="fl__error-title">网络错误</h2>
          {/* 原版基线逐字：「网络不给力，点击刷新试试」 */}
          <p className="fl__error-desc">网络不给力，点击刷新试试</p>
          <button className="fl__retry" data-feed-refresh onClick={onRefresh}>
            <IconRefresh size={17} />
            <span>刷新</span>
          </button>
        </div>
      )}

      {(phase === 'ready' || phase === 'offline') && (
        <>
          {phase === 'offline' && (
            /* 离线态**明确标注**：不让快照冒充"刚拉到的实时数据" */
            <p className="fl__offline" data-feed-state="offline">
              当前显示上次成功加载的内容
              <button className="fl__inline-retry" data-feed-refresh onClick={onRefresh}>
                重试
              </button>
            </p>
          )}

          <div className="campus__grid fl__grid" data-feed-list>
            {feed.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>

          {/* 成功但为空 → **明确空态**（与"失败"严格区分） */}
          {phase === 'ready' && feed.length === 0 && (
            <div className="fl__state" data-feed-state="empty">
              <p className="fl__state-text">还没有动态</p>
            </div>
          )}

          {feed.length > 0 && (
            /* ⚠️ 这里**只**用服务端返回的条数。
               原实现写的是「已加载全部 · 38920 条动态 / 北京交通大学 · 12486 位同学」——
               那两个数字是 mock 里编造的（真实库当时 users=3 / posts=24），属"假权威"，
               已按审核 50/51 的判据移除。 */
            <p className="campus__end" data-feed-end>
              已加载全部 · {feed.length} 条动态
            </p>
          )}
        </>
      )}
    </Screen>
  )
}
