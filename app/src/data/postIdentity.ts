import { getComments, getPost, readSnapshot, type ApiCommentNode, type ApiPostDetail } from '../api/client'

/**
 * ⭐⭐ 单一权威的"按 id 取动态"实现（WO#17；审核 62 要求）
 *
 * ## 为什么必须抽出这一个函数
 * 审核 62：
 * > "CommentsScreen 与 FeedDetail 使用**同一** authoritative post identity"
 * > "不再保留'一真一假'的双数据源。"
 *
 * 改前是**两套各自实现**：
 * ```
 * FeedDetailScreen：getPost(id) + getComments(id)，只回落**同一 id** 的 snapshot，无 snapshot 则如实报错
 * CommentsScreen  ：`posts.find(p => p.id === id) ?? posts[0]` + mock 的 comments
 *                   ⇒ 请求 post A、页面显示 post B —— 这是**身份篡改**（identity corruption），
 *                     不只是"显示假数据"（审核 62 的原话）
 * ```
 * ⇒ 只要还是两套实现，就**必然**再次分叉。所以身份解析只留**一处**。
 *
 * ## 状态语义（与 FeedDetailScreen 原有行为一致，未改语义）
 * ```
 * ready     ：在线取到同一 id 的动态与评论
 * offline   ：在线失败，但存在**该 id 自己**的最后一次成功快照 ⇒ 降级但仍是同一实体
 * not_found ：服务端明确说"这个 id 不存在"（404）
 * error     ：其它失败（含缺 id），带 reason
 * ```
 * ⚠️ **绝不**在 not_found / error 时返回**另一个**动态 —— 这正是被修的漏洞。
 * ⚠️ offline 只回落 `post:${id}` / `comments:${id}`，**不是**任意快照
 *    （本项目已冻结的降级边界：已迁移页面离线时最多用"最后一次成功过的 API 快照"）。
 */

export type PostResolution =
  | { state: 'ready'; post: ApiPostDetail; comments: ApiCommentNode[]; total: number; fromSnapshot: false }
  | { state: 'offline'; post: ApiPostDetail; comments: ApiCommentNode[]; total: number; fromSnapshot: true }
  | { state: 'not_found' }
  /**
   * ⭐ TimeMap P0（US-08）：内容**已被下架**（服务端 410 gone）。
   *
   * 为什么要与 not_found / error 分开：需求 4.4「内容不存在或已下架：显示状态页并提供返回入口」。
   * 下架（管理员移除或作者删除）与"从来不存在"（404）在服务端是**两个**不同的回答：
   *   · 410 ⇒ 曾经有、现在不公开（可以明确说"已下架"）
   *   · 404 ⇒ 这个 id 我们没有
   * 而两者都**不属于**网络故障 —— 改前 410 会掉进 error 分支，
   * 界面显示「网络错误」，把一个明确的业务状态说成了网络问题（误导用户重试）。
   */
  | { state: 'gone' }
  | { state: 'error'; reason: string }

/**
 * 判定"内容已被下架"。
 *
 * ⚠️ 与 isNotFound 同一纪律：优先用**结构化**的 status，字符串匹配只作后备。
 */
function isGone(r: { reason?: string; status?: number }): boolean {
  if (typeof r.status === 'number') return r.status === 410
  return /410|gone/i.test(r.reason ?? '')
}

/**
 * 判定"服务端是不是明确说这个实体不存在"。
 *
 * ⚠️ 优先用 `status === 404`，**字符串匹配只作后备** ——
 *    因为 `request()` 的 reason 形如 `HTTP 404: {"error":"not_found"}`，
 *    用正则匹配 HTTP 状态码是"靠文本碰运气"；`status` 是结构化的事实。
 *    两者都留着是因为 `request()` 的网络异常分支（超时/TypeError）**没有** status。
 */
function isNotFound(r: { reason?: string; status?: number }): boolean {
  if (typeof r.status === 'number') return r.status === 404
  return /404|not_found/i.test(r.reason ?? '')
}

/**
 * 按 id 权威地取动态 + 评论。
 *
 * ⚠️ 调用方**必须**区分 not_found 与 error：
 *    not_found ⇒ 这个动态确实不存在（可显示"内容不存在"）
 *    error     ⇒ 我们**不知道**是否存在（可显示"加载失败/重试"）
 *   两者都**不得**退化成"显示另一条动态"。
 */
export async function resolvePostAndComments(id: string): Promise<PostResolution> {
  if (!id) return { state: 'error', reason: '未指定动态（缺少 id 参数）' }

  const [pr, cr] = await Promise.all([getPost(id), getComments(id)])

  if (pr.ok && cr.ok) {
    return {
      state: 'ready',
      post: pr.value,
      comments: cr.value.items,
      total: cr.value.total,
      fromSnapshot: false,
    }
  }

  /*
    ⭐ 先判 gone / not_found：只要**服务端对这条动态本身给出了明确回答**
      （410 已下架 / 404 不存在），就**不**再考虑快照降级
      —— 否则会出现"服务端说没有这条，界面却拿旧快照显示出来"的假象。
      这正是 P0 之后最容易踩的坑：帖子被管理员下架，本地还留着它上一次成功的快照。
  */
  if (!pr.ok && isGone(pr)) return { state: 'gone' }
  if (!pr.ok && isNotFound(pr)) return { state: 'not_found' }

  // 在线失败 → 只允许降级到**该 id 自己**的最后一次成功快照
  const ps = readSnapshot<ApiPostDetail>(`post:${id}`)
  const cs = readSnapshot<{ items: ApiCommentNode[]; total: number }>(`comments:${id}`)
  if (ps && cs) {
    return {
      state: 'offline',
      post: ps.value,
      comments: cs.value.items,
      total: cs.value.total,
      fromSnapshot: true,
    }
  }

  const why = !pr.ok ? `加载失败：${pr.reason}` : !cr.ok ? `评论加载失败：${cr.reason}` : '加载失败'
  return { state: 'error', reason: why }
}
