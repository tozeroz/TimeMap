import pg from 'pg'
import initSql from './migrations/001_init.sql'
import type { AppConfig } from './config.ts'

/**
 * 迁移清单。
 *
 * 为什么把 SQL 显式 import 进数组，而不是运行时读目录：
 * 部署形态是「本地 esbuild 打成单文件 → 服务器零 node_modules」，
 * 服务器上没有 migrations/ 目录，SQL 必须在打包时内联进来。
 * 新增迁移就往这个数组追加一项（顺序即执行顺序）。
 */
export const MIGRATIONS: ReadonlyArray<{ version: string; sql: string }> = [
  { version: '001_init', sql: initSql },
]

export interface Db {
  pool: pg.Pool
  /** 连接可用性（ready 检查用，不抛异常） */
  ping(): Promise<boolean>
  /** 已应用迁移数（ready 检查用） */
  appliedMigrationCount(): Promise<number>
  /** 执行未应用的迁移；可重复调用（幂等） */
  migrate(): Promise<{ applied: string[]; skipped: string[] }>
  close(): Promise<void>
}

export function createDb(cfg: AppConfig): Db {
  const pool = new pg.Pool({
    connectionString: cfg.databaseUrl,
    max: cfg.poolMax,
    idleTimeoutMillis: cfg.poolIdleTimeoutMs,
    connectionTimeoutMillis: cfg.poolConnectionTimeoutMs,
  })
  // 连接池里的空闲连接报错不应该让进程崩掉
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message)
  })

  return {
    pool,

    async ping(): Promise<boolean> {
      try {
        await pool.query('select 1')
        return true
      } catch (err) {
        console.error('[db] ping failed:', (err as Error).message)
        return false
      }
    },

    async appliedMigrationCount(): Promise<number> {
      try {
        const r = await pool.query<{ n: string }>('select count(*)::text as n from schema_migrations')
        return Number.parseInt(r.rows[0]?.n ?? '0', 10)
      } catch {
        // schema_migrations 还不存在（全新库）→ 视为 0
        return 0
      }
    },

    async migrate(): Promise<{ applied: string[]; skipped: string[] }> {
      const applied: string[] = []
      const skipped: string[] = []

      // schema_migrations 自己必须先存在，才能记录版本
      await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `)

      const existing = new Set(
        (await pool.query<{ version: string }>('select version from schema_migrations')).rows.map(
          (r) => r.version,
        ),
      )

      for (const m of MIGRATIONS) {
        if (existing.has(m.version)) {
          skipped.push(m.version)
          continue
        }
        // 每个迁移一个事务：失败就整体回滚，不会留半截 schema
        const client = await pool.connect()
        try {
          await client.query('begin')
          await client.query(m.sql)
          await client.query('insert into schema_migrations(version) values ($1)', [m.version])
          await client.query('commit')
          applied.push(m.version)
        } catch (err) {
          await client.query('rollback').catch(() => undefined)
          throw new Error(`migration ${m.version} failed: ${(err as Error).message}`)
        } finally {
          client.release()
        }
      }

      return { applied, skipped }
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}
