import type { FeedPost, User } from '../data/types'
import { authHeaders, clearSession, setSession, updateSessionUser, type SessionUser } from './session'

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
  /**
   * ⭐ TimeMap P0（F02）：帖子关联的**预设地点 id**（locations 是权威归属）。
   *
   * 为什么不再靠 `place`（地名文本）判归属：文本可以被改名、可以重复，
   * 而 P0 的核心业务规则是「所有帖子必须关联管理员启用的预设地点」——
   * 那是一条**引用关系**，必须用 id 表达。`place` 退化为**展示快照**（发帖时的地点名）。
   * 历史数据可能为 null（P0 之前的帖子没有 place_id）。
   */
  placeId?: string | null
  /**
   * ⭐ M5 WO#15：地点经纬度（服务端 left join places 得到；无地点时为 null）。
   * 为什么需要：地图页按**经纬度**渲染标记（tencent / real 两个实现都是），
   * 而此前前端只有 place（地名文本）→ 拿不到坐标就无法把 mock 换成权威。
   * ⚠️ 服务端已显式 Number() 转换（pg 可能把数值以字符串返回）。
   */
  placeLat: number | null
  placeLng: number | null
  createdAt: string
  /** M3 Slice 2 起列表也返回计数（原版卡片上就有） */
  likeCount?: number
  commentCount?: number
  likedByMe?: boolean
  /**
   * ⭐ TimeMap P0（F05）：收藏数 / 我是否收藏过。
   * 与 likeCount 同型：**计数来自服务端**，前端不得自己加减
   * （撤销收藏、重复收藏、内容下架都会让本地推算失真）。
   */
  favoriteCount?: number
  favoritedByMe?: boolean
  /** M4：帖子的公图片（只含 id 与尺寸；用 mediaUrl(id) 取图） */
  images?: ApiMediaRef[]
  imageMode?: 'photo' | 'sticker'
  mapMediaId?: string | null
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
  /**
   * direct 会话的**对方昵称**（M5 WO#8 新增）。
   *
   * 为什么需要：direct 会话的 `title` 在库里的实测值是 `NULL`（成员 2 人），
   * 而列表要显示"跟谁在聊"。没有这个字段，direct 行就没有名字可显示。
   * group 会话该字段为 null（用 `title`）。
   */
  peerName: string | null
  /**
   * direct 会话里**对方是谁**的权威身份（M5 WO#12 新增，审核记录 53 批准）。
   *
   * 为什么需要：他人主页的「私信」要跳到"我与 TA 的会话"，
   * 而**按 peerName 匹配不可靠**（可能重名、可能改名）。必须按 id 匹配。
   * group 会话该字段恒为 null（群里没有"对方"这个概念，与 peerName 同一处置）。
   *
   * 它**只**回答"已有 direct 会话中对方是谁"，**不**回答
   * "从没聊过的人点私信该怎样建会话" —— 后者 WO#12 的处置是 hide/unavailable，不猜不造。
   */
  peerId: string | null
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

/**
 * 取**单个会话的元数据**（M5 WO#9A）。
 *
 * 为什么不让调用方把 title 通过路由传进来：那样群名就变成**客户端提供的数据** ——
 * 刷新/深链会丢，且客户端可以随便改。页面标题应当来自服务端（与列表同一批字段）。
 * 访问控制与 `getThreadMessages` 完全一致（非成员/不存在一律 404，服务端刻意不区分）。
 */
/**
 * 会话详情（M5 WO#9B 层 A）。
 *
 * `members` 是 **AT 面板的唯一权威成员来源**（blocker ①，审核记录 49 批准）：
 * 面板**不得**从消息 sender / seed / mock / 本地缓存反推成员。
 *
 * 边界（审核 49）：
 *   · 只含**最小身份字段** `{ id, displayName }` —— 服务端**不**返回 phone 等无关数据
 *   · 服务端保证 `memberCount === members.length`（不一致时服务端自己 500，不会静默给错数）
 *   · ⚠️ **顺序不是 conformance**：当前没有原版成员排序规则的证据，
 *     服务端按 displayName 排序只是为了结果稳定；前端**不得**把顺序当契约来断言。
 */
export interface ApiThreadDetail {
  id: string
  kind: string
  title: string | null
  memberCount: number
  peerName: string | null
  members: Array<{ id: string; displayName: string }>
}

export async function getThread(threadId: string): Promise<ApiResult<ApiThreadDetail>> {
  return request<ApiThreadDetail>(`/api/threads/${encodeURIComponent(threadId)}`)
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
  purpose: 'post' | 'chat' | 'activity',
  /**
   * 语音时长（毫秒）。**仅音频需要传**，且服务端会强制：
   * audio/webm 必须带正时长、image/* 禁止带。（审核记录 35）
   *
   * 为什么由客户端算而不是服务端从文件里读：见 `ApiMediaRef.durationMs` 的注释
   * （live/WebM 文件头不含 duration）。调用方应当用**单调时钟**计时
   * （`performance.now()` 差），而不是 `audio.duration`。
   */
  durationMs?: number,
  uploadRequestId: string = crypto.randomUUID(),
): Promise<ApiResult<ApiUploadedMedia>> {
  const form = new FormData()
  form.append('purpose', purpose)
  form.append('uploadRequestId', uploadRequestId)
  if (durationMs !== undefined) {
    // 只接受正整数；非法值在这里就拦掉，避免把明显错误的值发给服务端再换回 400
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      return { ok: false, reason: `非法时长: ${String(durationMs)}` }
    }
    form.append('durationMs', String(durationMs))
  }
  // The server reads metadata before consuming the multipart file stream.
  form.append('file', file)

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
  input: {
    body: string
    kind?: 'text' | 'image' | 'voice'
    mediaId?: string
    mentions?: string[]
    /**
     * M5 WO#9B：@所有人。
     *
     * 与 `mentions`（逐人）**互斥** —— 服务端会在同一事务内拒绝两者同时出现
     * （`mentions_all_conflicts_with_mentions`），因为在数据上"全体"与"逐人"
     * 无法区分该按哪个解释。
     * ⚠️ 它**只是标记**，**不得**把它写进 `body`（例如 body="@所有人 …"）：
     *   UI presentation（可见 chip）与 persistence semantics（这个布尔）必须分离。
     */
    mentionsAll?: boolean
  },
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
  mentionsAll = false,
): Promise<ApiResult<ApiSentMessage>> {
  return postThreadMessage(threadId, { body, kind: 'text', mentionsAll })
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
export function listPosts(authorId?: string): Promise<ApiResult<ApiPost[]>> {
  /*
    M5 WO#12：可选的 `authorId` → **服务端**过滤（不是客户端 filter）。
    为什么必须服务端过滤（审核记录 53）：客户端 `items.filter(...)` 只有在
    `/api/posts` 永远返回完整全集时才等价于"TA 的全部动态"；一旦加页/limit，
    它会**静默变成**"不完整但看起来完整"，而用户无法察觉。
    服务端过滤没有这个隐患，因此这里把过滤条件交给服务端。
  */
  const q = authorId ? `?authorId=${encodeURIComponent(authorId)}` : ''
  return request<{ items: ApiPost[] }>(`/api/posts${q}`).then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/**
 * 按 id 查用户的最小权威资料（M5 WO#12 新增，审核记录 53 批准）。
 *
 * 契约：成功只返回 `{ id, displayName }` 两个字段 —— 服务端**刻意**不返回
 * phone / campus / 学院 / 年级 等（那些要么没有权威来源，要么不该对任意登录用户暴露）。
 * 未知 id 或形状非法 → 服务端 404。
 *
 * 为什么需要它：修掉"点真实作者却显示成另一个 mock 用户"之后，
 * "他人主页"要显示**真实昵称**就必须有一个按 user identity 查的权威入口。
 */
export interface ApiUserIdentity {
  id: string
  displayName: string
}

export function getUser(id: string): Promise<ApiResult<ApiUserIdentity>> {
  return request<ApiUserIdentity>(`/api/users/${encodeURIComponent(id)}`)
}

/**
 * 修改**自己的**昵称（M5 WO#13，审核记录 54 批准的第一个 profile-update 写能力）。
 *
 * ## 为什么需要它
 *   ProfileEditScreen 原来是**假写成功**：saveEdit() 只 setState、零网络请求，
 *   而界面**确实显示新值** → 用户以为改成功了。该页从「我的」页**一步可达**，
 *   所以这不是"未接线"，而是**向用户谎报持久写入已成功**。
 *
 * ## 契约（与 server 的 PATCH /api/users/me 一致）
 *   · 只接受 displayName；**不传**用户 id —— 服务端从会话取（客户端无权指定改谁）
 *   · 成功返回**服务端库里刚写入的值**（不是回显请求体），调用方必须用这个返回值更新 UI
 *   · 失败（4xx/5xx）→ 调用方必须**保留用户输入**且**不得显示成功**
 */
export function patchMyDisplayName(displayName: string): Promise<ApiResult<ApiUserIdentity>> {
  /*
    ⚠️ 传**对象**而不是 JSON.stringify 的结果：request() 内部会 `JSON.stringify(init.body)`
       （见 request 的实现）。我第一版在这里写了 JSON.stringify(...) —— 那会把
       一个**字符串**再 stringify 一次，服务端收到的是 "{\"displayName\":...}" 这个字符串字面量，
       解析出来不是对象 → 400 且报"不支持字段"。属于"自己把自己坑了"那一类。
  */
  return request<ApiUserIdentity>('/api/users/me', {
    method: 'PATCH',
    body: { displayName },
  })
}

/**
 * 发一条帖子（可带媒体）。
 * **注意输入里没有 author**：M2 起作者只能由服务端会话决定，
 * 客户端一旦提交 author/authorId 会被服务端 strict 400 拒绝（见 server/src/index.ts）。
 * 这里把字段从类型里去掉，让"想传也传不了"。
 *
 * ⭐ WO#21（Round 319）：新增可选 `mediaIds` —— 让发布页的**图片**真正随帖入库。
 *   ⚠️ 服务端会**严格校验**每个 id：必须存在、scope='public'（聊天媒体挂不上）、
 *      且**属于当前会话用户**（否则 403）。所以调用方必须先 `uploadMedia(f, 'post', ...)`
 *      拿到 id 再传进来。
 *   ⚠️ 顺序：**先传媒体、再发帖**。反过来会先产生一条没图的帖子，
 *      而补挂媒体的接口我们没有（服务端只有"发帖时一并挂"这一条路）。
 *
 * ⭐⭐ TimeMap P0（F04）：**契约变更** —— `place`（地名文本）已被删除，
 *   改为必填 `placeId`（必须是**存在且启用**的预设地点），并新增 `clientRequestId`。
 *
 *   · 为什么必须改成 placeId：P0 核心规则是「所有帖子必须关联管理员启用的预设地点」。
 *     按地名文本发帖时，服务端无法可靠判断"这个地点存在吗、启用了吗"——
 *     文本可以被改名、可以一字之差。用 id 才能让"归属"可机械校验。
 *     ⚠️ 旧版前端（还在传 place）会被服务端 **400** 拒绝：服务端与本前端必须一起部署。
 *
 *   · 为什么要 clientRequestId（US-02：连续点击发布不得产生重复帖子）：
 *     幂等键由**客户端生成一次**、重试时复用；服务端凭 (clientRequestId, author) 认出
 *     重放并**返回原帖**（带 idempotentReplay:true），而不是插入第二条。
 *     ⚠️ 关键纪律：它必须在**用户开始这次发布时生成一次**并保存在组件状态里，
 *        绝不能每次调用现生成 —— 那样连点两次会得到两个不同的键，等于没有幂等。
 *     ⚠️ 服务端**不因重放而报错**（返回 200 + 原帖 id），所以调用方不能只看 status。
 */
export function createPost(input: {
  body: string
  /** 必填：预设地点 id（管理员已启用）。缺省/非法都会被服务端 400 拒绝 */
  placeId: string
  /** 已上传的 **public** 媒体 id（图片）；顺序即展示顺序 */
  mediaIds?: string[]
  mapMediaId?: string
  /** 幂等键（UUID）：同一次发布的重试必须复用**同一个**值 */
  clientRequestId?: string
  imageMode?: 'photo' | 'sticker'
}): Promise<ApiResult<ApiPost>> {
  return request<ApiPost>('/api/posts', { method: 'POST', body: input })
}

export async function generateCutout(mediaId: string, requestId: string): Promise<ApiResult<{ dataUrl: string }>> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/media/cutout`, {
      method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ mediaId, requestId }), signal: AbortSignal.timeout(70000),
    })
    const result = await res.json()
    if (!res.ok) return { ok: false, status: res.status, reason: result.message ?? result.error ?? '处理失败' }
    return { ok: true, value: result }
  } catch {
    return { ok: false, reason: '网络中断或请求超时，请重试以查询同一次处理结果' }
  }
}

// ===========================================================================
// TimeMap P0（F05 互动 / F06 活动 / F07 举报与管理端）
//
// 为什么要单独一段而不是散在文件各处：P0 的这七个面是一组**同时引入**的能力，
// 集中在一起才能一眼看出"这一版新增了什么"。每条都标了它对应的用户故事（US-xx）。
// ===========================================================================

/**
 * 收藏/取消收藏的返回：**服务端权威计数**（不是客户端推算）。
 *
 * ⚠️ 类型名 `FavoriteResult` 取自《概要设计与详细设计文档》§2.3.1（活动模块类图）。
 *    帖子收藏与活动收藏**共用这一个返回形状**（`favorited` + `favoriteCount`），
 *    所以不按模块拆成两个同名不同义的类型。
 */
export interface FavoriteResult {
  favorited: boolean
  favoriteCount: number
}

/** 收藏一条帖子（US-03）。服务端幂等：重复收藏不重复计数 */
export function favoritePost(postId: string): Promise<ApiResult<FavoriteResult>> {
  return request<FavoriteResult>(`/api/posts/${encodeURIComponent(postId)}/favorite`, {
    method: 'POST',
    body: {},
  })
}

/** 取消收藏（US-03：收藏可撤销，取消后从个人中心移除） */
export function unfavoritePost(postId: string): Promise<ApiResult<FavoriteResult>> {
  return request<FavoriteResult>(`/api/posts/${encodeURIComponent(postId)}/favorite`, {
    method: 'DELETE',
  })
}

/**
 * 我的收藏（US-03：收藏内容可在个人中心查看）。
 *
 * 形状与 `GET /api/posts` 一致（同一套 ApiPost 渲染路径），且 `favoritedByMe` 恒为 true。
 * ⚠️ 服务端只返回**仍公开**（status='published'）的帖子：被下架的内容会同步消失，
 *    这是需求 US-08「下架后同步退出各展示入口」的一部分，**不是**丢数据。
 */
export function listMyFavorites(): Promise<ApiResult<ApiPost[]>> {
  return request<{ items: ApiPost[] }>('/api/me/favorites').then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/** 作者删除自己的帖子（US-02：只有作者能删；服务端校验归属，非作者 403） */
export function deleteMyPost(postId: string): Promise<ApiResult<void>> {
  return request<void>(`/api/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' })
}

/** 作者删除自己的评论（US-03：只能删自己的；删除后不计入有效评论量） */
export function deleteMyComment(commentId: string): Promise<ApiResult<void>> {
  return request<void>(`/api/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' })
}

/**
 * 举报原因码（US-08）。
 *
 * 为什么用固定枚举而不是自由文本：管理端要能**分类统计与筛选**；
 * 自由文本会让"同类举报"变成一堆无法聚合的字符串。
 * 补充说明走 detail 字段。
 */
export const REPORT_REASONS = [
  { code: 'inappropriate', label: '不当内容' },
  { code: 'spam', label: '垃圾广告' },
  { code: 'harassment', label: '人身攻击' },
  { code: 'false_info', label: '虚假信息' },
  { code: 'other', label: '其他' },
] as const

export type ReportReasonCode = (typeof REPORT_REASONS)[number]['code']

export interface ApiReport {
  id: string
  targetType: 'post' | 'comment'
  targetId: string
  reasonCode: string
  detail: string | null
  status: 'pending' | 'resolved'
  resolution: 'no_action' | 'removed' | null
  handleReason: string | null
  reporterName?: string
  createdAt: string
  handledAt?: string | null
}

/**
 * 提交举报（US-08）。
 *
 * ⚠️ 服务端**不会**因为被举报而下架内容 —— 这是需求明确冻结的规则
 * （"举报成功后进入管理端待处理列表，但不自动下架内容"）。
 * 所以调用方**不得**在举报成功后把内容从界面上拿掉。
 * 同一用户对同一目标重复举报会被服务端去重（返回同一条 pending）。
 */
export function createReport(input: {
  targetType: 'post' | 'comment'
  targetId: string
  reasonCode: string
  detail?: string
}): Promise<ApiResult<ApiReport>> {
  return request<ApiReport>('/api/reports', { method: 'POST', body: input })
}

/**
 * 活动展示态（US-04）。
 *
 * 注意这里有**两个**状态，别混：
 *   · `status`          库存态（管理员视角）：scheduled / cancelled
 *   · `effectiveStatus` 展示态（学生视角）：upcoming / ongoing / ended / cancelled
 * 展示态由**服务端按时间推导**（cancelled 为人工覆盖），前端**不得**自己按本地时间算
 * —— 客户端时钟可能与服务端不一致，那会让"进行中"变成假象。
 */
export type ActivityEffectiveStatus = 'upcoming' | 'ongoing' | 'ended' | 'cancelled'

export interface ApiActivity {
  id: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string | null
  source: string
  /** 库存态：管理员录入口径 */
  status: 'scheduled' | 'cancelled'
  /** 展示态：学生口径（服务端推导） */
  effectiveStatus: ActivityEffectiveStatus
  place: { id: string; name: string; latitude: number | null; longitude: number | null; enabled: boolean }
  /**
   * 当前登录用户是否收藏过该活动（US-04）。
   *
   * ⚠️ 活动是**公开只读**内容：未登录也能读列表/详情，此时恒为 `false`（**不是** 401）。
   *    与帖子收藏不同 —— 帖子列表要求登录，这里不要求。
   */
  favoritedByMe: boolean
  /**
   * 收藏总数（服务端权威值）。
   *
   * ⚠️ 《概要设计与详细设计文档》§2.3.1 的活动类图把 `favoriteCount` 列为 `Activity`
   *    的字段 ⇒ 接口必须返回。**是否在页面上展示由 UI 决定**（文档未规定展示位置）。
   */
  favoriteCount: number
  /**
   * ---- ACT-003 要求的四个字段（迁移 022）----
   *
   * ⚠️ `activityType` 目前**没有任何取值约束**：取值集在 ACT-002 里列为「待讨论」，
   *    所以它是自由文本，**也还没有对应的筛选功能**。
   *    不要在前端按它分组、或做筛选 UI —— 那会把一个待定项伪装成已定型的功能。
   */
  activityType: string | null
  organizer: string | null
  /** 参与方式：外部链接（仅展示，不做站内报名）。打开方式与风险提示待讨论。 */
  externalLink: string | null
  /** 封面图：**media id**（不是 URL）。用 `mediaUrl(id)` 取图；null 表示没有封面。 */
  coverImageId: string | null
}

export interface ApiPlaceActivity {
  id: string
  title: string
  startsAt: string
  endsAt: string | null
  /** 地点详情里返回的**已经是展示态**（字段名就叫 status，见 server 的地点详情契约） */
  status: ActivityEffectiveStatus
  source: string
}

/**
 * 活动列表（US-04）。
 *
 * `window` 的口径由**服务端**定义（前端不自己筛）：
 *   · `today` 今天开始/进行中的
 *   · `week`  一周内开始/进行中的
 *   · 缺省    近期活动 = 未结束的 + 刚结束（7 天内）的 + 近期取消的
 * ⇒ 所以"已结束超 7 天"的活动**按设计不出现在默认列表里**，这不是漏数据。
 */
export function listActivities(
  window?: 'today' | 'week',
): Promise<ApiResult<ApiActivity[]>> {
  const q = window ? `?window=${window}` : ''
  return request<{ items: ApiActivity[] }>(`/api/activities${q}`).then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/** 活动详情（US-04：标题/时间/地点/来源/状态必须与列表一致） */
export function getActivity(id: string): Promise<ApiResult<ApiActivity>> {
  return request<ApiActivity>(`/api/activities/${encodeURIComponent(id)}`)
}

// ---- 活动收藏（US-04）。与下面的帖子收藏**对称**，但服务端是独立的表 ----

/** 收藏一个活动（US-04）。服务端幂等：重复收藏不重复计数 */
export function favoriteActivity(activityId: string): Promise<ApiResult<FavoriteResult>> {
  return request<FavoriteResult>(`/api/activities/${encodeURIComponent(activityId)}/favorite`, {
    method: 'POST',
    body: {},
  })
}

/** 取消收藏活动（US-04：收藏可撤销） */
export function unfavoriteActivity(activityId: string): Promise<ApiResult<FavoriteResult>> {
  return request<FavoriteResult>(`/api/activities/${encodeURIComponent(activityId)}/favorite`, {
    method: 'DELETE',
  })
}

/**
 * 我的活动收藏（US-04）。
 *
 * ⚠️ 与 `listMyFavorites`（帖子）**有意不同**：这里**不做**失效过滤。
 *    活动状态是服务端按时间推导的，大量活动会自然「已结束」；收藏了却在列表里
 *    找不到才是真的坏体验。⇒ 已结束/已取消的活动**保留**，由前端按 `effectiveStatus`
 *    标状态徽标。（帖子那边相反：下架内容必须退出各展示入口，见 US-08。）
 */
export function listMyActivityFavorites(): Promise<ApiResult<ApiActivity[]>> {
  return request<{ items: ApiActivity[] }>('/api/me/activity-favorites').then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

// ---------------------------------------------------------------------------
// F07：管理端（role='admin' 才可用；非管理员服务端一律 403，前端隐藏入口只是 UI）
// ---------------------------------------------------------------------------

/** 管理员：待处理/已处理举报列表 */
export function adminListReports(
  status: 'pending' | 'resolved' = 'pending',
): Promise<ApiResult<ApiReport[]>> {
  return request<{ items: ApiReport[] }>(`/api/admin/reports?status=${status}`).then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/**
 * 管理员：处理举报（US-08）。
 *
 * ⚠️ **reason 必填** —— 需求原文："管理员选择不处理或下架时必须记录原因"。
 *    服务端缺 reason 会 400，前端因此也必须在 UI 上强制填写（不能只靠服务端兜底，
 *    否则用户点完才被告知失败）。
 * ⚠️ resolution='removed' 会**同时**下架目标内容（帖子或评论），
 *    内容随即退出列表/详情/地点页/收藏 —— 前端必须重新拉取，不能只改本地状态。
 */
export function adminResolveReport(
  reportId: string,
  resolution: 'no_action' | 'removed',
  reason: string,
): Promise<ApiResult<{ id: string; status: string; resolution: string }>> {
  return request(`/api/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST',
    body: { resolution, reason },
  })
}

export interface ApiAdminPost {
  id: string
  author: string
  body: string
  place: string | null
  status: 'published' | 'removed'
  removedReason: string | null
  createdAt: string
}

/** 管理员：全部帖子（含已下架，用于内容管理） */
export function adminListPosts(): Promise<ApiResult<ApiAdminPost[]>> {
  return request<{ items: ApiAdminPost[] }>('/api/admin/posts').then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/** 管理员：直接下架某条帖子（绕过举报，reason 必填 —— 审计要求） */
export function adminTakedownPost(postId: string, reason: string): Promise<ApiResult<void>> {
  return request<void>(`/api/admin/posts/${encodeURIComponent(postId)}/takedown`, {
    method: 'POST',
    body: { reason },
  })
}

export interface ApiAuditEntry {
  id: string
  action: string
  targetType: string
  targetId: string | null
  reason: string | null
  createdAt: string
  /** 管理员标识（服务端 join users 得到的显示名）—— US-08「操作记录包含管理员、对象、时间和动作」 */
  actorName: string
}

/** 管理员：操作记录（US-08） */
export function adminListAuditLog(): Promise<ApiResult<ApiAuditEntry[]>> {
  return request<{ items: ApiAuditEntry[] }>('/api/admin/audit-log').then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/**
 * 管理员：地点列表（**含停用**）。
 *
 * ⚠️ 与公开的 `listPlaces` 是两个接口，别混：
 *    公开列表默认只给启用的（学生视角），管理端必须能看到停用的，
 *    否则"停用后无法再启用"（看不到它，也就没有开关可点）。
 */
export interface ApiAdminPlace {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  category: string
  enabled: boolean
  description: string | null
  history: string | null
  sortOrder: number
  /** 该地点**当前公开**的帖子数（下架的不计） */
  postCount: number
}

export function adminListPlaces(): Promise<ApiResult<ApiAdminPlace[]>> {
  return request<{ items: ApiAdminPlace[] }>('/api/admin/places').then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/** 管理员：新建地点（F02：预设地点由管理员维护，学生不能自建） */
export function adminCreatePlace(input: {
  name: string
  category: '地标' | '食堂'
  address?: string
  latitude?: number
  longitude?: number
  description?: string
  history?: string
}): Promise<ApiResult<{ id: string }>> {
  return request<{ id: string }>('/api/admin/places', { method: 'POST', body: input })
}

/**
 * 管理员：修改地点（F02）。
 *
 * ⚠️ `enabled: false` 是**停用**：该地点立即退出地图与公开列表，
 *    并且**不能再关联新帖子**（服务端发帖时强校验）—— 已有帖子仍在。
 *    这不是删除，可随时再启用。
 */
export function adminUpdatePlace(
  placeId: string,
  patch: Partial<{
    name: string
    category: '地标' | '食堂'
    address: string | null
    description: string | null
    history: string | null
    enabled: boolean
    sortOrder: number
  }>,
): Promise<ApiResult<{ id: string }>> {
  return request<{ id: string }>(`/api/admin/places/${encodeURIComponent(placeId)}`, {
    method: 'PATCH',
    body: patch,
  })
}

/** 管理员：活动列表（含已结束/更早的 —— 学生侧的"近期活动"窗口不适用于管理端） */
export function adminListActivities(): Promise<ApiResult<ApiActivity[]>> {
  return request<{ items: ApiActivity[] }>('/api/admin/activities').then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/**
 * 管理员：新建活动（F06）。
 *
 * ⚠️ 服务端**强校验**：地点必须存在**且启用**、startsAt 必须是合法 ISO 时间、
 *    给了 endsAt 就必须晚于 startsAt（US-04：「缺少必要时间或地点时不能作为正式活动发布」）。
 *    这些规则前端**不重复实现**（只做基本必填提示），以免两套判定分叉。
 */
export function adminCreateActivity(input: {
  title: string
  placeId: string
  startsAt: string
  endsAt?: string | null
  description?: string
  source?: string
  /** 022：ACT-003 新增。三个文本字段 trim 后为空会被服务端存成 null */
  activityType?: string
  organizer?: string
  externalLink?: string
  /** 022：封面 media id（先用 uploadMedia(file, 'activity') 拿到 id） */
  coverImageId?: string | null
}): Promise<ApiResult<{ id: string }>> {
  return request<{ id: string }>('/api/admin/activities', { method: 'POST', body: input })
}

/**
 * 管理员：修改活动。
 *
 * `status` 只有两个值可用：`scheduled` / `cancelled`。
 * ⚠️ 这里**没有** upcoming/ongoing/ended —— 那三个是**展示态**，由服务端按时间推导，
 *    人工只能"取消"或"恢复"。前端不得提供"把活动设成进行中"这种入口（那是假状态）。
 */
export function adminUpdateActivity(
  activityId: string,
  patch: Partial<{
    title: string
    placeId: string
    startsAt: string
    endsAt: string | null
    description: string | null
    source: string
    status: 'scheduled' | 'cancelled'
    /** 022：ACT-003 新增 */
    activityType: string | null
    organizer: string | null
    externalLink: string | null
    coverImageId: string | null
  }>,
): Promise<ApiResult<{ id: string }>> {
  return request<{ id: string }>(`/api/admin/activities/${encodeURIComponent(activityId)}`, {
    method: 'PATCH',
    body: patch,
  })
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
  /**
   * ⭐ 短信**签名名**（只在 `delivery === 'sms'` 时有值）。
   *
   * 用途：告诉用户"该等哪条短信"。
   * 背景：我们的短信走阿里云「短信认证」（PNVS），而它**只允许用系统赠送的签名**
   * （官方明确不支持自定义）⇒ 用户收到的是「【恒创联众】您的验证码为…」，
   * **看不出是我们的 App**。客户端改不了短信内容，但可以提示发送方名称，
   * 让用户知道要查收哪条短信。值由**服务端**给（不是写死），运维换签名时提示自动跟上。
   */
  sms_sender?: string | null
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

/**
 * 管理员密码登录（017）。
 *
 * ## 为什么有这条路径
 *   管理端原先唯一的凭据路径是**短信验证码**。实测踩到：线上短信通道故障
 *   （`503 sms_delivery_failed`）⇒ 谁也登不进去 ⇒ 管理端完全不可达 ——
 *   而管理端恰恰是"出事了要进去处理"的地方。
 *   ⇒ 恢复**第二条**路径（不是替换掉验证码那条；管理员两条都能用）。
 *
 * ## 安全边界（客户端这边只能做一部分，真正的判定在服务端）
 *   · 服务端**只认 role='admin'**，且对"手机号不存在 / 不是管理员 / 密码错"
 *     返回**完全相同**的 401（否则这接口就成了"哪些号是管理员"的探测器）。
 *   · 客户端因此**不得**把 401 解释成"这个号不是管理员"—— 那等于把服务端刻意
 *     抹平的信息又猜出来。这里统一提示"手机号或密码不正确"。
 *   · 没有"默认密码"、没有后门：没设过密码就是登不上（要用 admin.mjs set-password）。
 */
export async function adminLogin(phone: string, password: string): Promise<ApiResult<SessionUser>> {
  const r = await request<{ token: string; expiresAt: string; user: SessionUser }>(
    '/api/auth/admin-login',
    { method: 'POST', body: { phone, password } },
  )
  if (!r.ok) return r
  setSession({ token: r.value.token, expiresAt: r.value.expiresAt, user: r.value.user })
  return { ok: true, value: r.value.user }
}

/** 退出登录：先让服务端撤销会话，再清本地（服务端失败也要清，否则本地会一直"看起来已登录"） */export async function logout(): Promise<void> {
  try {
    await request<null>('/api/auth/logout', { method: 'POST', body: {} })
  } finally {
    clearSession()
  }
}

/** 当前用户（未登录时返回 null，不抛异常） */
export async function me(): Promise<SessionUser | null> {
  const r = await request<SessionUser>('/api/auth/me')
  if (!r.ok) return null
  /*
    ⭐ TimeMap P0：把服务端的权威字段（含 **role**）写回本地会话缓存。
    为什么必须补这一步：`role` 是 P0 才进 `GET /api/auth/me` 的，
    而本地 localStorage 里可能存着**登录时那个响应**——它可能比这次 me 更旧；
    更关键的是 MeScreen 用 `isAdmin()` 读的是**缓存**，若不同步，
    "刷新页面后管理端入口就消失"（缓存里没有 role）这类假象就会出现。
    ⚠️ 只写服务端给的值，不根据任何本地推断补 role（不猜权限）。
  */
  const u = r.value
  updateSessionUser({
    ...(u.displayName ? { displayName: u.displayName } : {}),
    ...(u.handle ? { handle: u.handle } : {}),
    phone: u.phone ?? null,
    ...(u.role ? { role: u.role } : {}),
  })
  return u
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
// 1:1 依据（原版实测，见 docs/pending/m3/MODEL-VALIDATION.md §2.7）：
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
  imageMode?: 'photo' | 'sticker'
  id: string
  author: string
  authorId: string | null
  body: string
  place: string | null
  /** ⭐ P0（F02）：地点权威 id —— 详情页据此跳地点页，而不是拿地名文本去猜 */
  placeId?: string | null
  /**
   * ⭐ M5 WO#15：地点经纬度（服务端 left join places 得到；无地点时为 null）。
   * 为什么需要：地图页按**经纬度**渲染标记（tencent / real 两个实现都是），
   * 而此前前端只有 place（地名文本）→ 拿不到坐标就无法把 mock 换成权威。
   * ⚠️ 服务端已显式 Number() 转换（pg 可能把数值以字符串返回）。
   */
  placeLat: number | null
  placeLng: number | null
  createdAt: string
  /** **含回复**的总数（原版「评论 N」的口径） */
  commentCount: number
  likeCount: number
  /** 当前会话用户是否点过赞（未登录恒 false） */
  likedByMe: boolean
  /** ⭐ P0（F05）：收藏计数与"我收藏了没" */
  favoriteCount: number
  favoritedByMe: boolean
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
  /** ⭐ P0：地点权威 id（地点详情里的帖子必然有值 —— 它们就是按 place_id 查出来的） */
  placeId: string | null
  createdAt: string
  likeCount: number
  commentCount: number
  favoriteCount: number
  likedByMe: boolean
  /** ⭐ P0（F05）：我是否收藏过这条（与 likedByMe 同型，值来自服务端） */
  favoritedByMe: boolean
  /** 公图片（只给 id 与尺寸；用 mediaUrl(id) 取图） */
  images?: ApiMediaRef[]
}

/**
 * 地点老照片（F03 / US-01）。
 *
 * ⚠️ 验收标准原文：「历史照片显示年代和来源，**年代不明时如实说明**」。
 *    因此 `yearLabel` 是**文本**而不是数字 —— 真实史料里年代常常只能写成
 *    "约1930年代""不详"，硬塞进 number 会逼着上游编一个假年份。
 */
export interface ApiPlacePhoto {
  id: string
  title: string
  /** 年代（自由文本，如「1990年代」）；不明时上游应写"年代不详" */
  yearLabel: string
  /** 来源（必须可追溯；演示素材如实标注） */
  source: string
  imageUrl: string | null
}

/**
 * 地点详情（F03；按需求 4.2 的草图重做后的契约）。
 *
 * 结构是**两层**：
 *   慢内容 —— 地点本体（简介/校史）+ 老照片
 *   近期内容 —— 该地点的活动 + 帖子（最新 | 近期热门）
 * 这样划分的原因：校史与老照片几乎不变，而帖子每天都在动；
 * 混成一个平铺结构会让调用方分不清哪些需要重新拉取。
 */
export interface ApiPlaceDetail {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  /** '地标' | '食堂'（F02：地图首页的分类筛选就是这个字段） */
  category: string
  /** 是否启用（停用地点不出现在公开列表，也不能关联新帖） */
  enabled: boolean
  /** 地点简介与校园背景（US-01） */
  description: string | null
  /** 校史；**可能为 null** —— 没有史料就如实为空，不编造（US-01） */
  history: string | null
  /** 老照片（年代 + 来源可追溯） */
  photos: ApiPlacePhoto[]
  /** 近期活动（未结束 + 7 天内结束的 + 近期取消的）；status 已是展示态 */
  activities: ApiPlaceActivity[]
  /** 帖子：默认最新；`sort=hot` 时按冻结的热度公式（近 7 天） */
  posts: ApiPlacePost[]
  postCount: number
}

/**
 * 地点详情。
 *
 * `sort` 的口径：`'latest'`（缺省，按时间倒序）/ `'hot'`（近期热门）。
 * 热度规则**冻结在服务端**（timemap.ts 头注释）：
 *   score = 点赞×2 + 有效评论×3 + 收藏×1 − max(0, 发布起小时数 − 24)
 * ⇒ 前端**不**自己算排序：同分、撤销互动、内容下架这些边界只在服务端那一份实现里统一处理。
 */
export function getPlace(
  id: string,
  sort: 'latest' | 'hot' = 'latest',
): Promise<ApiResult<ApiPlaceDetail>> {
  const q = sort === 'hot' ? '?sort=hot' : ''
  return request<ApiPlaceDetail>(`/api/places/${encodeURIComponent(id)}${q}`)
}

// ---------------------------------------------------------------------------
// 地点列表 / 搜索（M5 WO#18；审核 62 的 A2）
//
// 为什么现在才有：`PoiSearchScreen` 此前只能读 mock 的 `pois` ——
// 因为服务端**只有** `/api/places/:id`（单品）。而 PoiDetailScreen 早已走权威
// ⇒ 又是一处"同一实体两种来源"。
//
// ⭐ `postCount` 的语义（与校园圈的 `campusCircleCount` **不同**，别混）：
//     `posts.place_id` 是**直接外键** ⇒ 归属已存在且权威 ⇒ COUNT 即真值，**不是 null**。
//     campusCircleCount 之所以必须 null，是因为 `posts.school_campus_id` 全空、
//     根本不知道帖子属于哪个校区 —— 那是"归属缺失"，这是"归属存在"。
//
// ⚠️ `distance` **不在**这个返回里：它依赖**用户当前位置**（客户端才知道）。
//    服务端不猜距离；客户端有定位才算，没定位就不渲染（不编造）。
// ---------------------------------------------------------------------------

export interface ApiPlaceListItem {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  /** ⭐ P0（F02）：'地标' | '食堂' —— 地图首页的分类筛选依据 */
  category: string
  /** ⭐ P0（F02）：是否启用。公开列表默认只含启用的（服务端过滤） */
  enabled: boolean
  /** 真实计数（直接外键，无需推断）；**不是** null 语义 */
  postCount: number
}

/**
 * 地点列表（F02：地图首页的权威数据源）。
 *
 * ⚠️ 服务端**默认只返回启用地点**；`category` 过滤也在服务端做
 *    （沿用 WO#12 纪律：不用客户端 filter —— 一旦加 limit，客户端筛会静默变成"不完整"）。
 * ⚠️ `q` 与 `category` 可以同时用（服务端把条件 and 起来）。
 */
export async function listPlaces(
  q?: string,
  category?: '地标' | '食堂',
): Promise<ApiResult<ApiPlaceListItem[]>> {
  const params = new URLSearchParams()
  if (q && q.trim()) params.set('q', q.trim())
  if (category) params.set('category', category)
  const qs = params.toString()
  const r = await request<{ items: ApiPlaceListItem[] }>('/api/places' + (qs ? `?${qs}` : ''))
  if (!r.ok) return r
  return { ok: true, value: r.value.items ?? [] }
}

// ---------------------------------------------------------------------------
// 学校 / 校区（M5 WO#16 层 B；审核 61 批准）
//
// ⭐ `campusCircleCount` 的语义（审核 60 的计数策略 A，**最容易搞错的一处**）：
//     `number` = 由**权威归属**算出的该校园圈动态数
//     `null`   = **无法由权威归属计算** —— ⚠️ **不是 0**！
//   为什么要区分：0 会被读成"这个校区确实没有动态"，
//   而 null 表示"我们还不知道"。审核 60 明确要求不得把两者混为一谈，
//   也**不得**用 `posts.place_id → places.name` 去推（place 只是地理 POI）。
//   ⇒ UI 侧规则：`null` 时**不渲染计数字段**（而不是显示"0条校园圈"）。
// ---------------------------------------------------------------------------

export interface ApiSchool {
  id: string
  name: string
}

export interface ApiCampus {
  id: string
  name: string
  /** 见上方语义说明：null = 无法由权威归属计算，**不是 0** */
  campusCircleCount: number | null
}

export interface ApiSchoolCampuses {
  schoolId: string
  items: ApiCampus[]
  /**
   * ⭐ 归属**覆盖完整性**（审核 62 收紧；WO#16 closeout）
   *   true  ⇔ **该有归属的帖子全部都有** school_campus_id ⇒ 此时 campusCircleCount 才可信
   *   false ⇔ 覆盖不完整 ⇒ **所有 campusCircleCount 都是 null**
   * ⚠️ 改名原因（审核 62）：原 `attributionEstablished` 容易被读成
   *   "存在任何归属"，而正确的条件是"**归属覆盖完整**" ——
   *   4 条帖子里只有 1 条有归属时，另两个校区**不能**给出 0。
   */
  attributionCoverageComplete: boolean
  /** 诊断用：覆盖率分子/分母（让"为什么是 null"可被机械核对） */
  coverage?: { totalRelevantPosts: number; attributedPosts: number }
}

/** 学校列表（只读）。目前只有 1 所（种子），这是**数据驱动的差异**，不是实现缺陷。 */
export async function listSchools(): Promise<ApiResult<ApiSchool[]>> {
  const r = await request<{ items: ApiSchool[] }>('/api/schools')
  if (!r.ok) return r
  return { ok: true, value: r.value.items }
}

/** 某学校下的校区（只读）。`campusCircleCount` 的 null 语义见上方注释。 */
export async function listSchoolCampuses(schoolId: string): Promise<ApiResult<ApiSchoolCampuses>> {
  return request<ApiSchoolCampuses>('/api/schools/' + encodeURIComponent(schoolId) + '/campuses')
}

export interface ApiCollege {
  id: string
  name: string
}

/**
 * 某学校下的**学院**列表（只读）—— F-004/F-006（审核 67 批准为「一个非常小的 closeout」）。
 *
 * ⚠️ **证据限度（必须随用法一起理解，不夸大）**：
 *   5 条学院名**逐字**来自 Round 319 对原版认证页「所在学院」picker 的**只读 dump**
 *   （`tools/tmp/orig-v4.xml`，可复算），**不是我编的**；
 *   但该 dump 是**观察到的子集**（面板在真机上可能可滚动）
 *   ⇒ 服务端返回 `completeness: 'OBSERVED_SUBSET'` 与 `originalCollegeListComplete: false`
 *   ⇒ **不得**声称它是完整学院表（`ORIGINAL_COLLEGE_LIST_COMPLETE: NOT_EVALUATED`）。
 *
 * ⚠️ **不**提供"专业"列表：F-005 明确 `NOT_EVALUATED`（点「就读专业」无可见反应，
 *   合理假设是"专业依赖已选学院"，但**未验证**）⇒ 不编造。
 */
export async function listSchoolColleges(schoolId: string): Promise<ApiResult<ApiCollege[]>> {
  const r = await request<{
    items: ApiCollege[]
    completeness?: string
    originalCollegeListComplete?: boolean
    note?: string
  }>('/api/schools/' + encodeURIComponent(schoolId) + '/colleges')
  if (!r.ok) return r
  return { ok: true, value: r.value.items }
}

/**
 * ⭐ WO#23（Owner 裁定 ③）：**真实的**发布清单（供"检查更新"用）。
 *
 * ⚠️ 这是"真检查、真比较"，但**不等于**与原版一致：
 *   原版「立即更新」的真实去向**未观察**（点它可能触发真实下载 ⇒ 只读约束下
 *   BLOCKED_BY_POLICY）⇒ `ORIGINAL_UPDATE_FLOW: NOT_EVALUATED`。
 *
 * ⚠️ `apkUrl` **可能为 null** = 我们**没有**托管安装包 ⇒ 调用方必须**如实说明**，
 *    **不得**编造链接、也不得显示"更新成功"。
 */
export interface ApiAppRelease {
  configured: boolean
  reason?: string
  latestVersion?: string
  apkUrl?: string | null
  notes?: string | null
  updatedAt?: string
}

export function getAppRelease(): Promise<ApiResult<ApiAppRelease>> {
  return request<ApiAppRelease>('/api/app/release')
}

/**
 * 比较版本号（`1.10` > `1.9` —— 逐段数值比较，**不**按字符串比）。
 * ⚠️ 只处理数字点分（我们自己的版本就是这样）；遇到非数字段按 0 处理并**不抛错**。
 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((x) => Number.parseInt(x, 10) || 0)
  const pb = String(b).split('.').map((x) => Number.parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
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
