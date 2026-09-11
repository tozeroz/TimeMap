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

# 一次跑完 web 构建 + cap sync + gradle + 安装
& 'G:\demo map\tools\build-android.ps1'

# 真机交互走查（CDP 连进 APK 的 WebView，断言路由）
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$appPid = (& $adb -s 127.0.0.1:16384 shell pidof com.campusx.demo | Out-String).Trim()
& $adb -s 127.0.0.1:16384 forward tcp:9222 "localabstract:webview_devtools_remote_$appPid"
node 'G:\demo map\tools\device-walkthrough.mjs'
& 'G:\demo map\tools\device-shots.ps1'
```

## 五、已知边界（不是 bug，是需求决定的取舍）

1. **配图与头像**：全部是本地生成的抽象渐变图 / SVG 头像。
   需求要求「数据完全 mock、纯本地不联网」，且原版图片与头像属于他人内容，故一律不复用。
   这也是与原版一致性评分停在 7/10 的主要原因。
2. **地图底图**：原版是腾讯地图 SDK 实时瓦片；demo 用自绘 SVG 街区块还原观感。
3. **相机 / 扫码**：原版调用真实摄像头；demo 用取景画面与扫描线动画模拟。
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
