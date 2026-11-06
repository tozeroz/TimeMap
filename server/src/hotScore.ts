/**
 * 热门排序（2026-11-06）
 *
 * 为什么需要单独一个文件：同一套口径要在「首页/我的发布列表」和「地点详情里的帖子列表」
 * 两处使用。此前两处各写一遍 ORDER BY，已经在 `::int` 转换上有过分歧（一处转一处没转），
 * 迟早漂移成一个列表热、另一个不热。这里让 SQL 片段只有一份来源。
 *
 * 口径（与调研文档 docs/zjx/热门排序算法调研-2026-11-06.md 的结论一致）：
 *
 *   engagement = 点赞×2 + 评论×3 + 收藏×1        （老口径，只衡量"已经有多少人互动"）
 *   ctr        = (打开数 + m·p0) / (曝光数 + m)   （贝叶斯平滑的点击率，m 是先验强度）
 *   score      = (ln(1+engagement) + w·ctr) / (age_h + 2)^k  + cold/(age_h + 1)
 *
 * 每一段为什么这么写：
 *   · log 压缩：互动从 3 到 30 是质变，从 300 到 330 不是。线性加权会让一条被顶上首页
 *     的老帖靠绝对量永远压住新帖。
 *   · 点击率项 w·ctr：解决"曝光很多但没人点"的帖子占位问题。用贝叶斯平滑，是因为
 *     曝光 1 次点开 1 次不该等于 100% 点击率（那会奖励「发出去只给自己看」的帖）。
 *   · 幂律衰减 (age+2)^k：k≈1.2 时 48 小时的帖子分数降到 1 小时的约 1/25，
 *     校园场景里"上周的爆款"确实不该压住今天的帖子。
 *   · 冷启动项 cold/(age+1)：让刚发布、还没人看到的帖子有基本的曝光机会，
 *     否则新帖永远排在"已经火过的帖"后面，形成马太效应。
 *
 * 注意：本文件只提供 SQL 片段，参数改动会影响排序结果，改完要用
 * `node tools/checks/hot-score-check.mjs` 的等价脚本或灰度观察四个指标
 * （热门 Tab 点击率、新帖进 Top10 比例、Top10 作者集中度、举报率）后再上线。
 */
export const HOT_WEIGHTS = {
  /** 点赞权重 */
  like: 2,
  /** 有效评论权重 */
  comment: 3,
  /** 收藏权重 */
  favorite: 1,
  /** 点击率先验强度（等效"先给多少虚拟曝光"） */
  ctrPrior: 30,
  /** 点击率先验均值（等效"默认 12% 的人会点开"） */
  ctrMean: 0.12,
  /** 点击率项在分数里的权重 */
  ctrWeight: 6,
  /** 时间衰减指数 */
  decayExponent: 1.2,
  /** 冷启动项权重 */
  coldStart: 0.35,
} as const

const fmt = (n: number): string => (Number.isFinite(n) ? String(n) : '0')

/**
 * 生成热门排序的 ORDER BY 片段。
 *
 * @param alias 外层子查询别名（列表接口是 `q`，地点详情接口同样用 `q`）
 *
 * 依赖外层子查询里必须有这些列：
 *   like_count / comment_count / favorite_count（文本型计数，需 ::int）
 *   view_impressions / view_opens（最近 14 天的曝光与打开数，见迁移 036）
 *   created_at
 */
export function hotOrderSql(alias = 'q'): string {
  return `${hotScoreSql(alias)} desc, ${alias}.created_at desc, ${alias}.id desc`
}

/**
 * 只返回分数表达式（不带 desc/次级排序），给「按参数决定要不要用热度」的查询用
 * （例如地点详情：`order by case when $3 = 'hot' then <分数> else 0 end desc`）。
 */
export function hotScoreSql(alias = 'q'): string {
  const a = alias
  const engagement = `(${a}.like_count::int * ${fmt(HOT_WEIGHTS.like)} + ${a}.comment_count::int * ${fmt(HOT_WEIGHTS.comment)} + ${a}.favorite_count::int * ${fmt(HOT_WEIGHTS.favorite)})`
  const ageHours = `(extract(epoch from (now() - ${a}.created_at)) / 3600.0)`
  const ctr = `((${a}.view_opens::float8 + ${fmt(HOT_WEIGHTS.ctrPrior * HOT_WEIGHTS.ctrMean)}) / (${a}.view_impressions::float8 + ${fmt(HOT_WEIGHTS.ctrPrior)}))`
  return `((ln(1 + ${engagement}) + ${fmt(HOT_WEIGHTS.ctrWeight)} * ${ctr}) / power(${ageHours} + 2, ${fmt(HOT_WEIGHTS.decayExponent)}) + ${fmt(HOT_WEIGHTS.coldStart)} / (${ageHours} + 1))`
}
