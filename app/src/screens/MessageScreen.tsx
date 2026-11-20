import { useCallback, useEffect, useRef, useState } from 'react'
import { Screen, TopBar } from '../components/Shell'
import { IconClose } from '../components/icons'
import { getThreads, relativeTime, type ApiThread } from '../api/client'
import { goBack, navigate } from '../router'
import './message.css'

function threadTitle(t: ApiThread): string {
  return t.peerName?.trim() || t.title?.trim() || '未命名会话'
}

function lastSummary(t: ApiThread): string {
  const lm = t.lastMessage
  if (!lm) return '暂无消息'
  if (lm.kind === 'image') return '[图片]'
  if (lm.kind === 'voice') return '[语音]'
  return lm.body
}

export function MessageScreen() {
  const [threads, setThreads] = useState<ApiThread[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error' | 'unauth'>('loading')
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
      setThreads(r.value.items.filter(t => t.kind === 'direct'))
      setListErr('')
      setListState('ready')
    } else {
      // 失败时必须说出来：静默保留旧内容会让用户以为列表是最新的
      setThreads([])
      setListErr('暂时无法加载私聊，请稍后重试。')
      setListState(r.status === 401 ? 'unauth' : 'error')
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  function openThread(t: ApiThread) {
    navigate('chat', { id: t.id })
  }

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
        />
      }
      scroll
    >
      <section className="list" data-list="threads">
        {listState === 'loading' && <p className="list__state">加载中…</p>}
        {listState === 'unauth' && (
          <div className="list__state" data-state="unauth">
            <p>登录后查看私聊</p>
            <p className="list__stateSub">登录已过期或尚未登录，请登录后继续。</p>
            <button className="list__retry" onClick={() => navigate('loginselect')}>去登录</button>
          </div>
        )}
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
            <p>还没有私聊会话</p>
            <p className="list__stateSub">你的私聊会话会显示在这里</p>
          </div>
        )}

        {listState === 'ready' &&
          threads.map((t) => (
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

    </Screen>
  )
}
