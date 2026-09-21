# WO#5 第二轮探针结果：**权限桥根因已定位并修复；采集链路打通；时长一项暴露新问题**

> 时间：2026-09-21 23:07｜设备：MuMu `127.0.0.1:16384`（先跑健康探针 → `DEVICE_HEALTH OK`）
> 前提：已加 `RECORD_AUDIO` + **`MODIFY_AUDIO_SETTINGS`**（见 §二）

## 一、✅ 结论汇总

```
P0  manifest 含 RECORD_AUDIO          PASS（aapt2 双证：构建产物 + 设备已装包）
P1  测试前 permission state = 未授予   PASS（granted=false）
P2  getUserMedia({audio:true})        **PASS（ok:true, 517ms）**
P3  是否出现真实 Android 授权 UI       **NOT_EVALUATED**（见 §四，测试前置有软性干扰）
P4  获得 audio track                  **PASS**（trackCount=1, readyState=live）
P5  MediaRecorder.start()             **PASS**
P6  录制 3 秒                         PASS（已执行）
P7  Blob.size > 0                     **PASS（9517 字节）**
P8  recorder.mimeType / blob.type     **PASS：均为 `audio/webm`**（**不带 `;codecs=opus` 后缀**）
P9  WebView 内 <audio> 能解码          **PASS**（loadedmetadata 触发，无 error）
P10 duration > 0                      **FAIL（duration = null）** ← 见 §三，这是真问题
```

### 采集到的真实媒体参数（说明确实在采集真实音频）

```json
{"ok":true,"ms":517,"trackCount":1,
 "tracks":[{"label":"","enabled":true,"readyState":"live",
   "settings":{"autoGainControl":true,"channelCount":1,"deviceId":"default",
               "echoCancellation":true,"noiseSuppression":true,
               "sampleRate":16000,"sampleSize":16}}]}
```
（`echoCancellation` / `noiseSuppression` / `sampleRate=16000` 都是真实音频输入的特征，
不是空对象或占位值。）

## 二、✅ 根因已定位：缺的是 `MODIFY_AUDIO_SETTINGS`，**不是**缺 WebChromeClient

### 审核预警的情形与实际的差别

审核说："如果加 manifest 后仍然完全没有系统授权流程，**不要让实现者自行继续写 WebChromeClient**"。
**实际情况是：既不是"没有授权流程"，也不需要写 WebChromeClient** —— Capacitor **本来就有桥**，
只是我们**漏声明了它要的一个权限**。

### 代码依据（读的是我们自己 `node_modules` 里的 Capacitor 源码，非猜测）

`@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java`：

```java
@Override
public void onPermissionRequest(final PermissionRequest request) {
    List<String> permissionList = new ArrayList<>();
    if (Arrays.asList(request.getResources()).contains("android.webkit.resource.VIDEO_CAPTURE")) {
        permissionList.add(Manifest.permission.CAMERA);
    }
    if (Arrays.asList(request.getResources()).contains("android.webkit.resource.AUDIO_CAPTURE")) {
        permissionList.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);   // ← 我们漏了这个
        permissionList.add(Manifest.permission.RECORD_AUDIO);
    }
    if (!permissionList.isEmpty()) {
        String[] permissions = permissionList.toArray(new String[0]);
        permissionListener = (isGranted) -> {
            if (isGranted) request.grant(request.getResources());
            else          request.deny();
        };
        permissionLauncher.launch(permissions);          // RequestMultiplePermissions
    } else {
        request.grant(request.getResources());
    }
}
```

而结果判定是"**全部必须授予**"：

```java
ActivityResultCallback<Map<String, Boolean>> permissionCallback = (Map<String, Boolean> isGranted) -> {
    boolean granted = true;
    for (Map.Entry<String, Boolean> permission : isGranted.entrySet()) {
        if (!permission.getValue()) granted = false;
    }
    permissionListener.onPermissionSelect(granted);
};
```

**因此**：只声明 `RECORD_AUDIO` 时，`MODIFY_AUDIO_SETTINGS` 恒为 `false`
→ 整体 `granted=false` → `request.deny()` → WebView 报 `NotAllowedError`
（实测 260ms、**无弹窗**，与"RECORD_AUDIO 当时已授权故无需弹窗"完全吻合）。

### 修法与验证

```
修法: 清单加 <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
      （protectionLevel=normal 的安装期权限，不弹窗、无用户可见影响）
验证: 重新构建装机后，getUserMedia **一次成功**（ok:true, 517ms）
```
→ **没有写任何自定义 WebChromeClient**，也没有绕开 Capacitor。

## 三、⚠️ P10 暴露的新问题：**拿不到 duration**（这是真问题，不是探针写错）

```
P9 : audio.onloadedmetadata 触发（ok:true，无 error）
P10: audio.duration = **null**（因此"duration > 0"判 FAIL）
```

**原因（已知的 WebM 特性，非本设备缺陷）**：
`MediaRecorder` 产出的 WebM 属于**"live/流式"profile，头部不含 duration 元素**，
因此 `<audio>` 在**不 seek 的情况下**拿到的是 `Infinity`/`null`。
常见规避是"seek 到一个极大值再读 duration"（hack），但**不能保证在原版等价语义下可靠**。

**对我方实现的直接影响（重要）**：

```
❌ 不能靠"解码 blob 的元数据"得到时长
✅ 必须在**录音时自己计时**（记录 start/stop 的单调时钟差），并把时长作为消息的一部分持久化
   → 这正是审核要求"009 与 media.duration_ms 一起冻结"的原因 —— 现在有了实证依据：
     duration **不是**可以从音频文件里读出来的，**必须自己存**
```

→ 即：`media.duration_ms BIGINT NULL CHECK (duration_ms IS NULL OR duration_ms > 0)`
   从"可能要加"变成 **"必须加"**（否则气泡无法显示时长，也就无法满足验收 ④）。

## 四、⚠️ P3（真实授权 UI）为何是 NOT_EVALUATED：**测试前置有软性干扰**

```
探针前: RECORD_AUDIO granted=false, flags=[USER_SET|USER_SENSITIVE_WHEN_GRANTED|USER_SENSITIVE_WHEN_DENIED]
探针中: getUserMedia 直接成功（517ms），**轮询未见任何 permissioncontroller 焦点**
```

**解释**：`adb shell pm revoke` 属于**软撤销** —— 它把状态置为未授予，但**系统仍记得该权限曾被授予**，
于是再次请求时**静默重新授予、不弹窗**。因此本次**没有走到"从未授予 → 弹窗"这条路径**。

**所以要真正验证 P3**，必须让应用处于**从未请求过该权限**的状态，例如：
```
· adb shell pm clear com.campusx.demo      （清应用数据 → 同时清权限历史；代价：需重新登录）
· 或卸载后重装
```
**代价与取舍**：`pm clear` 会清掉 localStorage 里的登录态（需重新走登录，本项目有
`scripts/m3/device-login-helper.ps1` 可用）。**我倾向做这一步**，因为 P3 是审核清单里的一项，
而且它正是"要不要写自定义 WebChromeClient"的判据 —— 现在虽然已经能工作，但**"首次授权是否有 UI"仍未被证据覆盖**。

### 另一个必须单独测的：**拒绝路径**

```
permission denied → NotAllowedError → zero upload → zero message
```
（即拒绝时**不得**产生任何上传与消息。本次尚未测。）

## 五、本次**没有**做的事

- 没有写任何自定义 WebChromeClient / 没有改 Capacitor 源码
- 没有触碰原版 app
- 没有上传任何媒体到我们的服务器（本次 blob 只留在内存里做 size/解码检查）
- 没有改 DB / 没有创建迁移（009 仍**未落**，等 §三 的 `duration_ms` 结论一起冻结）

## 六、下一步（建议顺序）

```
1. 用 pm clear 做**一次干净首次授权**测试 → 覆盖 P3（是否出现真实授权 UI）
2. 做**拒绝路径**测试（denied → NotAllowedError → zero upload → zero message）
3. 两项都清楚后，一次性冻结**迁移 009**：
     · media.mime 白名单只加 audio/webm（实测 mimeType 就是 audio/webm，无 codecs 后缀）
     · media.duration_ms BIGINT NULL + CHECK（**必须加**，见 §三）
     · 服务端对 audio/webm 做 **WebM/EBML 容器 sniff**（不信 multipart Content-Type）
4. 再写产品代码（Phase 1）
```

---

## 七、P3 定论（截图证据）：**本设备无权限弹窗 —— 权限被静默授予**

> 时间：2026-09-21 23:14｜方法：`pm clear` 置于"从未请求过"→ 触发 getUserMedia → 每 0.6s 截图（用 `adb pull`，非 PS 重定向）→ 视觉读图

### 结果

```
重置后权限状态: RECORD_AUDIO granted=false, flags=[USER_SENSITIVE_WHEN_GRANTED|USER_SENSITIVE_WHEN_DENIED]
                （**无 USER_SET** → 真正的"从未请求过"）
触发 getUserMedia: **ok:true, 270ms**（成功）
截图 8 帧哈希:   帧0=E05B… 帧1=7FE5…（**唯一不同的一帧**）帧2-7=E05B…
视觉读图结论:
  · **没有任何 Android 运行时权限弹窗**
  · 帧1 与其余帧的唯一差别 = 状态栏多了**绿色麦克风使用指示图标**
最终权限状态: RECORD_AUDIO granted=**true**, flags=[**USER_SET**|…]
```

### 结论（必须按此表述，不得夸大）

```
P3  是否出现真实 Android 授权 UI:  **NOT_OBSERVED（本设备自动静默授予）**
    性质: **设备特性**，不是应用缺陷 → 按本项目分类属 ENVIRONMENT，不属 PRODUCT_DEFECT
    依据: 8 帧截图无任何权限弹窗；权限状态却从"从未请求"变为 granted=true + USER_SET
    含义: **不能宣称"真实用户会看到授权提示"** —— 本设备上不会
WEB_API_CAPTURE_PREREQUISITE: **PASS（采集链路可用）**
    依据: 三次独立运行均 getUserMedia ok:true / P5-P9 全 PASS
```

### 为什么这**不**触发审核说的"写 WebChromeClient"那条分支

审核的原话是：

> 如果加 manifest 后**仍然完全没有系统授权流程**，不要让实现者自行继续写 WebChromeClient。
> 那时状态应是 `WEB_API_CAPTURE_PREREQUISITE: FAIL` …

**但实际结果是 `PASS`**：授权流程**确实发生了**（权限从"从未请求"变成了 granted=true + USER_SET），
只是**它的 UI 在本设备上没有出现**。二者不同：
- 前者（完全没流程）= 桥没接上 → 需要 native 工作
- 后者（有流程、无 UI）= **设备自动授予策略** → 应用侧无需改动

→ 因此**不需要**写 WebChromeClient、**不需要**改 Capacitor 源码，也没有违反审核禁令。

### ⚠️ 必须在报告里说明的**证据边界**

```
本结论的适用范围: **仅 MuMu 模拟器（Android 12 / SDK 32, ro.build.type=user）**
未覆盖: 真实手机上"首次请求是否弹窗" —— 本设备不弹，故**无法由此推断真机行为**
建议: 该项记为 PERMISSION_UI_ON_THIS_DEVICE: NOT_OBSERVED
      （而不是 "PERMISSION_UI: PASS/FAIL"）
      —— 因为该观测的缺失源于设备策略，不能作为产品行为的结论
```

### 我本次的方法错误（已修正，值得记）

第一次截图我用 `adb exec-out screencap -p > file` —— **PowerShell 的 `>` 重定向会对二进制做文本转换**，
产出的 PNG 头是 `FF FE FD FF 50 00 4E 00`（不是 `89 50 4E 47`），**文件已损坏**，
并被视觉工具以"unsupported image"拒绝。

**改用 `adb shell screencap -p /sdcard/x.png` + `adb pull`** 后头部正常（`89 50 4E 47`）。

→ 纪律：**在 PowerShell 里不要用 `>` 接二进制输出**；要么用 `adb pull`，
要么显式按字节写文件。（这与本项目已记录的"PowerShell 编码/引号坑"同族。）

## 八、下一步：拒绝路径测试（本设备自动授予，须用 AppOps 强制拒绝）

因为本设备会自动授予，常规 `pm revoke` 后仍会被静默重授，**无法用它测拒绝路径**。
改用 **AppOps** 强制拒绝（即使权限状态是 granted，也能让系统在调用时拒绝）：

```
adb shell appops set com.campusx.demo RECORD_AUDIO deny
→ 触发 getUserMedia → 期望 NotAllowedError
→ 并验证"零上传、零消息"（对服务器 DB 与上传目录做只读核对）
```

测试后必须 `appops set com.campusx.demo RECORD_AUDIO allow` 还原，避免留下污染状态。
