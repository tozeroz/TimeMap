import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { normalizePhone } from './auth.ts'
import { listDelivered, readLatestCode } from './devSink.ts'

/**
 * 运维 CLI。
 *
 * 为什么需要它（审核记录 06）：造账号这类**测试夹具能力不要伪装成业务 API** ——
 * 曾经有个默认关闭的 `POST /api/auth/dev-register`，即使关着也意味着生产二进制里
 * 永久带着一个"条件开启的注册能力"。现在放到这里：只能由有服务器登录权限的人执行。
 *
 * M3 Slice 0B 起用户的登录身份是**手机号**（密码登录已退休）。
 *
 * 用法（在服务器上，以 campus 身份读 server.env）：
 *   node admin.mjs create-user <phone> <displayName> [handle]
 *   node admin.mjs list-users
 *   node admin.mjs latest-code            # 读 dev sink 里最近一次验证码（本地人工操作）
 */
const PHONE_OK = /^\+[1-9][0-9]{7,14}$/
const DISPLAY_MAX = 40
const HANDLE_MAX = 40

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  const sink = process.env.LOGIN_CODE_SINK ?? '/run/campus/login-codes'

  if (cmd === 'latest-code') {
    // 只读 dev sink，不连数据库：这条命令要给"人"用，越简单越好
    const latest = readLatestCode(sink)
    if (!latest) {
      console.error(`[admin] dev sink(${sink}) 里没有投递记录`)
      process.exit(4)
    }
    console.log(`phone=${latest.phone_e164}  code=${latest.code}  expires_at=${latest.expires_at}`)
    const others = listDelivered(sink)
    if (others.length > 1) console.log(`(sink 中还有 ${others.length} 个号码的投递记录)`)
    return
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('缺少 DATABASE_URL')
    process.exit(2)
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
  try {
    if (cmd === 'create-user') {
      const [phoneRaw, displayName, handleRaw] = args
      const errors: string[] = []
      const phone = phoneRaw ? normalizePhone(phoneRaw) : null
      if (!phoneRaw) errors.push('用法: admin.mjs create-user <phone> <displayName> [handle]')
      else if (!phone || !PHONE_OK.test(phone)) errors.push(`手机号不合法: ${phoneRaw}`)
      if (displayName && displayName.length > DISPLAY_MAX) {
        errors.push(`displayName 不能超过 ${DISPLAY_MAX} 字`)
      }
      if (handleRaw && handleRaw.length > HANDLE_MAX) errors.push(`handle 不能超过 ${HANDLE_MAX} 字`)
      if (errors.length) {
        errors.forEach((e) => console.error(`[admin] ${e}`))
        process.exit(2)
      }

      const exists = await pool.query('select 1 from users where phone_e164 = $1', [phone])
      if (exists.rowCount) {
        console.error(`[admin] 该手机号已有账号: ${phone}（不覆盖，避免误改既有账号）`)
        process.exit(3)
      }
      const id = randomUUID()
      const name = (displayName ?? '').trim() || `校园用户${phone!.slice(-4)}`
      const handle = (handleRaw ?? '').trim() || name
      await pool.query(
        `insert into users (id, handle, display_name, phone_e164) values ($1, $2, $3, $4)`,
        [id, handle, name, phone],
      )
      console.log(`[admin] 已创建用户 id=${id} phone=${phone} display_name=${name}`)
      return
    }

    if (cmd === 'list-users') {
      const r = await pool.query<{ id: string; handle: string; display_name: string; phone_e164: string | null }>(
        'select id, handle, display_name, phone_e164 from users order by phone_e164 nulls last, handle',
      )
      for (const row of r.rows) {
        console.log(`${row.id}  ${row.phone_e164 ?? '(无手机号)'}  ${row.handle}  ${row.display_name}`)
      }
      return
    }

    console.error('用法: admin.mjs <create-user|list-users|latest-code> ...')
    process.exit(2)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[admin] 失败:', (err as Error).message)
  process.exit(1)
})
