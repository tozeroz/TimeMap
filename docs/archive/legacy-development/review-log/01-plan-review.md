# 远程审核记录 01：项目计划与里程碑

> 审核方：ChatGPT（网页版，用户已登录）
> 时间：2026-09-21 02:37
> 会话：https://chatgpt.com/c/6ab02784-a270-83e8-bb35-37ac6c47d4c5

---

分享
你说：
你是本项目的远程独立审核人（架构评审 + 代码评审）。请对下面每一步方案给出简洁、可执行的评审意见，不要泛泛而谈。

【项目目标】把已有的 campus demo 改造成拥有独立前后端的完整项目并部署上线；最终要求严格 1:1 复现原版安卓 app \\`com.kairuotu.campus\\`。

【现状】
\\- 前端：React 19 + TS + Vite + Capacitor 共 26 个页面组件，已复刻 22 个有界面的页面；数据全部是本地 mock（localStorage），无后端。
\\- 服务器：阿里云 Ubuntu 26.04，2 vCPU，可用内存仅 396MB（另有 2GB swap），磁盘 20GB；只开放 22 端口；没有域名（先按 IP + HTTP 访问）；尚未安装 Postgres / Node。
\\- 数据库：确定用 PostgreSQL。
\\- 模拟器：MuMu（1080x1920）里装了原版 app，可随时截图对照。

【硬约束】
\\- 内存极小 → 不使用 Docker；Postgres 必须调参；服务器上不跑前端构建。
\\- 无域名 → 先 HTTP，安卓端需处理明文流量限制。
\\- 开发流程：小步快跑，每步「计划 → 执行 → 测试 → 交你审核」。

【我的里程碑划分】
M0 准备：仓库整顿（干净分支）+ 服务器 provision（Node、Postgres 调参、systemd 骨架、Nginx 反代）
M1 后端骨架：Fastify + Postgres 连接池 + 健康检查 + 迁移工具 + systemd + Nginx
M2 数据建模：把 mock 实体（用户/帖子/图片/评论/点赞/地点/消息/群组/公告）落成表结构 + 种子数据
M3 接口实现：按页面逐个把 mock 数据替换为真实 API，前端组件结构尽量不变
M4 真实能力后端化：发帖/评论/私信真实入库；图片上传与存储
M5 1:1 复现核对：逐页对照原版截图，补齐差异
M6 上线：HTTPS、备份、监控

【请审核 3 个具体问题】
1\\. 这个里程碑划分有明显缺陷或遗漏吗？你会怎么调整顺序或补充什么？
2\\. 在只有 396MB 可用内存的机器上，Postgres 的关键参数你建议怎么设（shared_buffers / work_mem / max_connections / effective_cache_size 等）？
3\\. 图片存储：20GB 磁盘、
无对象存储、无 CDN 的前提下，你会怎么设计与落地？
…
显示更多
思考了 11s
ChatGPT 说：

整体方向是对的，但我会要求你在正式进入 M1 前修改里程碑定义。最大的问题不是技术选型，而是目前把“后端化”和“1:1 复现验证”基本串行化了：这样很容易到 M5 才发现，前面 M2/M3 对数据语义、页面状态、交互行为的理解已经偏离原版，导致大规模返工。

1. 里程碑审核

我的建议是把现有 M0–M6 调整为下面这个结构：

阶段	评审意见	Gate
M0 基线冻结 + 环境准备	仓库整理、原版页面/路由/状态清单、关键页面截图基线；服务器 Node/Postgres/Nginx/systemd；开放 80；Postgres 仅 localhost	能明确回答“原版有哪些页面、状态和关键行为”，服务器基础服务稳定
M1 后端最小闭环	Fastify + PG pool + migration + health/readiness + systemd + Nginx；只做一个极小真实 API	Android/Web → Nginx → Fastify → PG 全链路跑通
M2 数据模型 V0.1	用户/帖子/图片/评论/点赞/地点/消息/群组/公告建模；但不要一次追求终态	migrations 可从空库重建；seed 可重复执行；关键关系有约束
M3 垂直切片迁移	不要“先实现全部接口，再改前端”；按完整用户路径迁移，例如帖子列表→详情→评论→点赞	每完成一个 slice，真实 API + UI + 原版行为同时验证
M4 写能力 + 媒体	发帖/评论/点赞/私信/上传；补认证、输入验证、上传安全、事务/幂等	核心写路径真正持久化，重启不丢数据
M5 全量 1:1 收敛	此时主要处理剩余视觉/行为差异，而不是第一次开始对照原版	页面矩阵全部销项
M6 Production hardening	HTTPS、备份/恢复演练、日志轮转、磁盘告警、服务恢复、安全加固	可恢复而不只是“能访问”
我认为必须补的 5 个项目

第一，M0 加“原版行为基线冻结”。

你现在有 MuMu + 原版，这是非常宝贵的真实 oracle。不要等到 M5 才用。

至少建立：

纯文本
route/page
entry condition
reference screenshot
loading state
empty state
normal state
error state
interaction
navigation result
persistent state
known unknowns

22 个已复刻页面至少都应该有 baseline。

这样 M3 每迁一个页面，都可以直接判：

API 化是否破坏了原来的 UI/行为？

而不是最终一起验。

第二，M1 必须要求真正的 end-to-end vertical slice。

不要把 M1 定义成：

Fastify 能启动 + /health 返回 200。

这证明不了架构。

建议 M1 最低闭环：

纯文本
React/Android
     ↓
HTTP :80
     ↓
Nginx
     ↓
Fastify
     ↓
PostgreSQL
     ↓
GET /api/test

再让前端真实调用一次。

这里也顺便验证：

Capacitor API base URL
Android cleartext
CORS
Nginx /api
systemd
PostgreSQL 权限
reboot 后自启动

Android 可以通过 Network Security Configuration 控制 cleartext；官方支持通过 cleartextTrafficPermitted 声明控制。临时 HTTP 可以接受，但应明确把它定义成部署过渡状态，而不是最终配置。
Android Developers

第三，M3 应从“按页面替换”改成“按垂直业务切片替换”。

比如：

纯文本
Slice 1
帖子列表
→ 帖子详情
→ 评论列表

Slice 2
点赞
→ 点赞状态
→ 点赞计数

Slice 3
发帖
→ 图片上传
→ 帖子列表刷新

因为一个页面往往横跨多个实体；而一个实体也会出现在多个页面。

单纯“Page A API 化 → Page B API 化”最后很容易形成：

纯文本
/posts/list2
/posts/detailData
/userPagePosts

这种为 mock/UI 形状服务的 API。

前端组件尽量不变可以，后端领域模型不要迁就 mock。

第四，认证/授权现在是明显缺项。

哪怕 campus demo 初期只做单用户，也应该在 M2 前明确：

纯文本
身份从哪里来？
user_id 是否由客户端提交？
私信读取权限是什么？
图片删除权限是什么？
帖子删除权限是什么？
群组成员权限是什么？

可以暂时使用非常简单的开发认证，但数据库/API 从一开始就不能相信：

JSON
{
  "userId": 123
}

代表“我就是 123”。

否则 M4 做私信时会被迫返工。

第五，备份不要全部推迟到 M6。

M6 可以做正式 production backup，但 M2 后就应该至少拥有：

Bash
pg_dump
restore test

否则真实数据开始进入系统后，没有 recovery path。

2. 396MB 内存下 PostgreSQL 参数

这里我会明显比普通 VPS 教程保守。

PostgreSQL 官方明确指出：低于 1GB RAM 的机器，shared_buffers 应使用比常见 25% 更小的比例；同时 work_mem 是每个 sort/hash operation的额度，一条复杂查询可以使用多个，多个 session 又会叠加，因此不能按“总内存 ÷ connection”简单计算。
PostgreSQL

建议起始值

我会先这样部署：

conf
# Connections
max_connections = 15

# Memory
shared_buffers = 64MB
effective_cache_size = 192MB

work_mem = 1MB
maintenance_work_mem = 16MB
autovacuum_work_mem = 16MB

# Parallelism
max_parallel_workers_per_gather = 0
max_parallel_workers = 0
max_parallel_maintenance_workers = 0

# Conservative background activity
autovacuum_max_workers = 2

这不是“性能最佳参数”，而是：

优先不 OOM 的 bootstrap 参数。

shared_buffers = 64MB

我不建议上：

conf
128MB

虽然 PostgreSQL 默认通常就是 128MB，但你整台机器还要同时承载：

Linux
sshd
systemd
Nginx
Node/Fastify
PostgreSQL
kernel page cache

PostgreSQL 官方甚至明确说 <1GB 应降低 shared_buffers 所占比例。
PostgreSQL

所以这里：

64MB PASS。

后续监控证明机器仍有大量余量，再考虑 80/96MB。

work_mem = 1MB

这里尤其不能给 8MB/16MB。

官方说明 work_mem 并不是：

每连接最多使用一次。

而是一次查询中的多个 sort/hash 节点都可能分别使用，并且多个连接并发继续叠加；hash 操作还受到 hash_mem_multiplier 的额外放大。
PostgreSQL

你的业务是普通 campus CRUD，不值得拿稳定性换少量排序性能。

所以：

conf
work_mem = 1MB

非常合理。

真遇到特殊报表，可以单 session：

SQL
SET work_mem = '8MB';

而不是全局抬高。

effective_cache_size = 192MB

注意它不是分配 192MB RAM。

这是 planner 的估计值，用于告诉 PostgreSQL：

大概有多少 PostgreSQL buffer + OS filesystem cache 可以利用。

官方明确说明它不会实际分配 shared memory，也不会保留 kernel cache。
PostgreSQL

所以初始：

conf
effective_cache_size = 192MB

可以。

等上线后根据真实：

Bash
free -h

以及系统长期 available/cache 再调。

max_connections = 15

这个非常重要。

PostgreSQL 官方说明，提高 max_connections 会增加相关资源分配；在低内存环境下，减少数据库连接数是降低内存风险的重要手段。
PostgreSQL
+1

我建议：

纯文本
PostgreSQL max_connections = 15
Fastify pool.max = 5

甚至：

纯文本
pool.min = 0
pool.max = 5

即可。

对于这个规模的应用，5 个数据库连接远远比 100 个合理。

暂时没必要引入 PgBouncer。

你当前目标是减少组件，而不是为了理论上的连接能力再增加一个 daemon。

Parallel query 全关
conf
max_parallel_workers_per_gather = 0
max_parallel_workers = 0
max_parallel_maintenance_workers = 0

PostgreSQL 官方特别提醒，parallel worker 是独立进程，并且像 work_mem 这样的限制会对 worker 单独应用，因而可能明显放大 RAM/CPU 消耗。
PostgreSQL

你的数据规模短期根本不需要 parallel query。

所以这里：

用延迟换确定性。

我支持。

另外我会加两个 OS/服务层 Gate

不要只调 PG。

部署之后做：

Bash
systemctl status postgresql
systemctl status campus-api
systemctl status nginx

free -h
ps aux --sort=-rss | head

然后分别测试：

纯文本
idle
5 concurrent API requests
20 concurrent API requests
image upload
database migration
VACUUM/autovacuum

记录：

纯文本
RAM available
swap used
Node RSS
Postgres RSS/process count
load average

2GB swap 是救命缓冲，不是正常工作内存。

正常轻载时如果已经持续 swap in/out，我会直接判 HOLD。

3. 图片存储设计

在你这个约束下：

直接使用本地磁盘是正确方案。

我不建议现在为了“架构先进”强上 MinIO。

20GB 总盘 + 396MB RAM，本机再跑一个对象存储服务，收益远低于复杂度和资源成本。

但必须把“本地存文件”设计成以后可以平滑换对象存储，而不是在代码里到处：

fs.writeFile('/xxx/uploads/foo.jpg')
推荐结构
文件系统

例如：

/srv/campus/
├── app/
├── uploads/
│   ├── original/
│   │   └── 2026/
│   │       └── 09/
│   └── derived/
│       └── 2026/
│           └── 09/
└── backups/

不要把图片放：

Git repo
Node source directory
PostgreSQL bytea

尤其不要存数据库 bytea。

PG 只存 metadata。

数据表

例如：

media
-----
id
owner_user_id
storage_key
original_name
mime_type
size_bytes
width
height
sha256
created_at
deleted_at

帖子图片关联：

post_media
----------
post_id
media_id
position

数据库里存：

2026/09/uuid.webp

而不是：

http://1.2.3.4/uploads/2026/09/uuid.webp

也不要存：

/srv/campus/uploads/...

也就是存：

logical storage key

而不是 deployment-specific URL/path。

这样以后迁 OSS：

local:
2026/09/abc.webp

OSS:
campus-prod/2026/09/abc.webp

DB 可以完全不变。

文件名必须 server-generated

不要：

IMG_20260921.jpg
头像.jpg
../../../xxx

直接：

UUID/ULID

例如：

01K5...A.webp

原始文件名只作为 metadata。

上传流程

建议：

POST /api/media
        ↓
Fastify multipart
        ↓
校验尺寸/类型
        ↓
生成 storage key
        ↓
写临时文件
        ↓
验证/处理图片
        ↓
atomic rename 到 uploads
        ↓
INSERT media
        ↓
return media_id + URL

不要：

先 INSERT DB
→ 再写文件

否则磁盘失败会得到大量悬挂记录。

比较简单可靠的是：

write tmp
→ validate
→ move final
→ insert DB

如果最后 DB INSERT 失败：

unlink final
Nginx 直接提供图片

不要让 Node：

GET /uploads/foo.jpg
→ fs.readFile()
→ Fastify send()

Nginx 更适合静态文件。

例如逻辑上：

location /media/ {
    alias /srv/campus/uploads/;
}

这样链路：

Android
  ↓
Nginx
  ├── /api/   → Fastify
  └── /media/ → filesystem

非常符合你的服务器。

必须做上传限制

V1 至少：

允许：
image/jpeg
image/png
image/webp

拒绝：
SVG
任意 binary
超大图片

再限制：

单图 ≤ 5MB
单帖子 ≤ 9 张

具体数值以后根据原版行为调整。

不要只相信 Content-Type 和扩展名。

至少解析实际图片。

强烈建议上传时压缩

20GB 看起来很多，但实际可用于图片的空间没有 20GB：

20GB
- Ubuntu
- packages
- PostgreSQL
- WAL
- logs
- application
- backups
--------------------------------
剩余才是 media

如果用户手机上传照片平均 4MB：

1000 张 = 4GB
3000 张 = 12GB

很快就没了。

所以我建议 V1 就实施：

original upload
      ↓
decode
      ↓
限制长边，例如 1920/2560
      ↓
WebP/JPEG 压缩
      ↓
只保留处理后的 production image

除非原版业务确实需要“下载原图”。

否则不要长期保留手机 8–15MB 原始照片。

缩略图不要一开始做很多规格

V1 我只会考虑：

display image
thumbnail

甚至数据量极小时，先只有：

display image

都可以。

不要预生成：

64
128
256
512
720
1080
1920
original

20GB 环境下会白白放大存储。

磁盘容量必须成为运行时 Gate

至少监控：

df -h /
du -sh /srv/campus/uploads
du -sh /var/lib/postgresql

我建议：

disk > 70%    WARN
disk > 80%    ALERT
disk > 90%    禁止新图片上传

90% 时宁愿：

507 Insufficient Storage

也不要把根分区塞满。

因为根分区写满后：

PostgreSQL WAL
journald
apt
Node
Nginx

都会一起出问题。

图片备份需要与数据库备份对应

这是本地文件方案最容易忽略的一点。

你以后不能只做：

pg_dump

因为 DB dump 只保存：

media_id → storage_key

实际图片还在 filesystem。

备份应该是：

DB backup
+
uploads backup

并且最好属于同一 backup generation：

backup-2026-09-21/
├── database.sql.gz
├── uploads.tar.zst
└── manifest.json

长期来说，这也是我认为你最终迁移阿里云 OSS 的最充分理由之一；但现在不用提前做。

最终审核结论
1. Milestone

CONDITIONAL PASS

总体分层合理，但进入执行前我要求修改三处：

M0：增加 original-app baseline
M1：增加完整 E2E vertical slice
M3：page-by-page → vertical-slice-by-vertical-slice

并把：

auth/authz
backup/restore
observability

明确放进里程碑，而不是隐含处理。

最重要的一条是：

1:1 verification 必须贯穿 M0–M5，M5 是最终收敛阶段，不应是第一次验证。

2. PostgreSQL

PASS，建议 bootstrap 配置：

max_connections = 15

shared_buffers = 64MB
effective_cache_size = 192MB
work_mem = 1MB
maintenance_work_mem = 16MB
autovacuum_work_mem = 16MB

max_parallel_workers_per_gather = 0
max_parallel_workers = 0
max_parallel_maintenance_workers = 0

autovacuum_max_workers = 2

Fastify：

pool.max = 5

然后以实际 RSS / swap / load 数据决定是否调高，而不是预先“优化”。

3. 图片

PASS：local filesystem + metadata in PostgreSQL + Nginx static serving。

冻结几个原则即可：

DB 只存 logical storage key
server-generated filename
上传尺寸/类型限制
上传时压缩
Nginx 直接 serve
磁盘容量 guard
DB + uploads 联合备份
Storage abstraction 保留未来切 OSS 的能力

在目前 396MB RAM / 20GB disk 的条件下，我反而会认为引入 MinIO、Docker 或复杂媒体服务是不必要的架构扩张。

如果按“小步快跑 + 每步远程审核”继续，我建议下一工作单只做到 M0，而且把 M0 的交付证据固定为：git state + 原版 baseline inventory + server provision 结果 + 内存/磁盘基线 + reboot 后服务状态，不要提前夹带 M1 实现。

ChatGPT 可能会出错。请核查重要信息。




高
