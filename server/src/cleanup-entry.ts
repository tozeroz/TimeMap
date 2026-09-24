/**
 * 媒体清扫 CLI（M4 orphan + M5 unattached TTL GC）。
 *
 * 依据：审核记录 13 第 4/5 条、审核记录 19（备份期屏障）、M5 工作单 #2 修订 2
 * （审核记录 21：「上传成功、消息发送失败留下的 unattached media 必须有 TTL GC 生命周期」）。
 *
 * ## 它管**两类不同**的泄漏（刻意分开计数、分开报告，绝不合成一个数字）
 *
 *   A. **orphan（未登记文件）** —— 盘上有文件、DB 里没有对应 media 行。
 *      成因：上传是"先写文件、后写 DB 行"（为了不产生悬空引用），进程在两步之间死掉就留下它。
 *      判据：storage_key 全集里查不到文件名 **且** mtime 早于 `--max-age-hours`（默认 24h）。
 *
 *   B. **unattached（有行、有文件，但没有任何消息引用）** —— M5 新增。
 *      成因：用户上传成功、**接着发消息失败**（断网、会话过期、App 被杀），
 *      于是 media 行与文件都在，却永远没有 message_media 指向它 → 永久占磁盘。
 *      判据：`media.scope='private'` **且** 不存在任何 `message_media` 引用它
 *      **且** `media.created_at` 早于 `--unattached-max-age-hours`。
 *      注意它**不是** orphan：文件与行都在，只是没有引用关系 —— 两种泄漏的原因与
 *      处置窗口完全不同，混成一个数字就没法判断"到底哪条路径在漏"。
 *
 * ## unattached 的 TTL 取值依据（为什么是 24 小时）
 *
 * `--unattached-max-age-hours` 默认 **24**。这是**防误删在途图片**的下界，取值依据：
 *   1. 要覆盖的真实行为是"用户上传成功 → 消息发送失败"。发送失败**一定**发生在这次
 *      composer 会话里（网络断、会话过期），而不是"过一天再发" —— 24h 比这个真实窗口
 *      大出两个数量级，**在途图片不可能被这一轮清扫碰到**。
 *   2. 与既有阈值同口径：orphan 的 `--max-age-hours` 也是 24h。两个阈值表达同一件事
 *      （"这是不是一次进行中的操作的中间态"），取同一个值，读代码的人不用记两套数字。
 *   3. 与库内其它生命周期量级一致：登录验证码 TTL 是 300 秒（config.ts
 *      `LOGIN_CODE_TTL_SECONDS`）、会话 TTL 是 30 天（`SESSION_TTL_DAYS`）。
 *      24h 落在"分钟级在途状态"与"月级账号状态"之间 —— 它保护的是前者。
 *   4. 代价方向是**保守的**：阈值偏长只浪费磁盘（5MB 上限/张），偏短会删掉用户
 *      正打算发出的图。这一类错误不可恢复（文件没了），所以取长不取短，
 *      用 `--unattached-max-age-hours` 需要时再调。
 *
 *   **明确不覆盖**：把上传结果当"草稿"保留**超过一天**（例如编辑途中放着过夜）的正常用法。
 *   目前没有证据表明产品允许这种用法（没有 draft 概念），若将来出现，应另立一单把
 *   "草稿"建模出来，而不是靠调大这个阈值 —— 阈值只该是安全网，不是功能开关。
 *
 * ## 两条纪律（与本工具既有行为一致，不能破）
 *
 *   1. **默认 dry-run**：不加 `--apply` 只打印、什么都不删；
 *   2. **fail-closed**：`--apply` 的删除段跑在备份进程同一把 advisory 锁的**共享**模式下
 *      （`acquireMediaMutationLock`）。备份窗口内拿不到锁 → 打印明确信息、
 *      `process.exitCode = 3`、**一个文件都不删、一行 DB 都不删**（见文件末尾"备份期屏障"）。
 *      未挂载的 media 行同样是"改变 media generation"，所以**共用**这一段屏障，不另开一条不加锁的删除路径。
 *
 * ## 删除时"行与文件一起删"
 *
 *   unattached 的判定依赖于**行**（scope/created_at）与**引用关系**（message_media），
 *   而它占用的磁盘在**文件**上。只删行 → 文件变 orphan（下一轮才回收，中间还多一次误判风险）；
 *   只删文件 → 行还在、指向不存在的图（比 orphan 更糟，是"DB 说有图取不到"）。
 *   所以 `--apply` 时先删行、再删文件，两者在**同一个**共享锁事务窗口内完成。
 *
 * 用法：
 *   node dist/cleanup.mjs                                   # dry-run（默认）
 *   node dist/cleanup.mjs --apply                           # 真删（仅早于阈值的孤儿 + unattached）
 *   node dist/cleanup.mjs --apply --max-age-hours 0          # 演练用：连新文件也删
 *   node dist/cleanup.mjs --apply --unattached-max-age-hours 0  # 演练用：连刚上传的 unattached 也删
 *   node dist/cleanup.mjs --json                            # 机器可读输出（供 Gate 断言）
 *
 * 退出码：0 正常（含 dry-run）／2 缺 DATABASE_URL（拒绝执行）／
 *        3 备份窗口内被屏障挡住（**一个文件都没删**）／1 其它失败
 *
 * ## 备份期屏障（M4，审核记录 19 的 P0）
 *
 * `--apply` 会**真的删磁盘文件**，属于"改变 media generation"的写路径，
 * 因此整个删除段（orphan 文件 + unattached 行/文件）跑在一个**共享 advisory 锁**事务里
 * （`acquireMediaMutationLock`，与备份进程的排他锁同一把 KEY）。
 * 备份窗口内它拿不到锁（lock_timeout 到点抛错）→ 本轮**不删任何文件与行**、退出码 3，
 * 由人工在备份结束后重跑。这样"备份 tar 与删除"不会交叠。
 *
 * 三点如实说明，别把保证说大：
 *   1. 共享锁之间**互不冲突**，所以持锁期间**上传仍可并发进行** ——
 *      这里挡的只是"清扫与备份窗口重叠"，不是"清扫期间引用集不变"。
 *      "刚写完文件、DB 行还没落"的那类竞态仍然由 mtime 阈值（--max-age-hours）负责。
 *   2. unattached 的删除语句**自带 `not exists (message_media)` 判据**（不是"先查后删"），
 *      所以即使另一个会话在 SELECT 与 DELETE 之间刚把这条 media 挂到消息上，
 *      那条行也会被排除在外；删除后若对方再挂，会拿到外键错误 23503，
 *      消息接口把它翻译成 409 media_gone（"这张图已经不在了，重发一次"），
 *      而不是"消息发出去了但图没了"这种静默不一致。
 *   3. dry-run 只读、不删文件与行，**不加锁**（备份期间照样能跑，这是设计的一部分）。
 */
import { readdir, stat, unlink } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { PoolClient } from 'pg'
import { Pool } from 'pg'
import { acquireMediaMutationLock, isBarrierTimeout } from './mutationBarrier.ts'

interface Args {
  apply: boolean
  json: boolean
  /** orphan（未登记文件）的 mtime 阈值 */
  maxAgeHours: number
  /** unattached（无消息引用的 private media）的 created_at 阈值，见文件头"取值依据" */
  unattachedMaxAgeHours: number
  root: string
}

function parseArgs(argv: string[]): Args {
  const has = (f: string) => argv.includes(f)
  const val = (f: string, d: number) => {
    const i = argv.indexOf(f)
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d
  }
  return {
    apply: has('--apply'),
    json: has('--json'),
    maxAgeHours: val('--max-age-hours', 24),
    unattachedMaxAgeHours: val('--unattached-max-age-hours', 24),
    root: process.env.UPLOAD_ROOT ?? '/srv/campus/uploads',
  }
}

/**
 * 递归列出某目录下的所有文件（返回相对 root 的路径，如 public/2026/09/x.png）。
 *
 * **必须把分隔符统一成 '/'**：这些相对路径要拿去和 DB 里的 `media.storage_key` 比
 * （storage_key 恒为正斜杠形态，见上传路径 `${yyyy}/${mm}/${id}.${ext}`）。
 * `path.relative` 在 Windows 上返回反斜杠，若不归一化，比较**永远不相等** ——
 * 后果不是报错而是**静默失效**：所有文件都被当成孤儿候补、所有 unattached 行都被当成
 * "盘上无文件"（2026-09-21 在 Windows 上跑本工具时实测到：unattached 候选恒为空、
 * 而"有行无文件"的计数虚高）。服务器是 Linux，这个坑在那边不显现，本地验证才会碰到。
 */
async function walk(dir: string, root: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // 目录不存在不算错误（可能是首次部署）
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      await walk(full, root, out)
    } else if (e.isFile()) {
      out.push(relative(root, full).split(sep).join('/'))
    }
  }
}

interface UnattachedRow {
  id: string
  rel: string
  bytes: number
  ageHours: number
}

/**
 * 找出 unattached 的 private media：
 *   scope='private' 且 没有任何 message_media 引用 且 created_at 早于阈值。
 *
 * 用 **created_at**（行插入时刻，也是"文件落盘时刻"，上传是同事务内先写文件后写行）
 * 而不是文件 mtime：判断"用户多久以前传的"问的是 DB，而且 created_at 与消息发送
 * 用的是同一个库时钟，不受宿主机时钟漂移影响。
 *
 * scope='public' 的 media 刻意**不在**本类范围内：动态图片被引用在 post_media 上，
 * 而帖子可能是草稿态、也可能被删 —— 那属于另一条泄漏路径，需要单独的证据与设计，
 * 不能靠"看起来没人引用就删"来顺手处理（那会删掉草稿里的图）。
 */
async function findUnattached(client: PoolClient, ttlHours: number): Promise<UnattachedRow[]> {
  const q = await client.query<{ id: string; storage_key: string; bytes: number; age_hours: string }>(
    `select m.id, m.storage_key, m.bytes,
            extract(epoch from (now() - m.created_at)) / 3600.0 as age_hours
       from media m
      where m.scope = 'private'
        and m.created_at < now() - make_interval(hours => $1::int)
        and not exists (select 1 from message_media mm where mm.media_id = m.id)
      order by m.created_at`,
    [ttlHours],
  )
  // 只有**文件确实在盘上**的行才进候选：行/文件由上传在同一事务内一起落，
  // 缺文件说明已经不一致（那不是本工具该"顺手修"的情形，留给一致性检查报告）。
  const out: UnattachedRow[] = []
  for (const r of q.rows) {
    out.push({
      id: r.id,
      rel: `private/${r.storage_key}`,
      bytes: r.bytes,
      ageHours: Number(Number(r.age_hours).toFixed(1)),
    })
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[cleanup] 缺少 DATABASE_URL —— 拒绝在没有目标库的情况下清扫（避免误删）')
    process.exit(2)
  }

  const pool = new Pool({ connectionString: url, max: 2 })
  const client = await pool.connect()
  /** 事务是否已开启 —— 收尾时决定要不要显式 rollback */
  let inTx = false
  try {
    /*
      --apply 才是"改变 media generation"的写路径，只有它需要屏障：
      下面整个删除段（孤儿文件 + unattached 行与文件）都待在共享锁事务里
      （见文件头"备份期屏障"）。dry-run 是纯读，**不加锁** —— 备份期间它照样要能用。
    */
    if (args.apply) {
      await client.query('begin')
      inTx = true
      try {
        await acquireMediaMutationLock(client)
      } catch (err) {
        await client.query('rollback').catch(() => undefined)
        inTx = false
        if (isBarrierTimeout(err)) {
          // fail-closed：拿不到锁就一个文件都不删、一行都不删。
          // 退出码 3 与"配置缺失=2""其它失败=1"区分开
          console.error(
            '[cleanup] 备份窗口进行中（media mutation barrier 生效）：本轮**未删除任何文件与 media 行**（含 unattached），退出码 3。请在备份结束后重跑。',
          )
          process.exitCode = 3
          return
        }
        throw err
      }
    }

    // 1) 线上已知的 storage_key 全集（scope + key 组合）—— 纯读，不需要锁
    const r = await client.query<{ k: string }>("select scope || '/' || storage_key as k from media")
    const known = new Set(r.rows.map((x) => x.k))

    // 2) 盘上的文件
    const files: string[] = []
    await walk(join(args.root, 'public'), args.root, files)
    await walk(join(args.root, 'private'), args.root, files)
    /** 盘上文件集合（用于 unattached 的"文件是否真在盘上"判断，O(1) 查询） */
    const fileSet = new Set(files)

    const now = Date.now()
    const orphans: Array<{ rel: string; bytes: number; ageHours: number }> = []
    let tooNew = 0
    let referenced = 0
    for (const rel of files) {
      if (known.has(rel)) {
        referenced++
        continue
      }
      let st
      try {
        st = await stat(join(args.root, rel))
      } catch {
        continue
      }
      const ageHours = (now - st.mtimeMs) / 3600000
      if (ageHours < args.maxAgeHours) {
        // 太新：可能是"刚写完文件、DB 行还没落"的正常中间态 → 这一轮不动它
        tooNew++
        continue
      }
      orphans.push({ rel, bytes: st.size, ageHours: Number(ageHours.toFixed(1)) })
    }

    const totalBytes = orphans.reduce((a, o) => a + o.bytes, 0)

    // 3) unattached（A 类与 B 类**分开计数、分开报告**）
    //    apply 时这段已经拿到共享锁（上面），dry-run 时是纯读 —— 两种情况都安全。
    const found = await findUnattached(client, args.unattachedMaxAgeHours)
    // 只处理"文件确实在盘上"的行（缺文件属于行/文件不一致，见 findUnattached 注释），
    // 并把被排除的条数**报出来**，而不是悄悄少算 —— 静默的差额是这类工具最危险的地方。
    const unattached = found.filter((u) => fileSet.has(u.rel))
    const unattachedMissingFile = found.length - unattached.length
    const unattachedTotalBytes = unattached.reduce((a, u) => a + u.bytes, 0)

    if (args.json) {
      console.log(
        JSON.stringify({
          mode: args.apply ? 'apply' : 'dry-run',
          scanned: files.length,
          // A 类：盘上有文件、DB 无行
          referenced,
          tooNew,
          orphans,
          totalBytes,
          // B 类：DB 有行、盘上有文件，但没有任何 message_media 引用（且早于阈值）
          unattachedMaxAgeHours: args.unattachedMaxAgeHours,
          unattached,
          unattachedTotalBytes,
          // 有行、无引用、但盘上找不到文件的条数（本次**不动**，属行/文件不一致，另行报告）
          unattachedMissingFile,
        }),
      )
    } else {
      console.log(`[cleanup] 模式=${args.apply ? 'APPLY（真删）' : 'dry-run（只打印）'}  阈值=${args.maxAgeHours}h`)
      console.log(`[cleanup] 扫描 ${files.length} 个文件：被引用 ${referenced}，太新（跳过）${tooNew}，孤儿（未登记文件）${orphans.length}`)
      for (const o of orphans) {
        console.log(`  孤儿 ${o.rel}  ${o.bytes} 字节  mtime 约 ${o.ageHours}h 前`)
      }
      if (orphans.length) console.log(`[cleanup] 孤儿合计 ${totalBytes} 字节（${(totalBytes / 1024).toFixed(1)} KB）`)

      // 与上面**分开**报：这是另一类泄漏，原因是"消息没发出去"，不是"DB 没登记"
      console.log(`[cleanup] unattached（有 media 行、无任何消息引用）阈值=${args.unattachedMaxAgeHours}h：${unattached.length} 条`)
      for (const u of unattached) {
        console.log(`  未挂载 ${u.rel}  media=${u.id}  ${u.bytes} 字节  上传约 ${u.ageHours}h 前`)
      }
      if (unattached.length) {
        console.log(`[cleanup] unattached 合计 ${unattachedTotalBytes} 字节（${(unattachedTotalBytes / 1024).toFixed(1)} KB）`)
      }
      if (unattachedMissingFile > 0) {
        console.log(
          `[cleanup] 另有 ${unattachedMissingFile} 条 media 行已过期且无引用，但盘上找不到对应文件 —— **本轮不动**（行/文件不一致，属一致性报告范围）`,
        )
      }
    }

    if (!args.apply) {
      if (!args.json) console.log('[cleanup] dry-run 结束：未删除任何文件与 media 行（要真删请加 --apply）')
      return
    }

    // 4) 删除段（apply）：仍在共享锁事务内 —— 备份窗口内根本走不到这里
    //
    // 先删 unattached 的**行**（连同文件），再删孤儿**文件**。
    // 行的 DELETE 自带 not exists 判据：引用集在这一刻才最终确认，
    // 避免"查完到删之间有人挂上去"被连带删除。
    let unattachedRowsDeleted = 0
    let unattachedFilesDeleted = 0
    let unattachedBytesDeleted = 0
    const candidates = unattached.map((u) => u.id)
    const finalIds = new Set<string>()
    if (candidates.length) {
      const del = await client.query<{ id: string }>(
        `delete from media m
          where m.id = any($1::uuid[])
            and m.scope = 'private'
            and not exists (select 1 from message_media mm where mm.media_id = m.id)
        returning m.id`,
        [candidates],
      )
      for (const row of del.rows) finalIds.add(row.id)
      unattachedRowsDeleted = del.rowCount ?? 0
    }
    for (const u of unattached) {
      if (!finalIds.has(u.id)) continue // 期间被挂到消息上了 → 保留（宁可不删）
      try {
        await unlink(join(args.root, u.rel))
        unattachedFilesDeleted++
        unattachedBytesDeleted += u.bytes
      } catch (err) {
        // 行已经删了、文件删不掉（权限/竞态）：这才是真正的 orphan，下一轮按 A 类回收。
        console.error(`[cleanup] unattached 文件删除失败（将成为未登记文件，下一轮回收）${u.rel}: ${(err as Error).message}`)
      }
    }

    let removed = 0
    let removedBytes = 0
    for (const o of orphans) {
      try {
        await unlink(join(args.root, o.rel))
        removed++
        removedBytes += o.bytes
      } catch (err) {
        console.error(`[cleanup] 删除失败 ${o.rel}: ${(err as Error).message}`)
      }
    }
    if (!args.json) {
      console.log(
        `[cleanup] 已删除 ${removed} 个孤儿文件，回收 ${removedBytes} 字节；` +
          `已回收 ${unattachedRowsDeleted} 条 unattached media（文件 ${unattachedFilesDeleted} 个，${unattachedBytesDeleted} 字节）`,
      )
    } else {
      console.log(
        JSON.stringify({
          mode: 'apply',
          // A 类与 B 类分开报，供 Gate 分别断言
          removed,
          removedBytes,
          unattachedRowsDeleted,
          unattachedFilesDeleted,
          unattachedBytesDeleted,
        }),
      )
    }

    await client.query('commit')
    inTx = false
  } finally {
    // 出错时不留半开的事务（xact 锁本身会随事务结束释放，显式回滚是为了语义清楚）
    if (inTx) await client.query('rollback').catch(() => undefined)
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(`[cleanup] 失败: ${(err as Error).message}`)
  process.exit(1)
})
