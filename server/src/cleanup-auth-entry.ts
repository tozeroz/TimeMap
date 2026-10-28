/**
 * 认证相关表的清扫 CLI（E3）—— `sessions` 与 `login_challenges` 的过期/死亡数据回收。
 *
 * 依据：审核记录 39（明确了顺序：先查状态分布 → 冻结 retention 语义 → 独立 auth cleanup → Gate 查 stale/dead）
 *      与 E2 冻结文档 `docs/archive/legacy-development/m5/E2-RETENTION-FREEZE-auth.md`。
 *      E1 审计输出：`docs/archive/legacy-development/m5/EVIDENCE-auth-hygiene-audit.txt`。
 *
 * ===========================================================================
 * ## 为什么是**独立工具**，而不是塞进 media cleanup
 * ===========================================================================
 * 审核明确要求分开。理由（我认同）：
 *   media 的生命周期是"**DB 行 + 磁盘文件**"两件东西要一起对，
 *   auth 的生命周期只是"**DB 行**"。把两者塞进一个工具，
 *   会让"媒体清扫出错"与"认证清扫出错"的**破坏半径叠在一起**，
 *   而它们该被独立地 dry-run、独立地审查、独立地回滚。
 *
 * ## 为什么本工具**不**取 media 的备份屏障（与 cleanup.mjs 的关键差别）
 * ===========================================================================
 * `cleanup.mjs` 的 `--apply` 要拿 `acquireMediaMutationLock` 的共享锁，因为
 * media 有**磁盘文件**：若在备份窗口内删掉"DB 行 + 文件"，会与 pg_dump / uploads.tar 的
 * 时间点产生不一致（dump 里有行、tar 里没文件，或反之）。
 *
 * **auth 表没有文件系统对应物** —— 删一行 auth 数据不会让"备份里的 DB"与"备份里的文件"
 * 产生分歧。因此这里**不需要**屏障，也不应该假装需要（那会平白把本工具与备份进程耦合）。
 * ⚠ 但这一点必须在代码里写明，否则后人会问"为什么 cleanup.mjs 有、这里没有"。
 *
 * ## 硬约束（来自 E2 冻结文档，本文件必须逐条遵守）
 * ===========================================================================
 * 只有这四类算"确定已经死亡"（且都必须**超过 grace**）：
 *   ① EXPIRED_SESSION     expires_at < now()-grace  AND revoked_at IS NULL
 *   ② REVOKED_SESSION     revoked_at IS NOT NULL    AND revoked_at < now()-grace
 *   ③ EXPIRED_CHALLENGE   expires_at < now()-grace  AND consumed_at IS NULL
 *   ④ CONSUMED_CHALLENGE  consumed_at IS NOT NULL   AND consumed_at < now()-grace
 *
 * **绝不删除**（无论数量、无论 age）：
 *   · ACTIVE_SESSION           revoked_at IS NULL AND expires_at > now()
 *   · VALID_PENDING_CHALLENGE  consumed_at IS NULL AND expires_at > now()
 *
 * ⚠️ `sessions` **没有** last_used_at / last_seen_at 之类字段
 *    → **无法**据"多久没用"判死亡。谁将来想加"清掉 30 天没用的会话"，
 *      那个判据在本 schema 下**无依据**，必须先加字段并单独过审。
 *
 * ⚠️ ①②互斥、③④互斥（用 `revoked_at IS NULL` / `consumed_at IS NULL` 分开），
 *    这样四类数字相加恰好等于"总删除数"，不会重复计数导致对不上账。
 *
 * ## 用法
 *   node dist/cleanup-auth.mjs                          # dry-run（默认）
 *   node dist/cleanup-auth.mjs --json                   # 机器可读（供 Gate 断言）
 *   node dist/cleanup-auth.mjs --apply                  # 真删（仅上面四类）
 *   node dist/cleanup-auth.mjs --apply --grace-hours 0  # 演练用：连刚产生的也删
 *
 * ## 退出码
 *   0 正常（含 dry-run）／2 缺 DATABASE_URL（拒绝执行）／1 运行错误
 */
import { Pool } from 'pg'

/** 解析 `--k v` 形式的参数（沿用 cleanup-entry.ts 的约定） */
function parseArgs(argv: string[]): {
  apply: boolean
  json: boolean
  graceHours: number
} {
  const has = (f: string) => argv.includes(f)
  const val = (f: string, dflt: number): number => {
    const i = argv.indexOf(f)
    if (i < 0) return dflt
    const n = Number(argv[i + 1])
    return Number.isFinite(n) && n >= 0 ? n : dflt
  }
  return {
    apply: has('--apply'),
    json: has('--json'),
    graceHours: val('--grace-hours', 24),
  }
}

interface Counts {
  expiredSessions: number
  revokedSessions: number
  expiredChallenges: number
  consumedChallenges: number
  /** 绝不删的两类（只报告，用于让人看到"我们确实没动它们"） */
  activeSessions: number
  pendingChallenges: number
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[cleanup-auth] 缺少 DATABASE_URL —— 拒绝在没有目标库的情况下清扫（避免误删）')
    process.exit(2)
  }

  const pool = new Pool({ connectionString: url, max: 2 })
  const grace = `${args.graceHours} hours`

  try {
    // ---- 先统计（dry-run 与 apply 都要报同一套数字，便于比对）----
    const q = async (sql: string): Promise<number> => {
      const r = await pool.query<{ n: string }>(sql)
      return Number.parseInt(r.rows[0]?.n ?? '0', 10)
    }

    /**
     * 计数用的四类判据，必须与删除用的 WHERE 子句**逐字一致**。
     * 这里刻意写成同一份 SQL 片段并复用（见下 DEAD_PREDICATES），
     * 而不是在两处各写一遍 —— 两处写两遍正是"计数说 5、实际删 3"这类账对不上的经典来源。
     */
    const DEAD_PREDICATES = {
      expiredSessions: `expires_at < now() - interval '${grace}' and revoked_at is null`,
      revokedSessions: `revoked_at is not null and revoked_at < now() - interval '${grace}'`,
      expiredChallenges: `expires_at < now() - interval '${grace}' and consumed_at is null`,
      consumedChallenges: `consumed_at is not null and consumed_at < now() - interval '${grace}'`,
    } as const

    const counts: Counts = {
      expiredSessions: await q(`select count(*) as n from sessions where ${DEAD_PREDICATES.expiredSessions}`),
      revokedSessions: await q(`select count(*) as n from sessions where ${DEAD_PREDICATES.revokedSessions}`),
      expiredChallenges: await q(`select count(*) as n from login_challenges where ${DEAD_PREDICATES.expiredChallenges}`),
      consumedChallenges: await q(`select count(*) as n from login_challenges where ${DEAD_PREDICATES.consumedChallenges}`),
      // 这两类永不删；只报告规模，供人核对"清扫没有碰到它们"
      activeSessions: await q(`select count(*) as n from sessions where revoked_at is null and expires_at > now()`),
      pendingChallenges: await q(`select count(*) as n from login_challenges where consumed_at is null and expires_at > now()`),
    }

    const totalDead = counts.expiredSessions + counts.revokedSessions + counts.expiredChallenges + counts.consumedChallenges

    let deleted: Counts | null = null
    if (args.apply && totalDead > 0) {
      /**
       * 单事务删除：要么四类全删、要么一条不删。
       * 为什么需要：若中途失败（连接断、锁超时），半删状态会让
       * "哪些已清、哪些没清"变得不可知，而本工具是要被反复调度的；
       * 单事务让失败后的状态**可确定**（回滚 = 什么都没发生）。
       */
      const client = await pool.connect()
      try {
        await client.query('begin')
        const d = {
          expiredSessions: (
            await client.query(`delete from sessions where ${DEAD_PREDICATES.expiredSessions}`)
          ).rowCount ?? 0,
          revokedSessions: (
            await client.query(`delete from sessions where ${DEAD_PREDICATES.revokedSessions}`)
          ).rowCount ?? 0,
          expiredChallenges: (
            await client.query(`delete from login_challenges where ${DEAD_PREDICATES.expiredChallenges}`)
          ).rowCount ?? 0,
          consumedChallenges: (
            await client.query(`delete from login_challenges where ${DEAD_PREDICATES.consumedChallenges}`)
          ).rowCount ?? 0,
          activeSessions: 0,
          pendingChallenges: 0,
        }
        // 账目自查：删除数与先前的计数**必须一致**（不一致说明并发写入或判据漂移）
        const sumDeleted = d.expiredSessions + d.revokedSessions + d.expiredChallenges + d.consumedChallenges
        if (sumDeleted !== totalDead) {
          await client.query('rollback')
          console.error(
            `[cleanup-auth] 账目不一致：预计删 ${totalDead} 行，实际删 ${sumDeleted} 行 —— 已回滚，一行未删`,
          )
          process.exitCode = 1
          return
        }
        await client.query('commit')
        deleted = d
      } catch (err) {
        await client.query('rollback').catch(() => undefined)
        throw err
      } finally {
        client.release()
      }
    }

    const report = {
      mode: args.apply ? 'apply' : 'dry-run',
      graceHours: args.graceHours,
      deadTotal: totalDead,
      ...counts,
      deleted,
      // 显式声明"哪些没被碰"，便于人一眼核对
      neverDeleted: {
        activeSessions: counts.activeSessions,
        pendingChallenges: counts.pendingChallenges,
      },
    }

    if (args.json) {
      console.log(JSON.stringify(report))
    } else {
      console.log(`[cleanup-auth] 模式: ${report.mode}（retention grace = ${args.graceHours}h）`)
      console.log('[cleanup-auth] 确定已死的数据（四类互斥，相加= 总数）:')
      console.log(`  expiredSessions     = ${counts.expiredSessions}`)
      console.log(`  revokedSessions     = ${counts.revokedSessions}`)
      console.log(`  expiredChallenges   = ${counts.expiredChallenges}`)
      console.log(`  consumedChallenges  = ${counts.consumedChallenges}`)
      console.log(`  ----------  合计    = ${totalDead}`)
      console.log('[cleanup-auth] 绝不删除（仅报告）:')
      console.log(`  activeSessions      = ${counts.activeSessions}`)
      console.log(`  pendingChallenges   = ${counts.pendingChallenges}`)
      if (deleted) {
        console.log('[cleanup-auth] 已删除:')
        console.log(`  行合计 = ${deleted.expiredSessions + deleted.revokedSessions + deleted.expiredChallenges + deleted.consumedChallenges}`)
      } else if (!args.apply) {
        console.log('[cleanup-auth] dry-run 结束：未删除任何行（要真删请加 --apply）')
      } else {
        console.log('[cleanup-auth] 没有符合判据的数据，未删除任何行')
      }
    }
  } catch (err) {
    console.error('[cleanup-auth] 失败:', (err as Error).message)
    process.exit(1)
  } finally {
    await pool.end().catch(() => undefined)
  }
}

await main()
