# M1 工作单：后端最小闭环 + 真实 E2E vertical slice

> 前置：M0 **PASS / CLOSED**（anchor `da10163`），M1 **GO**（审核记录 03）
> 本文件是 M1 的设计与验收依据。实现完成后提交审核，通过才进 M2。

## 一、唯一 vertical slice（M1 的全部业务范围）

**文本发帖：写进 PostgreSQL → 从 API 读回 → UI 渲染 → 重启后端仍在**

```
发布页输入文字 → POST /api/posts → Fastify → INSERT INTO posts
                                        ↓
校园广场 → GET /api/posts → Fastify → SELECT → React 渲染新帖
                                        ↓
                        重启 campus-backend.service → 数据仍在
```

明确**不做**（留给后续里程碑，防止夹带）：

- 不做图片上传/媒体表（M4）
- 不做用户认证 / 鉴权（M2 定稿、M4 实现；M1 的 author 先用固定占位身份）
- 不做 mock 实体全量入库与 seed（M2）
- 不碰 3 个 evidence-blocked 页面（M3）
- 不改动任何其它页面的现有行为

## 二、技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 运行时 | Node v24.21.0（M0 已冻结） | 已在服务器就绪 |
| Web 框架 | Fastify 5 | 轻量、内存占用低（396MB 机器友好） |
| 数据库驱动 | `pg`（纯 JS，无本地编译依赖） | 服务器无需 build toolchain |
| 迁移 | 自写极小 runner：`migrations/*.sql` + `schema_migrations` 表 | 不引入额外依赖；满足「可重复执行 + 版本可识别」 |
| 构建 | 本地 esbuild 打成单文件 `dist/index.mjs` | 服务器上**不装 node_modules、不跑构建**，省内存也省磁盘 |
| 进程托管 | systemd `campus-backend.service`（M0 已写好 unit） | M1 起改为 enabled + active |

## 三、数据库

```sql
-- migrations/001_init.sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id          uuid PRIMARY KEY,
  author_name text NOT NULL,
  body        text NOT NULL,
  place       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT posts_body_not_blank CHECK (length(btrim(body)) > 0)
);
CREATE INDEX IF NOT EXISTS posts_created_at_desc ON posts (created_at DESC);
```

- 迁移 runner 按文件名排序逐个执行，已应用的跳过；每个文件在**一个事务**里执行并记录版本
- `ready` 检查包含「已应用版本 == 磁盘上的版本数」，防止 schema 落后于代码

## 四、HTTP 接口（语义隔离，不可用一个 /health 假装证明三件事）

| 路由 | 谁提供 | 语义 | 失败时 |
|---|---|---|---|
| `GET /health` | **Nginx 直接返回** | Edge health（网关活着） | —— |
| `GET /api/health` | Fastify | Backend **liveness**（进程活着） | 进程死了则无响应 |
| `GET /api/ready` | Fastify | Backend **readiness**（能连 PG 且 migration 就绪） | **返回 503** |
| `GET /api/posts` | Fastify | 读帖子列表（最新优先，limit 50） | 500 |
| `POST /api/posts` | Fastify | 写帖子 `{body, place?, author?}` | 400 校验失败 / 500 |

- 校验：`body` 去空白后非空且 ≤ 500 字；`place` ≤ 60 字
- 连接池：`pg.Pool` `max: 5`、`idleTimeoutMillis: 10000`、`connectionTimeoutMillis: 5000`
  （对应审核要求的「受限 pool，不是无限连接」）
- 客户端唯一入口是 Nginx：**Node 只监听 127.0.0.1:3001**，公网不可达

## 五、前端改动（保持组件结构不变）

- 新增 `app/src/api/client.ts`：`VITE_API_BASE`（默认 `http://8.148.156.146/api`），
  统一 `getJson/postJson` + 超时 + 错误类型
- `CampusScreen`：在 mock 帖子之前插入「来自 API 的用户贴」
- `PublishScreen`（文字模式）：点「发布」→ `POST /api/posts` → 成功后跳回校园页
- **`app/src/data/store.ts`（localStorage）不再是用户帖子的真源**——保留文件但仅作离线降级；
  API 可用时以 API 为准，并在 UI 上不区分（用户无感）

> Android 侧：`usesCleartextTraffic` 需按审核建议用 **Network Security Configuration**
> 限定为仅允许到 `8.148.156.146` 的明文，而不是全局打开。这是**部署过渡态**，拿到域名后收紧。

## 六、M1 Gate（机械断言，任一失败退出码非 0）

沿用 M0 的模式：`M1 PASS = M0 invariants PASS + M1 new invariants PASS`

### 0) M0 regression（必须仍然 PASS）
- 直接复用 `scripts/m0/verify-m0.ps1`（含 baseline 完整性、私钥治理、PG/NGINX/Node 断言）

### 1) [MIGRATION]
- fresh DB 能从零执行全部 migration 建出 schema
- 重复执行 migration 幂等（第二次不改动任何东西）
- `schema_migrations` 记录版本且可读

### 2) [API]
- `/api/health` → 200（liveness）
- `/api/ready` → 200（PG 正常时）
- **停掉 PostgreSQL → `/api/ready` 必须返回 503**（readiness 语义有效）
- `GET /api/posts` → 200 + JSON 数组
- `POST /api/posts` 空 body → 400；超长 body → 400
- `POST /api/posts` 合法 → 201 + 返回含 id/created_at

### 3) [VERTICAL_SLICE]（核心）
- 通过 **Nginx**（不是直连 Node）`POST /api/posts` 写入一条带唯一标记的帖子
- 通过 **Nginx** `GET /api/posts` 能读到该条，字段与写入一致
- 直接查 PostgreSQL 确认该行真实存在（不是内存缓存）
- **重启 campus-backend.service → 再 GET，数据仍在**
- 库里存在该行说明持久化成功

### 4) [FRONTEND]
- 前端构建产物中含 API base 配置
- 真实 UI 路径验证：设备（MuMu）上发帖 → 校园页出现该帖 → 重启 app 后仍在
- 该路径**不依赖 localStorage**（清空 localStorage 后仍能看到）

### 5) [SYSTEMD]
- `campus-backend.service` **enabled + active**
- **reboot 后自动恢复**（两阶段 Gate，沿用 M0 的 boot_id 做法）
- 只监听 127.0.0.1:3001（公网不可达）

### 6) [NGINX]
- `/api/*` 反代到 backend；`/health` 仍由 Nginx 直接返回
- 公网 `curl http://8.148.156.146/api/health` → 200

### 7) [RESOURCE_after_M1]
- 重新采样 idle / 5 并发 / 20 并发（真实打 `/api/posts`，这次**才有意义**）
- 记录 MemAvailable / swap used / Node RSS / PG RSS / load / oom_kill_delta
- 与 M0 基线对比，确认 396MB 机器仍然健康

### 8) [SCOPE]
- M1 diff 只允许：`server/**`、`app/src/api/**`、`app/src/screens/{CampusScreen,PublishScreen}.tsx`、
  `app/src/data/store.ts`、`ops/**`、`scripts/m1/**`、`docs/**`、`tools/**`、配置文件
- 不得新增业务表以外的表（users/likes/comments 等留给 M2）
- 不得改动 3 个 evidence-blocked 页面的任何东西

## 七、阶段报告口径（审核强制）

```
total original screens: 22
observed baseline:      19
evidence-blocked:        3   (poi-detail / media-preview / at-panel，M3 从真实入口恢复)
out-of-scope:            0
```

**绝不允许**写成 `19/19`。
