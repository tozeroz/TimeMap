# Campus 复刻 Demo（可安装 APK）

把 MuMu 模拟器里的安卓 app **`com.kairuotu.campus` v2.10.0** 复刻成一个可 `adb install` 的
安卓应用：全部页面、Capacitor + Web 实现、数据全部本地 mock（内容真实感）、纯本地无后端。

## 一、交付物在哪里

| 交付物 | 位置 |
|---|---|
| **可安装 APK** | `app/android/app/build/outputs/apk/debug/app-debug.apk`（约 4.3 MB） |
| 源码 | `app/src/`（23 个页面组件 + 数据层 + 组件层） |
| mock 数据 | `app/src/data/mock.ts`（唯一数据源） |
| 页面地图 | `docs/page-map.md` |
| 一致性对比报告 | `docs/comparison.md` |
| 设备端验收报告 | `docs/device-walkthrough.md` |
| 事故报告（对话异常停止） | `docs/incident-2026-09-12-turn-abort.md` |
| 原版截图 | `.mumu-capture/sweep/`（18 张） |
| demo 截图（浏览器） | `.mumu-capture/demo/`（22 张） |
| demo 截图（真机） | `.mumu-capture/device/`（22 张） |
| 勘察与构建脚本 | `tools/` |

## 二、安装与运行

```powershell
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
& $adb -s 127.0.0.1:16384 install -r 'G:\demo map\app\android\app\build\outputs\apk\debug\app-debug.apk'
& $adb -s 127.0.0.1:16384 shell am start -n com.campusx.demo/.MainActivity
```

APK 信息：

| 项 | 值 |
|---|---|
| applicationId | `com.campusx.demo`（**故意与目标 app 区分**，不会覆盖原版） |
| 应用名 | 校园 |
| minSdk / targetSdk | 28 / 34（由 Capacitor 决定，与目标 app 的 28/34 一致） |
| 屏幕方向 | 竖屏锁定 |
| 权限 | 仅 `INTERNET`（`apkanalyzer manifest permissions` 校验） |

> 注：模拟器 `dumpsys package` 里还会列出 `QUERY_ALL_PACKAGES`，
> 那是平台侧的额外条目；APK 二进制 Manifest 里并没有它（已用 `apkanalyzer` 核对）。

## 二·五、配置地图 Key（可选，不配也能跑）

仓库里**不含任何真实 Key**。地图 Key 走 Vite 环境变量：

```powershell
cd 'G:\demo map\app'
Copy-Item .env.example .env.local     # .env.local 已被 .gitignore 忽略
# 编辑 .env.local，填上自己的 Key：
#   VITE_TENCENT_MAP_KEY=        ← https://lbs.qq.com/dev/console/key/manage
#   VITE_AMAP_JS_KEY=            ← https://console.amap.com/dev/key/app
#   VITE_AMAP_SECURITY_CODE=
pnpm build; npx cap sync android      # 重新打包才会生效
```

没填 Key 会怎样（已验证）：地图**不会**去请求官方 SDK（省掉一次注定失败的等待），
直接降级到不需要 Key 的栅格瓦片；瓦片也不可达时再退到离线自绘底图。功能不中断。

> 为什么 Key 不写进仓库：这两家都是前端 JS SDK，Key 最终必然随包下发到客户端，
> 但「随包下发」不等于「该公开在 GitHub 上」—— 公开仓库里的 Key 会被爬虫扫走，直接消耗配额。

## 三、页面覆盖（对照 APK 内的 TheRouter 路由表）

原版共 25 条路由，其中 22 条是有界面的页面，**全部复刻**；
其余 3 条是入口/桥接/通用容器（`main`、`webview`、`groupchat/invitePage`），无独立 UI。

| 分组 | 页面 |
|---|---|
| 主 tab | 校园广场 `#/campus`、个人主页 `#/me`、地图 `#/map` |
| 动态 | 动态详情 `#/feed`、评论详情 `#/comments`、校园圈 `#/feedlist`、今日打卡 `#/daily` |
| 地点 | 选点 `#/poi`、地点详情 `#/poidetail` |
| 发布 | 相机发布 `#/publish`、扫码 `#/scanner` |
| 社交 | 留言板 `#/board`、聊天列表 `#/message`、单聊 `#/chat`、群聊 `#/group`、群公告 `#/announce` |
| 账号 | 手机号登录 `#/login`、登录方式 `#/loginselect`、新手引导 `#/onboarding` |
| 其他 | 图片预览 `#/media`、升级弹窗 `#/upgrade`、更多入口 `#/more` |

## 四、如何自己验证

```powershell
# 开发预览（桌面浏览器，会自动套手机壳）
cd 'G:\demo map\app'; pnpm run dev        # http://127.0.0.1:5174

# 一键验收：构建 → 部署 → 路由回归 → 交互闭环 → 真实定位 → 地图手势（在线+离线）→ 汇总
& 'G:\demo map\tools\acceptance.ps1'              # 完整跑
& 'G:\demo map\tools\acceptance.ps1' -SkipBuild   # 只验证已安装的包

# 单独跑某一项
node 'G:\demo map\tools\device-eval.mjs' --file tools/checks/full-regression.js    # 34 路由
node 'G:\demo map\tools\device-eval.mjs' --file tools/checks/interaction-loops.js  # 19 项交互
node 'G:\demo map\tools\device-eval.mjs' --file tools/checks/geo-location.js       # 真实定位（需先授权）
node 'G:\demo map\tools\device-eval.mjs' --file tools/checks/geo-denied.js         # 未授权时的降级
node 'G:\demo map\tools\device-gesture.mjs' pinch 540 900 80 300 12                # 双指捏合
& 'G:\demo map\tools\device-shots.ps1'                                             # 30 路由截图
```

想看无网络时的降级底图：`#/map?offline=1`（强制自绘地图，用于演示与手势验收）。

当前验收结果（真机）：

| 项 | 结果 |
|---|---|
| 全路由回归 | 34 / 34 |
| 交互闭环 | 19 / 19 |
| 真实定位 | 蓝点落在设备上报坐标 ✅、精度圈 ✅、「回到定位」飞到真实位置 ✅ |
| 弹窗可点性（真实触摸，非程序化 click） | 定位弹窗能关 ✅、悬浮放大键有反应 ✅ |
| 发布页页内取景 | 实时流 ✅、底排 `相册｜快门｜前后置切换` 顺序 ✅、真实触摸点快门拍到 JPEG ✅、切换键 facing 变 user ✅ |
| 相册键 | 真实触摸后前台切到系统相册选择器 ✅ |
| 地图底图（四套，逐套验证） | 腾讯 GL SDK：出图 ✅ 拖拽 ✅ 缩放 ✅<br>高德 JSAPI 1.4：出图 ✅ 拖拽 ✅<br>栅格瓦片 Leaflet：20/20 瓦片 ✅ 拖拽 ✅<br>离线自绘：拖拽 ✅ 双击 ✅ 捏合 ✅ |
| 汇总 | **ALL CHECKS PASSED** |

> 浏览器侧另有 `node tools/web-camera-verify.mjs`（真实电脑摄像头）
> 与 `node tools/web-camera-verify.mjs --fake`（Chromium 合成摄像头）两条摄像头链路验证。

> 说明：`acceptance.ps1` 保持纯 ASCII——中文在 PowerShell 编码往返后会被破坏并导致脚本解析失败。
>
> 截图脚本带「渲染冻结守卫」：MuMu + WebView 偶发渲染器冻结时，DOM 仍在更新
> （CDP 断言全绿）但 `screencap` 返回缓存帧，表现为连续多张截图哈希相同；
> 守卫会在检测到后自动重启应用并重截该页。

## 五、已知边界（不是 bug，是需求决定的取舍）

1. **配图与头像**：全部是本地生成的抽象渐变图 / SVG 头像。
   需求要求「数据完全 mock、纯本地不联网」，且原版图片与头像属于他人内容，故一律不复用。
   这也是与原版一致性评分停在 7/10 的主要原因。
2. **地图底图**：原版是腾讯地图 SDK 实时瓦片；demo 已接入**腾讯地图 GL JS SDK**
   （官方 Key，与原版同款服务），后面依次是高德官方 JSAPI → 栅格瓦片 → 离线自绘兜底 ——
   见 `docs/real-map-and-posting.md`。
3. **相机 / 扫码**：拍摄页是**页内实时取景**（WebView + getUserMedia），与原版形态一致；
   相册走系统选择器。扫码仍是扫描线动画模拟。
4. **校园圈**：原版在无后端时就是「网络错误」页，demo 如实复刻该错误态，
   点「刷新」后展示本地内容把这个状态闭环。

## 六、工程结构

```
app/
  src/
    App.tsx                # 路由分发
    router.ts              # 极简 hash 路由（无第三方依赖）
    data/mock.ts           # 全部 mock 数据（唯一数据源）
    components/            # Shell（手机外壳/状态栏）、TabBar、icons
    screens/               # 23 个页面组件，每个配同名 css
    styles/                # tokens.css（设计令牌）、global.css、pages.css
  android/                 # Capacitor 生成的安卓工程（已锁定竖屏、移除多余权限）
docs/                      # 页面地图 / 对比报告 / 设备验收 / 事故报告
patches/                   # DeepSeekEyes 插件补丁（与本 demo 无关，见事故报告）
tools/                     # 勘察、截图、构建、设备走查脚本
```
