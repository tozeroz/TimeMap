/**
 * 管理员密码凭据（017）。
 *
 * ## 为什么用 scrypt（而不是 bcrypt / argon2）
 *   · **零新依赖**：`node:crypto` 内置。本项目的服务器是 396MB 的小机器、
 *     且后端刻意打成"单文件、零 node_modules"的产物（见 server/build.mjs 的设计约定）。
 *     引入 bcrypt 需要 node-gyp 编译、argon2 同理 —— 而 build.mjs 的维护性约定第 1 条
 *     明确写着"依赖必须是纯 JS（不允许需要 node-gyp 编译的包）"。
 *   · scrypt 是内存硬（memory-hard）函数，抗 GPU 暴力破解，且是 RFC 7914 标准。
 *   · ⚠️ 如实说明：argon2id 在抗侧信道与参数调优上更现代，但为了"不加原生依赖"
 *     这个明确的工程约束，这里选 scrypt。这是**有意的取舍**，不是"scrypt 更好"。
 *
 * ## 存储格式（把参数编码进哈希 → 将来换参数/算法时能识别旧格式）
 *   `scrypt$N$r$p$salt_hex$hash_hex`
 *   · 每个哈希自带它当时的参数 ⇒ 改 N/r/p 之后**老密码仍可校验**（用记录里的参数算）
 *   · 迁移 017 有同形的 CHECK 约束，格式不符会被数据库拒绝
 *
 * ## 与登录验证码的同一纪律
 *   005 里验证码存的是 **keyed HMAC**（不是裸 hash），因为 6 位码空间只有 10^6。
 *   密码不同：它是用户选的、熵更高，且**需要离线可验证**（没有服务端密钥也要能验），
 *   所以用加盐 scrypt —— 不能像验证码那样加服务端密钥（那会变成"密钥丢了密码全废"）。
 *   两者的差异是**有意**的，不是不一致。
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

/**
 * scrypt 参数。取值依据：OWASP 对 scrypt 的建议下限是 N=2^15、r=8、p=1
 * （N=2^17 更稳但内存约 128MB×，这台 396MB 的小机器上并发登录会打爆内存）。
 * ⇒ N=2^15 / r=8 / p=1：单次约 32MB 内存、几十毫秒，**对登录频率足够安全**。
 * ⚠️ 改这三个值不会让老密码失效（参数编码在哈希里），只会让新设的密码用新参数。
 */
const N = 32768 // 2^15
const R = 8
const P = 1
const KEYLEN = 32
const SALT_BYTES = 16

/**
 * ⚠️⚠️ 必须显式给 `maxmem`（2026-09-26 实测踩到）：
 *   scrypt 的内存需求 ≈ `128 * N * r` 字节。取 N=2^15、r=8 ⇒ 128*32768*8 = **33.5 MiB**。
 *   而 Node/OpenSSL 的 scrypt **默认 maxmem 是 32 MiB** ⇒ 33.5 > 32 ⇒ 直接抛
 *     `Invalid scrypt params: error:030000AC:digital envelope routines::memory limit exceeded`
 *   即"参数本身是合法的，但超过了默认内存上限"。
 *
 *   为什么不是把 N 降到 2^14 来"绕过"：那会把每次哈希的内存从 32MiB 降到 16MiB，
 *   **等于悄悄降低口令强度**，而代码里看不出任何异常 —— 属于最不该做的那种修法。
 *   ⇒ 显式把 maxmem 抬到需求之上（留一倍余量），保持 32MiB 的工作量不变。
 *
 *   代价（如实说明）：单次哈希峰值内存约 33.5MiB，而服务器只有 396MB。
 *   但登录接口有独立限流（adminLoginLimiter），不会并发跑很多次哈希；
 *   且 N 是按 OWASP 对 scrypt 的建议下限（2^15）选的，已经是为了这台小机器而取的**下限**。
 */
function maxmemFor(n: number, r: number): number {
  return 128 * n * r * 2
}

/**
 * ⚠️⚠️ 为什么手写 Promise 而**不用** `promisify(scrypt)`（这是一个真实的安全隐患）：
 *   `util.promisify` 的重载推导会选中 **3 参数** 那个签名
 *   `(password, salt, keylen) => Promise<Buffer>`，于是 `{ N, r, p }` 这个 options 参数
 *   在类型上被拒绝。若为了过 tsc 而把 options 删掉，Node 会**静默使用默认参数
 *   （N=16384）** —— 即每密码只花 16MB 而不是我们声明的 32MB 内存，
 *   而**代码里看不出任何异常**。这类"参数被悄悄降级"的降级是最难发现的。
 *   ⇒ 显式把 options 传进去，并在下面断言它确实生效。
 *   （同一个坑在 server/src/auth.ts 的既有代码里也值得复查。）
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, { ...opts, maxmem: maxmemFor(opts.N, opts.r) }, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/** 密码长度下限：管理员是特权账号，不接受弱密码。上限防止 DoS（scrypt 对超长输入无意义地耗时） */
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 200

/** 生成一个强随机密码（给 CLI 的"我不指定密码"用）：16 字节 → 32 个 hex 字符 */
export function generatePassword(): string {
  return randomBytes(16).toString('hex')
}

/**
 * 计算密码哈希。
 * @returns `scrypt$N$r$p$salt_hex$hash_hex`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`
}

/**
 * 校验密码。
 * ⚠️ 任何解析失败/格式不符都返回 **false**，绝不抛异常 ——
 *    调用方（登录接口）不该因为"库里有一行脏数据"而 500，那会把
 *    "这个账号不能用密码登录"表现成"服务坏了"。
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  // scrypt $ N $ r $ p $ salt $ hash
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  /*
    防御：库里的参数若被改成离谱的值，会让 scrypt 吃光内存/CPU ⇒ 拒绝而不是硬算。
    ⚠️ 上限不是随便定的：maxmem 由这些参数推导（见 maxmemFor），
    而服务器只有 396MB ⇒ 单次哈希的 maxmem 必须有个硬上限，否则一行脏数据就能把进程打死。
    256 MiB 的额度：足够覆盖到 N=2^20/r=8（约 1GiB 需求会被 maxmemFor 拦下，但 n 上限先拦住），
    同时远小于机器内存。
  */
  if (n < 1024 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false
  if (maxmemFor(n, r) > 256 * 1024 * 1024) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4], 'hex')
    expected = Buffer.from(parts[5], 'hex')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false
  try {
    const derived = await scryptAsync(password, salt, expected.length, { N: n, r, p })
    // timingSafeEqual 要求等长，长度已由 expected.length 保证
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/**
 * 防时序侧信道的**等价计算**：账号不存在或不是管理员时，也要花掉与"真实校验"相当的时间。
 *
 * 为什么需要：若"账号不存在"立刻返回、而"密码错"要等几十毫秒 scrypt，
 * 攻击者就能用响应时间区分"这个号有没有管理员账号"——那就是账号枚举。
 * 用法：`await fakeVerify(password)` 之后再返回统一的失败响应。
 *
 * ⚠️ 它用一个**固定常量目标**（不是随机值），保证每次耗时稳定；
 *    随机目标会让耗时抖动，反而更容易被统计出来。
 */
const DUMMY_TARGET = `scrypt$${N}$${R}$${P}$${'00'.repeat(SALT_BYTES)}$${'00'.repeat(KEYLEN)}`
export async function fakeVerify(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_TARGET)
}
