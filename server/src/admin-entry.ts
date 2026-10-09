import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { normalizePhone } from './auth.ts'
import { listDelivered, readLatestCode } from './devSink.ts'
import { generatePassword, hashPassword, PASSWORD_MIN } from './password.ts'

/**
 * 运维 CLI。
 *
 * 为什么需要它（审核记录 06）：造账号这类**测试夹具能力不要伪装成业务 API** ——
 * 曾经有个默认关闭的 `POST /api/auth/dev-register`，即使关着也意味着生产二进制里
 * 永久带着一个"条件开启的注册能力"。现在放到这里：只能由有服务器登录权限的人执行。
 *
 * M3 Slice 0B 起用户的登录身份是**手机号**（密码登录已退休）。
 * 017 起**管理员**恢复了一条密码登录路径（短信通道故障时管理端必须仍可达），
 * 因此这里多了 set-password。
 *
 * 用法（在服务器上，以 campus 身份读 server.env）：
 *   node admin.mjs create-user <phone> <displayName> [handle]
 *   node admin.mjs list-users
 *   node admin.mjs set-password <phone> [password]   # 省略 password 则自动生成并打印一次
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
      const r = await pool.query<{ id: string; handle: string; display_name: string; phone_e164: string | null; role: string; has_pw: boolean }>(
        `select id, handle, display_name, phone_e164, role, (password_hash is not null) as has_pw
           from users order by phone_e164 nulls last, handle`,
      )
      for (const row of r.rows) {
        // role / 是否设过密码都要显示：这两个正是"能不能登管理端"的关键状态，
        // 排查登录问题时一眼可见，不必再手写 SQL
        const flags = `${row.role === 'admin' ? 'ADMIN' : 'student'}${row.has_pw ? ' +pw' : ''}`
        console.log(`${row.id}  ${row.phone_e164 ?? '(无手机号)'}  ${flags}  ${row.handle}  ${row.display_name}`)
      }
      return
    }

    if (cmd === 'set-password') {
      const [phoneRaw, passwordRaw] = args
      if (!phoneRaw) {
        console.error('用法: admin.mjs set-password <phone> [password]')
        console.error('  ⚠️ 只给**已存在且 role=admin** 的账号设密码；它不会创建账号、也不会改角色')
        process.exit(2)
      }
      const phone = normalizePhone(phoneRaw)
      if (!phone || !PHONE_OK.test(phone)) {
        console.error(`[admin] 手机号不合法: ${phoneRaw}`)
        process.exit(2)
      }
      const target = await pool.query<{ id: string; role: string; display_name: string }>(
        'select id, role, display_name from users where phone_e164 = $1',
        [phone],
      )
      const user = target.rows[0]
      if (!user) {
        console.error(`[admin] 没有这个手机号的账号: ${phone}`)
        console.error('  ⇒ 先用 create-user 建账号，再用 SQL 把它设为 admin：')
        console.error(`     update users set role='admin' where phone_e164='${phone}';`)
        process.exit(3)
      }
      // ⚠️ 刻意要求 role=admin：不在这里顺手提权。提权是另一个动作，应当被单独看见、单独决定。
      if (user.role !== 'admin') {
        console.error(`[admin] 该账号不是管理员（role=${user.role}）⇒ 拒绝设密码`)
        console.error('  ⇒ 先显式提权：')
        console.error(`     update users set role='admin' where phone_e164='${phone}';`)
        process.exit(3)
      }

      // 未给密码 ⇒ 自动生成强随机密码，只打印一次（不落盘、不进日志）
      const generated = !passwordRaw
      const password = generated ? generatePassword() : passwordRaw
      if (password.length < PASSWORD_MIN) {
        console.error(`[admin] 密码至少 ${PASSWORD_MIN} 位`)
        process.exit(2)
      }

      const hash = await hashPassword(password)
      await pool.query('update users set password_hash = $1 where id = $2', [hash, user.id])

      console.log(`[admin] 已为 ${phone}（${user.display_name}）设置密码`)
      if (generated) {
        console.log('')
        console.log(`  生成的密码（只显示这一次）: ${password}`)
        console.log('')
        console.log('  ⚠️ 请立刻保存到密码管理器；本命令不落盘、也不会再显示。')
      }
      /*
        ⚠️ 如实说明一处**未做**的事：这次改动**没有**写 audit_log。
        原因：audit_log.actor_id 是 `NOT NULL REFERENCES users(id)`，而本命令是**运维身份**
        在服务器 shell 执行的，没有对应的 user 行。硬造一个"系统用户"会污染 list-users
        与审计里的管理员列表 —— 那是拿一个更糟的问题换一个好看的表。
        ⇒ 因此"谁在什么时候改了管理员密码"目前只留在服务器 shell 历史 / journal 里。
        若要正式审计，需要给 audit_log 加一个可空的 actor_label（或 separate ops_audit 表），
        那是独立的一次改动，不夹在这里偷偷做。
      */
      return
    }

    console.error('用法: admin.mjs <create-user|list-users|set-password|latest-code> ...')
    process.exit(2)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[admin] 失败:', (err as Error).message)
  process.exit(1)
})
