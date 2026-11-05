/**
 * 匿名发帖（2026-11-05 用户需求）：用户在发布页可以勾选「匿名发布」，
 * 匿名帖在**所有公开展示面**统一显示为「匿名同学」+ 同一枚系统头像。
 *
 * 设计原则（为什么这样做）：
 *   1. **真实归属仍然保留在库里**（`posts.author_id` 不改），只在**读模型**里遮罩。
 *      这样管理员审核、作者本人删除/管理、举报处理都还能定位到人；
 *      而普通浏览者拿不到 `authorId`，点不进作者主页 —— 匿名才成立。
 *   2. **遮罩集中在一个函数里**，不要在十来处路由各写一遍 if ——
 *      漏一处就是"某个入口暴露真名"，那种漏洞不会有人报错，只会被截图。
 *   3. **作者本人拿到自己的 authorId**：前端据此显示「我的」能力（删除/编辑），
 *      否则作者自己也管不了自己发的匿名帖。
 *   4. 掩码名字用常量，不要在客户端拼 —— 服务端返回什么就显示什么。
 */

/** 匿名帖对外统一显示名 */
export const ANONYMOUS_DISPLAY_NAME = '匿名同学'

/** 任何带作者字段的行都可以套这个（列表 / 详情 / 收藏 / 地点页 / 地图） */
export interface AuthorSource {
  author_name: string
  author_id: string | null
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
    return { author: row.author_name, authorId: row.author_id, anonymous: false }
  }
  const mine = Boolean(meId && row.author_id && row.author_id === meId)
  return {
    author: ANONYMOUS_DISPLAY_NAME,
    authorId: mine ? row.author_id : null,
    anonymous: true,
  }
}
