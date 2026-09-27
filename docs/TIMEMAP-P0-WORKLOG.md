# BJTU TimeMap P0 实施工作记录

> 交付要求：修复实现与需求不符之处 + 完成 P0（F01–F07），并记录全部工作与改动。
> 需求来源：`BJTU TimeMap需求分析与产品设计文档.docx`（权威）+ `北交大校园记忆地图项目需求分析初稿 (1).docx`（V0.4）。
> 状态行会随进度更新。最后更新：2026-09-26（T1–T4 完成，T5/T6 进行中）。

## 零、本轮进度总览

| 项 | 状态 | 证据 |
|---|---|---|
| 服务端改动（016 迁移 + timemap.ts + index.ts） | ✅ 完成 | `tsc --noEmit` 退出码 0 |
| T1 补漏 `GET /api/me/favorites` | ✅ 完成 | 已在 `timemap.ts:161`，E2E 断言覆盖 |
| 服务端产物（5 个 mjs） | ✅ 完成 | `tools/tmp/build-server.ps1`，5/5 冒烟通过 |
| T2 服务端全链路验证（本地 PG + HTTP） | ✅ 完成 | **76/76 PASS**，`tools/tmp/timemap-p0/verify-p0-e2e.json` |
| T3 前端改造（全部界面） | ✅ 完成 | `tsc -b` 退出码 0 |
| T4 构建 | ✅ 完成 | `vite build` 成功（111 modules，679KB / gzip 211KB） |
| T4 浏览器冒烟 | ✅ 完成 | **57/57 PASS，4 SKIP（需登录态，已写明原因）**；抓到并修掉"活动页重复挂载" |
| T5 部署（后端） | ✅ 完成 | 线上 `applied=16/16`、`schema_state=ready`；**线上冒烟 40/40 PASS** |
| T5 部署（前端） | ⚠️ 已上线一版，但**需再部署一次**（含重复挂载修复） | `DEPLOY_WEB: OK` build-id `20260926-013153` |
| T5 回滚演练 | ⏸ 待执行 | 脚本已就绪：`tools/rollback-server.ps1` + `tools/remote/rollback-remote.sh` |
| T6 本文档 | ✅ 完成 | 含 §六~§九 的全部踩坑与环境边界 |

## 七、⚠️ 首次部署事故：迁移 checksum 不匹配导致线上 fail-closed 503（2026-09-26）

### 现象
部署后 `/api/ready` 与所有 `/api/*` 返回 **503**（前端首页仍 200，所以"站点看起来是开的"）：

```
/api/ready -> 503 {"status":"not_ready","db":"up","migrations":{"applied":15,"expected":16},
  "schema_state":"terminal",
  "detail":"migration checksum mismatch: 001_init (stored=5e5b9bb7b7a2… actual=b57e367e7fdd…)"}
```

### 根因（已用字节级证据定死，不是猜的）
`server/src/db.ts:90` 的 `migrationChecksum` 是**朴素的 sha256**，**不做换行归一化**：
```js
createHash('sha256').update(sql, 'utf8').digest('hex')
```
而本仓库 `core.autocrlf=true`（`.gitattributes` 里**没有** `*.sql` 规则）⇒ 工作区里的
`001_init.sql` 是 **CRLF**，git 里存的是 **LF**。esbuild 把**工作区那份 CRLF 字节**打进单文件包 ⇒
服务端启动时算出的 checksum 与库里存的对不上 ⇒ 迁移校验**故意 fail-closed**。

实测三个数（同一次会话内算的，可复现）：
```
工作区文件 as-is (CRLF)  sha256[:12] = b57e367e7fdd   ← 产物里的 "actual"
工作区文件 LF 归一化后    sha256[:12] = 5e5b9bb7b7a2   ← 服务端 "stored"
```
⇒ 部署前的那个包必然是 LF 字节（git 的规范形式），我这轮的构建把 CRLF 带了进去。

### ⚠️ 这个陷阱最误导人的地方
**只有 `001_init` 报错**，002–015 都通过（它们的库内 checksum 恰好是 CRLF 时期回填的）。
很容易被读成"只要修这一条"，而正确做法是**把所有迁移固定成同一种换行** ——
只修 001 会让下一次换成另一个文件报错，等于把一个系统性问题当成偶发处理。

### 修复（三层，缺一不可）
1. **字节层**：把 001–015 全部归一化为 LF（016 本来就是 LF）。归一化后逐文件校验：
   001 从 `b57e367e7fdd` 变为 `5e5b9bb7b7a2` = 服务端 stored 值 ⇒ **完全吻合**。
2. **仓库层**：`.gitattributes` 增加 `*.sql text eol=lf` + `server/src/migrations/*.sql text eol=lf`，
   并 `git add --renormalize`（实测 `git diff --cached --ignore-cr-at-eol` 为空 ⇒ **只动换行、没动内容**）。
   现在 `git ls-files --eol` 显示 `i/lf w/lf attr/text eol=lf`。
3. **防线层**：新增 `tools/tmp/check-migration-checksums.mjs` + `tools/tmp/build-db-probe.ps1`，
   并把它接进 `tools/deploy-server.ps1` 的**上传之前**（失败即中止，服务器毫发无损）。
   判据是"**产物自己导出的 `MIGRATIONS` + `migrationChecksum`** 是否与源文件逐条一致（16/16）"。

### 这次检查本身踩的坑（记下来，因为它是"检查方法坏了"的又一例）
第一版检查是"在 `index.mjs` 里 `indexOf` 源文件原文"，结果 **16 项全 FAIL** ——
那不是产物坏了，是**检查方法坏了**：esbuild 会转义/包装内联文本。
第二版改成 `import server/dist/index.mjs` 取它的 `MIGRATIONS`，又拿到 `undefined`：
**esbuild 把 index.ts 没用到的那两个导出 tree-shake 掉了**。
⇒ 最终方案：单独把 `src/db.ts` 打成探针模块（同一源码、同一 `.sql=text` loader、并补上
`createRequire` banner，否则 pg 的 CJS `require` 会抛 `Dynamic require of "events"`）。
**教训与 WO#25 那条同源：绿要绿得有依据，红也要红得有依据 —— 检查全 FAIL 时先怀疑检查本身。**

## 八、第二次部署事故：016 迁移在两个真实数据场景下失败（2026-09-26）

换行修好之后，016 开始真正执行，然后**连续暴露两个真实缺陷**——都不是环境问题，
而是"种子数据假设了一个干净库"：

### 8.1 `users_phone_e164_uniq` 冲突

```
migration 016_timemap_p0 failed: duplicate key value violates unique constraint "users_phone_e164_uniq"
```

`users` 表上有**两个**唯一约束：主键 `id`，和 `users_phone_e164_uniq(phone_e164)`。
016 的管理员种子只写了 `ON CONFLICT (id) DO UPDATE` ⇒ 只覆盖前者。
线上存在一个**手机号相同、UUID 不同**的账号（P0 之前用这个演示号登录过；
本项目是"登录即注册"，会建一个随机 UUID 的账号）⇒ 插入撞 phone 唯一约束。

**修法**：先按手机号**认领**（已存在就把它提升为 admin，**保留它原来的 id** ——
那个 id 可能已关联历史帖子/会话，改 id 会破坏引用），否则再按 id 插入。这样既幂等，
也不会因为"演示号被人用过"而让迁移挂掉。

### 8.2 `activities_created_by_fkey` 冲突（同一根因的第二处表现）

```
migration 016_timemap_p0 failed: insert or update on table "activities"
  violates foreign key constraint "activities_created_by_fkey"
```

活动种子把 `created_by` **硬编码**成 `bbbbbbbb-…`。而当管理员账号用的是另一个 UUID 时
（8.1 那种情况），那个 UUID **根本不存在** ⇒ 外键失败。
⇒ 改为 `(SELECT id FROM users WHERE phone_e164 = '+8613800000001')` 按手机号解析真实 id。

⚠️ **为什么必须两处一起修**：只修 8.1 的话，016 会推进到活动种子再挂在 8.2 ——
等于把同一个设计缺陷分两次踩。这正是"迁移必须对真实数据幂等，不能假设干净库"的具体教训。

### 数据审计（确认没有第三处同类问题）
- `places` / `place_photos` / `activities` 的三张种子表：除主键外**没有**其它唯一约束
  ⇒ 它们的 `ON CONFLICT (id)` 足够（`place_photos`/`activities` 在 016 里才创建，不可能已存在冲突行）
- `activities.created_by → users(id)` 是 016 里唯一引用 users 的种子外键
- 全文件再查 `bbbbbbbb-` 只剩 users 种子那两处（正确用法）

### 本地复现与验证（**先证明修好，再上服务器**）
新增 `tools/tmp/reproduce-016-conflict.ps1`：把本地库退回"015 + 一个手机号撞车的用户"。

| 判据 | 结果 |
|---|---|
| 修复前 | 复现出与线上一模一样的 `users_phone_e164_uniq` 报错 |
| 修复后 | `applied=16/16` |
| 撞车账号 | 被提升为 `role=admin`，**UUID 未变**（`11111111-…`） |
| 用户总数 | 仍为 1（没有多出 `bbbbbbbb-…`，引用未被破坏） |
| 6 条活动的 `created_by` | 全部指向真实管理员 `11111111-…` |
| 种子数据 | 16 迁移 / 10 地点 / 6 活动 / 3 老照片 |
| 全链路 E2E | **76/76 PASS**（管理员登录用的就是那个撞车账号） |

### 这个复现脚本本身踩的坑（值得记，因为都是"假绿/假红"）
1. **`Split-Path -Parent $PSScriptRoot` 少了一层**：脚本在 `tools/tmp/`，仓库根在**两层**之上。
   结果 `Get-ChildItem` 找到 0 个迁移，整段变成静默空操作（打印 "applied 0 migrations" 却像跑过了）。
   ⇒ 加断言"public 表数量必须增加"，空操作立刻暴露。
2. **`psql -f <路径>` 遇到中文路径会静默失效**：仓库路径含中文，psql 按本地代码页收到乱码路径
   （实测打印 `.../����ʵѵ/...`），打不开文件**却可能退出码 0** ⇒ 循环报"applied"但什么都没建。
   ⇒ 改为把 SQL 内容经 **stdin**（`-f -`）喂给 psql，路径根本不参与。
3. **`Invoke-Psql -Quiet` 把错误也吞了**：早期版本因此跳过记账，错误归因到很远的地方。
   ⇒ `-Quiet` 只压输出，不压失败。
4. **本地服务端没停**：我 reset schema 后，它的后台重试定时器又把 16 条迁移全跑了一遍，
   把复现现场冲掉了（表现为"`users` 一会儿有一会儿没有"）。⇒ 复现前必须先停服务端。

## 九、浏览器冒烟抓到的真实缺陷：活动页**重复挂载**（2026-09-26）

### 现象
首次浏览器冒烟（游客视角）报两条活动页 FAIL：
```
FAIL  每条活动都有明确状态徽标（US-04③）    期望 5  实际 10
FAIL  今天/本周筛选可用                    期望 ["all","today","week"]  实际 6 个
```
另外 `[data-act-count]` 在 DOM 里有 **2 个**（值都是 5）。

### 根因（**不是**断言错，是真缺陷）
`app/src/App.tsx` 里 `ActivitiesScreen` 被渲染了**两次**：
```tsx
{tab === 'activities' && <ActivitiesScreen />}     // 底部 tab
...
{root === 'activities' && <ActivitiesScreen />}    // 我后来"补"的路由
```
而 `tab` 的取法就是 `root === 'activities' ? 'activities' : null` ⇒ 两个条件**完全等价**
⇒ 组件同时挂载两次 ⇒ 5 条活动画两遍、3 个筛选按钮两遍、**多打一份 API 请求**。

⚠️ 为什么这个缺陷"很难发现"：**只看接口完全看不出来**。接口只被调用一次（用的是其中一份），
返回的数据也完全正确；错误只在 DOM 结构里。这正是"接口全绿不代表界面对"的实例。

### 修法
删掉重复的那一处，只保留底部 tab 的渲染（`root` 版多余），并在代码里写明**为什么故意没有它**，
避免下一个人"顺手补回来"。

### 同时把断言修对（两处，都是**假红**）
| 假红断言 | 真实契约 | 改法 |
|---|---|---|
| `tab == ["地图","活动","我的"]` | 第三个 tab 的文案**是当前账号昵称**（`useTabMeLabel` 取 `displayName \|\| '我'`，且 P0 前原版就是这种"显示账号昵称"的做法） | 改成"前两项固定 + 第三项等于当前昵称"，并**另加一条**文案无关的 `data-tab` 顺序断言 |
| `[data-act-status]` 全局计数 | 活动**详情页**也用 `data-act-status`（在 `.actd` 上） | 收窄成 `li [data-act-badge]` / `.acts__filters [data-act-filter]` |

### 加了通用防线（不只是修活动页那一处）
`App.tsx` 里其它 tab 用的是同一套写法，所以新增一条**通用**断言：
逐个访问 `#/map`、`#/activities`、`#/me`、`#/publish`、`#/favorites`，
断言各页**独有的容器节点恰好出现 1 次**。实测 5/5 单实例。

**最终结果：`P0_BROWSER: TOTAL=57 PASS=57 FAIL=0 SKIPPED=4`**
（4 项 SKIP = 需要真实登录态的发布/互动/举报/管理端，**显式登记并写明原因**，不静默跳过。）

## 十、回滚演练：真实执行记录与验收（2026-09-26）

### 结论
**`ROLLBACK: PASS`** —— 备份被证明**真的可用**，不是纸面步骤。回滚脚本与服务器侧实现
（`tools/rollback-server.ps1` + `tools/remote/rollback-remote.sh`）已在真实服务器上端到端跑通。

### 独立复核证据（回滚后由我方重新探测线上，非脚本自报）
| 判据 | 回滚后实测 | 为什么这条有判别力 |
|---|---|---|
| `/api/ready` | 200，`applied=15, expected=15` | 迁移表回到 P0 之前 |
| `/api/activities` | **404** | P0 新增接口在旧代码里不存在 ⇒ 最能区分新旧 |
| `/api/admin/reports` | **404** | 管理端路由同样不存在 |
| `/api/posts` | 7 条，字段为**旧形状**（无 `placeId`/`favoriteCount`） | 历史帖子恢复 |
| `/api/places` | 2 个，**旧形状**（无 `category`/`enabled`） | ⚠️ 见下方说明 |

⚠️ **`/api/places` 回到 2 个是正确结果，不是数据丢失**：那 10 个北交大地点是**迁移 016 播种**的，
回滚到 015 后自然不存在。同理 `users.role` 列也不存在（脚本验证项之一）。

### 演练过程中暴露并修掉的 7 个真实缺陷（**全部是我脚本的 bug，不是环境问题**）

| # | 缺陷 | 直接后果 | 修法 |
|---|---|---|---|
| 1 | `pg_restore` 传 dump **路径** | dump 属主 root/600，pg_restore 以 postgres 跑 ⇒ `Permission denied` | 先 `cp` 成临时副本 |
| 2 | 以为 `-` 是 stdin | 该 pg 版本把它当文件名 ⇒ `No such file or directory` | 放弃 stdin 路线（实测两次均不成立） |
| 3 | 临时副本没 `chown postgres` | 同上 Permission denied（我删旧代码时连 `chown` 一起删了） | 显式 `chown postgres:postgres` |
| 4 | 在"已被改过"的库上直接 `--clean` | COPY 撞主键、15 个被忽略错误 ⇒ 半恢复 | 先 `drop schema public cascade` 给出干净落点 |
| 5 | **恢复失败却继续往下走** | schema 已 drop、数据没回来 ⇒ 服务端从空库重建 ⇒ **P0 前的历史数据丢失** | 删除"判定为非致命⇒继续"；失败即 `exit` 并用**恢复前快照**还原 |
| 6 | 归档布局假设错误 | 真实归档顶层是 `srv/`，脚本只找 `server/dist`/`web`/`uploads` ⇒ **一条都没恢复**（且静默跳过） | 自动探测解包根（支持带/不带前缀） |
| 7 | 拿 `pg_database_owner` 当应用角色 | PG15 里 `public` schema 属主显示为**系统角色** ⇒ `sudo -u` 报 `not found`、`reassign` 报 `cannot reassign ... required by the database system` | 用 `DBUSER`（campus）；整批 `REASSIGN` 改为**逐表/逐序列 `ALTER ... OWNER TO`** |

### 这次演练最大的一条教训
**"恢复失败"不是 warning，尤其当不可逆动作（`drop schema cascade`）已经执行之后。**
第 5 条缺陷造成了真实的数据丢失：失败被放行 ⇒ schema 已空、数据没回来 ⇒ 服务端重启从空库重建。
两个守卫是这次教训的产物，缺一不可：
1. **不可逆动作前先做安全快照**（`/tmp/pre-rollback-safety-*.dump`），失败时用快照还原；
2. **`pg_restore` 非 0 立即停止**，绝不让流程继续。

### 仍然存在的已知限制（如实登记）
- **回滚会丢 016 播种的数据**（10 个地点 / 6 个活动 / 3 张老照片）——因为它们是**迁移**带来的，
  回滚到 015 后需要重新部署新版让 016 再跑一次（016 已做幂等，可安全重放）。
- **回滚期间线上不可用**（停服 → 恢复 → 起服，实测约 12s 起服 + 恢复本身耗时）。
- **快照文件留在 `/tmp`**，不自动清理（人工确认后自行删除）。
- 回滚**不是零风险操作**：它按设计会覆盖数据库与三个目录，务必带 `-Yes` 前先看预检输出。





### ⭐ 本轮发现并修掉的一个真实缺陷（不是"改测试迁就实现"）

`GET /api/places/:id` 的帖子列表**没有返回 `favoritedByMe`**（只返回了 `likedByMe` 与 `favoriteCount`），
而 P0 的界面需要在"我收藏了没"上显示状态 ⇒ `tsc` 报 `TS2339: Property 'favoritedByMe' does not exist on type 'ApiPlacePost'`。

处置：**在服务端补上**（与 `likedByMe` 完全同型的 `exists(...)` 子查询），而不是把前端类型改成可选了事 ——
后者只会让类型检查通过、运行时永远拿到 `undefined`。并补了两条 E2E 断言钉住它
（登录时 `true`、匿名时恒 `false`）。

## 一、需求结论（已确认，不再重复推导）

- **P0（MVP，10月16日前）= F01 账号资料 / F02 地图地点 / F03 地点详情 / F04 发布 / F05 互动 / F06 活动 / F07 举报管理**。
- 核心业务规则：
  1. 所有帖子必须关联**管理员启用的**预设地点；
  2. 首版帖子和评论**直接发布**（无待审核态），举报 + 事后下架；
  3. 点赞/评论/收藏可撤销，重复请求不重复计数；
  4. 活动由管理员录入，首版无报名/支付/投稿；状态=时间推导+人工取消；
  5. 举报后**不自动下架**；管理员"不处理"或"下架"都**必须记录原因**；
  6. 操作记录包含管理员、对象、时间、动作；
  7. 热度规则冻结：`score = 点赞×2 + 有效评论×3 + 收藏×1 − max(0, 发布起小时数−24)`，近期热门=近7天帖按 score 降序（编码在 `GET /api/places/:id` 的 hot 排序 + `server/src/timemap.ts` 头注释）。
- P1（F08 热帖/F09 照片卡片/F10-F12 贴纸拼图/F13 弹幕/F14 足迹）与 P2/P3 本轮不做。
- 现有仓库是"campus 复刻 + 完整前后端"（复刻页/旧门禁大部分与 TimeMap 无关，保留不动）。

## 二、服务器与备份（⭐ 用户强调：部署前必须先备份，已完成）

| 项 | 位置/值 |
|---|---|
| 服务器 | root@8.148.156.146（阿里云，396MB 内存，PG18 + nginx + campus-backend.service） |
| SSH 密钥 | 仓库根 `TimeMap.pem`（.gitignore 排除 `*.pem`，已 chmod 600，**绝不提交**） |
| 部署布局 | 后端单文件 `/srv/campus/server/dist/*.mjs`（5 个：index/seed/admin/cleanup/cleanup-auth）；前端静态 `/srv/campus/web/`；上传媒体 `/srv/campus/uploads/`；机密 `/srv/campus/server.env`、`operator.env`（**不下载**） |
| **服务器侧备份** | `/srv/campus/backups/pre-timemap-p0-20260925-0012/`（campus-db.dump 83KB + dist-web-uploads.tar.gz 1.0MB + systemd unit + nginx 配置 + SHA256SUMS） |
| **本地侧备份** | `tools/tmp/backup-20260925/pre-timemap-p0-20260925-0012/`（scp 下载，三文件 sha256 与服务器记录一致：670a…/aa25…/c889…） |
| 回滚方法 | ① tar 解包覆盖 dist/web/uploads；② `sudo -u postgres pg_restore -d campus --clean --if-exists <dump>`（先停服务）；③ restart campus-backend |

## 三、已完成（服务端全部改动，typecheck 通过）

1. `server/src/migrations/016_timemap_p0.sql`（新）：users.role（student|admin + 种子管理员 admin/+8613800000001）；places.category('地标'|'食堂')/enabled/description/history/sort_order；posts.client_request_id（唯一索引，防连点重帖）+ status('published'|'removed') + removed_reason/by/at；comments.status…；favorites 表；activities 表（status 只有 scheduled|cancelled，展示态由时间推导）；reports 表（pending 去重唯一索引）；audit_log 表；place_photos 表；种子 = 10 个北交大地点（7 地标+3 食堂）+ 3 张 SVG 占位老照片（来源标注"演示素材"）+ 6 条活动（含进行中/已结束/已取消）。
2. `server/src/db.ts`：注册 016。
3. `server/src/timemap.ts`（新）：POST/DELETE `/api/posts/:id/favorite`；DELETE `/api/posts/:id`（仅作者）；DELETE `/api/comments/:id`（仅作者）；POST `/api/reports`（不自动下架、同人同目标 pending 去重）；GET `/api/activities(:id)`（含 window=today|week）；管理端 `/api/admin/*`：reports 列表+resolve（reason 必填）、posts 列表+takedown、places 列表+新建+PATCH、activities 列表+新建+PATCH、audit-log。全部写操作落 audit_log。
4. `server/src/index.ts`：
   - 会话带 role；verify-code / auth/me 返回 role；
   - `GET /api/posts`：排除 removed；新增 placeId/favoriteCount/favoritedByMe；评论计数只算 published；
   - `POST /api/posts`：**契约变更** → `{ body, placeId(必填,必须存在且启用), mediaIds?, clientRequestId? }`；旧 `place` 文本字段删除；clientRequestId 幂等重放返回原帖；
   - `GET /api/posts/:id`：已下架 → **410** `{error:'gone'}`；新增 favorite 字段；
   - 评论树/发评论/点赞：只对 published 内容生效；
   - `GET /api/places`：默认只返回启用地点，支持 `category=` 过滤（`includeDisabled=1` 供管理端）；返回 category/enabled；
   - `GET /api/places/:id`：重写 → description/history + photos(年代+来源) + activities(7天内) + posts（`sort=latest|hot`，hot 用冻结公式）。

## 四、待办（按顺序）

### T1. 补漏：`GET /api/me/favorites` —— ✅ 已完成
已实现在 `server/src/timemap.ts:161`：返回我收藏的 published 帖子（形状与 `GET /api/posts` 一致、
`favoritedByMe: true`、按收藏时间倒序、limit 200）。E2E 覆盖 4 条断言：
可见该帖、别人的收藏列表不含、取消收藏后移除、下架后退出。

### T2. 本地 PG 开发集群 + 服务端全链路验证 —— ✅ 已完成（76/76 PASS）
- 集群：沿用上次已建成的 `$TEMP/pgdev-timemap`（PG 15.17，端口 5433，`-A trust`），**未重建**。
  验证前用 `drop schema public cascade; create schema public;` 复位，保证可复现。
- 服务端：用**构建产物** `server/dist/index.mjs` 启动（`node --experimental-strip-types src/index.ts`
  在 Node 24 上会因 `.sql` 扩展名直接崩，见 §六·8）。
  环境：`DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres`、`LOGIN_CODE_HMAC_KEY=devkey`、
  `LOGIN_CODE_SINK=tools/tmp/timemap-p0/sink`、`UPLOAD_ROOT=tools/tmp/timemap-p0/uploads`、`PORT=3001`。
- 结果：`/api/ready` → `applied=16/16`；**`P0_E2E: TOTAL=76 PASS=76 FAIL=0`**。
- 脚本：`tools/tmp/verify-p0-e2e.mjs`（不碰数据库，只读 dev sink 取码），证据 JSON 同落盘。

**过程中修正的 4 条**自己的**错误断言**（关键：分清"实现错了"与"我断言错了"）：

| 我最初的断言 | 实际契约 | 判定 |
|---|---|---|
| `/api/activities` 返回 6 条种子 | 默认窗口**按设计**排除"已结束超 7 天"的那条 ⇒ 5 条 | **断言错**，改为断言该规则本身 |
| 断言 `status` 覆盖 ongoing/ended/cancelled | 展示态在 `effectiveStatus`；`status` 是库存态（只有 scheduled/cancelled） | **断言错**，改为断言 `effectiveStatus`；`ended` 单独按 id 取详情验证 |
| 活动详情含 `placeId` | 契约是 `place` **对象**（含 id/name/坐标） | **断言错**，改为 `place.id` |
| audit-log 含 `actorId` | 契约是 `actorName`（join users 得到的显示名） | **断言错**，改为 `actorName` |

⚠️ 这四条**都不是**把断言改成"随便什么都能过"：每一条都换成了**更有判别力**的表述
（窗口规则、展示态 vs 库存态、对象形状、US-08 原文要求的"管理员/对象/时间/动作"四要素）。

### T3. 前端改造（app/） —— ✅ 已完成
- `api/session.ts`：SessionUser+role；updateSessionUser 白名单加 role。
- `api/client.ts`：createPost 新契约；favoritePost/unfavoritePost/listMyFavorites；deleteMyPost/deleteMyComment；createReport；listActivities/getActivity；listPlaces(category)/getPlaceDetail 新形状；admin API 组；类型扩展（ApiPost.placeId/favoriteCount/favoritedByMe、ApiPlaceDetail 新形状、ApiActivity…）。
- `components/TabBar.tsx` + `App.tsx`：tab 改 **地图/活动/我的**（TabKey: map/activities/me）；默认路由 `#/map`；新增 routes：`activities`、`activity`、`admin`；TAB_TITLES 同步。复刻页（campus/chat/board/…）路由保留不删。
- `MapScreen`：标记改为从 GET /api/places 派生（地点聚合，不是单帖）；分类筛选 chips 全部/地标/食堂；点击标记 → `#/poidetail?id=`；保留定位/瓦片降级基础设施与 data-marker-* 测试钩子。
- `PoiDetailScreen`：按需求 4.2 重做（简介/校史/老照片带年代来源/活动卡片→activity 详情/帖子 最新|热门 tab/「在这里发布」带 placeId）。
- `PublishScreen`：重做（地点必选=仅启用列表、文字+≤3 图、直接发布、发布中禁用+clientRequestId=randomUUID；语音/拍摄模式删除——语音帖不在 TimeMap 范围）。
- `FeedDetailScreen`：加 收藏切换、举报（reasonCode 简单弹窗）、作者可见「删除」。
- `MeScreen`：加「我的收藏」「管理端」（role=admin 才显示）入口。
- 新页面：`ActivitiesScreen`（列表+今天/本周筛选+状态徽标）、`ActivityDetailScreen`（时间/地点/来源/「查看地点」→ poidetail）、`AdminScreen`（5 tab：举报处理/内容管理/活动管理/地点管理/操作记录）。
- 注意：createPost 只有 PublishScreen 调用（唯一调用方，重做即可）；CampusScreen/FeedListScreen 只读 listPosts 不受影响。

### T4. 构建 + 冒烟 —— 构建 ✅ / 浏览器冒烟 ⏸
- `app`: `tsc -b` 退出码 **0**；`vite build` 成功（111 modules → `dist/assets/index-*.js` 679KB / gzip 211KB）。
- 浏览器冒烟：脚本 `tools/tmp/verify-p0-browser.mjs` 已就绪（自写 CDP 客户端，无第三方依赖），
  覆盖 §四·T4 清单里**无需登录**的部分：冷启动 `#/map`、底部 tab 文案与顺序、
  地图标记按**地点**聚合（10 个）、分类筛选（7 地标/3 食堂）、地点详情结构（简介/校史/老照片年代+来源/发布入口/排序 tab）、
  活动列表状态徽标与筛选、活动详情五要素一致性与「查看地点」跳对地点、发布页地点必填与语音模式已移除。
  需要登录态的部分（发布→互动→举报→管理端→同步消失）会自动执行；无登录态时**显式登记为 SKIP 并写明原因**（不静默跳过）。

### T5. 部署（本地全绿后才动服务器；备份已就绪）
- `server`: `pnpm build` 出 5 个 mjs；`app`: `pnpm build` 出 web 产物。
- **服务端与前端必须一起换**（POST /api/posts 契约变了，旧前端会 400）。顺序：scp 5 个 mjs → 修属主权限（`chown campus:campus`、`chmod 750`，现状是 -rwxr-x---）→ scp web（**目录 755/文件 644**，历史事故：目录权限错→assets 403 白屏）→ `systemctl restart campus-backend` → `/api/ready` 200（016 自动跑）。
- 可直接复用 `tools/deploy-server.ps1` / `tools/deploy-web.ps1`（Key 默认 TimeMap.pem、Target root@8.148.156.146，匹配）。
- 线上 smoke：管理员登录、发帖、地点/活动/举报/下架全链路 + /health 200。**不跑旧 gate 全量**（大量断言旧契约/旧 UI，必然假红）。
- 内存 396MB：单文件 .mjs 零 node_modules 不变，无新增依赖，符合"轻量化"要求。

### T6. 完成本文档（用户要求的交付物）
补齐：验证证据（curl 输出摘要）、已知限制（坐标/素材为演示值、旧复刻页未动、旧 gate 失效清单）、回滚指引。

## 五、全局注意事项（踩坑清单）

1. **PowerShell 5.1 写 UTF-8 无 BOM 文件会乱码毁脚本**（历史事故两次）——改 .ps1/.sh 一律用 edit 工具。
2. 本机 Git-Bash 的 `python3` 是 Store 占位桩（rc=49）；pandoc 不存在。
3. 本机 PG15 在 5432 且需要密码（未知）；**用独立集群 5433 + trust**，别动现有服务。psql 记得 `-w`。
4. 仓库路径含中文 → PG 相关文件一律放 `$TEMP`（ASCII）。
5. dev sink 验证码在 `LOGIN_CODE_SINK/latest.json`（{"phone","code","expires_at"}）。
6. `TimeMap.pem` 不提交不外传；server.env/operator.env/.db_password/.login_code_hmac_key 不下载。
7. 迁移 016 全部 IF NOT EXISTS / ON CONFLICT，向后兼容；已应用迁移不可改（有 checksum 校验）。
8. activity 展示态 SQL 在 timemap.ts（ACTIVITY_EFF_STATUS_SQL）与 index.ts 地点详情两处内联——改要同步。
9. 部署后旧设备端 gate/APK 流程不回归（本轮范围外）。

## 六、本轮新增的环境坑（都是"环境边界"，不是代码缺陷）

1. **esbuild 的 JS API 在本沙箱不可用**：`node build.mjs` 会 `spawn EPERM` ——
   esbuild 的 JS API 会起一个**带管道 stdio 的常驻服务进程**，而沙箱禁止打开命名管道。
   ⇒ 新增 `tools/tmp/build-server.ps1`：直接调用 esbuild **原生 CLI**（普通子进程，PowerShell 能跑），
     参数与 `build.mjs` 的 COMMON 逐条等价，构建后手工跑 `build.mjs` 里那 5 条冒烟。
   ⚠️ 三条踩到的细节：
     · `--banner:js=<绝对路径>` 会把**路径本身**当 banner 内容输出（⇒ 产物首行是 `C:\...\x.js`，加载即 SyntaxError）；
       改用"构建完成后按字节前插 banner"（与 JS API 的 banner.js 语义一致）。
     · 走 wrapper 入口文件也不行：esbuild 会把 wrapper 的 `import` 提升到最前，
       `createRequire(import.meta.url)` 就落到需要它的 CJS 包**之后** ⇒ `Dynamic require of "node:stream" is not supported`。
     · 原生命令与管道混用会踩 PowerShell 5.1 的 NativeCommandError：`& esbuild ... | ForEach-Object` 在
       **成功**时也可能中断循环 ⇒ 改为 `2>&1 | Out-String` 再判 `$LASTEXITCODE`。
2. **vite build 也不可用**：`exec("net use")`（vite 用它探测网络驱动器）撞同一个沙箱边界，
   而该异常发生在 vite 的 try/catch **之外** ⇒ 整个构建中止。
   ⇒ 新增 `tools/tmp/vite-sandbox-shim.mjs`，用 `--import` 注入，只拦截 `net use` 这一条命令并让它异步失败。
   **这不是绕过检查**：vite 自己的回退逻辑就是 `if (error) return;`，失败时它本来就会退回标准 `fs.realpathSync`
   —— 等价于"这台机器没有网络驱动器"。
3. **本机没有 `pwsh`**（只有 Windows PowerShell 5.1），`pwsh -File x.ps1` 直接 CommandNotFound；用 `& .\x.ps1`。
4. **`pwsh` 工具里 `$env:TEMP` 指向沙箱临时目录**（`...\Temp\dsh-XXXX`），对它建目录会被拒；
   而 `C:\Users\Lenovo\AppData\Local\Temp` 反而可写 ⇒ 需要"沙箱外的临时目录"时用后者。
5. **`Node` 的 `child_process` 管道 spawn 与 Git Bash 都被沙箱拦**：`bash` 报
   `fatal error - CreateFileMapping ... Win32 error 5` ⇒ 无法用 Git Bash 跑仓库的 `scripts/m5/web/*.sh`，
   也无法用 bash 启动 Chrome。
6. **本沙箱不能启动浏览器**：`Start-Process chrome`/`msedge` 的进程会被回收（`hasExited=True`），
   后台作业同样拿不到 CDP 端口 ⇒ T4 的浏览器冒烟必须由用户在**自己的终端**启动 Chrome。
7. **`curl.exe` 出网被拦**（对 example.com 与生产服务器都返回 `000`），但 **Node 的 `fetch` 正常**
   ⇒ 线上冒烟脚本改用 fetch（`tools/tmp/verify-p0-prod.mjs`）。
8. **`node --experimental-strip-types src/index.ts` 在 Node 24 上启动即崩**：
   `ERR_UNKNOWN_FILE_EXTENSION: .sql`（迁移文件是 `import ... from './migrations/001_init.sql'`，
   类型剥离不处理非 JS 扩展名）。**必须用构建产物** `dist/index.mjs` 起服务（esbuild 已把 SQL 内联）。
   ⚠️ 这条与 worklog 原先记的启动命令不一致，按本条为准。
9. **本沙箱 SSH 完全不可用**（T5 因此交用户终端执行）：`TimeMap.pem` 的 ACL 里有一个
   sandbox 组带 Modify 权限 ⇒ OpenSSH 拒绝（`UNPROTECTED PRIVATE KEY FILE`）；而修复它需要改 ACL，
   `icacls` 被沙箱拒绝（`Access is denied`，`workspace-write` 重试同样失败）；
   Windows 的 OpenSSH 客户端**没有** `StrictModes` 选项（写了会 `Bad configuration option`）；
   `ssh-agent` 服务是 Disabled 且无法启动（`error 1058`）。
