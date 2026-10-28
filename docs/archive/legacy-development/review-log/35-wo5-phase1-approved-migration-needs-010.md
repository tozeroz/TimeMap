# 审核记录 35：WO#5 **Phase 1 正式批准**；MIGRATION 009 需加严（须补 010）

> 审核方：ChatGPT web；时间：2026-09-21 23:24（Asia/Shanghai）
> 本轮提交：P2–P10 探针结果（`docs/archive/legacy-development/review-log/33` 后续的探针回报）

## 一、正式裁定

```
WO5 FEASIBILITY:                 PASS
PHASE 1:                         APPROVED TO IMPLEMENT
PHASE 2:                         SEPARATE LATER SLICE
MIGRATION 009:                   APPROVED
   - add audio/webm
   - add duration_ms
   - **enforce MIME ↔ duration consistency**（加严，见 §三）
   - WebM/EBML container validation
VOICE_TO_TEXT:                   NOT_IMPLEMENTED / OUT_OF_SCOPE
SYSTEM PERMISSION DENIAL E2E:    NOT_EVALUATED
DENIAL HANDLING CODEPATH:        REQUIRED VIA CONTROLLED NotAllowedError STUB
```

> 审核原话："这轮可以正式把 WO#5 从'feasibility'推进到 Phase 1 implementation。
> 你的 probe 已经回答了最关键的问题：**不需要自定义 WebChromeClient，纯 Web API 路线成立**。"

## 二、拒绝路径：**我提的 ⑦a/⑦b 拆分被采纳并冻结**

```
VOICE_PERMISSION_DENIED_CODEPATH:  PASS / FAIL
  验证方式：
    stub getUserMedia → throw NotAllowedError
    → 显示明确错误
    → 0 次 /api/media
    → 0 次 /messages
    → 0 ghost bubble
VOICE_PERMISSION_DENIED_SYSTEM_E2E:  NOT_EVALUATED
  reason: current MuMu environment cannot reliably enforce RECORD_AUDIO denial
```

> 审核确认了我关于"零上传零消息目前平凡成立"的判断：
> "必须等产品代码存在以后，用桩从**真实 UI/业务函数入口**触发拒绝路径。"
> "这里的 stub 只验证**我们的错误处理逻辑**，不验证 Android 权限系统；文档里保持这一区分即可。"

## 三、⚠️ MIGRATION 009：批准，但**要求比我已应用的更强**（因此需要 010）

审核要求把"当前允许的 MIME 与 metadata 关系"一起冻结，而不是只写 `duration_ms IS NULL OR > 0`：

```sql
CHECK (
  (mime IN ('image/jpeg','image/png','image/webp') AND duration_ms IS NULL)
  OR
  (mime = 'audio/webm' AND duration_ms IS NOT NULL AND duration_ms > 0)
)
```

> **"这样 DB 自己也不会接受：`audio/webm + NULL duration`、`image/png + duration=12000`。
> 将来如果真的支持第二种音频格式，再追加 migration 扩约束，
> 不要现在为未来留一个模糊洞。"**

**服务端 API 同样**：
```
audio/webm: durationMs required, positive integer
image/*   : durationMs forbidden / must be absent
**不要 silently ignore 错误 metadata**
```

### ⚠️ 我当前的状态（必须如实说明）

**我已经把较弱的版本应用上线了**（009 只含 `duration_ms IS NULL OR > 0`
与 `duration_ms IS NULL OR mime='audio/webm'` —— 它**允许 `audio/webm` 不带 duration**，
这正是审核禁止的）。

而**迁移一经应用即校验和锁定、只能追加不能修改** → 所以**必须补 010 来加严**。

> 这恰好是审核此前警告过的"别先 009=mime、一小时后又要 010"的情形；
> 但那次警告发出时探针尚未完成，而本次要求"加严"的裁定是在我应用 009 **之后**才到的。
> **如实记录，不掩饰**：这是**时序**造成的，不是"没听建议"。

## 四、EBML sniff：批准，但**措辞必须精确**

> "它证明的是 **WebM container validity**，不是完整证明'里面一定只有音频轨'。
> 这个强度对 Phase 1 足够：declared MIME = audio/webm + EBML signature valid +
> WebM DocType/container recognizable。
> **不要在报告里把它写成'服务端已证明 audio track'。**"

→ 结论：sniff 的声明强度定为 **"容器有效性"**，不得升级为"轨道构成已证明"。

## 五、duration_ms 成为 Phase 1 **必需字段**；计时用**单调时钟**

> "P10 失败已经把这个问题钉死了。建议实际计时不要依赖 `audio.duration`，而是使用单调时钟：
> ```
> MediaRecorder onstart → performance.now() = t0
> 停止录音 / onstop     → performance.now() = t1
> durationMs = round(t1 - t0)
> ```
> 然后：upload { file, purpose=chat, durationMs } → DB media.duration_ms
>      → message response/read model → voice bubble 显示 round(duration_ms / 1000)
> 这样 **reload 后完全不依赖重新下载音频**才能知道时长。"

验收"显示时长与实际录音时长 ±1s"被确认合理。

## 六、两个权限：**都批准进入正式实现**

```
不需要：自定义 WebChromeClient / 修改 Capacitor / 原生录音插件
```
> "你这次追 Capacitor 源码找到 AUDIO_CAPTURE → RECORD_AUDIO + MODIFY_AUDIO_SETTINGS，
>  而且实机验证'只缺后者就 deny、补上立即成功'，证据已经足够。"

**P3 的写法被指定**：
```
ANDROID_PERMISSION_UI_VISIBLE:  NOT_OBSERVED on MuMu A12 / SDK32
permission transition:          observed
real capture:                   PASS
```
> "**不要把'静默授权'推广到真实 Android 设备。**
>  产品代码也不要依赖'系统一定会弹框'，直接调用 getUserMedia 并处理成功/失败即可。"

## 七、Phase 1 实施范围（审核给定，照此限定）

```
长按录音 → 松开发送 → real audio/webm Blob
→ /api/media purpose=chat + durationMs
→ kind=voice + mediaId
→ private media
→ voice bubble
→ persisted duration
→ authenticated blob fetch
→ play / pause
→ reload still works
→ sender left/right continues existing contract
```
> **Phase 2 仍然不要混进来。**

## 八、Phase 1 Gate **必须补的三条负向断言**（我原计划漏了）

```
audio/webm without durationMs   → 400 → no media row
image/png  with    durationMs   → 400 → no media row
fake binary declared audio/webm → container sniff reject → no media row

消息层（防止扩 MIME 把 WO#2 收紧的 contract 放松）：
voice + image media → 4xx / zero message mutation
image + voice media → 4xx / zero mutation
text + mediaId      → existing 400 remains
mediaIds[]          → existing 400 remains
```

## 九、两条方法论规则被冻结（来自我本次的两个错误）

```
1) 二进制证据禁止经过 shell 文本重定向链；使用原生 binary-safe copy/pull。
   （我第一次用 adb exec-out screencap -p + PowerShell 的 > 重定向，
     PNG 头变成 FF FE FD FF 50 00 4E 00 → 文件损坏）
2) Windows PowerShell 兼容脚本若无明确 UTF-8 BOM/编码控制，
   自动化脚本优先保持 ASCII，避免编码本身改变程序语义。
   （我第一次的编排脚本含中文，被当 ANSI 读 → 语法被破坏）
```
> 审核确认："这次两个方法错误的处理都正确 …… 都属于 test/tooling defects，不是产品发现。"

---

⚠ 审核原文末尾自带提示："ChatGPT 可能会出错。请核查重要信息。"
→ 本记录中的**事实性结论**均以我们自己的实测与 DB 核验为准；审核意见作为裁定与方向采纳。
