/**
 * 热度排序：行为驱动的「曝光份额分配」（2026-11-06，第二阶段）
 *
 * 为什么从「一个分数排队」改成「按份额组装一页」：
 *   分数排序是阈值思维 —— 分低的帖永远拿不到曝光，于是永远学不到它到底好不好。
 *   真实的推荐系统做的是资源分配：把这一页的 20 个位子按「预测点击率 × 探索需求」
 *   分给不同内容，好内容多给、没数据的给一点试试、已经证明不行的收回。
 *   方案与论证见 docs/zjx/热度排序方案-行为驱动份额分配-2026-11-06.md。
 *
 * 三段式：
 *   ① 质量门：曝光够多（≥ gateMinImpressions）且后验 CTR < gateRatio × 平台中位 CTR
 *      → 移出热门池（在「最新」「我的发布」「搜索」里照常存在，不删不隐藏）。
 *   ② 点击率估计：分层贝叶斯，CTR ~ Beta(点开 + α, 曝光 − 点开 + β)，
 *      α = k·p₀、β = k·(1−p₀)。p₀ 与 k 都来自数据/业务含义，不是拍出来的权重。
 *   ③ 份额分配：exploit 60% / explore 20% / need-data 10% / diversity 10%，
 *      exploit 用 Thompson 采样（从后验里抽一个 CTR）排序 —— 不确定的内容自然
 *      获得探索机会，不需要额外的 ε 参数。
 *
 * 为什么采样放在 Node 而不是 SQL：
 *   PostgreSQL 没有 beta 分布随机函数；候选池 ≤300 条，取回内存采样成本可忽略，
 *   也便于把「为什么排成这样」记进日志。
 *
 * 参数全部可用环境变量覆盖（灰度时不发版）：
 *   HOT_PRIOR_STRENGTH=40   HOT_PRIOR_CTR=0.12   HOT_GATE_RATIO=0.4
 *   HOT_GATE_MIN_IMPRESSIONS=30   HOT_POOL_DAYS=21   HOT_POOL_LIMIT=300
 *   HOT_AUTHOR_CAP=2   HOT_QUOTA_EXPLORE=0.2   HOT_QUOTA_NEED_DATA=0.1
 *   HOT_QUOTA_DIVERSITY=0.1   HOT_MEASURED_MIN_IMPRESSIONS=20
 */
import { randomInt } from 'node:crypto'

export interface HotCandidate {
  id: string
  authorId: string | null
  placeId: string | null
  createdAt: Date
  likeCount: number
  commentCount: number
  favoriteCount: number
  /** 最近 14 天曝光（去重后） */
  impressions: number
  /** 最近 14 天点开 */
  opens: number
}

export interface HotRankOptions {
  pageSize: number
  priorCtr: number
  priorStrength: number
  gateRatio: number
  gateMinImpressions: number
  measuredMinImpressions: number
  authorCap: number
  quotaExplore: number
  quotaNeedData: number
  quotaDiversity: number
  /** 测试注入用；默认 crypto 随机 */
  rand?: () => number
}

export interface HotRankResult {
  ordered: HotCandidate[]
  stats: {
    pool: number
    gated: number
    measured: number
    cold: number
    priorCtr: number
    /** 各配额实际拿到几个位子，出问题时先看这里 */
    filled: { exploit: number; explore: number; needData: number; diversity: number }
  }
}

function num(env: string | undefined, fallback: number): number {
  const v = Number(env)
  return Number.isFinite(v) && v >= 0 ? v : fallback
}

export function hotRankOptionsFromEnv(pageSize: number): HotRankOptions {
  const e = process.env
  return {
    pageSize,
    priorCtr: num(e.HOT_PRIOR_CTR, 0.12),
    priorStrength: num(e.HOT_PRIOR_STRENGTH, 40),
    gateRatio: num(e.HOT_GATE_RATIO, 0.4),
    gateMinImpressions: num(e.HOT_GATE_MIN_IMPRESSIONS, 30),
    measuredMinImpressions: num(e.HOT_MEASURED_MIN_IMPRESSIONS, 20),
    authorCap: Math.max(1, Math.round(num(e.HOT_AUTHOR_CAP, 2))),
    quotaExplore: num(e.HOT_QUOTA_EXPLORE, 0.2),
    quotaNeedData: num(e.HOT_QUOTA_NEED_DATA, 0.1),
    quotaDiversity: num(e.HOT_QUOTA_DIVERSITY, 0.1),
  }
}

/** 互动强度：点赞×2 + 评论×3 + 收藏×1（与「我的发布」里展示的权重一致） */
export function engagementOf(c: HotCandidate): number {
  return c.likeCount * 2 + c.commentCount * 3 + c.favoriteCount
}

/**
 * 平台先验 CTR：近 7 天全站 点开/曝光（带平滑，避免分母为 0）。
 * 数据不足（曝光 < 200）时退回配置里的兜底值 —— 宁可保守，也不要让先验被个位数样本带偏。
 */
export function priorCtrFromTotals(totalImpressions: number, totalOpens: number, fallback: number): number {
  const smoothing = 200
  if (totalImpressions + smoothing < 200) return fallback
  const p = (totalOpens + smoothing * fallback) / (totalImpressions + smoothing)
  return Math.min(0.6, Math.max(0.02, p))
}

// ---------------------------------------------------------------- 随机数与分布

/** Marsaglia–Tsang gamma 采样（shape ≥ 1），shape < 1 用提升公式 */
function sampleGamma(shape: number, rand: () => number): number {
  if (shape < 1) {
    const u = rand()
    return sampleGamma(1 + shape, rand) * Math.pow(u === 0 ? Number.MIN_VALUE : u, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x: number
    let v: number
    do {
      // Box–Muller 取标准正态
      const u1 = rand() || Number.MIN_VALUE
      const u2 = rand()
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = rand()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

/** Beta(α, β) 采样 = G(α) / (G(α) + G(β)) */
export function sampleBeta(alpha: number, beta: number, rand: () => number = Math.random): number {
  const a = Math.max(alpha, 1e-6)
  const b = Math.max(beta, 1e-6)
  const ga = sampleGamma(a, rand)
  const gb = sampleGamma(b, rand)
  return ga / (ga + gb)
}

/** 后验均值 CTR（质量门用，稳定不抖） */
export function posteriorCtr(c: HotCandidate, opts: HotRankOptions): number {
  const alpha = c.opens + opts.priorStrength * opts.priorCtr
  const beta = c.impressions - c.opens + opts.priorStrength * (1 - opts.priorCtr)
  return alpha / (alpha + Math.max(beta, 1e-6))
}

// ---------------------------------------------------------------- 份额组装

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * 把候选池组装成一页。
 *
 * 顺序规则（从高到低，四段互不重叠）：
 *   1. exploit  —— 已测量（曝光 ≥ measuredMinImpressions）里按采样 CTR 最高的若干个
 *   2. needData —— 曝光不足但互动不错（engagement ≥ 2）的，优先验证
 *   3. explore  —— 曝光不足且没什么互动的，按采样 CTR 取（天然偏保守的新帖）
 *   4. diversity—— 剩余位子，优先补「作者/地点还没出现过」的，避免整屏一个人
 *
 * 整页都受「同作者最多 authorCap 条」约束；页里不足时用剩余候选补齐（不留下空位）。
 */
export function rankHotPool(candidates: HotCandidate[], opts: HotRankOptions): HotRankResult {
  const rand = opts.rand ?? Math.random
  const pageSize = Math.max(1, opts.pageSize)

  // ① 质量门
  /*
    质量门用**原始** CTR 而不是后验：后验会把「30 次曝光 0 点击」平滑到接近平台均值
    （α/(n+α+β) 的平滑项），恰好把要挡掉的那类内容救了回来。曝光数已经够（≥ gateMin）
    时，原始比率的统计噪声可接受，这也是方案里「曝光 ≥ 30 才纳入判断」的前提。
  */
  const rawCtr = (c: HotCandidate) => (c.impressions > 0 ? c.opens / c.impressions : 0)
  const gated = candidates.filter(
    (c) => c.impressions >= opts.gateMinImpressions && rawCtr(c) < opts.gateRatio * opts.priorCtr,
  )
  const pool = candidates.filter((c) => !gated.includes(c))

  const measured = pool.filter((c) => c.impressions >= opts.measuredMinImpressions)
  const cold = pool.filter((c) => c.impressions < opts.measuredMinImpressions)

  // 采样分数：每个候选一个（同一候选在多个配额里比较时用同一个，保证一致性）
  const sampled = new Map<string, number>()
  for (const c of pool) {
    const alpha = c.opens + opts.priorStrength * opts.priorCtr
    const beta = c.impressions - c.opens + opts.priorStrength * (1 - opts.priorCtr)
    sampled.set(c.id, sampleBeta(alpha, beta, rand))
  }
  const bySample = (a: HotCandidate, b: HotCandidate) => (sampled.get(b.id) ?? 0) - (sampled.get(a.id) ?? 0)

  const picked: HotCandidate[] = []
  const used = new Set<string>()
  const perAuthor = new Map<string, number>()
  const perPlace = new Map<string, number>()
  const filled = { exploit: 0, explore: 0, needData: 0, diversity: 0 }

  const authorKey = (c: HotCandidate) => c.authorId ?? `place:${c.placeId ?? 'none'}`
  const canTake = (c: HotCandidate) =>
    !used.has(c.id) && (perAuthor.get(authorKey(c)) ?? 0) < opts.authorCap
  const take = (c: HotCandidate, bucket: keyof typeof filled) => {
    used.add(c.id)
    perAuthor.set(authorKey(c), (perAuthor.get(authorKey(c)) ?? 0) + 1)
    if (c.placeId) perPlace.set(c.placeId, (perPlace.get(c.placeId) ?? 0) + 1)
    picked.push(c)
    filled[bucket] += 1
  }

  const quota = {
    exploit: Math.max(1, Math.round(pageSize * (1 - opts.quotaExplore - opts.quotaNeedData - opts.quotaDiversity))),
    needData: Math.max(1, Math.round(pageSize * opts.quotaNeedData)),
    explore: Math.max(1, Math.round(pageSize * opts.quotaExplore)),
    diversity: Math.max(0, pageSize - Math.round(pageSize * (1 - opts.quotaExplore - opts.quotaNeedData - opts.quotaDiversity)) - Math.max(1, Math.round(pageSize * opts.quotaNeedData)) - Math.max(1, Math.round(pageSize * opts.quotaExplore))),
  }

  // 1. exploit：已测量里采样最高的
  for (const c of measured.slice().sort(bySample)) {
    if (filled.exploit >= quota.exploit || picked.length >= pageSize) break
    if (canTake(c)) take(c, 'exploit')
  }

  // 2. needData：曝光不足但互动达标（engagement ≥ 2），按互动降序
  const needCandidates = cold
    .filter((c) => engagementOf(c) >= 2)
    .sort((a, b) => engagementOf(b) - engagementOf(a) || bySample(a, b))
  for (const c of needCandidates) {
    if (filled.needData >= quota.needData || picked.length >= pageSize) break
    if (canTake(c)) take(c, 'needData')
  }

  // 3. explore：剩下的数据不足候选，洗牌后取（避免永远只有最早发的那几条被探索到）
  for (const c of shuffle(cold.filter((c) => engagementOf(c) < 2), rand)) {
    if (filled.explore >= quota.explore || picked.length >= pageSize) break
    if (canTake(c)) take(c, 'explore')
  }

  // 4. diversity：补位时优先作者/地点尚未出现过的
  const rest = pool
    .filter((c) => !used.has(c.id))
    .sort((a, b) => {
      const seenA = perAuthor.get(authorKey(a)) ?? 0
      const seenB = perAuthor.get(authorKey(b)) ?? 0
      if (seenA !== seenB) return seenA - seenB
      const placeA = a.placeId ? (perPlace.get(a.placeId) ?? 0) : 0
      const placeB = b.placeId ? (perPlace.get(b.placeId) ?? 0) : 0
      if (placeA !== placeB) return placeA - placeB
      return bySample(a, b)
    })
  for (const c of rest) {
    if (picked.length >= pageSize) break
    if (!canTake(c)) continue
    take(c, 'diversity')
  }

  // 5. 兜底补齐：先用「守作者上限」的候选把页面填满，只有确实凑不够一页时才放宽上限
  //    （放宽的候选只会出现在后面，第一屏仍然受 authorCap 约束）
  if (picked.length < pageSize) {
    for (const c of rest) {
      if (picked.length >= pageSize) break
      if (!canTake(c)) continue
      take(c, 'diversity')
    }
  }
  if (picked.length < pageSize) {
    for (const c of pool) {
      if (picked.length >= pageSize) break
      if (used.has(c.id)) continue
      used.add(c.id)
      picked.push(c)
      filled.diversity += 1
    }
  }

  return {
    ordered: picked,
    stats: {
      pool: pool.length,
      gated: gated.length,
      measured: measured.length,
      cold: cold.length,
      priorCtr: opts.priorCtr,
      filled,
    },
  }
}

/**
 * 完全冷启动（全站还没有任何曝光数据）时的降级排序：
 * 用互动强度 + 发表时间，和对外的「最新」保持可解释的差异。
 * 触发条件是 pool 里所有候选 impressions 都是 0。
 */
export function fallbackOrder(candidates: HotCandidate[]): HotCandidate[] {
  return candidates.slice().sort((a, b) => {
    const ea = engagementOf(a)
    const eb = engagementOf(b)
    if (ea !== eb) return eb - ea
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

/** 便于测试的确定性随机（seeded） */
export function seededRand(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** 用于把 crypto 随机源接进来（默认 Math.random 已足够；保留出口便于以后换） */
export function cryptoSalt(): number {
  return randomInt(1, 2147483646)
}

/** 候选池大小（hot 路径先取这么多，再在 Node 里组装成页） */
export function hotPoolLimit(): number {
  return Math.min(1000, Math.max(50, Math.round(num(process.env.HOT_POOL_LIMIT, 300))))
}

/** 候选池的回溯天数：太老的内容不该占热门池（但仍在「最新」里可翻到） */
export function hotPoolDays(): number {
  return Math.max(1, Math.round(num(process.env.HOT_POOL_DAYS, 21)))
}
