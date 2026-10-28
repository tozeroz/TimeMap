# 审核记录 34：WO#5 条件批准；下一步 = 权限/采集可行性探针（P0–P10）

> 审核方：ChatGPT web；时间：2026-09-21 23:00（Asia/Shanghai）
> 本轮提交：WO#5 计划 + 录音能力探针结果（`docs/archive/legacy-development/review-log/33-*`）

## 一、正式裁定

```
WO5_PHASE1:    CONDITIONALLY APPROVED
NEXT_STEP:     PERMISSION/CAPTURE FEASIBILITY PROBE
WO5_PHASE2:    SEPARATE SLICE
VOICE_TO_TEXT: NOT_IMPLEMENTED / OUT_OF_SCOPE
MIGRATION_009: DESIGN APPROVED, DO NOT FREEZE YET
```

### 1.1 当前只能记成的事实分档（审核给定）

```
PASS:            MediaRecorder API exists
PASS:            secure context
PASS:            audio input exists
PASS:            supported-type probe points to WebM/Opus
FAIL / missing:  Android permission declaration
NOT_EVALUATED:   real microphone capture
NOT_EVALUATED:   non-empty Blob
NOT_EVALUATED:   WebView permission propagation
```

> 下一步顺序正确：**加 RECORD_AUDIO → 重建装机 → 重新 probe →
> 只有真实录到可播放非空 Blob 后才开始业务实现。**

### 1.2 Phase 2 单独做（**重要限制**）

> 尤其"**上滑取消**"目前**没有直接行为证据**，
> **不要因为常见 IM 都这么做就顺手实现。**

→ 即：`voiceTrash` 的存在只能证明"有一个删除区"，**不能证明"上滑取消"这个交互**。
   要做得先拿行为证据，否则属于**凭惯例推断**。

## 二、⚠️ "原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充"这个措辞被否掉（我写得太绝对）

我写的是"语音转文字**原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充**（依赖对方 ASR 服务）"。审核：

> "原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充"**太绝对**；技术上当然可以接另一套 ASR，只是那**不能证明与原版等价**。

**改为**：

```
VOICE_TO_TEXT: NOT_IMPLEMENTED
ORIGINAL_CONFORMANCE: KNOWN LIMITATION
REASON: original-equivalent ASR semantics/service are not available or evidenced in current scope
```
> 不要生成假转写，也不要把不存在的 ASR 包装成可用。

## 三、⚠️ Migration 009：方向批准，但**先不要落迁移**（本轮最重要的细化）

> `MediaRecorder.isTypeSupported("audio/webm") === true` 能证明浏览器**声称**支持该类型，
> 但**还没有证明这台设备真正录出来的是**：
> ```
> MediaRecorder.mimeType = audio/webm;codecs=opus
> Blob.type              = audio/webm;codecs=opus
> ```

**因此：先完成第二轮 capture probe，再冻结 009。**

### 3.1 冻结 009 时的要求（审核给定）

```
· DB canonical MIME **只允许 audio/webm**
· 把 ;codecs=opus 当 **MIME 参数**解析，**不把整串塞进枚举**
· ⚠ 迁移只能追加不能改 → **不要急着消耗 009**：
  一次把本单真正需要的 schema 冻结完，包括：
    media.duration_ms BIGINT NULL
    CHECK (duration_ms IS NULL OR duration_ms > 0)
  否则会出现"现在做 009=mime，过一小时又发现持久显示时长需要 010"
```

### 3.2 服务端校验要求（审核新增）

> 服务端接受 `audio/webm` 前还必须有 **WebM/EBML 容器 sniff**，
> **不能只相信 multipart 的 Content-Type**。

（与本项目既有的"结构校验而非信任声明"原则一致。）

## 四、第二轮探针：审核给定的**机械流程**（P0–P10）

```
P0   APK manifest 中 RECORD_AUDIO 确实存在
P1   测试前 permission state = denied / not granted
P2   调用 getUserMedia({audio:true})
P3   是否出现**真实 Android permission UI**
P4   用户允许后 stream 获得 audio track
P5   MediaRecorder.start()
P6   实际录制 2–5 秒
P7   stop 后 Blob.size > 0
P8   记录 recorder.mimeType + blob.type
P9   WebView 内 <audio> 能成功解码
P10  metadata duration > 0，且与录制时长合理一致
```

**再单独做拒绝路径**：

```
permission denied → NotAllowedError → zero upload → zero message
```
（即拒绝时**不得**产生任何上传与消息 —— 这正好是我们验收标准 ⑦ 的验证方式。）

## 五、⚠️ 若加了清单**仍然没有**系统授权流程：不得自行继续写代码

> 如果加 manifest 后仍然完全没有系统授权流程，
> **不要让实现者自行继续写 WebChromeClient**。
> 那时状态应是：
> ```
> WEB_API_CAPTURE_PREREQUISITE: FAIL
> CAUSE UNDER INVESTIGATION: WebView permission bridge/runtime permission handling
> ```
> 然后把现有 Capacitor / WebChromeClient 行为核清，**再重新报 native-side 修改方案**。
> 因为那已经从普通前端 WO 变成 **Android host integration**。

## 六、治理要求：**失败的权限改动要回退**

> RECORD_AUDIO 是为了 feasibility 而产生的**真实 APK 改动**。
> 如果 probe 最终 NO-GO 且 WO#5 暂停，
> **不要把一个没有任何可用功能的麦克风权限长期留在正式产品里**。
> 可以在实验分支/临时提交验证；**若方案失败则回退**。

→ 因此本次改动应做成**易于回退**的形式（单一 commit、只动 manifest），
   并在 commit message 里写明"若 NO-GO 需回退"。

## 七、审核对本轮工作方式的评价（值得保留）

> 你这轮"**先 probe 再裁 schema**"的做法值得保留。
> 尤其这里已经直接避免了原计划把 `audio/mp4` / `audio/aac` 等
> **未经设备支持证明的格式**一起放进 allowlist ——
> 这正是 M5 目前最有价值的工作方式：**让真实运行时先决定模型，再让 schema 跟随证据**。

---

⚠ 审核原文末尾自带提示："ChatGPT 可能会出错。请核查重要信息。"
→ 本记录中的**事实性结论**（权限缺失、mime 支持列表、NotAllowedError 等）均以我们自己的实测为准。

## 八、本轮我要执行的动作（按批准顺序）

```
1. 更新 WO#5 计划：Phase 2 拆单 / VOICE_TO_TEXT 改措辞 / 009 延后并含 duration_ms
2. 加 RECORD_AUDIO 到 AndroidManifest（**单一 commit，便于回退**）
3. 重建 APK → 装机
4. 写 P0–P10 探针脚本并执行（含拒绝路径）
5. 记录结果：
   · 全 PASS → 冻结 009 设计（mime + duration_ms + EBML sniff）
   · P3 失败（无授权 UI）→ WEB_API_CAPTURE_PREREQUISITE: FAIL + 核清 Capacitor 行为 + 报 native 方案
   · 若 NO-GO → 回退 RECORD_AUDIO 改动
```
