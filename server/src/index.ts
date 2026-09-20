import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { DEFAULT_CORS_ORIGINS, loadConfig } from './config.ts'
import { createDb, MIGRATIONS, type Db } from './db.ts'

/**
 * Campus 后端（M1）。
 *
 * 健康检查刻意分成三个语义（审核要求，不许用一个 /health 假装证明三件事）：
 *   GET /health      —— Nginx 直接返回，证明「网关活着」（不在本进程里实现）
 *   GET /api/health  —— liveness：本进程活着
 *   GET /api/ready   —— readiness：能连 PG **且** schema 已就绪；不满足返回 503
 *
 * 业务只做一件事：文本帖子的写入与读回（M1 的 vertical slice）。
 */

const BODY_MAX = 500
const PLACE_MAX = 60
const AUTHOR_MAX = 40
const LIST_LIMIT = 50

interface PostRow {
  id: string
  author_name: string
  body: string
  place: string | null
  created_at: Date
}

export interface ServerDeps {
  db: Db
  defaultAuthorName: string
  corsOrigins?: string[]
}

export function buildServer(deps: ServerDeps) {
  const app = Fastify({
    logger: false,
    // 只信任本机反代
    trustProxy: '127.0.0.1',
  })

  const { db } = deps
  /**
   * CORS 白名单（默认值来自 config.ts 的 DEFAULT_CORS_ORIGINS，可被环境变量 CORS_ORIGINS 覆盖）：
   *   - Capacitor APK 里的 WebView：https://localhost
   *   - 本地浏览器预览：http://127.0.0.1:517x
   * 用白名单而不是 `*`：以后接真实域名时不会留下过宽策略。
   */
  const allowed = new Set(deps.corsOrigins ?? DEFAULT_CORS_ORIGINS)

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (typeof origin === 'string' && allowed.has(origin)) {
      reply.header('access-control-allow-origin', origin)
      reply.header('vary', 'Origin')
      reply.header('access-control-allow-methods', 'GET,POST,OPTIONS')
      reply.header('access-control-allow-headers', 'content-type')
      reply.header('access-control-max-age', '600')
    }
    if (req.method === 'OPTIONS') {
      reply.code(204).send()
    }
  })

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'campus-api',
    stage: 'M1',
    uptime_s: Math.round(process.uptime()),
  }))

  app.get('/api/ready', async (_req, reply) => {
    const dbOk = await db.ping()
    const applied = dbOk ? await db.appliedMigrationCount() : -1
    const expected = MIGRATIONS.length
    const ready = dbOk && applied === expected
    reply.code(ready ? 200 : 503)
    return {
      status: ready ? 'ready' : 'not_ready',
      db: dbOk ? 'up' : 'down',
      migrations: { applied, expected },
    }
  })

  app.get('/api/posts', async (_req, reply) => {
    try {
      const r = await db.pool.query<PostRow>(
        `select id, author_name, body, place, created_at
           from posts
          order by created_at desc, id desc
          limit $1`,
        [LIST_LIMIT],
      )
      return {
        items: r.rows.map((row) => ({
          id: row.id,
          author: row.author_name,
          body: row.body,
          place: row.place,
          createdAt: row.created_at.toISOString(),
        })),
      }
    } catch (err) {
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  app.post('/api/posts', async (req, reply) => {
    const payload = (req.body ?? {}) as Record<string, unknown>
    const body = typeof payload.body === 'string' ? payload.body.trim() : ''
    const placeRaw = typeof payload.place === 'string' ? payload.place.trim() : ''
    const authorRaw = typeof payload.author === 'string' ? payload.author.trim() : ''

    const errors: string[] = []
    if (!body) errors.push('body 不能为空')
    else if (body.length > BODY_MAX) errors.push(`body 不能超过 ${BODY_MAX} 字`)
    if (placeRaw.length > PLACE_MAX) errors.push(`place 不能超过 ${PLACE_MAX} 字`)
    if (authorRaw.length > AUTHOR_MAX) errors.push(`author 不能超过 ${AUTHOR_MAX} 字`)
    if (errors.length) {
      reply.code(400)
      return { error: 'invalid_payload', details: errors }
    }

    const id = randomUUID()
    const author = authorRaw || deps.defaultAuthorName
    const place = placeRaw || null

    try {
      const r = await db.pool.query<PostRow>(
        `insert into posts (id, author_name, body, place)
         values ($1, $2, $3, $4)
         returning id, author_name, body, place, created_at`,
        [id, author, body, place],
      )
      const row = r.rows[0]!
      reply.code(201)
      return {
        id: row.id,
        author: row.author_name,
        body: row.body,
        place: row.place,
        createdAt: row.created_at.toISOString(),
      }
    } catch (err) {
      reply.code(500)
      return { error: 'db_error', message: (err as Error).message }
    }
  })

  return app
}

/** 进程入口：跑迁移 → 起服务 */
async function main() {
  const cfg = loadConfig()
  const db = createDb(cfg)

  /**
   * 迁移失败**不能**让进程退出。
   * 原因：readiness 的语义是「能连 PG 且 schema 就绪，否则返回 503」——
   * 如果 PG 挂了进程就直接死，运维看到的是"连不上"，而不是一个明确说 503 的实例，
   * Gate 里的「停掉 PG → /api/ready 必须 503」也就无从验证。
   * 所以这里只报错并后台重试；schema 晚到也能自愈。
   */
  let migrateTimer: NodeJS.Timeout | null = null
  let migrated = false
  const tryMigrate = async (): Promise<void> => {
    try {
      const result = await db.migrate()
      if (result.applied.length) {
        console.log(`[migrate] applied=${result.applied.join(',')} skipped=${result.skipped.length}`)
      }
      migrated = true
      if (migrateTimer) {
        clearInterval(migrateTimer)
        migrateTimer = null
      }
    } catch (err) {
      console.error('[migrate] failed (will retry):', (err as Error).message)
    }
  }
  await tryMigrate()
  if (!migrated) {
    // 首次失败才起重试定时器；成功后自动停掉，不会一直空转
    migrateTimer = setInterval(() => {
      void tryMigrate()
    }, 10_000)
    migrateTimer.unref?.()
  }

  const app = buildServer({
    db,
    defaultAuthorName: cfg.defaultAuthorName,
    corsOrigins: cfg.corsOrigins,
  })

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal}`)
    if (migrateTimer) clearInterval(migrateTimer)
    await app.close().catch(() => undefined)
    await db.close().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ host: cfg.host, port: cfg.port })
  console.log(`[listen] http://${cfg.host}:${cfg.port}`)
}

// 仅在被当作入口执行时启动（import 时不启动，方便测试）
const isEntry =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`
if (isEntry) {
  main().catch((err) => {
    console.error('[fatal]', err)
    process.exit(1)
  })
}
