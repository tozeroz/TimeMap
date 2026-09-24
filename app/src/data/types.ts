/**
 * 领域类型（Round 319 从 `mock.ts` **逐字**搬出）。
 *
 * ⚠️ 这里**只有类型**，没有任何数据。
 * 为什么要有这个文件：原来这些类型与**编造数据**混在同一个 `mock.ts` 里，
 * 于是"想用类型"就不得不 import 那个文件（连带假数据一起进作用域）。
 * 搬出后，"类型"与"假数据"在**物理上**分开 ⇒ 不会再顺手用到后者。
 * （依据：审核 63 的 "production code should not contain importable fabricated business data"）
 */
export interface User {
  id: string
  name: string
  avatar: string
  school?: string
  mbti?: string
  zodiac?: string
  college?: string
  major?: string
  grade?: string
}

export interface FeedPost {
  id: string
  author: User
  text: string
  images: string[]
  /** 配图宽高比（瀑布流错落感的来源；原版是不同尺寸的真实照片，这里按比例还原） */
  ratio?: string
  likes: number
  comments: number
  liked: boolean
  location?: string
  topic?: string
  createdAt: string
}

export interface Comment {
  id: string
  author: User
  text: string
  time: string
  likes: number
  replies?: Comment[]
}

export interface ChatThread {
  id: string
  peer: User
  lastMessage: string
  time: string
  unread: number
  messages: ChatMessage[]
}

export interface ChatMessage {
  id: string
  from: 'me' | 'peer'
  text: string
  time: string
}

export interface BoardNote {
  id: string
  author: User
  text: string
  time: string
  color: string
}

export interface GroupChat {
  id: string
  name: string
  memberCount: number
  notice: string
  members: User[]
  messages: ChatMessage[]
}
