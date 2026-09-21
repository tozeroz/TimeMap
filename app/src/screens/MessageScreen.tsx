import { useCallback, useEffect, useRef, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconChatBubble, IconClose, IconPlus, IconSearch } from '../components/icons'
import { getThreads, relativeTime, type ApiThread } from '../api/client'
import { getSession } from '../api/session'
import { users, type User } from '../data/mock'
import { goBack, navigate } from '../router'
import './message.css'

/**
 * 聊天页（原版 MessageActivity）。
 *
 * ## 原版实测结构（M0-M2 只读观察）
 * - 顶部：左上关闭、中间「聊天」、右上加号
 * - 邀请卡：「分享我的校园卡」+「邀请同学一起加入 Campus!」+ 按钮「邀请同学」
 * - 会话列表：群聊行 + 单聊行
 * - 更多同学：每行头像 + 昵称 + 标签/学院/年级 + **添加**按钮 + **移除**按钮
 *   - 点「添加」弹出「好友申请」弹窗（输入框预填「你好我是{我的昵称}」，字数 x/30，取消/发送）
 *   - 点「移除」把该同学从推荐列表移除，列表自动补位
 *
 * ## ⚠️ M5 WO#8：数据来源的**分区标注**（很重要，请勿误读）
 *
 * 本文件此前**整页都读 mock**（`import { groups, me, threads, users } from '../data/mock'`）。
 * 实测后果：从这一页点进会话会跳到 `#/group?id=g1` / `#/chat?id=t1` —— id 全是 mock 的，
 * 而真实后端只认 UUID，于是**用户从「消息」永远到不了真实会话**（详见
 * `docs/m5/WO8-PREFIX-FAIL-EVIDENCE.md`）。
 *
 * 现在按区块区分，**每个区块只有一个明确的数据来源**：
 *
 * | 区块 | 数据来源 | 状态 |
 * |---|---|---|
 * | 会话列表（群聊 + 单聊） | `GET /api/threads` | ✅ **已接真实后端**（本单） |
 * | 邀请卡的**姓名** | `getSession().user.displayName` | ✅ 真实（本单修：此前显示 mock 的「自定义名称6」，与底部 tab 栏显示的真名自相矛盾） |
 * | 邀请卡的学校/学院/年级/头像 | mock | ⚠️ `MOCK_NOT_WIRED`（后端无对应字段，见下） |
 * | 更多同学 + 好友申请 | mock | ⚠️ `MOCK_NOT_WIRED`（后端无推荐/好友申请能力） |
 *
 * 为什么邀请卡只接了姓名、其余仍是 mock：
 *   `/api/auth/me` 目前只返回 `id / handle / displayName / phone`，**没有** school/college/grade/avatar。
 *   姓名我们有权威来源（会话），而那几个字段没有 —— 留着 mock 值是"未接线"，
 *   但留着一个**与登录身份不符的姓名**是"主动矛盾"，两者性质不同，所以只修前者。
 *   不把整张卡"半接线成看起来全真"是刻意的：**半真半假比明确未接线更危险**。
 *   → 已登记接线单（NEXT-ACTIONS J 区 WO#10），届时 profile 字段补齐后一并接。
 */

/** 会话行要显示的名字：群聊用 title；单聊用对方昵称（后端新给的 peerName） */
function threadTitle(t: ApiThread): string {
  if (t.kind === 'group') return t.title?.trim() || '未命名群聊'
  return t.peerName?.trim() || t.title?.trim() || '未命名会话'
}

/** 最后一条消息的摘要（与 WO#5 的语音/图片摘要规则保持一致） */
function lastSummary(t: ApiThread): string {
  const lm = t.lastMessage
  if (!lm) return '暂无消息'
  if (lm.kind === 'image') return '[图片]'
  if (lm.kind === 'voice') return '[语音]'
  return lm.body
}

export function MessageScreen() {
  /*
    更多同学 / 好友申请：**仍然是 mock**（后端没有推荐与好友申请能力）。
    保留渲染是为了不制造新的 1:1 偏差（原版有这个区块），但已在文件头与
    docs 里明确登记为 MOCK_NOT_WIRED，并开了接线单 —— 不是"假装它是真的"。
  */
  const [suggestions, setSuggestions] = useState<User[]>([
    users.u5,
    users.u6,
    users.u7,
    users.u8,
    users.u9,
    users.u10,
    users.u11,
    users.u1,
    users.u2,
  ])
  const [applied, setApplied] = useState<Record<string, boolean>>({})
  const [target, setTarget] = useState<User | null>(null)
  const [request, setRequest] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)

  /** 邀请卡的显示名：来自**真实会话**（此前是 mock，与底部 tab 栏不一致） */
  const [meName] = useState<string>(() => getSession()?.user?.displayName?.trim() || '我')

  /** 会话列表状态机（与 ChatScreen 同风格：加载 / 就绪 / 失败 三态都必须明确可见） */
  const [threads, setThreads] = useState<ApiThread[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listErr, setListErr] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadThreads = useCallback(async () => {
    setListState('loading')
    const r = await getThreads()
    if (!mounted.current) return
    if (r.ok) {
      setThreads(r.value.items)
      setListErr('')
      setListState('ready')
    } else {
      // 失败时必须说出来：静默保留旧内容会让用户以为列表是最新的
      setThreads([])
      setListErr(`加载失败：${r.reason}`)
      setListState('error')
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  function openThread(t: ApiThread) {
    /*
      路由 id 一律用**后端给的 UUID**，并按审核记录 44 冻结的形式传：
        CANONICAL: `#/chat?id=<uuid>`（`navigate(path, query)` 产生的就是这个）
      ⚠️ 这里**绝不能**再传 mock id —— 那正是本单修掉的缺陷。
    */
    if (t.kind === 'group') navigate('group', { id: t.id })
    else navigate('chat', { id: t.id })
  }

  function openRequest(user: User) {
    setTarget(user)
    setRequest(`你好我是${meName}`)
  }

  function sendRequest() {
    if (!target) return
    setApplied((prev) => ({ ...prev, [target.id]: true }))
    setTarget(null)
    setRequest('')
  }

  const groupThreads = threads.filter((t) => t.kind === 'group')
  const directThreads = threads.filter((t) => t.kind !== 'group')

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('campus')} aria-label="关闭">
              <IconClose size={22} />
            </button>
          }
          center="聊天"
          right={
            <button className="iconbtn" aria-label="新建">
              <IconPlus size={22} />
            </button>
          }
        />
      }
      scroll
    >
      {/* 校园卡邀请卡（姓名已接真实会话；学校/学院/年级/头像见文件头 MOCK_NOT_WIRED） */}
      <section className="invite">
        <div className="invite__head">
          <div className="invite__avatar invite__avatar--ph" aria-hidden>
            {meName.slice(0, 1)}
          </div>
          <div>
            <div className="invite__title">分享我的校园卡</div>
            <div className="invite__sub">邀请同学一起加入 Campus!</div>
          </div>
        </div>
        <div className="invite__card">
          <div className="invite__brand">Campus</div>
          <div className="invite__info">
            <div className="invite__name" data-me-name>
              {meName}
            </div>
            {/*
              ⚠️ MOCK_NOT_WIRED：学校/学院/年级后端暂无来源（/api/auth/me 未返回这些字段）。
              刻意**不**用 mock 值填充 —— 空着比填一个假学院诚实；接线单见 NEXT-ACTIONS WO#10。
            */}
          </div>
        </div>
        <button className="invite__btn" onClick={() => setInviteOpen(true)}>
          邀请同学
        </button>
      </section>

      {/* ---------------------------------------------------------------
          会话列表：**真实数据**（GET /api/threads）
          三态都必须明确可见：加载中 / 失败 / 空
          ⚠️ 这里**不允许出现任何 mock 行**（审核记录 44 对"权威会话列表"的要求）
      --------------------------------------------------------------- */}
      <section className="list" data-list="threads">
        {listState === 'loading' && <p className="list__state">加载中…</p>}
        {listState === 'error' && (
          <div className="list__state" data-state="error">
            <p>会话列表加载失败</p>
            <p className="list__stateSub">{listErr}</p>
            <button className="list__retry" onClick={() => void loadThreads()}>
              重试
            </button>
          </div>
        )}
        {listState === 'ready' && threads.length === 0 && (
          <div className="list__state" data-state="empty">
            <p>还没有会话</p>
            <p className="list__stateSub">去「校园广场」找人聊两句吧</p>
          </div>
        )}

        {listState === 'ready' &&
          groupThreads.map((t) => (
            <button
              key={t.id}
              className="row"
              data-thread-id={t.id}
              data-thread-kind={t.kind}
              onClick={() => openThread(t)}
            >
              <span className="row__groupIcon" aria-hidden>
                <IconChatBubble size={20} />
              </span>
              <div className="row__main">
                <div className="row__title">{threadTitle(t)}</div>
                <div className="row__sub">{lastSummary(t)}</div>
              </div>
              <div className="row__time">{t.memberCount} 人</div>
            </button>
          ))}

        {listState === 'ready' &&
          directThreads.map((t) => (
            <button
              key={t.id}
              className="row"
              data-thread-id={t.id}
              data-thread-kind={t.kind}
              onClick={() => openThread(t)}
            >
              <span className="row__avatar row__avatar--ph" aria-hidden>
                {threadTitle(t).slice(0, 1)}
              </span>
              <div className="row__main">
                <div className="row__title">{threadTitle(t)}</div>
                <div className="row__sub">{lastSummary(t)}</div>
              </div>
              <div className="row__time">
                {t.lastMessage?.createdAt ? relativeTime(t.lastMessage.createdAt) : ''}
              </div>
            </button>
          ))}
      </section>

      {/* 可能认识的同学（⚠️ MOCK_NOT_WIRED：后端无推荐/好友申请能力，接线单见 NEXT-ACTIONS WO#10） */}
      <section className="suggest" data-mock-region="suggestions">
        <header className="suggest__head">
          <h3 className="suggest__title">更多同学</h3>
          <button className="iconbtn" aria-label="搜索">
            <IconSearch size={18} />
          </button>
        </header>
        {suggestions.map((u) => (
          <div key={u.id} className="srow">
            <img className="srow__avatar" src={u.avatar} alt="" />
            <div className="srow__main">
              <div className="srow__name">
                {u.name}
                <span className="tag tag--grey">相同学校</span>
              </div>
              {u.mbti && (
                <div className="srow__meta">
                  {u.mbti} {u.zodiac}
                </div>
              )}
              <div className="srow__meta">
                {u.college}
                {u.major ? `-${u.major}` : ''}
              </div>
              <div className="srow__meta">{u.grade}</div>
            </div>
            <button
              className={`srow__btn ${applied[u.id] ? 'is-done' : ''}`}
              onClick={() => !applied[u.id] && openRequest(u)}
            >
              {applied[u.id] ? '已申请' : '添加'}
            </button>
            <button
              className="srow__remove"
              onClick={() => setSuggestions((prev) => prev.filter((x) => x.id !== u.id))}
              aria-label="移除"
            >
              <IconClose size={16} />
            </button>
          </div>
        ))}
        {suggestions.length === 0 && <p className="suggest__empty">暂时没有更多推荐了</p>}
      </section>

      {/* 好友申请弹窗（原版实测：点「添加」后弹出） */}
      {target && (
        <div className="dialog">
          <div className="dialog__mask" onClick={() => setTarget(null)} />
          <div className="dialog__panel">
            <h3 className="dialog__title">好友申请</h3>
            <textarea
              className="dialog__input"
              value={request}
              maxLength={30}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="说一句话介绍自己"
            />
            <div className="dialog__count">
              {request.length}/30
            </div>
            <div className="dialog__actions">
              <button className="dialog__btn" onClick={() => setTarget(null)}>
                取消
              </button>
              <button className="dialog__btn dialog__btn--primary" onClick={sendRequest}>
                发送
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 邀请分享面板 */}
      {inviteOpen && (
        <div className="dialog">
          <div className="dialog__mask" onClick={() => setInviteOpen(false)} />
          <div className="dialog__sheet">
            <div className="dialog__sheetTitle">分享我的校园卡</div>
            <div className="dialog__targets">
              {['微信好友', '朋友圈', 'QQ', '复制链接', '二维码'].map((t) => (
                <button
                  key={t}
                  className="dialog__target"
                  onClick={() => setInviteOpen(false)}
                >
                  {t}
                </button>
              ))}
            </div>
            <button className="dialog__btn dialog__btn--block" onClick={() => setInviteOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}
    </Screen>
  )
}
