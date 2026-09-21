import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchMediaBlobUrl,
  getThreadMessages,
  postThreadImageMessage,
  postThreadTextMessage,
  postThreadVoiceMessage,
  relativeTime,
  uploadMedia,
  type ApiMessage,
} from '../api/client'
import { getSession } from '../api/session'
import { Screen, TopBar } from '../components/Shell'
import { IconBack, IconEmoji, IconImage, IconMic, IconMore, IconPlus } from '../components/icons'
import { IconSend } from '../components/icons-send'
import { RecorderError, formatDuration, startRecording, type RecorderSession } from '../native/recorder'
import { goBack } from '../router'
import './chat.css'

/** 会话 id 的合法形状：UUID（服务端的 `id` 参数也按同一形状校验） */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 判定一个路由传来的会话 id 属于哪一类（M5 WO#8）。
 *
 * 导出是为了**可以被单独测**：它决定"要不要发网络请求"，是这条路径上的关键分支。
 *
 * 三态（与 ChatScreen 的 state 一一对应）：
 *   'missing' —— 空串/未提供 → 显示「未指定会话」，**不发请求**
 *   'invalid' —— 非空但不是 UUID（例如 mock id 't1'）→ 显示「无效会话」，**不发请求**
 *   'uuid'    —— 形状合法 → 正常加载（存在性/成员资格由服务端判定）
 *
 * 为什么把 'invalid' 单独拎出来：mock id 曾经从这里漏进真实 API。
 * 只删掉那一个 't1' 是不够的（下一个 mock id 还会漏），要按**形状**拦住整类。
 */
export function classifyThreadId(id: string | null | undefined): 'missing' | 'invalid' | 'uuid' {
  const v = (id ?? '').trim()
  if (v === '') return 'missing'
  return UUID_RE.test(v) ? 'uuid' : 'invalid'
}

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
 * 语音消息气泡（M5 WO#5）。
 *
 * 三点刻意的设计：
 *
 * ① **时长来自 prop（服务端持久化的 media.duration_ms），不来自音频本身**。
 *    MediaRecorder 产出的是 live/流式 WebM，文件头不含 duration，
 *    `<audio>.duration` 读到 null（探针 P10 实测）——
 *    所以"刷新后仍显示时长"只能靠服务端那个字段，**不能**等音频下载完再解码。
 *    这也是为什么气泡在音频还没加载时就能显示时长。
 *
 * ② **音频字节用与图片同一条鉴权链路取**（authenticated fetch → blob URL）。
 *    语音是 private 媒体，服务端要做会话 + 可见性判定；
 *    直接把 URL 给 `<audio src>` 无法附加 Authorization 头 —— 与 MediaImage 同理。
 *
 * ③ **点击播放/暂停**，播放中显示不同图标；卸载时 revoke blob URL。
 */
function VoiceMessage({
  mediaId,
  durationMs,
  mine,
}: {
  mediaId: string
  durationMs: number | null
  mine: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const urlRef = useRef<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let alive = true
    setUrl(null)
    setFailed(false)
    setPlaying(false)
    void (async () => {
      const r = await fetchMediaBlobUrl(mediaId)
      if (!alive) {
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

  function toggle() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }

  if (failed) return <span className="bubble__mediaFail">语音不可用</span>

  return (
    <button
      type="button"
      className={`voice ${mine ? 'voice--me' : 'voice--peer'}`}
      onClick={toggle}
      aria-label={playing ? '暂停语音' : '播放语音'}
      data-media-id={mediaId}
      // data-duration-ms 是给真机断言用的锚点：让"界面显示的时长 == 服务端存的值"可机读校验
      data-duration-ms={durationMs ?? ''}
    >
      <span className={`voice__icon ${playing ? 'voice__icon--playing' : ''}`} aria-hidden>
        {playing ? '❚❚' : '▶'}
      </span>
      <span className="voice__dur">{formatDuration(durationMs)}</span>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
    </button>
  )
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
 *
 * M5 WO#2 追加：**发图**。发图是两步（上传 → 发消息），两条链路都可能独立失败，
 * 所以这里的状态机按"哪一步"分开报错，不合并成一句模糊的「网络错误」。
 */
export function ChatScreen({ id }: { id: string }) {
  const [messages, setMessages] = useState<ApiMessage[]>([])
  /**
   * 状态机（M5 WO#8 扩展了两个**不触网**的状态）。
   *
   * 为什么要单独区分 'missing' 与 'invalid'，而不是都走 'error'：
   *   之前 `App.tsx` 的 chat 路由用 `param ?? 't1'` 兜底 —— 那个 't1' 是 **mock 数据里的会话 id**，
   *   会被当成真实参数直接打到 `GET /api/threads/t1/messages` 上，服务端只能回 404，
   *   用户看到的是"网络错误 / 这个会话不存在"，**看不出真正原因是路由给了个假 id**。
   *   现在：id 形状不合法时**一次请求都不发**（Gate 断言：messagesRequestCount 必须为 0），
   *   并明确告诉用户是哪一类问题。
   */
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'missing' | 'invalid'>('loading')
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState('')

  /**
   * 当前用户 id —— 判断「这条消息是不是我发的」（M5：自己发的消息必须靠右）。
   *
   * 为什么用 getSession() 而不是新造一套：会话本来就有现成存放处（api/session.ts），
   * MeScreen / TabBar 也都是这么读的。这里沿用**同一模式**（挂载时读一次），
   * 不引入新的订阅机制 —— 会话变化时这些屏幕本来就都会重新挂载。
   *
   * 字段名以 `SessionUser` 为准：`getSession()?.user?.id`。
   */
  const [meId] = useState<string | null>(() => getSession()?.user?.id ?? null)

  /**
   * 发图状态。
   * 为什么一定要有它：真机上"点了选图之后什么都不会发生"和"App 卡住了"是同一个观感，
   * 所以上传/发送期间必须**可见**（chatbar 上方的状态行 + 选图按钮禁用）。
   */
  const [busy, setBusy] = useState<'' | 'uploading' | 'posting'>('')
  /** 发送失败的原因（**必须显示出来**：图没发出去却看起来正常，比报错糟得多） */
  const [sendErr, setSendErr] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  // 组件是否还挂着：异步回来时不要往已卸载的组件里写 state
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /**
   * 拉一次消息。抽成函数是因为**发完图要重拉**（否则新消息只在服务端，界面上看不见），
   * 而重拉必须和首次加载走完全同一条路径 —— 不能另写一份"发完图之后的我以为"。
   *
   * ⚠️ M5 WO#8：**先校验 id 形状，再决定要不要发请求**。
   *   这不是"多余的前端校验"，而是这条路径上真实发生过的缺陷：
   *   mock id `'t1'` 曾从这个入口漏进真实 API（服务端 404）。
   *   服务端那边对非法 UUID 也会拒（`invalid` → 400），两边各拦一次不是重复：
   *   前端拦的是"**根本不该发出去的请求**"，服务端拦的是"**任何来源的非法输入**"。
   */
  const loadMessages = useCallback(async () => {
    const shape = classifyThreadId(id)
    if (shape !== 'uuid') {
      // 不触网：明确区分"没给 id"与"给了非法 id"
      if (!mounted.current) return
      setMessages([])
      setErr(shape === 'missing' ? '未指定会话' : '无效会话')
      setState(shape === 'missing' ? 'missing' : 'invalid')
      return
    }
    const r = await getThreadMessages(id)
    if (!mounted.current) return
    if (r.ok) {
      setMessages(r.value.items)
      setErr('')
      setState('ready')
    } else {
      // 404 同时覆盖"不存在"、"不是成员"、"未登录"三种情况 —— 前端不区分（服务端刻意不区分）
      setErr(r.status === 404 ? '这个会话不存在，或你没有权限查看' : `加载失败：${r.reason}`)
      setState('error')
    }
  }, [id])

  useEffect(() => {
    setState('loading')
    void loadMessages()
  }, [loadMessages])

  /**
   * 选图 → 上传 → 发消息 → 重拉。
   *
   * 每个刻意的细节：
   *   - `purpose: 'chat'` → 服务端映射 scope=private。会话图**必须**私有，
   *     用 'post' 会把私聊图挂成公图（任何登录用户可按 id 读到）。
   *   - 先取 file 再**立刻清空 input**：不清空的话，同一张图选第二次不会触发 change
   *     （value 没变），用户会以为"选图按钮坏了"。
   *   - 上传成功但发消息失败 → 只报错，**不重试也不吞掉**：
   *     服务端可能已经建了这个 media（未被引用的资源由 cleanup 回收），
   *     前端没有"删媒体"的接口，假装成功才是真正的错。
   */
  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    // 立刻清空 input（上面那条"选第二次没反应"的坑）—— 必须在任何 await 之前
    e.target.value = ''
    if (!file) return

    setSendErr('')
    setBusy('uploading')
    try {
      const up = await uploadMedia(file, 'chat')
      if (!up.ok) {
        setSendErr(`发送失败：图片上传未成功（${up.reason}）`)
        return
      }
      setBusy('posting')
      const sent = await postThreadImageMessage(id, up.value.id)
      if (!sent.ok) {
        setSendErr(`发送失败：消息未发出（${sent.reason}）`)
        return
      }
      await loadMessages()
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  // -------------------------------------------------------------------------
  // M5 WO#7：**文字消息发送路径**
  //
  // 此前这里没有它：draft 只绑定到 input 的 value/onChange，**从未被发送** ——
  // 会话页能打字却发不出去。服务端 /api/threads/:id/messages 一直支持纯文本
  // （gate 长期有「T1 纯文本 → 201」断言），缺的只是客户端入口。
  //
  // ## 关于"发送按钮什么时候出现"——**诚实的边界**
  //
  // 原版证据（静态 APK，可采信）：composer 布局声明了 sendBtn（56dp×36dp，ic_send_msg_btn），
  // **默认 visibility=GONE**；ImInputBoxBinding 类与 sendBtn 字段名都在 dex 里
  // （→ SEND_BTN_BINDING_EXISTS: STRONGLY_SUPPORTED），
  // 但**读不到方法体**，所以"什么条件切换 VISIBLE/GONE"**未取证**：
  //     COMPOSER_EXACT_VISIBILITY_STATE: NOT_EVALUATED
  //
  // 因此下面这条规则是**我方设计选择**，不是"与原版一致"的结论：
  //     非空 draft → 显示发送按钮；空 draft → 不显示
  // 它只是"从 layout 默认 GONE + 功能需要"推出的**最保守**做法。
  // ⚠️ 尤其**没有**实现"有文字就隐藏 表情/加号"—— 那部分更没有证据（审核记录 42 明确不猜）。
  // ⚠️ 也**没有**实现回车发送（ENTER_TO_SEND: DO NOT IMPLEMENT）。
  // -------------------------------------------------------------------------
  async function onSendText() {
    const text = draft.trim()
    // 空输入不发：与"空输入时不显示发送按钮"是同一条规则的两道保险
    if (text === '' || busy !== '') return

    setSendErr('')
    setBusy('posting')
    try {
      const sent = await postThreadTextMessage(id, text)
      if (!sent.ok) {
        // ⚠️ 失败时**不清空 draft**：让用户能直接重试，不静默丢内容
        setSendErr(`发送失败：消息未发出（${sent.reason}）`)
        return
      }
      // 只有成功才清空输入框
      if (mounted.current) setDraft('')
      await loadMessages()
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  // -------------------------------------------------------------------------
  // M5 WO#5：语音消息（按下录音 → 松手发送）
  //
  // 几条刻意的边界：
  //   · **时长用单调时钟**（recorder.ts 里 performance.now()）——见 recorder.ts 文件头
  //   · **拒绝权限时只提示，不走上传也不发消息**（验收 ⑦a）：
  //     这里 `startRecording()` 抛错就 return，绝不会产生任何 /api/media 或 /messages 请求
  //   · 松手太快导致 blob 为空 → recorder 会抛错，同样不发（不产生"空语音"）
  //   · 本设备（MuMu）录制时**不弹系统授权框**（实测），因此代码不依赖弹框，
  //     只处理"成功 / 失败"两条路 —— 真机弹框时这条路径同样成立
  // -------------------------------------------------------------------------
  const [recording, setRecording] = useState(false)
  /** 录制中已过秒数（用于按钮上的计时显示） */
  const [recordSec, setRecordSec] = useState(0)
  const sessionRef = useRef<RecorderSession | null>(null)
  const tickRef = useRef<number | null>(null)

  const stopTick = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  // 卸载时务必中止录音，否则麦克风会被一直占用
  useEffect(
    () => () => {
      stopTick()
      sessionRef.current?.abort()
      sessionRef.current = null
    },
    [stopTick],
  )

  async function onRecordStart() {
    if (recording || busy !== '') return
    setSendErr('')
    try {
      const s = await startRecording()
      sessionRef.current = s
      setRecording(true)
      setRecordSec(0)
      stopTick()
      tickRef.current = window.setInterval(() => {
        const ms = sessionRef.current?.elapsedMs() ?? 0
        setRecordSec(Math.floor(ms / 1000))
      }, 200)
    } catch (e) {
      sessionRef.current = null
      setRecording(false)
      stopTick()
      const kind = e instanceof RecorderError ? e.kind : 'failed'
      // 权限被拒 / 无设备 / 不支持 / 其它 —— 给出**明确**原因，不用一句"出错了"糊过去
      const msg =
        kind === 'permission_denied'
          ? '没有麦克风权限，无法录音（请在系统设置里允许本应用使用麦克风）'
          : kind === 'no_device'
            ? '找不到可用的麦克风'
            : kind === 'unsupported'
              ? '当前环境不支持录音'
              : `录音启动失败：${(e as Error).message}`
      setSendErr(msg)
      // ⚠ 到这里为止没有发起任何网络请求 —— 这正是验收 ⑦a 要断言的行为
    }
  }

  /** 松手：停止并发送 */
  async function onRecordEnd() {
    const s = sessionRef.current
    if (!s) return
    sessionRef.current = null
    stopTick()
    setRecording(false)

    let rec
    try {
      rec = await s.finish()
    } catch (e) {
      setSendErr(`录音失败：${(e as Error).message}`)
      return
    }

    setBusy('uploading')
    try {
      // ★ 时长随上传一起持久化（服务端对 audio 强制要求它，缺了就 400）
      const up = await uploadMedia(rec.blob, 'chat', rec.durationMs)
      if (!up.ok) {
        setSendErr(`发送失败：语音上传未成功（${up.reason}）`)
        return
      }
      setBusy('posting')
      const sent = await postThreadVoiceMessage(id, up.value.id)
      if (!sent.ok) {
        setSendErr(`发送失败：消息未发出（${sent.reason}）`)
        return
      }
      await loadMessages()
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  /** 取消（例如指针移出按钮）：丢弃这段录音，不发 */
  function onRecordCancel() {
    const s = sessionRef.current
    if (!s) return
    sessionRef.current = null
    stopTick()
    setRecording(false)
    s.abort()
  }

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
        // M5 WO#8：会话 id 不可用时**整条 composer 都不显示** ——
        // 往一个"未指定/无效"的会话里打字发送没有任何意义，留着只会让用户白打一段字再失败。
        (state === 'missing' || state === 'invalid') ? null : (
        <div className="chatbar__footer">
          {/* 发送中：状态行是**用户唯一能看出"点了有反应"**的地方 */}
          {busy !== '' && (
            <div className="chatbar__status" role="status">
              {busy === 'uploading' ? '图片上传中…' : '发送中…'}
            </div>
          )}
          {/* 录音中：显示已录秒数（让"按住"这件事有可见反馈） */}
          {recording && (
            <div className="chatbar__status" role="status">
              {`录音中 ${recordSec}s · 松手发送`}
            </div>
          )}
          {/* 失败：显式红色文案，不静默 */}
          {sendErr !== '' && (
            <div className="chatbar__error" role="alert">
              {sendErr}
            </div>
          )}
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
            {/*
              选图入口。用原生 `<input type="file">`（不引 Capacitor 插件、不动原生工程）：
              - `<label>` 包住 input，input 用 CSS 铺满并透明 → 用户点图标时点到的是 input 本体，
                不依赖"label 转发点击"的各种浏览器差异；
              - accept="image/*" 只做**挑文件的过滤**，真正判类型的是服务端（按内容 probe，
                不信 Content-Type 与扩展名），所以这里不是安全边界，只是省得用户选错。
            */}
            <label className="chatbar__pick" aria-label="选图">
              <input
                ref={fileRef}
                className="chatbar__file"
                type="file"
                accept="image/*"
                onChange={onPickImage}
                disabled={busy !== ''}
                aria-label="选择图片"
              />
              <IconImage size={22} />
            </label>
            {/*
              语音入口：**按住说话**（pointerdown 开始录音 / pointerup 松手发送）。

              为什么用 pointer 事件而不是 mousedown/touchstart 二选一：
              pointer 事件在触摸与鼠标下统一触发，且 `pointercancel` 覆盖"手指滑出/被系统打断"
              这类必须中止录音的情形（否则麦克风会一直占着）。
              注册 pointercancel/pointerleave 都调用 onRecordCancel，宁可丢弃也不发出半段音频。
            */}
            <button
              className={`iconbtn chatbar__mic ${recording ? 'chatbar__mic--rec' : ''}`}
              aria-label="按住说话"
              data-recording={recording ? 'true' : 'false'}
              disabled={busy !== ''}
              onPointerDown={(e) => {
                e.preventDefault()
                void onRecordStart()
              }}
              onPointerUp={(e) => {
                e.preventDefault()
                void onRecordEnd()
              }}
              onPointerCancel={onRecordCancel}
              onPointerLeave={() => {
                if (recording) onRecordCancel()
              }}
            >
              <IconMic size={22} />
            </button>
            <button className="iconbtn" aria-label="更多">
              <IconPlus size={22} />
            </button>
            {/*
              M5 WO#7：**发送按钮**（文字消息的唯一可达入口）

              原版证据（静态、可采信）：composer 布局声明了 sendBtn，
              尺寸 56dp×36dp，图标为**黑色胶囊 + 白色纸飞机**
              （矢量资源 res/JA.xml 的 pathData 已逐字抄进 IconSend 的注释里）。
              这里按 56×36 **CSS px** 复刻（本设备 dp→CSS px 系数实测为 1：dump 里 plusBtn 声明
              32dp、实测 56 设备 px、dpr 1.75 → 32dp = 32 CSS px，故 dp 与 CSS px 同值）。

              ⚠️ **显示时机是我方设计选择**（`COMPOSER_EXACT_VISIBILITY_STATE: NOT_EVALUATED`）：
                 原版 sendBtn 默认 GONE 是**布局默认值**，不等于"由 draft 是否为空驱动"。
                 这里选"非空 draft 才显示"作为最保守做法，**不声称**与原版一致。
              ⚠️ 也**不**实现"有文字时隐藏表情/加号"（无证据，审核记录 42 明确不猜）。
            */}
            {draft.trim() !== '' && (
              <button
                className="chatbar__send"
                aria-label="发送"
                data-testid="chatbar-send"
                disabled={busy !== ''}
                onClick={() => void onSendText()}
              >
                <IconSend size={20} />
              </button>
            )}
          </div>
        </div>
        )
      }
      scroll
    >
      {state === 'loading' && <p className="chat__state">加载中…</p>}
      {/*
        M5 WO#8：id 不可用时不显示「网络错误」—— 那不是网络问题，**一个请求都没发**。
        必须让用户看到真实原因，否则"路由给了假 id"会被误读成"后端坏了"。
      */}
      {state === 'missing' && (
        <div className="chat__state" data-state="missing">
          <p>未指定会话</p>
          <p className="chat__stateSub">请从「消息」列表里选择一个会话</p>
        </div>
      )}
      {state === 'invalid' && (
        <div className="chat__state" data-state="invalid">
          <p>无效会话</p>
          <p className="chat__stateSub">这个会话链接不正确</p>
        </div>
      )}
      {state === 'error' && (
        <div className="chat__state" data-state="error">
          <p>网络错误</p>
          <p className="chat__stateSub">{err}</p>
        </div>
      )}
      {state === 'ready' && messages.length === 0 && <p className="chat__state">还没有消息</p>}
      {state === 'ready' && (
        <div className="chat">
          {messages.map((m) => {
            /*
              自己发的消息靠右、对方的靠左。
              依据：原版会话页里**自己发的那条**气泡落在右半（x=[625,975]，屏宽 1080）、
              头像贴最右（x=[989,1052]）—— 见 docs/m5/CHAT-SENDER-PRESENTATION-CONFIRMED.md。
              此前这里硬编码 `--peer`，把「我发的」也画在左边，是真实偏差。

              ⚠ `meId` 为 null（未登录 / 读不到会话）时 `mine` 恒为 false → 降级成 `--peer`（原行为）。
              绝不能写成 `meId === null || ...` 之类把所有人都当成「我」。
            */
            const mine = meId !== null && m.senderId === meId
            return (
              <div
                key={m.id}
                className={`chat__row ${mine ? 'chat__row--me' : 'chat__row--peer'}`}
                data-message-id={m.id}
              >
                <div className={`bubble ${mine ? 'bubble--me' : 'bubble--peer'}`}>
                  {m.revoked ? (
                    // 撤回：只显示一句说明。服务端也把 media 清空了，
                    // 所以这里不存在"界面隐藏但图还在"的可能
                    <span className="bubble__revoked">消息已撤回</span>
                  ) : m.kind === 'voice' && m.media.length > 0 ? (
                    /*
                      语音：渲染成语音气泡（时长 + 播放/暂停）。
                      ⚠ 判定条件用 **kind === 'voice'**（服务端字段），
                        不用"宽度为 null"之类的推断 —— 那在图片尺寸解析失败时也会为 null，会误判。
                      时长取 `mm.durationMs`（服务端持久化），见 VoiceMessage 的注释。
                    */
                    m.media.map((mm) => (
                      <VoiceMessage
                        key={mm.id}
                        mediaId={mm.id}
                        durationMs={mm.durationMs}
                        mine={mine}
                      />
                    ))
                  ) : m.kind === 'image' && m.media.length > 0 ? (
                    m.media.map((mm) => <MediaImage key={mm.id} mediaId={mm.id} alt="图片消息" />)
                  ) : (
                    <span className="bubble__text">{m.body}</span>
                  )}
                  <span className="bubble__time">{relativeTime(m.createdAt)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Screen>
  )
}
