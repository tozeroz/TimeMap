/**
 * 运行时配置。
 *
 * 全部走环境变量，默认值面向 M1 的部署形态：
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
  /** M1 遗留：无认证时代的占位作者名。M2 起新帖作者一律来自 session，这个字段只留着做兼容/回退 */
  defaultAuthorName: string
  /** CORS 白名单；空数组表示不放开任何跨域来源 */
  corsOrigins: string[]
  /** session 有效期（天）。审核要求：不允许永不过期的会话 */
  sessionTtlDays: number
  /** 登录失败限流：窗口内最多失败几次、窗口多长（秒） */
  loginMaxFailures: number
  loginWindowSeconds: number
}

/**
 * 默认 CORS 白名单：客户端有两个来源
 *   - Capacitor APK 里的 WebView：https://localhost
 *   - 本地浏览器预览：http://127.0.0.1:517x
 * 用白名单而不是 `*`，避免以后接上真实域名时留下过宽策略。
 *
 * 注意：M2 之后即使上 HTTPS，这里也**不能**删 —— https://localhost 与 https://<IP>
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
    loginMaxFailures: readInt('LOGIN_MAX_FAILURES', 10),
    loginWindowSeconds: readInt('LOGIN_WINDOW_SECONDS', 300),
  }
}
