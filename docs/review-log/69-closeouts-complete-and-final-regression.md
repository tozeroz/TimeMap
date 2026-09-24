# 审核 69：三个 closeout 的销项汇报（含最终干净回归）

> 时间：2026-09-23 13:5x（Round 319）｜我提交：三项 closeout 证据 + 最终回归

## 一、① WO#21 audio typed persistence/readback —— 你上轮唯一的 P0

**你要求的那份证据（逐条实测）**
```
上传 audio → media id = X（X=bd9b8685-…，scope=public、mime=audio/webm）
→ POST 含 X              ⇒ 201，postId=d2bfad1f-…
→ post_media row exists  ⇒ 行数=2，其中 audio=1
→ GET /api/posts/:id
    images: n=1 keys=[height,id,width]
    audio : n=1 keys=[durationMs,id,mime]，durationMs=2500   ← 独立类型
→ X appears under audio ✅
→ X **absent from images** ✅        ← 你的 P0 判据
列表端点同样分流 ✅ ／ 清理后剩余 0 ✅
```

**你猜对了 —— 这确实是真缺陷**：`POST` 把所有 mediaId 一律写进 `post_media`，
而读模型把所有 post_media 行都放进 `images` ⇒ **语音被报成图片**。
修法：三处读点按 **mime** 分流（`image/%` → images；`audio/webm` → audio），
**不**用"width/height 是否为空"来推断（那是推断，mime 是事实）。

门禁 `gate-wo21-audio-roundtrip.sh`：**11/11 PASS**

**`VOICE_CONSUMPTION: NOT_IMPLEMENTED`** —— Feed 目前**不能播放**这段 audio（只有数据，没有播放器 UI）。已按要求明确写出。

## 二、② WO#22 真实 QR 端到端

```
固定载荷 QR：campus-scanner-e2e-20260923（segno 生成，v3/ECC-Q/296×296）
前置：扫码页真在 scanning（真实摄像头出帧 frames=19、1080×1920）
把**真实 QR 位图**送进**同一条解码路径**（只替换帧内容；解码器/jsQR/状态机全原样）
→ 页面实际进入 found ⇒ payload **逐字等于** campus-scanner-e2e-20260923 ✅
→ URL 不变（不触发任何业务动作）✅
```
门禁 `gate-wo22-qr-e2e.mjs`：**4/4 PASS**

**⚠️ 如实划界**：`SCANNER_CAMERA_OPTICS_SAW_PHYSICAL_QR: NOT EVALUATED`
—— 本机摄像头是 **Integrated Camera**，物理上拍不到自己屏幕；
MuMu 摄像头源只能经 GUI 配置（其 configs/nx_device/注册表都无该设置项）。

## 三、③ WO#23 真更新流程（B 方案）

```
· 托管自己构建的 APK 到 Nginx /download/
  公网实测：200 + Content-Type=application/vnd.android.package-archive
           + 字节数 11614147 **与本地构建等长** + 前 4 字节 504b0304（APK zip 魔数）
· 迁移 015 发布 1.1 + apk_url
· ⚠️ 修掉真实缺陷：「立即更新」原为 window.open(url,'_blank') ⇒
  在 Capacitor WebView 里**什么都不发生**（无请求、DownloadManager 无条目）
  ⇒ 改为真实导航 window.location.href（由 WebViewClient 交给系统）
```
门禁 `gate-wo23-update-flow.mjs`：**6/6 PASS**，含
`CLICK_HANDS_OFF_TO_SYSTEM: PASS`（**Android 侧 oracle**：前台窗口从
`com.campusx.demo` 切到 `com.android.chromium/…ChromeTabbedActivity`）

口径：`INSTALL_HANDOFF_TO_OS: INITIATED`（**不**声称 COMPLETED）。

## 四、最终干净回归

```
M5_GLOBAL_REGRESSION_AUDIT: **PASS**
  27 个设备门禁 × 两轮（正序 + 逆序）＝ 全部 DEVICE_GATE_EXIT=0
  逐门禁一致、**无任何顺序敏感项**
  服务器侧 gate-place-not-campus: PASS ／ CHECK_ALL_LOCAL: PASS
⚠️ 门禁数由"硬编码 15"改为**自动发现** ⇒ 27（新增的 12 个此前从未被审计跑到）
```

### ⚠️ 这次回归抓出并修掉了我自己的 **4 个门禁问题**（值得记）

```
① **我的门禁污染了别人的门禁**（最重要）
   QR 门禁把 drawImage 补丁挂在 CanvasRenderingContext2D.prototype（页面级共享），
   而**旧版把原函数存在闭包里** ⇒ 原型上留下的 __wo22patched **无法撤销**
   ⇒ 之后跑 scanner 门禁时扫码页**第一帧就识别成功**（phase=found, frames=1）
   ⇒ 其核心断言 SCANNER_DECODE_LOOP_RUNNING 误报 FAIL。
   修法三件：原函数也存到原型上（可还原）+ 运行后还原 + 运行前清理，
   并检测到**不可撤销的旧残留**时**重载页面**。
   ⚠️ 教训：给被测环境打补丁，**必须把还原所需的引用存到可访问的地方**；
      否则补丁不可撤销，而且它制造的问题会记在**别人**头上、只在特定顺序出现。
② 更新类门禁点击后把用户交给系统（导航到 APK 地址）⇒ 前台变 Chrome
   ⇒ 外层 VISUAL_TARGET_VALIDITY(after) 误判并作废证据
   ⇒ 两个更新门禁都在观察完之后**复原前台**（断言依据此前已读完）。
③ gate-wo23-update-check 的判据**把当时的发布状态写死了**：
   "必须显示已是最新"+"必须显示未托管 APK" —— 真实发布 1.1 并托管 APK 后，
   弹窗**正确地**显示"新版本 v1.1"+真实地址 ⇒ 反而误报 FAIL。
   ⇒ 改为**关系式**判据（清单 vs 设备版本决定该显示什么；有 apkUrl 就必须显示它）。
   ⚠️ 教训：**门禁不得把某一时刻的数据状态写死成断言**。
④ 同门禁的 READ **没采集 apkShown** 却在断言里用它 ⇒ 恒 undefined ⇒ 误报
   （跨门禁抄判据时忘了抄它依赖的观测字段）。
```

### 另外修掉的一处**真实配置漂移**

```
ops/nginx/campus-locations.inc 顶部写着"唯一真源 = 本仓库"，但实测：
  仓库 23 行（只有 /health、/api/、404）／服务器 **99 行**（含 /media/、/_private_media/）
⇒ 若从仓库重建服务器，**公共图片与私有媒体会全部 404**。
⇒ 处置：把服务器实际内容取回纳入仓库，使那句话**重新为真**；
  并在文件顶部如实记录这次事故与教训。
```

## 五、请裁定

```
1. WO#21 audio round-trip 是否销项？（含 VOICE_CONSUMPTION: NOT_IMPLEMENTED 的如实回答；
   若要补播放器 UI 请明示，我不擅自扩范围）
2. WO#22 的"真实 QR"：真实位图走真实解码路径已证；"摄像头光学拍到物理二维码"
   受本机硬件限制做不到 ⇒ 接受当前证据结案，还是必须人工补一次？
3. WO#23 是否可判 CLOSED（真实 APK 可下载 + 点击交给系统）？INITIATED 口径认可吗？
4. nginx 配置漂移的处置认可吗？
5. **M5 现在能否关账**？若仍不行，请点名**唯一**必须做的那一项。
```
