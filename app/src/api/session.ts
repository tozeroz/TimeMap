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
  /** M3 起身份是手机号（E.164）；M2 的 handle+password 已退休 */
  phone?: string | null
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

/**
 * 把**服务端刚返回的**用户字段同步回本地会话缓存（M5 WO#14，审核记录 55/56 批准的"窄函数"）。
 *
 * ## 为什么必须补它（这是一个与 mock 无关的**独立**缺陷）
 *   `getSession()` 有**模块级 cache**，各页面普遍用
 *   `useState(() => getSession())` **只在挂载时读一次**。
 *   而 WO#13 的 `PATCH /api/users/me` 成功后，**没有任何代码把新 displayName 写回缓存**。
 *   实测现象：改昵称前 `cachedName == serverName == "Lemy"`（本来是同步的）；
 *   改完回「我的」页，登录行**仍显示 Lemy**（旧缓存），而服务端已是新值。
 *   ⇒ 即使把中心名字接上权威来源，只要不修这里，登录行仍会滞后。
 *
 * ## 为什么是"窄函数"而不是全局状态 / 事件总线
 *   审核 55 明确要求补一个**窄函数**。理由：本仓库的规模与耦合度不需要发布订阅机制，
 *   引入它只会增加"什么时候会刷新"的隐式时序。这里只做一件事：
 *   **用调用方给的、来自服务端的权威字段，覆盖当前会话里的用户对象**。
 *
 * ## 边界（不夸大）
 *   · 它**不**发请求、**不**校验、**不**处理过期 —— 纯本地写入。
 *   · 调用方**必须**传入服务端返回值，**不得**传入用户输入（否则又变成"假成功"）。
 *   · 无会话时**什么都不做**（不凭空造一个会话）。
 *   · 只覆盖显式给出的字段；其余字段（token/expiresAt/handle/phone）原样保留。
 */
export function updateSessionUser(patch: Partial<Pick<SessionUser, 'displayName' | 'handle' | 'phone'>>): void {
  const s = getSession()
  if (!s) return
  setSession({ ...s, user: { ...s.user, ...patch } })
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
