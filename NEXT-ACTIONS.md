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

---

## E. auth hygiene（**已按审核记录 39 重写** —— 审核明确反对"总数上界"做法，我采纳）

> 审核原话要点：`sessions=122` 可能是"120 条早已过期的垃圾"，也可能是"122 条仍合法的活跃 session"
> —— **这两个语义完全不同，总行数不是正确的 invariant**。

- [ ] E1 **先做 `AUTH_HYGIENE_AUDIT`（查状态分布，不先做清理）**
      ```
      sessions:          active / expired / revoked / age distribution
      login_challenges:  pending-valid / expired / consumed / age distribution
      ```
      依据 schema 已有语义（`sessions.expires_at`/`revoked_at`、`login_challenges.expires_at`/`consumed_at`）
- [ ] E2 **冻结 retention 语义**，界定"**确定已经死亡的数据**"：
      `expired session older than retention grace` / `revoked session older than retention grace` /
      `expired challenge older than retention grace` / `consumed challenge older than retention grace`
      → cleanup eligible
      ⚠ **active session / still-valid challenge 绝不按总数删除**
- [ ] E3 **独立 `cleanup-auth`**（不塞进 media cleanup —— 避免把媒体生命周期与认证生命周期
      绑成一个破坏半径很大的工具）。沿用既有纪律：dry-run 默认 / 显式 `--apply` / 分类计数 /
      DB 错误时 fail closed。报告字段：
      `expiredSessions / revokedSessions / expiredChallenges / consumedChallenges /`
      `activeSessions / pendingChallenges`
- [ ] E4 **Gate 只查"死数据"，不查总数**：
      `STALE_EXPIRED_SESSIONS = 0`、`STALE_CONSUMED_CHALLENGES = 0`
      或允许明确 retention window：`expired_at < now - 24h → 必须不存在`
      ⚠ **不要写 `sessions < 50`**。总行数只保留为**次级** trend/warning
      （INFO active_sessions=… / WARN total unusually high），**不作产品 PASS/FAIL 唯一依据**

## F. WO#6（已提交审核，等裁定）
- [ ] F1 `docs/m5/WO6-PLAN-tabbar-vertical-layout.md`：tab 项 **横排 → 竖排**（原版为图标在上、文字在下）
      证据：dump bounds（图标 y=[1746,1795]、文字 y=[1829,1868]，不重叠）+ 截图视觉（两条独立来源）+
      我方 DOM 实测（icon y=1035、label y=1037，重叠 → 横排）
- [ ] F2 FAB 可见直径：**两种像素方法均自判 INVALID** → 记为候选，等审核指定有效方法（不凭猜改）
---

## E1 结果（2026-09-22 01:27，只读审计已完成）

```
sessions 总数 130：
  active(未撤销未过期) = **94**      ← 大部分是**合法活跃会话**
  expired(未撤销)      = 0
  revoked              = 36
  交叉表：not_revoked/valid = 94 ；revoked/valid = 36 ；**没有任何 expired**
  age: <1h = 16，1h..1d = 114 ；会话有效期全部 >=7 天（故无过期行，库年轻）
  每用户会话数: max=113, avg=65, users=2（测试反复登录所致）

login_challenges 总数 108：
  consumed       = 103
  expired-pending = 5
  valid-pending   = 0
  交叉表：consumed/expired = 103 ；not_consumed/expired = 5
  age: <1h = 16，1h..1d = 92 ；有效期全部 1..10 分钟
  attempts 全为 0（无暴力尝试堆积）

清理候选（仅统计，未删除）：
  grace=1h  → revoked session 36 ；consumed challenge 87 ；expired challenge 92 ；expired session 0
  grace=1d  → 全部为 0（库龄 < 1 天）
  grace=7d  → 全部为 0

绝不误删集合：active sessions = 94 ；valid pending challenges = 0
外键：**没有任何表引用 sessions / login_challenges** → 删除不破坏引用完整性
```

### ⭐ 这份审计**直接证实了审核的反对意见**

审核说"总行数不是 invariant"——数据完全支持：
```
sessions 总数 130，其中 **94 条是 active 合法会话**。
→ 任何形如 "sessions < 50" 的门禁都会**误报**；
→ 任何"按总数清理"的做法都会**删掉合法会话**。
```
所以 Gate 只能用 `STALE_EXPIRED_SESSIONS = 0` / `STALE_CONSUMED_CHALLENGES = 0` 这类
**状态型**不变量（E4），总数只作次级 warning。

### 待办调整
- [ ] E2 retention 语义冻结：需定 **retention grace 值**（我建议默认 24h、可配 `--grace-hours`）。
      理由：当前 grace=1d 时候选为 0，说明现有数据都是"近 24h 内产生的"，
      设 24h 既不会误删活跃数据、又能约束长期膨胀。
      ⚠ 但**过期的 sessions 目前为 0**（TTL ≥7 天），所以本工具短期只会清 challenges。
- [ ] E3 独立 cleanup-auth（dry-run 默认 / --apply / 分类计数 / DB 错误 fail-closed）
- [ ] E4 Gate：STALE_EXPIRED_SESSIONS=0 与 STALE_CONSUMED_CHALLENGES=0；总数只作 WARN