# Campus 项目计划（v2：从 demo 到完整前后端项目）

> 本文件是本项目的**唯一计划来源**。每次计划变更都要更新这里，并同步提交远程审核。
> 审核记录见 `docs/review-log/`。

## 一、项目目标

把已有的 campus demo（React + Capacitor 前端，复刻安卓 app `com.kairuotu.campus`）
改造成**拥有独立前后端的完整项目**，并**部署上线**。

最终验收标准：**严格 1:1 复现原版 campus**（页面、状态、交互、数据语义）。

## 二、新要求清单（相对上一轮 demo 的增量）

| # | 要求 | 落地方式 |
|---|---|---|
| R1 | 独立前后端 | 前端 `app/`（现有）+ 后端 `server/`（新建），通过 HTTP API 通信 |
| R2 | 真实数据库 | PostgreSQL（服务器原生安装，非 Docker） |
| R3 | 部署上线 | 阿里云 ECS，Nginx 反代 + systemd 托管，公网可访问 |
| R4 | 继续对照原版复现 | MuMu 模拟器里的 `com.kairuotu.campus` 作为唯一 oracle |
| R5 | 远程独立审核 | 每个工作单「计划 → 执行 → 测试」后提交网页版 ChatGPT 审核，意见落盘 |
| R6 | 小步快跑 | 每个工作单只做一个可验证的闭环，不夹带后续阶段 |
| R7 | 全程自动化 | 人只做授权类操作（云控制台、登录），开发全自动 |

## 三、硬约束（环境实测）

| 项 | 实测值 | 影响 |
|---|---|---|
| 服务器 | 阿里云 Ubuntu 26.04，2 vCPU，**可用内存 396MB**，2GB swap，磁盘 20GB | 不用 Docker；PG 必须调参；不在服务器上跑前端构建 |
| 端口 | 仅 22 开放 | 需在阿里云控制台开放 80/443（用户操作） |
| 域名 | 无 | 先 IP + HTTP；安卓端需处理明文流量 |
| 仓库 | `G:\demo map`，工作分支 `fullstack`（干净历史，从 `demo` 分出） | 本地 `main` 历史含旧 Key，**永不推送** |

## 四、里程碑与 Gate（依据审核记录 01 修订）

> 审核方核心意见：原计划把「后端化」和「1:1 验证」串行化了，容易到 M5 才发现理解偏差导致返工。
> **1:1 验证必须贯穿 M0–M5**，M5 只是最终收敛阶段。

| 阶段 | 交付 | Gate（通过标准） |
|---|---|---|
| **M0 基线冻结 + 环境准备** | 仓库整顿；原版 app 页面/路由/状态/关键行为清单 + 截图基线；服务器 Node/Postgres/Nginx/systemd；开放 80；PG 仅监听 localhost | 能明确回答「原版有哪些页面、状态、关键行为」；服务器基础服务重启后仍稳定 |
| **M1 后端最小闭环** | Fastify + PG pool + migration + health/readiness + systemd + Nginx；**只做一个极小真实 API** | `Android/Web → Nginx → Fastify → PostgreSQL → GET /api/test` 全链路跑通；顺带验证 Capacitor baseURL、安卓明文流量、CORS、systemd、reboot 自启 |
| **M2 数据模型 V0.1** | 用户/帖子/图片/评论/点赞/地点/消息/群组/公告建模（不追求终态）；seed | migration 可从空库重建；seed 可重复执行；关键关系有约束；`pg_dump` + restore 演练通过 |
| **M3 垂直切片迁移** | 按完整用户路径替换 mock（不是「先做全部接口再改前端」） | 每个 slice 完成后，真实 API + UI + 原版行为同时验证通过 |
| **M4 写能力 + 媒体** | 发帖/评论/点赞/私信/上传；认证、输入验证、上传安全、事务/幂等 | 核心写路径真正持久化，重启不丢数据 |
| **M5 全量 1:1 收敛** | 处理剩余视觉/行为差异 | 页面矩阵全部销项 |
| **M6 Production hardening** | HTTPS、备份/恢复演练、日志轮转、磁盘告警、服务恢复、安全加固 | 可恢复，而不只是「能访问」 |

### 审核要求必须补的 5 项

1. **M0 必须产出「原版行为基线冻结」**：每个已复刻页面至少记录
   `route/page`、`entry condition`、`reference screenshot`、`loading/empty/normal/error state`、
   `interaction`、`navigation result`、`persistent state`、`known unknowns`。
   MuMu + 原版是宝贵 oracle，不能等到 M5 才用。
2. **M1 必须是真正的端到端 vertical slice**，不是「Fastify 能启动 + /health 返回 200」。
3. **M3 按垂直业务切片迁移**，禁止产出「服务 mock/UI 形状」的 API
   （反例：`/posts/list2`、`/posts/detailData`、`/userPagePosts`）。
   前端组件结构可尽量不变，但后端领域模型不要迁就 mock。
4. **auth/authz 是明确缺口**，必须在 M2 前定清楚：身份从哪来、`user_id` 是否由客户端提交、
   私信读取权限、图片/帖子删除权限、群组成员权限。可以先用极简认证，
   但**数据库与 API 从一开始就不能相信客户端传来的 userId**。
5. **备份不要全部推迟到 M6**：M2 之后就必须有 `pg_dump` + restore 测试。

### M3 推荐的切片顺序

```
Slice 1  帖子列表 → 帖子详情 → 评论列表
Slice 2  点赞 → 点赞状态 → 点赞计数
Slice 3  发帖 → 图片上传 → 帖子列表刷新
```

## 五、PostgreSQL 与运行时参数（审核 PASS）

```conf
# Connections
max_connections = 15
# Memory
shared_buffers = 64MB
effective_cache_size = 192MB
work_mem = 1MB
maintenance_work_mem = 16MB
autovacuum_work_mem = 16MB
# Parallelism（全关：parallel worker 是独立进程，会放大内存/CPU 消耗）
max_parallel_workers_per_gather = 0
max_parallel_workers = 0
max_parallel_maintenance_workers = 0
# Conservative background activity
autovacuum_max_workers = 2
```

- Fastify 连接池：`pool.min = 0`、`pool.max = 5`
- 这是「优先不 OOM」的 bootstrap 参数，不是性能最优；上线后按真实 RSS/swap/load 再调。
- 2GB swap 是救命缓冲，**不是正常工作内存**；若常态已有 swap in/out，判定 HOLD。

## 六、图片存储设计（审核 PASS）

**方案**：本地文件系统 + PostgreSQL 存 metadata + Nginx 直接 serve。
不引入 MinIO/Docker（396MB RAM + 20GB 盘下属于不必要的架构扩张）。

冻结以下原则：

| 原则 | 做法 |
|---|---|
| DB 只存逻辑 key | 存 `2026/09/uuid.webp`，不存完整 URL / 部署路径 → 未来切 OSS 时 DB 不变 |
| 文件名服务端生成 | UUID/ULID，绝不用客户端文件名 |
| 上传限制 | 允许 jpeg/png/webp；**拒绝 SVG、任意 binary、超大图**；单图 ≤ 5MB、单帖 ≤ 9 张；不信任 Content-Type 与扩展名，解析真实图片 |
| 上传时压缩 | 限制长边（1920/2560）→ WebP/JPEG，只保留处理后的 production image |
| 缩略图 | V1 只做 display image（必要时加 thumbnail），不预生成多规格 |
| 静态服务 | Nginx `location /media/ { alias /srv/campus/uploads/; }`，不要 Node 读文件转发 |
| 磁盘 Gate | >70% WARN、>80% ALERT、>90% 拒绝新上传（507） |
| 写盘顺序 | `write tmp → validate → atomic rename → INSERT DB`；DB 失败则 unlink |
| 备份 | **DB + uploads 联合备份**，同一 backup generation（`database.sql.gz` + `uploads.tar.zst` + `manifest.json`） |

目录结构：

```
/srv/campus/
├── app/            # 后端代码
├── uploads/        # 图片（Nginx /media/ 指向这里）
└── backups/
```

## 七、审核协作协议（每个工作单固定动作）

1. 写工作单（目标 / 交付物 / 验收方式 / 明确不做什么）
2. 提交 ChatGPT 审核 → 意见落盘 `docs/review-log/NN-*.md`
3. 按意见修订后执行
4. 采集测试证据（命令输出、截图、接口响应）
5. 把「执行 + 证据」再次提交审核，直到 PASS
6. 提交 git，进入下一个工作单

## 八、当前状态

- [x] 三项准备检查（ChatGPT 可对话 / MuMu 可控 / 服务器 SSH 可达）
- [x] 计划 v2 成文（本文件）
- [x] **M0 基线冻结 + 环境准备 —— PASS / CLOSED**（锚点见 `docs/m0/ANCHOR.md`）
- [x] **M1 后端最小闭环 + 文本发帖垂直切片 —— 实现与 Gate 全绿，待审核**（结果见 `docs/m1/REPORT.md`）
- [ ] M2 数据模型 V0.1 + 认证/鉴权定稿（**NEXT**）

---

## 九、M1 规格（依据审核记录 03，冻结）

> 审核原文：`docs/review-log/03-m0-verdict-and-m1-go.md`

### 语义隔离（不可用一个大 /health 假装证明三件事）

| 检查 | 证明什么 |
|---|---|
| `/health`（Nginx 直接返回） | **Edge health** —— 网关活着 |
| `/api/health` | **Backend liveness** —— Node/Fastify 进程活着 |
| `/api/ready` | **Backend readiness** —— 能连 PG 且 migration 状态满足；**PG 不可用时必须失败** |

### vertical slice 的定义（M1 最重要的 Gate）

不是「Fastify 能启动」，也不是「/api/health 返回 200」，而是
**真实 UI → HTTP → Fastify → PG → 再读出来 → 真实 UI**，且至少发生一次真实持久化：

```
User action → React → Nginx /api → Fastify → PostgreSQL INSERT/UPDATE
           → GET → React 渲染出持久化的值
→ 重启 backend → 数据仍在
```

### M1 Gate 核心断言（审核点名）

1. fresh DB 能从 migration 创建 schema
2. migration 可重复执行且版本可识别
3. Fastify 使用受限 PG pool（不是无限连接）
4. backend systemd **enabled + active**
5. **reboot 后自动恢复**
6. `/health` 与 `/ready` 语义明确
7. readiness 在 PG 不可用时必须失败
8. 至少一个真实业务 E2E write/read
9. 该 slice **不再依赖 localStorage 作为业务真源**
10. backend restart 后数据仍然存在
11. Nginx 是客户端唯一 HTTP 入口，**不暴露 Node 监听端口**
12. M1 完成后重新测 396MB 机器的内存 / swap activity / OOM
13. **M1 Gate 必须包含 M0 regression Gate**（M0 invariants 仍 PASS）

即：`M1 PASS = M0 invariants PASS + M1 new invariants PASS`（M2/M3 沿用同一模式）

### M1 交付边界

- 必须做：Fastify + PG pool + migration + health/ready + systemd(enabled) + Nginx 反代 + 一个真实 vertical slice
- 不得做：为 3 个 evidence-blocked 页面补证据（留给 M3 从真实入口恢复）
- 报告口径：始终 `total 22 / observed 19 / evidence-blocked 3`，不得写 `19/19`

### 治理结转项（non-blocking）

- 期望公网入向契约：`22/tcp` + `80/tcp`；禁止 `5432/tcp` 与后端内部端口
- 脱敏区域（`login-sns`）在做 pixel diff 时必须按 `evidence_mask` 跳过

