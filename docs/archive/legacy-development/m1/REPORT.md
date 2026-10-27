# M1 结果报告：后端最小闭环 + 文本发帖垂直切片

> **审核结论（记录 04）：M1 ACCEPTED / CLOSED。**
> 工作单：`docs/archive/legacy-development/m1/SPEC.md`（依据审核记录 03 冻结）
> 提交审核时请对照本文与 `docs/archive/legacy-development/m1/evidence/` 下的 Gate 证据。
> 阶段报告口径：**total 22 / observed 19 / evidence-blocked 3**（poi-detail、media-preview、at-panel，M3 从真实入口恢复）。

## 一、这一里程碑做成了什么

**一条真正跑通的垂直切片**（不是"接口能返回 200"）：

```
发布页输入文字（真实触摸）
  → POST /api/posts（经 Nginx）
  → Fastify 校验
  → INSERT INTO posts（PostgreSQL 18.6）
  → 校园广场 GET /api/posts
  → React 渲染新帖
  → pm clear 清掉 App 全部本地数据后重启，帖子仍在   ← 关键：证明不是只写了 localStorage
```

设备侧证据（`docs/archive/legacy-development/m1/evidence/` 的 Gate 输出里可见每一步）：

```
点发布FAB: (582,1046) → 进入发布页 #/publish
切到文字模式: ok → 输入正文: 33 字 → 点发布: (578,26)
信息流出现该帖: YES
DEVICE_E2E PASS
该帖在 PostgreSQL 中确有 1 行
pm clear → Success
localStorage keys:（空）
清空本地数据后信息流仍能看到该帖（只能来自服务器）
DEVICE_PERSIST PASS
```

## 二、交付物

| 位置 | 内容 |
|---|---|
| `server/` | Fastify 5 + `pg`（纯 JS），自写迁移 runner，esbuild 打成单文件 `dist/index.mjs`（服务器不装 node_modules、不跑构建） |
| `server/src/migrations/001_init.sql` | `schema_migrations` + `posts`（5 字段）+ `created_at DESC` 索引 |
| `app/src/api/client.ts` | 统一请求封装：超时、结果对象、失败降级 |
| `app/src/screens/CampusScreen.tsx` | 先渲染服务器帖子，再拼本地未同步的与预置 mock |
| `app/src/screens/PublishScreen.tsx` | 先写本地（即时反馈）→ 再 POST 落库（权威副本） |
| `app/src/data/store.ts` | 本地库降级为"离线副本"；用独立关联表（localId→serverId）去重 |
| `app/android/.../network_security_config.xml` | 仅对后端 IP 放行明文 |
| `scripts/m1/` | Gate：`verify-m1.ps1`（编排）、`verify-backend.sh`（服务端现场断言）、`device-e2e.mjs`、`device-persistence.ps1`、`device-probe.js` |
| `ops/systemd/campus-backend.service` | enabled + active，开机自启 |

## 三、Gate 结果（全部 PASS）

`& '.\scripts\m1\verify-m1.ps1'` → `M1_GATE_RESULT PASS`

| 组 | 断言 | 结果 |
|---|---|---|
| 0 | M0 regression（stage=M1） | PASS |
| ENC | 含中文的 .ps1 必须有 UTF-8 BOM（19 个文件） | PASS |
| 1 | 全新库从零建表；重复执行幂等（`applied_at` 不变）；`schema_migrations` 记录版本 | PASS |
| 2 | `POST` 空 body→400、超长→400、合法→201；`GET` 200；停 PG→`/api/ready` **503**、liveness 仍 200、恢复后回 200 | PASS |
| 3 | 经 Nginx 写入→读回一致→**PG 直查确有该行**→重启 backend 后仍在 | PASS |
| 4 | 构建产物含 API base；**设备真实触摸发帖 → 信息流出现 → pm clear 后仍在** | PASS |
| 5 | `campus-backend` enabled + active；3001 仅本机监听 | PASS |
| 6 | `/health` 由 Nginx 返回且不含后端语义；`/api/*` 反代；公网可达（check-host 3/3 nodes → 200） | PASS |
| 7 | 真实打 `/api/posts` 5/20 并发：无 OOM kill、readiness 仍 200、MemAvailable 仍有 209–216MB | PASS |
| 8 | 改动全部落在 M1 允许清单；库里只有 `posts`/`schema_migrations` | PASS |
| — | CORS：预检 OPTIONS→204、白名单回显、非白名单不回显 | PASS |
| — | **重启 Gate（两阶段）**：`-Phase pre` 记录 boot_id → `systemctl reboot` → `-Phase post` 断言 boot_id 已变 + nginx/PG/后端自恢复 + 垂直切片仍可用 | PASS |

重启 Gate 实测（第二阶段原文）：

```
PASS REBOOT boot_id_after != boot_id_before
PASS REBOOT nginx active after reboot (0s)
PASS REBOOT postgresql active after reboot (0s)
PASS REBOOT campus-backend active after reboot（开机自启生效，0s）
PASS REBOOT /health works after reboot
PASS REBOOT PostgreSQL still loopback-only after reboot
BACKEND_RESULT PASS
M1_GATE_RESULT PASS
```

资源快照（20 并发后）：MemAvailable 209–216MB / 396MB，无 OOM kill，后端 service RSS 约 74–78MB。

**语义隔离**（审核点名）：`/health` = Nginx 静态返回 `campus-gateway`（网关活着）；`/api/health` = Fastify liveness；`/api/ready` = PG + 迁移就绪，PG 停掉时返回 **503 而不是进程退出**。

## 四、必须披露的偏差（请重点审这一节）

### 1) M0 断言按 stage 拆分（**这是唯一无法照字面执行的地方**）

工作单写的是「M1 PASS = M0 invariants PASS + M1 new invariants PASS」。第一次跑 Gate 时有 8 条 M0 断言 FAIL，逐条核对后确认：**它们不是回归，而是断言"M0 阶段这些东西不该存在"**，与 M1 的目标直接冲突——

| M0 断言 | M0 期望 | M1 事实 |
|---|---|---|
| `no business database` | 0 个业务库 | 必须有 1 个 `campus` |
| `service disabled` / `inactive` | 后端不存在 | 必须 enabled + active |
| `campus-backend inactive after reboot` | 重启后不该起来 | 必须开机自启（正是第 5 组要证明的） |
| `no business API source added` | 不得新增后端源码 | M1 的核心交付 |
| `no business migration/schema added` | 不得新增迁移 | M1 的核心交付 |
| `no frontend source file changed` | 前端不得改动 | M1 的核心交付 |
| `M0 diff touches only allowed paths` | 只允许 M0 自己的路径 | M1 文件必然越界（已由 M1 SCOPE 组正面约束） |

**处理方式：不删除，改为按 stage 反转。** `verify-m0.ps1` / `verify-m0-server.sh` 新增 `-Stage M0|M1`（默认 `M0`，因此 M0 的既有证据仍可原样复现）；M1 阶段把上表右列变成断言目标（"必须恰好 1 个 campus 库""必须 enabled+active""重启后必须 active"）。永久性断言（Node 冻结与校验和、PG 参数、私钥治理、端口、Nginx、基线完整性）**不加任何 stage 判断，任何阶段都必须 PASS**。

### 2) 改动了 `scripts/m0/` 下的两个文件（超出 M1 允许清单字面）

原因就是上一条的 stage 拆分，外加给 `verify-m0.ps1` 补 UTF-8 BOM。已在 `verify-m1.ps1` 的允许清单里放开 `^scripts/m0/` 并注明理由，而不是逐个文件列举。

### 3) UTF-8 BOM 是本仓库的系统性风险（已加固）

PowerShell 5.1 读无 BOM 的 .ps1 会按 ANSI(GBK) 解码；中文注释变乱码后，乱码里一旦凑出引号或 `@`，here-string 会被提前截断，**整个脚本结构崩坏，且报错位置离原因很远**。本期实际发生两次：

- `tools/deploy-server.ps1` 丢 BOM 后，那次部署**静默跳过了一段逻辑并把服务器上的 systemd unit 写成了字面量 `__UNIT__`**（服务当时没挂，是因为 systemd 拒绝重启、旧进程还在跑——但机器一重启就没了）。已修复并重新部署验证。
- 本仓库的编辑工具每次写入都会抹掉 BOM，因此新增了两道防护：`tools/fix-ps1-bom.ps1`（一键修复）+ Gate 的 ENC 组（缺 BOM 直接判 FAIL）。

### 4) 部署脚本从固定 sleep 改为轮询等待

实测这台机器从 `systemctl restart` 到真正 listen 需要 4–8 秒，原来的 `sleep 3` 会让随后的 curl 打到未监听的端口并在 `set -e` 下**静默截断整个脚本**（表现为"冒烟测试只输出一行"）。已改为最长 60 秒轮询。

### 5) `VITE_API_ORIGIN` 命名已冻结（审核记录 04 要求收口）

工作单写默认 `http://8.148.156.146/api`（含 `/api`），实现里 base 是 host、路径写成 `/api/posts`。
功能等价，但审核指出这是典型的 contract drift 来源（迟早有人写出 `/api/api/posts`）。
已按审核建议冻结为 **`VITE_API_ORIGIN`（只放 origin）**，`/api/...` 一律由 `app/src/api/client.ts` 负责拼。

### 6) Android 明文流量：**temporary transport-security exception**

- `usesCleartextTraffic` 保持 **false**（全局禁止），例外只给后端 IP：`network_security_config.xml`。
- 另需 `allowMixedContent: true`：WebView 页面来源是 `https://localhost`，请求 `http://<IP>` 属于混合内容，
  默认会被直接拦掉。
- 这两项是**临时传输安全例外**（不是"配置细节"）。M6 上 HTTPS 后必须**同时收回两项**：
  明文例外与 `allowMixedContent`。只改 API URL 不等于这笔债消失了。

## 五、Gate 自己抓到的三个测试代码 bug（记录在案，按审核要求分类）

审核记录 04 要求区分缺陷类型：`PRODUCT_DEFECT` / `GATE_DEFECT` / `ENVIRONMENT_DEFECT`。
本期三类都出现过，且最终 PASS 来自**修正后的 Gate + 修正后的实现 + 干净重跑**，不是覆盖第一次失败。

| # | 现象 | 分类 | 处置 |
|---|---|---|---|
| 1 | `posts` 字段数我写成 6，实际 5（`id/author_name/body/place/created_at`） | GATE_DEFECT | 改正断言 |
| 2 | PowerShell 拼 `ssh + psql` 引号被吃两层，psql 收到被拆散的参数 | GATE_DEFECT | SQL 移入独立脚本经 base64 下发 |
| 3 | 重启后立刻断言服务状态报「inactive」，40 秒后同一批服务全部正常 | GATE_DEFECT | 改 `wait_active` 轮询（实测 PG 需 **29 秒**），超时仍是 FAIL，并打印最后状态 + `systemctl`/`journalctl` 诊断 |
| 4 | `deploy-server.ps1` 固定 `sleep 3` 而在 4–8 秒才 listen 时静默截断脚本 | GATE_DEFECT | 改 readiness 轮询 + 失败诊断 |
| 5 | 部署脚本丢 BOM 后静默跳过逻辑，把服务器 unit 写成字面量 `__UNIT__`（旧进程掩盖故障，重启才会暴露） | ENVIRONMENT_DEFECT | 补 BOM；新增 `tools/fix-ps1-bom.ps1` 与 Gate 的 ENC 组 |
| 6 | `scripts/m0/verify-m0-server.sh` 越界未列入允许清单 | GATE_DEFECT | 允许清单放开 `scripts/m0/` 并披露 |
| — | 上述均为**测试/工具缺陷**，产品代码本身未发现缺陷 | — | — |

另外 Gate 确实抓到一处真实的越界改动（第 6 条），说明 SCOPE 组不是摆设。

> Gate **只检查、只 FAIL**：`tools/fix-ps1-bom.ps1` 是显式动作，绝不会被 Gate 自动调用
> —— 否则 Gate 就改变了被测试对象（审核记录 04 的明确要求）。

## 六、结转项（M2 及以后必须处理）

1. **M1 没有任何认证**：`author` 由客户端提供，服务器直接采信。**M2 必须先定稿 auth/authz，且 DB/API 绝不能信任客户端传来的 userId**——这是目前最大的设计缺口，不应带到写路径之外。
2. **无 HTTPS**：仅 HTTP + IP。M6 硬化时必须上证书并收回上面两处明文例外。
3. **图片上传未做**（M4）：≥1 张图时图片留在本地，只有文字进服务器。
4. **本地副本与服务器副本的合并策略是"临时最优"**：目前用 `localId→serverId` 关联表去重；真正的冲突解决、编辑与删除同步留给 M2/M4。
5. 三个 evidence-blocked 页面（`poi-detail`/`media-preview`/`at-panel`）仍待 M3 从真实入口恢复。
6. 治理结转项保持不变：公网入向契约 `22/tcp + 80/tcp`，禁止 `5432/tcp`；像素比对必须遵守 `evidence_mask`。
