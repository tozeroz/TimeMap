/**
 * 会话存放（M2）。
 *
 * 范围说明：M2 只做「**能带会话**」这一层 ——
 *   - token 的存放与读取
 *   - 请求时带上 Authorization: Bearer
 * 登录 **界面** 与页面接入属于 M3（届时把 login-sns 页接到 /api/auth/login）。
 * 现在先把这条通路铺好，M3 接 UI 时不用再改网络层。
 *
 * 为什么单独放一个文件而不塞进 client.ts：
 * client.ts 负责「怎么发请求」，这里负责「身份从哪来」；
 * M3 接入登录页时只动这个文件即可。
 *
 * 存储位置是 localStorage：与现有 store.ts 一致，且 Capacitor 里持久化没问题。
 * 注意这是**明文存放**的 bearer token —— 与当前「公网 HTTP」的传输限制是同一笔债，
 * 见 PLAN 第十一节：最小 TLS 建立后这笔债才算还清（届时可考虑换更安全的存储）。
 */

const KEY = 'campus.demo.session.v1'

export interface SessionUser {
  id: string
  handle: string
  displayName: string
}

export interface Session {
  token: string
  expiresAt: string
  user: SessionUser
}

let cache: Session | null | undefined

function parse(raw: string | null): Session | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Session
    if (!s || typeof s.token !== 'string' || !s.token) return null
    return s
  } catch {
    return null
  }
}

export function getSession(): Session | null {
  if (cache === undefined) cache = parse(localStorage.getItem(KEY))
  // 过期就当没登录（服务端也会拒，这里只是省一次往返）
  if (cache && cache.expiresAt && Date.parse(cache.expiresAt) < Date.now()) {
    clearSession()
    return null
  }
  return cache
}

export function setSession(s: Session): void {
  cache = s
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    console.warn('localStorage 写入会话失败（本次登录只在内存里有效）')
  }
}

export function clearSession(): void {
  cache = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 忽略 */
  }
}

/** 有会话就返回 Authorization 头，没有就返回空对象（请求照常发，由服务端决定 401） */
export function authHeaders(): Record<string, string> {
  const s = getSession()
  return s ? { authorization: `Bearer ${s.token}` } : {}
}

/** 当前是否已登录（仅表示本地有可用会话） */
export function isLoggedIn(): boolean {
  return getSession() !== null
}
