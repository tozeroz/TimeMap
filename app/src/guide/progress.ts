/**
 * 首次注册用户引导（六步 onboarding）的进度存档。
 *
 * 设计约束（来源：`docs/public/product/首次注册用户引导流程.md` §2）
 *  · **按用户存**：一台设备上换账号，新账号要能自己看到引导 —— 所以 key 带 userId，
 *    而不是一个全局的 `guideDone` 布尔。
 *  · **老账号不弹**：上线前就存在的账号（本地库里没有这条存档、也没有"刚注册"标记）
 *    一律视为已完成，避免全量用户被弹一遍。
 *    ⚠️ 本轮不上线，所以「老账号」的判定实际落在本地：只有登录响应里
 *       `isNewUser` 为 true 的账号会被写成 `pending`。
 *  · **可中断恢复**：每步推进都落盘（`status: 'active'` + `step`），
 *    刷新/切后台回来能接着走。
 *  · **只存三类事实**：状态、走到第几步、更新时间。引导过程里用户填了什么、
 *    点了什么一律不入库（一期不采集）。
 */

export type GuideStatus = 'pending' | 'active' | 'done' | 'skipped'

export interface GuideProgress {
  status: GuideStatus
  /** 当前停留的步骤下标（0-based，指向 GUIDE_STEPS） */
  step: number
  /**
   * 当前步骤内停在第几条提示（0-based）。
   *
   * 首轮实测（体验报告 P3-1）：只存 step 时，刷新续播会把同一段里的提示退回第一条，
   * 用户刚看完「提示 4/9」刷新回来又看到「提示 3/9」。所以 hint 也要落盘。
   */
  hint?: number
  updatedAt: number
}

const PREFIX = 'campus.demo.guide.v1:'

/** 直出 key，供调试/测试与清缓存逻辑使用（不要在其他地方拼字符串） */
export function guideStorageKey(userId: string): string {
  return PREFIX + userId
}

function parse(raw: string | null): GuideProgress | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as GuideProgress
    if (!value || typeof value.status !== 'string') return null
    if (!['pending', 'active', 'done', 'skipped'].includes(value.status)) return null
    const step = Number.isFinite(value.step) ? Math.max(0, Math.trunc(value.step)) : 0
    const hint = Number.isFinite(value.hint) ? Math.max(0, Math.trunc(value.hint as number)) : 0
    return { status: value.status, step, hint, updatedAt: Number(value.updatedAt) || 0 }
  } catch {
    return null
  }
}

export function readGuide(userId: string): GuideProgress | null {
  if (!userId) return null
  try {
    return parse(localStorage.getItem(guideStorageKey(userId)))
  } catch {
    return null
  }
}

export function saveGuide(userId: string, progress: Omit<GuideProgress, 'updatedAt'>): GuideProgress {
  const next: GuideProgress = { ...progress, updatedAt: Date.now() }
  if (userId) {
    try {
      localStorage.setItem(guideStorageKey(userId), JSON.stringify(next))
    } catch {
      /* 存不下就当本次会话内有效：状态在内存里仍然成立，不影响引导本身 */
    }
  }
  return next
}

/**
 * 登录成功、且服务端说这是**刚创建的账号**时调用：
 * 只写 `pending`，真正的启动交给 `GuideHost`（它要等地图挂载完再弹欢迎卡）。
 */
export function markNewAccount(userId: string): void {
  saveGuide(userId, { status: 'pending', step: 0 })
}

export function clearGuide(userId: string): void {
  if (!userId) return
  try {
    localStorage.removeItem(guideStorageKey(userId))
  } catch {
    /* 忽略：清不掉也不会导致错乱，下次进来最多再弹一次 */
  }
}

/** 是否应该开始（新账号、还没开始过） */
export function shouldStartGuide(userId: string): boolean {
  return readGuide(userId)?.status === 'pending'
}

/** 是否应该在下次进入时问"继续上次的引导" */
export function shouldResumeGuide(userId: string): boolean {
  return readGuide(userId)?.status === 'active'
}

/**
 * 引导是否正处于「待开始 / 进行中」。
 *
 * 地图页用它决定要不要自动弹「授权地理位置」：那个弹窗是更高层级的模态，
 * 引导遇到它会整块让位（见 GuideHost 的 blockedByModal），新用户刚注册完
 * 第一眼就看到「引导不见了」——所以引导进行中时，定位提示延后到引导结束后的
 * 下一次进地图再问，或由用户主动点定位按钮触发。
 */
export function guideInProgress(userId: string | null | undefined): boolean {
  if (!userId) return false
  const status = readGuide(userId)?.status
  return status === 'pending' || status === 'active'
}
