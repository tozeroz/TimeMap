# G3 收口：`NATIVE_FILE_PICKER_INTERACTION` 真机端到端验证结果

> 时间：2026-09-21 19:20–19:22（Asia/Shanghai）
> 分支：`fullstack`　设备：MuMu 模拟器 `127.0.0.1:16384`（Android 12 / SDK 32，1080×1920，280dpi）
> 被测 App：`com.campusx.demo`　账号：种子用户 **Lemy（+8613800000002 / 22222222-2222-4222-8222-222222222222）**
> 会话：`66666666-cccc-4ccc-8ccc-000000000003`（ChatScreen）

## 一、结论（证据分层命名，永久分列，不合并表述）

```
FILE_INPUT_POST_SELECTION_E2E:  PASS        （已知；由 device-chat-image-check.mjs 产出，本次未重跑、未改动）
NATIVE_FILE_PICKER_INTERACTION: PASS        ← 本次产出
```

本次**没有**使用 `DOM.setFileInputFiles`，也**没有**用页面内合成 `File` 的方式；
`NATIVE_FILE_PICKER_INTERACTION` 指的是：**点 App 里真实的"选图"入口 → 系统原生选择器真的弹出 →
在选择器里真的点中我推的那张图 → 产品链路（上传 / 发消息 / 渲染）跑完**。

**不得**把这层写成"真实用户完整选图 E2E"：触摸是 CDP 注入的（见 §六"未覆盖/边界"）。

## 二、APK revision（可独立复核）

```
versionName=1.0   versionCode=1   minSdk=24   targetSdk=36
firstInstallTime = 2026-09-21 16:58:19
lastUpdateTime   = 2026-09-21 18:31:23
设备上已安装      /data/app/~~KHihbtUvIxE25V5vJYvSog==/com.campusx.demo-60FI0qG2697jXHcpK7xCiw==/base.apk
                  sha256 2860b6bc328ef7d9b815e2e35e5232e8620fdfa0459be3439276a1ba927dd7b3
本地构建产物      app/android/app/build/outputs/apk/debug/app-debug.apk  11 614 147 字节  2026-09-21 18:31:24
                  sha256 2860b6bc328ef7d9b815e2e35e5232e8620fdfa0459be3439276a1ba927dd7b3
```

两个 SHA256 **完全相同** → 本次验证跑的确实是那个本地构建产物（不是"猜的版本号"）。
哈希用 `adb shell sha256sum <设备上的 base.apk>` 取得，**没有把 APK 拉回本地**。

## 三、链路证据（逐项原文）

### 1. 真的点到了 App 里的"选图"入口（CDP 坐标触摸）

入口是 `ChatScreen.tsx` 里那个铺满 label 的 `<input type="file" class="chatbar__file">`
（`accept="image/*"`、`opacity:0`、`inset:0`）。取它的 `getBoundingClientRect()` 中心：

```
选图入口 rect={"x":530,"y":1029,"w":36,"h":36} → 点击坐标 (548, 1047)
accept=image/*  disabled=false  dpr=1.75  viewport=618x1074
touchStart=ok touchEnd=ok
```

用的是 `Input.dispatchTouchEvent`（真实触摸事件类型），**不是** `element.click()`。

### 2. 系统选择器**真的出现了**（在 App 自己的任务栈里）

点击后轮询 `dumpsys activity activities`，命中那一行原文：

```
topResumedActivity=ActivityRecord{cafe989 u0 com.android.documentsui/.picker.PickActivity t277}
```

判据是 `topResumedActivity` **原文**，不是 `am start` 的打印（本项目已确认"打印 Starting ≠ 活动真起来了"）。
另外：任务栈 id `t277` 与同一时刻 App 的 `com.campusx.demo/.MainActivity t277` **是同一个** ——
说明这个 picker 是**我们的 App 拉起来的**，不是我另起一个 `am start` 造的。

### 3. picker 控件树被完整采到，并在树里**按文件名**找到我推的那张图

原始产物（入库）：`docs/pending/m5/evidence/native-picker-tree-20260921-192105.xml`（94 468 字节，
含 `documentsui` 370 处、23 种 `com.android.documentsui:id/*` 控件 id）。
命中节点**原文**：

```
<node index="3" text="" resource-id="" class="android.widget.LinearLayout" package="com.android.documentsui" content-desc="m5-picker-probe-20260921.png, 7.09 kB, 下午7:05" checkable="false" checked="false" clickable="false" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[715,531][925,742]">
```

**必须按文件名找，不能按位置点**：设备上还躺着别人的 `m5-wo2.png`、`native-picker-*.png`、`c*.png`……
而且同一次点击坐标在两次尝试里落点不同（冻结那次是 `bounds="[42,531][252,742]"`，
本次是 `[715,531][925,742]`）——"点第一格"证明不了点的是谁。

### 4. 真的在 picker 里点了那张图（系统级 `adb shell input tap`）

```
TAP_COORDS=820,636  (bounds [715,531][925,742] 的中心)
TAP_COMMAND=adb -s 127.0.0.1:16384 shell input tap 820 636
TOP_AFTER_TAP=topResumedActivity=ActivityRecord{a89e6e1 u0 com.campusx.demo/.MainActivity t277}
PICK_OK 点击生效：picker 已不在前台（用时 1s）
```

### 5. 产品链路跑完（CDP Network 实测状态码 + DOM 实测渲染）

```
POST https://8.148.156.146/api/media                                     → 201
POST https://8.148.156.146/api/threads/66666666-...-000000000003/messages → 201
GET  https://8.148.156.146/api/media/182638f2-f1d1-447b-8440-bc060d30e053 → 200  (image/png)
```

响应体（原文，来自 `Network.getResponseBody`）：

```json
POST /api/media  → {"id":"182638f2-f1d1-447b-8440-bc060d30e053","storageKey":"2026/09/182638f2-f1d1-447b-8440-bc060d30e053.png","mime":"image/png","bytes":7088,"width":640,"height":360,"scope":"private"}
POST /messages   → {"id":"61b234f8-bba8-46ba-aaee-30d544c501cd","kind":"image","mentions":[],"mediaId":"182638f2-f1d1-447b-8440-bc060d30e053"}
```

`bytes=7088 / 640x360` 与本地生成的测试图完全一致 → 服务端收到的是**我们点的那张**。

界面侧（DOM 实测）：

```
点击前：气泡 2 个、图片 1 张
点击后：气泡 3 个、图片 2 张
新气泡内图片 naturalWidth = [640]   （> 0，真的解码渲染出来了）
input.files.length = 0              （产品的 onChange 已把 input 清空，可再选同一张）
input 收到的文件 = {"name":"m5-picker-probe-20260921.png","size":7088,"type":"image/png"}
页面无 "发送失败" 文案
```

完整机器可读报告：`docs/pending/m5/evidence/native-picker-report-20260921-192111.json`
运行日志：`docs/pending/m5/evidence/native-picker-run-log-20260921-192111.txt`

## 四、清理结果（自己服务器的残留 + 设备上的临时文件）

按 id 精确删除本次产生的对象（**先取 `storage_key` 再删行**，否则盘上文件会变成 orphan）：

```
清理前：该线程消息 3 条；待删消息 1 / 媒体 1；全局 messages 5 / media 8
盘上相对路径：private/2026/09/182638f2-f1d1-447b-8440-bc060d30e053.png
已删文件：/srv/campus/uploads/private/2026/09/182638f2-f1d1-447b-8440-bc060d30e053.png
清理后：该线程消息 2 条；残留消息 0 / 残留媒体 0；全局 messages 4 / media 7
```

复跑同一脚本（幂等性验证）：`待删消息数 0 / 待删媒体数 0`，计数不再变化。

`node dist/cleanup.mjs --json`（dry-run）原文：

```json
{"mode":"dry-run","scanned":7,"referenced":7,"tooNew":0,"orphans":[],"totalBytes":0,"unattachedMaxAgeHours":24,"unattached":[],"unattachedTotalBytes":0,"unattachedMissingFile":0}
```

`orphans` 与 `unattached` **均为空**。与 19:09:46 的库基线（`docs/pending/m5/evidence/db-counts-before-picker-e2e.txt`：
messages 4 / media 7 / message_media 1 / users 10）一致。

设备上删掉本次推的测试图与临时产物（含 `m5-picker-probe-20260921.png`、各 dump/screencap）。

**故意没删**（不是本次产生的，不在我的范围内）：
`/sdcard/Download/m5-wo2.png`（18:32，别人推的）、`/sdcard/picker-probe.xml`（只读探测留下的）、
以及数据库里线程内的消息 `eb4476f4-de27-47d0-bad3-32ae43738b84` + 媒体 `f31bfcfb-82b7-403d-b835-399db1babb68`
（18:38 留下，media 尺寸 96×64 —— 与 `device-chat-image-check.mjs` 的"方式 B 合成图"一致）。
**这些残留会让计数类断言出错，请审核方决定是否清理。**

## 五、过程中的一次真实失败，以及它差点造成的误判（重要）

**第一次尝试（19:06–19:09）点击后 picker 确实弹出了，但我 `adb shell input tap` 点了三次都没反应。**
当时的完整症状：

- `dumpsys`：picker 一直是 `topResumedActivity`，`mCurrentFocus` 也是 picker
- `uiautomator dump`：正常返回 94 KB 的 picker 控件树，目标图就在里面
- 但 `input tap` / `input swipe` / `input keyevent 3`（HOME）**全部无效**，甚至
  `input keyevent 26`（POWER）都不改变 `mWakefulness`
- 相隔 2 分钟的两张 `screencap` **SHA256 逐字节相同**（连状态栏时钟都没变）

也就是说：**AMS 认为 picker 在前台，但合成器不产帧、输入注入被丢弃 —— guest 整体卡死了。**
`adb reboot` 之后一切正常，同一条链路一次通过。

**如果当时就下结论，就会写出"系统选择器弹得出但点不动 → 不可自动化"，这与事实相反。**
（本项目的 `app/android/app/src/main/AndroidManifest.xml` 里早就记过同类现象：
"模拟器上曾出现 WebView 渲染线程卡死……表现为界面冻结、点击无响应；force-stop 后重新启动可恢复"。）

为此新增了两个工具，**建议任何 UI 自动化之前先跑健康探针**：

- `scripts/m5/device-health-probe.ps1` —— 判据 A：下拉通知栏后焦点窗口必须变成 `NotificationShade`
  （输入确实送达）；判据 B：通知栏展开那一帧与之前 `screencap` 的哈希必须不同（屏幕确实在重绘）
- `scripts/m5/focus-mumu-window.ps1` —— 把 MuMu 主机窗口置前（本次证明**不是**窗口失焦导致的，但保留作排查手段）

探针自身也踩过两个坑，已在文件里写明：判据 A 不能拿**整段 dumpsys** 去 `-match 'systemui'`
（全文到处是 `com.android.systemui`，恒真）；判据 B 必须在通知栏**还开着**时截图
（收回后再拍，画面回到原样，两张图本就该相同 → 假阴性）。

## 六、未覆盖 / 边界（如实列出，避免高估本结论）

1. **触摸是 CDP 注入的，不是手指**：App 内的点击用 `Input.dispatchTouchEvent`。
   它走 Chromium 自己的输入管线（因此能触发 file chooser），但**不经过 Android InputDispatcher**。
   这恰好解释了 §五：CDP 触摸能弹 picker，而系统级 `input tap` 当时被吞掉。
   picker **内部**的点击是系统级 `adb shell input tap`（真实注入），这一半是"真手"。
2. **未验证"手指点击入口"**：真人手指点 `.chatbar__file` 是否同样弹 picker，本次没有验证（需要人工或主机级鼠标注入）。
3. **恢复了设备状态**：为排障执行过一次 `adb reboot`，并以 `monkey` 重新拉起 App
   （会话在 localStorage 里，重启后仍是 Lemy；未登录过任何新账号）。
   `adb reboot` 会打断同设备上其它在飞的自动化 —— 本次执行时设备处于卡死状态，无更好的选择。
4. **未强停第三方原版 App**：全程没有 `force-stop com.kairuotu.campus`，也没有对它做任何读写。
5. **服务端未改动**：没有动 `server/`、没有动 nginx、没有引入 Capacitor 插件。
6. **只验证了一条路径**：单图选择（`GET_CONTENT` 单选、`OPENABLE`、`image/*`）。
   多选、拍照、非图片文件、取消选择（BACK）等分支未验证。
7. **媒体索引依赖**：推图后 `MediaStore` 一开始**没有**索引到它（Android 12 上
   `MEDIA_SCANNER_SCAN_FILE` 广播已不生效），是用
   `content call --uri content://media/ --method scan_file --arg <path>` 才让它出现在 picker 里的。
   这一步失败时 picker 里不会有这张图 —— 属前置条件，不等于选择器不可用。

## 七、本次新增的可复现工具（都在 `scripts/m5/`）

| 文件 | 作用 |
| --- | --- |
| `native-picker-e2e.mjs` | CDP 侧主流程：装探针 → `Input.dispatchTouchEvent` 点真实入口 → 等双 201 + DOM 断言 → 落盘 JSON 报告 |
| `pick-image-in-picker.ps1` | picker 侧主流程：dump 控件树存证据 → 按文件名找节点 → `input tap` 节点中心 → 轮询前台确认返回 App |
| `wait-for-picker.sh` | 轮询 `topResumedActivity` 直到指定活动成为前台（判据是原文，不是 `am start` 的打印） |
| `cleanup-native-picker-residue.sh` | 远端精确清理（先取 storage_key 再删行）+ orphan dry-run |
| `device-cleanup-native-picker.sh` | 删设备上本次的测试图与临时产物 |
| `make-picker-test-image.ps1` | 生成带文件名水印的测试图（便于在 dump 里按名字定位） |
| `device-health-probe.ps1` / `focus-mumu-window.ps1` | 动手前的健康检查（见 §五） |
| `cdp-forward.ps1` / `cdp-eval.mjs` | CDP 转发（冷启动后 pid 变必须重建）与"表达式从文件里读"的求值小工具 |
| `run-remote-script.ps1` | 把本地 `.sh` 用 base64 原样送到远端执行（避免三层引号解析） |

两个环境坑，写给后来人（都在文件注释里）：

- Windows PowerShell 5.1 读**无 BOM** 的 UTF-8 `.ps1` 会按 GBK 解码 → 中文注释把语法解析搞坏。
  仓库既有 `.ps1` 都带 BOM；`edit` 工具**会丢掉 BOM**，改完要补回。
- Git Bash（MSYS2）会把 `/sdcard/xxx` 这类参数改写成 Windows 路径 → `adb` 收到本地路径、`rm` 静默失败。
  要在脚本里 `export MSYS_NO_PATHCONV=1`。

## 八、关于 0 字节产物（给核验器的说明）

`docs/pending/m5/evidence/native-picker-tree-20260921-190712-FAILED-0byte.xml` 是 **0 字节**，**是失败产物**：
第一次抓树时我把 `uiautomator dump` 写进了 Git Bash 脚本（`... >/dev/null 2>&1` 掩盖了错误），
拿到的是空文件；改成直接从 PowerShell 调用后正常（94 KB）。文件已重命名以显式标注失败，
**没有用一个空文件冒充"抓到了树"**。本次真正作为证据的是 `native-picker-tree-20260921-192105.xml`。
