# 审核提交 33：WO#5（语音消息）计划 + **可行性验证结果**

> 提交时间：2026-09-21 22:33（计划）／22:37（探针补充）｜审核方：ChatGPT web
> 状态：**待裁定**；**未动任何产品代码**

## 一、WO#5 的定位（按 AUDIT 附七 的 2×2）

属于 **(B) 有原版证据 + 我方未实现 = 真实实现缺口**。
我方现状是**类型预留 + 界面占位 + 诚实标注未实现**（`PublishScreen.tsx:33/294/320`、
`MeScreen` 静态卡、服务端只校验 `kind` 枚举）—— **没有谎报**。

## 二、原版证据（**用户可见**层级，只读取得）

```
录音浮层 im_chat_voice_layout:
  TextView「松开发送」18sp bold #cc000000
  红色提示 TextView 14sp bold #ffe2374a
  ImageView(id=voiceTrash) contentDescription="删除"
  波形动画（原版用 Lottie —— **实现技术，不进验收标准**）
语音气泡（左右两套）: voiceContainerView → voice_msg_ll → 播放控件 + TextView(voice_msg_text)
  自己发的另有 voice_redDot（未读红点）
语音转文字: voice_to_text_btn / voice_text / voice_text_loading_lottie / tvAsrText / clRecognize …
  ⚠ 背后是**对方的 ASR 服务** → 我方不具备等价条件 → 拟记 NOT_IMPLEMENTED，**不得用假文本冒充**
```

## 三、⚠️ 我起初写错、核实后更正的部分（本提交最重要的一段）

我原写"`kind` 已存在，无需改 API/DB schema" —— **错**。核实代码与迁移后确认**四处服务端结论**：

| # | 结论 |
|---|---|
| 1 | `media.mime` 约束**结构性排除音频**（`CHECK (mime IN ('image/jpeg','image/png','image/webp'))`）→ **必须新增迁移 009**（006 已应用且校验和锁定，只能追加不能改）；**不要**写成 `mime LIKE 'audio/%'` 放开（与该约束"拒绝 SVG 与任意 binary"的原意冲突） |
| 2 | `media_requires_image_kind` 需**泛化**为 "kind ↔ mime 相容性"（image→image/*、voice→audio/*）；**必须同时保住**"文字消息带 mediaId 仍 400"的既有拒绝行为 |
| 3 | `purpose` 枚举**不改**（复用 `'chat'` → private，语音属聊天内容，语义正确） |
| 4 | `width`/`height` **不用动**（`media_dimensions_precision` 允许 NULL） |

**回归保护**：`mediaIds` 数组仍 400（M5 gate 的 A7 回归键）· WO#2 图片链路三层 E2E 不得回归 ·
`.tmp` 自愈与 unattached TTL GC 不受影响。

## 四、✅ 可行性验证已完成（**只读探测，不改产品**）

> 完整结果：`docs/archive/legacy-development/m5/PROBE-recording-capability.md`
> 复现脚本：`scripts/m5/probes/probe-recorder-apis.mjs`、`probe-recorder-capture.mjs`
> 纪律：探测前已跑设备健康探针 → `DEVICE_HEALTH OK`

```
① MediaRecorder 存在      → Phase 1 可行，**不需要原生桥接**
② 支持的 mime 只有 webm/opus → **迁移 009 白名单就写 audio/webm**
   （不支持 audio/mp4 / audio/aac / audio/ogg;codecs=opus / audio/3gpp）
③ isSecureContext = true  （https://localhost，满足 getUserMedia 要求）
④ hasPermissionsAPI = false → **无法静默预检权限**，只能"调用并捕获错误"
```

### 但实际采集**当前必然失败，且连弹窗都不给**（实测）

```
getUserMedia({audio:true}) → NotAllowedError / "Permission denied"（1362ms）
且无系统弹窗（mCurrentFocus 仍为我方 MainActivity）
原因: APK **未声明 RECORD_AUDIO**（aapt2 dump permissions 已确认）
      → Android 对未声明权限**直接拒绝且不弹窗** → 用户**连授权机会都没有**
```

### 由此新增三条**硬前置**

```
PREREQ-1  清单加 RECORD_AUDIO（否则永远 NotAllowedError 且无弹窗 —— 已实测证实）
PREREQ-2  实测 Capacitor 是否把 getUserMedia 权限请求转给系统；不弹窗则需自定义 WebChromeClient
          （**必须实测，不能假设**）
PREREQ-3  迁移 009 白名单写 audio/webm
```

### 实施顺序据此改为"**先验证再写码**"

```
1. 加 RECORD_AUDIO → 重新构建装机
2. 重跑探针验证 ① 是否弹窗 ② 授权后能否产出**非空 blob**
   → 通过才继续；不通过则报 VOICE_RECORDING_UNSUPPORTED **并停在报告**
3. 再写产品代码
```

## 五、仍未验证的部分（如实标注，不夸大）

```
· "MediaRecorder 真能产出非空 blob" —— **尚未验证**（因权限未声明而失败，未走到那一步）
· PREREQ-2 的弹窗行为 —— **尚未验证**
· → 因此本单仍有"第 2 步可能失败"的风险，**不能说 Phase 1 一定成功**
```

## 六、本次**没有**做的事

未录到音频 · 未改产品代码 · 未安装 APK · 未改清单 · **未触碰原版 app**（连读都没读）·
设备仍在我方 App 前台、无残留弹窗。

## 七、待裁定

1. 批准 Phase 1？Phase 2（浮层+上滑取消）是否同单？
2. 语音转文字按"原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充"记 NOT_IMPLEMENTED、不冒充 —— 是否同意？
3. **新增迁移 009 允许 `audio/webm`** —— 是否批准？（本单唯一触及 DB schema 的改动）
4. 是否批准按"先验证再写码"顺序推进（下一步 = 加清单权限 + 重跑探针）？

## 八、证据

`docs/archive/legacy-development/m5/WO5-PLAN-voice-message.md`（含 §三bis 更正、§七 探针结果）·
`docs/archive/legacy-development/m5/PROBE-recording-capability.md` · `scripts/m5/probes/*.mjs` · commit `5631277`、`b41457a`
