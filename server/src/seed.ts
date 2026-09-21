import type { PoolClient } from 'pg'

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
 * 所有实体使用**固定 UUID + 固定时间戳**，这样"逻辑内容哈希"才是确定的。
 * `--reset` 只允许人工显式调用，Gate 不会自动调用它。
 */

/** 固定 seed 时间戳：让内容哈希稳定（不随运行时间变化） */
const T0 = '2026-09-01T00:00:00.000Z'

// ---------------------------------------------------------------------------
// 固定 id（写死而不是随机生成：种子每次跑出来必须是同一个库状态）
// ---------------------------------------------------------------------------
const U = {
  anmoss: '11111111-1111-4111-8111-111111111111',
  lemy: '22222222-2222-4222-8222-222222222222',
  azur: '33333333-3333-4333-8333-333333333333',
} as const

const P = {
  p1: 'aaaaaaaa-0001-4001-8001-000000000001',
  p2: 'aaaaaaaa-0002-4002-8002-000000000002',
  p3: 'aaaaaaaa-0003-4003-8003-000000000003',
} as const

const M = {
  m1: 'bbbbbbbb-0001-4001-8001-000000000001',
  m2: 'bbbbbbbb-0002-4002-8002-000000000002',
} as const

export interface SeedUser {
  id: string
  handle: string
  displayName: string
  /**
   * 登录身份（E.164）。
   *
   * M3 Slice 0B 起登录方式只有「手机号 + 一次性验证码」，所以 seed 用户也必须带手机号，
   * 否则根本没法登录。这里用**明显是编造**的号段 138 0000 000x
   * （13800000001/2/3），不会撞到任何真实用户。
   */
  phone: string
}

export const SEED_USERS: ReadonlyArray<SeedUser> = [
  { id: U.anmoss, handle: 'anmoss', displayName: 'anmoss', phone: '+8613800000001' },
  { id: U.lemy, handle: 'lemy', displayName: 'Lemy', phone: '+8613800000002' },
  { id: U.azur, handle: 'azur', displayName: 'Azur冰弦', phone: '+8613800000003' },
]

type Row = Record<string, string | number | null>

/**
 * 通用 convergent upsert。
 *
 * 表名与列名都来自本文件里的字面量（不是外部输入），因此这里拼接 SQL 是安全的；
 * 值一律走参数绑定。
 */
async function upsert(client: PoolClient, table: string, id: string, values: Row): Promise<void> {
  const cols = ['id', ...Object.keys(values)]
  const params = [id, ...Object.values(values)]
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
  const updates = Object.keys(values)
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')
  await client.query(
    `insert into ${table} (${cols.join(', ')}) values (${placeholders})
     on conflict (id) do update set ${updates}`,
    params,
  )
}

export interface SeedResult {
  rows: number
  tables: string[]
}

/** 执行 seed。调用方传入事务客户端：整体成功或整体回滚。 */
export async function runSeed(client: PoolClient): Promise<SeedResult> {
  let rows = 0
  const tables: string[] = []
  const put = async (table: string, id: string, values: Row) => {
    await upsert(client, table, id, values)
    rows++
    if (!tables.includes(table)) tables.push(table)
  }

  // ---- users ----
  for (const u of SEED_USERS) {
    await put('users', u.id, {
      handle: u.handle,
      display_name: u.displayName,
      phone_e164: u.phone,
      created_at: T0,
      updated_at: T0,
    })
  }

  // ---- places：来源 poi-search「地点名 + 地址」 ----
  const placeJiaoda = 'cccccccc-0001-4001-8001-000000000001'
  await put('places', placeJiaoda, {
    name: '北京交通大学',
    address: '西直门外上园村3号',
    latitude: 39.9519,
    longitude: 116.3373,
    created_at: T0,
  })

  // ---- posts：作者引用上面的固定用户 ----
  const postBodies: Array<[string, string, string]> = [
    [P.p1, U.anmoss, '而我不再觉得，孤独是一种遗憾。'],
    [P.p2, U.lemy, '在大理淘到了好多漂亮的小物品，已经迫不及待想布置宿舍了。'],
    [P.p3, U.azur, '图书馆四楼靠窗的位置下午三点后基本没光，适合睡觉不适合背书（亲测）。'],
  ]
  for (const [id, authorId, body] of postBodies) {
    const display = SEED_USERS.find((u) => u.id === authorId)!.displayName
    await put('posts', id, {
      author_name: display,
      author_id: authorId,
      body,
      place: '北京交通大学',
      place_id: placeJiaoda,
      created_at: T0,
    })
  }

  // ---- media：逻辑 key 而不是完整 URL（未来切对象存储时 DB 不用改）----
  await put('media', M.m1, {
    post_id: P.p1,
    storage_key: '2026/09/seed-anmoss-1.webp',
    mime: 'image/webp',
    bytes: 184320,
    width: 1080,
    height: 1440,
    position: 0,
    created_at: T0,
  })
  await put('media', M.m2, {
    post_id: P.p2,
    storage_key: '2026/09/seed-lemy-1.webp',
    mime: 'image/webp',
    bytes: 210944,
    width: 1080,
    height: 1350,
    position: 0,
    created_at: T0,
  })

  // ---- comments ----
  // 顶层评论 1 条。
  await put('comments', 'dddddddd-0001-4001-8001-000000000001', {
    post_id: P.p1,
    author_id: U.lemy,
    parent_id: null,
    body: '这句话我很喜欢。',
    created_at: T0,
  })

  /*
    回复 1 条（parent_id 指向上面那条）。
    M3 Slice 1 观察到原版的评论区是「顶层评论 + 嵌套回复」结构（MODEL SUPPORTED /
    PRESENTATION EXPANDED），且「评论 N」的计数**把回复也算进去**。
    种子里补这一条，是为了让这条语义在我们的 demo 里有真实数据可演示与可验证 ——
    否则层级结构只能靠临时手工造数据，回归时容易漏。
  */
  await put('comments', 'dddddddd-0002-4001-8001-000000000002', {
    post_id: P.p1,
    author_id: U.azur,
    parent_id: 'dddddddd-0001-4001-8001-000000000001',
    body: '同感，尤其是最后一句。',
    created_at: T0,
  })

  // ---- likes ----
  await put('likes', 'eeeeeeee-0001-4001-8001-000000000001', {
    post_id: P.p1,
    user_id: U.lemy,
    created_at: T0,
  })
  await put('likes', 'eeeeeeee-0002-4002-8002-000000000002', {
    post_id: P.p1,
    user_id: U.azur,
    created_at: T0,
  })

  // ---- 会话与消息（来源 message / chat）----
  const thread = 'ffffffff-0001-4001-8001-000000000001'
  await put('message_threads', thread, { kind: 'direct', title: null, created_at: T0 })
  await put('thread_members', 'ffffffff-0002-4002-8002-000000000002', {
    thread_id: thread,
    user_id: U.anmoss,
    joined_at: T0,
  })
  await put('thread_members', 'ffffffff-0003-4003-8003-000000000003', {
    thread_id: thread,
    user_id: U.lemy,
    joined_at: T0,
  })
  await put('messages', 'ffffffff-0004-4004-8004-000000000004', {
    thread_id: thread,
    sender_id: U.lemy,
    body: '你也在图书馆吗？',
    created_at: T0,
  })
  await put('messages', 'ffffffff-0005-4005-8005-000000000005', {
    thread_id: thread,
    sender_id: U.anmoss,
    body: '在四楼靠窗这边。',
    created_at: T0,
  })

  // ---- 留言板（来源 message-board「仅双方可见」）----
  await put('board_notes', '99999999-0001-4001-8001-000000000001', {
    from_user_id: U.lemy,
    to_user_id: U.anmoss,
    body: '你的那张照片拍得真好看！',
    color: 'yellow',
    created_at: T0,
  })

  // ---- 群与群公告（来源 group / announce）----
  const group = '88888888-0001-4001-8001-000000000001'
  await put('groups', group, { name: '校园活动', owner_id: U.anmoss, created_at: T0 })
  await put('group_members', '88888888-0002-4002-8002-000000000002', {
    group_id: group,
    user_id: U.anmoss,
    role: 'owner',
    joined_at: T0,
  })
  await put('group_members', '88888888-0003-4003-8003-000000000003', {
    group_id: group,
    user_id: U.lemy,
    role: 'member',
    joined_at: T0,
  })
  await put('announcements', '88888888-0004-4004-8004-000000000004', {
    group_id: group,
    author_id: U.anmoss,
    title: '校园活动',
    body: '本周五下午三点在思源楼前有社团招新，欢迎来玩。',
    created_at: T0,
  })

  return { rows, tables }
}

/**
 * seed 的**逻辑内容哈希**查询（Gate 用来判定"两次 seed 结果一致"）。
 *
 * 只取 seed 拥有的行，按主键排序，每行拼成一行文本。
 *
 * 两个必须遵守的点：
 *  1. **排除 password_hash**：scrypt 每次 salt 不同，天然每次都不一样，
 *     把它算进去这条断言就永远失败、从而失去意义。
 *  2. **时间列统一转成 UTC 文本**：否则会话 TimeZone 一变哈希就变，同样会让断言失去意义。
 *
 * 这里刻意把每列的 SQL 表达式**写全**，而不是"按逗号切分再猜要不要包 to_char"——
 * 后者遇到 `coalesce(title,'')` 这种带逗号的表达式会切坏（第一版就是这么错的）。
 */
function ts(col: string): string {
  return `to_char(${col} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

interface HashSpec {
  table: string
  ids: readonly string[]
  /** 每项都是一个完整的 SQL 表达式 */
  cols: string[]
}

function hashSpecs(): HashSpec[] {
  const all: HashSpec[] = [
    {
      table: 'users',
      ids: SEED_USERS.map((u) => u.id),
      // M3 Slice 0B 起 users 有 phone_e164（登录身份），纳入内容哈希 ——
      // 它现在是 seed 的核心事实之一，被改掉必须让 canonical 哈希变化。
      // （password_hash 已随「密码登录退休」一起删除，不再需要"排除它"的说明。）
      cols: ['id::text', 'handle', 'display_name', 'phone_e164', ts('created_at')],
    },
    {
      table: 'posts',
      ids: [P.p1, P.p2, P.p3],
      cols: [
        'id::text',
        "coalesce(author_id::text,'')",
        'author_name',
        'body',
        "coalesce(place,'')",
        "coalesce(place_id::text,'')",
        ts('created_at'),
      ],
    },
    {
      table: 'media',
      ids: [M.m1, M.m2],
      cols: [
        'id::text',
        'post_id::text',
        'storage_key',
        'mime',
        'bytes::text',
        "coalesce(width::text,'')",
        "coalesce(height::text,'')",
        'position::text',
        ts('created_at'),
      ],
    },
    {
      table: 'comments',
      ids: ['dddddddd-0001-4001-8001-000000000001', 'dddddddd-0002-4001-8001-000000000002'],
      cols: [
        'id::text',
        'post_id::text',
        "coalesce(author_id::text,'')",
        "coalesce(parent_id::text,'')",
        'body',
        ts('created_at'),
      ],
    },
    {
      table: 'likes',
      ids: ['eeeeeeee-0001-4001-8001-000000000001', 'eeeeeeee-0002-4002-8002-000000000002'],
      cols: ['id::text', 'post_id::text', 'user_id::text', ts('created_at')],
    },
    {
      table: 'places',
      ids: ['cccccccc-0001-4001-8001-000000000001'],
      cols: [
        'id::text',
        'name',
        "coalesce(address,'')",
        "coalesce(latitude::text,'')",
        "coalesce(longitude::text,'')",
        ts('created_at'),
      ],
    },
    {
      table: 'message_threads',
      ids: ['ffffffff-0001-4001-8001-000000000001'],
      cols: ['id::text', 'kind', "coalesce(title,'')", ts('created_at')],
    },
    {
      table: 'thread_members',
      ids: ['ffffffff-0002-4002-8002-000000000002', 'ffffffff-0003-4003-8003-000000000003'],
      cols: ['id::text', 'thread_id::text', 'user_id::text', ts('joined_at')],
    },
    {
      table: 'messages',
      ids: ['ffffffff-0004-4004-8004-000000000004', 'ffffffff-0005-4005-8005-000000000005'],
      cols: [
        'id::text',
        'thread_id::text',
        "coalesce(sender_id::text,'')",
        'body',
        ts('created_at'),
      ],
    },
    {
      table: 'board_notes',
      ids: ['99999999-0001-4001-8001-000000000001'],
      cols: [
        'id::text',
        'from_user_id::text',
        'to_user_id::text',
        'body',
        "coalesce(color,'')",
        ts('created_at'),
      ],
    },
    {
      table: 'groups',
      ids: ['88888888-0001-4001-8001-000000000001'],
      cols: ['id::text', 'name', "coalesce(owner_id::text,'')", ts('created_at')],
    },
    {
      table: 'group_members',
      ids: ['88888888-0002-4002-8002-000000000002', '88888888-0003-4003-8003-000000000003'],
      cols: ['id::text', 'group_id::text', 'user_id::text', 'role', ts('joined_at')],
    },
    {
      table: 'announcements',
      ids: ['88888888-0004-4004-8004-000000000004'],
      cols: [
        'id::text',
        'group_id::text',
        "coalesce(author_id::text,'')",
        'title',
        'body',
        ts('created_at'),
      ],
    },
  ]
  return all
}

export function seedLogicalQueries(): string[] {
  return hashSpecs().map(({ table, ids, cols }) => {
    const expr = cols.join(" || '|' || ")
    const idList = ids.map((i) => `'${i}'`).join(',')
    // 注意：必须 `as line` 起别名。漏了别名时 PostgreSQL 返回的列名是 "?column?"，
    // 于是 row.line 是 undefined，hash.update(undefined) 直接抛错 —— 已踩过一次。
    return `select (${expr}) as line from ${table} where id in (${idList}) order by id`
  })
}

/** 显式清空 seed 拥有实体（只给 --reset 用，Gate 不会调用） */
export async function resetSeed(client: PoolClient): Promise<void> {
  // 顺序按外键反向：先删子表
  const del = async (table: string, ids: readonly string[]) => {
    if (!ids.length) return
    await client.query(`delete from ${table} where id in (${ids.map((i) => `'${i}'`).join(',')})`)
  }
  await del('announcements', ['88888888-0004-4004-8004-000000000004'])
  await del('group_members', [
    '88888888-0002-4002-8002-000000000002',
    '88888888-0003-4003-8003-000000000003',
  ])
  await del('groups', ['88888888-0001-4001-8001-000000000001'])
  await del('board_notes', ['99999999-0001-4001-8001-000000000001'])
  await del('messages', [
    'ffffffff-0004-4004-8004-000000000004',
    'ffffffff-0005-4005-8005-000000000005',
  ])
  await del('thread_members', [
    'ffffffff-0002-4002-8002-000000000002',
    'ffffffff-0003-4003-8003-000000000003',
  ])
  await del('message_threads', ['ffffffff-0001-4001-8001-000000000001'])
  await del('likes', ['eeeeeeee-0001-4001-8001-000000000001', 'eeeeeeee-0002-4002-8002-000000000002'])
  await del('comments', ['dddddddd-0001-4001-8001-000000000001', 'dddddddd-0002-4001-8001-000000000002'])
  await del('media', [M.m1, M.m2])
  await del('posts', [P.p1, P.p2, P.p3])
  await del('places', ['cccccccc-0001-4001-8001-000000000001'])
  await del('users', SEED_USERS.map((u) => u.id))
}
