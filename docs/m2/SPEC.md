# M2 工作单：认证契约 + 数据模型 V0.1 + seed + 备份恢复演练

> 前置：M1 **PASS / CLOSED**（审核记录 04）
> 设计审核：**记录 05 —— M2 DESIGN CONDITIONAL APPROVAL**，7 项 P0 已并入本文件（见文末「修订对照」）
> 顺序依据审核记录 04 第 3 节：`auth 语义先于完整数据模型；最小 user/session schema 先于 auth 实现`

## 一、目标（6 步，每步单独可验证）

| 步 | 交付 | 验收方式 |
|---|---|---|
| **M2.1** | 冻结 Authentication / Authorization **契约**（第二节） | 契约经审核确认；Gate 有对应机械断言 |
| **M2.2** | 最小 identity / session schema（`users` / `sessions`） | 空库可重建；约束违反时被拒绝 |
| **M2.3** | 实现 auth，**彻底取消 client-author trust** | forged author → 400；无 token 写入 → 401 |
| **M2.4** | 其余 Data Model V0.1 | 空库重建；每表可追溯到已观察实体；约束有业务含义 |
| **M2.5** | **convergent** seed | fresh+seed once 与 fresh+seed twice 内容哈希一致，且等于 canonical 哈希 |
| **M2.6** | `pg_dump -Fc` → 新库 `pg_restore` | 四项一致：版本集 / 行数 / PK 集合哈希 / **行内容哈希** |
| **M2 Gate** | 永久不变量 + 本阶段不变量 + 回归检查 | 任一失败退出码非 0 |

## 二、M2.1 认证与授权契约（冻结）

### 2.1 身份来源

服务器签发**不透明 session token**（不采用设备绑定签名，不用 JWT）。

```
token        = crypto.randomBytes(32).toString('base64url')   # 256 bit
DB 存的        = sha256(token)  的 hex                          # 只存 hash，不存明文
             ↑ token 本身已是高熵随机，用 SHA-256 即可；不要对 token 再用 scrypt
```

- `sessions` 必含 `expires_at NOT NULL`（**不允许永不过期 session**；TTL 初值 30 天，可调）
- logout → 置 `revoked_at`（不物理删除，保留审计痕迹）

### 2.2 接口（就这三个，不顺手扩张）

| 路由 | 认证 | 语义 |
|---|---|---|
| `POST /api/auth/login` | 无 | `{handle, password}` → `{token, expiresAt, user}` |
| `POST /api/auth/logout` | Bearer | revoke 当前 session → 204 |
| `GET /api/auth/me` | Bearer | 返回服务端解析出的身份 |

**冻结的状态码语义**：

| 情形 | 状态码 |
|---|---|
| login 成功 | 200 |
| login 失败（用户不存在 / 密码错，两者不可区分） | 401（同一个 body） |
| login 被限流 | 429 |
| 缺 token / token 格式错误 / expired / revoked | 401 |
| logout 成功 | 204 |
| 请求体不合 schema | 400 |

**明确不做**：不提供注册、改密码、refresh token、找回密码接口（没有明确需求就不加）。

### 2.3 密码与登录的资源语义（记录 05 的 P0）

- 用 Node 内置 `crypto.scrypt`（不新增依赖），**异步** `scrypt()`，**不得**用 `scryptSync()`（会阻塞事件循环）。
- **参数必须写死、不得依赖 Node 默认值**，并记录在哈希串里：
  `scrypt$N$r$p$keylen$saltB64$hashB64`
  参数初值取保守配置，**上线前在目标服务器实测**单次登录与 1/5 并发登录的 RSS、延迟、OOM 之后再冻结
  （该机只有约 396MB 可用内存，绝不能照搬高内存参数）。
- **用户不存在时也必须跑一次"参数完全相同"的 dummy scrypt**，然后统一返回 401。
  否则「用户不存在立即失败 / 密码错做一次 scrypt 才失败」的时间差仍可用于枚举用户。
- 校验用 `crypto.timingSafeEqual`（只保证比较本身，不代表外围代码自动 timing-safe）。
- `/api/auth/login` 必须**限流**（按 IP + handle 计数；触发后 429）。

### 2.4 授权规则

| 资源 | 规则 |
|---|---|
| `GET /api/posts` | 匿名可读 |
| `POST /api/posts` | **必须带有效 session**；作者**只能**来自服务端 session |
| 客户端提交 `author` / `authorId` / `user_id` | **strict 400 拒绝**（不是静默忽略） |
| 会话有效性 | expired 或 revoked → 401 |
| 资源所有权 / 私信 / 群组 | V0.1 只确立原则（owner-only、仅会话参与者可读、需为群成员），接口在 M4 实现 |

## 三、M2.2 最小 schema

```sql
users (
  id            uuid primary key,
  handle        text not null unique,
  display_name  text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
)

sessions (
  id          uuid primary key,
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,          -- sha256(token) 的 hex
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,          -- 必须有
  revoked_at  timestamptz                    -- 必须有（null = 未撤销）
)
```

## 四、M2.4 数据模型 V0.1

### 4.1 迁移陷阱：M1 legacy posts 不得伪造身份（记录 05 的 P0）

M1 的帖子 `author_name` 来自客户端，**事实上不存在可信的 users.id**。因此：

```
M1 legacy posts : author_id = NULL，author_name 保留为原始快照
M2+ 新帖        : author_id 必须由 session 解析且非 NULL（API 层强制）
```

原则：**未知身份就表示未知，不能为了外键好看而伪造身份。**

### 4.2 建表 scope Gate（记录 05 要求）

每张表都必须能追溯到 **22 页 observed baseline 中的某个已观察实体/关系**；
「以后可能用得上」的表**现在不建**。M2 是 Data Model V0.1，不是猜未来业务。

计划建的表（逐一需在报告中给出对应 baseline 页面/实体）：

```
media, comments, likes, places,
message_threads, thread_members, messages,
groups, group_members, announcements
```

### 4.3 约束要有业务含义（不是统一模板）

```sql
likes         UNIQUE(user_id, post_id)           -- 一人一帖一赞
thread_members UNIQUE(thread_id, user_id)        -- 不重复入群/入会话
group_members UNIQUE(group_id, user_id)
comments      FK(post_id) ON DELETE CASCADE
posts         FK(author_id) REFERENCES users(id)
```

另加必要 CHECK 与列表索引（按时间倒序）。

**明确不做**：全文检索、软删除框架、多租户、读写分离、分库分表。

## 五、M2.5 seed：必须 convergent（记录 05 的 P0）

「固定 UUID + `ON CONFLICT DO NOTHING` + 两次 hash 一致」会产生**假幂等**：
seed 源把 `Alice` 改成 `Alice Zhang` 后，DB 里已有同 UUID → `DO NOTHING` → DB 仍是旧值，
两次 Gate 运行当然"一致"，但已经偏离 canonical seed。

所以：

- seed-owned fixture 一律 `ON CONFLICT (id) DO UPDATE SET ...`，让数据库**收敛到 seed 规格**；
- Gate 断言：`fresh + seed once` 与 `fresh + seed twice` 的**内容哈希一致**，
  且都等于 **canonical 期望哈希**；
- `--reset` 显式人工调用，**Gate 不自动调用**。

## 六、M2.6 备份恢复演练（记录 05 要求加强）

```
pg_dump -Fc campus            # custom format，archive 设计上就是用来重建数据库的
createdb campus_restore       # 全新空库
pg_restore -d campus_restore
→ 四项逐一对比：
     schema_migrations 版本集合
     每张业务表行数
     主键集合哈希
     行内容哈希   ← 新增：按 PK 排序、字段规范化表示做 SHA-256
→ 清理 campus_restore
```

为什么要行内容哈希：只比行数与 PK 集合时，`id=1 body=ABC` 被恢复成 `id=1 body=XYZ` 也照样"通过"。

**不用"删表重建"冒充恢复**。

## 七、传输安全（记录 05 定稿）

### 7.1 执行顺序：并行推进，不冻结整个 M2

```
现在：申请放行 443/tcp
  ├── M2.1 auth contract
  ├── M2.2 schema + migration
  ├── M2.4 数据模型 / M2.5 seed
  └── M2.3 实现 + localhost（SSH 隧道）内验证
443 可用 ─→ 最小 TLS ─→ 真实设备 bearer E2E ─→ AUTH + AUTHOR_TRUST Gate ─→ M2 PASS
```

443 仍被阻断时，**M2 不得给完整 PASS**，只能写：

```
AUTH_FUNCTIONAL:    PASS
TRANSPORT_SECURITY: BLOCKED_EXTERNAL_443
M2_OVERALL:         HOLD
```

### 7.2 临时 PKI 方案（记录 05 修正了我的原始方案）

**修正点：信任链与身份校验是两道独立检查，配置 trust-anchor 并不能绕过 hostname 校验。**

```
Private Root CA  ──签发──→  Server leaf certificate (SAN = IP:8.148.156.146)
APK 内置：只放 Private Root CA 的公钥证书
Nginx 持有：server leaf + leaf 私钥
```

- leaf 的 SAN **必须是 `IP:8.148.156.146`**（iPAddress 类型），**不能**写成 `DNS:8.148.156.146`，也不能只放 CN。
- **绝不**实现 always-true 的 `HostnameVerifier` 绕过校验（等于自废 MITM 防护）。
- 采用私有 CA 而不是直接钉一张自签 leaf 的原因：leaf 到期/轮换时不必重新发 APK。
- 切到 https 后**可以**收回明文例外与 `allowMixedContent`，但 **CORS 必须保留**
  （`https://localhost` 与 `https://8.148.156.146` 依然是不同 origin）。
- M6 再把整套临时 PKI 换成 域名 + 公共 CA + 自动续期，并删除 APK 里的临时 CA。

### 7.3 TLS Gate（九条，不能只测"能访问"）

```
1. 设备 https://IP/api/health → 200
2. HTTPS 下 authenticated POST /api/posts → 201
3. 明文 http://IP/api/... 不再是 App 可用路径
4. allowMixedContent 已删除/关闭
5. cleartext exception 已删除
6. 正确 private CA + 正确 IP SAN → PASS
7. 错误 CA → TLS FAIL
8. CA 正确但 SAN 不匹配 → TLS FAIL
9. bearer 不出现在 Nginx/access log、应用日志与 Gate transcript
```

第 9 条特别容易漏：Gate/调试脚本**禁止** `curl -v -H "Authorization: Bearer <真 token>"`
并把完整输出收进 evidence —— token 必须 redact。

## 八、M2 Gate

### 8.1 Gate 结构（记录 04 §10.3 起收束）

```
scripts/gates/
├── common/   # 永久不变量
└── mN/milestone.ps1
```

`scripts/m0/verify-m0.ps1`、`scripts/m1/verify-m1.ps1` 保留为历史入口；
M2 起不再往 `scripts/m0/` 堆 stage 分支。

### 8.2 断言分组

1. **[PERSISTENT]** 永久不变量全部 PASS
2. **[AUTH_CONTRACT]** login 成功 200 / 失败 401（不存在与密码错**不可区分**）/ 缺 token 401 /
   格式错 401 / expired 401 / revoked 401 / logout 后原 token 401 / `/me` 返回服务端身份 /
   限流生效 429 / 库里**不存明文 token**
3. **[AUTHOR_TRUST]** 无 token 写入 401；带 `author` 字段 → **400**；
   正常发帖后库中 `author_id` == 该 session 的 `user_id`；`author_name` 由服务端生成
4. **[MIGRATION]** 空库从零重建；重复执行幂等；M1 legacy posts `author_id IS NULL` 且 `author_name` 保留
5. **[CONSTRAINTS]** 机械验证：重复点赞被唯一约束拒绝、外键指向不存在用户被拒、CHECK 被拒
6. **[SEED]** `fresh+once` == `fresh+twice` == canonical 哈希
7. **[BACKUP]** 四项一致（版本集 / 行数 / PK 集合哈希 / 行内容哈希）
8. **[TLS]** 第七节九条（443 未放行时整组记 `BLOCKED_EXTERNAL_443`，且 M2 整体 HOLD）
9. **[RESOURCE_after_M2]** idle / 5 / 20 并发重采样 + **登录路径资源实测**（scrypt 参数冻结依据）
10. **[SCOPE]** 改动落在允许清单；每张新表都能追溯到已观察实体
11. **[REGRESSION]** M1 垂直切片仍可用（设备真实触摸发帖 → 落库 → `pm clear` 后仍在）

### 8.3 报告口径（不变）

```
total original screens: 22
observed baseline:      19
evidence-blocked:        3   (poi-detail / media-preview / at-panel)
out-of-scope:            0
```

## 九、明确不做（防止夹带）

- 不接前端页面（M3）、不做图片上传与评论/点赞接口（M4）
- 不碰 3 个 evidence-blocked 页面
- 不做 HTTPS 全套部署 / 域名 / 公共 CA / 证书自动续期（M6；M2 只做最小 TLS 前置条件）
- 不引入 Redis / MQ / ORM / JWT / Docker
- 不实现自定义 HostnameVerifier

## 十、Scope 允许清单（M2）

```
server/**            # 后端实现与迁移
scripts/gates/**     # Gate 结构收束
scripts/m2/**        # M2 专有脚本
ops/**               # Nginx / 证书 / unit
app/src/api/**       # 仅 token 存放与鉴权头
app/src/data/store.ts
docs/**  PLAN.md  .gitignore  .gitattributes
tools/**
```

---

## 修订对照（记录 05 的 7 项 P0 → 本文件对应位置）

| # | 审核要求 | 落点 |
|---|---|---|
| 1 | session `expires_at`；token `randomBytes(32)` + SHA-256 | §2.1、§3 |
| 2 | dummy scrypt；异步 scrypt；参数冻结 + 资源实测；登录限流 | §2.3、§8.2-9 |
| 3 | login/logout/me contract 冻结，不加注册/改密/refresh | §2.2 |
| 4 | M1 legacy posts `author_id = NULL`，不伪造历史身份 | §4.1、§8.2-4 |
| 5 | seed 改 convergent（`DO UPDATE`） | §5、§8.2-6 |
| 6 | restore 增加行内容哈希 + `pg_dump -Fc`/`pg_restore` | §6、§8.2-7 |
| 7 | 立即申请 443；TLS 前不给 M2 完整 PASS | §7.1、§8.2-8 |
