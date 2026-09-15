import { me, type FeedPost } from './mock'

/**
 * 本地帖子库（真实发帖的存储层）。
 *
 * 用 localStorage 持久化：发出去的帖子在重启 app 后仍在，且排在信息流最前面。
 * 图片以压缩后的 dataURL 存，写满配额时自动丢弃最旧的帖子（保最新）。
 */
const KEY = 'campus.demo.myPosts.v1'
const MAX_POSTS = 30

type Listener = () => void
const listeners = new Set<Listener>()

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
      listeners.forEach((l) => l())
      return
    } catch {
      // 配额不足：丢掉最旧的几条再试
      if (posts.length <= 1) {
        console.warn('localStorage 配额不足，帖子未能持久化')
        listeners.forEach((l) => l())
        return
      }
      posts = posts.slice(0, Math.max(1, posts.length - 1))
      cache = posts
    }
  }
  listeners.forEach((l) => l())
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

/** 信息流 = 我的帖子 + 预置 mock 内容 */
export function feedWithMine(mocks: FeedPost[]): FeedPost[] {
  return [...read(), ...mocks]
}

/** 按 id 找帖子（先查本地发的，再查预置内容） */
export function findPost(id: string, mocks: FeedPost[]): FeedPost | undefined {
  return read().find((p) => p.id === id) ?? mocks.find((p) => p.id === id)
}

/** 是不是我发的帖子 */
export function isMyPost(id: string): boolean {
  return read().some((p) => p.id === id)
}
