# 启动提示词：复刻 com.kairuotu.campus 为可安装 APK

> 用法：新开 DeepSeekEyes 会话，把下面整个代码块内容粘进去。
> 生成时间：2026-09-12 00:48（Asia/Shanghai）

```text
# 任务：把安卓 app「com.kairuotu.campus」完整复刻成一个可安装的 APK demo

## 一、最终目标
在 MuMu 模拟器上逐屏体验目标 app，逆向出它的全部界面与交互，
做出一个除数据完全 mock 外、体验尽可能一致的安卓 app，最终产出可
`adb install` 安装的 APK 包。

## 二、环境（已全部验证可用，直接用）

### 模拟器控制
- MuMu 12，Android 12，1080x1920，density 280，已在运行
- ADB 路径（不在 PATH 上，必须写全路径）：
  `G:\Program Files\Netease\MuMu\nx_main\adb.exe`
- **必须带 -s 指定设备**（机器上有两个设备句柄，不带会报 more than one device）：
  `& 'G:\Program Files\Netease\MuMu\nx_main\adb.exe' -s 127.0.0.1:16384 shell ...`
- 实例管理：`G:\Program Files\Netease\MuMu\nx_main\MuMuManager.exe info -v all`

### 目标 app
- 包名 `com.kairuotu.campus`，版本 2.10.0
- 前台 Activity：`com.kairuotu.trident.TridentActivity`
- 注意：**不要卸载或修改目标 app**，它是唯一参照物

### 工作目录与已有资料
- 工作目录：`G:\demo map`
- `G:\demo map\mumu-demo-plan.md` —— 环境勘察记录（含下方所有坑点）
- `G:\demo map\.mumu-capture\` —— 截图目录

## 三、控制通道（三条，按用途选）

### 1. adb 输入 —— 【首选】最可靠，坐标是设备像素
```
& $adb -s 127.0.0.1:16384 shell input tap X Y              # 点击
& $adb -s 127.0.0.1:16384 shell input swipe X1 Y1 X2 Y2 毫秒  # 拖拽/滑动
& $adb -s 127.0.0.1:16384 shell input text "abc"            # 输入文本
& $adb -s 127.0.0.1:16384 shell input keyevent 4            # 返回键
```
已验证：点击切页 ✅、地图拖拽 ✅、弹窗按钮 ✅

### 2. 截图 —— 【铁律，务必遵守】
**不要**用 `adb exec-out screencap -p > file.png`：
PowerShell 会写成 UTF-16LE 损坏文件（首字节 FF FE FD FF，正常 PNG 是 89 50 4E 47），
模型读不出图，会误判成「图片格式不支持」。
正确做法：
```
& $adb -s 127.0.0.1:16384 shell screencap -p /sdcard/x.png
& $adb -s 127.0.0.1:16384 pull /sdcard/x.png 'G:\demo map\.mumu-capture\x.png'
```

### 3. computer 工具 —— 桌面级窗口观测/控制
- MuMu 窗口 ref 会变，先用 `observe` + `scope:"desktop"` 拿当前窗口列表
- 窗口内 Android 画面有黑边，坐标需要换算，**优先用 adb 输入**，
  computer 工具主要用于「截取整个窗口」和「在 DSH 界面/其他原生窗口上操作」

### 4. 读图 —— vision 工具
已切到 DeepSeek 官方 `deepseek-flash`，可直接读本地 PNG 路径。
一次可传多张图做前后对比。**判断「点击有没有生效」的可靠办法**：
前后各截一张图，让 vision 对比内容变化（文件大小对比也可作为快速信号）。

## 四、已知坑点（都踩过，别再踩）
1. `uiautomator dump` 对该 app 报 `could not get idle state`（界面持续动画），
   无障碍树拿不到 → **只能靠截图 + vision 识别界面**，不要在这上面浪费时间。
2. 地图页首次进入会有「授权地理位置」弹窗，
   点「暂时不要」(约 430,1205) 关掉后才能拖动地图。
3. 用 PowerShell 比较两次 ADB 命令输出时不要用 `(cmd1; cmd2)` 括号包裹分号，
   会解析失败；拆成多行写。
4. 抓完的图要 `adb shell rm` 清理设备端 `/sdcard/*.png`。

## 五、产品需求（用户已确认）

| 维度 | 决定 |
|---|---|
| 交付形态 | **可安装的安卓 APK**，能 `adb install` 到模拟器/真机 |
| 技术路线 | **Capacitor + Web 前端**（HTML/CSS/JS 或框架），最后打包成 APK |
| 复刻范围 | **全 app 所有页面**，不是抽样 |
| 数据 | **完全 mock**，但要用**真实感内容**（真实地名、像样的昵称与动态文案） |
| 网络 | **纯本地**，不联任何后端 |
| 机型适配 | 适配主流机型即可，**不必**照搬模拟器的 1080x1920 |
| 一致性标准 | 除数据外，界面布局、配色、图标风格、交互手感、动效尽量一致 |

## 六、工作流（分阶段，每阶段结束向我汇报并等确认）

### 阶段 1：全量勘察（先做这个，不要急着写码）
- 逐页访问，每页产出：截图 + 逐字文字清单 + 可点击控件及其像素坐标
- 用 adb `input tap` 遍历底部导航与各入口，进入每个二级/三级页面
- 记录交互细节：转场动画、下拉刷新、上滑加载、手势、Toast、
  Loading/空态/错误态、弹窗、按钮按压反馈
- 产出 **页面地图**（Page Map）：页面名、入口、出口、跳转关系、
  每个页面需要的 mock 数据字段
- 汇报前先自查：是否还有未探索的入口

### 阶段 2：需求确认（等我拍板）
- 把页面地图 + 交互清单 + mock 数据设计给我确认
- 我确认后才能进入实现阶段

### 阶段 3：实现
- 先在浏览器里把 UI 快速迭代到位（Capacitor 的 web 层）
- 数据收敛到独立的 mock 数据文件，方便替换
- 再 `cap add android` + 打包 APK

### 阶段 4：验证
- `adb install` 到模拟器，逐页截图
- 与原始 app 截图**并排对比**，产出三张清单：
  「已还原」/「有差异（附原因）」/「未实现（附原因）」

## 七、交付物
1. 源码（`G:\demo map\` 下，结构清晰）
2. 可安装的 APK 文件
3. 对比报告：每页原版截图 vs demo 截图
4. 页面地图文档 + mock 数据说明

## 八、尚未具备的环境（到时再装）
本机目前**没有 Android SDK / Gradle**（JDK 21 有，Node/pnpm 有）。
打包阶段需要下载 Android cmdline-tools + platform-tools + build-tools
（约 1-2 GB）。到时候先问我，不要直接开始下载大文件。

## 九、沟通要求
- 全程用中文
- 每完成一个阶段先汇报，不要一口气做完再交
- 遇到不确定的界面行为，截图问我，不要猜
```

## 附：本次验证记录的通道可用性

| 通道 | 状态 | 证据 |
|---|---|---|
| `computer` 工具（桌面观测） | ✅ 可用 | 观测到 9 个窗口，MuMu 窗口 ref `win_e11f2b111401` |
| adb 连接 | ✅ 可用 | `127.0.0.1:16384`，Android 12，1080x1920 |
| adb 点击 | ✅ 可用 | 点 (389,1815) → 地图页切到「校园广场」瀑布流 |
| adb 拖拽 | ✅ 可用 | 地图从「中央民族大学」平移到「万寿寺/中国青年政治学院」 |
| vision 读图 | ✅ 可用 | 走 DeepSeek 官方 `deepseek-flash` |
