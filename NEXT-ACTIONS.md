# NEXT-ACTIONS —— 可机读的待办队列（**每轮开始时先读它，做完一项就勾掉**）

> 建立于 2026-09-22 00:09，起因：用户指出"**至少五次在目标未完成时擅自停止工作**"，
> 造成大量闲置时间（例如 41 分钟无动作）。
>
> ## 硬规则（已写入 PLAN.md，属于纪律而非建议）
>
> 1. **只要本文件中还有 `[ ]` 且其状态不是 `BLOCKED`，就不得以"汇报"结束回合** ——
>    必须继续执行到：全部 `[x]`，或遇到 `BLOCKED`（且已说明原因）。
> 2. **汇报是回合的最后动作，不是结束工作的理由**：把"我要汇报了"当作停止条件 = 错误模式。
> 3. **不得以"等审核裁定"为由停下** —— 审核本身也是我推进的一环（我可以提交并继续做
>    与裁定无关的、已批准的下一项）。
> 4. **每完成一项就立刻用 `edit` 把它改成 `[x]`**（含证据指针），不要攒到最后。
> 5. 若某项依赖外部（如审核裁定），标 `WAITING(裁定项)` 并**继续做下一项**，不要空等。

---

## A. WO#5 Phase 1 实现（审核记录 35：**APPROVED TO IMPLEMENT**）

范围（审核给定，不得扩张；Phase 2 不并入）：
```
长按录音 → 松开发送 → real audio/webm Blob → /api/media (purpose=chat + durationMs)
→ kind=voice + mediaId → private media → voice bubble → persisted duration
→ authenticated blob fetch → play/pause → reload 仍可 → 左右方向沿用既有 contract
```

### A1. 服务端（`server/src/index.ts`）
- [x] A1.1 `/api/media`：接受 `durationMs`；**audio/webm 必须带正 durationMs**；**image/* 禁止带 durationMs**（不静默忽略）
- [x] A1.2 `/api/media`：对 audio/webm 做 **EBML/WebM 容器 sniff**（声明强度=容器有效性，不得写成"已证明只有音频轨"）
- [x] A1.3 消息路由：把 `media_requires_image_kind` **泛化**为 kind↔mime 相容性（image↔image/*、voice↔audio/*），**并保住** `text + mediaId` → 400、`mediaIds[]` → 400

### A2. 客户端
- [x] A2.1 `app/src/api/client.ts`：`uploadMedia(file, purpose, durationMs?)`；`postThreadVoiceMessage`
- [x] A2.2 `ChatScreen`：长按录音（MediaRecorder）→ 松手停止 → **用 `performance.now()` 单调时钟计时** → 上传 → 发消息
- [x] A2.3 `ChatScreen`：语音气泡渲染（时长 `round(ms/1000)″` + 播放/暂停；**沿用已 PASS 的 senderId 左右方向**）
- [x] A2.4 权限拒绝时明确提示；**不得**发出任何 `/api/media` 或 `/messages`（⑦a）

### A3. 构建与真机验证
- [x] A3.1 `tsc -b` + lint + build + `cap sync android` + APK 装机
- [x] A3.2 真机 E2E：录音 → 201 → 201 → DB 核查 kind=voice 且 media.duration_ms>0
- [x] A3.3 真机断言：气泡显示时长与实际录音时长 **±1s**；点击可播放/暂停
- [x] A3.4 reload 后仍能显示时长并播放（**不重新下载音频也能知道时长**）
- [x] A3.5 ⑦a 拒绝代码路径：**stub getUserMedia 抛 NotAllowedError** → 明确提示 + **0 次 /api/media + 0 次 /messages + 0 ghost bubble**

### A4. Gate（审核要求补 7 条负向断言）
- [x] A4.1 `audio/webm` 无 durationMs → 400 且**无 media 行**
- [x] A4.2 `image/png` 带 durationMs → 400 且**无 media 行**
- [x] A4.3 伪造二进制声明 `audio/webm` → sniff 拒绝且**无 media 行**
- [x] A4.4 `voice` + image 媒体 → 4xx / **零消息变更**
- [x] A4.5 `image` + voice 媒体 → 4xx / **零消息变更**
- [x] A4.6 `text + mediaId` → 保持 400（回归）
- [x] A4.7 `mediaIds[]` → 保持 400（回归）
- [x] A4.8 把 A4.1–A4.7 接进 `scripts/gates/m5/gate-server.sh`

### A5. 提交审核
- [x] A5.1 ✅ 已写 `docs/review-log/36-wo5-phase1-implemented.md` 并提交审核（2026-09-22 00:40，3982 字）；B2 修复也在同一批说明中

---

## B. 既有明确待办（与本单并行、不被裁定阻塞）

- [x] B1 ✅ 已写入 `PLAN.md` 末（硬规则：不得以汇报结束回合；含自查三问）
- [x] B2 ✅ 已修复（commit 7c4b5b1）：心跳句柄提升到外层 + db.ts 的 `closing` 守卫 + close() 先 await inflight。**判别测试** `server/tests/shutdown-race.test.ts` 经负对照证明**能失败**（未修复=1 次 pool 查询→FAIL；修复后=0→PASS）
      —— 关闭时后台迁移循环未检查 shutdown 状态，打出假警报并翻转 health。应记为缺陷并修（或在文档明确其为 shutdownown-only）
- [x] B3 ✅ 已写入 `PLAN.md`（二进制证据禁止经 shell 文本重定向；PowerShell 脚本优先 ASCII） 把本次两条工具规则写入纪律：① 二进制证据禁止经 shell 文本重定向 ② PowerShell 脚本优先 ASCII
- [x] B4 ✅ `docs/RESUME-POINT.md` 顶部已加 NEXT-ACTIONS 指针 把 `NEXT-ACTIONS.md` 的机制写进 `docs/RESUME-POINT.md`，使接手者也会先读它

---

## C. WAITING（不阻塞 A/B）
- WAITING(裁定) WO#4 emoji 结构层：`DEFERRED_BY_MISSING_BINDING_EVIDENCE`（等 token↔drawable 映射证据）
- WAITING(裁定) C4 exact 6 assets：`NOT_CAPTURED`（停止投入）
- WAITING(裁定) 审计表 (C) 类"证据缺口"项的取证方式

---

## D. 已完成（留痕）
（每完成一项，把该项的 `[x]` 与证据写到这里，保持 A/B 区干净）
