import { getSession } from '../api/session'
import { useEffect, useState } from 'react'
import { getUser, mediaUrl, listPosts, openDirectThread, toFeedPost, type ApiUserIdentity } from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconChatBubble, IconMore } from '../components/icons'
import type { FeedPost } from '../data/types'
import { goBack, navigate } from '../router'
import { PostCard } from './CampusScreen'
import './userprofile.css'

/** Public namecard: current public identity, server-filtered posts and authenticated direct-chat creation.
 * Anonymous author surfaces never navigate here; unknown IDs remain unavailable.
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

  const [failedAvatar, setFailedAvatar] = useState<string | null>(null)
  const [identity, setIdentity] = useState<ApiUserIdentity | null>(null)
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  /**
   * 「私信」的目的地：**已有** direct 会话里 peerId == 本页用户 的那个真实 thread UUID。
   * null 表示"没有可用的真实目的地" → 不渲染该按钮（不猜、不造）。
   */
  const [dmBusy, setDmBusy] = useState(false)
  const [dmError, setDmError] = useState('')

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
        setPhase('unavailable')
        return
      }
      setFailedAvatar(null)
      setIdentity(r.value)
      // ② TA 的动态（**服务端**过滤；不是客户端 filter，理由见 client.ts）
      const pr = await listPosts(userId)
      if (!alive) return
      setPosts(pr.ok ? pr.value.map(toFeedPost) : [])
      setPhase('ready')
    })()
    return () => {
      alive = false
    }
  }, [userId])

  async function startDirect() {
    if (!userId || dmBusy) return
    if (!getSession()) {
      try { sessionStorage.setItem('timemap.login.return',JSON.stringify({path:'user',query:{id:userId}})) } catch {}
      navigate('loginselect'); return
    }
    setDmBusy(true); setDmError('')
    try {
      const result = await openDirectThread(userId)
      if (result.ok) navigate('chat',{id:result.value.id})
      else setDmError(result.status===403 ? '暂时无法向该用户发送私信' : result.status===429 ? '操作太频繁，请稍后重试' : '私信暂时无法打开，请重试')
    } finally { setDmBusy(false) }
  }
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
            {identity.avatarMediaId && failedAvatar !== identity.avatarMediaId
              ? <img className="up__avatar" data-user-avatar src={mediaUrl(identity.avatarMediaId)} alt={`${displayName}的头像`} onError={() => setFailedAvatar(identity.avatarMediaId!)} />
              : <div className="up__avatar up__avatar--ph" aria-hidden data-user-avatar-placeholder>{avatarInitial}</div>}
            {/* 权威昵称：来自 GET /api/users/:id（公开昵称和头像） */}
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

              {getSession()?.user.id !== userId && <button className="up__msg" disabled={dmBusy} onClick={() => void startDirect()}><IconChatBubble size={16}/><span>{dmBusy ? '正在打开…' : '发私信'}</span></button>}
              {dmError && <p role="alert">{dmError}</p>}
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
