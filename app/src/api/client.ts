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
    images: [],
    likes: 0,
    comments: 0,
    liked: false,
    location: p.place ?? undefined,
    // 列表卡片用相对时间；精确时间留给详情页（M2 再补）
    createdAt: relativeTime(p.createdAt),
  }
}
