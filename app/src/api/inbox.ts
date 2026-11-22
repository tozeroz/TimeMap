import { request } from './client'
export type InboxCategory = 'likes' | 'favorites' | 'comments'
export interface InboxEvent {
  id: string; category: InboxCategory; actor: string; avatarMediaId: string | null
  postId: string | null; threadId: string | null; threadKind?: 'direct' | 'group' | null; action: string; preview: string; createdAt: string; unread: boolean
}
export interface AppAnnouncement { id: string; title: string; body: string; createdAt: string; unread: boolean }
export interface Inbox {
  through: string; counts: Record<InboxCategory, number>; items: InboxEvent[]; announcements: AppAnnouncement[]
  threads: { id: string; avatarMediaId: string | null; unreadCount: number }[]
}
export const getInbox = () => request<Inbox>('/api/inbox')
export const markInboxRead = (scope: string, through: string) => request<{ ok: true }>('/api/inbox/read', { method: 'POST', body: { scope, through } })
export const publishAnnouncement = (title: string, body: string) => request<{ id: string }>('/api/admin/announcements', { method: 'POST', body: { title, body } })
