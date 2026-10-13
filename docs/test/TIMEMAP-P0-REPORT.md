# BJTU TimeMap P0 交付报告

> 交付物：① 修复实现与需求不符之处 ② 完成 P0（F01–F07）③ 本文档（工作与改动汇总、验证证据、备份恢复指引、已知限制）
> 需求依据：《BJTU TimeMap需求分析与产品设计文档》（权威）+ 《北交大校园记忆地图项目需求分析初稿 (1).docx》（V0.4）
> 日期：2026-09-26（初版）／2026-10-09（增量：APK 1.2、管理员密码登录、仓库可重建性修复，见 §十一）　目标环境：root@8.148.156.146（阿里云，396MB 内存，PG18 + nginx + campus-backend.service）
> 逐日工作记录与踩坑详见 [TIMEMAP-P0-WORKLOG.md](../pending/TIMEMAP-P0-WORKLOG.md)

---

## 一、结论速览

| 维度 | 结果 |
|---|---|
| P0 功能范围 | F01 账号资料 / F02 地图地点 / F03 地点详情 / F04 发布 / F05 互动 / F06 活动 / F07 举报与管理端 —— **全部实施** |
| 服务端全链路验证 | **76/76 PASS**（真实 PostgreSQL 16 迁移） |
| 浏览器端验证 | **57/57 PASS，4 SKIP**（SKIP 项均写明原因：需真实登录态） |
| 线上冒烟 | **40/40 PASS** |
| 类型检查 | 服务端 `tsc --noEmit` 0 错误；前端 `tsc -b` 0 错误 |
| 构建 | 服务端 5 个单文件包；前端 `vite build` 成功（679KB / gzip 211KB） |
| 部署 | 后端 + 前端均已上线并复核 |
| **回滚演练** | **`ROLLBACK: PASS`** —— 备份经真实恢复验证可用，随后升回 P0（`applied=16/16`，线上冒烟 40/40） |
| 修正的需求偏差 | 1 处真实缺陷 + 1 处"界面与需求结构不符"的整体重做 + 若干契约变更 |

### 1.1 最终线上状态（本轮结束时的实测值）

```
/api/ready      -> 200  {"status":"ready","db":"up","migrations":{"applied":16,"expected":16},"schema_state":"ready"}
/api/places     -> 12 个（P0 的 10 个 + P0 之前就存在的 2 个），含 category/enabled
/api/posts      -> 7 条历史帖子完好，且已带 P0 新字段（placeId/favoriteCount/favoritedByMe）
/api/activities -> 200（5 条近期活动，含 cancelled 展示态）
P0_PROD         -> TOTAL=40 PASS=40 FAIL=0
部署 build-id   -> 20260926-015505-7807123（前端）
```

**数据连贯性最重要的一个观察**：016 是在一个**真实的"P0 之前"数据库**上执行的
（服务端日志：`01:53:25 applied=15/15` → `01:54:54 applied=16/16`），
7 条历史帖子、既有用户与媒体记录**全部保留**，016 只做加列/加表/播种，未删任何数据。

---

## 二、修掉的"实现与需求不符"之处

P0 之前仓库里跑的是**另一个复刻产品**（校园广场信息流、群聊、留言板…），
它和 TimeMap 的差异不只是"少几个功能"，而是**信息架构不同**。以下逐条对照需求 §4.2 / §3.2：

| 项 | 改前（复刻产品） | 改后（TimeMap 需求） | 需求出处 |
|---|---|---|---|
| 首页与底部 tab | `<昵称> / 校园 / 地图`，默认落在校园广场信息流 | **地图 / 帖子 / 活动 / 我**（4 个），默认 `#/map`　⚠️ 见 §2.1「与需求草图的偏离」 | 4.1 草图 + **用户要求** |
| 地图标记 | 按**帖子**聚合（同地点多条帖 = 多个叠在一起的标记） | 按**地点**聚合，点击进**地点详情** | 4.1 / 1.1「以地点为内容组织单位」 |
| 分类筛选 | 无 | `[全部] [地标] [食堂]`，过滤在**服务端**做 | 4.1 / US-03 |
| 地点详情 | 只有地点名 + 距离 + 帖子列表 | 简介 / 校史 / 老照片（年代+来源）/ 近期活动 / 帖子（最新\|近期热门）/「在这里发布」 | 4.2 草图 |
| 发帖契约 | `{ body, place(地名文本) }` | **`{ body, placeId(必填, 必须是启用地点), mediaIds?, clientRequestId? }`** | 3.2 规则 1 / US-02① |
| 发布页形态 | 图片合成器：拍摄 / 文字 / 语音三模式 + 字体选择 | 纯文字或普通图文（≤3 图）；**语音/拍摄模式删除**（不在 TimeMap 范围） | 3.1「纯文字或普通图文发布」 |
| 互动 | 点赞、评论 | 点赞、评论、**收藏**（可撤销、不重复计数） | US-03 |
| 举报与管理端 | 无 | 举报（原因码 + 不自动下架）、管理端 5 面板、操作记录 | US-08 |
| 内容下架 | 无概念 | 软下架（`status='removed'`），**同步退出地图/地点/列表/收藏**，详情 410 | US-08③ / 4.4 |
| 活动 | 无 | 列表 + 详情 + 状态（服务端按时间推导）+ 管理端录入 | US-04 |

### 2.1 与需求草图的偏离（**有意为之，如实登记**）

**底部 tab 是 4 个**：需求文档 §4.1 的草图写的是三个 `[地图] [活动] [我的]`，
而当前实现是 **`地图 / 帖子 / 活动 / 我`**（"帖子"= 校园广场瀑布流，能看到所有帖子）。

处置方式（三条都重要）：
1. **以用户 2026-09-26 的要求为准**加回第 4 个 tab；
2. **不改需求文档**、也**不假装草图本来就是四个** —— 差异记在这里和 WORKLOG §十一；
3. 浏览器冒烟的 tab 断言跟着**当前口径**走，而不是跟着草图走。
   理由：跟着草图写的断言会永远红着；更糟的是有人为了跑绿把功能删掉。
   （这正是本仓库反复记的"门禁只保证与它写定的口径一致，不保证该口径是对的"的另一面。）

**「帖子」指向 `#/campus`（校园广场瀑布流），不是 `#/feedlist`（校园圈）**：
后者顶部是按**子页面**设计的（左上「关闭」→ 返回上一页），挂成底部 tab 后语义不对（tab 不该有"关闭"）。

**顺带删掉了 tab 栏上的发布 FAB**：地图页内部本来就有发布入口（`.map__fab`），
两个悬浮发布按钮冗余；且 4 个 tab + 绝对定位 FAB 会把 tab 挤窄，并有**压住最右侧 tab** 的隐患
（本仓库为"FAB 压住 tab"专门加过那段 padding）。发布入口收敛为两种：地图页 FAB、地点详情页「在这里发布」。

### 本轮发现并修复的**真实缺陷**（不是迁移既有功能，是补契约缺口）

**`GET /api/places/:id` 的帖子列表缺少 `favoritedByMe`**。地点详情需要显示"我收藏了没"，
但服务端只返回了 `likedByMe` 与 `favoriteCount` ⇒ 前端 `tsc` 报
`TS2339: Property 'favoritedByMe' does not exist on type 'ApiPlacePost'`。

处置：**在服务端补上**同型的 `exists(...)` 子查询，并加两条 E2E 断言（登录时 `true`、匿名恒 `false`）。
> 反面做法是把前端类型改成可选——那样 tsc 过关、运行时永远拿到 `undefined`，"修好了"是假的。

**活动页重复挂载**：`App.tsx` 里 `ActivitiesScreen` 曾按两个**等价条件**各渲染一次
（`tab === 'activities'` 与 `root === 'activities'`）⇒ 5 条活动画两遍、3 个筛选按钮两遍、多打一份 API 请求。
**接口只被调用一次且数据完全正确，所以只看接口永远发现不了** —— 它是被 DOM 计数断言抓住的。

---

## 三、改动清单

### 服务端（5 改 + 1 新增迁移 + 1 新增模块）

| 文件 | 改动 |
|---|---|
| `server/src/migrations/016_timemap_p0.sql` **新增** | P0 全部数据模型与种子：`users.role`；`places.category/enabled/description/history/sort_order`；`posts.client_request_id`(唯一) + `status/removed_*`；`comments.status/removed_*`；`favorites`；`activities`；`reports`；`audit_log`；`place_photos`。种子 = 10 个北交大地点（7 地标 + 3 食堂）+ 3 张 SVG 占位老照片（来源标注"演示素材"）+ 6 条活动（含进行中/已结束/已取消） |
| `server/src/migrations/017_admin_password.sql` **新增** | 为**管理员**恢复 `users.password_hash`（可空，学生恒 NULL）。⚠️ 是对 005「退休密码凭证」的有意反转，理由与边界写在迁移头注释里（见 §9.2） |
| `server/src/password.ts` **新增** | scrypt 哈希/校验（**零新依赖**，Node 内置）+ `fakeVerify` 防时序侧信道 |
| `server/src/timemap.ts` **新增**（1094 行） | F05 收藏（POST/DELETE + **`GET /api/me/favorites`**）、作者删除帖子/评论、F07 举报（去重、不自动下架）、F06 活动公开读（含 `window=today\|week`）、管理端 `/api/admin/*`（reports/posts/places/activities/audit-log）。全部写操作落 `audit_log` |
| `server/src/index.ts` | 会话带 `role`；`GET/POST /api/posts` 新契约（排除 removed、`placeId` 必填且必须启用、`clientRequestId` 幂等重放）；`GET /api/posts/:id` 已下架 → **410 gone**；`GET /api/places` 默认只返回启用地点 + `category` 过滤；`GET /api/places/:id` 重写（+ 简介/校史/老照片/活动/帖子排序，**并补 `favoritedByMe`**）；**新增 `POST /api/auth/admin-login`** |
| `server/src/admin-entry.ts` | **新增 `set-password`**；`list-users` 显示 `role` 与是否设过密码 |
| `server/src/db.ts` | 注册迁移 016 / 017 |

### 前端（21 改 + 7 新增）

**新增页面**：`ActivitiesScreen`、`ActivityDetailScreen`、`AdminScreen`（5 面板）、`FavoritesScreen` + 3 个 CSS
**重做/改版**：`PoiDetailScreen`（按 4.2 重做）、`PublishScreen`（新契约）、`TabBar`（**4 个 tab：地图/帖子/活动/我**，移除 tab 栏发布 FAB）、`tabbar.css`（4 等分）、`App.tsx`（`#/campus` → tab `feed` + 渲染 `CampusScreen`）、`MapScreen`（按地点聚合 + 分类筛选）
**扩展**：`FeedDetailScreen`（收藏/举报/作者删除/**已下架 410 状态页**）、`MeScreen`（我的收藏 + 管理端入口）、`LoginScreen`（**登录方式切换：短信 | 管理员密码**，017）、`login.css`、`client.ts`（P0 全部 API 与类型 + `adminLogin()`）、`session.ts`（`role` + `isAdmin()`）、`postIdentity.ts`（新增 `gone` 态）、`mapApi.ts` + 3 个地图实现（标记跳转目标改为地点）

### 工程工具（新增 8 个）

| 文件 | 用途 |
|---|---|
| `tools/rollback-server.ps1` + `tools/remote/rollback-remote.sh` | **回滚**：校验备份 → 安全快照 → 恢复库（含属主交接）→ 恢复文件 → 起服 → 验证。支持 dry-run（不加 `-Yes` 只预检） |
| `tools/setup-deploy-key.ps1` | 把 SSH 私钥复制到工作区外并收窄 ACL（Windows OpenSSH 拒绝他人可读的密钥），并**只读 ssh 验证** |
| `tools/repair-node-modules.ps1` | 清理并重装 `node_modules`（含占用预检与真实产物验证） |
| `tools/deploy-server.ps1` / `deploy-web.ps1` | 增加"优先使用加固密钥 + 迁移 checksum 预检" |
| `.gitattributes` | 新增 `*.sql text eol=lf`（防 CRLF 事故，见 §五） |
| `tools/tmp/verify-p0-e2e.mjs` | 服务端全链路 76 条断言 |
| `tools/tmp/verify-p0-browser.mjs` | 浏览器端 57 条 DOM 断言（自写 CDP 客户端，零依赖） |
| `tools/tmp/verify-p0-prod.mjs` | 线上冒烟 40 条（无需登录，含"P0 契约是否上线"的判别性断言） |
| `tools/tmp/check-migration-checksums.mjs` | 产物内联迁移字节与源文件/线上库**逐条比对**（部署前置守卫） |

---

## 四、备份与恢复

### 4.1 备份位置与内容

| 项 | 位置 |
|---|---|
| **服务器侧备份** | `/srv/campus/backups/pre-timemap-p0-20260925-0012/` |
| **本地侧副本** | `tools/tmp/backup-20260925/pre-timemap-p0-20260925-0012/`（scp 下载） |

内容（6 项，SHA256SUMS 记录全部哈希）：

| 文件 | 用途 |
|---|---|
| `campus-db.dump` (83,895 B, PG custom format, 23 个 TABLE DATA) | 数据库全量 |
| `dist-web-uploads.tar.gz` (1,029,635 B) | 归档内布局 `srv/campus/{server/dist, web, uploads}` |
| `campus-backend.service` / `campus.conf` / `default` / `campus.conf.bak.*` | systemd unit 与 nginx 配置 |

⚠️ **机密文件永不进备份、也永不被回滚覆盖**：`server.env`、`operator.env`、`.db_password`、`.login_code_hmac_key`。
⚠️ **`TimeMap.pem` 不提交、不外传**（`.gitignore` 已排除 `*.pem`）。

### 4.2 恢复方法（**已在本轮真实演练通过**）

**唯一推荐入口**（两步）：

```powershell
# 1) 先把 SSH 密钥准备好（Windows OpenSSH 要求密钥不可被他人读）
& '.\tools\setup-deploy-key.ps1'

# 2) dry-run：只校验备份与预检，不改动任何东西（退出码 10）
& '.\tools\rollback-server.ps1' -Stamp pre-timemap-p0-20260925-0012

# 3) 真实回滚
& '.\tools\rollback-server.ps1' -Stamp pre-timemap-p0-20260925-0012 -Yes
```

脚本内部顺序（**顺序本身是安全要求**）：

1. 校验 `SHA256SUMS`（6/6）+ `pg_restore --list` 可解析
2. 记录回滚前状态快照（迁移数 / posts 行数 / dist 包数）
3. **停服**（必须先于 `pg_restore`：否则 `--clean` 会 DROP 正在被连接使用的表）
4. **给当前库做安全快照** `/tmp/pre-rollback-safety-*.dump`（不可逆动作前的退路）
5. `drop schema public cascade` → `pg_restore` → **属主交接给 `campus`**（逐表/逐序列 `ALTER ... OWNER TO` + schema 权限）
6. 恢复文件（后端 dist / 前端 web 原子替换 / uploads）
7. 起服并**轮询** `/api/ready`（不用固定 sleep）
8. 验证（含"迁移表里不该再有 016""`users.role` 不该存在"）

失败时的保证：
- **停服之后的任何异常退出都会自动把服务拉回来**（EXIT trap，实测 12s 恢复）
- **600s 看门狗**（`ROLLBACK_TIMEOUT_S` 可覆盖），避免停服状态下无限等待
- `pg_restore` 非 0 ⇒ **立即停止**并用安全快照还原（绝不继续往下走）

**手工兜底**（脚本不可用时）：

```bash
# 数据库
sudo -u postgres cp /srv/campus/backups/<stamp>/campus-db.dump /tmp/rb.dump
sudo -u postgres chown postgres:postgres /tmp/rb.dump
systemctl stop campus-backend
sudo -u postgres psql -q -d campus -c 'drop schema public cascade; create schema public;'
sudo -u postgres pg_restore -d campus --clean --if-exists --no-owner /tmp/rb.dump
# 属主交接（关键：应用连的是 campus）
sudo -u postgres psql -q -d campus -c "alter schema public owner to campus"
sudo -u postgres psql -q -d campus -c "do \$\$ declare r record; begin
  for r in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I owner to campus', r.tablename); end loop;
  for r in select sequencename from pg_sequences where schemaname='public' loop
    execute format('alter sequence public.%I owner to campus', r.sequencename); end loop;
end \$\$;"
# 文件
mkdir -p /tmp/rb && tar -xzf /srv/campus/backups/<stamp>/dist-web-uploads.tar.gz -C /tmp/rb
install -o campus -g campus -m 0750 /tmp/rb/srv/campus/server/dist/*.mjs /srv/campus/server/dist/
cp -a /tmp/rb/srv/campus/web/. /srv/campus/web/ && chown -R campus:campus /srv/campus/web
find /srv/campus/web -type d -exec chmod 755 {} \; && find /srv/campus/web -type f -exec chmod 644 {} \;
cp -a /tmp/rb/srv/campus/uploads/. /srv/campus/uploads/ && chown -R campus:campus /srv/campus/uploads
systemctl start campus-backend
```

### 4.3 回滚后的验收判据（本轮实测值）

| 判据 | 回滚后（P0 之前） | 升回 P0 后 |
|---|---|---|
| `/api/ready` | 200 `applied=15,expected=15` | 200 `applied=16,expected=16` |
| `/api/activities` | **404**（P0 新接口不存在） | 200 |
| `/api/admin/reports` | **404** | 401（存在但对匿名关闭） |
| `/api/posts` 字段 | 旧形状（无 `placeId`/`favoriteCount`） | 含 `placeId`/`favoriteCount`/`favoritedByMe` |
| `/api/places` | 2 个、旧形状 | P0 的 10 个 + 历史 2 个 = 12 个、含 `category`/`enabled` |
| `schema_migrations` 含 016 | 否 | 是 |
| `users.role` 列 | 不存在 | 存在 |

### 4.4 升回 P0

```powershell
& '.\tools\deploy-server.ps1'   # 构建 → 迁移 checksum 预检 → 上传 → 重启 → /api/ready
& '.\tools\deploy-web.ps1'      # 构建 → 时间戳暂存 → 原子替换 → 权限 → 冒烟
```
**必须先后端再前端**：`POST /api/posts` 契约变了，旧前端对新后端发帖会被 400。

---

## 五、验证证据

| 验证 | 规模 | 证据文件 |
|---|---|---|
| 服务端全链路（登录→发布→互动→举报→管理端处理→下架同步退出） | **76/76 PASS** | `tools/tmp/timemap-p0/verify-p0-e2e.json` |
| **生产部署完整性**（迁移/新增路由/新契约字段/旧契约被拒/静态面） | **39/39 PASS** | `tools/tmp/verify-deploy-complete.mjs`（对线上打真实请求） |
| 浏览器端 DOM（本地） | **69/69 PASS, 4 SKIP** | `tools/tmp/timemap-p0/verify-p0-browser.json` |
| **浏览器端 DOM（对线上真实页面）** | **69/69 PASS, 4 SKIP** | 同上（`--app https://8.148.156.146`） |
| 管理员密码登录安全边界 | **15/15 PASS** | `tools/tmp/verify-admin-password.mjs` |
| 线上业务冒烟 | **40/40 PASS** | `tools/tmp/verify-p0-prod.mjs` |
| 迁移字节一致性（产物内联 vs 源文件 vs 线上库） | 16/16 + 017 一致 | `tools/tmp/check-migration-checksums.mjs` |

> ⭐ **"部署完了吗"这个问题不能靠回忆回答**。上面第 2、4 行就是为此写的：
> 前者对线上逐个打真实请求，且每条判据都能**区分新旧**（例如 `/api/activities` 旧版 404、
> `/api/auth/admin-login` 017 之前 404）；后者把浏览器**导航到线上页面**再跑同一套 DOM 断言。
> 两者都全绿，才敢说"线上就是这一版"。

**验证方法的判别力**（不是"跑绿就算过"）：
- 线上冒烟在**部署前**对同一生产环境跑出 **24 项 FAIL**（activities 404、admin 404、迁移 15/15、旧地点形状），部署后转绿 ⇒ 证明它真能区分新旧，而非恒真。
- 浏览器冒烟的"反重复挂载"断言是新加的：它抓到了一个**接口测试永远看不见**的真实缺陷（见 §六）。
- 浏览器冒烟的期望值**从 API 实时取**（`--api` 参数），不写死数量。
  起因是一次真实假红：脚本原按**本地种子库**写死数量，而那次 dev server 指向**线上后端**
  （12 个启用地点、活动随时间衰减）⇒ 同一界面"红"了 5 条，全是断言与数据环境不匹配。
  改成 API 派生后它在任何数据环境下都成立，且仍能抓住"界面与接口不一致"这类真实缺陷；
  同时避免了最坏的结局——**有人为了跑绿把数字改成"能过"的样子**。
- 每一条被我改过的断言都换成了**更有判别力**的表述，而不是放宽到"什么都能过"（逐条记录在 WORKLOG §四/§九/§十一）。

---

## 六、过程中发现并修复的真实缺陷（含我自己的错误）

### 6.1 产品缺陷

| 缺陷 | 发现方式 | 修法 |
|---|---|---|
| `GET /api/places/:id` 缺 `favoritedByMe` | `tsc` 报 TS2339 | 服务端补同型子查询 + 2 条断言 |
| **活动页重复挂载**：`App.tsx` 里 `ActivitiesScreen` 被渲染两次（`tab === 'activities'` 与 `root === 'activities'` **条件等价**）⇒ 5 条活动画两遍、3 个筛选按钮两遍、多打一份 API 请求 | 浏览器冒烟的 DOM 计数 | 删掉重复渲染；并加**通用**断言"每个 tab/路由的独有容器只出现一次"（5/5 单实例） |
| 已下架的帖子详情落进"网络错误"分支（410 被当网络故障） | 需求 4.4 对照 | `postIdentity` 新增 `gone` 态 + 专用状态页 |

⚠️ **活动页重复挂载的关键教训**：接口只被调用一次、返回数据完全正确，**只看接口永远发现不了**——
错误只在 DOM 结构里。这是"接口全绿 ≠ 界面对"的实例。

### 6.2 我自己的错误（如实登记，均已修）

| 错误 | 后果 | 修正 |
|---|---|---|
| 改 `.ps1` 时丢了 UTF-8 BOM | 该仓库已记过两次的坑；`PS1_BOM_CHECK: FAIL` | 用仓库自带 `tools/fix-ps1-bom.ps1` 补回 |
| 跑 `pnpm install` 破坏 `node_modules` 符号链接布局 | vite 找不到原生绑定，前端构建失败（**这是本轮唯一需要用户帮忙修的环境损坏**） | 新增 `repair-node-modules.ps1`；根因是沙箱不允许建符号链接 |
| 迁移 `.sql` 在工作区是 CRLF（`core.autocrlf=true`） | 产物 checksum 与线上库不符 ⇒ **线上 fail-closed 503** | 归一化 16 个迁移为 LF + `.gitattributes` 钉死 `*.sql eol=lf` + 部署前 checksum 预检 |
| 016 种子只写 `ON CONFLICT (id)` | 线上存在"同手机号不同 UUID"账号 ⇒ 迁移失败 | 改为**按手机号认领**（保留原 UUID） |
| 016 活动种子硬编码 `created_by='bbbbbbbb-…'` | 该 UUID 不存在 ⇒ 外键失败 | 改为按手机号子查询真实 id |
| 回滚脚本 7 个缺陷 | 见 §四与 WORKLOG §十；其中一个是**数据丢失**（失败被放行） | 逐个修复 + 加安全快照 + 失败即停 |
| 多处断言写错（假红） | 例如"地点数==10"（线上有历史地点）、"tab 文案==我的"（实际是账号昵称） | 换成语义正确的判据，逐条记录 |

**关于 CRLF 那次事故的完整因果**（值得单独记）：`db.ts` 的 `migrationChecksum` 是**朴素 sha256、不做换行归一化**，
而迁移 checksum 被持久化用于"检测迁移文件被改动"。`core.autocrlf=true` 让工作区 `.sql` 变 CRLF
⇒ esbuild 把 CRLF 字节打进单文件包 ⇒ 线上启动时 checksum 不匹配 ⇒ **故意 fail-closed**（所有 `/api/*` 503）。
实测三个数：CRLF 版 `001_init` = `b57e367e7fdd`（产物）、LF 版 = `5e5b9bb7b7a2`（线上库）。
最误导的地方：**只有 001 报错**（002–015 的库内 checksum 恰好是 CRLF 时期回填的），
容易被读成"只修这一条"——正确做法是把**所有**迁移固定成同一种换行。

---

## 七、已知限制与未完成项（如实登记，不夸大）

### 7.1 本轮未完成
1. **旧复刻页未清理**：`campus / chat / board / daily / schools / feedlist` 等页面与其路由**仍然保留**
   （不占底部 tab、不是默认首页），本轮按"最小改动"原则未删除。删不删需要单独的证据与裁定。
2. **旧门禁未回归**：`scripts/m5/**` 的 31+ 个门禁断言的是**复刻产品**的 M5 契约；
   P0 改掉了部分契约（底部 tab、默认路由、发帖契约、地点详情结构）⇒ 它们**必然假红**，
   本轮**未跑**（跑也得不到信息）。P0 的验收由 §五 的三套新脚本覆盖。
3. **设备端/APK 流程未回归**（本轮范围外）。

---

## 八、部署与运维速查

```powershell
# —— 一次性准备 ——
& '.\tools\setup-deploy-key.ps1'      # 加固并验证部署密钥
& '.\tools\repair-node-modules.ps1'   # 依赖损坏时修复（含真实产物验证）

# —— 日常部署（必须先后端再前端）——
& '.\tools\deploy-server.ps1'         # 含迁移 checksum 预检，不过则中止且不动服务器
& '.\tools\deploy-web.ps1'            # 原子替换 + 权限 755/644 + 含 /assets 真实 JS 冒烟

# —— 回滚 ——
& '.\tools\rollback-server.ps1' -Stamp <stamp>        # dry-run
& '.\tools\rollback-server.ps1' -Stamp <stamp> -Yes   # 真实回滚

# —— 管理端密码（017；只对已存在的 admin 账号生效）——
# 在服务器上执行（不要在学生账号上跑；也不要在 CLI 里顺手提权）
sudo -u campus env $(cat /srv/campus/server.env | xargs) \
  node /srv/campus/server/dist/admin.mjs list-users          # 先看谁是 ADMIN
sudo -u campus env $(cat /srv/campus/server.env | xargs) \
  node /srv/campus/server/dist/admin.mjs set-password '+8613800000001'   # 省略密码则自动生成

# —— 验证 ——
node tools\tmp\verify-p0-prod.mjs                     # 线上冒烟（无需登录）
node tools\tmp\verify-p0-e2e.mjs                      # 本地全链路（需本地后端 + dev sink）
node tools\tmp\verify-p0-browser.mjs --cdp 9222 --app <app-url> --api <api-url>
node tools\tmp\verify-admin-password.mjs --base <api-url> --password '<pw>'
node tools\tmp\check-migration-checksums.mjs          # 迁移字节一致性
```

**服务器布局**：后端单文件 `/srv/campus/server/dist/*.mjs`（5 个，零 `node_modules`）；
前端静态 `/srv/campus/web/`；上传媒体 `/srv/campus/uploads/`；
机密 `/srv/campus/server.env`、`operator.env`（**不下载**）；备份 `/srv/campus/backups/`。

**服务端启停**：`systemctl {status,restart,stop,start} campus-backend.service`；
就绪判据 `curl -s localhost:3001/api/ready`（应含 `"applied":16`）。

---

## 九、管理端登录与短信通道（2026-09-26 补充）

### 9.1 管理端入口
- 入口在 **「我的」页**，仅 `role='admin'` 可见（服务端对每个 `/api/admin/*` 独立校验，非 admin 一律 403）。
- **两条登录路径**（017 起）：
  1. **手机号 + 短信验证码**（与学生相同，管理员也能用）
  2. **手机号 + 密码**（仅管理员；见 8.2）
- 种子管理员账号：`+8613800000001`。⚠️ 若该号在 P0 之前已被占用，016 迁移会「认领」**那个账号**
  并把**它**提升为 admin（保留原 UUID）—— 所以"哪个号是管理员"应当用命令查，而不是假定：
  ```bash
  node /srv/campus/server/dist/admin.mjs list-users   # 看 ADMIN 标记
  ```

### 9.2 管理员密码（迁移 017）
```bash
# 在服务器上设置（只对已存在且 role=admin 的账号生效；不会建账号、也不会顺手提权）
sudo -u campus env $(cat /srv/campus/server.env | xargs) \
  node /srv/campus/server/dist/admin.mjs set-password '+8613800000001'
# 省略密码 ⇒ 自动生成强随机密码并**只打印一次**
```
然后在 App 登录页切到「管理员密码」登录。

**安全边界**：只认 admin；三种失败（号不存在 / 非管理员 / 密码错）响应**完全一致**；
失败路径跑等价 scrypt 防时序侧信道；独立限流。**没有默认密码、没有免验证入口。**

> ⚠️ 未做：set-password **没有写 audit_log**（`actor_id` 为 NOT NULL 外键，而它是运维身份执行的）。
> 详见 §7 已知限制。

### 9.3 短信通道故障（**待修**）
实测线上 `POST /api/auth/request-code` 返回：
```
503 {"error":"sms_delivery_failed","reason":"UNKNOWN","message":"UNKNOWN","delivery":"sms"}
```
- 服务端**连验证码都没发出**；且它**刻意不回退 dev sink**（退回会把"渠道坏了"表现成"用户收到了码"，是假成功）。
- 等过频率窗口后仍 `UNKNOWN` ⇒ **不是临时限流**（`biz.FREQUENCY` 那次是测试自身触发的噪音）。
- `reason` 来自阿里云响应的 `Code` 字段（`server/src/sms.ts:196` 透传）。
- 诊断（只读）：
  ```bash
  grep -cE '^ALIYUN_SMS_[A-Z_]+=$' /srv/campus/operator.env   # 4=四项全空（关短信没恢复干净）
  grep -E '^ALIYUN_SMS' /srv/campus/operator.env | sed 's/=.*/=***/'
  journalctl -u campus-backend.service --no-pager -n 300 | grep '\[sms\]' | tail -3
  ls -l /srv/campus/operator.env.bak.prewebtest                # 有残留=上次关短信没恢复
  ```
- 最可能成因（按可能性）：**阿里云短信赠送额度用尽/欠费**、**赠送签名或模板过期未续**、AK 被禁用。
- 配置在 `/srv/campus/operator.env`（部署脚本**从不**读写它，所以不会被部署覆盖）；
  恢复工具：`tools/remote/restore-sms.sh`。

### 9.4 顺带修掉的一个前端缺陷
`LoginScreen` 原先把 `503` 一律显示成「**手机号格式不正确或服务暂不可用**」——
真实原因是短信通道故障，而这个文案会让你反复检查手机号。
已改为按 `status` + 服务端 `error` 区分，并对 5xx 明确说明"**是服务端/短信通道的问题，不是手机号的问题**"。

---

## 十、给后续维护者的三条要点

1. **迁移文件一旦应用就不能改**（有 checksum 校验），且**换行也算改动**。
   新增迁移时确认 `.sql` 是 LF；`tools/deploy-server.ps1` 会在上传前机械校验并拦截。
2. **"恢复失败"不是 warning**。任何不可逆动作（尤其 `drop schema`）之前必须先留快照，
   失败必须立即停止并回退 —— 本轮就是因为放行了一次失败而丢过真实数据。
3. **接口全绿不等于界面对**。活动页重复挂载只体现在 DOM 数量上；能发现它的只有 DOM 级断言。
   新增页面时请同时加"该页独有容器只出现一次"的断言。

---

## 十一、2026-10-09 增量交付

本节只记录**这一天的增量**；前面各节仍是当时的真实记录，未回改。

### 11.1 打包 APK 1.2（完成后实测）
| 项 | 值 |
|---|---|
| 产物 | `app/android/app/build/outputs/apk/debug/app-debug.apk` |
| 大小 / SHA256 | 8,975,990 字节 / `DE40167A6C4C2CA214AA516E37F6A5B291F08B5B3D66C818B7CD7EF7AA0A4BDF` |
| 包内版本（`aapt2 dump badging` 读出） | `versionName=1.2`、`versionCode=3`、`com.campusx.demo`、minSdk 24、targetSdk 36 |
| 内置 web 包 | `assets/public/assets/index-CtSTxiOQ.js`，与 `app/dist/assets/index-CtSTxiOQ.js` **同 sha256** |
| 一条命令重建 | `powershell -File tools/build-apk.ps1` |

**这一天的五个真实失败**（每个症状都指向错误方向）详见工作记录 §十五，摘要：
1. Gradle 原生文件监视器在本机起不来 → `org.gradle.vfs.watch=false`；
2. AGP 8.13 默认要 `build-tools;35.0.0`（不是 36）+ 许可未接受 → 补装并写入许可文件；
3. JDK 17 编不了 Capacitor 8 的 Java 21 源码 → 用 JDK 21（本机已有）；
4. ⭐ `resource drawable/splash not found` = **仓库缺陷**：res 下的 splash/图标 PNG 被根 `.gitignore`
   的 `*.png` 一起忽略，**从来没进过版本库**，任何人 clone 都构建不出 APK；
5. ⭐ kotlinc `cannot access 'String'/'Manifest'` = **路径含非 ASCII 字符**：
   Gradle 用 `\uXXXX` 转义写编译 argfile，javac 认识、**Kotlin 编译器不认识**，
   于是它去找一个名叫 `u6D4B…`（即「测试实训」）的目录，找不到 `android.jar`。
   → `tools/build-apk.ps1` 用 junction 造全 ASCII 视图（工程 + Gradle 缓存 + SDK）后构建成功。

### 11.2 修复的仓库缺陷（可重建性）
- `.gitignore` 增加例外 `!app/android/app/src/main/res/**/*.png`（并写明原因）。
- 从**线上已发布的 1.1 安装包**中取回真实资源（不是新建占位图）：
  11 个 `splash.png`（1 + 10 个 port/land 密度）+ 15 个 `ic_launcher*`（5 密度 × 3 文件）。
- 工具：`tools/tmp/apk-entries.mjs`（手写 ZIP 读取，零依赖零子进程，可列/导出 APK 条目）。

### 11.3 管理员密码登录（迁移 017）与一键设置脚本
- 服务端：`POST /api/auth/admin-login`（只认 admin；三种失败响应完全一致；
  失败路径跑等价 scrypt 防时序；独立限流）；`users.password_hash`（学生恒 NULL）。
- 一键脚本 `tools/set-admin-password.ps1`：本机 CSPRNG 生成密码（或 `-Password` 传入）
  → 远端 `admin.mjs set-password`（**只对已存在且 role=admin 的账号生效**）
  → **用该密码真的走一次登录**并带 token 请求 `GET /api/admin/reports`；失败即 FAIL。
- ⚠️ 线上账号 `+8613800000001`（`anmoss`，admin）**目前还没有密码**，需执行上面这条脚本。

### 11.4 发布 1.2 的正确顺序（⚠️ 顺序反了会产生"假发布"）
```powershell
powershell -File tools/build-apk.ps1                 # 1) 构建（含版本/内置包一致性校验）
powershell -File tools/release-apk.ps1               # 2) 传包 + 公网回读校验 sha256（不改数据库）
powershell -File tools/release-apk.ps1 -DeployBackend # 3) 部署后端 ⇒ 迁移 018 把清单改成 1.2
node tools\tmp\verify-deploy-complete.mjs            # 4) 核对线上广告版本 == 仓库版本，且下的就是本地这个包
```
- 迁移 `018_release_1_2.sql` 幂等；文件头写明"先传包校验、再改清单"。
- ⚠️ 线上现在广告的是 **1.1**（`GET /api/app/release` 实测），**018 尚未部署**；
  在 1.2 的包上传并校验通过前不要先跑 018。

### 11.5 当前线上状态（2026-10-09 实测，**发布已完成**）
| 项 | 值 |
|---|---|
| 后端 | `applied=18/18`（016 P0 + 017 管理员密码 + 018 发布 1.2），就绪 4 秒 |
| 前端 | `build-id 20261009-171228-bf8ac4a`；线上 `index-CtSTxiOQ.js` 与本地 `app/dist` **逐字节相同**（`WEB_DEPLOYED: all passed`） |
| 发布清单 | `GET /api/app/release` → `latestVersion=1.2`，指向 `http://8.148.156.146/download/campus-demo-1.2.apk` |
| 托管安装包 | 200 / `application/vnd.android.package-archive` / 8,975,990 字节，sha256 与本地构建产物一致 |
| 管理员 | `+8613800000001`（anmoss）已设密码，`POST /api/auth/admin-login` → 200 → `/api/auth/me` role=admin → `/api/admin/reports` 200 |
| 管理端只读核验 | `reports/posts/places/activities/audit-log` 全 200；匿名 401；错密码 401（统一文案） |
| 冒烟 | `DEPLOY_COMPLETE: 47/47 PASS`、`P0_PROD: 43/43 PASS` |
| 发布前快照 | `/srv/campus/backups/pre-release-20261009-170809/`（DB dump + 旧 dist + 校验和） |

⚠️ 管理员密码由用户选定为 `0123456789`（10 位 = 服务端 `PASSWORD_MIN`）。脚本会打印弱密码警告；
改法：`tools\set-admin-password.ps1 -Password '<更长>'`。

### 11.6 上线前的两道机械门禁（都跑过，都 PASS）
1. `MIGRATION_CHECKSUMS: PASS` —— 18 个迁移源文件全 LF、打包产物字节 == 源文件字节，
   并与线上 `schema_migrations.checksum` **逐条一致**（`--server-checksums`），fail-closed 门禁不会触发。
2. 顺序门禁 —— APK 先上传并从**公网回读**比对 sha256，再部署后端让 018 生效；
   `verify-deploy-complete.mjs` 第 11 节同时核对"线上广告版本 == 仓库版本"与"下的就是本地这个包"。
发布前快照：`/srv/campus/backups/pre-release-20261009-170809/`（DB dump + 旧 dist + 校验和 + `app_release` 行）。

### 11.7 仍然**没有**验证的部分（如实登记，不夸大）
- **浏览器登录态冒烟（4 项 SKIP）** 仍未覆盖：它需要真实登录态的 DOM 断言。本沙箱**无法启动浏览器**
  （`Start-Process chrome` 后进程立即 `hasExited=True`，CDP 端口起不来 —— 2026-10-09 又实测了一次），
  所以这一项必须由用户在自己的终端启动带 `--remote-debugging-port=9222` 的 Chrome 才能跑。
- 管理端的学生视角/管理端**界面**（而非接口）未在线上做过 DOM 断言；本次只做了接口级核验（全 200）。
- `0123456789` 是弱密码（用户选定）。限流 + 统一 401 只能缓解在线爆破，不能替代强密码。

### 11.8 本节新增/修改的文件
新增：`tools/build-apk.ps1`、`tools/release-apk.ps1`、`tools/set-admin-password.ps1`、
`tools/remote/pre-release-backup.sh`、
`tools/tmp/fetch-android-sdk.mjs`、`tools/tmp/apk-entries.mjs`、`tools/tmp/verify-web-deployed.mjs`（`tools/tmp/` 按仓库约定不入库）、
`server/src/migrations/018_release_1_2.sql`、`server/src/migrations/017_admin_password.sql`、
`server/src/password.ts`、`app/android/app/src/main/res/**`（splash 与 launcher 图标，26 个文件）。
修改：`.gitignore`、`tools/build-android.ps1`、`tools/install-android-sdk.ps1`、`tools/release-android.ps1`（加指针说明）、
`tools/setup-deploy-key.ps1`（补记"干净 ACL 的密钥副本可用"这条已验证的路径）、
`tools/tmp/verify-p0-prod.mjs`、`tools/tmp/verify-deploy-complete.mjs`、`server/src/db.ts`、`server/src/index.ts`、
`app/android/gradle.properties`、`app/android/app/build.gradle`、`app/src/version.ts` 及若干前端界面文件。

