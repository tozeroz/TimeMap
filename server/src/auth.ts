import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * 认证原语（M2）。
 *
 * 这里的每条规则都对应审核记录 05 的一条 P0：
 *
 * 1. **scrypt 参数必须写死**，不能依赖 Node 默认值；参数随哈希串一起存放，
 *    这样以后调参也不会让旧密码失效。
 * 2. **用异步 scrypt**（`scryptSync` 会阻塞事件循环 —— 单进程后端上等于让所有请求排队）。
 * 3. **用户不存在时也要跑一次参数完全相同的 scrypt**（dummy verify）。
 *    否则"用户不存在立即返回 / 密码错做一次 scrypt 才返回"的时间差
 *    仍然可以用来枚举用户；仅仅让错误信息一致是不够的。
 * 4. **token 用 SHA-256 存 hash 就够**：token 本身是 256-bit 随机数，已经是高熵，
 *    不需要（也不应该）再用 scrypt 二次哈希。
 *
 * 内存取舍：scrypt 一次需要 128*N*r 字节 ≈ 16MiB（N=16384, r=8）。
 * 这台机器只有约 396MB 可用内存，所以 N 取 2^14 而不是 OWASP 推荐给服务器端的 2^17
 * （2^17 单次就要 128MiB，5 并发直接 OOM）。这是**为内存约束做的显式妥协**，
 * 参数冻结前必须在目标机器上实测（见 M2 Gate 的资源组）。
 */

export const SCRYPT_PARAMS = {
  N: 16384, // 2^14
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
} as const

const SALT_BYTES = 16

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      {
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        maxmem: SCRYPT_PARAMS.maxmem,
      },
      (err, key) => (err ? reject(err) : resolve(key)),
    )
  })
}

/** handle 归一化：与 users_handle_lower_uniq 索引保持一致（大小写不敏感） */
export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase()
}

/** 生成哈希串：scrypt$N$r$p$keylen$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await scryptAsync(password, salt, SCRYPT_PARAMS.keylen)
  const { N, r, p, keylen } = SCRYPT_PARAMS
  return `scrypt$${N}$${r}$${p}$${keylen}$${salt.toString('base64')}$${key.toString('base64')}`
}

function parseHash(stored: string): { n: number; r: number; p: number; keylen: number; salt: Buffer; hash: Buffer } | null {
  const parts = stored.split('$')
  if (parts.length !== 7 || parts[0] !== 'scrypt') return null
  const n = Number.parseInt(parts[1]!, 10)
  const r = Number.parseInt(parts[2]!, 10)
  const p = Number.parseInt(parts[3]!, 10)
  const keylen = Number.parseInt(parts[4]!, 10)
  if (![n, r, p, keylen].every((v) => Number.isFinite(v) && v > 0)) return null
  try {
    return {
      n,
      r,
      p,
      keylen,
      salt: Buffer.from(parts[5]!, 'base64'),
      hash: Buffer.from(parts[6]!, 'base64'),
    }
  } catch {
    return null
  }
}

/** 校验密码。哈希串损坏时返回 false（不抛异常，避免把内部结构泄漏成 500） */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored)
  if (!parsed) return false
  const key = await new Promise<Buffer | null>((resolve) => {
    scrypt(
      password,
      parsed.salt,
      parsed.keylen,
      { N: parsed.n, r: parsed.r, p: parsed.p, maxmem: SCRYPT_PARAMS.maxmem },
      (err, derived) => resolve(err ? null : (derived as Buffer)),
    )
  })
  if (!key || key.length !== parsed.hash.length) return false
  return timingSafeEqual(key, parsed.hash)
}

/**
 * 给"用户不存在"分支用的假哈希。
 * 懒加载一次并缓存：必须在**参数与真实账号完全一致**的前提下算一次 scrypt，
 * 才能让两条分支的耗时接近。
 */
let dummyHashPromise: Promise<string> | null = null
export function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    // 固定的随机口令即可：这个哈希永远不会被成功匹配上
    dummyHashPromise = hashPassword(randomBytes(32).toString('hex'))
  }
  return dummyHashPromise
}

/** 生成 256-bit 不透明 token（base64url，可直接放进 Authorization: Bearer） */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** token 入库前一律转成 SHA-256 hex —— 库里永不出现明文 token */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * 极简限流：滑动窗口 + 只记失败。
 *
 * 为什么要自己写：这个项目明确不引入 Redis；单进程后端用内存计数就够，
 * 而且限流对象是"登录失败"，不是全站 QPS。
 * 必须**有界**：Map 最多保留 maxKeys 个 key，超了先清最老的，避免被刷爆内存。
 */
export interface RateLimiter {
  /** 记一次失败 */
  fail(key: string): void
  /** 是否已被限流；被限流时给出建议的 Retry-After 秒数 */
  hit(key: string): { limited: boolean; retryAfterS: number }
  /** 登录成功后清掉该 key 的失败记录 */
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
    // Map 保持插入顺序：删掉最早插入的若干个
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
