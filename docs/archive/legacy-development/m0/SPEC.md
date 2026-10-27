# M0 规格（冻结版，依据审核记录 02）

> 审核结论：**CONDITIONAL PASS** —— 按三处边界修正后批准执行。
> 原文见 `docs/archive/legacy-development/review-log/02-m0-workorder-review.md`。

## 一句话定义

> M0 证明的**不是**「后端已经能工作」，而是：
> 原版事实已被冻结、生产宿主环境已经可复现且暴露面正确、基础服务能经受 reboot、
> 并且仓库没有偷偷进入业务实现。

## 三处必须遵守的边界（审核强制）

1. **原版 baseline 必须 22 页全覆盖**，进入 M0 Exit Gate；按优先级分批采集，
   但**不要求每页强行凑四态**——绝不允许为了满足 Gate 而编造原版没观察到的 error 页。
2. **M0 的 systemd 不许塞假后端**：unit 文件写好 + `systemd-analyze verify` 通过，
   但服务保持 **disabled / inactive**。真正的 enabled/active/restart/reboot 自启由 M1 验证。
3. **Node/PG 并发资源测试移到 M1**：M0 没有真实 Node 请求路径，测 Node RSS 无意义。
   M0 只测 idle 与 nginx `/health` 的 5/20 并发（Nginx RSS、PG RSS、内存、swap、load）。

## 交付物

### A. 仓库与治理

| 交付 | 路径 |
|---|---|
| M0 起点 commit | `docs/archive/legacy-development/m0/base-commit.txt` |
| 修改路径 allowlist | `docs/archive/legacy-development/m0/allowlist.txt` |
| 环境版本清单 | `docs/archive/legacy-development/m0/environment.txt` |
| 服务配置 Git 副本 | `ops/nginx/campus.conf`、`ops/postgresql/expected-settings.conf`、`ops/systemd/campus-backend.service` |
| 暴露面/资源证据 | `docs/archive/legacy-development/m0/evidence/` |

allowlist（`git diff <M0_BASE>..HEAD` 只允许动这些）：

```
PLAN.md
.gitignore
docs/**
ops/**
scripts/m0/**
tools/**
```

任何 `app/src/**`、`server/src/**`、`migrations/**` 的改动 → Gate 直接 FAIL。

### B. 原版行为基线

```
docs/test/original-baseline/
  manifest.json          # expected_screen_count=22 + screen id 列表
  environment.json       # 采集环境 metadata
  SHA256SUMS             # 截图校验和，锁住冻结证据
  screens/
    <screen-id>/
      baseline.json
      normal.png
      ...
```

`baseline.json` 最小结构（状态枚举固定为
`observed` / `not_applicable` / `not_reproducible` / `blocked` / `unknown`）：

```json
{
  "screen_id": "post-detail",
  "target_route": "/post/123",
  "entry": { "preconditions": ["logged_in"], "steps": ["home -> tap first post"] },
  "states": {
    "loading": { "status": "observed", "evidence": ["loading.png"] },
    "empty":   { "status": "not_applicable", "evidence": [] },
    "normal":  { "status": "observed", "evidence": ["normal.png"] },
    "error":   { "status": "not_reproducible", "evidence": [] }
  },
  "interactions": [],
  "navigation": [],
  "persistence": [],
  "known_unknowns": []
}
```

`environment.json` 至少固定：package、app version（取不到写 UNKNOWN）、emulator 版本、
Android 版本、分辨率、DPI、font_scale、locale、theme、采集时间、网络条件、
账号/数据前置状态（只写抽象态如 `logged_in_user=A`，**不写真实账号密码 token**）。

采集顺序（执行顺序，不是退出条件）：
1. 主 tab / 列表 → 详情 → 评论
2. 点赞 / 发布 / 上传
3. 个人页 / 设置 / 其余边缘页面

### C. 服务器环境

- **Node**：官方 linux-x64 二进制包，冻结 `v24.21.0`，安装到 `/opt/node-v24.21.0/`，
  ExecStart 用绝对路径，SHA256 入库；**不用 nvm、不用 NodeSource、不用 Node 26 Current**。
  回退方案：Ubuntu 26.04 自带的 apt `nodejs`（22.x）。
  暂不设置 `--max-old-space-size` / `MemoryMax`（等 M1 用真实 workload 决定）。
- **PostgreSQL**：apt 安装 + 按 PLAN.md 第五节参数调参；**仅监听 localhost**；
  **不得创建任何业务表**（users/posts/comments/likes 等一律不建）。
- **systemd**：写好 `campus-backend.service`，verify 通过，保持 disabled + inactive。
- **Nginx**：安装 + `/api` 反代骨架 + `/health` 返回固定 body；`nginx -t` 通过。

### D. 资源与暴露面证据

- idle：MemAvailable / swap used / Nginx RSS / PostgreSQL RSS / load average
- nginx `/health` @ concurrency=5 / 20：同上指标
- Node：只记 `node --version`（informational）
- 暴露面：`ss -lntp`、`pg_isready -h 127.0.0.1`、`curl http://127.0.0.1/health`、
  以及**从服务器外部** `curl http://8.148.156.146/health`
- **PostgreSQL 不得出现 `0.0.0.0:5432` / `[::]:5432`**

## M0 Exit Gate（机械断言，任一 mandatory 失败即非 0 退出）

```text
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
PASS campus-backend.service == inactive   # M0 就该 inactive，不是失败

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

FINAL: PASS iff every mandatory assertion == PASS
```

两个实现细节（审核点名推荐）：
- **diff allowlist 机械化**「不夹带 M1」，比人工看一遍可靠。
- **reboot Gate 两阶段**：`verify-m0.sh pre-reboot`（存 boot_id）→ `reboot` → `verify-m0.sh post-reboot`
  （必须发现 boot_id 变化，否则「我重启过了」不算证据）。

## 服务器实测事实（2026-09-21 采集）

| 项 | 值 |
|---|---|
| OS / 内核 / 架构 | Ubuntu 26.04.1 LTS / 7.0.0-30-generic / x86_64 |
| CPU | 2 vCPU Intel Xeon Platinum 8269CY @2.50GHz |
| 内存 | total 396MB，available ~194MB，swap 2GB（已用 ~106MB） |
| 磁盘 | 20GB，已用 4.7GB，剩 14GB |
| 已装 | git、python3、systemd；**无** node/npm/pnpm/psql/nginx |
| 监听 | 仅 53(DNS)、46767(hbrclient)、22(sshd) |
| 防火墙 | ufw inactive；iptables 全 ACCEPT（默认拒绝只靠安全组） |
| apt | 候选列表为空 → **需先 `apt-get update`** |

Node 版本核实（2026-09-21 查 nodejs.org/dist/index.json）：
最新 LTS = **v24.21.0（Krypton，2026-09-07）**；最新 Current = v26.9.0。
