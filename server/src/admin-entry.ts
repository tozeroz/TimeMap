import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { hashPassword, normalizeHandle } from './auth.ts'

/**
 * 运维 CLI（M2 收尾）。
 *
 * 为什么需要它：审核记录 06 要求把"造账号"从业务 API 里移出去 ——
 *   `POST /api/auth/dev-register` 即使是默认关闭的，也意味着生产二进制里
 *   永久带着一个"条件开启的注册能力"，环境变量配错就可能暴露出本不存在的产品能力。
 *   原则：**测试夹具能力不要伪装成业务 API**。
 *
 * 用法（在服务器上，以 campus 身份读 server.env）：
 *   node admin.mjs create-user <handle> <displayName> <password>
 *   node admin.mjs list-users
 *
 * 与 seed 的关系：seed 负责"固定测试用户 + 演示数据"（幂等、可重复）；
 * 本 CLI 负责"临时造一个账号"，不参与 Gate，也不改 seed 的 canonical 哈希。
 */
const PASSWORD_MIN = 8
const PASSWORD_MAX = 200
const HANDLE_MAX = 40
const DISPLAY_MAX = 40

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('缺少 DATABASE_URL')
    process.exit(2)
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
  try {
    if (cmd === 'create-user') {
      const [handleRaw, displayName, password] = args
      const errors: string[] = []
      if (!handleRaw) errors.push('用法: admin.mjs create-user <handle> <displayName> <password>')
      if (handleRaw && handleRaw.length > HANDLE_MAX) errors.push(`handle 不能超过 ${HANDLE_MAX} 字`)
      if (displayName && displayName.length > DISPLAY_MAX) {
        errors.push(`displayName 不能超过 ${DISPLAY_MAX} 字`)
      }
      if (password && password.length < PASSWORD_MIN) errors.push(`password 至少 ${PASSWORD_MIN} 位`)
      if (password && password.length > PASSWORD_MAX) errors.push(`password 不能超过 ${PASSWORD_MAX} 位`)
      if (errors.length) {
        errors.forEach((e) => console.error(`[admin] ${e}`))
        process.exit(2)
      }

      const handle = normalizeHandle(handleRaw)
      const exists = await pool.query('select 1 from users where lower(handle) = $1', [handle])
      if (exists.rowCount) {
        console.error(`[admin] handle 已存在: ${handleRaw}（不覆盖，避免误改既有账号）`)
        process.exit(3)
      }
      const id = randomUUID()
      const hash = await hashPassword(password)
      await pool.query(
        `insert into users (id, handle, display_name, password_hash) values ($1, $2, $3, $4)`,
        [id, handleRaw.trim(), displayName.trim(), hash],
      )
      console.log(`[admin] 已创建用户 id=${id} handle=${handleRaw.trim()}`)
      return
    }

    if (cmd === 'list-users') {
      const r = await pool.query<{ id: string; handle: string; display_name: string }>(
        'select id, handle, display_name from users order by handle',
      )
      for (const row of r.rows) console.log(`${row.id}  ${row.handle}  ${row.display_name}`)
      return
    }

    console.error('用法: admin.mjs <create-user|list-users> ...')
    process.exit(2)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[admin] 失败:', (err as Error).message)
  process.exit(1)
})
