# 本机测试环境

当前入口：http://127.0.0.1:5180/ 。前端通过`app/.env.local`连接本机后端`http://127.0.0.1:3002`。

## 启动和停止

在项目根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/start-local.ps1
```

启动脚本保留原有抠图凭证，准备本地目录，启动PostgreSQL，再构建并启动后端和网页。所有服务监听本机地址。数据库与已上传照片保存在`.local/`，停止后不会删除。

停止本地服务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/stop-local.ps1
```

修改`server/.env`中的抠图配置后，需要停止再启动本地环境。

## 本地测试账号与验证码

已创建测试账号：`19900000001`（显示名：本地测试用户），仅存在于本机数据库。

打开网页登录页，输入该手机号并点击获取验证码。本地环境不发送短信，验证码写入`.local/login-codes/`。点击获取验证码后，在`server`目录执行下面的命令读取当前验证码，再回到网页填写：

```powershell
node --env-file=.env dist/admin.mjs latest-code
```

验证码会过期且仅可使用一次。使用你自己的手机号时，需要先在本地注册；线上账号不会自动同步到本地数据库。

## 抠图配置

在`server/.env`中填写或修改：

```dotenv
BAIDU_CUTOUT_API_KEY=你的百度API_Key
BAIDU_CUTOUT_SECRET_KEY=你的百度Secret_Key
CUTOUT_MAX_CALLS=24
```

`CUTOUT_MAX_CALLS`是本地数据库记录的累计尝试上限，失败尝试也计入；0表示关闭。点击生成贴纸会将当前照片经后端提交给百度，可能消耗供应商额度。当前环境搭建和验证没有调用抠图供应商。

其他本地设置由`tools/configure-local.mjs`配置：数据库端口15432，后端3002，网页5180；图片目录`.local/uploads`，验证码目录`.local/login-codes`。已有抠图变量不会被该工具覆盖。

本地直接读取图片通过`LOCAL_MEDIA_SERVE=1`启用，保留原有媒体访问权限校验。线上保持默认方式，由反向代理下发媒体。

`.local/`、`server/.env`与`app/.env.local`均已忽略，不提交到Git。构建用于线上部署的前端前，应移除或更改本机`VITE_API_ORIGIN`覆盖，避免生产构建连接127.0.0.1。

## 实际验证

2026-10-12已在真实本机PostgreSQL上执行19项数据库迁移。验证通过：本地验证码登录、图片上传、纯图片发帖、重复提交返回同一帖子、图片读取和详情接口；真实浏览器文字发帖成功后回到地图，全部API请求连接本地3002端口。

运行回归测试（会在本机测试账号下创建测试帖子，不调用付费抠图）：

```powershell
node tools/checks/local-backend-smoke.mjs
node tools/checks/local-browser-smoke.mjs
```

数据库使用项目目录内的便携PostgreSQL，无需注册Windows系统服务。发行包来自[EDB PostgreSQL二进制下载](https://www.enterprisedb.com/download-postgresql-binaries)，便携方式亦列于[PostgreSQL Windows下载说明](https://www.postgresql.org/download/windows/)。
