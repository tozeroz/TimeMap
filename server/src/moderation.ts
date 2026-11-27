/**
 * 内容审核（A 档）：本地规则 → 大模型分类 → 结果缓存 → 处置留痕。
 *
 * 设计取舍（为什么这样做）：
 * 1) **失败即人工**：大模型超时/报错/返回不合法 JSON 时，判定为 `review` 而不是 `allow`。
 *    放行一次违规内容的代价远高于让一条正常内容多等几分钟人审。
 * 2) **先规则后模型**：明显的硬违规（代考代写、裸聊、枪支毒品、赌博贷款、刷单）用正则直接拦，
 *    省调用、也避免模型偶发漏判这类高危词。
 * 3) **同一段文本只调一次模型**：以「模型 + 提示词版本 + 归一化文本」的 sha256 做缓存键。
 *    校园场景里「求推荐食堂」「失物招领」这类文本高度重复，缓存能省掉大部分费用。
 * 4) **每条结论都留痕**：moderation_decisions 记录决策、来源（rule/llm/cache/failclosed）、
 *    模型、耗时、理由 —— 事后被问"为什么拦我"时能给出证据。
 *
 * 模型来源：沿用用户 opencode go 月卡（OpenAI 兼容的 chat/completions 端点），
 * 需要通过环境变量提供 key；未配置时审核降级为「全部进入人审」而不是放行。
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ModerationDecision = 'allow' | 'review' | 'block'
export type ModerationAction = 'published' | 'pending_review' | 'rejected'
export type ModerationTarget = 'post' | 'comment' | 'activity_submission' | 'profile'

export interface ModerationResult {
  decision: ModerationDecision
  action: ModerationAction
  categories: string[]
  reason: string
  source: 'rule' | 'cache' | 'llm' | 'failclosed' | 'disabled'
  model: string | null
  latencyMs: number
  cached: boolean
}

interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}

const PROMPT_VERSION = 'v1'
const DEFAULT_MODEL = 'deepseek-v4.1-flash'
const DEFAULT_BASE = 'https://opencode.ai/zen/go/v1'
const DEFAULT_TIMEOUT_MS = 12000

/** 硬规则：命中即拦截。正则只覆盖"语义上没有歧义"的违规，其余交给模型。 */
const RULES: Array<{ re: RegExp; category: string }> = [
  { re: /代考|代写论文|包过|替考|枪手代|有偿代课|代刷课/i, category: '代考代写代课' },
  { re: /裸聊|约炮|一夜情|成人视频|黄片|色情服务/i, category: '色情低俗' },
  { re: /枪支|弹药|冰毒|海洛因|大麻交易|吸毒/i, category: '违禁品' },
  { re: /网络赌博|博彩|时时彩|六合彩|赌球/i, category: '赌博' },
  { re: /校园贷|裸条|高利贷|无抵押放款|急用钱秒下款/i, category: '非法金融' },
  { re: /刷单|兼职日结|日赚|躺赚|招代理|代理返利/i, category: '刷单诈骗' },
  { re: /办理证件|办假证|出售学号|买卖账号|收购银行卡|出售手机卡/i, category: '黑产交易' },
  { re: /炸学校|杀(死|了)你|砍死你|人肉你/i, category: '暴力威胁' },
]

const POLICY = `你是北京交通大学校园社区（TimeMap）的内容审核员，判断一条用户内容是否可以公开展示。
只输出 JSON，不要 markdown、不要解释：{"decision":"allow|review|block","categories":["..."],"reason":"一句中文理由","confidence":0-1}

判定口径：
- block（不得公开）：涉政敏感/暴恐/分裂、色情与裸聊、赌博毒品枪支、诈骗与引流、代考代写代课、校园贷与放贷、买卖账号证件、人身攻击与网暴、泄露他人隐私（学号/手机号/住址/成绩单）、血腥恐怖。
- review（需人工确认）：疑似商业广告（含联系方式/二维码/引流群链接）、擦边低俗、引战辱骂但未到人身攻击、涉及未成年人、单方面指控学校或个人的负面事件、疑似刷屏或无意义重复。
- allow：正常校园生活分享、求助、活动通知、失物招领、个人二手物品转让。

注意：校园场景下「二手交易」「找同学一起去某地」「询问食堂/自习室」都是正常内容，不要误判为广告。`

const CATEGORY_ALLOW = new Set(['', '正常', '正常校园活动', '校园生活'])

function env(name: string): string {
  return (process.env[name] ?? '').trim()
}

export function moderationModel(): string {
  return env('MODERATION_MODEL') || DEFAULT_MODEL
}

export function moderationEnabled(): boolean {
  if (env('MODERATION_ENABLED') === '0') return false
  return Boolean(apiKey())
}

function apiKey(): string {
  return env('MODERATION_API_KEY') || env('OPENCODE_GO_API_KEY') || env('OPENCODEGO_API_KEY')
}

/** 归一化：全角转半角、去零宽字符、压缩空白。用于规则匹配与缓存键。 */
export function normalizeText(input: string): string {
  let s = input.normalize('NFKC')
  s = s.replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function hashOf(text: string): string {
  return createHash('sha256')
    .update(`${moderationModel()}|${PROMPT_VERSION}|${text}`)
    .digest('hex')
}

function toDecision(value: unknown): ModerationDecision | null {
  return value === 'allow' || value === 'review' || value === 'block' ? value : null
}

function actionOf(decision: ModerationDecision): ModerationAction {
  if (decision === 'block') return 'rejected'
  if (decision === 'review') return 'pending_review'
  return 'published'
}

function cleanCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 24 && !CATEGORY_ALLOW.has(c))
    .slice(0, 4)
}

/** 从模型输出里抠出 JSON（容忍 ```json 包裹与前后废话）。 */
function parseModelJson(text: string): { decision: ModerationDecision; categories: string[]; reason: string } | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  const decision = toDecision(rec.decision)
  if (!decision) return null
  const reason = typeof rec.reason === 'string' ? rec.reason.slice(0, 200) : ''
  return { decision, categories: cleanCategories(rec.categories), reason }
}

/**
 * 调模型判定。
 *
 * 为什么带一次重试：实测 30 条语料里出现过 1 次超时（7s 上限），而超时会被
 * fail-closed 成 review —— 结果是"正常内容也被丢进人工队列"，人工成本白白上涨。
 * 单次重试能把这类抖动挡掉，又不会把故障时的响应时间拖太长（12s × 2 ≈ 24s 上限）。
 * 仍然**只重试网络/超时类失败**：模型明确返回 block/allow 时绝不重试（避免同一文本两次结论不同）。
 */
async function callModelOnce(text: string): Promise<{ decision: ModerationDecision; categories: string[]; reason: string } | null> {
  const base = env('MODERATION_BASE') || DEFAULT_BASE
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(env('MODERATION_TIMEOUT_MS') || DEFAULT_TIMEOUT_MS))
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey()}`,
        // opencode go 端点要求该头；不传会 401 MissingSessionID
        'x-opencode-session': env('MODERATION_SESSION') || randomUUID(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: moderationModel(),
        temperature: 0,
        /*
          200 太小：这个模型会先输出 reasoning_content 再给正文，
          实测有 1/38 的样本把 220 token 全用在思考上（finish_reason=length，content 为空），
          解析拿不到 decision 就按 fail-closed 转人工 —— 正常内容也被丢进队列。
          800 足够容纳思考 + 一行 JSON，代价只是极端情况下多花几十毫秒。
        */
        max_tokens: 800,
        messages: [
          { role: 'system', content: POLICY },
          { role: 'user', content: `待审核内容：\n${text.slice(0, 1200)}` },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content
    return typeof content === 'string' ? parseModelJson(content) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function callModel(text: string): Promise<{ decision: ModerationDecision; categories: string[]; reason: string } | null> {
  const first = await callModelOnce(text)
  if (first) return first
  await new Promise((r) => setTimeout(r, 400))
  return callModelOnce(text)
}

async function recordDecision(
  pool: Queryable,
  targetType: ModerationTarget,
  targetId: string | null,
  authorId: string | null,
  result: ModerationResult,
): Promise<void> {
  try {
    await pool.query(
      `insert into moderation_decisions
         (id, target_type, target_id, author_id, decision, action, categories, reason, source, model, prompt_version, latency_ms)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)`,
      [
        randomUUID(),
        targetType,
        targetId,
        authorId,
        result.decision,
        result.action,
        JSON.stringify(result.categories),
        result.reason,
        result.source,
        result.model,
        PROMPT_VERSION,
        result.latencyMs,
      ],
    )
  } catch {
    /* 留痕失败不能影响业务：审核结论已经做出，日志只是证据 */
  }
}

/**
 * 事后补记一条审核结论。
 *
 * 为什么单独暴露：帖子/评论的 id 在**审核之后**才生成（审核要先跑，才决定是否落库），
 * 所以 moderateText 阶段还拿不到 targetId。等 insert 拿到 id 之后必须补记，
 * 否则 moderation_decisions 永远是空的 —— "为什么拦我"就没有证据。
 */
export async function recordModerationResult(
  pool: Queryable,
  targetType: ModerationTarget,
  targetId: string | null,
  authorId: string | null,
  result: ModerationResult,
): Promise<void> {
  await recordDecision(pool, targetType, targetId, authorId, result)
}


/**
 * 图片审核（v2，2026-11-27 加）：
 *
 * 为什么复用同一个模型：`deepseek-v4.1-flash` 的同名端点原生接收
 * `image_url`（input 模态含 image/jpeg|png|webp），单价与文本同档（$0.15/M input），
 * 单独再接一个视觉模型会多一套 key、一套超时、一套缓存 —— 不划算。
 *
 * 缓存键用图片内容的 sha256（media 表本来就有这一列）：同一张图被转帖/重复上传时
 * 不需要再花一次钱；缓存只存 allow/block 这种确定结论，review 不缓存（拿不准就每次问）。
 */
const VISION_POLICY = `你是北京交通大学校园社区（TimeMap）的图片审核员，判断这张用户上传的图片能否公开展示。
重点检查：色情或裸露；血腥暴力；赌博、诈骗、收款二维码或站外引流联系方式；代考代写、论文代写等作弊广告；他人隐私信息（学号、身份证、成绩单、手机号、家庭住址）；违禁品（枪支、管制刀具、毒品）；与校园生活无关的纯商业广告。
只输出一行 JSON：{"decision":"allow|review|block","categories":["违规类别"],"reason":"不超过 60 字"}
明显违规给 block；拿不准给 review；正常校园生活照片给 allow。`

export const VISION_PROMPT_VERSION = 'img-v1'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGES_PER_TARGET = 4

export interface ImageInput {
  sha256: string
  mime: string
  dataUrl: string
}

function imageCacheKey(sha256: string): string {
  return `img:${VISION_PROMPT_VERSION}:${sha256}`
}

async function callVisionOnce(image: ImageInput): Promise<{ decision: ModerationDecision; categories: string[]; reason: string } | null> {
  const base = env('MODERATION_BASE') || DEFAULT_BASE
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(env('MODERATION_TIMEOUT_MS') || DEFAULT_TIMEOUT_MS))
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey()}`,
        'x-opencode-session': env('MODERATION_SESSION') || randomUUID(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: moderationModel(),
        temperature: 0,
        max_tokens: 800,
        messages: [
          { role: 'system', content: VISION_POLICY },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请审核这张图片。' },
              { type: 'image_url', image_url: { url: image.dataUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content
    return typeof content === 'string' ? parseModelJson(content) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 单张图片审核：规则无法覆盖（图里没有文字），直接走模型 + 内容缓存。 */
export async function moderateImage(pool: Queryable, image: ImageInput): Promise<ModerationResult> {
  const started = Date.now()
  const model = moderationModel()
  const key = imageCacheKey(image.sha256)

  if (!apiKey()) {
    // 没配 key 与文本同口径：fail-closed 转人工
    return { decision: 'review', action: 'pending_review', categories: [], reason: '图片审核未配置密钥', source: 'failclosed', model: null, latencyMs: 0, cached: false }
  }

  try {
    const c = await pool.query(
      'update moderation_cache set hits = hits + 1, last_hit_at = now() where text_hash = $1 returning decision, categories, reason',
      [key],
    )
    const row = c.rows[0]
    if (row) {
      const decision = toDecision(row.decision) ?? 'review'
      return {
        decision,
        action: actionOf(decision),
        categories: cleanCategories(row.categories),
        reason: (row.reason as string | null) ?? '',
        source: 'cache',
        model,
        latencyMs: Date.now() - started,
        cached: true,
      }
    }
  } catch {
    /* 缓存不可用就继续问模型 */
  }

  const parsed = (await callVisionOnce(image)) ?? (await callVisionOnce(image))
  const result: ModerationResult = parsed
    ? {
        decision: parsed.decision,
        action: actionOf(parsed.decision),
        categories: parsed.categories,
        reason: parsed.reason,
        source: 'llm',
        model,
        latencyMs: Date.now() - started,
        cached: false,
      }
    : {
        decision: 'review',
        action: 'pending_review',
        categories: [],
        reason: '图片审核超时或不可用',
        source: 'failclosed',
        model,
        latencyMs: Date.now() - started,
        cached: false,
      }

  // 只缓存确定结论：review 说明拿不准，下次仍需重新判断
  if (result.decision !== 'review') {
    try {
      await pool.query(
        `insert into moderation_cache (text_hash, decision, categories, reason, model, prompt_version)
         values ($1,$2,$3::jsonb,$4,$5,$6)
         on conflict (text_hash) do update set decision = excluded.decision, categories = excluded.categories,
           reason = excluded.reason, model = excluded.model, prompt_version = excluded.prompt_version,
           last_hit_at = now()`,
        [key, result.decision, JSON.stringify(result.categories), result.reason, model, PROMPT_VERSION],
      )
    } catch {
      /* 缓存写失败不影响本次结论 */
    }
  }
  return result
}

/**
 * 把帖子的图片读成 data URL 供模型审核。
 *
 * 为什么在服务端读盘：媒体存在 `UPLOAD_ROOT/<scope>/<storage_key>`，
 * 只有服务端能直接读到；让模型去拉公网 URL 在本地开发环境根本拉不到。
 * 超过 5MB 或非图片直接跳过（视频/音频暂不做），GIF 跳过（模型输入模态不含 gif）。
 */
export async function loadImageInputs(pool: Queryable, mediaIds: string[]): Promise<ImageInput[]> {
  if (mediaIds.length === 0) return []
  const root = env('UPLOAD_ROOT') || '/srv/campus/uploads'
  const out: ImageInput[] = []
  try {
    const r = await pool.query(
      `select scope, storage_key, mime, bytes, sha256 from media where id = any($1::uuid[]) limit ${MAX_IMAGES_PER_TARGET}`,
      [mediaIds],
    )
    for (const row of r.rows) {
      const mime = String(row.mime ?? '')
      if (!mime.startsWith('image/') || mime === 'image/gif') continue
      if (Number(row.bytes ?? 0) > MAX_IMAGE_BYTES) continue
      try {
        const buf = await readFile(join(root, String(row.scope ?? 'public'), String(row.storage_key ?? '')))
        if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) continue
        const sha = String(row.sha256 ?? '') || createHash('sha256').update(buf).digest('hex')
        out.push({ sha256: sha, mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}` })
      } catch {
        /* 单张图读不到就跳过，不影响文字审核 */
      }
    }
  } catch {
    /* 读媒体元数据失败：返回空数组，按纯文本审核处理 */
  }
  return out
}

/** 文本结论 + 图片结论合成：block 优先，其次 review，都正常才是 allow。 */
export function combineVerdicts(text: ModerationResult, images: ModerationResult[]): ModerationResult {
  const blocked = images.find((v) => v.decision === 'block')
  if (blocked) return { ...blocked, reason: `图片违规：${blocked.reason || blocked.categories.join('/')}` }
  const reviewed = images.find((v) => v.decision === 'review')
  if (reviewed && text.decision === 'allow') return { ...reviewed, reason: `图片待复核：${reviewed.reason || '拿不准'}` }
  if (blocked === undefined && reviewed === undefined && text.decision === 'allow' && images.length > 0) {
    return { ...text, reason: text.reason || '图文审核通过' }
  }
  return text
}

/** 主入口：对一段文本做审核，返回结论与最终处置。 */
export async function moderateText(
  pool: Queryable,
  rawText: string,
  opts: { targetType: ModerationTarget; targetId?: string | null; authorId?: string | null },
): Promise<ModerationResult> {
  const started = Date.now()
  const text = normalizeText(rawText)

  const finish = async (result: ModerationResult): Promise<ModerationResult> => {
    if (opts.targetId) await recordDecision(pool, opts.targetType, opts.targetId, opts.authorId ?? null, result)
    return result
  }

  // 空文本（纯图片帖）没有可审核的语义，交给图片策略/人审处理
  if (!text) {
    return finish({ decision: 'allow', action: 'published', categories: [], reason: '无文本内容', source: 'rule', model: null, latencyMs: 0, cached: false })
  }

  // ① 硬规则
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return finish({
        decision: 'block',
        action: 'rejected',
        categories: [rule.category],
        reason: `命中硬规则：${rule.category}`,
        source: 'rule',
        model: null,
        latencyMs: Date.now() - started,
        cached: false,
      })
    }
  }

  const hash = hashOf(text)
  const model = moderationModel()

  // ② 缓存
  try {
    const c = await pool.query(
      'update moderation_cache set hits = hits + 1, last_hit_at = now() where text_hash = $1 returning decision, categories, reason',
      [hash],
    )
    const row = c.rows[0]
    if (row) {
      const decision = toDecision(row.decision) ?? 'review'
      return finish({
        decision,
        action: actionOf(decision),
        categories: cleanCategories(row.categories),
        reason: (row.reason as string | null) ?? '',
        source: 'cache',
        model,
        latencyMs: Date.now() - started,
        cached: true,
      })
    }
  } catch {
    /* 缓存不可用时继续走模型 */
  }

  // ③ 模型（未配置 key ⇒ 不能判定，进入人审）
  if (!moderationEnabled()) {
    return finish({
      decision: 'review',
      action: 'pending_review',
      categories: ['未配置审核服务'],
      reason: '审核服务未配置，转人工审核',
      source: 'disabled',
      model: null,
      latencyMs: Date.now() - started,
      cached: false,
    })
  }

  let out = await callModel(text)
  if (!out) out = await callModel(text) // 一次重试：网络抖动比模型误判常见得多

  if (!out) {
    return finish({
      decision: 'review',
      action: 'pending_review',
      categories: ['审核服务异常'],
      reason: '审核服务调用失败，转人工审核',
      source: 'failclosed',
      model,
      latencyMs: Date.now() - started,
      cached: false,
    })
  }

  // ④ 写缓存（只缓存明确的 allow/block；review 的结果依赖上下文，不缓存）
  if (out.decision !== 'review') {
    try {
      await pool.query(
        `insert into moderation_cache (text_hash, decision, categories, reason, model, prompt_version)
         values ($1,$2,$3::jsonb,$4,$5,$6)
         on conflict (text_hash) do nothing`,
        [hash, out.decision, JSON.stringify(out.categories), out.reason, model, PROMPT_VERSION],
      )
    } catch {
      /* ignore */
    }
  }

  return finish({
    decision: out.decision,
    action: actionOf(out.decision),
    categories: out.categories,
    reason: out.reason,
    source: 'llm',
    model,
    latencyMs: Date.now() - started,
    cached: false,
  })
}

/** 新用户判定：发过（含审核中）的帖子不足 N 条 ⇒ 前 N 条先审。 */
export async function isNewAuthor(pool: Queryable, authorId: string, threshold = 3): Promise<boolean> {
  try {
    const r = await pool.query(
      `select count(*)::int as n from posts
        where author_id = $1 and status in ('published', 'pending_review')`,
      [authorId],
    )
    return Number(r.rows[0]?.n ?? 0) < threshold
  } catch {
    return true // 查不到就保守处理：当成新用户先审
  }
}

export const MODERATION_PROMPT_VERSION = PROMPT_VERSION

/**
 * 同步硬规则扫描（0 毫秒级）。
 *
 * 为什么单独抽出来：发布/评论接口需要在**落库之前**立刻拒绝明显违规（422），
 * 这一步绝不能等模型。规则命中的结论照样留痕，由调用方补记。
 */
export function scanRules(rawText: string): { categories: string[]; reason: string } | null {
  const text = normalizeText(rawText)
  if (!text) return null
  for (const rule of RULES) {
    if (rule.re.test(text)) return { categories: [rule.category], reason: `命中硬规则：${rule.category}` }
  }
  return null
}

/**
 * 异步判定（不阻塞用户请求）。
 *
 * 设计取舍（2026-11-27 复盘后改的）：
 * - 之前的实现把模型调用放在请求路径上同步 await，实测**每次发帖多等 2.0–2.7 秒**，
 *   与"审核不阻塞请求"的约定相反，也被用户感知为"发布很卡"。
 * - 现在：请求路径只做「规则同步拦截 + 状态落库」，模型判定在后台跑；
 *   后台判定**只收紧、不放宽**：
 *     · block  → 待审的置 rejected，已公开的置 removed（秒级窗口，靠举报/巡查兜底）；
 *     · review → 已公开的降级为 pending_review 转人工；待审的保持待审；
 *     · allow  → 不动状态（先审后发的帖子仍等人工通过 —— 这是 A 档的口径）。
 * - 失败（超时/未配置 key）按 review 处理，与同步版本一致（fail-closed）。
 */
export function queueModeration(
  pool: Queryable,
  rawText: string,
  target: { targetType: 'post' | 'comment'; targetId: string; authorId: string | null; wasPreReview: boolean; mediaIds?: string[] },
): void {
  void (async () => {
    let verdict: ModerationResult
    try {
      verdict = await moderateText(pool, rawText, {
        targetType: target.targetType,
        targetId: target.targetId,
        authorId: target.authorId,
      })
    } catch (e) {
      console.warn('[moderation] 异步判定异常（保留原状态）', e instanceof Error ? e.message : e)
      return
    }
    /* 图片审核（v2）：和文本一起决定处置；图片违规优先（图比字更容易出事） */
    if (target.mediaIds && target.mediaIds.length > 0) {
      try {
        const images = await loadImageInputs(pool, target.mediaIds)
        if (images.length > 0) {
          const verdicts = await Promise.all(images.map((img) => moderateImage(pool, img)))
          verdict = combineVerdicts(verdict, verdicts)
        }
      } catch (e) {
        console.warn('[moderation] 图片审核异常（按文本结论处理）', e instanceof Error ? e.message : e)
      }
    }
    const table = target.targetType === 'post' ? 'posts' : 'comments'
    try {
      if (verdict.decision === 'block') {
        if (target.wasPreReview) {
          await pool.query(
            `update ${table} set status = 'rejected', review_note = $2 where id = $1 and status = 'pending_review'`,
            [target.targetId, verdict.reason || '机审拦截'],
          )
        } else {
          await pool.query(
            `update ${table} set status = 'removed', review_note = $2 where id = $1 and status = 'published'`,
            [target.targetId, verdict.reason || '机审拦截'],
          )
        }
      } else if (verdict.decision === 'review' && !target.wasPreReview) {
        await pool.query(
          `update ${table} set status = 'pending_review', review_note = $2 where id = $1 and status = 'published'`,
          [target.targetId, verdict.reason || '机审转人工'],
        )
      }
    } catch (e) {
      console.warn('[moderation] 异步处置失败（保留原状态）', e instanceof Error ? e.message : e)
    }
  })()
}

/**
 * 举报联动（2026-11-27 加）：
 *
 * 原来是"举报只进管理员列表、内容照常公开"。现在被举报的目标**立即重新机审**：
 *   · block  ⇒ 直接下架（status=removed），管理员在举报处理里能看到"已被机审下架"；
 *   · 其余    ⇒ 降级为 pending_review 进人工队列 —— 举报本身就是人工信号，
 *              让管理员在同一处看到内容和举报理由，不用两边对照。
 *
 * 权衡：恶意举报会把正常内容暂时从公开列表拿下来（可见性损失），
 * 但校园场景里"被举报还继续公开"的合规风险更大；管理员一键通过即可恢复。
 */
export function queueReportRecheck(pool: Queryable, targetType: 'post' | 'comment', targetId: string): void {
  void (async () => {
    try {
      const table = targetType === 'post' ? 'posts' : 'comments'
      const t = await pool.query(`select id, author_id, body, status from ${table} where id = $1`, [targetId])
      const row = t.rows[0]
      if (!row || row.status !== 'published') return
      let verdict = await moderateText(pool, String(row.body ?? ''), {
        targetType,
        targetId,
        authorId: (row.author_id as string | null) ?? null,
      })
      if (targetType === 'post') {
        const media = await pool.query('select media_id from post_media where post_id = $1 order by position', [targetId])
        const mediaIds = media.rows.map((r) => String(r.media_id))
        if (mediaIds.length > 0) {
          const images = await loadImageInputs(pool, mediaIds)
          if (images.length > 0) {
            const verdicts = await Promise.all(images.map((img) => moderateImage(pool, img)))
            verdict = combineVerdicts(verdict, verdicts)
          }
        }
      }
      if (verdict.decision === 'block') {
        await pool.query(
          `update ${table} set status = 'removed', review_note = $2 where id = $1 and status = 'published'`,
          [targetId, `被举报后机审拦截：${verdict.reason || verdict.categories.join('/')}`],
        )
      } else {
        await pool.query(
          `update ${table} set status = 'pending_review', review_note = $2 where id = $1 and status = 'published'`,
          [targetId, `被举报，待人工复核（机审：${verdict.decision}）`],
        )
      }
    } catch (e) {
      console.warn('[moderation] 举报复核失败（内容保持原状态）', e instanceof Error ? e.message : e)
    }
  })()
}
