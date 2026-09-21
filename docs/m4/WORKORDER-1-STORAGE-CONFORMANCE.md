# M4 工作单 #1：媒体存储设计与 7 条边界的一致性比对（**实现前提交**）

> 依据：审核记录 14（M4 APPROVED TO START；"第一份 M4 工作单先拿 PLAN §6 的冻结图片存储设计，
> 逐条回答那 7 条边界，再动手实现"）+ 审核记录 13 提出的 7 条边界。
> 性质：**只做设计比对，不改代码**。发现缺口先在这里解决，再进实现。
> 时间：2026-09-21（Asia/Shanghai）

## 一、逐条比对结论

| # | 审核要求的边界 | PLAN §6 现状 | 判定 |
|---|---|---|---|
| 1 | DB 只存 metadata/reference，不把客户端路径当存储地址 | 冻结"DB 只存逻辑 key `2026/09/uuid.webp`，不存完整 URL/部署路径" | ✅ **已覆盖** |
| 2 | 上传文件名由服务器生成，防路径穿越 | 冻结"UUID/ULID，绝不用客户端文件名" | ✅ **已覆盖** |
| 3 | 不只信 Content-Type；按内容确认类型 + 大小限制 | 冻结"允许 jpeg/png/webp；拒绝 SVG/任意 binary/超大图；单图 ≤5MB、单帖 ≤9 张；不信任 Content-Type 与扩展名，解析真实图片" | ✅ **已覆盖**（机制见 §二） |
| 4 | DB row 与文件之间的失败原子性 / orphan | 只冻结了"`write tmp → validate → atomic rename → INSERT DB`；DB 失败则 unlink" | ⚠️ **部分覆盖 —— 见缺口 A** |
| 5 | 20 GB 盘：disk-full / quota / orphan cleanup | 冻结了"磁盘 Gate：>70% WARN、>80% ALERT、>90% 拒绝（507）" | ⚠️ **部分覆盖 —— 见缺口 B** |
| 6 | **公共动态图 vs 私有聊天图的访问控制不能同构** | 冻结的是单一静态目录：`location /media/ { alias /srv/campus/uploads/; }` | ❌ **未覆盖 —— 见缺口 C（最严重）** |
| 7 | `pg_dump` 不代表完整备份 → DB + media store 联合恢复证据 | 冻结了"DB + uploads 联合备份，同一 backup generation（`database.sql.gz` + `uploads.tar.zst` + `manifest.json`）" | ⚠️ **设计已覆盖，证据待补 —— 见缺口 D** |

## 二、缺口 C（最严重）：公共媒体与私有媒体不能共用同一访问控制

### 问题

PLAN §6 冻结的是**一个静态目录 + Nginx 直接 alias**：

```nginx
location /media/ { alias /srv/campus/uploads/; }
```

这个设计对**动态（公共）图片**是对的：公开内容、要 CDN 友好、要不经过 Node 转发。
但它对**聊天媒体（私有）**是**错的**：
一旦私聊/群聊图片也落在 `/srv/campus/uploads/` 下，
**任何拿到 URL 的人都能直接读**——URL 就是唯一凭证，
没有会话校验、没有成员校验、也没有"这条消息被撤回/删除后图片不该再可读"的控制。

这不是"以后再补鉴权"的问题：文件一旦按静态资源下发过，
就已经脱离应用层的可见性判断了。**必须在落地第一版就分开。**

### 修正设计（分两个命名空间）

```
/srv/campus/uploads/
├── public/    # 动态图片：Nginx 静态 alias 直接下发（无鉴权，设计如此）
│   └── 2026/09/<uuid>.webp
└── private/   # 聊天/群聊图片：**Nginx 不直接下发**，必须经应用层鉴权后流式返回
    └── 2026/09/<uuid>.webp
```

| 维度 | public（动态） | private（聊天/群聊） |
|---|---|---|
| Nginx | `location /media/ { alias .../public/; }` 静态下发 | **无静态 location**；仅应用层 `GET /api/media/:id` |
| 访问控制 | 无（公开内容） | **会话 + 可见性校验**（见下） |
| DB 记录 | `media.scope = 'public'` | `media.scope = 'private'` |
| 返回方式 | 直接 URL | 应用层读文件流式返回（带 `Cache-Control: private, no-store`） |
| URL 可猜测性 | 可（UUID 不可枚举，但不是安全边界） | 同样 UUID，但**UUID 不是凭证**：仍要过鉴权 |

### 私有媒体的可见性判定（必须落到 SQL，不能只靠前端）

`GET /api/media/:id` 的允许条件（全部满足才 200）：

1. 请求者已登录（有效会话）；
2. 该 media 行 `scope = 'private'`；
3. 存在一条**引用该 media 的消息** `m`，且请求者是 `m` 的发送者
   **或** `m` 所在会话（私聊/群聊）的成员；
4. 该消息未被撤回/删除（`deleted_at is null`）。

不满足 → **404**（不是 403）。
理由：403 会泄漏"这个 id 存在"。对私有资源，
"不存在"和"你没权限"应当对外不可区分。

### 一致性约束（防"同一张图两种身份"）

- `media.scope` 在**上传时**由**服务端**按用途确定，**不接受客户端指定**；
- 同一物理文件**不允许**同时被 public 与 private 引用
  （否则一旦按 public 下发过，就等于泄漏）；
- 实现上：动态上传走 `scope='public'`，聊天上传走 `scope='private'`，
  两条路径的**存储目录、URL 形态、鉴权链**都不同。

> 这一条我原本会在 M4 实现时才"顺手"发现，属于审核提前拦下的架构级问题，
> 因此它必须在**动手前**定稿。

## 三、缺口 A：写盘与 DB 的失败原子性（补反向情形与崩溃残留）

PLAN §6 冻结了主路径：`write tmp → validate → atomic rename → INSERT DB；DB 失败则 unlink`。
这覆盖了"文件成功、DB 失败"。仍需明确另外两种：

| 情形 | 处理 |
|---|---|
| 原子 rename 成功，进程在 INSERT 前**崩溃** | 文件成为 **orphan**：DB 里没有对应行。→ 由**孤儿清扫**（见缺口 B）按"文件 mtime 早于 N 小时且 DB 无引用"回收 |
| DB INSERT 成功，但**响应前**崩溃 | **不出问题**：文件与行都在，只是客户端没收到 id。重试会新建一份（可接受，V1 不做幂等去重） |
| 校验失败（不是合法图片 / 超限） | 删除 tmp 文件，返回 400；**不进入** rename |
| rename 失败（ENOSPC / 权限） | 删除 tmp，返回 507/500，**不写 DB** |

**顺序不变式**：**先有文件、后有 DB 行**。
反过来（先 INSERT 再写盘）会出现"DB 说有图、实际取不到"的坏状态，
对只读端是更难处理的错误。因此宁可留 orphan 文件（可清扫），
也不要留"悬空引用"。

## 四、缺口 B：磁盘满 / 配额 / 孤儿清扫（20 GB 盘）

| 机制 | 规则 |
|---|---|
| 上传前 Gate | 现有 §6：>70% WARN、>80% ALERT、>90% **拒绝新上传（507）** |
| **ENOSPC 兜底** | `write tmp` 或 `rename` 抛 ENOSPC 时：删除 tmp → 返回 **507**（不是 500）——"存储空间不足"是**可恢复的外部条件**，不该报成服务端 bug |
| **预留水位** | 保留 1 GB 余量：即使百分比未到 90%，剩余空间 < 1 GB 也拒绝新上传（小盘上百分比会抖动） |
| **孤儿清扫** | 提供 `dist/cleanup-media.mjs`（**手动/运维触发**，不在请求路径里）：删除"文件 mtime 早于 24 小时 **且** DB 无任何引用"的文件；**dry-run 为默认**，需显式 `--apply` |
| **孤儿清扫的安全边界** | 只扫 `uploads/` 下、只删 **DB 查不到的** 文件；删前打印清单与字节数；**绝不**按"看起来像临时文件"删未知内容 |
| 每用户配额 | V1 **不做**（demo 规模），但记录为已知限制：真实产品需要 per-user 配额，否则单个账号可占满盘 |

## 五、缺口 D：备份必须覆盖 DB + 媒体（并给出联合恢复证据）

PLAN §6 已冻结联合备份的形态，M4 要补的是**证据**：

1. **联合备份**：一次 backup generation 同时产出
   `database.sql.gz` + `uploads.tar.zst` + `manifest.json`
   （manifest 记录：生成时间、DB 行数、media 行数、uploads 文件数、各文件 sha256）；
2. **联合恢复演练**（M4 Gate 必测）：
   把 DB 恢复到新库 + 把 uploads 恢复到新目录 →
   断言：**恢复后的 media 行引用的每个逻辑 key，在恢复后的 uploads 里都能找到对应文件**
   （逐行核对，不是抽样）；
3. 这项与 M2 的 DB-only 演练**分开记录**，不相互替代 ——
   M2 的 `BACKUP_DRILL_RESULT` 继续有效，但它**不覆盖媒体**。

## 六、实现顺序（提交审核后执行）

1. schema：`media` 表（id / storage_key / scope / mime / bytes / width / height / sha256 / created_at）
2. 上传路径：`POST /api/media`（multipart）→ 嗅探 → 压缩 → public/private 落盘 → INSERT
3. 私有下发：`GET /api/media/:id`（会话 + 可见性 SQL + 流式 + `private, no-store`）
4. 公共下发：Nginx `/media/` alias 到 `uploads/public/`
5. 运维：`cleanup-media.mjs`（dry-run 默认）
6. 备份：联合备份 + 联合恢复演练脚本
7. Gate：新增 M4 Gate 组（见下）

### M4 Gate 计划断言（先写下来，实现后逐条验证）

- 上传：非图片（文本/可执行文件改名 .png）→ 400；SVG → 400；>5MB → 413/400
- 路径穿越：客户端传 `../../etc/passwd` 或 `a/../../b.png` → 文件名被服务端替换，**盘上无越界文件**
- **私有媒体未登录 → 404**；**非会话成员 → 404**；成员 → 200
- **私有媒体的 URL 直接打 Nginx 静态路径 → 404**（证明 Nginx 不下发它）
- 公共媒体 → Nginx 直接 200（证明公共路径仍然高效）
- 撤回消息后私有媒体 → 404
- 磁盘 Gate：模拟高水位 → 507
- 联合恢复：恢复后逐行核对 media → 文件存在
