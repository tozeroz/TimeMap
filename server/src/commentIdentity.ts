import { anonymousPostName } from './anonymous.ts'

/** Only public comment data leaves this function; aliases never contain user IDs. */
export interface CommentIdentitySource {
  post_id?: string
  author_id: string | null
  author_avatar_media_id?: string | null
  author_name: string
  is_anonymous: boolean
  post_anonymous: boolean
  post_author_id: string | null
  anonymous_number: number | null
}

export function publicCommentIdentity(row: CommentIdentitySource, meId: string | null) {
  const isPostAuthor = row.author_id !== null && row.author_id === row.post_author_id
  const anonymous = row.is_anonymous || (row.post_anonymous && isPostAuthor)
  return {
    author: anonymous
      ? isPostAuthor ? row.post_anonymous && row.post_id ? anonymousPostName(row.post_id) : '匿名楼主' : row.anonymous_number ? `匿名同学 ${String(row.anonymous_number).padStart(2, '0')}` : '匿名同学'
      : row.author_name,
    authorId: anonymous ? null : row.author_id,
    authorAvatarMediaId: anonymous ? null : row.author_avatar_media_id ?? null,
    anonymous,
    isPostAuthor,
    isMine: Boolean(meId && row.author_id === meId),
  }
}
