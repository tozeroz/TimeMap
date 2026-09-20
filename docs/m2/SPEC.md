# M2 工作单：认证契约 + 数据模型 V0.1 + seed + 备份恢复演练

> 前置：M1 **PASS / CLOSED**（审核记录 04）
> 顺序依据审核记录 04 第 3 节：`auth 语义先于完整数据模型；最小 user/session schema 先于 auth 实现`
> 本文件提交审核通过后才开始执行。

## 一、目标（按审核确认的顺序拆成 6 步，每步单独可验证）

| 步 | 交付 | 验收方式 |
|---|---|---|
| **M2.1** | 冻结 Authentication / Authorization **契约**（本文第二节） | 契约本身经审核确认；Gate 里有对应的机械断言 |
| **M2.2** | 最小 identity / session schema（`users` / `sessions`） | 空库可重建；约束可被违反时被拒绝（机械测试） |
| **M2.3** | 实现 auth，**彻底取消 client-author trust** | forged author 测试返回 400；未带 token 写入 401 |
| **M2.4** | 其余 Data Model V0.1（帖子/媒体/评论/点赞/地点/消息/群组/公告） | migration 从空库重建；关键关系有 FK / 唯一 / CHECK 约束 |
| **M2.5** | deterministic / repeatable seed | 连跑两次结果一致（行数、内容哈希不变） |
| **M2.6** | `pg_dump` → fresh DB restore | 恢复到**新库**后行数与主键集合一致 |
| **M2 Gate** | 永久不变量 + 本阶段不变量 + 回归检查 | 任一失败退出码非 0 |

## 二、M2.1 认证与授权契约（冻结）

### 2.1 身份来源

**服务器签发不透明 session token**（审核记录 04 明确选定，不采用设备绑定签名）。

- 登录成功 → 服务器生成 **256-bit 随机** token
- 客户端：`Authorization: Bearer <token>`
- 数据库**只存 token hash**（sha256），绝不存明文 token
- 退出登录 → `revoked_at` 置位（不物理删除，保留审计痕迹）
- **不用 JWT**

### 2.2 接口

| 路由 | 认证 | 语义 |
|---|---|---|
| `POST /api/auth/register` | 无 | `{handle, displayName, password}` → 建用户 + 签发 token |
| `POST /api/auth/login` | 无 | `{handle, password}` → 签发 token |
| `POST /api/auth/logout` | Bearer | revoke 当前 session |
| `GET /api/auth/me` | Bearer | 返回当前用户 |

### 2.3 密码存储（不自己造密码学）

- 用 Node 内置 `crypto.scrypt`（无新增依赖），随机 salt，参数记录在哈希串里：
  `scrypt$N$r$p$<saltB64>$<hashB64>`
- 校验用**常数时间比较**（`crypto.timingSafeEqual`）
- 登录失败不区分「用户不存在」与「密码错」（统一 401，避免用户枚举）

### 2.4 授权规则（本阶段必须机械可验的部分）

| 资源 | 规则 |
|---|---|
| `GET /api/posts` | 匿名可读 |
| `POST /api/posts` | **必须带有效 session**；作者**只能**来自服务端 session |
| 帖子的 `author` / `authorId` 字段 | 客户端提交时 **strict 400 拒绝**（审核倾向 strict reject，而非静默忽略） |
| 会话有效性 | 过期（`expires_at`）或已 revoke 的 token → 401 |
| 资源所有权（删除/编辑） | V0.1 只确立原则「owner-only」，具体接口在 M4 实现 |
| 私信读取 | 原则：仅会话参与者可读（M4 实现） |
| 群组 | 原则：需为成员（M4 实现） |

## 三、M2.2 最小 schema

```sql
users (
  id            uuid primary key,
  handle        text not null unique,          -- 登录标识
  display_name  text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
)

sessions (
  id          uuid primary key,
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
)
```

## 四、M2.4 数据模型 V0.1（不追求终态，但关系必须有约束）

- `posts` 增加 `author_id uuid references users(id)`；
  **`author_name` 不 drop**，暂时保留为历史快照字段（审核记录 04 第 6 节）。
- 新增（V0.1 最小形状）：`media`、`comments`、`likes`、`places`、`message_threads`、
  `thread_members`、`messages`、`groups`、`group_members`、`announcements`
- 每张表都要有：主键、必要的外键、唯一约束（防重复点赞/重复成员）、
  关键 CHECK、以及查询会用到的索引（列表按时间倒序）
- **明确不做**：不做全文检索、不做软删除框架、不做多租户、不做读写分离、不做分库分表

## 五、M2.5 seed

- 单一入口：`scripts/m2/seed.mjs`（Node，走 `pg`），固定 UUID + 固定时间戳
- 幂等：`ON CONFLICT DO NOTHING` 或先查后插；**连跑两次行数与内容哈希必须一致**
- `--reset` 显式清空后重灌（用于本地/演练环境），**不得在 Gate 里自动调用**
- seed 内容与前端 mock 保持同一套实体名（便于 M3 逐页替换）

## 六、M2.6 备份恢复演练

`scripts/m2/backup-restore-drill.sh`：

```
pg_dump campus → 新建空库 campus_restore → psql 恢复
→ 对比 rows(users/posts/comments/likes/messages/…)
→ 对比 schema_migrations
→ 对比关键表主键集合哈希
→ 清理 campus_restore
```

要求：恢复目标是**新库**（不是删表重建），证明 dump 本身可用；演练必须在 **M2 之后**就能跑，不等 M6。

## 七、传输安全（需要审核确认的决策点）

Bearer token 一旦真实发送，公网 HTTP 就没有机密性。三个选项：

- **A（推荐，若 443 可达）**：上最小 TLS —— Nginx 443 + **自签证书**，并把该证书作为
  trust-anchor 写进 Android Network Security Config（等价于证书固定）。
  好处：能**同时**收回两项临时债（明文例外 + `allowMixedContent`），因为 `https://localhost`
  页面请求 `https://<IP>` 不再是混合内容。
  代价：需要在阿里云安全组放行 **443/tcp**（与当初 80 一样，需要用户操作）；
  自签证书对浏览器预览会告警（可控）。
- **B**：M2 不出网 TLS，报告里分开记 `AUTH_FUNCTIONAL_PASS` 与
  `TRANSPORT_SECURITY_DEFERRED_TO_M6`（审核允许，但要求**不得合并成一条 AUTH PASS**）。
- **C**：M2 不做 auth 网络发送（不可接受，等于 M2.3 没做）。

本工作单倾向 **A**；若 443 无法及时放行则退到 B 并按审核要求分开记录。

## 八、M2 Gate（含审核要求的结构收束）

### 8.1 Gate 结构（按审核记录 04 §10.3 收束，自 M2 起）

```
scripts/gates/
├── common/            # 永久不变量
│   ├── encoding       # .ps1 BOM
│   ├── environment    # Node 冻结与校验和、PG 参数
│   ├── security       # 私钥治理、端口暴露面、明文例外清单
│   ├── baseline       # 原版基线完整性
│   └── network        # Nginx 语义、外部可达性
├── m1/milestone.ps1   # M1 阶段验收（M1 语义保持可复现）
└── m2/milestone.ps1   # M2 阶段验收
```

`scripts/m0/verify-m0.ps1` 保留为历史入口 wrapper；M2 Gate 不再往 `scripts/m0/` 堆 stage 分支。

### 8.2 断言分组

1. **[PERSISTENT]** 上一节 common 全部 PASS（任何阶段都必须 PASS）
2. **[AUTH_CONTRACT]**
   - 注册 → 得到 token；重复 handle → 409
   - 登录成功 → token；密码错 → 401；不存在的 handle → 401（与密码错**不可区分**）
   - `GET /api/auth/me` 无 token → 401；带过期 token → 401；logout 后原 token → 401
   - 库里**不存明文 token**（直查 `sessions.token_hash` 不等于客户端持有的 token）
3. **[AUTHOR_TRUST]**（审核点名）
   - `POST /api/posts` 不带 token → 401
   - `POST /api/posts` 带 `{"author":"管理员"}` → **400**（strict reject）
   - 带 token 正常发帖 → 库中 `author_id` 等于该 session 的 `user_id`
   - **证明 `client cannot choose post ownership`**
4. **[MIGRATION]** 空库从零重建；重复执行幂等；`schema_migrations` 记录全部版本
5. **[CONSTRAINTS]** 机械验证关键约束确实生效（例：重复点赞被唯一约束拒绝、
   外键指向不存在用户被拒、CHECK 被拒）
6. **[SEED]** 连跑两次行数/内容哈希一致
7. **[BACKUP]** `pg_dump` → 新库 restore → 行数与主键集合一致
8. **[RESOURCE_after_M2]** idle / 5 / 20 并发重新采样（对照 M1 基线）
9. **[SCOPE]** 改动落在允许清单内；不得新增允许清单以外的表
10. **[REGRESSION]** M1 的垂直切片仍可用（设备真实触摸发帖 → 落库 → `pm clear` 后仍在）

### 8.3 报告口径（不变）

```
total original screens: 22
observed baseline:      19
evidence-blocked:        3   (poi-detail / media-preview / at-panel)
out-of-scope:            0
```

## 九、明确不做（防止夹带）

- 不做前端页面接入（M3 按垂直切片做）、不做图片上传（M4）、不做评论/点赞接口（M4）
- 不碰 3 个 evidence-blocked 页面
- 不做 HTTPS 全套部署/域名/证书自动续期（M6；M2 最多做"最小 TLS 前置条件"）
- 不引入 Redis / 消息队列 / ORM / JWT / Docker

## 十、Scope 允许清单（M2）

```
server/**                      # 后端实现与迁移
scripts/gates/**               # Gate 结构收束
scripts/m2/**                  # M2 专有脚本
ops/**                         # Nginx/证书/unit
app/src/api/**                 # 仅 token 存放与鉴权头（不改页面）
app/src/data/store.ts          # 会话持久化（不改页面）
docs/**  PLAN.md  .gitignore  .gitattributes
tools/**
```
