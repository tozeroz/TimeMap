import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import type { PoolClient } from 'pg'

/**
 * 生成一个**结构合法的 PNG**（给定尺寸的纯色块）。
 *
 * 为什么要它：M4 起种子必须同时落实体文件，否则 media 行就是悬空引用
 * （联合恢复演练的逐行核对会直接报"缺文件"）。
 *
 * 为什么手写而不是引依赖：服务器是 396MB 内存 + 单文件 esbuild 打包 + 无 node_modules，
 * 而"一个纯色 PNG"用 zlib 就能拼出来（IHDR/IDAT/IEND 三个 chunk），
 * 比引任何图片库都轻。真实上传的图片走的是 imageProbe + 客户端原始字节，与这里无关。
 */
function seedPng(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const crcTable: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeBuf = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
    return Buffer.concat([len, typeBuf, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // 每行：1 字节 filter(0) + width * 4 字节像素（灰色，便于人眼识别为占位图）
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x99)])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

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
  /** 挂在非校内地点（达美乐比萨）上，用于验证"按地点聚合动态"在第二个地点也有内容 */
  p4: 'aaaaaaaa-0004-4004-8004-000000000004',
} as const

const M = {
  m1: 'bbbbbbbb-0001-4001-8001-000000000001',
  m2: 'bbbbbbbb-0002-4002-8002-000000000002',
  /** M5 WO#9A：群聊里的图片消息所用媒体（scope=**private**，见群里第 3 条消息） */
  m3: 'bbbbbbbb-0003-4003-8003-000000000003',
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

  /*
    第二个地点：**非校内**，坐标在另一个城市。
    为什么补这一条（M3 Slice 4 记录的缺口）：
      poi-detail 的「距我N公里」需要"参照点 ≠ 目标地点"才有意义。
      只有校内那一个地点时，参照点（校区坐标）正好等于目标地点 → 永远显示「距我0公里」，
      数值对但退化，看不出这个功能到底有没有在工作。
    选址依据是**原版只读证据**：poi-detail 实测那条动态的地点就是
    「达美乐比萨(广州萝岗万达广场)」，地址与坐标按该证据填写
    （supplements/poi-detail.json，只读取得 → 可采信）。
    注意：原版显示的是「距我4公里」，那是因为**原版使用者当时在广州**；
    我们的参照点是北京校区，所以这条会显示一个跨城距离 —— 那是**正确行为**，
    只是内容不同，不作为一致性依据。
  */
  const placePizza = 'cccccccc-0002-4002-8002-000000000002'
  await put('places', placePizza, {
    name: '达美乐比萨(广州萝岗万达广场)',
    address: '联和街道科丰路89号开创大道2707号万达广场负一层商场B1006铺',
    latitude: 23.1776,
    longitude: 113.4404,
    created_at: T0,
  })

  // ---- posts：作者引用上面的固定用户 ----
  // 第 4 条挂在**非校内地点**上：让「按地点聚合动态」在第二个地点也有内容可看
  // （否则那条地点的详情页永远是空的，看不出聚合功能）。
  // 正文取自原版 poi-detail 实测那条评论的语义（「真的好好吃」），
  // 但作者是我们的 seed 用户 —— 不把原版他人的昵称搬进来。
  const postBodies: Array<[string, string, string, string, string]> = [
    [P.p1, U.anmoss, '而我不再觉得，孤独是一种遗憾。', '北京交通大学', placeJiaoda],
    [P.p2, U.lemy, '在大理淘到了好多漂亮的小物品，已经迫不及待想布置宿舍了。', '北京交通大学', placeJiaoda],
    [P.p3, U.azur, '图书馆四楼靠窗的位置下午三点后基本没光，适合睡觉不适合背书（亲测）。', '北京交通大学', placeJiaoda],
    [
      P.p4,
      U.lemy,
      '这家真的好好吃，肉多菜也多。',
      '达美乐比萨(广州萝岗万达广场)',
      placePizza,
    ],
  ]
  for (const [id, authorId, body, placeName, placeId] of postBodies) {
    const display = SEED_USERS.find((u) => u.id === authorId)!.displayName
    await put('posts', id, {
      author_name: display,
      author_id: authorId,
      body,
      place: placeName,
      place_id: placeId,
      created_at: T0,
    })
  }

  // ---- media + post_media：逻辑 key 而不是完整 URL（未来切对象存储时 DB 不用改）----
  //
  // M4 起 media 是**带 scope 的一等资源**（迁移 006）：
  //   - scope='public'：动态图片，Nginx 静态下发
  //   - 归属通过 post_media 关联（**复合外键钉死 scope**，跨 scope 引用结构上不可能）
  //
  // **顺序很重要**：先造出真实文件字节，再按文件算 sha256 与 bytes。
  // 旧版是"先写死一个 sha256、再假定文件存在"，结果 DB 说有图、盘上取不到 ——
  // 这正是 M4 联合恢复演练抓出来的悬空引用缺陷。
  // 文件本身不参与 canonical 哈希（哈希只覆盖 DB 行），所以不影响种子口径。
  interface SeedMedia { id: string; owner: string; key: string; png: Buffer; w: number; h: number }
  const seedMedia: SeedMedia[] = [
    { id: M.m1, owner: U.anmoss, key: '2026/09/seed-anmoss-1.png', w: 1080, h: 1440 },
    { id: M.m2, owner: U.lemy, key: '2026/09/seed-lemy-1.png', w: 1080, h: 1350 },
  ].map((m) => ({ ...m, png: seedPng(m.w, m.h) }))

  for (const m of seedMedia) {
    await put('media', m.id, {
      owner_user_id: m.owner,
      scope: 'public',
      storage_key: m.key,
      mime: 'image/png',
      bytes: m.png.length,
      width: m.w,
      height: m.h,
      sha256: createHash('sha256').update(m.png).digest('hex'),
      upload_request_id: m.id, // seed 用同一个固定 id 作幂等键（确定性）
      created_at: T0,
    })
  }

  /*
    种子也要**落实体文件**（M4 联合恢复演练抓出来的真实缺陷）。

    问题：此前 seed 只往 media 表写行，storage_key 指向的文件根本不存在 ——
    于是库里"说有图"、盘上"取不到"，正是整个 M4 设计要防的**悬空引用**。
    上传接口用"先写文件、后写 DB 行"的顺序避免它；种子里同样必须成立。

    做法：把上面已经生成好的 PNG 字节（与 DB 行的 sha256/bytes 同源）写到
    uploads/public 下与 storage_key 相同的位置。
    文件不参与 seed 的 canonical 哈希（哈希只覆盖 DB 行），所以这不改变种子口径。

    注意：这是 best-effort —— 本地开发环境可能没有 /srv/campus/uploads，
    此时只打印警告而不让 seed 失败（但会明确说"文件未写"，避免静默假成功）。
  */
  const uploadRoot = process.env.UPLOAD_ROOT ?? '/srv/campus/uploads'
  let filesWritten = 0
  const fileErrors: string[] = []
  for (const m of seedMedia) {
    const full = path.join(uploadRoot, 'public', m.key)
    try {
      await mkdir(path.dirname(full), { recursive: true, mode: 0o755 })
      await writeFile(full, m.png, { mode: 0o644 })
      filesWritten++
    } catch (err) {
      fileErrors.push(`${m.key}: ${(err as Error).message}`)
    }
  }
  if (fileErrors.length === 0) {
    console.log(`[seed] media 实体文件已写 ${filesWritten} 个（→ ${uploadRoot}/public/…）`)
  } else {
    console.log(`[seed] ⚠ media 文件有 ${fileErrors.length} 个未写入（DB 行已建，盘上会缺文件）：${fileErrors.join('; ')}`)
  }

  // ---------------------------------------------------------------------------
  // 私聊（群内）图片媒体 —— M5 WO#9A
  //
  // 与公开媒体**分两个目录、两种访问控制**（审核记录 13 第 6 条，本项目最重的安全约束之一）：
  //   public  → uploads/public/…  可被 Nginx 静态下发
  //   private → uploads/private/… **没有静态入口**，只能经 GET /api/media/:id
  //             走 session → can_read_media（会话成员判定）后由 X-Accel 内部重定向下发
  // 种子必须与上传接口同构：**先写文件、再算 sha256/bytes**，否则 media 行就是悬空引用。
  // ---------------------------------------------------------------------------
  interface SeedChatMedia { id: string; owner: string; key: string; png: Buffer; w: number; h: number }
  const seedChatMedia: SeedChatMedia[] = [
    { id: M.m3, owner: U.anmoss, key: '2026/09/seed-group-anmoss-1.png', w: 1080, h: 1440 },
  ].map((m) => ({ ...m, png: seedPng(m.w, m.h) }))

  for (const m of seedChatMedia) {
    await put('media', m.id, {
      owner_user_id: m.owner,
      scope: 'private',
      storage_key: m.key,
      mime: 'image/png',
      bytes: m.png.length,
      width: m.w,
      height: m.h,
      sha256: createHash('sha256').update(m.png).digest('hex'),
      upload_request_id: m.id, // 与公开媒体同一套幂等键约定（确定性）
      created_at: T0,
    })
  }

  let chatFilesWritten = 0
  const chatFileErrors: string[] = []
  for (const m of seedChatMedia) {
    const full = path.join(uploadRoot, 'private', m.key)
    try {
      await mkdir(path.dirname(full), { recursive: true, mode: 0o755 })
      await writeFile(full, m.png, { mode: 0o644 })
      chatFilesWritten++
    } catch (err) {
      chatFileErrors.push(`${m.key}: ${(err as Error).message}`)
    }
  }
  if (chatFileErrors.length === 0) {
    console.log(`[seed] 群聊媒体实体文件已写 ${chatFilesWritten} 个（→ ${uploadRoot}/private/…）`)
  } else {
    console.log(`[seed] ⚠ 群聊媒体文件有 ${chatFileErrors.length} 个未写入（DB 行已建，盘上会缺文件）：${chatFileErrors.join('; ')}`)
  }
  // 关联到帖子（public → 只能进 post_media）
  await put('post_media', 'eeeeeeee-0001-4001-8001-000000000001', {
    post_id: P.p1,
    media_id: M.m1,
    media_scope: 'public',
    position: 0,
  })
  await put('post_media', 'eeeeeeee-0002-4002-8002-000000000002', {
    post_id: P.p2,
    media_id: M.m2,
    media_scope: 'public',
    position: 0,
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

  // ---- 群会话（M5 WO#9A：群聊垂直切片的种子）----
  //
  // ## 为什么成员是 **2 人**、且**故意留一个非成员**
  //   `thread_members` 没有成员数上限，schema 早已允许任意人数（见
  //   scripts/m5/probe-group-support.sh 的实测）。但**种子刻意只用 2 人**，原因有二：
  //     ① 库里有且只有 3 个用户（anmoss / Lemy / Azur冰弦）。若把 3 人都放进群，
  //        就**没有第三方账号可当"非成员"**，`GROUP_MEMBERSHIP_DENIED` 那条授权断言
  //        就永远验不了 —— 而那恰恰是本切片最重要的 Gate（详见审核记录 45）。
  //     ② 没有任何证据说明"一个合法的群必须 ≥3 人"，
  //        所以 Gate 也不该写 memberCount >= 3，而应写"等于种子里声明的成员数"。
  //   → 成员 = {anmoss, Lemy}；**非成员 = Azur冰弦**（第三个现有用户）。
  //
  // ## 3 条消息的构成（覆盖两个 sender 方向 + 一个媒体读取样本）
  //   ① Lemy 文本（自己）② anmoss 文本（对方）③ anmoss **图片**（对方 + 私聊媒体）
  //   审核记录 45 明确：写路径的关账核心只定 **text**；媒体因此作为**已种子化**的读取样本，
  //   由 Gate 验证"群成员能读到群内图片"，而**不是**把 WO#2 的整条证明重做一遍。
  //
  // ## 为什么图片媒体要写实体文件
  //   与公开媒体同源的理由（见上方 seedMedia 注释）：只写 DB 行会造成**悬空引用**
  //   （库里说"有图"、盘上取不到），M4 联合恢复演练抓过这个真实缺陷。
  //   私聊媒体落在 uploads/**private**/，且**没有静态入口** —— 必须经
  //   `GET /api/media/:id` 走会话 + can_read_media 鉴权（这正是要验的那条链）。
  const groupThread = 'aaaaaaaa-0001-4001-8001-00000000000a'
  await put('message_threads', groupThread, {
    kind: 'group',
    title: '计算机学院 2023 级',
    created_at: T0,
  })
  await put('thread_members', 'aaaaaaaa-0002-4002-8002-00000000000b', {
    thread_id: groupThread,
    user_id: U.anmoss,
    joined_at: T0,
  })
  await put('thread_members', 'aaaaaaaa-0003-4003-8003-00000000000c', {
    thread_id: groupThread,
    user_id: U.lemy,
    joined_at: T0,
  })
  await put('messages', 'aaaaaaaa-0004-4004-8004-00000000000d', {
    thread_id: groupThread,
    sender_id: U.lemy,
    body: '有人在图书馆吗？帮我占个位子。',
    created_at: T0,
  })
  await put('messages', 'aaaaaaaa-0005-4005-8005-00000000000e', {
    thread_id: groupThread,
    sender_id: U.anmoss,
    body: '在的，四楼靠窗这边还有空位。',
    created_at: T0,
  })
  await put('messages', 'aaaaaaaa-0006-4006-8006-00000000000f', {
    thread_id: groupThread,
    sender_id: U.anmoss,
    body: '[图片]',
    kind: 'image',
    created_at: T0,
  })
  // 群内图片消息 ↔ 私聊媒体 的关联
  //   media_scope='private' 必须与 media.scope 一致 —— 复合外键
  //   (media_id, media_scope) → media(id, scope) 会在**数据库层**拦住跨 scope 引用，
  //   所以种子也不能"顺手"把公开媒体挂到聊天消息上（结构上就插不进去）。
  await put('message_media', 'aaaaaaaa-0007-4007-8007-000000000010', {
    message_id: 'aaaaaaaa-0006-4006-8006-00000000000f',
    media_id: M.m3,
    media_scope: 'private',
    position: 0,
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
      ids: [P.p1, P.p2, P.p3, P.p4],
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
        'owner_user_id::text',
        'scope',
        'storage_key',
        'mime',
        'bytes::text',
        "coalesce(width::text,'')",
        "coalesce(height::text,'')",
        'sha256',
        'upload_request_id::text',
        ts('created_at'),
      ],
    },
    {
      table: 'post_media',
      ids: ['eeeeeeee-0001-4001-8001-000000000001', 'eeeeeeee-0002-4002-8002-000000000002'],
      cols: [
        'post_id::text',
        'media_id::text',
        'media_scope',
        'position::text',
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
      ids: ['cccccccc-0001-4001-8001-000000000001', 'cccccccc-0002-4002-8002-000000000002'],
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
  await del('post_media', ['eeeeeeee-0001-4001-8001-000000000001', 'eeeeeeee-0002-4002-8002-000000000002'])
  await del('media', [M.m1, M.m2])
  await del('posts', [P.p1, P.p2, P.p3, P.p4])
  await del('places', ['cccccccc-0001-4001-8001-000000000001', 'cccccccc-0002-4002-8002-000000000002'])
  await del('users', SEED_USERS.map((u) => u.id))
}
