# 开发、Git 协作与服务器发布

维护日期：2026-11-20。适用范围：本地网页开发、远程后端联调、前端网页发布及 Git 协作。本文说明当前仓库脚本；实际线上版本需通过发布记录和检查确认。

日常使用：首次准备完成后，按[连接远程后端运行](#连接远程后端运行日常使用)启动；测试完按 **Ctrl+C** 停止；需要更新线上网页时，另开 PowerShell 按[发布前端网页](#发布前端网页)操作。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `app/` | React + Vite 网页和 Capacitor Android 工程 |
| `server/` | Node.js 后端，使用 PostgreSQL 保存业务数据 |
| `tools/` | 本地启动、构建、发布和验证工具 |
| `ops/`、`deploy/` | 服务、证书和反向代理配置 |
| `scripts/` | 历史阶段验收及专项验证脚本 |

浏览器通过后端接口访问数据库。前端、后端分别构建和部署，Android APK 单独打包。合并 main 不会自动完成服务器发布。

## Git 协作

开始新功能前，先更新 main，再创建功能分支：

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/自己的功能名
```

已有功能分支同步 main 时，先提交或妥善保存本地修改，再执行：

```powershell
git fetch origin
git switch 自己的分支名
git merge origin/main
```

每完成一块功能就 commit，说明改动目的；复杂逻辑和特殊处理补充说明原因的注释。本地测试通过后推送个人分支，发起目标为 main 的 PR，经仓库要求的检查和审核后合并。main 已要求通过 PR 修改，直接推送会被拒绝。

## 本地运行与停止

### 两种测试环境

| 使用场景 | 请求链路 | 启动方式 |
| --- | --- | --- |
| 本地改页面，使用远程账号与内容 | 本地前端 → Vite 开发代理 → 远程后端 → 远程数据库 | 本文的日常运行命令 |
| 隔离测试后端、迁移或批量测试数据 | 本地前端 → 本机后端 → 本机 PostgreSQL | [完整本地测试环境](local-testing.md) |

前端通过后端接口访问数据库，不直接连接 PostgreSQL。日常连接远程后端时，不需要启动本地后端、本地数据库或 SSH 数据库隧道，也不需要运行 `tools/start-remote-preview.ps1`。该脚本是另一套直接连接远程数据库的预览网关，与本文的远程后端代理方式不同。

### 首次准备

以下命令使用当前电脑的项目路径；换电脑时替换为自己的仓库目录。需要已安装 Node.js、npm；部署脚本另外使用 pnpm、SSH 和 SCP。

首次拉取或依赖变化后，在 `app/` 安装依赖；已有正常依赖时不必每次安装：

```powershell
cd E:\code\BJTUTimeMap\TimeMap\app
pnpm install
```

本地地图配置参考下一节的 `app/.env.example`。已有 `app/.env.local` 时保留其中的地图 Key，不要整份覆盖。

远程后端代理配置保存在 `.local/vite-remote.config.mjs`，属于本机文件，不提交 Git。当前电脑已创建；重新拉取仓库或换电脑后，在项目根目录创建一次：

```powershell
cd E:\code\BJTUTimeMap\TimeMap
New-Item -ItemType Directory -Path .local -Force | Out-Null
@'
import baseConfig from '../app/vite.config.ts'
const remote = { target: 'https://8.148.156.146', changeOrigin: true }
export default {
  ...baseConfig,
  server: { ...baseConfig.server, proxy: { '/api': remote, '/media': remote } },
}
'@ | Set-Content -LiteralPath .local/vite-remote.config.mjs -Encoding utf8
```

代理保留远程 HTTPS 证书校验，并把 `/api` 与 `/media` 请求转发到远程后端。浏览器请求本地同源地址，避免依赖远程后端是否允许本地开发端口跨域。

### 连接远程后端运行（日常使用）

每次另开一个 PowerShell 窗口执行：

```powershell
cd E:\code\BJTUTimeMap\TimeMap
$env:VITE_API_ORIGIN = 'http://127.0.0.1:5180'
$env:VITE_READ_ONLY_PREVIEW = '0'
cd app
npm run dev -- --config ../.local/vite-remote.config.mjs --port 5180 --strictPort
```

打开 [本地 TimeMap](http://127.0.0.1:5180/#/map)。这两个环境变量仅作用于当前终端及其启动的进程，优先于 `.env.local`，无需反复修改地图配置。`VITE_API_ORIGIN` 指向本地前端，是为了让请求经过上述代理；实际业务由远程后端处理。

使用远程环境的账号登录。登录、发帖、评论、点赞、上传、删除和管理员操作会作用于远程环境；测试数据不会因为关闭前端而自动清除。需要隔离数据时使用完整本机环境。

启动后应验证页面和本地代理的就绪接口。在另一个窗口可执行：

```powershell
Invoke-RestMethod http://127.0.0.1:5180/api/ready
```

返回 `status: ready`、`db: up` 表示远程后端及数据库就绪，仍需在页面验证本次修改的功能。

### 停止与重新启动

在运行 Vite 的终端按 **Ctrl+C**，如提示是否终止批处理则确认。停止后本地 `5180` 端口不再提供网页；远程后端继续运行，已保存的数据保留。需要再次运行时，重新执行上面的日常命令。

切换后端配置或运行完整本机环境前，先停止当前前端，并另开终端，避免沿用 `$env:VITE_API_ORIGIN`。`tools/start-local.ps1` 会将 `.env.local` 设为本机后端，但不能覆盖当前终端中优先级更高的同名环境变量。

若提示 `Port 5180 is already in use`，先在之前的终端按 Ctrl+C，不要同时启动两份前端。若页面还请求 `3002` 或 `3003`，检查是否使用了旧启动命令或旧窗口，按日常命令重新启动并刷新页面。旧的 `tools/stop-local.ps1` 按它自己的进程记录停止服务，不负责停止本节在终端启动的 Vite。

直接执行 `pnpm dev` 默认使用 `app/vite.config.ts` 的 `5174` 端口，不会自动启用本文的远程代理。

## 地图与密钥

本地配置参考 `app/.env.example`，真实值保存在被 Git 忽略的 `app/.env.local`：

```dotenv
VITE_TENCENT_MAP_KEY=
VITE_AMAP_JS_KEY=
VITE_AMAP_SECURITY_CODE=
```

这些配置在开发服务器启动或前端构建时读取。没有官方 Key 时会使用备用栅格地图，再失败则使用离线底图。

高德官方 SDK 默认使用马卡龙 `amap://styles/macaron` 底图，显示背景、道路、建筑及 POI 标注（包括建筑名称）。可通过 `VITE_AMAP_MAP_STYLE` 指定其他官方主题或已发布的自定义样式 URI，修改后重启开发服务或重新构建。使用 `#/map` 可按默认顺序加载 SDK；`#/map?theme=macaron` 可显式选择官方马卡龙主题；`#/map?raster=1` 强制使用栅格备用底图，不会应用该样式。

正式网页统一构建配置保存在服务器 `/srv/campus/web-build.env`，由管理员维护，权限为 600。它包含 `VITE_API_ORIGIN`、高德 Key 与安全密钥。真实值不放进文档、源码或 Git。百度抠图配置与地图配置彼此独立。

`tools/deploy-web.ps1` 从服务器读取该文件，将允许的变量传给构建；缺少高德 Key 或安全密钥时中止，并检查最终 JS 成品是否带入配置。日常发布始终重新构建，不加 `-SkipBuild`；该选项只供明确核对过产物来源和配置的特殊操作使用。绕过脚本自行上传无法获得这些检查。

后端环境变量不会自动注入网页。Web Key 最终随前端下发，还应结合供应商控制台的访问限制管理。

## 正式发布

发布前在群里协调，确认工作区干净、代码已合并 main，并拉取最新 main。脚本使用当前本地代码，不会替发布者确认代码是否经过 PR 或与远程 main 一致。

默认目标为 `root@8.148.156.146`，需要服务器认可的 SSH 私钥。私钥不提交 Git。将以下示例路径替换成自己的安全存放位置，在仓库根目录执行。

### 发布前端网页

测试完成、代码已按团队流程合并后，**另开一个 PowerShell 窗口**，在项目根目录运行：

```powershell
cd E:\code\BJTUTimeMap\TimeMap
$env:VITE_API_ORIGIN = 'https://8.148.156.146'
$env:VITE_READ_ONLY_PREVIEW = '0'
.\tools\deploy-web.ps1
```

不要从本地测试终端直接继承 `http://127.0.0.1:5180` 等配置构建线上包。生产 API 地址必须为远程地址；服务器 `web-build.env` 中的同名配置会覆盖当前终端传入值，也应由管理员保持为正确生产地址。

脚本会读取服务器的生产地图配置，重新构建前端、上传到临时目录、切换线上静态文件并执行检查。正常结束时显示 `DEPLOY_WEB: OK (build-id ...)`。部署不使用 `.local/vite-remote.config.mjs`，不需要手工上传 `app/dist`，也不需要为仅前端修改重启远程数据库或后端服务。

脚本会自动寻找本机已加固的 SSH 密钥。若密钥放在其他位置，或当前终端限制直接运行脚本，使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy-web.ps1 -Key "C:\安全目录\服务器私钥.pem"
```

该替代命令应在设置好上述生产环境变量的发布窗口执行。SSH 密钥和服务器配置文件均不得提交 Git。

部署后打开 [线上 TimeMap](https://8.148.156.146/)，必要时按 **Ctrl+F5** 强制刷新，检查地图、登录和本次修改的功能。可核对 [build-id.txt](https://8.148.156.146/build-id.txt) 是否与脚本输出一致，以及 [后端就绪接口](https://8.148.156.146/api/ready) 是否正常。

前端部署会更新网页文件，用户内容仍保存在远程数据库，不会因网页发布而重新初始化。若接口逻辑或数据库结构有变化，仅更新网页不能使后端自动支持新功能；例如前端新增评论字段时，后端也必须支持该字段。

### 什么时候需要发布后端或 APK

后端发布使用独立脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy-server.ps1 -Key "C:\安全目录\服务器私钥.pem"
```

执行前必须核对迁移校验和、备份、环境变量及接口兼容性。该脚本会安装后端程序、重启服务，并可能重写服务器运行配置；不能把它当作仅更新网页的日常步骤。数据库迁移的具体实施按当次变更评估，不直接把本地测试库覆盖到远程数据库。

| 修改范围 | 发布内容 |
| --- | --- |
| 网页界面或地图配置 | 前端网页 |
| 后端逻辑 | 后端程序；涉及数据库时评估迁移与备份 |
| 接口和页面同时变化 | 配套发布前后端，确认兼容性 |
| Android 应用界面或原生能力 | 另行构建和分发 APK；更新网页不会更新已安装的 APK |

发布后记录提交号、时间、执行人和验证结果，检查登录、地图及修改功能。静态资源检查不能替代实际页面验收。发布失败时先核实结果；回滚前确认备份及发布后的新增数据。

## 服务器配置分工

| 路径 | 用途 |
| --- | --- |
| `/srv/campus/web/` | 发布后的网页静态文件 |
| `/srv/campus/server/dist/` | 构建后的后端程序 |
| `/srv/campus/web-build.env` | 前端构建时读取的统一配置 |
| `/srv/campus/server.env` | 后端部署生成的运行配置，发布时可能重写 |
| `/srv/campus/operator.env` | 运维维护的后端凭证，例如百度抠图配置 |

完整目录见[项目文档入口](../README.md)。早期复刻 Demo、验收和旧安装包记录仅用于追溯，不代表当前项目仍使用纯 mock 数据，也不代表当前线上版本。
