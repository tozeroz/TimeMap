import { me, type FeedPost } from './mock'

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
  const post: FeedPost = {
    id: `mine-${Date.now()}`,
    author: me,
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

/** 是不是我发的帖子（本地发过，或服务器上作者名是我的那份） */
export function isMyPost(id: string): boolean {
  if (read().some((p) => p.id === id)) return true
  const fromServer = serverPosts.find((p) => p.id === id)
  return fromServer ? fromServer.author.name === me.name : false
}
