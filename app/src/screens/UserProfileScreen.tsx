import { useEffect, useState } from 'react'
import { getUser, listPosts, getThreads, toFeedPost, type ApiUserIdentity } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChatBubble, IconMore } from '../components/icons'
import type { FeedPost } from '../data/types'
import { goBack, navigate } from '../router'
import { PostCard } from './CampusScreen'
import './userprofile.css'

/**
 * 他人主页（原版：在校园广场点作者头像进入）。
 *
 * ## 本页此前的问题（WO#12 改前设备实测）
 * ```
 * ① **假身份**（最严重）：点真实作者「Lemy」→ 页面显示「蒸柿煮捞呆」
 *    根因：`const user = users[id] ?? users.u1` —— 传入的 id 形如 `u:<uuid>`
 *    （client.ts 的 toFeedPost 产出），与 mock 字典的 key（u1..u12）**永不可能**匹配，
 *    于是**必然回落**到 mock 的 u1。这不是"未接线"，而是**编造了一个身份**：
 *    用户点 A，看到的是 B 的名字/资料/动态。
 * ② **死路**：「私信」→ `navigate('chat', { id: 't1' })`（硬编码 mock 会话 id）
 *    → 落进 ChatScreen 的 invalid 状态（0 请求、隐藏 composer）→ 点了什么也不会发生。
 * ③ **假成功**：「关注」是纯本地 useState：点一下零网络请求，文案却变「已关注」。
 * ④ 头像用 mock 生成的 SVG；MBTI/星座/学校/学院/专业/年级全部无权威来源却照渲染。
 * ```
 *
 * ## 本次改动（审核记录 53 的裁定）
 * ```
 * identity 安全原则（**冻结，适用于以后所有 identity surface**）：
 *   unknown / malformed user id → **明确的不可用态**
 *   NEVER → 回落到另一个用户
 *
 * ① 解析路径参数：把 `u:<uuid>` 兼容解析成 **canonical UUID**，
 *    并立刻规范化（审核 53：不让 `u:` 变成另一个永久隐式协议）
 * ② 昵称走**权威来源** GET /api/users/:id（只 {id, displayName}）
 * ③ TA 的动态走 GET /api/posts?authorId= —— **服务端过滤**，不是客户端 filter
 * ④ 头像改**首字占位**（users 表没有 avatar 列）
 * ⑤ MBTI/星座/学校/学院/专业/年级 **一律不渲染**（无权威来源，不造列）
 * ⑥ 「关注」**移除**：没有 follow 模型/接口 → FOLLOW_CAPABILITY: NOT_IMPLEMENTED
 *    （审核 53：不留 inert/fake 按钮来"保留视觉结构"）
 * ⑦ 「私信」：在**已有** direct 会话中按 `peerId === 本页用户 id` 精确匹配
 *      · 恰好 1 个 → 跳 `#/chat?id=<真实 thread UUID>`
 *      · 0 个    → **不渲染该按钮**（没有可靠的"创建会话"能力，不猜、不造 t1）
 * ⑧ 三态明确：loading ／ ready ／ unavailable（含"id 非法"与"用户不存在"两种原因）
 * ```
 *
 * ## 证据边界（**不得**夸大）
 * ```
 * ORIGINAL_USER_PROFILE_BASELINE: UNAVAILABLE
 *   （docs/test/original-baseline/screens/ 下没有他人主页的基线，只有 trident-me = 「我的」tab）
 * ORIGINAL_USER_PROFILE_CONFORMANCE: NOT_EVALUATED
 *   → 本页即使全部 Gate PASS，也只能声称：
 *       authoritative identity wiring: PASS
 *       authoritative data semantics:  PASS
 *       fake interactions removed:     PASS
 *     **不能**声称"UserProfile 1:1 reproduced"。
 * ```
 */

/**
 * 把路由参数解析成 **canonical user UUID**。
 *
 * 历史形态（client.ts 的 toFeedPost 产出）：`u:<uuid>`
 * 兼容但**立刻规范化** —— 审核 53："不要让 u: 成为另一个永久隐式协议"。
 *
 * 返回 null 表示**无法解析**（调用方必须走 unavailable 态，**绝不回落**到任何用户）。
 */
export function parseUserId(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null
  const s = decodeURIComponent(raw).trim()
  if (s === '') return null
  // 兼容 `u:<uuid>` 前缀形态（历史链接），规范化成裸 uuid
  const stripped = s.startsWith('u:') ? s.slice(2) : s
  // 只接受标准 uuid 形状；其它一律视为不可解析
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stripped) ? stripped : null
}

export function UserProfileScreen({ id }: { id: string }) {
  /** 规范化后的用户 id（null = 参数不可解析） */
  const userId = parseUserId(id)

  const [identity, setIdentity] = useState<ApiUserIdentity | null>(null)
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  /**
   * 「私信」的目的地：**已有** direct 会话里 peerId == 本页用户 的那个真实 thread UUID。
   * null 表示"没有可用的真实目的地" → 不渲染该按钮（不猜、不造）。
   */
  const [dmThreadId, setDmThreadId] = useState<string | null>(null)

  useEffect(() => {
    /*
      id 不可解析 → **立刻**进入 unavailable，且**不发任何请求**。
      这既省一次无意义的往返，也把"我们不会去猜一个人"表达清楚。
    */
    if (!userId) {
      setPhase('unavailable')
      return
    }
    let alive = true
    void (async () => {
      setPhase('loading')
      // ① 权威身份
      const r = await getUser(userId)
      if (!alive) return
      if (!r.ok) {
        // 404（不存在）与"形状非法"都归为 unavailable —— 服务端刻意不区分，前端也不猜
        setIdentity(null)
        setPosts([])
        setDmThreadId(null)
        setPhase('unavailable')
        return
      }
      setIdentity(r.value)
      // ② TA 的动态（**服务端**过滤；不是客户端 filter，理由见 client.ts）
      const pr = await listPosts(userId)
      if (!alive) return
      setPosts(pr.ok ? pr.value.map(toFeedPost) : [])
      // ③ 「私信」目的地：按 peerId 精确匹配**已有** direct 会话
      //    注意 getThreads() 返回的是 { items: ApiThread[] }（不是裸数组）
      const tr = await getThreads()
      if (!alive) return
      if (tr.ok) {
        const matches = (tr.value.items ?? []).filter((t) => t.kind === 'direct' && t.peerId === userId)
        // 恰好一个才算可信；多于一个说明数据本身有歧义 → 不猜（按钮不渲染）
        setDmThreadId(matches.length === 1 ? matches[0]!.id : null)
      } else {
        setDmThreadId(null)
      }
      setPhase('ready')
    })()
    return () => {
      alive = false
    }
  }, [userId])

  const displayName = identity?.displayName ?? ''
  /** 头像首字占位：与全局其它位置（会话行/群聊头部/邀请卡）保持一致的做法 */
  const avatarInitial = displayName.trim().slice(0, 1) || '?'

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          right={
            /* 原版该页右上控件**无基线**（该屏整体无基线）→ 保持渲染但不编造行为，标 NOT_EVALUATED */
            <button className="iconbtn" aria-label="更多" data-user-right-unchanged>
              <IconMore size={20} />
            </button>
          }
        />
      }
      scroll
    >
      {phase === 'loading' && (
        <section className="up__head" data-user-state="loading">
          <p className="up__unavailable-text">加载中…</p>
        </section>
      )}

      {phase === 'unavailable' && (
        /*
          明确的不可用态。**关键**：这里**不显示任何用户**（不回落 u1、不显示任意名字），
          因为"查不到就展示另一个人"是审核 53 明确禁止的行为。
          措辞刻意中性：不区分"参数非法"与"该用户不存在"（服务端也不区分，避免把
          id 空间变成可探测的）。
        */
        <section className="up__head" data-user-state="unavailable">
          <div className="up__avatar up__avatar--ph" aria-hidden>
            ?
          </div>
          <h2 className="up__name">用户不可用</h2>
          <p className="up__unavailable-text">无法找到这个用户</p>
        </section>
      )}

      {phase === 'ready' && identity && (
        <>
          <section className="up__head" data-user-state="ready">
            <div className="up__avatar up__avatar--ph" aria-hidden data-user-avatar-placeholder>
              {avatarInitial}
            </div>
            {/* 权威昵称：来自 GET /api/users/:id（只 {id, displayName}） */}
            <h2 className="up__name" data-user-name>
              {displayName}
            </h2>

            {/*
              ⚠️ 这里**刻意不渲染**：MBTI / 星座 / 学校 / 学院 / 专业 / 年级。
              理由：users 表没有这些列；schools/campuses 两表存在但数据为空、
              用户 school_campus_id 全为 NULL（实测）→ 无权威来源。
              按 WO#10/WO#11 的同一判据：**不造数据、不显示无来源字段**。
              （原版该页是否有这些字段：**无基线，NOT_EVALUATED**。）
            */}

            <div className="up__actions">
              {/*
                「关注」**已移除**（审核 53）：
                  没有 follow 模型/接口 → FOLLOW_CAPABILITY: NOT_IMPLEMENTED。
                  原实现是纯 useState 的假成功（点一下零请求却显示"已关注"），
                  与 WO#10 修掉的"假好友申请"完全同类。
                  审核 53 明确：**不要为了保留视觉结构做一个 inert button**。
              */}

              {/*
                「私信」只在**存在真实目的地**时渲染：
                  已有 direct 会话中 peerId == 本页用户 id（恰好一个）→ 跳其真实 thread UUID。
                  零匹配 → 不渲染（没有经过验证的"创建/获取 direct 会话"能力，
                  因此不得制造 t1、不得猜一个 thread、也不得假成功 —— 审核 53）。
              */}
              {dmThreadId ? (
                <button
                  className="up__msg"
                  data-dm-real-thread={dmThreadId}
                  onClick={() => navigate('chat', { id: dmThreadId })}
                >
                  <IconChatBubble size={16} />
                  <span>私信</span>
                </button>
              ) : (
                <span className="up__noaction" data-dm-unavailable>
                  暂时无法私信
                </span>
              )}
            </div>
          </section>

          <section className="up__posts">
            <h3 className="up__section">
              TA 的动态 · {posts.length}
            </h3>
            {posts.length === 0 ? (
              <p className="up__empty">TA 还没有发布动态</p>
            ) : (
              <div className="up__grid" data-user-posts>
                {posts.map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </Screen>
  )
}
