/**
 * BJTU TimeMap 本地状态库（localStorage 持久化）。
 *
 * 业务规则来源（验收标准编号见两份需求文档）：
 * - 帖子/评论直接发布，举报 + 事后下架机制（US-02/US-08）
 * - 点赞/收藏基于状态翻转，重复请求不重复计数（US-03）
 * - 删除仅限本人内容；删除的评论不计入有效评论量（US-02/US-03）
 * - 下架内容同步退出地图、地点列表与个人足迹入口（US-08）
 * - 管理端操作（不处理/下架/停用地点/活动维护）必须记录原因与操作记录（US-08）
 * - 热度公式冻结：点赞×2 + 评论×3 + 收藏×1 − 发布后每 6 小时衰减 1 分（初稿 5.2）
 */
import {
  CATEGORY_COLOR,
  activityStatus,
  defaultMe,
  seedActivities,
  seedComments,
  seedPlaces,
  seedPosts,
  seedUsers,
  type AdminOp,
  type CampusPlace,
  type PlaceMapMarker,
  type TmActivity,
  type TmComment,
  type TmPost,
  type TmReport,
  type TmUser,
} from './timemap'

const KEY = 'tm.state.v1'

export type SortMode = 'latest' | 'hot'

export interface TmSession {
  loggedIn: boolean
  role: 'student' | 'admin'
  profile: TmUser
  loginAt: number
}

interface TmState {
  v: 1
  session: TmSession | null
  posts: TmPost[]
  comments: TmComment[]
  reports: TmReport[]
  ops: AdminOp[]
  disabledPlaces: string[]
  cancelledActivities: string[]
  addedActivities: TmActivity[]
}

function initialState(): TmState {
  return {
    v: 1,
    session: null,
    posts: seedPosts.map((p) => ({ ...p, images: [...p.images], tags: [...p.tags] })),
    comments: seedComments.map((c) => ({ ...c })),
    reports: [],
    ops: [],
    disabledPlaces: [],
    cancelledActivities: [],
    addedActivities: [],
  }
}

function safeParse(raw: string | null): TmState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as TmState
    if (parsed && parsed.v === 1 && Array.isArray(parsed.posts)) return parsed
    return null
  } catch {
    return null
  }
}

let state: TmState = safeParse(localStorage.getItem(KEY)) ?? initialState()
const listeners = new Set<() => void>()

/**
 * 快照版本号。
 *
 * 为什么需要它：useSyncExternalStore 靠「快照引用是否变化」判断要不要重渲染。
 * 本 store 的多数 mutate 是就地改 state 的字段（state.posts.push(...) 之类），
 * 顶层对象引用不变 → React 认为什么都没发生 → 点赞/评论/登录后界面不刷新。
 * 用一个单调递增的版本号做快照，天然满足「变了才换引用」的契约，
 * 也不必要求每个 mutate 分支都记得返回新对象。
 */
let version = 0

function persist() {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
      break
    } catch {
      // 配额不足：丢弃最旧的自发帖再试（保登录态与管理记录）
      if (state.posts.length <= seedPosts.length) break
      state.posts = state.posts.slice(0, state.posts.length - 1)
    }
  }
  version += 1
  listeners.forEach((l) => l())
}

function mutate(fn: (s: TmState) => TmState | void) {
  const next = fn(state) ?? state
  state = next
  persist()
}

export function subscribeTm(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 给 useSyncExternalStore 用的快照：变更时引用必变 */
export function getTmVersion(): number {
  return version
}

export function getTmState(): TmState {
  return state
}

/* ============================== 会话（F01 账号资料） ============================== */

/** 演示用邀请码：控制试用范围，不采集手机号/密码/身份证（合规要求） */
export const INVITE_STUDENT = 'BJTU2026'
export const INVITE_ADMIN = 'BJTUADMIN'

export function getSession(): TmSession | null {
  return state.session
}

export function isAdmin(): boolean {
  return state.session?.role === 'admin'
}

export function login(inviteCode: string, nickname: string): { ok: boolean; error?: string } {
  const code = inviteCode.trim().toUpperCase()
  if (code !== INVITE_STUDENT && code !== INVITE_ADMIN) {
    return { ok: false, error: '邀请码无效，请核对后重试' }
  }
  mutate((s) => {
    s.session = {
      loggedIn: true,
      role: code === INVITE_ADMIN ? 'admin' : 'student',
      profile: { ...defaultMe, name: nickname.trim() || '交大同学' },
      loginAt: Date.now(),
    }
  })
  return { ok: true }
}

export function logout() {
  mutate((s) => {
    s.session = null
  })
}

export function updateProfile(patch: Partial<Pick<TmUser, 'name' | 'college' | 'grade' | 'bio'>>) {
  mutate((s) => {
    if (!s.session) return
    s.session = { ...s.session, profile: { ...s.session.profile, ...patch } }
  })
}

export function userById(id: string): TmUser {
  if (id === 'me') return state.session?.profile ?? defaultMe
  return seedUsers[id] ?? { id, name: '同学', avatar: '' }
}

/* ============================== 地点（F02/F03） ============================== */

export function placeEnabled(place: CampusPlace, s: TmState = state): boolean {
  return place.enabled && !s.disabledPlaces.includes(place.id)
}

export function listPlaces(): CampusPlace[] {
  return seedPlaces
}

export function getPlace(id: string): CampusPlace | undefined {
  return seedPlaces.find((p) => p.id === id)
}

export function isPlaceEnabled(id: string): boolean {
  const place = getPlace(id)
  return place ? placeEnabled(place) : false
}

/* ============================== 计数与热度（F05） ============================== */

export function likeCount(p: TmPost): number {
  return p.baseLikes + (p.likedByMe ? 1 : 0)
}

export function favoriteCount(p: TmPost): number {
  return p.baseFavorites + (p.favoritedByMe ? 1 : 0)
}

export function commentsOf(postId: string, s: TmState = state): TmComment[] {
  return s.comments.filter((c) => c.postId === postId && !c.deleted)
}

export function commentCount(postId: string): number {
  return commentsOf(postId).length
}

/** 热度（冻结规则）：点赞×2 + 评论×3 + 收藏×1 − 发布后每 6 小时 −1；同分按时间新者优先 */
export function hotScore(p: TmPost, now = Date.now()): number {
  const hours = Math.max(0, (now - p.createdAt) / (60 * 60 * 1000))
  return likeCount(p) * 2 + commentCount(p.id) * 3 + favoriteCount(p) - hours / 6
}

/** 近期热门窗口：7 天 */
export const HOT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/* ============================== 帖子查询（F03/F05） ============================== */

export function getPost(id: string): TmPost | undefined {
  return state.posts.find((p) => p.id === id)
}

/** 全部帖子（管理端内容管理用，最新在前，含已下架） */
export function postsAll(): TmPost[] {
  return [...state.posts].sort((a, b) => b.createdAt - a.createdAt)
}

export function postsForPlace(
  placeId: string,
  sort: SortMode = 'latest',
  tag?: string,
): TmPost[] {
  const now = Date.now()
  let list = state.posts.filter(
    (p) => p.placeId === placeId && p.status === 'published' && (!tag || p.tags.includes(tag)),
  )
  if (sort === 'hot') {
    list = list.filter((p) => now - p.createdAt <= HOT_WINDOW_MS)
    list = [...list].sort((a, b) => {
      const d = hotScore(b, now) - hotScore(a, now)
      return d !== 0 ? d : b.createdAt - a.createdAt || a.id.localeCompare(b.id)
    })
  } else {
    list = [...list].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  }
  return list
}

export function latestPostCover(placeId: string): TmPost | undefined {
  return postsForPlace(placeId, 'latest')[0]
}

export function placePostCount(placeId: string): number {
  return state.posts.filter((p) => p.placeId === placeId && p.status === 'published').length
}

/** 地点聚合标记（初稿 5.1：显示地点名称与帖子数，不铺开单帖） */
export function placeMarkers(filter: string): PlaceMapMarker[] {
  return seedPlaces
    .filter((p) => placeEnabled(p) && (filter === '全部' || p.category === filter))
    .map((p) => {
      const latest = latestPostCover(p.id)
      return {
        id: p.id,
        place: p.name,
        category: p.category,
        color: CATEGORY_COLOR[p.category],
        x: p.x,
        y: p.y,
        lat: p.lat,
        lng: p.lng,
        count: placePostCount(p.id),
        cover: latest?.images[0],
      }
    })
}

export function myPosts(): TmPost[] {
  const uid = state.session?.profile.id ?? 'me'
  return state.posts
    .filter((p) => p.authorId === uid)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function myFavorites(): TmPost[] {
  return state.posts
    .filter((p) => p.favoritedByMe && p.status === 'published')
    .sort((a, b) => b.createdAt - a.createdAt)
}

/* ============================== 发布（F04） ============================== */

export interface PublishInput {
  placeId: string
  text: string
  images: string[]
  tags: string[]
}

export interface PublishResult {
  ok: boolean
  error?: string
  post?: TmPost
}

let publishing = false

/**
 * 发布：地点必填且必须为启用中的预设地点；空白内容拒绝；图片失败不会进入草稿所以不会成帖；
 * submitting 标志 + 同步置位防连续点击产生重复帖子（US-02）；直接发布，无待审核状态。
 */
export function publish(input: PublishInput): PublishResult {
  if (publishing) return { ok: false, error: '正在发布中，请勿重复提交' }
  if (!state.session) return { ok: false, error: '请先登录' }
  const place = getPlace(input.placeId)
  if (!place) return { ok: false, error: '请选择关联地点' }
  if (!placeEnabled(place)) return { ok: false, error: '该地点已停用，不能再关联新帖子' }
  const text = input.text.trim()
  const images = input.images.filter(Boolean).slice(0, 3)
  if (!text && images.length === 0) return { ok: false, error: '内容不能为空白' }
  publishing = true
  try {
    const post: TmPost = {
      id: `mine-${Date.now()}`,
      authorId: state.session.profile.id,
      placeId: input.placeId,
      text,
      images,
      tags: input.tags.slice(0, 2),
      createdAt: Date.now(),
      baseLikes: 0,
      likedByMe: false,
      baseFavorites: 0,
      favoritedByMe: false,
      status: 'published',
    }
    mutate((s) => {
      s.posts = [post, ...s.posts]
    })
    return { ok: true, post }
  } finally {
    publishing = false
  }
}

/** 仅作者可删除自己的帖子（US-02）；管理员走「下架」并记录原因（US-08） */
export function deletePost(id: string): { ok: boolean; error?: string } {
  const post = getPost(id)
  if (!post) return { ok: false, error: '帖子不存在' }
  const uid = state.session?.profile.id ?? 'me'
  if (post.authorId !== uid) return { ok: false, error: '只能删除自己发布的帖子' }
  mutate((s) => {
    s.posts = s.posts.filter((p) => p.id !== id)
    s.comments = s.comments.map((c) => (c.postId === id ? { ...c, deleted: true } : c))
  })
  return { ok: true }
}

/* ============================== 互动（F05） ============================== */

/** 点赞：状态翻转语义 —— 重复请求不会重复计数 */
export function toggleLike(id: string) {
  mutate((s) => {
    const post = s.posts.find((p) => p.id === id)
    if (post && post.status === 'published') post.likedByMe = !post.likedByMe
  })
}

/** 收藏：可撤销；取消后从个人中心移除（US-03） */
export function toggleFavorite(id: string) {
  mutate((s) => {
    const post = s.posts.find((p) => p.id === id)
    if (post && post.status === 'published') post.favoritedByMe = !post.favoritedByMe
  })
}

export function addComment(postId: string, text: string): { ok: boolean; error?: string } {
  const clean = text.trim()
  if (!clean) return { ok: false, error: '评论不能为空' }
  const post = getPost(postId)
  if (!post || post.status !== 'published') return { ok: false, error: '内容不存在或已下架' }
  const uid = state.session?.profile.id ?? 'me'
  mutate((s) => {
    s.comments = [
      ...s.comments,
      { id: `tc-${Date.now()}`, postId, authorId: uid, text: clean, createdAt: Date.now() },
    ]
  })
  return { ok: true }
}

/** 仅本人可删除自己的评论；删除后不计入有效评论量（US-03） */
export function deleteComment(id: string): { ok: boolean; error?: string } {
  const c = state.comments.find((x) => x.id === id)
  if (!c) return { ok: false, error: '评论不存在' }
  const uid = state.session?.profile.id ?? 'me'
  if (c.authorId !== uid) return { ok: false, error: '只能删除自己的评论' }
  mutate((s) => {
    s.comments = s.comments.map((x) => (x.id === id ? { ...x, deleted: true } : x))
  })
  return { ok: true }
}

/* ============================== 举报与管理（F07） ============================== */

export function report(input: {
  targetType: 'post' | 'comment'
  targetId: string
  category: string
  detail?: string
}): { ok: boolean; error?: string } {
  if (!input.category) return { ok: false, error: '请选择举报分类' }
  const uid = state.session?.profile.id ?? 'me'
  mutate((s) => {
    s.reports = [
      {
        id: `r-${Date.now()}`,
        targetType: input.targetType,
        targetId: input.targetId,
        category: input.category,
        detail: input.detail?.trim() || undefined,
        reporterId: uid,
        createdAt: Date.now(),
        status: 'pending',
      },
      ...s.reports,
    ]
  })
  return { ok: true }
}

export function pendingReports(): TmReport[] {
  return state.reports.filter((r) => r.status === 'pending')
}

export function allReports(): TmReport[] {
  return state.reports
}

export function reportTargetPreview(r: TmReport): { label: string; meta: string } {
  if (r.targetType === 'post') {
    const p = getPost(r.targetId)
    return { label: p ? `帖子：${p.text.slice(0, 24) || '（图文帖）'}` : '帖子（已删除）', meta: p ? `作者 ${userById(p.authorId).name}` : '' }
  }
  const c = state.comments.find((x) => x.id === r.targetId)
  return {
    label: c ? `评论：${c.text.slice(0, 24)}` : '评论（已删除）',
    meta: c ? `作者 ${userById(c.authorId).name}` : '',
  }
}

function recordOp(
  s: TmState,
  targetType: string,
  targetLabel: string,
  action: string,
  reason?: string,
) {
  const adminName = s.session?.profile.name ?? '管理员'
  const op: AdminOp = {
    id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    adminName,
    targetType,
    targetLabel,
    action,
    reason,
    at: Date.now(),
  }
  s.ops = [op, ...s.ops]
}

function adminGuard(): { ok: boolean; error?: string } {
  if (!isAdmin()) return { ok: false, error: '无权限：仅管理员可执行该操作' }
  return { ok: true }
}

/** 举报处理：不处理或下架都必须记录原因（US-08）；举报本身不自动下架内容 */
export function resolveReport(
  reportId: string,
  action: 'noaction' | 'remove',
  reason: string,
): { ok: boolean; error?: string } {
  const guard = adminGuard()
  if (!guard.ok) return guard
  const clean = reason.trim()
  if (!clean) return { ok: false, error: '必须填写处理原因' }
  const r = state.reports.find((x) => x.id === reportId)
  if (!r || r.status !== 'pending') return { ok: false, error: '举报不存在或已处理' }
  mutate((s) => {
    const target = r.targetType === 'post' ? s.posts.find((p) => p.id === r.targetId) : undefined
    if (action === 'remove') {
      if (r.targetType === 'post') {
        if (target) target.status = 'removed'
      } else {
        s.comments = s.comments.map((c) => (c.id === r.targetId ? { ...c, deleted: true } : c))
      }
    }
    s.reports = s.reports.map((x) =>
      x.id === reportId
        ? {
            ...x,
            status: action === 'remove' ? 'removed' : 'noaction',
            handledBy: s.session?.profile.name,
            handledAt: Date.now(),
            handleReason: clean,
          }
        : x,
    )
    recordOp(
      s,
      r.targetType,
      reportTargetPreview({ ...r, status: 'pending' }).label,
      action === 'remove' ? '下架' : '不处理',
      clean,
    )
  })
  return { ok: true }
}

/** 管理员下架/恢复帖子（内容管理）；下架后退出地图、地点列表（US-08） */
export function takedownPost(id: string, reason: string): { ok: boolean; error?: string } {
  const guard = adminGuard()
  if (!guard.ok) return guard
  const clean = reason.trim()
  if (!clean) return { ok: false, error: '必须填写下架原因' }
  const post = getPost(id)
  if (!post) return { ok: false, error: '帖子不存在' }
  mutate((s) => {
    const target = s.posts.find((p) => p.id === id)
    if (target) target.status = 'removed'
    recordOp(s, 'post', `帖子：${post.text.slice(0, 24) || '（图文帖）'}`, '下架', clean)
  })
  return { ok: true }
}

export function restorePost(id: string, reason: string): { ok: boolean; error?: string } {
  const guard = adminGuard()
  if (!guard.ok) return guard
  const clean = reason.trim()
  if (!clean) return { ok: false, error: '必须填写恢复原因' }
  const post = getPost(id)
  if (!post) return { ok: false, error: '帖子不存在' }
  mutate((s) => {
    const target = s.posts.find((p) => p.id === id)
    if (target) target.status = 'published'
    recordOp(s, 'post', `帖子：${post.text.slice(0, 24) || '（图文帖）'}`, '恢复', clean)
  })
  return { ok: true }
}

export function setPlaceEnabled(placeId: string, enabled: boolean): { ok: boolean; error?: string } {
  const guard = adminGuard()
  if (!guard.ok) return guard
  const place = getPlace(placeId)
  if (!place) return { ok: false, error: '地点不存在' }
  mutate((s) => {
    s.disabledPlaces = enabled
      ? s.disabledPlaces.filter((id) => id !== placeId)
      : [...new Set([...s.disabledPlaces, placeId])]
    recordOp(s, 'place', `地点：${place.name}`, enabled ? '启用' : '停用', enabled ? '恢复关联新帖子' : '暂停关联新帖子')
  })
  return { ok: true }
}

/* ============================== 活动（F06，管理员维护） ============================== */

export function activities(): TmActivity[] {
  const all = [...seedActivities, ...state.addedActivities]
  const cancelled = new Set(state.cancelledActivities)
  const withCancel = all.map((a) => (cancelled.has(a.id) ? { ...a, cancelled: true } : a))
  const now = Date.now()
  const rank = (a: TmActivity) => {
    const st = activityStatus(a, now)
    if (st === 'ongoing') return 0
    if (st === 'upcoming') return 1
    if (st === 'ended') return 2
    return 3 // cancelled 排最后且醒目标记
  }
  return withCancel.sort((a, b) => {
    const d = rank(a) - rank(b)
    if (d !== 0) return d
    if (rank(a) <= 1) return a.startAt - b.startAt
    return b.startAt - a.startAt
  })
}

export function getActivity(id: string): TmActivity | undefined {
  return activities().find((a) => a.id === id)
}

export function activitiesForPlace(placeId: string): TmActivity[] {
  const now = Date.now()
  return activities().filter(
    (a) => a.placeId === placeId && activityStatus(a, now) !== 'ended' && !a.cancelled,
  )
}

export function addActivity(input: {
  title: string
  description: string
  placeId: string
  startAt: number
  endAt: number
  organizer: string
  source: string
}): { ok: boolean; error?: string } {
  const guard = adminGuard()
  if (!guard.ok) return guard
  if (!input.title.trim()) return { ok: false, error: '活动标题不能为空' }
  if (!getPlace(input.placeId)) return { ok: false, error: '缺少举办地点，不能发布活动' }
  if (!(input.startAt > 0) || !(input.endAt > input.startAt)) {
    return { ok: false, error: '缺少有效时间，不能发布活动' }
  }
  mutate((s) => {
    s.addedActivities = [
      {
        id: `ta-${Date.now()}`,
        title: input.title.trim(),
        description: input.description.trim(),
        placeId: input.placeId,
        startAt: input.startAt,
        endAt: input.endAt,
        organizer: input.organizer.trim() || s.session?.profile.name || '管理员',
        source: input.source.trim() || '管理员录入',
        sourceUpdatedAt: Date.now(),
      },
      ...s.addedActivities,
    ]
    recordOp(s, 'activity', `活动：${input.title.trim()}`, '新增', input.source.trim() || '管理员录入')
  })
  return { ok: true }
}

export function cancelActivity(id: string): { ok: boolean; error?: string } {
  const guard = adminGuard()
  if (!guard.ok) return guard
  const a = getActivity(id)
  if (!a) return { ok: false, error: '活动不存在' }
  mutate((s) => {
    s.cancelledActivities = [...new Set([...s.cancelledActivities, id])]
    recordOp(s, 'activity', `活动：${a.title}`, '取消', '标记为已取消并醒目提示')
  })
  return { ok: true }
}

export function adminOps(): AdminOp[] {
  return state.ops
}

export function isPlaceDisabled(placeId: string): boolean {
  return state.disabledPlaces.includes(placeId)
}

/* ============================== 调试（验收脚本用） ============================== */

export function __resetAll() {
  state = initialState()
  persist()
}
