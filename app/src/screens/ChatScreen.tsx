import { useEffect, useRef, useState } from 'react'
import {
  fetchMediaBlobUrl,
  getThreadMessages,
  relativeTime,
  type ApiMessage,
} from '../api/client'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconEmoji, IconMore, IconPlus } from '../components/icons'
import { goBack } from '../router'
import './chat.css'

/**
 * 私有媒体图片组件（M4 Slice A 的核心技术点）。
 *
 * **不能用 `<img src="/api/media/:id">`**：`<img>` 无法附加 `Authorization` 头，
 * 而私有媒体必须经过 session → can_read_message → can_read_media 才下发。
 * 若为了图省事把 token 塞进 URL/query，凭据就会进日志/Referer/浏览器历史 —— 不划算。
 *
 * 正确链路：authenticated fetch → blob → createObjectURL → <img src="blob:...">
 * 并在**卸载时 revokeObjectURL**，否则 blob 会一直占着内存（列表滚动会累积）。
 *
 * 加载失败（非成员 / 已撤回 / 未登录）时**不显示图片**，只留一句占位文字 ——
 * 因为服务端对这些情况一律返回 404，前端不需要（也不应该）区分原因。
 */
function MediaImage({ mediaId, alt }: { mediaId: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // 用 ref 记住已创建的 blob URL，保证卸载时一定能 revoke
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    setUrl(null)
    setFailed(false)
    void (async () => {
      const r = await fetchMediaBlobUrl(mediaId)
      if (!alive) {
        // 组件已经卸载，但 blob 已经创建 → 立刻释放，避免泄漏
        if (r.ok) URL.revokeObjectURL(r.value)
        return
      }
      if (r.ok) {
        urlRef.current = r.value
        setUrl(r.value)
      } else {
        setFailed(true)
      }
    })()
    return () => {
      alive = false
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [mediaId])

  if (failed) return <span className="bubble__mediaFail">图片不可用</span>
  if (!url) return <span className="bubble__mediaLoading">图片加载中…</span>
  return <img className="bubble__media" src={url} alt={alt} data-media-id={mediaId} />
}

/**
 * 会话页（M4 Slice A：接真实 API）。
 *
 * 此前这是**纯 mock** 页面（从 data/mock 拿 threads），所以后端做完私有媒体也没有任何消费方。
 * 现在：
 *   - 消息来自 GET /api/threads/:id/messages（非成员/未登录服务端一律 404）
 *   - 图片消息用 MediaImage（blob 方式，见上）
 *   - 撤回消息显示「消息已撤回」——**服务端已经把 media 清空**，
 *     所以这里即使想渲染也拿不到图（双重保险：界面表现 + 服务端强制）
 */
export function ChatScreen({ id }: { id: string }) {
  const [messages, setMessages] = useState<ApiMessage[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let alive = true
    setState('loading')
    void (async () => {
      const r = await getThreadMessages(id)
      if (!alive) return
      if (r.ok) {
        setMessages(r.value.items)
        setState('ready')
      } else {
        // 404 同时覆盖"不存在"、"不是成员"、"未登录"三种情况 —— 前端不区分（服务端刻意不区分）
        setErr(r.status === 404 ? '这个会话不存在，或你没有权限查看' : `加载失败：${r.reason}`)
        setState('error')
      }
    })()
    return () => {
      alive = false
    }
  }, [id])

  return (
    <Screen
      header={
        <TopBar
          left={
            <button className="iconbtn" onClick={() => goBack('message')} aria-label="返回">
              <IconBack size={22} />
            </button>
          }
          center="会话"
          right={
            <button className="iconbtn" aria-label="更多">
              <IconMore size={20} />
            </button>
          }
        />
      }
      footer={
        <div className="chatbar">
          <button className="iconbtn" aria-label="表情">
            <IconEmoji size={22} />
          </button>
          <input
            className="chatbar__input"
            placeholder="发消息..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="消息输入框"
          />
          <button className="iconbtn" aria-label="更多">
            <IconPlus size={22} />
          </button>
        </div>
      }
      scroll
    >
      {state === 'loading' && <p className="chat__state">加载中…</p>}
      {state === 'error' && (
        <div className="chat__state">
          <p>网络错误</p>
          <p className="chat__stateSub">{err}</p>
        </div>
      )}
      {state === 'ready' && messages.length === 0 && <p className="chat__state">还没有消息</p>}
      {state === 'ready' && (
        <div className="chat">
          {messages.map((m) => (
            <div key={m.id} className="chat__row chat__row--peer" data-message-id={m.id}>
              <div className="bubble bubble--peer">
                {m.revoked ? (
                  // 撤回：只显示一句说明。服务端也把 media 清空了，
                  // 所以这里不存在"界面隐藏但图还在"的可能
                  <span className="bubble__revoked">消息已撤回</span>
                ) : m.kind === 'image' && m.media.length > 0 ? (
                  m.media.map((mm) => <MediaImage key={mm.id} mediaId={mm.id} alt="图片消息" />)
                ) : (
                  <span className="bubble__text">{m.body}</span>
                )}
                <span className="bubble__time">{relativeTime(m.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Screen>
  )
}
