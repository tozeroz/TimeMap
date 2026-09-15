# 真实功能接入：地图 / 发帖 / 摄像头

> 2026-09-12 起，demo 从「静态复刻」推进到「功能可用」。

## 一、拍摄模式：页内实时取景（已完成，2026-09-12 重做）

最初的实现是「点快门 → 拉起系统相机 App」，形态和原版不一样。
原版拍摄页是**页内实时取景**：画面就是摄像头预览，底排三个键依次是
**相册选图 / 快门拍摄 / 前后置切换**。现在按这个形态重做：

- 实现：`app/src/native/liveCamera.ts`（`getUserMedia`）+ `screens/PublishScreen.tsx`
  - 实时预览 `<video playsInline muted autoPlay>`；
  - 快门用 canvas 抓当前帧 → JPEG dataURL 进草稿（1280 长边、0.72 质量）；
  - 前后置切换：`facingMode` environment/user，前置预览做镜像（存下来的照片**不**镜像，
    与原生相机一致），只有检测到 ≥2 个摄像头时该键才可用；
  - 变焦 1x/2x/5x 走 `track.applyConstraints({ zoom })`，设备不支持时就不生效（不假装）；
  - 没有摄像头/权限被拒时给可读的降级文案 + 「重试」，不是黑屏。
- 相册键仍然用 `@capacitor/camera`（`pickPhoto`）——选图本来就应该走系统相册。

**为什么不用 `@capacitor/camera` 拍**：那个插件走的是「拉起系统相机 App、拍完回传」，
是另一套交互；页内取景只能用 WebRTC，Capacitor 的 WebView 支持它
（需要宿主 App 持有 CAMERA 权限 + WebChromeClient 放行 `RESOURCE_VIDEO_CAPTURE`，
Capacitor 已实现前者由我们申请、后者自带）。

### 验证方式（两条链路都跑）

| 环境 | 结果 |
|---|---|
| 桌面浏览器 + 本机真实摄像头 | ✅ 1280×720 实时流、快门拍到真实 JPEG、切换前后置后重新拿到流并镜像 |
| 桌面浏览器 + Chromium 合成摄像头 | ✅ 1920×1080 流、取景画面非纯黑（亮度 45~116） |
| MuMu 模拟器（真机链路） | ✅ `camState=live`、1080×1920 流、**真实触摸**点快门拍到 JPEG、点切换键 facing 变 user 且镜像 |

> 关键点：模拟器上那一路走的是**和真机完全相同**的代码（WebView + getUserMedia + CAMERA 权限），
> 不是替身。合成摄像头只在桌面浏览器里作为「没有可用摄像头时」的替代。
> MuMu 的虚拟摄像头画面本身是空白的（要在 MuMu 设置里给它指定图片），所以取景区是深灰底 + 九宫格，
> 但快门拍到的确实是这一路流的真实帧 —— 换成真机就是真画面。

**顺手修掉的坑**：`getUserMedia` 在某些环境下（例如 Windows 上摄像头被别的进程占着）
既不 resolve 也不 reject，界面会永远停在「正在打开摄像头…」。
现在加了总时长封顶（12 秒，三次降级尝试共享预算），超时后走降级文案 + 重试。

## 二、相册与本地发帖（已完成）

- 存储层：`app/src/data/store.ts`（localStorage，键 `campus.demo.myPosts.v1`）
  - 帖子持久化，重启 app 后仍在；
  - 写满配额时自动丢弃最旧的帖子；
  - `feedWithMine()` 让新帖排在信息流最前；`findPost()` 让详情页也能打开本地帖子。
- 发布页：拍摄模式的快门 → 真实拍照进草稿；文字模式的「添加图片」→ 真实相册选图；
  点「发布」写入本地帖子库并返回校园页。

**验证**：浏览器端完整跑通「上传图片 → 草稿 1 张且已压缩为 jpeg dataURL →
发布 → 首条卡片带图」；真机上「发文本帖 → 本地帖子数 1 → 新帖排在信息流首位」。

**当前边界**：帖子只存在本机，**不会同步给别人**——没有后端。
如果需要"别人也能看到"的真实发帖，需要额外的服务端（见文末）。

## 三、真实定位（已完成）

- 插件：`@capacitor/geolocation`（Web 预览退回 `navigator.geolocation`）
- 封装：`app/src/native/geo.ts`
  - `hasLocationPermission()` 只查询不弹窗 —— 进地图时静默判断，避免一进页面就弹系统框；
  - `ensureLocationPermission()` 真正发起授权（用户点「授权」时才调用）；
  - `getCurrentFix()` 先要高精度（GPS，10s 超时），失败再用粗定位（基站/WiFi，15s）兜底；
  - `watchFix()` 持续跟踪位置变化，返回停止函数；
  - `distanceMeters()` / `formatDistance()` / `formatAccuracy()` 只做展示换算。
- 权限（`AndroidManifest.xml`）：`ACCESS_FINE_LOCATION`、`ACCESS_COARSE_LOCATION`。
- 地图上的表现（`MapScreen` + `RealMap`）：
  - 蓝点画在**真实坐标**上（`data-lat`/`data-lng`/`data-real=1` 可被验收脚本读到）；
  - 精度圈半径 = 定位精度（`L.circle`），让「这个点有多可信」看得见；
  - 顶部徽标显示 `已定位 · GPS ±1 m` / `正在获取真实定位…` / `未授权定位 · 点击授权`；
  - 「回到定位」按钮飞到真实坐标；位置离校园 > 20 km 时额外出现
    `当前位置距校园 1884 km [回校园]` 提示条，避免蓝点跑到看不见的地方后找不回来；
  - 拿不到定位时蓝点退回校园中心（`data-real=0`），地图不留空白。

**真机验证**（CDP 断言，`tools/checks/geo-location.js`）：

| 断言 | 结果 |
|---|---|
| 蓝点是真实定位（非校园兜底） | ✅ `data-real=1` |
| 蓝点坐标 = 设备上报坐标 | ✅ `23.18689878, 113.419150901`（与 `dumpsys location` 一致） |
| 徽标文案 | ✅ `已定位 · GPS ±1 m` |
| 距校园提示 | ✅ `当前位置距校园 1884 km / 回校园` |
| 点「回到定位」后蓝点回到屏幕中心 | ✅ 偏移 < 40 px |
| 在线瓦片未受影响 | ✅ 20/20 加载 |

> 模拟器说明：MuMu 用的是内置的模拟 GNSS，坐标是广州（23.1869, 113.4192），
> 且精度报 0.02 m（不真实）。所以在地图上你会看到「当前位置距校园 1884 km」。
> 这不是 bug —— 设备说它在哪，蓝点就画在哪。装到真手机上即为你本人的真实位置。

## 四、真实地图（已完成，瓦片源可切换）

- 组件：`app/src/native/RealMap.tsx`（Leaflet）
  - 拖拽 / 缩放 / 惯性由 Leaflet 原生实现；
  - 标记沿用原版形态：照片卡片 + 彩色图钉 + 地点名；
  - 当前位置：蓝点 + 方向扇形。
- 瓦片源：`app/src/native/mapTiles.ts` —— **换 provider 只改这一个文件**。

### 底图优先级（2026-09-12 起：已接入官方 Key）

```
腾讯地图 GL JS SDK  →  高德地图 JSAPI 1.4  →  栅格瓦片(Leaflet)  →  离线自绘底图
   （首选，与原版一致）      （官方合规备份）        （无 key 兜底）        （无网兜底）
```

- Key 统一放在 `app/src/native/keys.ts`（两家都是前端 SDK，Key 必然随包下发，
  这是它们的产品设计；换 key 只需改这一个文件后重新打包）。
- 强制切到某一层来演示 / 验收：
  - `#/map?amap=1` → 高德官方 JSAPI
  - `#/map?raster=1` → 栅格瓦片（Leaflet）
  - `#/map?offline=1` → 离线自绘底图
- 自动降级：腾讯 SDK 脚本加载失败 → 高德；高德也失败 → 栅格瓦片；
  瓦片连续失败 3 次 → 离线自绘。每一步都会切徽标文字
  （`腾讯地图` / `高德地图` / `在线地图` / `离线自绘底图`）。

### 各服务实测（2026-09-12，模拟器 WebView，页面源 `https://localhost`）

| 服务 | 出图 | 拖拽/缩放 | 说明 |
|---|---|---|---|
| 腾讯地图 GL JS SDK（key） | ✅ 矢量路网 | ✅ 拖拽 + 放大按钮 | 与原版 app 同款服务；key 无需配域名白名单 |
| 高德地图 JSAPI **1.4**（key） | ✅ canvas 出图 | ✅ 拖拽 | 见下方「为什么锁 1.4」 |
| 高德地图 JSAPI **2.0**（key） | ✅ canvas 出图 | ❌ 完全不响应触摸 | 已弃用，原因见下 |
| 高德栅格瓦片（无 key） | ✅ 20/20 瓦片 | ✅ 拖拽/双击/捏合 | 仅作最后兜底，**未授权调用，限本地演示** |
| 天地图 WMTS | ⚠️ 无 key 返回 418 | — | 免费注册送 key，官方合规 |
| OpenStreetMap | ❌ 本机超时 | — | 国内网络不可达 |

### 为什么高德锁 1.4 而不是 2.0（实测结论，别再改回去）

在 MuMu 的 Android WebView（Chrome 110）里，**高德 JSAPI 2.0 的 WebGL 渲染器完全不响应触摸**：
单指拖拽时连 `touchstart` / `mapmove` 都不产生，`getStatus().dragEnable` 却是 `true`。

排查方式（避免误判成自己代码的问题）：在页面里另建一张**独立探针地图** ——
自己的容器、`position:fixed; z-index:9999` 画在最上层、不经过任何 demo 代码与 CSS，
结果同样拖不动。同一份 key 换成 JSAPI 1.4 后立刻正常：
`touchstart → touchmove → mapmove → moveend` 全部触发，中心点真实改变
（39.9503,116.3396 → 39.9540,116.3348）。

结论：**问题在 SDK 的 WebGL 渲染器与这个 WebView 的组合，不在 demo**。
1.4 是官方仍在提供的经典渲染器，功能满足需求，因此锁定 1.4。
（`_AMapSecurityConfig` 安全密钥仍然保留挂载，以后 2.0 修好可以直接切回去。）

### 实现要点（踩过的坑）

- **地图 SDK 的透明高层会吃掉所有点击（真机反馈的头号 bug）**：
  腾讯 GL SDK 内部会插入一层 `z-index:1000` 的透明 div；`.realmaps` 自己没有创建层叠上下文时，
  这一层就和页面其它绝对定位元素挤在同一个上下文里，把「授权地理位置」弹窗和悬浮控件压在下面。
  表现极具迷惑性：**弹窗看得见，但点哪儿都没反应；连带的后果是系统权限框永远不弹**，
  看起来就像「权限弹窗是个壳子」。
  修法：`.realmaps` 加 `z-index:1 + isolation:isolate` 把 SDK 关进地图区域内，
  弹窗/悬浮控件再显式给 `z-index`。
  教训：验收脚本一直用程序化 `element.click()`，它**绕过命中测试**，所以永远发现不了这类问题。
  现在 `tools/device-gesture.mjs` 有 `tap` 模式（走真实命中测试），acceptance 的 5d 阶段专门守这个回归。
- **腾讯 `DOMOverlay` 不给元素定位**：实测它不会写 `inline style`，所有标记会堆在左上角。
  改成用官方的 `map.projectToContainer(LatLng)` 自己把经纬度投影成容器像素，
  再 `translate3d` 定位（`app/src/native/TencentMap.tsx`），并在 `moving / zooming / moveend /
  zoomend / idle` 事件里重投影。
- **自己 append 的 DOM 要自己摘**：SDK 不管这些节点，cleanup 里必须 `wrap.remove()`，
  否则每次定位更新都会漏一个节点（验收脚本会数标记数量，漏了立刻能看出来）。
- **四套底图共用一个句柄**：`app/src/native/mapApi.ts` 定义 `MapHandle`（flyTo / zoomIn /
  getCenter / getZoom），MapScreen 只依赖它，不关心底下是谁。
- **验收脚本不认 provider**：地图容器上写 `data-provider` / `data-center` / `data-zoom`
  （容器在动就在更新），验收读这几个属性判断「拖拽有没有生效、缩放有没有生效」。
  高德的移动事件名各家不一，额外挂了 500ms 低频轮询兜底。
- **`acceptance.ps1` 必须纯 ASCII**（脚本头部早有注释）：本次又踩了一次 ——
  一行中文注释被 PowerShell 按 ANSI 读取后**吞掉了下一行代码**，
  导致「切到栅格底图」那步没执行，表现为莫名其妙的验收失败。
- **深色页面上文字颜色不会自动继承**：发布页重排后，「语音 / 文字」两个模式标签继承了浅色主题的
  近黑色文字，在深色底上等于隐形（截图里只剩高亮的「拍摄」）。深色区域的文字颜色必须显式写。

## 五、尚未接入的真实能力

| 能力 | 现状 | 需要什么 |
|---|---|---|
| 真实录音（语音动态） | 只有波形占位 | 加 `@capacitor/voice-recorder` 或 MediaRecorder |
| 消息/评论真实送达 | 本地状态 | 需要后端 |
| 帖子分享给别人 | 仅本机 | 需要后端 |
| 扫码识别真实二维码 | 动画模拟 | 加 `@capacitor-mlkit/barcode-scanning` |

## 六、如果要"真后端"

当前所有数据都在本机。要做到「A 发的帖 B 能看到」，需要一个服务端：

- 最小方案：本地 Node + SQLite（Express/Fastify）+ 图片存磁盘，局域网内多设备可见；
- 云方案：Supabase / Cloudflare D1 等托管数据库 + 对象存储；
- 认证：手机号验证码需要短信服务商（有实名与费用门槛）。

如果你要往这个方向走，告诉我目标形态（局域网演示 / 公网可访问），我来选型和实现。
