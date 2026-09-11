# 设备端验收：真机走查与交互验证

> 环境：MuMu 12 模拟器 / Android 12 / 物理屏 1080×1920
> 被测产物：`app/android/app/build/outputs/apk/debug/app-debug.apk`（debug 构建，已 `adb install`）
> 时间：2026-09-12

## 一、为什么要用 CDP 而不是像素点击

模拟器的逻辑显示处于**旋转 1**（横屏坐标空间，1920×1080），而 `screencap` 输出的是
**竖屏图像**（1080×1920）。因此：

- `adb shell input tap x y` 用的是**逻辑（横屏）坐标**，而截图看的是**竖屏像素**，
  两者需要换算（图像点 (px,py) ↔ 逻辑点 (py, 1080−px)），实测容易点偏；
- 更可靠的判据不是"点了有没有反应"，而是**应用内部的真实路由状态**。

所以设备端验收改用 **WebView 远程调试（Chrome DevTools Protocol）**：
在真实 APK 的 WebView 里执行真实 DOM 点击，并断言 `location.hash` / DOM 结构。
这既验证了真机上的渲染与交互，又给出可复现的机器判据。

```powershell
# 前置：应用已启动
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$appPid = (& $adb -s 127.0.0.1:16384 shell pidof com.campusx.demo | Out-String).Trim()
& $adb -s 127.0.0.1:16384 forward tcp:9222 "localabstract:webview_devtools_remote_$appPid"
node tools/device-walkthrough.mjs     # 交互走查
node tools/device-shots.ps1           # 逐页截图
```

## 二、设备环境实测

| 项 | 值 | 说明 |
|---|---|---|
| WebView 视口 | **618 × 1074 CSS px**，dpr 1.75 | 换算物理像素 = 1081 × 1880，与屏幕一致 |
| 页面 URL | `https://localhost/#/campus` | Capacitor 的 `androidScheme: https` |
| UA | `Mozilla/5.0 (Linux; Android 12; BVL-AN00 …; wv)` | Cordova/WebView 标记 `wv` |
| 屏幕方向 | 竖屏（已在 Manifest 锁定） | 见下文问题 1 |

## 三、交互走查结果（真实 APK，全部通过）

| 步骤 | 期望 | 实测 |
|---|---|---|
| 起点 | 校园广场 | `#/campus`，标题「校园广场」✅ |
| 底部 tab 数量 | 3 | 3 ✅ |
| 点底部「地图」 | 地图页 | `#/map`，标题「地图」✅ |
| 关掉授权弹窗 | 弹窗消失 | ✅ |
| 点底部「个人」 | 个人页 | `#/me`，标题「自定义名称6」✅ |
| 点底部「校园」 | 回校园 | `#/campus` ✅ |
| 个人页点菜单 | 更多页 | `#/more` ✅ |
| 更多页点「校园圈」 | 校园圈 | `#/feedlist` ✅ |
| 校园圈初始态 | 网络错误页 | 错误态存在 ✅ |
| 点「刷新」 | 展示本地内容 | 8 张卡片 ✅ |
| 点第一条动态 | 动态详情 | `#/feed?id=p1` ✅ |
| 点评论入口 | 评论详情 | `#/comments?id=p1`，评论页渲染 ✅ |
| 点图片 | 图片预览 | `#/media?post=p1&i=0` ✅ |
| 点群聊 | 群聊页 | `#/group?id=g1` ✅ |
| 打开 @ 面板 | 成员列表 | 7 项 ✅ |
| 扫码页等待 | 识别成功 | `done=true` ✅ |
| 升级弹窗 | 两个按钮 | 2 ✅ |

## 四、本轮设备端发现并修复的 3 个真实问题

### 问题 1：应用在设备上被渲染成「中间一条竖条」

**现象**：设备截图里应用只占屏幕中间约 430px 宽，两侧是灰边。

**根因**：屏幕逻辑显示是横屏 1920×1038，WebView 视口因此是 **1920 宽**；
而我在 `shell.css` 里写的"桌面浏览器预览手机壳"用的是 `@media (min-width: 560px)`，
在设备上被误触发（`max-width: 430px` + 居中 + 圆角阴影）。

**修复**：
1. Manifest 给 `MainActivity` 加 `android:screenOrientation="portrait"`（原版 app 也是竖屏）；
2. 手机壳样式加 `and (pointer: fine)` 约束——只有精细指针（桌面鼠标）才套壳。

修复后视口 = 618×1074（竖屏），应用铺满全屏。

### 问题 2：双状态栏

**现象**：设备截图顶部同时出现系统状态栏（`1:47`）和应用自绘的模拟状态栏（`9:41`）。
原版 app 只有系统状态栏。

**根因**：模拟状态栏本是为"浏览器预览像手机"设计的，打包进 APK 后没有关掉。

**修复**：`Shell` 通过 `window.Capacitor.isNativePlatform()` 判断运行环境，
原生壳下**不渲染**模拟状态栏，并把 `--h-statusbar` 置 0
（否则扫码页/图片预览这类用 `top: var(--h-statusbar)` 绝对定位的顶栏会多出一段空白）。

### 问题 3：`$pid` 变量名撞车导致调试通道建错

PowerShell 里 `$pid` 是只读自动变量，`$pid = ...` 赋值静默失败，
`adb forward` 就指向了不存在的抽象套接字（表现为 CDP 连接被立即关闭）。
改用 `$appPid` 即可。这类"赋值失败但不报错"的坑在排查时很费时间。

## 五、逐页截图证据

真实 APK 上的 22 个页面截图位于 `.mumu-capture/device/`：

```
campus.png  me.png  map.png  feed_id_p1.png  comments_id_p1.png
message.png  chat_id_t1.png  group_id_g1.png  board.png  daily.png
poi.png  poidetail.png  publish.png  scanner.png  login.png
loginselect.png  onboarding.png  announce.png  feedlist.png
media_post_p1_i_0.png  upgrade.png  more.png
statusbar-check.png（修双状态栏后的复查图）
```

抽查结论（vision 识别）：

| 截图 | 结论 |
|---|---|
| `me.png` | 个人主页渲染正常，无双状态栏 |
| `feedlist.png` | 网络错误页渲染正常（与原版一致的拦截态） |
| `scanner.png` | 深色扫码页正常，取景框与提示可见 |
| `group_id_g1.png` | 群聊页正常，群公告与消息列表完整 |
| `media_post_p1_i_0.png` | 图片预览正常（图为本地生成的渐变占位图，属预期） |
| `statusbar-check.png` | 顶部仅一条系统状态栏，内容铺满屏幕 |

## 六、复现方式

```powershell
# 1) 打包安装（含 web 构建 + cap sync + gradle + adb install）
& 'G:\demo map\tools\build-android.ps1'

# 2) 建立调试通道
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$appPid = (& $adb -s 127.0.0.1:16384 shell pidof com.campusx.demo | Out-String).Trim()
& $adb -s 127.0.0.1:16384 forward tcp:9222 "localabstract:webview_devtools_remote_$appPid"

# 3) 走查 + 截图
node 'G:\demo map\tools\device-walkthrough.mjs'
& 'G:\demo map\tools\device-shots.ps1'

# 4) 需要时在设备上执行任意 JS（表达式写在文件里，避免 shell 吞引号）
node 'G:\demo map\tools\device-eval.mjs' --file tools/checks/comments-entry.js
```
