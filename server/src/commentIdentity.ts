/** Only public comment data leaves this function; aliases never contain user IDs. */
export interface CommentIdentitySource {
  author_id: string | null
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
      ? isPostAuthor ? '匿名楼主' : row.anonymous_number ? `匿名同学 ${String(row.anonymous_number).padStart(2, '0')}` : '匿名同学'
      : row.author_name,
    authorId: anonymous ? null : row.author_id,
    anonymous,
    isPostAuthor,
    isMine: Boolean(meId && row.author_id === meId),
  }
}
