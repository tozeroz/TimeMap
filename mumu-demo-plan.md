# MuMu 模拟器 app 复刻任务 — 启动方案与阻塞项

> 记录时间：2026-09-12 00:31（Asia/Shanghai）
> 目标：用 MuMu 模拟器体验目标 app，做一个除数据 mock 外体验一致的 demo。

## 一、已实测确认的事实

### 1. MuMu 模拟器可以被程序完全控制（这是好消息）

- 安装目录：`G:\Program Files\Netease\MuMu`
- 控制工具：
  - `G:\Program Files\Netease\MuMu\nx_main\adb.exe`
  - `G:\Program Files\Netease\MuMu\nx_main\MuMuManager.exe`
- 实例信息（`MuMuManager.exe info -v all`）：
  - 名称「MuMu安卓设备」，index 0，Android 12，已启动（`is_android_started: true`, `player_state: start_finished`）
  - `adb_port: 16384`，另有 `emulator-5554`（127.0.0.1:5555）可用
  - 分辨率 1080x1920，density 280
- ADB 连接命令：`& 'G:\...\adb.exe' -s 127.0.0.1:16384 shell ...`（注意：存在两个设备句柄，必须带 `-s`）

### 2. 目标 app 已定位

- 包名：`com.kairuotu.campus`
- 版本：2.10.0，安装于 2026-09-12 00:11:22（用户刚装的）
- 当前前台 Activity：`com.kairuotu.trident.TridentActivity`
- 实测截图成功：`adb exec-out screencap -p` → `.mumu-capture/shot1.png`（1.11 MB，1080x1920）
- 同机的其他第三方包：`com.netease.EVE`、`com.heytap.market`、`com.bbk.appstore`（应用商店类，非目标）

### 3. 当前真实阻塞：视觉模型额度耗尽

- `vision` 工具（dsh-vision-any）调用报错：
  `vision provider error (HTTP 429): Monthly usage limit reached. Resets in 4 days.`
  工作区链接：https://opencode.ai/workspace/wrk_01M05A6HJSEFCGQB3T54K5AN68/go
- 即当前视觉链路走 OpenCode Go 的 `mimo-v2.5`，该账号**月度额度已用尽**。
- 影响范围：
  - `vision` 工具（读单张图）→ 完全不可用
  - DeepSeekEyes 的读图路由 → 同样会失败（它也用视觉模型读截图）
  - 因此 `computer` / `browser` 工具的「截图 → 模型理解」环节整体不可用

### 4. 另一条现成可用的视觉链路（不需要额度）

直接用 DeepSeek 官方 API 读图，已实测可用：

- 端点：`https://api.deepseek.com/chat/completions`（OpenAI 兼容）
- 模型：`deepseek-flash`（官方唯一支持 Vision 的模型；`deepseek-v4-pro` 不支持）
- Key：`.credentials.yaml` 里的 `DEEPSEEK_API_KEY`（sk-367...）
- 实测：128x128 红图 → HTTP 200，模型正确描述出颜色
- 官方文档：https://api-docs.deepseek.com/guides/vision
- dsh-vision-any 支持通过 `VISION_ANY_*` 环境变量或配置文件覆盖 provider，
  字段：`baseUrl` / `apiKey` / `apiKeyEnv` / `model`（见 vendor 包 `lib/config.js`）

### 5. 已知限制（DSH 适配器层）

`G:\deepseek harness\packages\llm\llm-deepseek\src\serialize.ts:63-68` 硬编码拒绝图片：
```ts
if (contentHasImage(blocks)) throw new LlmError('... does not support image content.', 'UNSUPPORTED_CONTENT')
```
所以 `deepseek-official` 这条 provider 路由无法作为 DeepSeekEyes 的读图 provider，
除非改 DSH 源码（路径 B）或另起一条 llm-pi-ai 路由（路径 A）。

### 6. uiautomator dump 目前失败

`uiautomator dump` 报 `ERROR: could not get idle state.`（多次重试，已关掉三个动画缩放设置）。
推测该 app 界面持续动画（或为 Flutter/游戏引擎渲染），拿不到稳定的无障碍树。
备用手段：`screencap` + 视觉模型（属 §3/§4 链路）。

## 二、已在 2026-09-12 00:34 修复：视觉链路（已实测通过）

`vision` 工具现在读图成功，实测读出了模拟器截图里的全部文字（Map / 北京市·海淀区 / 底部导航：自定义名称6、校园、地图）。

四处改动：

| 文件 | 改动 |
|---|---|
| `~/.dsh/profiles/web/cordis.patch.yml` | `vision` 插件行 → `baseUrl: https://api.deepseek.com`、`model: deepseek-flash`、`apiKeyEnv: DEEPSEEK_API_KEY` |
| `~/.dsh/settings.yaml` | `llm-pi-ai.providers` 新增 `deepseek-official-vision`（openai-completions 协议挂官方端点，模型声明 `input: [text, image]`） |
| `~/.dsh/settings.yaml` | `deepseekeyes.visionProvider` → `deepseek-official-vision` |
| `~/.config/dsh-vision-any/config.json` | 新建，直填 apiKey（icacls 已收紧到仅当前用户） |

备份：`settings.yaml.bak-20260912-visionroute`、`cordis.patch.yml.bak-20260912-vision`

**为什么必须新起一条 provider**：DSH 内置的 `deepseek-official` 路由在
`packages/llm/llm-deepseek/src/serialize.ts:63-68` 硬编码拒图（`UNSUPPORTED_CONTENT`），
而官方 `deepseek-flash` 本身支持 Vision。所以用 llm-pi-ai 重挂同一端点，只补图片能力。

### 仍需重启一次

`cordis.patch.yml` 属于启动期配置，改完要重启 `dsh web` 才生效
（`~/.config/dsh-vision-any/config.json` 那部分不用重启，它每次调用都重读）。

## 三、剩下要做的两件事

1. **重启 `dsh web`**（让 cordis.patch.yml 的 vision 改动生效）
2. **切换会话模型到 `DeepSeekEyes`**（会话级选择，配置文件改不了）
   - 之后 `computer` / `browser` 才会放行

## 四、待用户拍板的选项

- demo 技术栈：静态 HTML+JS ／ React+Vite ／ 其他
- 复刻范围：全部页面 1:1，还是先做核心几个页面跑通闭环

## 五、目标 app 初步观察（首张截图）

- 顶部标题：`Map`，定位栏：`北京市·海淀区 ▼`，右上角聊天气泡图标
- 主体：腾讯地图（左下角水印），带悬浮内容卡片
- 底部导航：`自定义名称6` / `校园` / `地图`（当前选中「地图」）
- 右下角：定位复位箭头 + 黑色圆形加号按钮

## 六、2026-09-12 00:47 通道验证结果（全部通过）

computer use 已放行（会话已切到 DeepSeekEyes 虚拟 provider），三条控制通道实测：

| 通道 | 结果 | 证据 |
|---|---|---|
| adb 连接 | ✅ | `-s 127.0.0.1:16384`，Android 12 / 1080x1920 / density 280 |
| adb 点击 | ✅ | `input tap 389 1815` → 地图页切换为「校园广场」瀑布流（截图 1.38MB vs 224KB） |
| adb 拖拽 | ✅ | 地图从「中央民族大学（海淀校区）」平移到「万寿寺 / 中国青年政治学院」 |
| computer 观测 | ✅ | 桌面 9 个窗口，MuMu 窗口 ref `win_e11f2b111401`；窗口观测返回 734x1336 截图 |
| vision 读图 | ✅ | 走 DeepSeek 官方 `deepseek-flash`，能逐字读出界面文字 |

### 三条页面已探明

1. **地图页**（`Map`）：腾讯地图底图 + 头像标记 + 底部导航。首次进入有「授权地理位置」弹窗，
   按钮「暂时不要」约在 (430,1205)，关掉后才能拖动地图。
2. **校园页**（`Campus` / 校园广场）：双列瀑布流社区动态，含用户头像、昵称、图文。
   动态里有「记录今天的小事」式的发布入口。
3. **个人页**（`自定义名称6`）：用户头像、用户名、`我的兴趣 >`、`我的标签 >`、
   `介绍一下自己～ >`、`我的学校 >`、`编辑资料` 按钮、`记录今天的小事` 发布按钮。

底部导航：`自定义名称6`(约 x=164) / `校园`(约 x=389) / `地图`(约 x=587)，y 均约 1815；
右下角另有黑色圆形 `+` 悬浮按钮。

## 七、需求已确认（2026-09-12）

| 维度 | 决定 |
|---|---|
| 交付形态 | 可安装 APK，能 `adb install` |
| 技术路线 | Capacitor + Web 前端打包 |
| 复刻范围 | 全 app 所有页面 |
| 数据 | 完全 mock，真实感内容 |
| 网络 | 纯本地，无后端 |
| 机型适配 | 主流机型即可，不必照搬 1080x1920 |

启动提示词见 `kickoff-prompt.md`。

## 八、本次产生的临时文件

- `.mumu-capture/shot1b.png` — 首屏截图（有效版本）
- `.mumu-capture/cur.png`、`tab-campus.png`、`t1after.png`、`map-*.png`、`drag-*.png`
  — 通道验证过程截图
- `probe-red.png` / `probe-deepseek-vision*.mjs` — 已删除，仅用于验证 DeepSeek 官方 API 的图片支持

