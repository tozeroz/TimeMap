# 开发、Git 协作与服务器发布

维护日期：2026-10-27。本文说明当前仓库脚本；实际线上版本需通过发布记录和检查确认。

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

## 启动网页

在 `app/` 目录运行：

```powershell
pnpm install
pnpm dev
```

默认地址是 `http://127.0.0.1:5174/`。前端通过 `app/.env.local` 中的 `VITE_API_ORIGIN` 选择后端：本机后端为 `http://127.0.0.1:3002`，正式后端为 `https://8.148.156.146`。修改后重启前端。

正式后端需要允许对应本地来源访问；切换后使用线上账号，发帖、点赞、删除等操作会修改线上数据。需要本机 PostgreSQL、后端和测试账号时，按[本地测试环境](local-testing.md)操作。`tools/start-local.ps1` 会把接口地址重新设为本机后端，并启动网页到 5180 端口。

## 地图与密钥

本地配置参考 `app/.env.example`，真实值保存在被 Git 忽略的 `app/.env.local`：

```dotenv
VITE_TENCENT_MAP_KEY=
VITE_AMAP_JS_KEY=
VITE_AMAP_SECURITY_CODE=
```

这些配置在开发服务器启动或前端构建时读取。没有官方 Key 时会使用备用栅格地图，再失败则使用离线底图。

正式网页统一构建配置保存在服务器 `/srv/campus/web-build.env`，由管理员维护，权限为 600。它包含 `VITE_API_ORIGIN`、高德 Key 与安全密钥。真实值不放进文档、源码或 Git。百度抠图配置与地图配置彼此独立。

`tools/deploy-web.ps1` 从服务器读取该文件，将允许的变量传给构建；缺少高德 Key 或安全密钥时中止，并检查最终 JS 成品是否带入配置。`-SkipBuild` 也检查成品，但仅在确认成品来自本次待发布代码时使用。绕过脚本自行上传无法获得这些检查。

后端环境变量不会自动注入网页。Web Key 最终随前端下发，还应结合供应商控制台的访问限制管理。

## 正式发布

发布前在群里协调，确认工作区干净、代码已合并 main，并拉取最新 main。脚本使用当前本地代码，不会替发布者确认代码是否经过 PR 或与远程 main 一致。

默认目标为 `root@8.148.156.146`，需要服务器认可的 SSH 私钥。私钥不提交 Git。将以下示例路径替换成自己的安全存放位置，在仓库根目录执行。

发布前端网页：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy-web.ps1 -Key "C:\安全目录\服务器私钥.pem"
```

发布后端：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/deploy-server.ps1 -Key "C:\安全目录\服务器私钥.pem"
```

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
