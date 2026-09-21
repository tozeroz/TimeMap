import type { PoolClient } from 'pg'

/**
 * M4 备份期的 media mutation barrier（审核记录 19 的 P0）。
 *
 * ## 要解决的问题
 *
 * 之前的 `PRE_BACKUP_CROSS_REFERENCE_INTEGRITY` 只能保证**备份开始前**两侧一致，
 * 它挡不住这个时序：
 * ```
 * 检查通过 → pg_dump 完成 → 用户上传新图（DB 行 + 文件都成功）
 *          → uploads.tar 开始，把新文件收进去，但 pg_dump 里没有这条 DB 行
 * ```
 * 结果：数据库与媒体归档**各自都内部正确，但不属于同一个逻辑时刻**。
 * 恢复出来就是"有文件没行"或"有行没文件"。
 *
 * ## 机制：PostgreSQL advisory lock
 *
 * - 备份进程：`pg_advisory_lock(KEY)` —— **排他**，持有一整个备份窗口
 * - 影响 media generation 的业务写：`pg_advisory_xact_lock_shared(KEY)` —— **共享**，
 *   随事务提交/回滚自动释放
 *
 * 语义正好：排他会等待已有共享释放、并阻塞新的共享 ——
 * 于是 **备份窗口内这些写操作无法进入**，窗口结束后自动放行。
 * 普通读取**不加锁**，完全不受影响。
 *
 * ## 为什么不用"应用层 maintenance flag"
 *
 * flag 要求**每个写路径都记得检查**：将来有人新加一个会改 media 引用的接口，
 * 忘了检查就漏了 —— 而且不会有任何报错。advisory lock 把约束放在**数据库层**，
 * 只要走这个 helper 就自动受约束，与本项目"防线放在数据库层"的既有纪律一致
 * （同 scope 复合外键那次也是这个思路）。
 *
 * ## 强度边界（不要夸大）
 *
 * - 它保证的是**本进程/本库内**遵循同一把锁的写操作被串行化；
 *   直接连库改数据（例如我手工 psql）**不会**受约束 —— 这是管理面操作，
 *   不在业务写路径上，Gate 只断言业务路径。
 * - 用 `xact` 版本（事务级）而不是会话级：避免"忘了 unlock 导致永久锁死"。
 *   事务结束即释放，这是最关键的安全性。
 */

/** 锁键。取 "M4BA" 的十六进制，避免与其它用途撞号。 */
export const MEDIA_MUTATION_LOCK_KEY = 0x4d34_4241

/** 业务写操作在备份窗口内的最大等待时间；超时给出明确错误，而不是无限等待。 */
const LOCK_TIMEOUT_MS = 5000

/**
 * 在**当前事务**内取得 media mutation 的共享锁。
 *
 * 必须在一个已开始的事务里调用（`begin` 之后）。
 * 事务提交或回滚时锁自动释放 —— 这是刻意选择：不会有"忘记解锁"的漏子。
 *
 * 备份窗口内调用会**阻塞**，超过 LOCK_TIMEOUT_MS 抛错；
 * 调用方应把这种错误翻译成 **503（服务暂时不可用）**，
 * 而不是 500 或静默成功 —— 语义是"稍后重试"，不是"出错了"。
 */
export async function acquireMediaMutationLock(client: PoolClient): Promise<void> {
  // lock_timeout 只影响本次事务，不会污染连接池里的后续使用者
  await client.query(`set local lock_timeout = '${LOCK_TIMEOUT_MS}ms'`)
  await client.query('select pg_advisory_xact_lock_shared($1)', [MEDIA_MUTATION_LOCK_KEY])
}

/**
 * 判断错误是否来自"备份窗口导致锁等待超时"。
 * 调用方据此返回 503 + Retry-After，而不是把它当成普通 DB 故障。
 */
export function isBarrierTimeout(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined
  if (e?.code === '55P03') return true // lock_not_available
  return typeof e?.message === 'string' && /lock timeout|canceling statement due to lock/i.test(e.message)
}
