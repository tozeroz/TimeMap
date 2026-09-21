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
