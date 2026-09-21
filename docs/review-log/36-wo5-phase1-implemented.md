# 审核提交 36：WO#5 Phase 1 实现完成（语音消息：录/传/发/气泡播放）

> 提交时间：2026-09-22 00:39｜审核方：ChatGPT web｜commit `daa49f0`（已 push）
> 依据：审核记录 35 —— `WO5_PHASE1_IMPLEMENTATION: APPROVED`

## 一、范围（严格照审核给定，未扩张）

```
长按录音 → 松开发送 → real audio/webm Blob → /api/media (purpose=chat + durationMs)
→ kind=voice + mediaId → private media → voice bubble → persisted duration
→ authenticated blob fetch → play/pause → reload still works → sender left/right 沿用既有 contract
Phase 2（录音浮层 / 上滑取消）：**未并入**（"上滑取消"无行为证据，按审核要求不凭惯例实现）
```

## 二、服务端改动

| 文件 | 改动 |
|---|---|
| `server/src/audioProbe.ts`（新增） | EBML/WebM **容器探测**。⚠ 声明强度按审核要求写死：证明"结构有效的 WebM 容器"，**不是**"只有音频轨" |
| `server/src/index.ts` `/api/media` | 接受 `durationMs`；**audio/webm 必须带正 durationMs**；**image/\* 禁止带**（不静默忽略）。一致性在**写文件之前**判定 → 不产生"文件已落盘但无 DB 行"的 orphan |
| `server/src/index.ts` 消息路由 | `media_requires_image_kind` → **泛化**为 `media_requires_media_kind`；事务内新增 **kind ↔ mime 相容性**（voice+图片 / image+音频 都拒）；用 **mime 前缀**而非具体枚举，避免白名单扩张时漏改 |
| `server/src/index.ts` 读模型 | media JSON 补 **`mime` 与 `durationMs`** —— 这是"reload 后不必重新下载音频也能显示时长"的关键 |

## 三、客户端改动

| 文件 | 改动 |
|---|---|
| `app/src/native/recorder.ts`（新增） | 与 `camera.ts`/`geo.ts` 同层。**用 `performance.now()` 单调时钟计时**（因 live/WebM 文件头不含 duration，P10 实测）；错误分类 `permission_denied`/`no_device`/`unsupported`/`failed`；**空 blob 视为失败**（不发"空语音"） |
| `app/src/screens/ChatScreen.tsx` | 麦克风按钮 `pointerdown` 录音 / `pointerup` 发送 / `pointercancel`·`pointerleave` 取消；录音中显示秒数；**拒绝权限时给明确提示且不发起任何网络请求**；新增 `VoiceMessage` 气泡（时长 + 播放/暂停，走与图片同一条鉴权 blob 链路） |
| `app/src/api/client.ts` | `uploadMedia` 支持 `durationMs`；新增 `postThreadVoiceMessage` / `VOICE_MESSAGE_BODY` |

**语音气泡的形态依据**（不凭惯例发明）：原版结构是
`voiceContainerView → voice_msg_ll → 播放控件 + TextView(voice_msg_text)`
（来自 APK 布局 dump，见 WO5-PLAN §2.2），即"播放控件 + 一段文字（时长）"。
波形的具体形态**无行为证据**，故只做被证据支持的部分。

## 四、真机验证结果（全部真机，非仅服务端）

### 4.1 产品链路

```
POST /api/media   → 201 {"mime":"audio/webm","bytes":10593,"durationMs":3082,"scope":"private"}
POST /messages    → 201 {"kind":"voice","mediaId":"…"}
GET  /messages    → 200（含该 voice 消息，media 带 mime + durationMs）
GET  /api/media/:id → 200（音频字节）
界面              → 语音气泡 "▶3″"，data-duration-ms="3082"
刷新后            → durAttrs 仍为 ["3082"] ✓（不重新下载音频）
```

### 4.2 判定（干净一次，已修掉 harness 的 3 个缺陷后）

```
VERDICT = { media201:true, message201:true, serverKind:"voice", serverMime:"audio/webm",
            serverDurationMs:3173, uiDurationMs:"3173", durationMatches:true,
            heldMs:3404, durationWithin1s:true, survivesReload:true, PASS:true }
```

### 4.3 ⑦a 拒绝代码路径（桩触发 `NotAllowedError`）

```
errText = "没有麦克风权限，无法录音（请在系统设置里允许本应用使用麦克风）"
net = []                                  ← **零网络调用**
VERDICT = { errorShown:true, mentionsPermission:true, zeroMediaUpload:true,
            zeroMessageCalls:true, netCallCount:0, noGhostBubble:true,
            notStuckRecording:true, PASS:true }
```

## 五、Gate：新增 9 个键 + 修掉一个 **GATE_DEFECT**

### 5.1 新增键（全部 PASS）

```
M5_VOICE_MEDIA_MIME_WHITELIST      PASS   表结构：media.mime 白名单含 audio/webm
M5_VOICE_MIME_DURATION_CONSISTENT  PASS   表结构：MIME ↔ duration 一致性约束存在
M5_VOICE_NEGATIVE_ASSERTIONS       PASS
M5_VOICE_A4_1 .. A4_5              PASS   逐条交叉检查**具体错误码**
```

**交叉检查的设计意图**：不只断言"整体 PASS"，而是要求每条断言行里**出现预期的错误码字面**
（`missing_duration_ms` / `unexpected_duration_ms` / `audioReason` / `media_kind_mismatch`×2），
用来防"**因错误的原因通过**"。全部用 ASCII，不用中文（中文会被 esbuild 转义成 `\uXXXX` → 假阴性）。

### 5.2 ⚠️ 修掉一个真实的 GATE_DEFECT（**"不可能失败的门禁"**）

```
gate-server.sh 末尾原为：
  echo "#   FILE_INPUT_POST_SELECTION_E2E:       PASS"exit "$([ "$FAILED" -eq 0 ] && echo 0 || echo 1)"
                  ↑ exit 被拼在 echo 之后（缺换行）
bash 把 "exit" 当成 echo 的又一个参数 → **exit 从未执行** → **gate 永远返回 0，失败也不报错**
```

**已修**（exit 独立成行 + 注释警告"勿再合并"），并**用注入失败实测**：

| 场景 | M5_SERVER_GATE_RESULT | REAL_EXIT |
|---|---|---|
| 正常 | PASS | **0** |
| 注入失败（替换 verify-voice-negative 为必然失败版） | **FAIL** | **1** |
| 还原 | PASS | **0** |

→ 既证明修复生效，也证明门禁**能失败且会点名具体缺失项**（5 条交叉检查各自报 `FAIL(未看到 xxx)`）。

## 六、`verify-message-media.sh` A6 的期望值更新（**有意为之，非放宽**）

`text + mediaId` 的错误码随泛化更名为 `media_requires_media_kind`。
断言改为**精确匹配新码**——**不用"新旧皆可"**，因为放宽匹配就等于偷偷放松契约。
若将来有人改回旧名，这条会 FAIL，**那是正确的**（那是一次未登记的契约变更）。
已核对 `app/src` 无任何按该字符串分支的代码（客户端只依赖 400 + 明确 reason）。

## 七、我本次修掉的 3 个 **harness 缺陷**（都是"断言因错误原因通过"）

1. **负向断言第一版用自己拼的假 WebM**：头长度编码写错（`0x88` 应为 `0x84`），
   服务端把它判成"不认识的文件类型" → A4.1 拿到的是 `not_an_image` 而**不是** `missing_duration_ms`，
   **通过了但没测到目标行为**。
   → 改为用**真机录制的真 WebM** 做 fixture，并加"fixture 必须能正常上传"的**前置断言**
     （不合法就 `FATAL` 退出，不允许后续断言在 fixture 无效的情况下假通过）。
2. **A4.5 的 `$AUD_ID` 为空** → 得到 `bad_media_id`，同样没测到 `kind↔mime` 错配。被同一前置断言拦住。
3. **真机 E2E 判定脚本两处**：用**相对 URL** 打 API（打到 WebView 本地服务 → 返回 HTML）；
   以及按**数组下标**配对界面气泡与服务端记录（页面有多条语音时配错）。
   → 改为**绝对 API origin** + **按 `mediaId` 配对**。

## 八、测试残留已清理

```
回到纯种子基线：users=3 / messages=2 / media=2 / board_notes=1 / message_media=0
cleanup.mjs --json → orphans:[] unattached:[] unattachedMissingFile:0
（清理过程本身发现并删除了一个由我第一版有缺陷脚本遗留的孤儿 media）
```

## 九、仍**未**验证 / 明确不做

```
VOICE_PERMISSION_DENIED_SYSTEM_E2E: NOT_EVALUATED
  本设备（MuMu A12/SDK32）无法构造系统级拒绝：appops deny 已生效但 WebView 仍取到音轨
  （虚拟音频设备不施加该限制）。**不得**用 ⑦a 的桩通过来声称系统拒绝路径可用。
ANDROID_PERMISSION_UI_VISIBLE: NOT_OBSERVED（本设备静默授予）
  不得推广到真实 Android 设备；产品代码不依赖"系统一定会弹框"。
VOICE_TO_TEXT: NOT_IMPLEMENTED（不可复刻：依赖对方 ASR 服务；不冒充）
Phase 2（录音浮层 / 上滑取消）：未做（"上滑取消"无行为证据）
```

## 十、请裁定

1. **WO#5 Phase 1 是否可记为 PASS / CLOSED？**（含 §九 的三项 NOT_EVALUATED/NOT_IMPLEMENTED 标注是否可接受）
2. 把 `media_requires_image_kind` 更名为 `media_requires_media_kind`、并**精确匹配新码**更新旧测试
   —— 这个处置是否认可？（我特意没选"新旧皆可"的宽松匹配）
3. Gate 新增的 9 个键与 3 条防"因错误原因通过"的设计是否合格、有无遗漏？
4. 修掉的 GATE_DEFECT（exit 未执行 → gate 永不失败）是否需要额外动作？
   （我倾向把它写进纪律：**gate 必须用"注入一次失败"证明它能失败**）
5. 下一步优先级建议：Phase 2（录音浮层）？还是回到 AUDIT 里的其它项？

## 十一、证据

`docs/m5/WO5-PLAN-voice-message.md`、`docs/m5/PROBE-recording-capability.md`、
`docs/m5/PROBE2-recording-capture.md`、`scripts/m5/verify-voice-negative.sh`、
`scripts/m5/cleanup-voice-residue.sh`、`scripts/gates/m5/gate-server.sh`、
`scripts/m5/probes/*`、`server/src/audioProbe.ts`、`app/src/native/recorder.ts`；
commits `daa49f0`（本单实现）、`37e04c7`/`342aaba`（迁移 009/010）、`63cc1cb`（MODIFY_AUDIO_SETTINGS）
