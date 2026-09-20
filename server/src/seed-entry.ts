import { createHash } from 'node:crypto'
import pg from 'pg'
import { runSeed, resetSeed, seedLogicalQueries } from './seed.ts'

/**
 * seed 命令行入口（M2.5）。
 *
 * 为什么要单独打一个 bundle：
 * 部署形态是「服务器零 node_modules」，所以和 API 一样用 esbuild 打成单文件再传上去。
 * 这样 seed 能直接复用 auth.ts 的 scrypt 实现 —— 口令哈希参数与线上一模一样，
 * 不需要在服务器上装任何东西，也不需要把数据库口令拷到开发机。
 *
 * 用法：
 *   node seed.mjs            # convergent seed（可重复执行，结果收敛）
 *   node seed.mjs --reset    # 先删 seed 实体再灌（仅限演练环境，Gate 不会调用）
 *   node seed.mjs --hash     # 只打印 seed 的逻辑内容哈希（Gate 用来对比两次运行）
 */
async function main() {
  const args = process.argv.slice(2)
  const doReset = args.includes('--reset')
  const hashOnly = args.includes('--hash')

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('缺少 DATABASE_URL')
    process.exit(2)
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })

  try {
    if (hashOnly) {
      const h = await logicalHash(pool)
      console.log(`SEED_HASH ${h}`)
      return
    }

    // seed 全程在**单个事务**里：失败不会留下半套数据
    const client = await pool.connect()
    try {
      await client.query('begin')
      if (doReset) {
        console.log('[seed] --reset：先删除 seed 拥有的实体')
        await resetSeed(client)
      }
      const result = await runSeed(client)
      await client.query('commit')
      console.log(`[seed] rows=${result.rows} tables=${result.tables.join(',')}`)
    } catch (err) {
      await client.query('rollback').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }

    const h = await logicalHash(pool)
    console.log(`SEED_HASH ${h}`)
  } finally {
    await pool.end()
  }
}

/** 对 seed 拥有的实体算"逻辑内容哈希"：按主键排序后拼接，再 SHA-256 */
async function logicalHash(pool: pg.Pool): Promise<string> {
  const hash = createHash('sha256')
  for (const q of seedLogicalQueries()) {
    const r = await pool.query<{ line: string }>(q)
    for (const row of r.rows) hash.update(row.line).update('\n')
  }
  return hash.digest('hex')
}

main().catch((err) => {
  console.error('[seed] 失败:', (err as Error).message)
  process.exit(1)
})
