# 页面地图（Page Map）—— 目标 app 全量勘察结果

> 数据来源：目标 APK 的 `assets/therouter/routeMap.json`（25 条路由）+ MuMu 模拟器逐页截图 + vision 识别。
> 勘察时间：2026-09-12

## 一、路由清单（来自 APK，权威）

APK 内置 TheRouter 路由表，`campusx://` scheme 可直接用
`adb shell am start -a android.intent.action.VIEW -d "<uri>"` 打开任意页面，
这是本次勘察能高效完成的关键。

| scheme | Activity | 是否页面 |
|---|---|---|
| `campusx://trident` | `TridentActivity` | ✅ 主容器（含个人/校园/地图三个 tab） |
| `campusx://map` | `TridentActivity` | ✅ 同上，定位到地图 tab |
| `campusx://feed/list` | `FeedActivity` | ✅ 校园圈（列表） |
| `campusx://feed/daily` | `DailyFeedListActivity` | ✅ 今日打卡 |
| `campusx://feed/detail` | `FeedDetailActivity` | ✅ 动态详情 |
| `campusx://feed/comment/detail` | `CommentDetailActivity` | ✅ 评论详情 |
| `campusx://messageBoard` | `MessageBoardActivity` | ✅ 留言板 |
| `campusx://poi/search` | `CampusPoiSearchActivity` | ✅ 地点搜索/选点 |
| `campusx://feed/poi/detail` | `PoiDetailActivity` | ✅ 地点详情 |
| `campusx://publish_post` | `PostActivity` | ✅ 发布（相机） |
| `campusx://message` | `MessageActivity` | ✅ 聊天列表 |
| `campusx://chat` | `ChatActivity` | ✅ 单聊 |
| `campusx://group` | `GroupChatActivity` | ✅ 群聊 |
| `campusx://announce` | `AnnounceActivity` | ✅ 群公告 |
| `campusx://webview` | `WebViewActivity` | 通用 webview 容器 |
| `campusx://scanner` | `QrCodeScannerActivityV2` | 扫码 |
| `campusx://login/select` | `CampusLoginActivity` | ✅ 登录选择 |
| `campusx://login/sns` | `CampusSnsLoginActivity` | ✅ 手机号登录 |
| `campusx://login/onboarding` | `CampusOnBoardingActivity` | ✅ 新手引导 |
| `campusx://main` | `MainActivity` | 入口 |
| `campusx://upgradeAlert` | `AppUpdateDialogActivity` | 升级弹窗（技术页） |
| `campusx://groupchat/invitePage` | `LinkJoinGroupBridgeActivity` | 入群桥接（技术页） |
| `campusx://chat/media-preview` | `ChatMediaPreviewActivity` | 图片预览 |
| `campusx://group/atPanel` | `GroupAtPanelActivity` | @面板 |

## 二、已确认的页面结构

### 1. 主容器（trident）——底部三 tab + 悬浮发布

- **校园广场**（默认 tab）
  - 顶部：大标题 `Campus` + 副标题 `校园广场 ▼` + 右上消息气泡
  - 内容：**双列瀑布流**卡片（图 + 文案 + 作者头像/昵称 + 点赞数/评论数）
  - 底部导航：`自定义名称6`（猫爪图标）/ `校园`（@ 图标）/ `地图`（地图图标）
  - 右下角：黑色圆形 `+` 悬浮按钮
- **个人页**（tab1，标签名来自用户昵称「自定义名称6」）
  - 顶栏：菜单图标、分享图标、右侧消息图标
  - 用户区：左「我的兴趣 ›」「我的标签 ›」；中间头像 + 昵称 + 「编辑资料」；右「介绍一下自己～ ›」「我的学校 ›」
  - 中部：黑色胶囊按钮「拍下眼前的风景 🖼️」+ 蓝色气泡「快来试试吧～」
  - 「我的动态」九宫格
- **地图页**
  - 顶部：大标题 `Map` + `北京市·海淀区 ▼` + 右上消息图标
  - 主体：地图（原版为腾讯地图）+ 用户头像标记 + 深色气泡卡片（如「在东子买了一杯 / 一天好，不开心」）
  - 首次进入有阻断式弹窗：**「授权地理位置」/「在地图上，标记属于你的校园生活」/ 按钮「暂时不要」「授权」**
  - 右下角：定位复位按钮 + 黑色圆形 `+`

### 2. 校园圈（feed/list）
- 顶部 `校园圈` + `北京交通大学 ▼` + 左上关闭
- 本机实测返回「网络错误 / 网络不给力，点击刷新试试 / 刷新」——说明该页强依赖后端

### 3. 今日打卡（feed/daily）
- 顶部返回 + 分享
- 上半：黄色品牌图（Campus），下半灰白内容区

### 4. 留言板（messageBoard）
- 顶部 `留言` + 副标题 `仅双方可见`
- 主体：彩色便签式留言列表
- 底部：表情行 `😂 👑 ❤️ 👀 😱 +1` + 输入框提示语 `可以给同学留言噢` + 按钮 `留言`

### 5. 地点搜索（poi/search）
- 左上关闭、右上 `确认`
- 搜索框提示语 `搜索地点`；列表首项 `不添加地点`
- 列表项：`北京交通大学 / 西直门外上园村3号`、`北京交通大学教学楼8号楼`、`北京交通大学交通运输学院`

### 6. 发布（publish_post）
- 相机取景界面：左上关闭、顶部 `📍北京交通大学 ×`
- 底部：变焦 `1x / 2 / 5`；模式 `语音 / 拍摄 / 文字`；快门按钮

### 7. 聊天列表（message）
- 顶部 `聊天` + 左上关闭 + 右上加号
- 邀请卡：`分享我的校园卡` / `邀请同学一起加入 Campus!` / 按钮 `邀请同学`
- 「更多同学」列表，项结构：昵称 + `相同学校` 标签 + MBTI/星座 + 学院-专业 + 年级
  - 例：`Azur冰弦 / INFP 天秤座 / 软件学院-软件工程 / 硕士一年级`

### 8. 单聊（chat）
- 顶部昵称 + 返回 + 更多
- 底部输入框提示语 `发消息...`，含表情与加号按钮

### 9. 手机号登录（login/sns）
- 标题 `输入手机号`，区号 `+86`，输入框，按钮 `获取验证码`

### 10. 新手引导（login/onboarding）
- 品牌图 + 简介

### 11. 其他
- 群公告（announce）、评论详情（comment/detail）需带参数，直接打开为空态

## 三、设计令牌（截图采样）

| 项 | 值 |
|---|---|
| 页面背景 | `#f7f8fa` |
| 卡片/顶栏/底栏背景 | `#ffffff` |
| 主文字 | `#101010` |
| 次要文字 | `#4a4a4a` |
| 弱化文字 | `#949499` |
| 分隔线 | `#ececee` |
| 主色（黑） | `#111111` |
| 强调蓝 | `#3b6ef5` |
| 危险红（点赞） | `#f5453b` |
| 卡片圆角 | 16px |
| 手机基准 | 1080×1920 @ 3x → 360×640 CSS px（demo 用 430×932 适配主流机型） |

## 四、demo 复刻对应关系

| 原版路由 | demo 路由 | 状态 |
|---|---|---|
| trident（校园 tab） | `#/campus` | ✅ 已实现 |
| trident（个人 tab） | `#/me` | ✅ 已实现 |
| trident（地图 tab） | `#/map` | ✅ 已实现（自绘 SVG 离线地图） |
| feed/detail | `#/feed/:id` | ✅ 已实现 |
| feed/comment/detail | `#/comments/:id` | ✅ 已实现 |
| feed/list（校园圈） | `#/feedlist` | ✅ 已实现（含原版实测到的「网络错误 + 刷新」态） |
| feed/daily | `#/daily` | ✅ 已实现 |
| feed/poi/detail | `#/poidetail` | ✅ 已实现 |
| messageBoard | `#/board` | ✅ 已实现 |
| poi/search | `#/poi` | ✅ 已实现 |
| publish_post | `#/publish` | ✅ 已实现 |
| message | `#/message` | ✅ 已实现（含群聊入口） |
| chat | `#/chat/:id` | ✅ 已实现 |
| group（群聊） | `#/group` | ✅ 已实现（含 @面板） |
| group/atPanel | 并入 `#/group` | ✅ 用底部抽屉等价实现 |
| chat/media-preview | `#/media?post=&i=` | ✅ 已实现 |
| announce | `#/announce` | ✅ 已实现 |
| scanner | `#/scanner` | ✅ 已实现（无摄像头，用取景框 + 扫描线动画） |
| login/select | `#/loginselect` | ✅ 已实现 |
| login/sns | `#/login` | ✅ 已实现 |
| login/onboarding | `#/onboarding` | ✅ 已实现 |
| upgradeAlert | `#/upgrade` | ✅ 已实现（弹窗样式） |
| webview | —— | ⚠️ 通用容器，无独立 UI 价值，未复刻 |
| groupchat/invitePage | —— | ⚠️ 入群桥接页，无独立 UI，未复刻 |
| main（入口） | —— | 入口类，由上述页面覆盖 |

**补充入口**：个人页左上角「三横线」→ `#/more`，集中列出所有二级页面入口
（对应原版的抽屉菜单）。目的是让每个页面都能从界面里走到，而不是只能靠 URL。

## 五、未能还原的部分（如实记录）

1. **地图底图**：原版是腾讯地图 SDK 实时瓦片；demo 用自绘 SVG 还原观感，不做真实地理数据。
2. **相机取景**：原版调用真实摄像头（发布页、扫码页）；demo 用本地生成的渐变图 / 取景框动画模拟。
3. **动态的真实图片**：原版图片来自 CDN；demo 全部用本地生成的渐变占位图。
4. **校园圈的在线内容**：原版该页在无后端时只显示「网络错误」，demo 如实复刻了这个错误态，
   点「刷新」后展示本地 mock 内容，把该状态闭环。
5. **推送类技术页**：`webview` 通用容器、`groupchat/invitePage` 入群桥接页无独立 UI，未复刻。
