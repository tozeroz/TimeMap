import { createHmac, randomInt } from 'node:crypto'

/**
 * 认证原语（M3 Slice 0B：手机号 + 一次性验证码）。
 *
 * 与 M2 的关系（审核记录 08 的裁定）：
 *   保留 —— session 机制：不透明 token、库里只存 SHA-256(token)、过期、撤销、Bearer
 *   退休 —— 密码凭证：原版登录页实测**没有密码**，因此 handle+password 这条路被移除
 *   新增 —— 手机号 + 一次性验证码作为唯一公开登录方式
 *
 * 这里已经**不再有 scrypt / 密码哈希**：既然产品上没有密码登录，
 * 保留一套密码哈希原语只会诱导后来者重新接一条不存在的登录路径。
 */

const CODE_DIGITS = 6

/**
 * 手机号规范化。
 *
 * 只接受中国大陆 +86（原版页面是固定「+86」且没有国家码选择器，实测见 SLICE0 文档），
 * 但校验用通用 E.164 规则 —— 以后要支持别的国家码时不必改校验，只改 UI。
 *
 * 接受输入形式：'13800000000' / '138 0000 0000' / '+86 13800000000' / '8613800000000'
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '')
  let national: string
  if (digits.startsWith('+86')) national = digits.slice(3)
  else if (digits.startsWith('86') && digits.length > 11) national = digits.slice(2)
  else if (digits.startsWith('+')) return null // 其它国家码：暂不支持，明确拒绝而不是猜
  else national = digits

  if (!/^1[3-9]\d{9}$/.test(national)) return null
  return `+86${national}`
}

/** 生成 6 位数字验证码（用 CSPRNG，不用 Math.random） */
export function newLoginCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0')
}

/**
 * 验证码入库前的哈希：**keyed HMAC-SHA256**，不是裸 SHA-256（审核记录 08 第 2 点）。
 *
 * 为什么必须带密钥：验证码只有 6 位，穷举空间 10^6。
 * 裸哈希一旦随数据库泄漏就能被瞬间反查；HMAC 需要攻击者同时拿到服务端密钥。
 *
 * 为什么把手机号也拼进消息：防止把 A 手机号收到的码用到 B 手机号上（跨号重放）。
 */
export function hashLoginCode(key: string, phoneE164: string, code: string): string {
  return createHmac('sha256', key).update(`${phoneE164}|${code}`).digest('hex')
}

/** 常数时间比较（hex 串） */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * 极简限流：滑动窗口 + 只记失败。
 *
 * 为什么要自己写：这个项目明确不引入 Redis；单进程后端用内存计数就够，
 * 而且限流的对象是"失败/请求次数"，不是全站 QPS。
 * 必须**有界**：Map 最多保留 maxKeys 个 key，超了先清最老的，避免被刷爆内存。
 */
export interface RateLimiter {
  /** 记一次失败/一次请求 */
  fail(key: string): void
  /** 是否已被限流；被限流时给出建议的 Retry-After 秒数 */
  hit(key: string): { limited: boolean; retryAfterS: number }
  /** 成功后清掉该 key 的计数 */
  reset(key: string): void
}

export function createRateLimiter(maxFailures: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const hits = new Map<string, number[]>()

  function prune(now: number, key: string): number[] {
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (list.length) hits.set(key, list)
    else hits.delete(key)
    return list
  }

  function enforceBound() {
    if (hits.size <= maxKeys) return
    const excess = hits.size - maxKeys
    let i = 0
    for (const k of hits.keys()) {
      if (i++ >= excess) break
      hits.delete(k)
    }
  }

  return {
    fail(key) {
      const now = Date.now()
      const list = prune(now, key)
      list.push(now)
      hits.set(key, list)
      enforceBound()
    },
    hit(key) {
      const now = Date.now()
      const list = prune(now, key)
      if (list.length < maxFailures) return { limited: false, retryAfterS: 0 }
      const oldest = list[0]!
      const retryAfterS = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000))
      return { limited: true, retryAfterS }
    },
    reset(key) {
      hits.delete(key)
    },
  }
}
