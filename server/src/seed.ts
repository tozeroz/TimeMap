import type { PoolClient } from 'pg'
import { hashPassword } from './auth.ts'

/**
 * Seed（M2.5）。
 *
 * 审核记录 05 的 P0：**必须是 convergent，不能只是 non-destructive**。
 *
 * 反例（假幂等）：
 *   seed 源把 Alice 改成 Alice Zhang，但库里同 UUID 已有旧行
 *   → `ON CONFLICT DO NOTHING` 什么都不做 → 库里还是 Alice
 *   → Gate 跑两次"完全一致"，其实已经偏离 canonical seed。
 *
 * 正确做法：
 *   1. 用 `ON CONFLICT (id) DO UPDATE SET ...` 让库**收敛**到 seed 规格
 *   2. Gate 断言 `fresh+once` == `fresh+twice` == canonical 期望哈希
 *
 * 另外：所有实体使用**固定 UUID + 固定时间戳**，这样"逻辑内容哈希"才是确定的。
 * `--reset` 只允许人工显式调用，Gate 不会自动调用它。
 */

/** 固定命名空间：uuid v5 风格的确定性 id 不用引入依赖，直接写死即可 */
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'

/** 固定的 seed 时间戳：让内容哈希稳定（不随运行时间变化） */
const T0 = '2026-09-01T00:00:00.000Z'

export interface SeedUser {
  id: string
  handle: string
  displayName: string
  /** 仅 seed 用；真实环境不会把明文口令写进仓库 */
  password: string
}

export const SEED_USERS: ReadonlyArray<SeedUser> = [
  { id: U1, handle: 'anmoss', displayName: 'anmoss', password: 'seed-password-1' },
  { id: U2, handle: 'lemy', displayName: 'Lemy', password: 'seed-password-2' },
  { id: U3, handle: 'azur', displayName: 'Azur冰弦', password: 'seed-password-3' },
]

/** seed 的帖子：作者用上面的固定用户，时间戳固定 */
export interface SeedPost {
  id: string
  authorId: string
  body: string
  place: string | null
}

export const SEED_POSTS: ReadonlyArray<SeedPost> = [
  {
    id: 'aaaaaaaa-0001-4001-8001-000000000001',
    authorId: U1,
    body: '而我不再觉得，孤独是一种遗憾。',
    place: '北京交通大学',
  },
  {
    id: 'aaaaaaaa-0002-4002-8002-000000000002',
    authorId: U2,
    body: '在大理淘到了好多漂亮的小物品，已经迫不及待想布置宿舍了。',
    place: '北京交通大学',
  },
  {
    id: 'aaaaaaaa-0003-4003-8003-000000000003',
    authorId: U3,
    body: '图书馆四楼靠窗的位置下午三点后基本没光，适合睡觉不适合背书（亲测）。',
    place: '北京交通大学',
  },
]

export interface SeedResult {
  users: number
  posts: number
}

/**
 * 执行 seed。
 * @param client 调用方传入的事务客户端（seed 在**单个事务**里完成，失败整体回滚）
 */
export async function runSeed(client: PoolClient): Promise<SeedResult> {
  // ---- users：convergent（改 seed 源之后，重跑会把库改过来）----
  for (const u of SEED_USERS) {
    // 口令哈希每次都重算：scrypt 带随机 salt，所以哈希本身每次都不同，
    // 这正是为什么"内容哈希"比较必须排除 password_hash（见 logicalContentHash）
    const hash = await hashPassword(u.password)
    await client.query(
      `insert into users (id, handle, display_name, password_hash, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $5)
       on conflict (id) do update
         set handle = excluded.handle,
             display_name = excluded.display_name,
             password_hash = excluded.password_hash,
             updated_at = excluded.updated_at`,
      [u.id, u.handle, u.displayName, hash, T0],
    )
  }

  // ---- posts：同样 convergent ----
  for (const p of SEED_POSTS) {
    const display = SEED_USERS.find((u) => u.id === p.authorId)!.displayName
    await client.query(
      `insert into posts (id, author_name, author_id, body, place, created_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update
         set author_name = excluded.author_name,
             author_id   = excluded.author_id,
             body        = excluded.body,
             place       = excluded.place,
             created_at  = excluded.created_at`,
      [p.id, display, p.authorId, p.body, p.place, T0],
    )
  }

  return { users: SEED_USERS.length, posts: SEED_POSTS.length }
}

/**
 * seed 的**逻辑内容哈希**：用于 Gate 判定"两次 seed 结果一致"。
 *
 * 只取 seed 拥有的字段，并按主键排序；
 * **必须排除 password_hash**（scrypt 每次 salt 不同，天然每次都不一样，
 * 把它算进去会导致"永远不一致"，从而让这条断言失去意义）。
 */
export function seedLogicalQueries(): string[] {
  // 注意：必须 `as line` 起别名。之前漏了别名，PostgreSQL 返回的列名是 "?column?"，
  // 于是 row.line 是 undefined，hash.update(undefined) 直接抛错 —— 已修。
  return [
    `select (id::text || '|' || handle || '|' || display_name || '|' ||
            to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as line
       from users where id in (${SEED_USERS.map((u) => `'${u.id}'`).join(',')})
      order by id`,
    `select (id::text || '|' || coalesce(author_id::text,'') || '|' || body || '|' ||
            coalesce(place,'') || '|' ||
            to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as line
       from posts where id in (${SEED_POSTS.map((p) => `'${p.id}'`).join(',')})
      order by id`,
  ]
}

/** 显式清空 seed 拥有实体（只给 --reset 用，Gate 不会调用） */
export async function resetSeed(client: PoolClient): Promise<void> {
  await client.query(
    `delete from posts where id in (${SEED_POSTS.map((p) => `'${p.id}'`).join(',')})`,
  )
  await client.query(`delete from users where id in (${SEED_USERS.map((u) => `'${u.id}'`).join(',')})`)
}
