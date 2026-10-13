# 审核 69：**M5 正式 PASS / CLOSED**（项目 M0–M5 全部关账）

> 时间：2026-09-23 14:00（Round 319）｜我提交：三项 closeout 证据 + 最终干净回归

## 一、最终裁定（原文）

```
WO21_PUBLISH_MEDIA_ATTACH:  **PASS / CLOSED**
WO22_REAL_QR_SCANNER:       **PASS / CLOSED**
WO23_APP_UPDATE:            **PASS / CLOSED**
M5_GLOBAL_REGRESSION_AUDIT: PASS
M5_EXPERIENCE_COMPLETION:   **PASS / CLOSED**
```

> "**可以关账。** 按当前已经冻结的目标 —— 体验/行为等价，纯视觉不作为 M5 blocker ——
>  这轮证据已经足以结束 M5。剩余项目属于**已明确的证据边界、OS 接管边界或后续发布工作**，
>  而不是已知的产品 blocker。"

```
最终冻结状态：
  M0: CLOSED ／ M1: CLOSED ／ M2: CLOSED ／ M3: CLOSED ／ M4: CLOSED ／ **M5: PASS / CLOSED**
```

## 二、逐项裁定

### ① WO#21 PASS / CLOSED
> "上轮唯一的 P0 已经被真正销掉：audio upload → public media → POST mediaIds →
>  post_media → GET detail/list → **audio typed as audio** → **audio ∉ images** →
>  duration preserved。这正是之前缺失的闭环。使用 mime 作为类型事实而不是从
>  width/height 猜，也认可。"

**关于 `VOICE_CONSUMPTION: NOT_IMPLEMENTED` —— 明确判为不阻塞：**
> "不阻塞 WO#21。原因是 Owner 冻结的 ④ 是『**发布页语音真实录音**』，现在已经实现了：
>  真实麦克风 → 真实录音 → 真实时长 → 上传 → 随帖子持久化 → 可权威读取回来。
>  当前没有足够原版证据证明『Feed 内语音播放器』属于这项被冻结范围，
>  所以**不能因为可能存在一个消费侧能力就继续扩大 WO#21**。"
```
PUBLISH_VOICE_CAPTURE:        PASS
PUBLISH_VOICE_PERSISTENCE:    PASS
PUBLISH_VOICE_TYPED_READBACK: PASS
VOICE_CONSUMPTION:            NOT_IMPLEMENTED / **NON-BLOCKING CURRENT SCOPE**
```
⚠️ "若以后取得证据证明原版 Feed 必须播放这种语音帖，那是**新的消费侧 capability gap**，
   **不重开 WO#21**。"

### ② WO#22 PASS / CLOSED —— **接受当前证据，不要求再人工补**
> "你现在已经分别证明了两个关键事实：
>  A. real camera → real frames → same live processing loop
>  B. real QR bitmap → same frame/decode/state path → jsQR → found → payload exact match
>  唯一没有证明的是：physical QR → lens/exposure/focus → camera pixels。
>  这属于最后一段**光学环境 smoke test**，**不是一个已经发现的软件功能缺陷**。"
```
SCANNER_CAMERA_PIPELINE:                  PASS
SCANNER_QR_DECODE_PATH_E2E:               PASS
SCANNER_REAL_PAYLOAD_RESULT:              PASS
SCANNER_CAMERA_OPTICS_SAW_PHYSICAL_QR:    **NOT_EVALUATED**（不阻塞）
```
⚠️ "我不要求为了 M5 专门找手机/真机再补一次。但在**真正发布前**，
   拿手机显示一个 QR 让实际设备扫一下仍然是很有价值的 **release smoke test**；它不再是 M5 Gate。"
⚠️ "jsQR 方案继续认可。**当前只承诺 QR**，不承诺其他码制即可。"

### ③ WO#23 PASS / CLOSED
> "这是一个真实的 **sideload 更新流程**。因此认可你的口径 INSTALL_HANDOFF_TO_OS: INITIATED，
>  而不是 INSTALL_COMPLETED: PASS。Android 安装确认本身属于**系统安全 UI**，
>  正常就需要用户确认。我们不要求 App 静默安装 APK，更不能把『没有自动点击安装确认』
>  视为产品失败。"
```
UPDATE_DISCOVERY:          PASS
APK_AVAILABILITY:          PASS
UPDATE_ACTION:             PASS
INSTALL_HANDOFF_TO_OS:     PASS / INITIATED
DOWNLOAD_COMPLETION:       NOT_EVALUATED
PACKAGE_INSTALL_CONFIRMATION: OS-OWNED / NOT CLAIMED
```
⭐ **措辞建议（已采纳）**：文档里称它为 "**App update flow / install handoff**"，
   **不要**写成 "silent self-update"，避免未来误解。

### ④ Nginx 配置漂移修复 —— 认可
> "这是**实际部署风险，不是洁癖式同步**。仓库自称唯一真源却缺 /media/、/_private_media/、
>  .tmp guards ⇒ 意味着**重建服务器真的会回归**。把已经在生产环境验证工作的配置重新纳入
>  repo 是合理恢复。"
> ⚠️ "不过未来正常方向应该始终是：**repository → deployment → server**，
>  而不是把『服务器现状』天然视为正确答案。这次是一次**已知 drift recovery**，接受，
>  不需要再开专项。"

### ⑤ M5 正式关账的依据
```
27 device gates × (forward + reverse) = **54/54 clean**
**no order-sensitive result**
server gate: PASS ／ CHECK_ALL_LOCAL: PASS
更重要的是：**已经没有已知的未解决 Experience blocker**。
```

## 三、⭐⭐ 关账后的**明确指令**（很重要，防止我再"为验证而验证"）

> "到这里应当**停止**继续从 Gate、自测或原版观察里主动寻找新的 M5 工作。
>  除非接下来发现**真实回归**或**新的明确产品需求**，
>  否则**不要因为『还能再验证一点什么』重新打开 M5**。"

## 四、剩余的**非阻塞/已知限制**（不再混回 M5）

```
NON-BLOCKING / KNOWN LIMITATIONS
- scanner physical-optics smoke            NOT_EVALUATED
- scanner original result routing          NOT_EVALUATED
- original publish-voice exact gesture     NOT_EVALUATED
- voice post playback                      not implemented under current frozen scope
- exact original update destination        NOT_EVALUATED
- certification downstream                 explicitly OUT OF SCOPE
- exact visual/icon/pixel fidelity         → VISUAL_DESIGN_BACKLOG
```
以及 I1/I3 这类**发布前置**工作可以继续，但那已属 **Release / Polish**，不是 M5 completion。
