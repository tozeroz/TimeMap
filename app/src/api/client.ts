import type { FeedPost, User } from '../data/mock'

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
 * 服务器地址。
 * 现在没有域名，先用「公网 IP + HTTP」；配了 `VITE_API_BASE` 就以环境变量为准。
 * - APK：WebView 里走 http://8.148.156.146（需要 allowMixedContent，见 capacitor.config.ts）
 * - 本地浏览器预览：同样可用（后端 CORS 白名单里有 127.0.0.1:517x）
 */
const DEFAULT_API_BASE = 'http://8.148.156.146'

const env = import.meta.env as unknown as Record<string, string | undefined>

export const API_BASE = (env.VITE_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '')

const TIMEOUT_MS = 8000

/** 服务端返回的帖子形状（与 server/src/index.ts 的 JSON 一一对应） */
export interface ApiPost {
  id: string
  author: string
  body: string
  place: string | null
  createdAt: string
}

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string }

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult<T>> {
  const url = `${API_BASE}${path}`
  const controller = new AbortController()
  // fetch 默认没有超时：服务器半死不活时页面会一直卡住，必须自己兜一个
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}: ${text.slice(0, 200)}` }
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

/** 取帖子列表（最新的在最前） */
export function listPosts(): Promise<ApiResult<ApiPost[]>> {
  return request<{ items: ApiPost[] }>('/api/posts').then((r) =>
    r.ok ? { ok: true as const, value: r.value.items ?? [] } : r,
  )
}

/** 发一条文本帖子 */
export function createPost(input: {
  body: string
  place?: string
  author?: string
}): Promise<ApiResult<ApiPost>> {
  return request<ApiPost>('/api/posts', { method: 'POST', body: input })
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
    id: `api:${p.author}`,
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
