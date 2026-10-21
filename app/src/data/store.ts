import { type FeedPost, type User } from './types'
import { avatarFor } from '../api/client'
import { getSession } from '../api/session'

/**
 * 本地帖子库（真实发帖的存储层）。
 *
 * 两条数据来源，各管一段：
 * - **本地（localStorage）**：保证离线也能看到自己刚发的帖子。
 * - **服务器**：M1 起后端是权威副本；刷新/清缓存后帖子还在，说明真的落了库。
 *
 * 信息流拼接顺序：本地未同步的 → 服务器返回的 → 预置 mock。
 * 一条帖子如果在服务器上已经有了，就不再显示本地那份（否则会出现两张一样的卡）。
 *
 * 为什么用一张单独的"关联表"（localId → serverId）而不是往 FeedPost 上加字段：
 * FeedPost 是 26 个页面共用的类型，为了同步状态去动它属于扩大改动面；
 * 同步关系是存储层的私事，关在这里最合适（localStorage 里单独存一份，重启后仍能去重）。
 */
const KEY = 'campus.demo.myPosts.v1'
const LINK_KEY = 'campus.demo.postLinks.v1'
const MAX_POSTS = 30

type Listener = () => void
const listeners = new Set<Listener>()

/** 服务器帖子缓存（内存即可：每次进校园页都会重新拉一遍） */
let serverPosts: FeedPost[] = []

/** 本地帖 id → 服务器帖 id */
let links: Record<string, string> | null = null

function notify() {
  listeners.forEach((l) => l())
}

function readLinks(): Record<string, string> {
  if (links === null) {
    try {
      const raw = localStorage.getItem(LINK_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      links = parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
    } catch {
      links = {}
    }
  }
  return links
}

function writeLinks(next: Record<string, string>) {
  links = next
  try {
    localStorage.setItem(LINK_KEY, JSON.stringify(next))
  } catch {
    // 存不进去也不致命：只影响重启后的去重，不影响帖子本身
    console.warn('localStorage 写入同步关联表失败')
  }
}

function safeParse(raw: string | null): FeedPost[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as FeedPost[]) : []
  } catch {
    return []
  }
}

let cache: FeedPost[] | null = null

function read(): FeedPost[] {
  if (cache === null) cache = safeParse(localStorage.getItem(KEY))
  return cache
}

function write(posts: FeedPost[]) {
  cache = posts
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(posts))
      notify()
      return
    } catch {
      // 配额不足：丢掉最旧的几条再试
      if (posts.length <= 1) {
        console.warn('localStorage 配额不足，帖子未能持久化')
        notify()
        return
      }
      posts = posts.slice(0, Math.max(1, posts.length - 1))
      cache = posts
    }
  }
  notify()
}

export function getMyPosts(): FeedPost[] {
  return read()
}

/** 新发的帖子排在前面 */
export function addMyPost(input: {
  text: string
  images: string[]
  place?: string
  ratio?: string
}): FeedPost {
  /*
    ⭐⭐ Round 319（最终 audit 第 ② 问）：这里原来写 `author: me` ——
       而 `me` 是 mock 里的**编造用户**（id 'u_me'、name '自定义名称6'）。
       后果：用户发布后**本地那份**帖子的作者被写成**另一个身份**，
       而随后同步成功的**服务端**版本用的是真实作者 ⇒ 同一帖两种作者。
    ⇒ 现在取**会话身份**（与 `toFeedPost` 的约定一致：`u:<userId>` + displayName + avatarFor）。
      ⚠️ 未登录时**不编造**真实姓名，而给一个**如实标注状态**的占位身份
         （本地草稿仍可保存；服务端那份要登录才会存在）。
  */
  const s = getSession()
  const author: User = s
    ? { id: `u:${s.user.id}`, name: s.user.displayName, avatar: avatarFor(s.user.displayName) }
    : { id: 'local:anonymous', name: '未登录', avatar: avatarFor('未登录') }
  const post: FeedPost = {
    id: `mine-${Date.now()}`,
    author,
    text: input.text.trim() || '分享了图片',
    images: input.images,
    ratio: input.ratio ?? (input.images.length > 0 ? '3 / 4' : undefined),
    likes: 0,
    comments: 0,
    liked: false,
    location: input.place || undefined,
    createdAt: '刚刚',
  }
  const next = [post, ...read()].slice(0, MAX_POSTS)
  write(next)
  return post
}

export function removeMyPost(id: string) {
  write(read().filter((p) => p.id !== id))
}

export function clearMyPosts() {
  write([])
}

export function subscribeMyPosts(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 信息流 = 本地未同步的 + 服务器返回的 + 预置 mock */
export function feedWithMine(mocks: FeedPost[]): FeedPost[] {
  const serverIds = new Set(serverPosts.map((p) => p.id))
  const map = readLinks()
  // 服务器上已经有这条了，就不再重复显示本地那份
  const localOnly = read().filter((p) => {
    const sid = map[p.id]
    return !sid || !serverIds.has(sid)
  })
  return [...localOnly, ...serverPosts, ...mocks]
}

/**
 * **权威信息流**：本地待同步的 + 服务器返回的 —— **不含 mock**。
 *
 * 为什么单独有一个函数（M3 Slice 1，审核记录 07 的降级边界）：
 *   "已迁移页面：正常在线状态 API = authoritative source；
 *    离线降级最多允许 last successful API snapshot/cache；
 *    不能 API 失败 → 塞一份 synthetic mock → UI 看起来仍然像在线成功。"
 *
 * 校园页已经迁到真实 API，所以在线时不能再把 mock 混进来 —— 否则会出现"双真源"：
 * 同一个列表里既有真实数据又有假数据，且用户无法分辨。
 * 未迁移的页面继续用 feedWithMine（mock 允许存在），迁移完一页就换一页。
 */
export function feedAuthoritative(): FeedPost[] {
  const serverIds = new Set(serverPosts.map((p) => p.id))
  const map = readLinks()
  const localOnly = read().filter((p) => {
    const sid = map[p.id]
    return !sid || !serverIds.has(sid)
  })
  return [...localOnly, ...serverPosts]
}

/** 按 id 找帖子（本地 → 服务器 → 预置内容） */
export function findPost(id: string, mocks: FeedPost[]): FeedPost | undefined {
  return (
    read().find((p) => p.id === id) ??
    serverPosts.find((p) => p.id === id) ??
    mocks.find((p) => p.id === id)
  )
}

// ---------------------------------------------------------------------------
// 服务器帖子（M1）
// ---------------------------------------------------------------------------

/** 用服务器返回的列表替换缓存。传 [] 表示"拉到了，但库是空的"。 */
export function setServerPosts(list: FeedPost[]) {
  serverPosts = list
  notify()
}

export function getServerPosts(): FeedPost[] {
  return serverPosts
}

/**
 * 刚发成功的帖子直接插到最前面。
 * 为什么要这样做：发完立刻返回校园页时，网络往返可能还没让列表更新，
 * 不这样做会出现"我发的帖子凭空消失一会儿"的错觉。
 */
export function addServerPost(post: FeedPost) {
  if (serverPosts.some((p) => p.id === post.id)) return
  serverPosts = [post, ...serverPosts]
  notify()
}

/** 本地帖子同步成功：记下服务器 id，之后由服务器那份作为权威副本 */
export function markPostSynced(localId: string, serverId: string) {
  writeLinks({ ...readLinks(), [localId]: serverId })
  notify()
}

/**
 * 是不是我发的帖子（本地发过，或服务器上**作者 id 是我**的那份）。
 *
 * ⭐⭐ Round 319：原来判据是 `fromServer.author.name === me.name` ——
 *   拿 **mock 里那个编造用户的名字**去比。两个错：
 *     ① 名字不是身份（同名会误判；改名会漏判）
 *     ② `me.name` 根本不是"我"（它是 mock 的 '自定义名称6'，与我们种子用户无关）
 *   ⇒ 改为**按 id 比**，且用**会话身份**。id 约定与 `toFeedPost` 一致（`u:<userId>`）。
 */
export function isMyPost(id: string): boolean {
  if (read().some((p) => p.id === id)) return true
  const s = getSession()
  if (!s) return false
  const fromServer = serverPosts.find((p) => p.id === id)
  return fromServer ? fromServer.author.id === `u:${s.user.id}` : false
}

// ---------------------------------------------------------------------------
// 本地遗留帖（旧版本的"仅本机"记录）
// ---------------------------------------------------------------------------

/**
 * 旧版本发帖生成的本机 id 前缀（`app/src/data/store.ts` 的 `addMyPost`）。
 *
 * ⚠️ 为什么现在还要认它：这些记录**没有**服务器身份，但一直留在用户的
 *    localStorage 里，并被 `feedAuthoritative()` 拼进信息流最前面。
 *    点开时详情页拿 `mine-…` 去请求 `/api/posts/<id>`，服务端回 400 invalid_id
 *    （它不是 UUID）⇒ 用户看到「网络错误」。所以必须能识别出来单独处理。
 */
export const LOCAL_POST_PREFIX = 'mine-'

export function isLocalPostId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_POST_PREFIX)
}

/** 按 id 在**本地库**里找（只查本机记录，不碰服务器缓存）。 */
export function findLocalPost(id: string): FeedPost | undefined {
  if (!isLocalPostId(id)) return undefined
  return read().find((p) => p.id === id)
}

/** 「重新发布」的交接键：详情页/卡片把文字与地标名交给发布页（URL 放不下长文本）。 */
const REPUBLISH_KEY = 'campus.demo.republish.v1'

export function stashRepublish(input: { text: string; placeName?: string }) {
  try {
    localStorage.setItem(
      REPUBLISH_KEY,
      JSON.stringify({ text: input.text, placeName: input.placeName ?? '', at: Date.now() }),
    )
  } catch {
    // 存不进去只影响"预填"，用户可以手打；不当作失败弹窗
  }
}

export function takeRepublish(): { text: string; placeName: string } | null {
  try {
    const raw = localStorage.getItem(REPUBLISH_KEY)
    if (!raw) return null
    localStorage.removeItem(REPUBLISH_KEY)
    const parsed = JSON.parse(raw) as { text?: string; placeName?: string }
    return { text: typeof parsed.text === 'string' ? parsed.text : '', placeName: parsed.placeName ?? '' }
  } catch {
    return null
  }
}

/** 快照键前缀（`app/src/api/client.ts` 的 `SNAPSHOT_PREFIX`，这里只按前缀清理） */
const SNAPSHOT_PREFIX = 'campus.demo.snapshot.v1'

export interface CacheClearResult {
  /** 清掉的本机遗留帖条数 */
  posts: number
  /** 清掉的接口快照条数 */
  snapshots: number
}

/**
 * 清除"本机缓存"：遗留帖 + 帖子同步关联 + 全部接口快照。
 *
 * ⚠️ 刻意**不清**会话（`campus.demo.session.v1`）与地图视图（`campus.demo.mapView.v1`）：
 *    前者会导致用户意外掉线，后者是用户的浏览偏好，都不属于"缓存"。
 */
export function clearLocalCaches(): CacheClearResult {
  const posts = read().length
  let snapshots = 0
  try {
    const doomed: string[] = [KEY, LINK_KEY, REPUBLISH_KEY]
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(SNAPSHOT_PREFIX)) doomed.push(k)
    }
    for (const k of new Set(doomed)) {
      if (k.startsWith(SNAPSHOT_PREFIX) && localStorage.getItem(k) !== null) snapshots++
      localStorage.removeItem(k)
    }
  } catch {
    // 存储不可用时就当作没有缓存可清
  }
  cache = []
  links = {}
  serverPosts = []
  notify()
  return { posts, snapshots }
}
