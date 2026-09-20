# 远程审核记录 02：M0 工作单

> 审核方：ChatGPT（网页版）
> 时间：2026-09-21 02:42
> 会话：https://chatgpt.com/c/6ab0286a-1cf0-83e8-a221-4fd47488682b

---

思考了 1m 31s
ChatGPT 说：

这版 M0 已经接近可以直接下发执行。我给出的审核结论是 CONDITIONAL PASS：不需要重构，只需修正 3 个边界——补 baseline 的可复现元数据；不要在 M0 为 systemd 制造假后端；把 Node/PG 的并发资源测试主体移到 M1。

交付物：主体完整，但我建议补 4 项、调整 2 项。

应补的第一项是 baseline manifest。 现在“22 页截图 + 9 字段”还缺少截图产生时的环境，否则以后看到差异时，你无法判断是 UI 差异还是环境差异。至少固定：

package = com.kairuotu.campus
app_version/versionCode = 能取得则记录，不能则 UNKNOWN
emulator = MuMu + version
android_version
resolution = 1080x1920
dpi / font_scale
locale
theme
capture_timestamp
network_condition
account/data precondition

账号等敏感值不入库，只写抽象状态，例如 logged_in_user=A / has_3_posts=true。

第二项是 baseline coverage manifest。 不要靠“目录里大约有 22 个页面”证明完成。建议有：

docs/original-baseline/
  manifest.json
  screens/
    home/
      baseline.json
      normal.png
      empty.png
    post-detail/
      baseline.json
      normal.png
      error.png
    ...
  hashes.sha256

manifest.json 明确列出预期的 22 个 screen ID。Gate 用它判断 expected=22, completed=22。hashes.sha256 则把 M0 冻结的证据真正“锁住”。

第三项是服务器配置的 repo source-of-truth。 不要只修改 /etc/nginx、/etc/systemd、PostgreSQL 后结束。至少把实际配置的非 secret 部分同步到仓库，例如：

ops/nginx/campus.conf
ops/systemd/campus-backend.service
ops/postgresql/expected-settings.conf
docs/server-baseline/environment.json

以后服务器状态才能和 Git 中预期状态机械比较。

第四项是暴露面验证。 PostgreSQL “仅 localhost”不能只看配置文件，必须检查实际 socket；80 端口也不能只看安全组界面。M0 应同时验证：

ss -lntp
pg_isready -h 127.0.0.1
curl http://127.0.0.1/health
# 再从服务器外部：
curl http://PUBLIC_IP/health

PostgreSQL 必须不存在 0.0.0.0:5432 / [::]:5432。

两个需要调整的地方中，第一个是 systemd backend skeleton。M0 可以把 campus-backend.service 写好并运行：

systemd-analyze verify ...

但我建议保持：

campus-backend.service = disabled / inactive by design

不要为了让 systemctl is-active 变绿，写一个 setInterval() 假 Node 服务。真正的 backend systemd 启动、restart 和 reboot 自启，应由 M1 的 Fastify vertical slice 验证。

第二个是 D 中 5/20 并发下的 Node RSS / PG RSS。 这在 M0 缺少真实 Node 请求路径时其实没有稳定语义。你测 /health，本质只是在测 Nginx；为了测 Node 又得创造一个假的 HTTP 服务，反而污染 M0/M1 边界。

因此我建议 M0 改成：

idle:
  MemAvailable
  swap used
  nginx RSS
  PostgreSQL RSS
  load average

nginx /health:
  concurrency=5
  concurrency=20
  MemAvailable
  swap used
  nginx RSS
  PostgreSQL RSS
  load average

Node:
  node --version
  空进程/启动 RSS 可记录，但只作 informational

M1:
  再正式测 Nginx → Fastify → PostgreSQL 下的
  Node RSS / PG RSS / memory / swap / latency

这样数据才有可比较意义。

Node：我会选 Node 24 LTS，直接使用 Node.js 官方 Linux binary，不用 NodeSource，也不用 nvm。

截至 2026-09-21，Node 24 是 LTS，最新发布为 24.21.0；Node 26 仍处于 Current，要到 2026-10-28 才计划进入 LTS，所以现在不值得让项目承担 Current 线风险。
Node.js
+1

Ubuntu 26.04 自己确实提供 nodejs 22.22.1，所以并不是“26.04 没有 Node”；但 Node 22 已进入 Maintenance，计划于 2027-04-30 EOL，而 Node 24 支持期计划持续到 2028-04-30。对于现在才开始的项目，我倾向直接起步在 24。
Ubuntu Packages
+1

NodeSource 当前公开支持矩阵仍只列到 Ubuntu 24.04，因此我不会把它放进新鲜的 Ubuntu 26.04 生产环境依赖链。
GitHub

我会冻结成：

Node: 24.21.0 x64
source: official nodejs.org binary tarball
install: /opt/node-v24.21.0/
service ExecStart: 使用绝对路径
checksum: 入库记录 SHA256
nvm: 禁止用于 production service
NodeSource: 不使用
Node 26 Current: 不使用

396 MB 可用内存不是选择 Node 22 而不是 24 的充分理由。真正重要的是后面运行方式：只跑 1 个 Node process，不用 PM2/cluster，不在服务器上做 Vite production build，并在 M1 用真实 workload 测完后再决定是否加 --max-old-space-size / systemd MemoryMax。现在直接猜 96M 或 128M 反而可能人为制造 OOM。

Ubuntu 自带 Node 22 是我的 fallback：如果官方 Node 24 binary 在该机上出现实际兼容问题，就直接退回 Ubuntu 26.04 的 apt nodejs 22.22.1；不要临时转去未经你验证的 NodeSource 26.04 路径。

原版 baseline：22 个页面全部进入 M0 Gate，但按优先级采集，不要求每页强行制造四态。

我不建议“只做 tab + 发布 + 详情，然后 M0 放行”。

原因很简单：M0 的存在目的就是在开始改造前冻结原版事实。如果剩余页面一边开发一边补 baseline，就会发生你这次最想避免的事情：实现已经影响了人的认知，之后很容易把“我们做成什么样”误认为“原版是什么样”。

但也没必要要求每个页面必须凑齐 loading / empty / normal / error 四张图。很多页面可能根本没有某个状态，或者你当前无法诱发它。

我建议每个 screen 使用这种最小机器可读结构：

{
  "screen_id": "post-detail",
  "target_route": "/post/123",

  "entry": {
    "preconditions": ["logged_in"],
    "steps": ["home -> tap first post"]
  },

  "states": {
    "loading": {
      "status": "observed",
      "evidence": ["loading.png"]
    },
    "empty": {
      "status": "not_applicable",
      "evidence": []
    },
    "normal": {
      "status": "observed",
      "evidence": ["normal.png"]
    },
    "error": {
      "status": "not_reproducible",
      "evidence": []
    }
  },

  "interactions": [],
  "navigation": [],
  "persistence": [],
  "known_unknowns": []
}

状态枚举固定成类似：

observed
not_applicable
not_reproducible
blocked
unknown

绝对不要因为 Gate 要求四态而编造一个原版实际上没观察到的 error 页面。

采集顺序可以是：

第一批：主 tab / 列表 → 详情 → 评论
第二批：点赞 / 发布 / 上传
第三批：个人页 / 设置 / 其余边缘页面

但这是执行顺序，不是 M0 退出条件。

我建议 M0 Exit Gate 是：

22 / 22 screen 有 baseline.json
22 / 22 至少有 normal evidence
22 / 22 有 entry/precondition
每一个状态都有明确 enum，不允许留空
每一个 known unknown 都显式记录

某页面确实打不开时，也可以通过：

status = blocked
reason = ...
evidence = ...

关键是未知必须被表示，而不是被遗漏。

M0 完成判据：不要做一个“大脚本返回 PASS”，而是做明确的 assertion 集合；任一 mandatory assertion 失败，退出码非 0。

我建议最终的机械 Gate 定义为下面这样：

M0_GATE_VERSION=1

[GIT]
PASS current branch == fullstack
PASS recorded M0 base commit is ancestor of HEAD
PASS git status --porcelain == empty
PASS PLAN.md exists
PASS docs/review-log contains >= 1 review
PASS private key is NOT tracked by git
PASS private key is NOT present in git history
PASS M0 diff touches only allowed paths

[SCOPE]
PASS no frontend source file changed since M0 base
PASS no business API source added
PASS no business migration/schema added

[ORIGINAL_BASELINE]
PASS manifest expected_screens == 22
PASS completed_screens == 22
PASS every screen has required schema fields
PASS every screen has normal-state evidence
PASS every state has explicit status enum
PASS every referenced evidence file exists
PASS every evidence file has SHA256
PASS environment/capture manifest exists
PASS zero dangling screenshot references

[NODE]
PASS node --version == frozen version
PASS node binary path == frozen path
PASS binary checksum == expected checksum

[POSTGRESQL]
PASS service active
PASS service enabled
PASS pg_isready succeeds
PASS effective frozen settings == expected
PASS 5432 bound only to localhost/loopback
PASS no business tables exist

[NGINX]
PASS nginx -t
PASS service active
PASS service enabled
PASS local /health == HTTP 200 + exact expected body
PASS external /health == HTTP 200 + exact expected body
PASS :80 listening
PASS /api proxy configuration exists

[BACKEND_SYSTEMD]
PASS systemd-analyze verify campus-backend.service
PASS campus-backend.service == disabled
PASS campus-backend.service == inactive
# inactive is expected in M0, not a failure

[RESOURCE_BASELINE]
PASS idle sample exists
PASS concurrency=5 nginx-health sample exists
PASS concurrency=20 nginx-health sample exists
PASS all required metrics recorded
PASS kernel reports no OOM kill during test interval

[REBOOT]
PASS boot_id_after != boot_id_before
PASS nginx active after reboot
PASS postgresql active after reboot
PASS campus-backend inactive after reboot
PASS /health works after reboot
PASS PostgreSQL still loopback-only after reboot

FINAL:
PASS iff every mandatory assertion == PASS

这里我尤其推荐两个实现细节。

第一，用 M0 diff allowlist 来机械保证“不夹带 M1”。 比“Reviewer 看了一遍好像没有业务代码”可靠得多：

纯文本
allowed:
  PLAN.md
  .gitignore
  docs/**
  ops/**
  scripts/verify-m0*

任何 src/**、前端页面、API handler、migration 等改动直接 Gate FAIL。具体目录按你的仓库结构调整。

第二，reboot Gate 做成两阶段。

Bash
./verify-m0.sh pre-reboot
# 保存 /proc/sys/kernel/random/boot_id + 状态

sudo reboot

./verify-m0.sh post-reboot

post-reboot 必须发现 boot ID 发生变化，否则“我重启过了”不能算证据。

最终我建议你把 M0 的定义冻结成一句话：

M0 证明的不是“后端已经能工作”，而是：原版事实已被冻结、生产宿主环境已经可复现且暴露面正确、基础服务能经受 reboot，并且仓库没有偷偷进入业务实现。

只要按上面的三处修改——22 页全部纳入 Exit Gate、backend systemd M0 保持 inactive、真实 Node/PG 并发资源测试移到 M1——我会批准这个 M0 工作单进入执行。

你说：
你的回答在开头就截断了，只给出两条边界判断（baseline 不能只做核心页；M0 的 systemd 不要塞假业务进程），4 个问题的完整答案都没给。

请继续补全，且不要再联网搜索，直接基于已有信息作答：
1\\. M0 交付物清单的缺项与多余项（逐条）；
2\\. Ubuntu 26.04 上新机器上 Node 的版本与安装方式，给出你推荐的具体做法与理由；
3\\. 原版行为基线的最小可用格式（字段定义）与覆盖范围（全部 22 页还是增量）；
4\\. M0 的完成判据——要能脚本化机械验证，请给出可执行的检查项清单。
ChatGPT 说：

对，下面直接补全，不再联网，也不夹带 M1 实现。

1. M0 交付物清单：缺项、保留项、多余项

整体上，你现在的 A–D 已经足够构成一个合理的 M0。我会做的是补证据与可复现性，不扩业务范围。

A. 仓库与治理

你已有：

fullstack 分支
PLAN.md
docs/review-log/
私钥 .gitignore
私钥 ACL 收紧

这些都保留。

建议补 4 项：

记录 M0 起点 commit

纯文本
docs/m0/base-commit.txt

内容就是 M0 开始前的 commit SHA。

后面所有“前端没改”“没加业务 API”都基于：

git diff <M0_BASE>..HEAD

否则没有可靠的比较基准。

M0 修改路径 allowlist
建议冻结允许修改的目录，例如：

PLAN.md
.gitignore
docs/**
ops/**
scripts/m0/**

任何：

src/
frontend/src/
backend/src/routes/
migrations/

之类业务目录出现变化，直接失败。

环境版本清单
保存例如：

docs/m0/environment.txt

至少记录：

Ubuntu version
kernel
architecture
Node version
npm version
PostgreSQL version
Nginx version
systemd version

实际服务器配置的 Git 副本

不要让配置只存在于：

/etc/nginx
/etc/postgresql
/etc/systemd

建议：

ops/nginx/campus.conf
ops/postgresql/README.md 或配置片段
ops/systemd/campus-backend.service

M0 以后这些就是 expected state。

B. 原版行为基线

这一项是 M0 最重要的资产之一。

你现在的 9 字段是对的：

route
入口条件
参考截图
loading
empty
normal
error
关键交互
跳转结果
持久化状态
known unknowns

严格说其实已经超过 9 个概念项，但没关系。

这里我建议补三个东西。

第一：screen manifest

例如：

docs/original-baseline/manifest.json

里面明确写：

{
  "expected_screen_count": 22,
  "screens": [
    "home",
    "post-detail",
    "publish",
    "profile"
  ]
}

这样不会出现：

“看起来都截图了，但其实漏了一页。”

第二：采集环境 metadata

至少记录：

package name
原版 app version/versionCode（能查到就记录）
MuMu version
Android version
resolution
DPI
font scale
locale
theme
capture date
登录状态类别
测试数据前置条件

例如：

device:
  emulator: MuMu
  resolution: 1080x1920
  font_scale: 1.0
  locale: zh-CN

app:
  package: com.kairuotu.campus
  version: unknown

account_state:
  logged_in: true
  user_alias: account-A

不要存真实密码/token。

第三：截图 checksum

生成：

docs/original-baseline/SHA256SUMS

这样以后能确认：

M0 冻结的原始截图有没有被后来偷偷替换。

C. 服务器环境

你目前：

Node
PostgreSQL
systemd skeleton
Nginx
/health
开放 80

总体合理。

但我建议调整两个边界。

PostgreSQL

保留安装和调参。

M0 应验证：

PostgreSQL 已启动
reboot 后自动启动
listen_addresses 符合冻结值
5432 只绑定 localhost
没有业务数据库 schema/table

这里最后一点很重要。

M0 可以有：

postgres 默认系统数据库
角色
基础权限

但不要提前创建：

posts
users
comments
likes

甚至我倾向连正式业务 migration 都不要开始。

systemd service skeleton

保留 unit 文件，但不要制造假 Node 服务。

M0 最好的状态是：

unit file exists
systemd-analyze verify PASS
service inactive
service disabled

M1 再让它正式：

enabled
active
restartable
reboot-surviving

否则 M0 为了验证 systemd，会被迫创建一个“假的 backend”，边界就脏了。

D. 环境基线数据

这里是你当前清单里唯一一个我认为有一点过度设计的地方。

你写：

idle
5 concurrency
20 concurrency

RAM available
swap used
Node RSS
PG RSS
load average

问题是：

M0 根本没有真正 Node backend。

所以这时测：

Node RSS @ concurrency=20

没有实际含义。

我建议拆成：

M0 保留
idle:
MemAvailable
SwapUsed
PostgreSQL RSS
Nginx RSS
load average

Nginx /health @ concurrency=5
Nginx /health @ concurrency=20:
MemAvailable
SwapUsed
Nginx RSS
PostgreSQL RSS
load average
M1 再测
Nginx → Fastify → PostgreSQL

之后才正式记录：

Node RSS
PG RSS
latency
request failures
swap growth

因为那时候才是真实系统。

因此，对问题 1 的最终结论

缺项：

M0 base commit
修改路径 allowlist
环境版本清单
服务配置 Git 副本
baseline manifest
baseline 采集环境 metadata
baseline checksum
实际端口暴露验证

多余/应后移：

M0 的“真实 Node 并发 RSS”
M0 backend service 必须 active/enabled
任何为验证 systemd 而写的假业务 Node 服务

其余都保留。

2. Ubuntu 26.04 新机器：Node 怎么定

由于你明确要求这次不联网，我不依赖当前发行版仓库状态给你一个“最新版本号”。

我建议冻结原则，而不是冻结我无法现场核实的 patch version：

选择当前 Active LTS / LTS 主版本的官方 Node Linux x64 二进制发行包，固定具体 patch version 和 SHA256；生产机不用 nvm，不依赖 NodeSource。

如果你现在已经确定项目兼容 Node 24，我会直接选：

Node 24.x LTS

而不是追 Current。

为什么不是
ChatGPT 可能会出错。请核查重要信息。




高
