# 真实功能接入：地图 / 发帖 / 摄像头

> 2026-09-12 起，demo 从「静态复刻」推进到「功能可用」。

## 一、摄像头与相册（已完成）

- 插件：`@capacitor/camera`
- 封装：`app/src/native/camera.ts`
  - 原生（APK）走 Capacitor Camera，真正调用系统相机与相册；
  - 浏览器预览退回 `<input type="file">`，行为等价；
  - 拍/选之后用 canvas 压到最长边 1280、JPEG 0.72（避免本地存储被大图撑爆）。
- 权限（`AndroidManifest.xml`）：`CAMERA`、`READ_MEDIA_IMAGES`、
  `READ_EXTERNAL_STORAGE`（限 SDK ≤ 32）。

**真机验证**：设备上点快门确实拉起系统相机
（前台 Activity 变为 `com.android.camera2/CaptureActivity`）；
点「添加图片」拉起系统相册选择器（`com.android.documentsui.picker.PickActivity`）。

> 注意：MuMu 模拟器**没有真实摄像头画面**（虚拟摄像头需要在 MuMu 设置里手动指定图片），
> 所以模拟器上能拉起相机界面但拍不出照片。想在模拟器里跑通拍照，
> 需要你在 MuMu 的「设置 → 摄像头」里选择虚拟摄像头图片。

## 二、真实发帖（已完成，本地持久化）

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

### 各服务实测可达性（2026-09-12，本机网络）

| 服务 | 结果 | 说明 |
|---|---|---|
| 高德栅格瓦片 `webrd0X.is.autonavi.com` | ✅ 可达（无 key） | 当前默认，**未授权调用，仅限本地演示** |
| 天地图 WMTS `tX.tianditu.gov.cn` | ⚠️ 服务可达，无 key 返回 418 | 免费注册送 key，官方合规 |
| 腾讯 `rtX.map.gtimg.com` | ❌ 直连 404 | 需走官方 JS SDK（key + 域名白名单） |
| OpenStreetMap `tile.openstreetmap.org` | ❌ 本机超时 | 国内网络不可达 |

**真机验证**：瓦片 20/20 加载成功，显示真实路网与地名
（北京交通大学、学院南路、交大东路、西直门、南长河等）。

**离线降级怎么看**：`#/map?offline=1` 强制使用自绘底图（徽标显示「离线自绘底图（演示模式）」），
用来演示 / 验收无网时的降级表现；真实无网时瓦片连续失败 3 次也会自动切到同一张地图。

### 如何切换到官方 key（合规路径）

1. 打开控制台（已在你浏览器中打开）：
   - 高德开放平台：https://console.amap.com/dev/key/app
   - 腾讯位置服务：https://lbs.qq.com/dev/console/key/manage
2. 登录/注册 → **完成实名认证**（两家都要求）→ 创建应用 → 添加 Key。
3. Key 类型选择与白名单：
   - 高德：选「Web端(JS API)」，白名单填 `localhost`（WebView 里的页面源是 `https://localhost`）；
   - 腾讯：选「Web端(JavaScript API)」，授权域名同样填 `localhost`。
4. 把 Key 发给我即可，我会：
   - 高德：改用官方 JS SDK（矢量地图，比现在的栅格瓦片更好），或把 key 用于官方瓦片；
   - 腾讯：改用腾讯地图 JS SDK —— **与原版 app 用的地图服务一致**；
   - 并删除现在的未授权瓦片源。

## 五、尚未接入的真实能力

| 能力 | 现状 | 需要什么 |
|---|---|---|
| 真实录音（语音动态） | 只有波形占位 | 加 `@capacitor/voice-recorder` 或 MediaRecorder |
| 消息/评论真实送达 | 本地状态 | 需要后端 |
| 帖子分享给别人 | 仅本机 | 需要后端 |
| 扫码识别真实二维码 | 动画模拟 | 加 `@capacitor-mlkit/barcode-scanning` |
| 官方地图 SDK（腾讯/高德） | 用未授权栅格瓦片兜底 | 你的 API Key，见上 |

## 六、如果要"真后端"

当前所有数据都在本机。要做到「A 发的帖 B 能看到」，需要一个服务端：

- 最小方案：本地 Node + SQLite（Express/Fastify）+ 图片存磁盘，局域网内多设备可见；
- 云方案：Supabase / Cloudflare D1 等托管数据库 + 对象存储；
- 认证：手机号验证码需要短信服务商（有实名与费用门槛）。

如果你要往这个方向走，告诉我目标形态（局域网演示 / 公网可访问），我来选型和实现。
