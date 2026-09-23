# BJTU TimeMap —— 实现修正与 P0 实施记录

> 本次任务：以工作目录下的两份需求文档为准绳，审计现有应用、修复「实现不准」的功能，并完成 P0（MVP）全部内容。
> 记录范围：只写我实际改动过、且实际验证过的东西；未做的部分在文末「未纳入范围」与「遗留问题」中明确说明。
>
> 需求依据：
> - `BJTU TimeMap需求分析与产品设计文档.docx`（设计文档，冲突时以此为准）
> - `北交大校园记忆地图项目需求分析初稿 (1).docx`（初稿）

---

## 1. 结论速览

| 项 | 结果 |
| --- | --- |
| P0 功能项 | F01 账号资料、F02 地图地点、F03 地点详情、F04 发布、F05 互动、F06 活动、F07 举报管理 —— 全部完成 |
| 修复「实现不准」 | 11 类产品性偏差 + 11 项具体代码缺陷 |
| 自动化验收 | `tools/p0-smoke.mjs`，**54 / 54 通过** |
| 类型检查 | `pnpm exec tsc -b` → 退出码 0 |
| Lint | `pnpm run lint` → **0 error**，5 warning（均为既有 fast-refresh 风格告警） |
| 生产构建 | `pnpm run build` → 成功，CSS 50.13 kB / JS 491.20 kB（gzip 151.48 kB） |
| APK 打包 | **`TimeMap-1.2-debug.apk`（8.27 MB，`com.bjtu.timemap` v1.2 / versionCode 2）** 构建成功 |
| 清理 | 删除 18 个旧复刻屏、2 个旧数据文件、22 个孤立样式文件，源码文件数 55 → 34 |

最关键的判断：**原应用根本不是这个产品。** 工作目录里原有的 App 是另一个 App（`com.kairuotu.campus`，校园复刻 demo）的复刻版，其信息架构、数据模型、交互流程与 BJTU TimeMap 需求文档几乎没有交集。因此本次不是「改几个 bug」，而是以需求文档为纲重建了 P0 的信息架构与数据层，同时保留并复用了原有的地图渲染、定位、相机等基础设施。

---

## 2. 「实现不准」问题清单与修复

### 2.1 产品性偏差（与需求文档直接冲突）

| # | 问题（修复前） | 需求依据 | 修复后 |
| --- | --- | --- | --- |
| 1 | 应用主体是另一个产品的复刻（校园社交 + 课程表 + 二手 + 群聊） | 需求文档定义的「北交大校园记忆地图」 | 以「地点」为核心重新组织：地点 ↔ 帖子 ↔ 活动，重建数据层与全部 P0 页面 |
| 2 | 一级入口为 Campus / Board / Chat 等 | 设计文档 2.2：一级入口 = 地图 / 活动 / 我的 / 管理端 | `TabBar` 重写为 地图 / 活动 / 我的 三 tab + 发布 FAB；管理端从「我的」进入 |
| 3 | 登录方式为手机号 / 验证码式选择页，采集手机号 | F01：低敏身份标识，**不采集手机号、密码、身份证** | 改为邀请码登录（`BJTU2026` 学生 / `BJTUADMIN` 管理员），页内明示隐私边界 |
| 4 | 帖子与地点无强关联 | §3.2 核心业务规则：每条内容必须关联一个**管理员已启用的预设地点** | 发布强制选地点；地点被停用后不可再发（已停用地点的详情仍可浏览） |
| 5 | 发布后进入「待审核」队列 | §3.2 + US-02：内容**直接发布**，靠举报 + 事后下架治理 | 去掉审核态，发布即可见；治理改走「举报 → 管理员处理」 |
| 6 | 点赞 / 收藏非幂等、不可撤销 | US-03：点赞、评论、收藏**幂等且可撤销** | 全部改为可切换；重复请求不重复计数；取消后计数回落 |
| 7 | 无管理端（无举报处理、无操作记录） | F07 / US-08：举报处理 + 操作留痕 + 普通用户不可进入 | 新增 `AdminScreen`，含举报处理 / 内容 / 地点 / 活动 / 操作记录五个分区 |
| 8 | 活动含报名、支付类交互 | F06 / §不纳入范围：活动仅由管理端录入，**无报名、无支付** | 活动改为只读浏览：列表 / 详情 / 跳转举办地点；页面内不含报名与支付入口 |
| 9 | 老照片没有年代与来源 | US-01：老照片必须标注年代与来源，缺失时标「年代不详」 | 数据结构加 `era` + `source` 必填；无来源的占位图明确标注为演示数据 |
| 10 | 地图加载失败即白屏 | US-01：地图不可用时降级为**地点列表** | 提供地点列表兜底入口与半屏列表弹层 |
| 11 | 热帖排序无依据 | §3.2 热帖公式 | 实现 `点赞×2 + 评论×3 + 收藏×1 − 时间衰减`，7 天窗口 |

### 2.2 具体代码缺陷（阻断功能的真 bug）

| # | 现象 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | **点赞 / 评论 / 收藏 / 登录后界面不刷新**（数据已写入 localStorage，但界面停在旧状态） | `useSyncExternalStore(subscribeTm, getTmState)`：store 多数分支是**就地修改** `state` 的字段，顶层对象引用不变 → React 判定快照未变，不触发重渲染 | `tmStore` 引入单调递增的 `version` 与 `getTmVersion()`，作为快照源；`useTm()` 与 `MapScreen` 改用版本号订阅 |
| 2 | **任何地点点进去都显示同一个地点** | `navigate('place', { id })` 把 id 放在 query，而 `App.tsx` 只从 path 段取 `param` → 永远落到兜底 id | 详情类路由统一取 `route.query.id ?? param` |
| 3 | 「返回」在无历史时跳到不存在的路由 | `goBack()` 兜底值是已删除的 `'campus'` | 兜底改为 `'map'` |
| 4 | 登录后仍停在登录页 | `App.tsx` 直接调 `getSession()`，未订阅 store，登录状态变化不触发重渲染 | `App` 订阅 `useTm()`，登录门禁即时切换 |
| 5 | 发布页取不到相机 / 相册能力 | 从 `../data/tmStore` 导入了本不存在的 `pickPhoto` / `takePhoto` | 改为从 `../native/camera` 导入 |
| 6 | Vite 构建报 `require is not defined` | `tmStore.placeMarkers`、`TmPostCard` 中残留 CommonJS `require()` | 改为顶层 ESM 导入 |
| 7 | 地点详情帖子列表渲染异常 | `posts.map((p) => ...)` 内误用外层变量 `post` | 修正为使用 `p` |
| 8 | 举报弹层「一直打开」 | `ReportSheet` 的 `targetId` 恒为帖子 id，未随开关置空 | 未打开时传 `null` |
| 9 | 管理端部分功能点不动 | 引用了不存在的符号与文件中部的 `import` | 补齐 `postsAll()` 等导出，导入上提 |
| 10 | 帖子详情、评论页数据缺失时崩溃 | 未处理内容被下架 / 不存在的分支 | 增加状态页（内容已移除 / 不存在） |
| 11 | 图标按钮无法被辅助技术与自动化识别 | 点赞、评论、收藏按钮只有图标与数字，无可访问名称 | 补 `aria-label` / `aria-pressed`，并加 `data-act` 便于验收定位 |

> 关于第 1 条：这是本次最有价值的修复。它解释了为什么很多功能「看起来写完了却像没生效」——写进去的数据是对的，只是界面不重渲染。

---

## 3. P0 实施内容（F01–F07）

### 数据层（新增）

- `app/src/data/timemap.ts`（740 行）：类型定义 + 演示种子数据
  - 类型：`CampusPlace`、`OldPhoto`（含 `era` / `source`）、`TmPost`、`TmComment`、`TmActivity`、`TmReport`、`AdminOp`、`TmUser`、`PlaceMapMarker`
  - 工具：相对时间、时间段格式化、活动状态推导、分类配色、食堂标签集、情绪标签集、举报分类
  - 种子：**10 个北交大地点**（南门、思源碑、明湖、图书馆、思源楼、逸夫教学楼、天佑会堂、学苑餐厅、二食堂、主操场）、**14 条帖子**、**15 条评论**、**6 场活动**（含进行中 / 已结束 / 已取消）、**6 个用户**
- `app/src/data/tmStore.ts`（649 行）：localStorage 持久化（键 `tm.state.v1`）+ 全部业务规则
  - 登录 / 退出 / 资料更新 / 权限判定
  - 地点：启用停用、可发布校验、地图标记聚合
  - 内容：发布（防重复提交）、作者删除、点赞、收藏、评论及其删除
  - 排序：`最新` 与 `近期热门`（热帖公式 + 7 天窗口）
  - 举报：提交、待处理队列、处理（不处理 / 下架，**必须填理由**）
  - 管理：下架 / 恢复内容、启用停用地点、录入与取消活动、操作记录留痕

### 页面（新增或重写）

| 文件 | 行数 | 覆盖 |
| --- | --- | --- |
| `app/src/screens/MapScreen.tsx` | 580 | F02：分类筛选、标记、定位、底图多级降级、地点列表兜底、返回保留浏览区域 |
| `app/src/screens/PlaceDetailScreen.tsx` | 197 | F03：校史沿革、老照片（年代 + 来源）、近期活动、最新 / 热门、帖子列表 |
| `app/src/screens/PublishScreen.tsx` | 218 | F04：地点必选、文字 ≤500、图片 ≤3、标签 ≤2、防重复提交 |
| `app/src/screens/FeedDetailScreen.tsx` | 175 | F05：详情、点赞、收藏、评论、举报、作者删除 |
| `app/src/screens/CommentsScreen.tsx` | 72 | F05：评论列表与发表 |
| `app/src/screens/ActivitiesScreen.tsx` | 121 | F06：全部 / 今天 / 本周筛选，当前与历史分区 |
| `app/src/screens/ActivityDetailScreen.tsx` | 105 | F06：时间、地点、主办方、来源与更新时间、已取消 / 已结束说明 |
| `app/src/screens/MeScreen.tsx` | 99 | F01：资料卡、我的发布、我的收藏、管理端入口、退出 |
| `app/src/screens/ProfileEditScreen.tsx` | 96 | F01：昵称 / 学院 / 年级 / 简介 |
| `app/src/screens/LoginScreen.tsx` | 91 | F01：邀请码登录与隐私说明 |
| `app/src/screens/AdminScreen.tsx` | 490 | F07：举报 / 内容 / 地点 / 活动 / 操作记录 |
| `app/src/components/TmPostCard.tsx` | 337 | 通用：帖子卡片、评论列表与输入、举报弹层、轻提示、`useTm()` |
| `app/src/components/TabBar.tsx` | 39 | 一级入口三 tab + 发布 FAB |
| `app/src/App.tsx` / `app/src/router.ts` | 75 / 63 | 路由与登录门禁；默认落地页 `#/map` |

### 样式

- `app/src/styles/timemap.css`（871 行，新增）：`tm__*` / `pd__*` / `tpub__*` / `fd__*` / `cd__*` / `act__*` / `acd__*` / `tme__*` / `tpe__*` / `adm__*` 全部分组
- `app/src/screens/map.css`：补齐筛选 chips、地点列表按钮与半屏弹层、标记计数等类
- `app/src/screens/login.css`：重写为 `lg__*`（旧 `.login__*` 规则随旧屏一并删除）
- 复用调整：`RealMap.tsx` / `TencentMap.tsx` / `AmapMap.tsx` 的标记类型改为 `PlaceMapMarker[]`，`realmaps.css` 增加帖子数徽标

### 清理

删除 18 个旧复刻屏（Campus / Board / Chat / GroupChat / FeedList / PoiDetail / PoiSearch / Daily / Message / Scanner / LoginSelect / Onboarding / Upgrade / MediaPreview / UserProfile / DrawerPages / Simple / Announce）、`data/mock.ts`、`data/store.ts`、`components/Drawer.tsx` 及 22 个孤立 CSS。删除前已确认它们构成孤立子图（App 不引用），删除后 `tsc` 与构建均通过。

---

## 4. 验证方式与结果

### 4.1 自动化验收：`tools/p0-smoke.mjs`（653 行，54 用例全通过）

考虑到项目没有 DOM 测试框架、也不该为验证再引入 jsdom，改用 **Chrome DevTools Protocol** 在真实渲染的页面里点击真实按钮、读取真实文案：

```bash
# 终端 1
cd app && pnpm run dev
# 终端 2：带调试端口启动浏览器并打开 http://127.0.0.1:5174
# 终端 3
node tools/p0-smoke.mjs
```

覆盖的验收点（对应需求文档 US-01 ~ US-08）：

- **F01**：登录门禁、错误邀请码拒绝、学生邀请码登录、一级入口恰为三个、个人中心入口
- **F02**：分类筛选存在且生效、地点标记渲染、地点列表兜底、管理端启停地点
- **F03**：点击地点进入对应详情、校史存在、**老照片必有年代与来源**、最新 / 热门切换
- **F04**：未选地点 / 空内容拒绝发布、发布成功回到该地点、**一次提交只产生一条**（防重复）
- **F05**：点赞 +1、重复点赞不重复计数且可取消、评论即时可见、自己的评论可删、收藏进入个人中心
- **F06**：活动列表、已结束 / 已取消标识、**页面不含报名与支付**、详情含时间 / 地点 / 主办方 / 来源、可跳转举办地点
- **US-04 活动数据校验**：缺标题 / 地点 / 时间被拒绝、**结束早于开始被拒绝**、合法数据可正常录入
- **F07 / US-08**：普通用户进管理端被拒、举报必选原因、**举报后内容不自动消失**、管理端五个分区、**下架必须填理由**、下架后标记移除且正文从地点列表消失、**操作记录含管理员 / 动作 / 对象 / 时间 / 理由**、停用地点后详情可看但不可发布

### 4.2 静态检查与构建

```
pnpm exec tsc -b        → exit 0
pnpm run lint           → 0 error, 5 warning（既有 fast-refresh 风格）
pnpm run build          → 成功，64 modules，CSS 50.13 kB / JS 491.20 kB
```

### 4.3 说明

- **地图**：无 API Key 时按 `腾讯 SDK → 高德 SDK → 栅格瓦片 → 离线 SVG` 逐级降级。本次验证环境实际走的是栅格瓦片（Leaflet），标记与筛选均正常。
- **演示数据全部为虚构**；老照片为本地生成的 SVG 占位图，并明确标注「演示数据 · 本地生成示意图（来源待补录）」，避免伪造史料来源。

---

## 4.4 Android APK 打包（v1.2）

**产物**：`TimeMap-1.2-debug.apk`，8.27 MB
**SHA256**：`873B1877FEB6627A150B1F0FC7BCF046DC35E534D806C3C428CC3F7585F56F69`

`aapt2 dump badging` 复核结果：

| 项 | 值 |
| --- | --- |
| 包名 | `com.bjtu.timemap` |
| 版本 | versionName **1.2** / versionCode **2** |
| 应用名 | BJTU TimeMap |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 |
| 权限 | INTERNET、CAMERA、READ_MEDIA_IMAGES、READ_EXTERNAL_STORAGE(≤32)、ACCESS_FINE/COARSE_LOCATION |
| 未申请 | `QUERY_ALL_PACKAGES`（Manifest 里 `tools:node="remove"` 生效） |

APK 内已确认包含 Web 产物：`assets/public/index.html` 引用 `assets/index-FwgatZ9M.js` 与 `assets/index-B05QHp6e.css`，哈希与 `pnpm run build` 输出一致。

### 打包过程中修复的问题

打包这件事本身暴露了 5 个此前无法发现的问题——它们只在真正出 APK 时才浮现：

| # | 问题 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | 应用身份仍是旧复刻产品 | `capacitor.config.ts` / `strings.xml` / `build.gradle` 里是 `com.campusx.demo`、应用名「校园」 | 统一改为 `com.bjtu.timemap` / BJTU TimeMap，Java 包目录同步迁移 |
| 2 | 版本号停在旧产品 | `versionCode 1` / `versionName "1.0"` | 提升为 `versionCode 2` / `versionName "1.2"` |
| 3 | **工程缺资源，根本构建不了** | `styles.xml` 引用的 `@color/colorPrimary`、`@drawable/splash`、以及自适应图标引用的 `@mipmap/ic_launcher_foreground` **在 git 历史里从未存在**（`splash.png` 被 `.gitignore` 的 `*.png` 一起排除），git 只跟踪了 9 个资源文件 | 补齐 `values/colors.xml`；用矢量实现 `drawable/splash.xml` + `splash_logo.xml`；图标前景改用已存在的 `@drawable/ic_launcher_foreground` 并按 TimeMap 品牌重绘；同时删掉 `.gitignore` 里那条全局 `*.png` |
| 4 | AGP 拒绝非 ASCII 路径 | 工作目录含「测试实训」 | 按官方提示在 `gradle.properties` 加 `android.overridePathCheck=true` |
| 5 | Java 编译失败：`无效的源发行版：21` | Capacitor 8 的 Android 模块要求 Java 21，机器默认 `JAVA_HOME` 是 JDK 17 | 改用已安装的 JDK 21（`C:\Program Files\Java\jdk-21.0.10`），并在 `tools/build-apk.ps1` 里固定该前提 |

### 环境与复现

这台机器原本**没有 Android SDK**，因此新增了 `tools/fetch-android-sdk.mjs`（用 node 下载，因为 PowerShell 的 .NET HTTP 栈在本机不通）把最小 SDK 装进工作区 `.android-sdk/`（255 MB，已加入 `.gitignore`）：`platform-tools` + `platforms/android-36` + `build-tools/36.0.0`，并补了 SDK 许可文件。

一键复现：

```powershell
pwsh -File tools/build-apk.ps1
```

脚本固化了三个不显然的前提：JDK 21、工作区内 Android SDK、`android.overridePathCheck=true`；完成后把 APK 复制到仓库根目录的 `TimeMap-<版本>-debug.apk`。

安装（需自备模拟器或真机）：

```powershell
.adb install -r TimeMap-1.2-debug.apk
```

> 本次**未做真机/模拟器安装与页面走查**：当前没有连接的设备。结构与资源已核验，但「装上去能跑」这一步仍建议在设备上补做（仓库已有的 `tools/device-eval.mjs` 可按 `docs/device-walkthrough.md` 的方式连进 APK 的 WebView 做 DOM 级走查）。

---

## 5. 未纳入范围（本轮明确不做）

按需求文档优先级，P1 及以下本轮不实现（也未在界面上留半成品入口）：

- **P1**：F08 热帖独立页、F09 照片卡片、F10 文案贴纸、F11 主体贴纸、F12 新老照片拼图、F13 弹幕、F14 足迹
- **P2**：F15 匿名发布、F16 一对一私聊、活动搭子、个性化推荐
- **不纳入**：课表 / 教务、二手交易、支付、群聊、跨校、校外地图、连续轨迹记录

---

## 6. 遗留问题与后续建议

1. **文档仍有旧产品口径**：`README.md`、`docs/page-map.md`、`docs/comparison.md`、`docs/original-interaction-map.md`、`kickoff-prompt.md` 描述的是旧复刻产品的页面地图与范围，与当前 TimeMap 实现不一致，建议后续统一更新或归档。
2. **在线底图需配 Key**：腾讯 / 高德 SDK 路径已接好但需要有 Key 才能启用，当前默认走栅格瓦片。
3. **数据仅存本地**：无后端，换设备或清缓存即丢失，符合演示定位，但正式试用前需确认。
4. **Lint 5 条告警**：`TmPostCard.tsx` 与 `TencentMap.tsx` 同时导出组件与工具函数触发的 fast-refresh 提示，属风格问题，可按需拆分文件消除。
5. **活动录入校验已覆盖但表单无即时反馈**：`addActivity` 已拦截缺标题 / 缺地点 / 时间非法（结束早于开始）三种情况，但错误只在提交后以 toast 呈现，未做字段级即时提示。

---

## 7. 变更文件清单

**新增**

- `app/src/data/timemap.ts`、`app/src/data/tmStore.ts`
- `app/src/components/TmPostCard.tsx`、`app/src/components/icons-flag.tsx`、`app/src/components/icons-user.tsx`
- `app/src/styles/timemap.css`
- `app/src/screens/ActivitiesScreen.tsx`、`ActivityDetailScreen.tsx`、`AdminScreen.tsx`、`PlaceDetailScreen.tsx`
- `tools/p0-smoke.mjs`、`tools/fetch-android-sdk.mjs`、`tools/build-apk.ps1`
- `app/android/app/src/main/res/values/colors.xml`、`res/drawable/splash.xml`、`res/drawable/splash_logo.xml`、`res/drawable/ic_launcher_foreground.xml`
- `app/android/app/src/main/java/com/bjtu/timemap/MainActivity.java`
- `TimeMap-1.2-debug.apk`（构建产物，已被 `.gitignore` 覆盖）

**重写 / 修改**

- `app/src/App.tsx`、`app/src/router.ts`、`app/src/components/TabBar.tsx`
- `app/src/screens/MapScreen.tsx`、`PublishScreen.tsx`、`FeedDetailScreen.tsx`、`CommentsScreen.tsx`、`MeScreen.tsx`、`ProfileEditScreen.tsx`、`LoginScreen.tsx`
- `app/src/screens/map.css`、`app/src/screens/login.css`、`app/src/native/realmaps.css`
- `app/src/native/RealMap.tsx`、`TencentMap.tsx`、`AmapMap.tsx`
- `app/capacitor.config.ts`、`app/android/app/build.gradle`、`app/android/gradle.properties`、`app/android/app/src/main/res/values/{strings,ic_launcher_background}.xml`、`app/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher{,_round}.xml`、`.gitignore`

**删除**

- 18 个旧复刻屏、`data/mock.ts`、`data/store.ts`、`components/Drawer.tsx`、22 个孤立 CSS
- `app/android/app/src/main/java/com/campusx/demo/MainActivity.java`（旧包名）
