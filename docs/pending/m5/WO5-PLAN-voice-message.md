# WO#5 计划报审：语音消息（voice message）—— **只定义用户可见契约，不复制原版实现技术**

> 状态：**待审核批准，尚未动任何代码**（遵守"先报计划，再动代码"）
> ⚠️ 本计划已吸收审核记录 32 的教训：**conformance 定义在用户可观察的 contract 上**，
> 不是原版的实现技术（Lottie / ConstraintLayout / Android View 类型都不进验收标准）。

## 一、为什么做这一项

按 `docs/test/AUDIT-M0-M4.md` 附七 的 2×2 重排，本项属于 **(B) 有原版证据 + 我方未实现 = 真实实现缺口**：
- 原版**有**完整语音功能（证据见 §二），且面比"能发语音"更宽（含**语音转文字**）
- 我方现状是**类型预留 + 界面占位 + 明确标注未实现**（`PublishScreen.tsx:33/294/320`、
  `MeScreen.tsx:122-129` 静态卡；服务端 `index.ts:1538` 只校验 `kind` 枚举）→ **没有谎报**

## 二、原版证据（**用户可见**层级；来自 APK 资源表 + 布局，全程只读）

### 2.1 录音浮层（`layout/im_chat_voice_layout`）

```
recordVoiceMask / recordVoicePopup        遮罩 + 浮层
voiceWaveAnimBg + 4×动画控件              波形/录音动画
TextView  text="松开发送"  textSize=18sp  bold  textColor=#cc000000
TextView  textSize=14sp    bold  textColor=#ffe2374a   ← 红色（提示类文案）
ImageView id=voiceTrash  contentDescription="删除"      ← 取消/删除区
```

**用户可见事实**：按住说话会弹出全屏浮层，上面有波形动画、
「**松开发送**」提示（18sp 粗体）、一条**红色提示**（14sp 粗体）、以及一个**删除区**。

### 2.2 语音消息气泡（左右两套）

```
im_chat_subitem_voice_left_layout （对方）
  ConstraintLayout(id=voiceContainerView) → LinearLayout(id=voice_msg_ll)
    播放控件(voice_play_lottie) + TextView(id=voice_msg_text)
im_chat_subitem_voice_right_layout（自己）
  ConstraintLayout(id=voiceContainerView)
    View(id=**voice_redDot**) ← 未读红点
    LinearLayout(id=voice_msg_ll) + TextView(id=voice_msg_text, 有 textColor)
```

**用户可见事实**：语音消息是一个**可播放的气泡**（含播放控件 + 一段文字，很可能是时长），
左侧/右侧两套（与文字消息一致的方向体系，且这套体系我们**已实现并验证过**），
自己发的还有**未读红点**。

### 2.3 语音转文字（存在，但对我方可能不可达）

```
id/voice_to_text_btn    id/voice_text    id/voice_text_loading_lottie
id/tvAsrText  id/asrScrollView  id/clRecognize  id/vRecognizeFailure
drawable/im_chat_voice_to_text_bg(_night)
```

**用户可见事实**：语音气泡上有一个**"转文字"按钮**，点击后加载、然后显示转写文本（含失败态）。

⚠ **但"转文字"背后是 ASR 服务**（`clRecognize`/`vRecognizeFailure` 暗示云端识别）。
**我们不具备复刻对方 ASR 服务的等价条件** —— 这一点必须**显式记为原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充**，不能用假文本冒充。

## 三、本单**做什么**（分阶段，避免一次吞太大）

### Phase 1（本单主体，建议批准的范围）

| # | 内容 | 用户可见行为 |
|---|---|---|
| 1 | **按住说话** | 长按录音按钮 → 开始录音；松手 → 结束并发送 |
| 2 | 录制 | 用 `MediaRecorder`（WebView 原生支持）+ Android 麦克风权限 |
| 3 | 上传 | 复用**既有** `/api/media` 上传链路（`kind` 用已有的 `voice`） |
| 4 | 发送 | `POST /api/threads/:id/messages`，`kind='voice'` + `mediaId`（**服务端已支持该 kind**） |
| 5 | **语音气泡渲染** | 显示**时长**（如 `12″`）+ 播放控件；点击播放/暂停；**沿用已验证的左右方向体系** |
| 6 | 权限被拒 | 明确提示，不静默失败 |

### Phase 2（同单但可选，若 Phase 1 顺利）

| # | 内容 |
|---|---|
| 7 | 录音浮层：波形动画（**用 CSS/Canvas 自绘，不引入 Lottie**）+「松开发送」文案（18sp 粗体，与原版同尺寸） |
| 8 | **上滑取消** + 红色提示（14sp 粗体，`#ffe2374a`）+ 删除区 |

### 明确**不做**（写清边界）

```
✗ 不实现"语音转文字" —— 背后是对方的 ASR 服务，**原版等价的服务/语义在当前范围内不可获得或无证据**；
  记为 `VOICE_TO_TEXT: NOT_IMPLEMENTED（原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充：依赖对方 ASR 服务）`，
  **不得用假文本冒充**
✗ 不引入 Lottie（原版用它做动画，但那是实现技术，不是产品 contract）
✗ 不改留言板/动态等其它界面
✗ **不修改任何已应用的迁移文件**（006 等已校验和锁定）
```

## 三bis、⚠️ 服务端必须改（**我起初写错了，已更正**）

我最初写"`kind` 已存在，无需改 API/DB schema"——**核实后发现这是错的**。
语音落地需要**三处服务端改动**：

### (1) `media.mime` 约束**结构性排除了音频** → 需**新增迁移 009**

```sql
-- server/src/migrations/006_media_scope.sql（已应用，**不得修改**）
CONSTRAINT media_mime_allowed CHECK (mime IN ('image/jpeg','image/png','image/webp'))
```

→ 必须**新建** `009_voice_media.sql`（本项目规则：迁移一经应用即校验和锁定，
**只能追加、不能改**），把 `media_mime_allowed` 扩展为同时允许音频类型，
例如 `audio/webm` / `audio/mp4` / `audio/aac`（**具体允许哪几种由实测的 MediaRecorder 输出决定**）。

⚠ **`audio/*` 的范围要窄**：不要写成 `mime LIKE 'audio/%'` 就放开，
应**显式枚举**（与该约束原本"拒绝 SVG 与任意 binary"的意图一致）。

### (2) `media_requires_image_kind` 需**泛化**为"kind ↔ mime 相容性"检查

```
现状（index.ts）: if (mediaId !== null && kind !== 'image') → 400 media_requires_image_kind
  即"带媒体就必须是图片消息"
需要:           改为"kind 与媒体的 mime 类必须相容"
                · kind='image' → 媒体必须是 image/*
                · kind='voice' → 媒体必须是 audio/*
                · 不相容 → 400（**保持"自相矛盾载荷直接拒、不写任何行"的既有原则**）
```

⚠ 这是一处**语义收紧 + 扩展**，必须**同时保住原有的拒绝行为**
（文字消息带 mediaId 仍应 400），否则会退化成一个更松的接口。

### (3) `purpose` 枚举：**可以不改**

```
现状: purpose ∈ ['post','chat']  → 映射到 scope（post→public / chat→private）
语音: 复用 'chat'（private）即可 —— 语音是聊天内容，与图片同域**语义正确**
     → **不新增 purpose**，避免为了一个新 kind 扩张接口面
```

### (4) `width` / `height`：**不用动**

`media_dimensions_positive` 允许 NULL（`width IS NULL OR width > 0`），
音频没有宽高 → 存 NULL 即可，**无需迁移**。

### 对既有已验证行为的影响（必须回归）

```
· mediaIds 数组仍应 400（A7 回归键，M5 gate 里有）—— 本次改动不得放宽它
· 图片消息链路（WO#2 三层 E2E）不得回归
· .tmp 自愈、unattached TTL GC 不受影响（mime 扩展不改变 GC 逻辑）
```

## 四、验收标准（**只写用户可见的事实**）

```
VOICE_MESSAGE_RECORD_AND_SEND: PASS
  ① 长按录音按钮 → 实际采集到音频（MediaRecorder 产出非空 blob）
  ② 松手后 `/api/media` 返回 201，且 `kind='voice'` 的消息 `POST /messages` 返回 201
  ③ DB 里该消息 kind='voice' 且正确关联 media（**DB 为 oracle**）

VOICE_BUBBLE_PLAYBACK: PASS
  ④ 气泡显示**时长文本**（形如 `12″`），数值与真实录音时长一致（允许 ±1s）
  ⑤ 点击可播放；再点可暂停；播放态可见（**渲染几何/状态为 oracle**）
  ⑥ **左右方向与文字消息一致**（沿用已 PASS 的 senderId → --me/--peer 逻辑）

VOICE_PERMISSION_DENIED: PASS
  ⑦ 拒绝麦克风权限时有明确提示，不出现"发送了空音频"这种静默失败

VOICE_TO_TEXT: NOT_IMPLEMENTED（原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充：依赖对方 ASR 服务）  ← 明确保留，不得写成 PASS
```

**oracle 来源**（按已冻结纪律）：DB 查 kind 与 media 关联 · HTTP 201 · 渲染几何与状态 ·
`MediaRecorder` 产出的 blob 实际长度。

## 五、风险与回退

| 风险 | 处置 |
|---|---|
| **WebView 里 MediaRecorder 受限**（Capacitor WebView 对 getUserMedia 的支持需实测） | **先做可行性验证**（不改产品）：在设备上跑一个最小页面测 `MediaRecorder` 能否拿到数据；若不可用 → 报告 `VOICE_RECORDING_UNSUPPORTED`，**不做半成品** |
| Android 麦克风权限未在 manifest 声明 | 需加权限；记录该改动 |
| 时长计算与实际不符 | ④ 用真实时长比对（允许 ±1s） |
| 上传体积 | 语音通常小于图片；沿用既有体积上限 |

**回退原则**：若可行性验证不通过，本单**停在"报告不可行"**，不提交半成品代码。

## 六、请审核裁定

1. **批准 Phase 1**（录/传/发/气泡播放）？Phase 2（浮层+上滑取消）是否同单？
2. **语音转文字**我按"原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充"记为 NOT_IMPLEMENTED、不冒充 —— 是否同意？
3. 验收标准（§四）是否合格？特别是 ④ 的"时长文本 ±1s"是否合理？
4. **是否需要我先做一次"MediaRecorder 可行性验证"**（不改产品，只报告能否采集）？
   我倾向**先做这一步**，因为若 WebView 不支持，整个 Phase 1 都要改成原生桥接，方案会不同。

---

## 七、✅ 可行性验证已完成（2026-09-21 22:35，**不改产品**）

> 完整结果见 `docs/pending/m5/PROBE-recording-capability.md`

### 结论：**Phase 1 可行，不需要原生桥接**

```
hasMediaRecorder: true         ← WebView 里 MediaRecorder 存在
isSecureContext:  true         （https://localhost，满足 getUserMedia 要求）
supportedMimes:   [ 'audio/webm', 'audio/webm;codecs=opus' ]   ← **只有 webm/opus**
                             （不支持 audio/mp4 / audio/aac / audio/ogg;codecs=opus / audio/3gpp）
hasPermissionsAPI: **false**   ← 没有 navigator.permissions.query，**无法静默预检权限**
```

### 但实际采集**当前必然失败**（实测）

```
getUserMedia({audio:true}) → NotAllowedError / "Permission denied"（1362ms）
且**没有出现系统弹窗**（焦点仍在我方 App）
原因: 我方 APK **未声明 RECORD_AUDIO** —— Android 对未声明权限**直接拒绝且不弹窗**，
      用户**连授权机会都没有**
```

### 由此**新增三条硬前置**（补进本计划）

```
PREREQ-1  清单加 <uses-permission android:name="android.permission.RECORD_AUDIO" />
          （不加则永远 NotAllowedError 且无弹窗 —— 已实测证实）
PREREQ-2  实测 Capacitor WebView 是否会把 getUserMedia 权限请求转给系统；
          若实测不弹窗 → 需自定义 WebChromeClient（**这一步必须实测，不能假设**）
PREREQ-3  迁移 009 的音频白名单**就写 audio/webm**
          （最终以实测的 MediaRecorder.mimeType 为准；opus 是 codecs 参数，不单列）
```

### 实施顺序据此调整为（**先验证再写码**）

```
1. 加 RECORD_AUDIO 清单权限 → 重新构建装机
2. **重跑探针**验证: ① 是否出现系统授权弹窗 ② 授权后 MediaRecorder 能否产出**非空 blob**
   → 通过才继续；不通过则报 VOICE_RECORDING_UNSUPPORTED **并停在报告**
3. 再写产品代码
```

### 仍未验证的部分（如实标注）

```
· "MediaRecorder 真能产出非空 blob" —— **尚未验证**（本次因权限未声明而失败，未走到那一步）
· PREREQ-2 的弹窗行为 —— **尚未验证**（同上）
```

⚠ 因此本计划的状态仍是**待批准**；若审核同意，实施第一步就是 PREREQ-1 + 重跑探针。