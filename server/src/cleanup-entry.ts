/**
 * 媒体孤儿清扫 CLI（M4）。
 *
 * 依据：审核记录 13 第 4/5 条（失败原子性 / orphan cleanup）+ PLAN §6。
 *
 * 设计原则（与"定向清理测试残留"同一条纪律）：
 *   1. **默认 dry-run**：不加 `--apply` 只打印、什么都不删；
 *   2. 只删"**能明确判定为孤儿**"的文件：DB 里查不到对应 media 行 **且**
 *      文件 mtime 早于阈值（默认 24h）—— 后者是为了不误删"刚上传、DB 还没写完"的文件；
 *   3. 只扫 uploads/public 与 uploads/private，**不碰** .tmp 之外的其它目录；
 *   4. 删除前打印完整清单与字节数；删除后打印实际删除数；
 *   5. 绝不按"看起来像临时文件"删未知内容。
 *
 * 为什么必须存在这个工具：
 *   上传采用"先写文件、后写 DB 行"的顺序 —— 这是为了不让 DB 出现悬空引用
 *   （比"DB 说有图、取不到"更可接受的是"盘上多一个文件"）。
 *   代价就是进程在两步之间崩溃时可能留下**孤儿文件**，需要离线清扫。
 *
 * 用法：
 *   node dist/cleanup.mjs                          # dry-run（默认）
 *   node dist/cleanup.mjs --apply                  # 真删（仅早于 24h 的孤儿）
 *   node dist/cleanup.mjs --apply --max-age-hours 0  # 演练用：连新文件也删
 *   node dist/cleanup.mjs --json                   # 机器可读输出（供 Gate 断言）
 *
 * 退出码：0 正常（含 dry-run）／2 缺 DATABASE_URL（拒绝执行）／
 *        3 备份窗口内被屏障挡住（**一个文件都没删**）／1 其它失败
 *
 * ## 备份期屏障（M4，审核记录 19 的 P0）
 *
 * `--apply` 会**真的删磁盘文件**，属于"改变 media generation"的写路径，
 * 因此整个删除段跑在一个**共享 advisory 锁**事务里
 * （`acquireMediaMutationLock`，与备份进程的排他锁同一把 KEY）。
 * 备份窗口内它拿不到锁（lock_timeout 到点抛错）→ 本轮**不删任何文件**、退出码 3，
 * 由人工在备份结束后重跑。这样"备份 tar 与删除"不会交叠。
 *
 * 两点如实说明，别把保证说大：
 *   1. 共享锁之间**互不冲突**，所以持锁期间**上传仍可并发进行** ——
 *      这里挡的只是"清扫与备份窗口重叠"，不是"清扫期间引用集不变"。
 *      "刚写完文件、DB 行还没落"的那类竞态仍然由 mtime 阈值（--max-age-hours）负责。
 *   2. dry-run 只读、不删文件，**不加锁**（备份期间照样能跑，这是设计的一部分）。
 */
import { readdir, stat, unlink } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { Pool } from 'pg'
import { acquireMediaMutationLock, isBarrierTimeout } from './mutationBarrier.ts'

interface Args {
  apply: boolean
  json: boolean
  maxAgeHours: number
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
    root: process.env.UPLOAD_ROOT ?? '/srv/campus/uploads',
  }
}

/** 递归列出某目录下的所有文件（返回相对 root 的路径，如 public/2026/09/x.png） */
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
      out.push(relative(root, full))
    }
  }
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
      下面整个删除段都待在共享锁事务里（见文件头"备份期屏障"）。
      dry-run 是纯读，**不加锁** —— 备份期间它照样要能用。
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
          // fail-closed：拿不到锁就一个文件都不删。退出码 3 与"配置缺失=2""其它失败=1"区分开
          console.error(
            '[cleanup] 备份窗口进行中（media mutation barrier 生效）：本轮**未删除任何文件**，退出码 3。请在备份结束后重跑。',
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

    if (args.json) {
      console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', scanned: files.length, referenced, tooNew, orphans, totalBytes }))
    } else {
      console.log(`[cleanup] 模式=${args.apply ? 'APPLY（真删）' : 'dry-run（只打印）'}  阈值=${args.maxAgeHours}h`)
      console.log(`[cleanup] 扫描 ${files.length} 个文件：被引用 ${referenced}，太新（跳过）${tooNew}，孤儿 ${orphans.length}`)
      for (const o of orphans) {
        console.log(`  孤儿 ${o.rel}  ${o.bytes} 字节  mtime 约 ${o.ageHours}h 前`)
      }
      if (orphans.length) console.log(`[cleanup] 孤儿合计 ${totalBytes} 字节（${(totalBytes / 1024).toFixed(1)} KB）`)
    }

    if (!args.apply) {
      if (!args.json) console.log('[cleanup] dry-run 结束：未删除任何文件（要真删请加 --apply）')
      return
    }

    // 3) 删除段（apply）：仍在共享锁事务内 —— 备份窗口内根本走不到这里
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
    if (!args.json) console.log(`[cleanup] 已删除 ${removed} 个孤儿文件，回收 ${removedBytes} 字节`)
    else console.log(JSON.stringify({ mode: 'apply', removed, removedBytes }))

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
