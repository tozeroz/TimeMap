# 网页端（Web Frontend）

> 2026-09-24 起，本项目从「仅 Android APK」扩展为**双端**：手机端（APK）+ 网页端。

## 一、它是什么

**同一个前端产物，两种投放方式。**

| | 手机端 | 网页端 |
|---|---|---|
| 产物 | `app/dist` 打进 APK | **同一份** `app/dist` 托管到 nginx |
| 载体 | Capacitor WebView（`https://localhost`） | 浏览器（`https://8.148.156.146/`） |
| 地址 | 安装 `campus-demo-1.1.apk` | **https://8.148.156.146/** |
| 证书 | Let's Encrypt IP 证书（APK 信任 `system` CA） | 同一张证书 |

⭐ **关键认识**：本项目前端**本来就是 web 应用**（Vite + React）。
所谓"做网页端"，主要不是重写，而是**把它正式托管出去 + 逐项在真实浏览器里验证**。
`Shell` 组件也早就处理了"非原生"分支。

## 二、怎么部署

```powershell
powershell -File tools/deploy-web.ps1          # 构建 + 上传 + 修权限 + 冒烟
powershell -File tools/deploy-web.ps1 -SkipBuild   # 只上传
```

⚠️ **必须用这个脚本，不要手工 scp**。原因见下（权限那个坑）。

## 三、⭐ 踩过的坑（都写进脚本了，别退回去）

### 3.1 权限导致白屏（且能骗过简单检查）
`scp -r` 上传后目录变成 `drwx---rwx`（**组权限为 0**），而 nginx worker 是 `www-data`
（通过 `campus` 组访问）⇒ **无法进入目录** ⇒ `/assets/*.js` 全部 **403** ⇒ 页面白屏。

⚠️ 最坑的是：**`/` 与 `/index.html` 仍是 200**，所以"curl 首页看看通不通"**完全发现不了**。
⇒ `deploy-web.ps1` 里（a）目录 755 / 文件 644 分开设，（b）冒烟**必须查 `/assets` 下的真实 JS**。

### 3.2 缺 `#root` 也会"全绿"
我在精简 `index.html` 注释时**误删了 `<body>` 和 `<div id="root">`**。
部署后 `/` 仍是 200、`<title>` 也正常，**原有冒烟全绿** —— 但页面上什么都没有
（React `createRoot` 拿到 null，报 `React error #299`）。

⇒ 教训：**"HTTP 200 + 标题对"证明不了应用能挂载**。
现在冒烟里**显式断言**下发的 HTML 含 `<div id="root">`、`<body>`、module 入口脚本。

### 3.3 点文件与 ACME 的优先级冲突（会悄悄废掉证书续期）
改前 `location / { return 404; }` 顺手挡住了所有点路径；引入 SPA 后 `/` 变成静态托管。
新增 `location ~ /\.` 拒绝点文件时要注意：**nginx 的正则会盖过普通前缀匹配**，
于是 `/.well-known/acme-challenge/` 也会被拒 ⇒ **证书续期直接失效**。
⇒ ACME 那条改成 `^~`（命中后跳过正则）+ 正则里加 `(?!well-known)` 双保险。

## 四、⭐ 与原生端的差异（如实登记，不假装等价）

| 能力 | 网页端 | 说明 |
|---|---|---|
| 浏览广场 / 帖子详情 / 评论 | ✅ 可用 | 未登录也能浏览 |
| 登录（手机号 + 短信验证码） | ✅ 可用 | 与 App 同一套 API；未登录时 `/me` 如实显示未登录 |
| 发帖（文字） | ✅ 可用 | |
| 发帖（图片） | ✅ 可用 | 用文件选择控件（浏览器行为与原生相册选择器不同，但功能等价） |
| 发帖 / 聊天（语音） | ⚠️ 可用但需授权 | 浏览器录音走 `MediaRecorder`，**首次需用户授权麦克风** |
| 摄像头取景 / 拍照 | ⚠️ 需授权 | 已是 HTTPS（安全上下文），但浏览器**每次域名首次都需授权**；无摄像头设备时不可用 |
| 扫码（真实取景 + 解码） | ⚠️ 需授权 | 同上；桌面无摄像头时不可用 |
| 定位 | ⚠️ 需授权，精度不同 | 桌面浏览器定位精度通常远差于手机 |
| 应用内更新（下载 APK） | ❌ 不适用 | 网页端不需要装 APK；更新提示在网页端无意义 |
| 状态栏安全区适配 | ❌ 不适用 | 那套是给 Android 15+ edge-to-edge 用的（injected `--safe-area-inset-*`） |
| 缩放 | ✅ **放开** | ⚠️ 与原生相反：原生 `user-scalable=no`（避免误双击），**网页端必须允许缩放**（可访问性） |
| 桌面端外观 | ✅ 手机壳居中 | 宽屏 + 精细指针时套手机壳；**手机浏览器（粗指针）是满屏** |

⚠️ 上表中标 ⚠️ 的项：**功能路径存在且与原生同源**，但浏览器**固有的权限模型**决定了
它们是"需授权"而非"自动可用"。这是 web 平台的既有属性，不是本项目的缺陷。

## 五、怎么测试

⭐ **核心决策：复用既有门禁，而不是为网页端另写一套断言。**
既有 20+ 个门禁本来就是 **CDP + DOM 选择器**驱动的，编码的是"每个功能怎样才算正确"
（M5 的验收口径）。若为网页端另写一套，就会有两套口径、且必然随时间漂移。

```bash
bash scripts/m5/web/setup-web-session.sh          # 建立网页端已登录会话
bash scripts/m5/web/run-web-gate.sh scripts/m5/gate-wo11-feed-list.mjs   # 跑单个门禁（复用门禁）
bash scripts/m5/web/run-web-gate.sh scripts/m5/web/gate-web-login.mjs    # 跑单个网页端专属门禁
bash scripts/m5/web/web-gate-audit.sh             # 跑全量并分类
bash scripts/m5/web/selftest-web-gates.sh         # 网页端专属门禁的敏感度验证
bash scripts/m5/web/verify-atomic-deploy.sh       # 验证部署无空窗（原子切换）
```

### 5.0 当前实测结果（2026-09-24）

```
WEB_AUDIT: TOTAL=31 PASS=31 FAIL=0 SKIPPED=3
```

- **26 个复用门禁全部 exit=0**（含 feed / 用户资料 / 资料编辑 / 我的身份 / 地图标记 /
  留言板 / 校园 / 学校 / 帖子身份 / POI / 认证表单 / **发布媒体（含真实录音）** /
  **扫码 e2e** / **真实取景扫码** / 更新流程 / 标签栏 / 文字发送 / 消息列表 /
  群聊切片 / @面板 / 公告 / 编辑器覆盖 / 学院选择器 / 媒体预览权 / 扫码入口 …）
- **5 个网页端专属门禁 exit=0**（见 5.3）
- **3 个明确不适用**（各自写明理由，**不为了统一数字删掉** —— 审核方 Review 71 也明确认可这一口径）：
  | 不适用项 | 理由 |
  |---|---|
  | `gate-statusbar-inset.mjs` | Android 15+ edge-to-edge 专属；浏览器没有系统状态栏覆盖问题 |
  | `gate-wo23-update-check.mjs` | 其 `UPDATE_STRUCTURE_MATCHES_BASELINE` 断言弹窗结构含「立即更新」，而按 **P0 裁定**网页端**必须没有**该按钮 ⇒ 该结构断言在网页端必然为假（**这是 P0 修复的预期后果**）；其余键在网页端仍适用且此前 PASS，网页端契约由 `gate-web-update-platform.mjs` 覆盖 |
  | `gate-wo23-update-platform.mjs` | 原生端**对照侧**（断言原生**仍然有** APK 动作），与上面那条是**对称的一对** |
- 另有：`ATOMIC_DEPLOY: PASS`（部署期间 60 次采样无失败请求 + build-id 哨兵证明部署真发生）
- 另有：网页端专属门禁的**敏感度验证通过**（注入因**预期缺陷**变红、移除后回绿；三重判据见 5.3）
- ⚠️ 该结果**可复现**：曾因 Chrome 窗口被遮挡导致 rAF 节流而出现假 FAIL，已修（见 5.6）

⭐ **覆盖率是核对过的，不是"门禁全绿就算测过了"**：把前端路由清单
（`navigate()` 调用点）与门禁逐项对照后，发现 **`login` / `loginselect` 没有任何门禁覆盖**
（因为建立测试会话时是直接注入 token 绕过了登录 UI）⇒ 才补了 `gate-web-login.mjs`。

⭐ **平台语义也是核对过的，不是"门禁全绿就算对了"**：`gate-wo23-update-*` 按 APK 场景写，
在网页端曾**照样 PASS** —— 因为"网页端该不该有 APK 更新动作"不在其判据里。
这正是审核方点出的 **P0**；现已修，并补了**对称的一对**平台门禁（见 5.3）。
> 审核方 Review 71 的原话值得长期保留：
> 「**Gate 全绿只能证明"符合 Gate 写定的 contract"，
> 不能证明"这个 contract 对当前平台本身就是对的"**」

### 5.1 目标切换机制（为什么不需要改 62 个门禁文件）
门禁的 CDP 地址硬编码为 `http://127.0.0.1:9222/json`。我们**不给 62 个文件加参数**，
而是让网页端**也用 9222**：
- 设备门禁：`run-device-gate.sh` 用 `adb forward` 把模拟器 WebView 转到 9222
- 网页端门禁：`launch-web-chrome.sh` 先撤掉该转发（端口即释放），再让 Chrome 监听 9222

⇒ 靠"谁占着 9222"切换目标，**现有门禁一行都不用改**。
⚠️ 因此**不要并发**跑设备门禁与网页端门禁。
⚠️ `launch-web-chrome.sh` 会把"本次期望的启动参数"记在 profile 里；若 9222 上已有实例
   但参数不一致，会**重启**它 —— 避免"我改了 flag 却复用了旧实例"从而得出错误结论。

### 5.2 登录怎么来的（重要）
网页端要跑完整门禁必须先登录，而登录码现在走**真短信**，自动化读不到。

⭐ 方案：会话是 **bearer token、与来源无关**（服务端只认 `Authorization` 头）。
模拟器上的 App 早已登录，其 token 仍在有效期内 ⇒
`setup-web-session.sh` 从模拟器 App 读出 token，注入网页端 origin 的
`localStorage`（键名 `campus.demo.session.v1`，与 `app/src/api/session.ts` 一致）。

✅ 对真实用户**零影响**（不需要临时关闭短信投递）
✅ 不往生产代码里加任何"测试登录通道"（那才是真的安全债）
⚠️ 读出的 token 是明文，只落 `tools/tmp/`（`.gitignore` 已忽略），不打印完整值、不进仓库

### 5.3 网页端专属门禁（4 个，放 `scripts/m5/web/` 以免被设备审计误捡）
| 门禁 | 守什么 | 为什么它是网页端专属 |
|---|---|---|
| `gate-web-app-mount.mjs` | **应用真的挂载**（根节点存在、有子树、无挂载期异常） | 被我自己那个真实 bug 逼出来的：误删 `<body>` 与 `#root` 后 `/` 仍 200、title 正常、**旧冒烟全绿**，但页面空白（React error #299）⇒ "HTTP 200 + 标题对"证明不了能挂载 |
| `gate-web-cert-trust.mjs` | **公共信任 HTTPS + 同源 API** | 判据是"在页面内 fetch 同源 API"：证书不被信任时**浏览器**会拦截，而 curl 用系统 CA 库、失效模式不同 ⇒ 必须在真实浏览器里判定 |
| `gate-web-load-clean.mjs` | **加载干净**（无失败静态资源、无控制台 error、无未捕获异常） | 被那条 favicon 404 逼出来的：不影响功能，所以任何功能断言都发现不了；原生端也不会有（WebView 不发 favicon 请求） |
| `gate-web-login.mjs` | **登录流程**（协议门禁 / 手机号校验 / 真实调用链 / 失败不假装成功） | **覆盖率核对发现的缺口**：路由清单里 `login`/`loginselect` 一个门禁都没有，而登录是网页端第一道功能。用 CDP `Fetch` 域**拦截** `/api/auth/request-code` ⇒ **零短信成本、无需真验证码**即可验证真实调用链（含失败分支如实报错） |
| `gate-web-update-platform.mjs` | **App 更新的平台语义**：网页端**不得**提供 APK 自更新 | 审核方点出的 **P0**。⚠️ 原有 `gate-wo23-update-*` 按 APK 场景写，在网页端**照样 PASS**（"网页端该不该有这个动作"不在其判据里）⇒ 才需要这条。⭐ 用 CDP `Fetch` 域**注入"有更新"**，确定地覆盖最易漏的分支；其**对照侧**是原生端门禁 `gate-wo23-update-platform.mjs` |

**敏感度验证**（`selftest-web-gates.sh`）：基线绿 → 注入因**预期缺陷**变红 → 移除后回绿。
用**零风险注入**（坏页面放子路径 `/web-broken/`、`/load-broken/`，**不碰线上首页**），
并通过门禁的 `WEB_ENTRY_PATH` 参数指向它。

⭐**判据必须三重同时成立**（否则"变红"证明不了判别力）：
```
① 不能是「页面未就绪」兜底   ← 否则红的原因不是被测缺陷
② ON_WEB_ORIGIN == true      ← 排除"页面根本没打开"这类假红
③ 出现预期的缺陷特征          ← mount: ROOT_ELEMENT_PRESENT=false 等
```
⚠️ 其中 **③ 必须是"肯定式"特征**：我最初拿 `LOGINSELECT_REQUIRES_AGREEMENT`（"**没有**跳到登录页"）
这类**否定式**断言当判据，而它在"页面整个坏掉、什么都没发生"时**天然为真** ⇒ 会空虚通过。
现已给这类断言加**前置断言**（界面确实存在）并让其依赖前置成立。

### 5.4 为什么不适用项要显式登记，而不是删掉
`gate-statusbar-inset.mjs` 断言 Android 15+ edge-to-edge 的安全区注入——浏览器没有
系统状态栏覆盖问题，该逻辑在网页端**本就不应生效**。
⚠️ 若为了"跑绿"把它删掉，就会让"哪些没测、为什么没测"变得不可见。
⇒ 在 `web-gate-audit.sh` 的 `WEB_NOT_APPLICABLE` 表里**显式登记 + 写明理由**，
   并打印出来（不计入 PASS 总数）。

### 5.5 部署是**原子**的（并且这一点被验证过）

上传到**带时间戳的唯一暂存目录** → 服务器侧 `mv` 替换（同文件系统 rename 是原子的）。
⚠️ 原做法 `rm -rf $WEB` + 上传会让站点在上传期间**彻底为空** —— 这不是理论风险：
nginx error.log 里有实证（`directory index of "/srv/campus/web/" is forbidden`），
且其中一条来自**真实客户端 IP**。
验证脚本 `verify-atomic-deploy.sh` 在**部署进行中**持续采样并断言无失败请求，
同时用 **build-id 哨兵**证明"部署真的发生了"（否则"没有失败"在"什么都没做"时同样成立 ⇒ 空虚判据）。

### 5.6 ⚠️ 消除一个**环境抖动**：rAF 节流会让扫码门禁误报

**现象**：网页端两个扫码门禁突然 FAIL，detail 里 `frames: 0`（此前同一批门禁 PASS、frames 有 64）。

**逐项排除**（不是猜）：
```
摄像头    ：getUserMedia 拿到 640x480、readyState=4        ⇒ 正常
扫码页 <video>：videoWidth=1920、未暂停、readyState=4        ⇒ 正常
但         ：document.visibilityState="hidden"、hasFocus=false
且         ：200ms 内 requestAnimationFrame **回调 0 次**
```
⇒ 根因：**Chrome 窗口被其它窗口（如模拟器）遮挡 ⇒ rAF 被浏览器节流到 0**
⇒ 逐帧解码循环跑不起来 ⇒ `frames` 恒为 0 ⇒ 门禁**误判为功能缺陷**。

⚠️ 这是**环境抖动**，不是产品问题；但它会让"网页端全量审计"**不可复现**
（同一批门禁换个窗口遮挡状态结论就不同）—— 这比一次假 FAIL 更危险。

**修法（双保险）**：
1. `launch-web-chrome.sh` 用 Chrome 官方开关关掉三类节流：
   `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`
2. `run-web-gate.sh` 在跑门禁前用 CDP **`Page.bringToFront`** 主动把页签带到前台
   （日志会打印 `bringToFront 后 visibilityState = visible` 作为证据）

**实测**：修复后两个扫码门禁 `exit=0`，且 `SCANNER_DECODE_LOOP_RUNNING: PASS`、
`SCANNER_ENTERED_FOUND: PASS` ✓

---
## 六、已知限制 / 未做到的事

> ⚠️ 下面第 1、2、4 条的处置口径已由 **Review 70** 裁定（落盘 `docs/pending/review-log/70-wo25-web-release-pass-closed.md`）：
> 网页端发布本身 `PASS / CLOSED`；iOS 为 `KNOWN UNVALIDATED PLATFORM / NON-BLOCKING`；
> 布局为 `LAYOUT: (c) KEEP`；后续 Release 工作 `≠ WO#25`（另开工作单）。

1. **无域名 ⇒ 用户看到 IP**。正式运营仍需域名 + 备案（见 `docs/public/TLS-IP-CERTIFICATE.md`）。
2. **未在真实 iOS Safari 上实测**（裁定：`KNOWN UNVALIDATED PLATFORM / NON-BLOCKING`）。
   代码上无 iOS 专属依赖，且证书已是**公共信任**（这正是当初换掉私有 CA 的目的），
   但**没有真机验证过** ⇒ 记 `NOT_EVALUATED`，**不声称已支持 iOS**。
3. **桌面浏览器的摄像头/麦克风**在无相应硬件的机器上无法验证。
   本项目用 Chrome 官方**合成媒体设备**（`--use-fake-device-for-media-stream`）让
   同一条功能路径真的跑起来，从而验证应用逻辑而不是"这台机器有没有摄像头"。
   ⚠️ 代价如实标注：`--use-fake-ui-for-media-stream` 会自动同意权限弹窗
   ⇒ **"用户拒绝授权"这条分支无法用它覆盖**。
4. **桌面布局不改**（裁定 `LAYOUT: (c) KEEP`）：宽屏浏览器是"手机壳居中"
   （`pointer: fine` 才套），手机浏览器是满屏。这是**有意的选择**，不是未完成
   ⇒ 不再横向扩成桌面重设计。
5. **外部告警通道未接**（属证书监控 WO#24）：详见 `docs/public/TLS-IP-CERTIFICATE.md`。
6. **登录的"真实发短信 + 收码 + 建会话"那一段**不在 `gate-web-login.mjs` 内（该门禁记
   `INCONCLUSIVE`），由既有 `gate-sms-login.sh` 负责（遵守"只在提供测试号时才判定"的策略）——
   **不假装覆盖**。
