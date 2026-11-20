import { createHash } from 'node:crypto'

/** Names depend only on the random post ID, never on the real user's identity.
 * Stable across refreshes and all API surfaces, independently assigned per post.
 */
export function anonymousPostName(postId: string): string {
  const digest = createHash('sha256').update(`timemap:post-alias:v1:${postId}`).digest()
  return `匿名同学·${digest.subarray(2, 5).toString('hex').toUpperCase()}`
}

/** 匿名帖对外统一显示名 */
export const ANONYMOUS_DISPLAY_NAME = '匿名同学'

/** 任何带作者字段的行都可以套这个（列表 / 详情 / 收藏 / 地点页 / 地图） */
export interface AuthorSource {
  id: string
  author_name: string
  author_id: string | null
  author_avatar_media_id?: string | null
  is_anonymous?: boolean | null
}

export interface PublicAuthor {
  /** 对外展示的作者名 */
  author: string
  /**
   * 对外暴露的作者 id：
   *   · 非匿名帖 → 真实 id（历史帖可能为 null）
   *   · 匿名帖 → **只有作者本人**拿得到，其他人一律 null
   */
  authorId: string | null
  authorAvatarMediaId: string | null
  /** 是否匿名（客户端据此换系统头像、显示「匿名」标、禁止跳作者主页） */
  anonymous: boolean
}

/**
 * 把一行帖子数据里的作者字段，转换成**当前浏览者**应该看到的样子。
 *
 * @param row  至少要含 author_name / author_id（可选 is_anonymous）
 * @param meId 当前会话用户 id；未登录为 null
 */
export function publicAuthor(row: AuthorSource, meId: string | null): PublicAuthor {
  const anonymous = row.is_anonymous === true
  if (!anonymous) {
    return { author: row.author_name, authorId: row.author_id, authorAvatarMediaId: row.author_avatar_media_id ?? null, anonymous: false }
  }
  const mine = Boolean(meId && row.author_id && row.author_id === meId)
  return {
    author: anonymousPostName(row.id),
    authorId: mine ? row.author_id : null,
    authorAvatarMediaId: null,
    anonymous: true,
  }
}
