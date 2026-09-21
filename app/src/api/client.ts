import type { FeedPost, User } from '../data/mock'
import { authHeaders, clearSession, setSession, type SessionUser } from './session'

/**
 * 后端 API 客户端（M1）。
 *
 * 设计取舍：
 * 1) **不抛异常，返回结果对象**。真机上网络可能不通（服务器重启、地铁里没信号），
 *    上层必须能干净地降级到本地内容；用 `{ ok:false, reason }` 比 try/catch 到处飞要好读。
 * 2) **超时自己控制**。fetch 默认没有超时，服务器半死不活时页面会一直空白。
 * 3) 图片上传是 M4 的事，这里只做文本帖子（M1 冻结的垂直切片）。
 */

/**
 * 服务器**来源（origin）**，不含路径。
 * M2 起走 HTTPS（临时私有 CA + IP SAN 叶子证书，见 ops/tls/gen-certs.sh）；
 * 配了 `VITE_API_ORIGIN` 就以环境变量为准。
 * - APK：https://8.148.156.146（CA 内置在 Network Security Config 的 trust-anchors 里）
 * - 本地浏览器预览：同样可用（后端 CORS 白名单里有 127.0.0.1:517x；
 *   浏览器会提示证书不受信，属预期 —— 这是私有 CA）
 *
 * 命名是**冻结的**：变量只放 origin，`/api/...` 一律由本文件拼。
 * 原因是审核记录 04 点出的 contract drift：如果变量里既可能带 /api 又可能不带，
 * 迟早会有人写出 /api/api/posts。要带路径前缀就应该换名字（比如 VITE_API_BASE），
 * 而不是让同一个变量有两种含义。
 */
const DEFAULT_API_ORIGIN = 'https://8.148.156.146'

const env = import.meta.env as unknown as Record<string, string | undefined>

export const API_ORIGIN = (env.VITE_API_ORIGIN?.trim() || DEFAULT_API_ORIGIN).replace(/\/+$/, '')

const TIMEOUT_MS = 8000

/**
 * 上传专用超时（M5 WO#2）。**比普通请求宽 2.5 倍**：
 * 手机网络下传几 MB 图片很容易超过 8s，用普通超时会把正常上传判成失败，
 * 用户看到"发送失败"而服务端其实已经收到了 —— 那是最难查的一类不一致。
 */
const UPLOAD_TIMEOUT_MS = 20000

/** 服务端返回的帖子形状（与 server/src/index.ts 的 JSON 一一对应） */
export interface ApiPost {
  id: string
  author: string
  /** M2 起由服务端会话决定；M1 历史帖子为 null（当时没有可信身份） */
  authorId: string | null
  body: string
  place: string | null
  createdAt: string
  /** M3 Slice 2 起列表也返回计数（原版卡片上就有） */
  likeCount?: number
  commentCount?: number
  likedByMe?: boolean
  /** M4：帖子的公图片（只含 id 与尺寸；用 mediaUrl(id) 取图） */
  images?: ApiMediaRef[]
}

/** M4：一张媒体资源的引用（只暴露 id 与尺寸，不含存储路径） */
export interface ApiMediaRef {
  id: string
  width: number | null
  height: number | null
  /**
   * 媒体 MIME。**语音气泡靠它判定渲染类型**，而不是靠"宽度为 null"去猜
   * （那种推断在图片尺寸解析失败时也会得到 null，会误判成语音）。
   * 服务端自 M5 WO#5 起在消息读模型里返回它。
   */
  mime: string | null
  /**
   * 语音时长（毫秒），仅音频有值。
   *
   * ⚠ 这个字段**必须来自服务端持久化的值**，不能在客户端"重新下载音频再解码"得到：
   * MediaRecorder 产出的是 live/流式 WebM，**文件头不含 duration**，
   * `<audio>.duration` 读到的是 null（WO#5 探针 P10 实测）。
   * 因此刷新后要显示时长，只能靠这个字段。
   */
  durationMs: number | null
}

/**
 * M4：取媒体图片的**唯一入口**。
 *
 * 为什么所有图片都走 /api/media/:id 而不是直接拼静态路径：
 *   - public 图：接口 302 到 /media/<key>，由 Nginx 静态下发（不经 Node）
 *   - private 图：接口做会话 + 可见性判定后用 X-Accel-Redirect 让 Nginx 下发
 * 客户端**用同一套 URL 形态**，不需要知道背后是哪条链路；
 * 也避免把 storage_key 暴露给前端（以后换对象存储不用改客户端）。
 */
export function mediaUrl(id: string): string {
  return `${API_ORIGIN}/api/media/${encodeURIComponent(id)}`
}

/**
 * M4 Slice A：**带会话凭据地**取媒体字节，返回一个 blob: URL。
 *
 * 为什么不能直接用 `<img src={mediaUrl(id)}>`（审核记录 16 点名的关键点）：
 *   `<img>` 无法附加 `Authorization` 头，而私有媒体必须经过
 *   session → can_read_message → can_read_media 才下发。
 *   若为了 `<img>` 好用而把 token 放进 URL/query，就等于把凭据泄漏到
 *   日志、Referer 与浏览器历史里 —— 所以**不做**那种退化。
 *
 * 正确链路：authenticated fetch → blob → URL.createObjectURL → <img src="blob:...">
 * 调用方**必须**在卸载时 revokeObjectURL（见 MediaImage 组件），否则会持续占用内存。
 */
export async function fetchMediaBlobUrl(id: string): Promise<ApiResult<string>> {
  try {
    // 复用既有的 authHeaders()，不另写一套凭据拼装逻辑
    const res = await fetch(mediaUrl(id), { headers: authHeaders() })
    if (!res.ok) return { ok: false, reason: `http_${res.status}`, status: res.status }
    const blob = await res.blob()
    return { ok: true, value: URL.createObjectURL(blob) }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}

// ===========================================================================
// M4 Slice A：会话与消息
// ===========================================================================

export interface ApiThreadLastMessage {
  body: string
  kind: string
  createdAt: string | null
}

export interface ApiThread {
  id: string
  kind: string
  title: string | null
  memberCount: number
  lastMessage: ApiThreadLastMessage | null
}

export interface ApiMessage {
  id: string
  senderId: string | null
  sender: string | null
  body: string
  /** text | image | voice */
  kind: string
  createdAt: string
  /** 已撤回：界面显示「消息已撤回」，且 media 已被服务端清空 */
  revoked: boolean
  media: ApiMediaRef[]
}

export async function getThreads(): Promise<ApiResult<{ items: ApiThread[] }>> {
  return request<{ items: ApiThread[] }>('/api/threads')
}

export async function getThreadMessages(
  threadId: string,
): Promise<ApiResult<{ threadId: string; items: ApiMessage[] }>> {
  return request<{ threadId: string; items: ApiMessage[] }>(
    `/api/threads/${encodeURIComponent(threadId)}/messages`,
  )
}

// ===========================================================================
// M5 WO#2：给会话发一张图片（前端接入上传 + 图片消息）
//
// 为什么是**两步**（先上传拿 id，再发消息挂 id）：这是服务端 API 的形状，不是前端的选择。
//   ① POST /api/media                     multipart → mediaId（此刻资源已入库，但还没被任何消息引用）
//   ② POST /api/threads/:id/messages      { body, kind:'image', mediaId } → 把 id 挂到消息上
// 中途失败会留下一个**未被引用的资源**：服务端有 cleanup-unattached 负责回收
// （scripts/m5/verify-cleanup-unattached.sh），客户端不需要、也不应该自己去删 ——
// 客户端没有"删媒体"的接口，硬凑一个只会制造越权面。
// ===========================================================================

/** 上传接口的返回值。**只暴露 id 与尺寸**，storage_key 不出现在这里（换对象存储不用改客户端）。 */
export interface ApiUploadedMedia {
  id: string
  /** 幂等重放分支不返回宽高（服务端只回 id/storageKey/mime/scope）→ 所以允许 null */
  width: number | null
  height: number | null
  /** 服务端判定的 MIME（按**内容**探测的结果，不是我们声明的） */
  mime: string | null
  /** 语音时长回显：便于断言"服务端存下的就是我测到的那个值" */
  durationMs: number | null
}

/**
 * 上传一张图片，返回 mediaId。
 *
 * multipart 字段名**必须逐字一致**（服务端按这些名字取，见 server/src/index.ts:1126 一带）：
 *   file            —— 文件本体
 *   purpose: 'chat' —— 会话私图：服务端映射为 scope=private，只有会话成员可读
 *   uploadRequestId —— 幂等键，**必须是 UUID**（非 UUID → 400 missing_upload_request_id）
 *
 * 三个刻意的约束（都是踩过或审过的点）：
 *   1) **不手动设 Content-Type**。multipart 的 boundary 是浏览器/WebView 自己生成的，
 *      手写 `content-type: multipart/form-data` 会把 boundary 丢掉 → 服务端解析不到任何字段。
 *      这里连 request() 都不能用：request() 会强制 JSON 并 JSON.stringify(body)。
 *   2) `uploadRequestId` 必须是 UUID 而不是随便一个字符串：它是**幂等键**，
 *      语义是"这是同一次逻辑上传"，服务端拿它做重放去重（同一个键重复上传不会建第二个文件）。
 *   3) 复用既有的 `authHeaders()`，不另写一套凭据拼装 —— 上传同样需要会话（服务端按会话定 owner）。
 *
 * 超时比普通请求长（20s）：手机上传几 MB 图比拉一段 JSON 慢得多，用 8s 会误杀正常上传。
 */
export async function uploadMedia(
  file: File | Blob,
  purpose: 'post' | 'chat',
  /**
   * 语音时长（毫秒）。**仅音频需要传**，且服务端会强制：
   * audio/webm 必须带正时长、image/* 禁止带。（审核记录 35）
   *
   * 为什么由客户端算而不是服务端从文件里读：见 `ApiMediaRef.durationMs` 的注释
   * （live/WebM 文件头不含 duration）。调用方应当用**单调时钟**计时
   * （`performance.now()` 差），而不是 `audio.duration`。
   */
  durationMs?: number,
): Promise<ApiResult<ApiUploadedMedia>> {
  const form = new FormData()
  form.append('file', file)
  form.append('purpose', purpose)
  form.append('uploadRequestId', crypto.randomUUID())
  if (durationMs !== undefined) {
    // 只接受正整数；非法值在这里就拦掉，避免把明显错误的值发给服务端再换回 400
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      return { ok: false, reason: `非法时长: ${String(durationMs)}` }
    }
    form.append('durationMs', String(durationMs))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_ORIGIN}/api/media`, {
      method: 'POST',
      headers: authHeaders(), // 只有凭据，**没有** content-type（见上）
      body: form,
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status }
    }
    try {
      const v = JSON.parse(text) as {
        id: string
        width?: number | null
        height?: number | null
        mime?: string | null
        durationMs?: number | null
      }
      if (!v?.id) return { ok: false, reason: '上传响应里没有 id' }
      return {
        ok: true,
        value: {
          id: v.id,
          width: v.width ?? null,
          height: v.height ?? null,
          mime: v.mime ?? null,
          durationMs: v.durationMs ?? null,
        },
      }
    } catch {
      return { ok: false, reason: '上传响应不是合法 JSON' }
    }
  } catch (err) {
    const e = err as Error
    const reason =
      e.name === 'AbortError' ? `上传超时（${UPLOAD_TIMEOUT_MS}ms）` : `${e.name}: ${e.message}`
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}

/** 发送接口的回显（客户端据此确认消息真的挂上了媒体） */
export interface ApiSentMessage {
  id: string
  kind: string
  mediaId: string | null
}

/**
 * 往会话里发一条消息。**需要登录且必须是会话成员**（服务端会话决定发送者）。
 *
 * ⚠ 两个必须遵守的服务端口径：
 *   1) `mediaId` 是**单数**。服务端**明确拒绝** `mediaIds: [...]`（400 bad_media_id）——
 *      这是刻意的：静默忽略复数会让客户端以为图发出去了。所以这里**没有**数组入口。
 *   2) `body` 对图片消息也**必须非空**（服务端先校验 body 再校验 kind）：
 *      纯图也要带一句正文，见 IMAGE_MESSAGE_BODY。
 */
export async function postThreadMessage(
  threadId: string,
  input: { body: string; kind?: 'text' | 'image' | 'voice'; mediaId?: string; mentions?: string[] },
): Promise<ApiResult<ApiSentMessage>> {
  return request<ApiSentMessage>(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    // 传对象，序列化只在 request() 里做一次（双重编码那个坑）
    body: input,
  })
}

/**
 * 图片消息的正文。
 *
 * 服务端要求 body 非空（`bad_body`），发纯图也得有一句正文；
 * 界面在 kind='image' 且 media 非空时**渲染图片而不渲染这句话**，
 * 所以它只在"图挂了但媒体取不到"之类的降级场景里露出来 —— 那时显示「[图片]」比空白好。
 */
export const IMAGE_MESSAGE_BODY = '[图片]'

/** 发一条图片消息：把已经上传好的 mediaId 挂到消息上（两步里的第二步） */
export async function postThreadImageMessage(
  threadId: string,
  mediaId: string,
): Promise<ApiResult<ApiSentMessage>> {
  return postThreadMessage(threadId, {
    body: IMAGE_MESSAGE_BODY,
    kind: 'image',
    mediaId,
  })
}

/**
 * 语音消息的正文。
 *
 * 与 `IMAGE_MESSAGE_BODY` 同理：服务端要求 `body` 非空（否则 `bad_body`），
 * 所以发纯语音也得带一句正文；界面在 `kind='voice'` 且 media 非空时**渲染语音气泡而不渲染它**，
 * 只在"媒体取不到"的降级场景露出来 —— 那时显示「[语音]」比空白好。
 */
export const VOICE_MESSAGE_BODY = '[语音]'

/**
 * 发一条语音消息：把已经上传好的音频 mediaId 挂到消息上（两步里的第二步）。
 *
 * 为什么时长不在这里传：时长属于**媒体**（`media.duration_ms`，由 `uploadMedia` 写入），
 * 消息只是引用媒体。因此发消息这一步不需要、也不接受 durationMs —— 保持"消息=引用"的模型，
 * 避免同一份时长出现两个可能不一致的来源。
 */
export async function postThreadVoiceMessage(
  threadId: string,
  mediaId: string,
): Promise<ApiResult<ApiSentMessage>> {
  return postThreadMessage(threadId, {
    body: VOICE_MESSAGE_BODY,
    kind: 'voice',
    mediaId,
  })
}

/**
 * 发一条**纯文本**消息（M5 WO#7）。
 *
 * 为什么此前没有它：WO#2 做了图片发送、WO#5 做了语音发送，
 * 而"文字发送"这条路径**从未被任何工作单覆盖** —— 服务端 API 一直支持
 * （gate 里长期有 `T1 纯文本 → 201` 断言），但**客户端 UI 没有任何入口**，
 * 于是会话页能打字却发不出去。这是"垂直 slice 都绿、横向产品能力缺一块"的盲区，
 * 审核记录 42 为此建议新增 `COMPOSER_CAPABILITY_COVERAGE` 检查。
 *
 * 边界（刻意）：
 *   · **只发文本**：不带 mediaId（服务端对 `text + mediaId` 会 400，这正是既有契约）
 *   · **不做回车发送**：审核记录 42 明确 `ENTER_TO_SEND: DO NOT IMPLEMENT`
 *     （移动端 Enter 可能是换行 / IME action / 发送，原版行为未取证）
 *   · body 由调用方 trim 后传入；这里不替调用方决定"空串怎么办"
 */
export async function postThreadTextMessage(
  threadId: string,
  body: string,
): Promise<ApiResult<ApiSentMessage>> {
  return postThreadMessage(threadId, { body, kind: 'text' })
}

// ===========================================================================
// M5 Slice 1：留言板（对应原版 message-board）
//
// 一致性依据是**可采信**的只读证据：
//   标题「留言」+ 副标题「仅双方可见」、空态「可以给同学留言噢」、
//   输入框占位「留言仅双方可见」、按钮「留言」、表情行 7 个。
//
// 注意（审核记录 18 的要求）：**另一方用户是唯一的客户端参数**；
// 当前用户永远来自 session —— 这里不提供、也不接受 from_user_id，
// 服务端同样忽略客户端提交的该字段（verify-board-notes.sh 的 B8 组断言了这一点）。
// ===========================================================================

export interface ApiBoardNote {
  id: string
  fromUserId: string
  toUserId: string
  fromName: string | null
  toName: string | null
  body: string
  createdAt: string
  /** 同一条留言在不同视角下 mine 不同：我发的为 true，对方发的为 false */
  mine: boolean
}

export interface ApiBoardNotes {
  peerId: string
  /** 原版口径：仅双方可见 */
  visibleTo: string
  /** 原版空态文案 */
  emptyText: string
  items: ApiBoardNote[]
}

export async function getBoardNotes(peerId: string): Promise<ApiResult<ApiBoardNotes>> {
  return request<ApiBoardNotes>(`/api/board-notes/${encodeURIComponent(peerId)}`)
}

export async function postBoardNote(
  peerId: string,
  body: string,
): Promise<ApiResult<{ id: string; body: string }>> {
  return request<{ id: string; body: string }>(`/api/board-notes/${encodeURIComponent(peerId)}`, {
    method: 'POST',
    /*
      ⚠ **传对象，不要传字符串**。
      踩过的坑（真实 bug，我自己引入的）：这里原来写的是
        body: JSON.stringify({ body })
      而 request() 内部本来就会 `JSON.stringify(init.body)` ——
      于是请求体被**双重编码**成一个 JSON 字符串字面量（"{\"body\":\"😂\"}"），
      服务端解析出来的是字符串而不是对象，`req.body.body` 为 undefined，
      最终正确地回了 400 bad_body。
      症状很有欺骗性：界面输入框显示正常、请求确实发出、服务端却稳定回 400，
      很容易被误判成"测试注入的问题"或"接口坏了"。
      教训：**客户端的 body 一律传对象，序列化只在 request() 里做一次**。
    */
    body: { body },
  })
}

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; status?: number }

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult<T>> {
  const url = `${API_ORIGIN}${path}`
  const controller = new AbortController()
  // fetch 默认没有超时：服务器半死不活时页面会一直卡住，必须自己兜一个
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        // 有会话就带上；M3 接登录页后这里会自然生效
        ...authHeaders(),
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      // 401 单独标出来：上层可以据此提示"需要登录"，而不是当成网络故障
      return { ok: false, reason: `HTTP ${res.status}: ${text.slice(0, 200)}`, status: res.status }
    }
    if (!text) {
      // 204（logout）没有响应体
      return { ok: true, value: undefined as T }
    }
    try {
      return { ok: true, value: JSON.parse(text) as T }
    } catch {
      return { ok: false, reason: '响应不是合法 JSON' }
    }
  } catch (err) {
    // AbortError = 超时；TypeError = 网络不可达 / CORS / 混合内容被拦
    const e = err as Error
    const reason = e.name === 'AbortError' ? `请求超时（${TIMEOUT_MS}ms）` : `${e.name}: ${e.message}`
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}

/** 取帖子列表（最新的在最前）；匿名可读 */
export function listPosts(): Promise<ApiResult<ApiPost[]>> {
  return request<{ items: ApiPost[] }>('/api/posts').then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/**
 * 发一条文本帖子。
 * **注意输入里没有 author**：M2 起作者只能由服务端会话决定，
 * 客户端一旦提交 author/authorId 会被服务端 strict 400 拒绝（见 server/src/index.ts）。
 * 这里把字段从类型里去掉，让"想传也传不了"。
 */
export function createPost(input: {
  body: string
  place?: string
}): Promise<ApiResult<ApiPost>> {
  return request<ApiPost>('/api/posts', { method: 'POST', body: input })
}

/**
 * 请求登录验证码（M3 Slice 0B）。
 *
 * 原版登录是「手机号 + 短信验证码」，所以公开登录入口只有这一条；
 * M2 的 handle+password 已按审核裁定退休（服务端 /api/auth/login 会返回 410）。
 *
 * 返回里的 `delivery` 说明码是怎么送出去的：本项目**没有接入短信通道**，
 * 所以是 `dev-sink`（服务器上一个只有运维能读的目录），报告里标注
 * SMS_GATEWAY_NOT_INTEGRATED —— 这不等于"登录功能已完成"。
 */
export interface RequestCodeResult {
  ok: true
  phone: string
  expiresAt: string
  delivery: string
  delivery_note: string
}

export async function requestLoginCode(phone: string): Promise<ApiResult<RequestCodeResult>> {
  const r = await request<Omit<RequestCodeResult, 'ok'>>('/api/auth/request-code', {
    method: 'POST',
    body: { phone },
  })
  if (!r.ok) return r
  return { ok: true, value: { ok: true, ...r.value } }
}

/** 校验验证码并签发会话；成功后把会话写进本地 */
export async function verifyLoginCode(
  phone: string,
  code: string,
): Promise<ApiResult<SessionUser>> {
  const r = await request<{ token: string; expiresAt: string; user: SessionUser }>(
    '/api/auth/verify-code',
    { method: 'POST', body: { phone, code } },
  )
  if (!r.ok) return r
  setSession({ token: r.value.token, expiresAt: r.value.expiresAt, user: r.value.user })
  return { ok: true, value: r.value.user }
}

/** 退出登录：先让服务端撤销会话，再清本地（服务端失败也要清，否则本地会一直"看起来已登录"） */
export async function logout(): Promise<void> {
  try {
    await request<null>('/api/auth/logout', { method: 'POST', body: {} })
  } finally {
    clearSession()
  }
}

/** 当前用户（未登录时返回 null，不抛异常） */
export async function me(): Promise<SessionUser | null> {
  const r = await request<SessionUser>('/api/auth/me')
  return r.ok ? r.value : null
}

// ---------------------------------------------------------------------------
// 形状转换：服务端帖子 → 前端信息流卡片
// ---------------------------------------------------------------------------

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成头像。
 * 后端 M1 不存头像（图片是 M4 的事），但卡片上没有头像会显得缺了一块，
 * 所以按名字生成一枚首字母渐变头像 —— 同一名字每次都得到同样的颜色。
 */
export function avatarFor(name: string): string {
  const ch = (name || '?').trim().slice(0, 1) || '?'
  const hue = hashHue(name || '?')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},70%,64%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 40) % 360},70%,46%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="80" height="80" rx="40" fill="url(#g)"/>` +
    `<text x="40" y="53" font-size="34" font-family="sans-serif" fill="#fff" ` +
    `text-anchor="middle">${escapeXml(ch)}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 相对时间（原版列表习惯：刚刚 / N分钟前 / N小时前 / N天前 / M月D日） */
export function relativeTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}天前`
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function toFeedPost(p: ApiPost): FeedPost {
  const author: User = {
    // 有 authorId 就用它（同一用户在不同设备上会得到同一个 id），
    // M1 历史帖子没有 id，退化成按名字生成，只影响本地渲染不影响数据
    id: p.authorId ? `u:${p.authorId}` : `api:${p.author}`,
    name: p.author,
    avatar: avatarFor(p.author),
  }
  return {
    id: p.id,
    author,
    text: p.body,
    // M4：帖子的真实图片。**这里此前是硬编码 `images: []`**，
    // 所以列表卡片从来没显示过图（后端当时也没返回）。现在统一走 mediaUrl(id)：
    // 公图 302 → Nginx 静态，私图 X-Accel，客户端不关心区别。
    images: (p.images ?? []).map((m) => mediaUrl(m.id)),
    // M3 Slice 2：列表也用服务端计数（原版卡片上就有赞数/评论数）
    likes: p.likeCount ?? 0,
    comments: p.commentCount ?? 0,
    liked: p.likedByMe ?? false,
    location: p.place ?? undefined,
    // 列表卡片用相对时间；精确时间留给详情页（M2 再补）
    createdAt: relativeTime(p.createdAt),
  }
}

// ===========================================================================
// M3 Slice 1：帖子详情 / 评论 / 回复
//
// 1:1 依据（原版实测，见 docs/m3/MODEL-VALIDATION.md §2.7）：
//   - 评论区**内联**在动态详情里；顶层评论各自带一层「回复列表」（嵌套渲染）
//   - 回复行渲染为「<作者> 回复 <目标> · <时间>」+ 正文
//   - 「评论 N」的计数**把回复也算进去**
// ===========================================================================

export interface ApiComment {
  id: string
  body: string
  authorId: string | null
  author: string
  createdAt: string
  parentId: string | null
  /** 回复的目标昵称（来自 parent_id 指向的那条评论的作者）；顶层评论为 null */
  replyTo: string | null
}

export interface ApiCommentNode extends ApiComment {
  replies: ApiComment[]
}

export interface ApiPostDetail {
  id: string
  author: string
  authorId: string | null
  body: string
  place: string | null
  createdAt: string
  /** **含回复**的总数（原版「评论 N」的口径） */
  commentCount: number
  likeCount: number
  /** 当前会话用户是否点过赞（未登录恒 false） */
  likedByMe: boolean
  /** M4：帖子的公图片（只含 id 与尺寸；用 mediaUrl(id) 取图） */
  images?: ApiMediaRef[]
}

/** 帖子详情。404 会返回 ok:false + status 404，调用方可据此显示"已删除" */
export async function getPost(id: string): Promise<ApiResult<ApiPostDetail>> {
  const r = await request<ApiPostDetail>(`/api/posts/${encodeURIComponent(id)}`)
  if (r.ok) writeSnapshot(`post:${id}`, r.value)
  return r
}

/** 评论树：顶层评论 + replies（每条 reply 自带 replyTo） */
export async function getComments(id: string): Promise<ApiResult<{ items: ApiCommentNode[]; total: number }>> {
  const r = await request<{ items: ApiCommentNode[]; total: number }>(
    `/api/posts/${encodeURIComponent(id)}/comments`,
  )
  if (r.ok) writeSnapshot(`comments:${id}`, r.value)
  return r
}

/** 发评论或回复：带 parentId 就是回复。**需要登录**（作者由服务端会话决定） */
export async function createComment(
  postId: string,
  body: string,
  parentId?: string,
): Promise<ApiResult<ApiComment>> {
  const r = await request<ApiComment>(`/api/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    body: parentId ? { body, parentId } : { body },
  })
  return r
}

// ===========================================================================
// M3 Slice 2：点赞
//
// 1:1 依据（原版**只读**观察，见 supplements/slice2-likes-readonly.json）：
//   - 点赞区是整块热区；计数是纯数字无单位
//   - **0 赞时不渲染计数控件**（不是显示 0）
//   - 没有「谁点了赞」的列表
//   - 切换行为与已点赞态样式属写操作 → BLOCKED_BY_POLICY，只在本系统内验证
// ===========================================================================

export interface LikeState {
  liked: boolean
  likeCount: number
  likedByMe: boolean
}

/** 点赞（服务端幂等，重复调用不会重复计数） */
export async function likePost(postId: string): Promise<ApiResult<LikeState>> {
  return request<LikeState>(`/api/posts/${encodeURIComponent(postId)}/like`, {
    method: 'POST',
    body: {},
  })
}

/** 取消点赞（同样幂等） */
export async function unlikePost(postId: string): Promise<ApiResult<LikeState>> {
  return request<LikeState>(`/api/posts/${encodeURIComponent(postId)}/like`, { method: 'DELETE' })
}

// ===========================================================================
// M3 Slice 4：地点详情（poi-detail）
//
// 一致性依据是**只读取得**的证据（supplements/poi-detail.json），未被政策排除，
// 因此这一页**可以**做视觉/结构一致性判定（与 at-panel / media-preview 不同）。
// ===========================================================================

export interface ApiPlacePost {
  id: string
  author: string
  authorId: string | null
  body: string
  createdAt: string
}

export interface ApiPlaceDetail {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  posts: ApiPlacePost[]
  postCount: number
}

/** 地点详情：地点本体 + 该地点的动态（原版的「按地点聚合动态」） */
export async function getPlace(id: string): Promise<ApiResult<ApiPlaceDetail>> {
  return request<ApiPlaceDetail>(`/api/places/${encodeURIComponent(id)}`)
}

// ---------------------------------------------------------------------------
// 「最后一次成功的 API 快照」缓存
//
// 审核记录 07 对离线降级的边界：
//   已迁移页面：正常在线时 **API = 权威数据源**；离线时**最多**降级到最后一次成功的 API 快照。
//   不能做：API 失败 → 塞一份 synthetic mock → UI 看起来仍然像在线成功。
// 所以这里**只在 API 成功时写入**，失败时读出来的也永远是"某次真实成功过的响应"。
// ---------------------------------------------------------------------------

const SNAPSHOT_PREFIX = 'campus.demo.snapshot.v1'

function writeSnapshot(key: string, value: unknown): void {
  try {
    localStorage.setItem(`${SNAPSHOT_PREFIX}:${key}`, JSON.stringify({ at: Date.now(), value }))
  } catch {
    // 容量满或隐私模式：快照是"最好有"，写不进去不影响在线路径
  }
}

export function readSnapshot<T>(key: string): { at: number; value: T } | null {
  try {
    const raw = localStorage.getItem(`${SNAPSHOT_PREFIX}:${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at: number; value: T }
    if (!parsed || typeof parsed.at !== 'number') return null
    return parsed
  } catch {
    return null
  }
}
