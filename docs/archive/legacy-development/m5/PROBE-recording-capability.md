# 探针结果：我方 App WebView 的**录音能力**（WO#5 的前置事实）

> 时间：2026-09-21 22:35｜方式：CDP 只读探测我方 App 的 WebView（`https://localhost/#/campus`）
> 设备：MuMu `127.0.0.1:16384`；**先跑了设备健康探针 → `DEVICE_HEALTH OK`**（项目纪律）
> 性质：**纯探测** —— 不改产品、不写服务端、不安装任何东西、不触碰原版 app

## 一、API 可用性（结论：**可用，无需原生桥接**）

```
hasMediaDevices      : true
hasGetUserMedia      : true
hasEnumerateDevices  : true
hasMediaRecorder     : true      ← ★ MediaRecorder 存在于 WebView
hasAudioContext      : true
isSecureContext      : true      （origin = https://localhost，满足 getUserMedia 的安全上下文要求）
hasPermissionsAPI    : **false** ← 没有 navigator.permissions.query
audioInputs          : 1 个（deviceId="default"；未授权时 label 为空）
```

**支持的音频 mime（重要）**：

```
supportedMimes: [ "audio/webm", "audio/webm;codecs=opus" ]
```

→ **只支持 webm/opus**；**不支持** `audio/mp4` / `audio/aac` / `audio/ogg;codecs=opus` / `audio/3gpp`
（这些在 `MediaRecorder.isTypeSupported` 下均为 false，已被过滤掉）。

## 二、实际采集尝试（结论：**当前必然失败，且连弹窗都不给**）

```
navigator.mediaDevices.getUserMedia({ audio: true })
  → ok: false
  → 耗时 1362 ms
  → name: "NotAllowedError"
  → message: "Permission denied"
```

**同时确认：没有出现系统权限弹窗**（`mCurrentFocus` 仍为 `com.campusx.demo/.MainActivity`）。

**原因**：我方 APK 的清单里**没有声明 `RECORD_AUDIO`**。Android 对**未声明**的权限
是**直接拒绝且不弹窗** —— 因此用户**连授权的机会都没有**。

`aapt2 dump permissions app-debug.apk` 的实际输出：

```
INTERNET / CAMERA / READ_MEDIA_IMAGES / READ_EXTERNAL_STORAGE(maxSdk 32)
ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION / ACCESS_NETWORK_STATE
（**无 RECORD_AUDIO**）
```

## 三、这些事实对 WO#5 的直接影响（逐条落到计划上）

| 事实 | 对计划的影响 |
|---|---|
| `MediaRecorder` 可用 | ✅ **Phase 1 可行，不需要原生桥接** —— 原计划里"若不可用则改原生桥接"的分支**不必走** |
| 只支持 `audio/webm`（+opus） | ✅ **迁移 009 该允许的具体类型有了答案：`audio/webm`**（不要凭想象列 mp4/aac） |
| 未声明 `RECORD_AUDIO` → 自动拒绝且无弹窗 | ⚠️ **必须先加清单权限**（这是 Phase 1 的**硬前置**，不是可选项） |
| 无 `navigator.permissions` | ⚠️ **无法静默预检权限**；只能"直接调用并捕获错误"来判定拒绝 → 权限 UX 要按此设计 |
| `isSecureContext: true` | ✅ 满足 `getUserMedia` 的安全上下文要求（`https://localhost`） |
| 1 个音频输入设备 | ✅ 设备侧有输入源 |

## 四、由本次探针**新增**的前置条件（补进 WO#5 计划）

```
PREREQ-1  在 app/android/app/src/main/AndroidManifest.xml 加
          <uses-permission android:name="android.permission.RECORD_AUDIO" />
          （不加则永远 NotAllowedError 且无弹窗 —— 实测已证）

PREREQ-2  Capacitor WebView 需把 getUserMedia 的权限请求转给系统
          （Capacitor 在权限已声明时由 WebChromeClient.onPermissionRequest 处理；
           若实测不弹窗，则需要自定义 WebChromeClient —— 这一步要实测确认）

PREREQ-3  迁移 009 的音频 mime 白名单**就写 audio/webm**
          （最终以实测到的 MediaRecorder.mimeType 为准；opus 是 codecs 参数，不单列）
```

## 五、本次**没有**做的事（如实记录）

- **没有**实际录到音频（因权限未声明而失败）→ 因此"MediaRecorder 真能产出非空 blob"**仍未验证**
- 没有修改任何产品代码、没有安装 APK、没有改清单
- 没有触碰原版 app（连读都没读）
- 设备状态：仍在我方 App 前台，无残留弹窗/遮罩

## 六、下一步（待审核裁定后）

若审核批准 WO#5，实施顺序应为：
```
1. 加 RECORD_AUDIO 清单权限 + 重新构建装机
2. **重跑本探针**验证：① 是否出现系统授权弹窗 ② 授权后 MediaRecorder 能否产出非空 blob
   （这一步通过，Phase 1 才有意义；不通过则报 VOICE_RECORDING_UNSUPPORTED 并停）
3. 再写产品代码
```
