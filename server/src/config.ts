/**
 * 运行时配置。
 *
 * 全部走环境变量，默认值面向当前部署形态：
 *   Node 只监听 127.0.0.1:3001（公网唯一入口是 Nginx），数据库只走本地 socket/TCP。
 */
export interface AppConfig {
  host: string
  port: number
  databaseUrl: string
  /** 连接池上限：396MB 内存的机器上必须受限，不是无限连接 */
  poolMax: number
  poolIdleTimeoutMs: number
  poolConnectionTimeoutMs: number
  /** 写入时没有会话时的回退展示名（M3 起新帖作者一律来自会话，这个只用于极少数兜底） */
  defaultAuthorName: string
  /** CORS 白名单；空数组表示不放开任何跨域来源 */
  corsOrigins: string[]
  /** session 有效期（天）。审核要求：不允许永不过期的会话 */
  sessionTtlDays: number

  // ---- M3 Slice 0B：手机号 + 一次性验证码 ----
  /**
   * 验证码 HMAC 的服务端密钥。
   * **必须由部署时生成**（见 tools/deploy-server.ps1 写入 server.env），不进 git。
   * 缺失时验证码相关接口一律失败关闭（503），绝不退化成"没密钥也能登录"。
   */
  loginCodeHmacKey: string
  /** 验证码有效期（秒） */
  loginCodeTtlSeconds: number
  /** 同一手机号在窗口内最多请求几次验证码 */
  loginRequestMax: number
  /** 单条验证码最多允许校验失败几次（防 6 位码穷举） */
  loginVerifyMaxAttempts: number
  /** 限流窗口（秒） */
  loginWindowSeconds: number
  /** 开发用验证码投递目录（tmpfs 优先；不写普通日志） */
  loginCodeSink: string
  /** 是否信任 X-Forwarded-For（只为 Nginx 本机反代开启） */
  trustProxy: string
}

/**
 * 默认 CORS 白名单：客户端有两个来源
 *   - Capacitor APK 里的 WebView：https://localhost
 *   - 本地浏览器预览：http://127.0.0.1:517x
 * 用白名单而不是 `*`，避免以后接上真实域名时留下过宽策略。
 *
 * 注意：M2 之后即使上了 HTTPS，这里也**不能**删 —— https://localhost 与 https://<IP>
 * 仍然是不同 origin，跨源策略照旧生效。
 */
export const DEFAULT_CORS_ORIGINS = [
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
]

function readList(name: string, fallback: string[]): string[] {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.HOST ?? '127.0.0.1',
    port: readInt('PORT', 3001),
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgresql://campus@127.0.0.1:5432/campus',
    poolMax: readInt('PG_POOL_MAX', 5),
    poolIdleTimeoutMs: readInt('PG_IDLE_TIMEOUT_MS', 10_000),
    poolConnectionTimeoutMs: readInt('PG_CONNECT_TIMEOUT_MS', 5_000),
    defaultAuthorName: process.env.DEFAULT_AUTHOR ?? '我',
    corsOrigins: readList('CORS_ORIGINS', DEFAULT_CORS_ORIGINS),
    sessionTtlDays: readInt('SESSION_TTL_DAYS', 30),

    loginCodeHmacKey: process.env.LOGIN_CODE_HMAC_KEY ?? '',
    loginCodeTtlSeconds: readInt('LOGIN_CODE_TTL_SECONDS', 300),
    loginRequestMax: readInt('LOGIN_REQUEST_MAX', 5),
    loginVerifyMaxAttempts: readInt('LOGIN_VERIFY_MAX_ATTEMPTS', 5),
    loginWindowSeconds: readInt('LOGIN_WINDOW_SECONDS', 300),
    loginCodeSink: process.env.LOGIN_CODE_SINK ?? '/run/campus/login-codes',
    trustProxy: process.env.TRUST_PROXY ?? '127.0.0.1',
  }
}
