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

- [x] E1 ✅ **已完成**（2026-09-22 01:27）
      脚本 `scripts/m5/audit-auth-hygiene.sh`（只读）；输出 `docs/m5/EVIDENCE-auth-hygiene-audit.txt`
      **结论**：sessions 130 条中 **active 合法会话 = 94**、revoked = 36、expired = **0**；
              challenges 108 条中 consumed = 103、expired-pending = 5、valid-pending = 0；
              attempts 全 0；**无任何表引用这两张表**（删除不破坏外键）。
      ⭐ 该结果**直接证实**"总数不是 invariant"：130 条里 94 条是活跃会话，
         任何总数上界门禁/按总数清理都会误伤合法会话。
      ```
      sessions:          active / expired / revoked / age distribution
      login_challenges:  pending-valid / expired / consumed / age distribution
      ```
      依据 schema 已有语义（`sessions.expires_at`/`revoked_at`、`login_challenges.expires_at`/`consumed_at`）
- [x] E2 ✅ **已冻结**：`docs/m5/E2-RETENTION-FREEZE-auth.md`（四类"确定已死"判据 + 两类"绝不删" + grace 默认 24h 可配，取值依据 E1 实测分布）`n- [ ] ~~E2~~，界定"**确定已经死亡的数据**"：
      `expired session older than retention grace` / `revoked session older than retention grace` /
      `expired challenge older than retention grace` / `consumed challenge older than retention grace`
      → cleanup eligible
      ⚠ **active session / still-valid challenge 绝不按总数删除**
- [x] E3 ✅ **已实现并验证**：`server/src/cleanup-auth-entry.ts`（独立 CLI，不塞进 media cleanup）`n      验证 `server/tests/verify-cleanup-auth.mjs`：**PASS=23 FAIL=0**（含 SENSITIVITY 证明 grace 真生效、fail-closed 退出码 2、幂等、活跃/有效行零误删）`n      构建目标已加 `dist/cleanup-auth.mjs` + 无 DATABASE_URL 冒烟（退出码 2）`n- [ ] ~~E3~~（不塞进 media cleanup —— 避免把媒体生命周期与认证生命周期
      绑成一个破坏半径很大的工具）。沿用既有纪律：dry-run 默认 / 显式 `--apply` / 分类计数 /
      DB 错误时 fail closed。报告字段：
      `expiredSessions / revokedSessions / expiredChallenges / consumedChallenges /`
      `activeSessions / pendingChallenges`
- [x] E4 ✅ **已完成**：Gate 第 6 节 + 4 条状态型不变量（M5_AUTH_STALE_*）+ 总数只作 INFO/WARN`n      判别力自检 `scripts/m5/verify-auth-judge-logic.sh`（构造输入：全 0→PASS；任一非 0→FAIL；字段缺失→FAIL）`n      gate 29 键全 PASS，REAL_EXIT=0：
      `STALE_EXPIRED_SESSIONS = 0`、`STALE_CONSUMED_CHALLENGES = 0`
      或允许明确 retention window：`expired_at < now - 24h → 必须不存在`
      ⚠ **不要写 `sessions < 50`**。总行数只保留为**次级** trend/warning
      （INFO active_sessions=… / WARN total unusually high），**不作产品 PASS/FAIL 唯一依据**

## F. WO#6（已提交审核，等裁定）
- [x] F1 ✅ **已完成**（审核 40 批准后实施）：`app/src/components/tabbar.css` 的 `.tabbar__item` 改为 column（图标在上、文字在下 + 交叉轴居中）`n      设备 Gate `scripts/m5/gate-wo6-tabbar-orientation.mjs`：**改前 FAIL**（stackGap=-18~-20、alignDelta=28~30.6）→ **改后 PASS**（stackGap=5、alignDelta=0）；`n      含导航回归（校园→#/campus、地图→#/map）、FAB/栏高不变；视觉核对亦确认三项均为竖排
      证据：dump bounds（图标 y=[1746,1795]、文字 y=[1829,1868]，不重叠）+ 截图视觉（两条独立来源）+
      我方 DOM 实测（icon y=1035、label y=1037，重叠 → 横排）
- [x] F2 ✅ **已按审核 40 挂起**：`FAB_VISIBLE_DIAMETER: NOT_MEASURED_RELIABLY` / `PRODUCT_CHANGE: NONE`；`n      未来可选方法 = 「已知中心 + 径向边缘拟合」（审核给定，含残差报告要求），本轮**不投入**
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

### 待办调整（E2–E4 的细项；**与上方 E 区同项，以上方为准**，这里只补"已查明的前提"）
- E2 前提已查明：**retention grace 建议 24h 且可配 `--grace-hours`**
  （依据：grace=1d 时候选为 0 → 现有数据都在近 24h 内；设 24h 既不误删活跃数据、又能约束长期膨胀）
  ⚠ 且 **expired sessions 目前为 0**（会话 TTL ≥7 天）→ 本工具短期只会清 challenges
- E3 前提已查明：**没有任何表引用 sessions / login_challenges** → 删除不破坏引用完整性
---

## G. 下一批（2026-09-22 01:49 更新）—— **按当前账本选，不按类别名硬排**

> 审核记录 40："以后应按当前账本选，而不是按类别名字硬排。"

### 现状账本（本轮结束时的真实状态）
```
WO#1 board_notes        CLOSED
WO#2 chat image         CLOSED
WO#3 sender direction    CLOSED
WO#5 voice Phase 1       CLOSED（审核 39）
WO#6 tab 竖排            IMPLEMENTED，**已提交审核 41 申请关账**
E1–E4 auth hygiene       DONE（cleanup-auth + 4 条状态型 Gate 键）
(B) 格                   **已清空**（语音已完成 / @所有人 是设计决定 / 图片压缩+配额 移入 (D)）
(D) 格                   图片压缩、per-user 配额 —— **前提证据不在手**
(C) 格                   若干"证据缺口"项（写代码不解决）

### G1. 待审核裁定后立即做（等审核 41 回复）
- [x] G1.1 ✅ **已完成**（审核 41 已判 WO#6 CLOSED）：gate 的 M5_OVERALL 加 WO#6 段；A-D-LIST 新增第 0 条（tab 竖排 FIXED/CLOSED）与第 6 条（文字发送缺失）；AUDIT (B) 表同步
- [x] G1.2 ✅ **已完成**：审核 41 正式命名为 **VISUAL_TARGET_VALIDITY GATE** 并冻结；已写入 PLAN，并实现为可执行门禁 `scripts/m5/preflight-capture.ps1`（判别力已验证）

### G2. (C) 类：找**可只读获得**的原版证据（不动产品代码，先取证）
本轮**意外获得的半张证据**：误拍时拍到原版**群聊输入栏**（`GroupChatActivity`，
文本样本 `GroupForEvidence(1)` / `@` / `发消息…`），说明原版群聊 composer 右侧有一个
**黑色圆形 + 按钮**。这是真实观察，但**答非所问**，需正式取证。
- [x] G2.1 ✅ **已完成**（改用**静态 APK 分析**，零设备交互，见 WO7 提案 §七 的合规判断）`n      产出：`docs/m5/WO7-PROPOSAL-composer-text-send.md`（声明结构 + 渲染态 dump + claim-level 对比）`n      **重要发现**：我方 composer **没有发送按钮、draft 从未被发送** → **会话页发不出文字消息**（真实功能缺口）`n      理由：进会话页可能触发"标记已读"= 服务端写，而群名 `GroupForEvidence(1)` 的成员数无法只读证明 → 按纪律不执行设备采集
      目标：确认 composer 的结构（输入框 / @ / 表情 / 圆形+ 按钮）与几何
      注意：**只用只读导航**进入（点开群聊不产生写入）；绝不发消息
- [x] G2.2 ✅ **部分完成（STRUCTURAL 层）**：`docs/m5/EVIDENCE-at-panel-structure.md`（静态 APK，可采信）：面板=底部弹层、标题「选择提醒的人」16sp bold、列表固定 500dp、**存在「所有人」项**（88dp/56dp 图标/16sp）、空态「暂无群成员」、失败「加载失败」`n      AT_PANEL_STRUCTURAL_CONFORMANCE: EVIDENCE_SECURED；AT_PANEL_VISUAL_CONFORMANCE: 仍 NOT_EVALUATED（需渲染态）`n      ⚠ **连带更正**：原版**确有 @所有人** → AUDIT 把该条从"设计决定"改回 (B) 类缺口
- [x] G2.3 ✅ **部分完成（STRUCTURAL 层）**：存在 `layout/activity_image_preview`（id=im_image_preview_root）、`activity_single_image_preview`（id=photo_view）、`chat_image_preview_bottom_bar`（id=chat_media_preview_message_uuid）→ MEDIA_PREVIEW_STRUCTURAL_CONFORMANCE: EVIDENCE_SECURED；渲染态仍 NOT_EVALUATED

### G3. (D) 类：明确记为 KNOWN LIMITATION，不猜着实现
- [x] G3.1 ✅ **已完成**：见 `docs/m5/G3-D-CLASS-QUOTA-AND-SURFACED-GAPS.md``n      `IMAGE_UPLOAD_COMPRESSION_CONFORMANCE = EVIDENCE_NOT_OBTAINABLE_BY_CURRENT_METHODS`（dex 扫描无第三方压缩库；降采样 API 命中但属显示用途）
      （已取证：dex 扫描无第三方压缩库；降采样 API 命中但那是显示用 → 不能证明上传前压缩）
      → 在 AUDIT 与对外对比报告里写成"当前范围不可获得或无证据"，**不得写成"原版不压缩"**
- [x] G3.2 ✅ **已完成**：`PER_USER_QUOTA_CONFORMANCE = EVIDENCE_NOT_OBTAINABLE_BY_CURRENT_METHODS``n      脚本 `scripts/m5/probe-original-quota.sh`（资源表 51874 行扫 quota/limit/exceed/too_large + 中文关键词）：**「配额」类未命中**（"quota" 只命中引号图标）`n      ⚠ 未命中**不等于**没有 → 只能写"现有方法取不到"`n      **意外浮现的候选缺口**（原版 im_chat_*/capa_* 文案）：图片**像素尺寸**上限、视频消息（播放/进度）、保存至相册、本地媒体失效重试、`im_chat_record_error`="语音录制失败，请重试"（我方文案不同）

### G4. 纪律与工程（低风险、可随时做）
- [x] G4.1 ✅ 本轮已用它救回坏掉的 `deploy-server.ps1`（tools/fix-ps1-bom.ps1）；纪律已写入 PLAN 的测量/工具节
      → 可加为一句话检查脚本或写进提交前自查
- [x] G4.2 ✅ 已抽出 `scripts/m5/preflight-capture.ps1`（VISUAL_TARGET_VALIDITY，含前台包名 + CDP URL 双检）
      把"设备健康 + 前台确认 + CDP 就绪"抽成一个共用前置函数，避免每个脚本各写一遍

---

## H. WO#7 收尾（2026-09-22 02:14 更新）

- [x] H1 ✅ **WO#7 已 CLOSED**（审核记录 43：PASS / CLOSED；并肯定失败路径"draft 保留"的设计）
- [x] H2 ✅ **已完成**：gate 的 M5_OVERALL 加 WO#7 段；A-D-LIST 第 6 条改 CLOSED；AUDIT (B) 表同步；另按审核 43 加 I 区（发布前 IP 清查）
- [x] H3 ✅ **已完成**：`scripts/m5/gate-composer-coverage.mjs`（机械覆盖矩阵）+ `scripts/m5/get-declared-message-kinds.sh`（权威 kinds 来自 DB 约束 messages_kind_allowed = text,image,voice）`n      实测：text/image/voice **全部 REACHABLE** → PASS；**判别力已验证**（加一个未映射的 video → COVERAGE GAP / FAIL / exit 1）`n      关键设计：未知 kind → NO_ENTRY_MAPPED **判 FAIL**（沉默忽略等于把这类缺口又放回去）`n      边界声明：只证明"入口可达"，**不证明**端到端能用（后者由各 WO Gate 负责）
      机械列出当前产品声明支持的消息类型 × "是否存在可达的 UI 入口"：
      ```
      text  → 入口：.chatbar__send（本轮 WO#7 补上）
      image → 入口：.chatbar__file（选图）
      voice → 入口：.chatbar__mic（按住说话）
      ```
      **关键**：若 API 支持某能力、UI 也叫 composer，却没有用户入口 → 暴露为 **coverage gap**。
      （本轮的文字发送正是这种"垂直 slice 全绿、横向能力缺一块"的情形。）
      实现方式：一个**机械**脚本读 message kind 枚举 + 探测三类入口是否存在，纳入 gate。
- [x] H4 ✅ **已完成**：`scripts/m5/run-device-gate.sh` —— 把顺序封死：① am start 到前台 ② **先建 CDP 转发** ③ 采集前 VISUAL_TARGET_VALIDITY ④ 跑 Gate ⑤ **采集后再核一次**`n      实测两次 preflight 均 PASS（此前的"CDP unreachable 假 FAIL"已消除）
      必须先建立 CDP 转发（`adb forward tcp:9222 ...`）**再**跑 preflight，
      否则 CDP 检查会假 FAIL。建议封一个 runner：建 forward → preflight → 采集 → 再核 preflight。
- [x] H5 ✅ **已完成**：`tools/check-ps1-bom.ps1`（纯 ASCII 脚本，扫全仓 .ps1）`n      规则：**含非 ASCII 的 .ps1 必须带 UTF-8 BOM**（无 BOM 会被 PowerShell 当 ANSI 读 → 中文乱码破坏语法）`n      首跑即发现**我自己新写的脚本**含中文却缺 BOM（补 BOM 后 PASS）；全仓 35 个 .ps1，0 个不合规

### 证据 backlog（等 runtime 或直接静态行为证据，**不做产品改动**）
- composer 高度（原版 134 vs 我方 96）：群聊/单聊 confounder 未排除
- voiceIv 切换模型：只有布局 GONE + constraint，不足证明状态机
- emoji/plus 精确尺寸与顺序（原版 28dp/32dp）
- plusRedDot（8dp）/ quoteViewStub（引用回复条）：**存在性 ≠ 需要当前显示**
- 图片**像素尺寸**上限：文案 `im_image_size_exceed`="图片尺寸超过限制（8000px）" —— 阈值有证据，
  但"任一边 >8000 还是总面积""客户端拦还是服务端拦"未确证
- 视频消息（播放/暂停/进度）、保存至相册、本地媒体失效重试：原版有，我方无（属新媒体类型，大件）
- `im_chat_revoke`="撤回" + `im_long_press_menu_layout`：我方有撤回**显示**，撤回**动作**入口待核对

---

## I. ⚠️ 发布前必做项（licensing / IP 清查）—— **不是现在做，但不能忘**

> 依据：审核记录 43 第 3 点（"直接复制其 vector path 到要公开/商业发布的产品里
> 可能涉及资产版权/许可问题 …… 最终发布前最好把'原样复制第三方图形资产'
> 单独做一次 licensing/IP 清查"）。
>
> 当前定位是**私有复刻 demo**（对照学习/演示），本区**不阻塞**现有工作；
> 但若将来要**公开或商业发布**，必须先清完这一区。

- [ ] I1 **发布前 IP 清查**：逐一核对下列"逐字复制自第三方 APK"的资产，
      决定 保留 / 替换为自绘等价物 / 移除：
      ```
      1. app/src/components/icons-send.tsx        发送按钮 vector pathData（res/JA.xml）
      2. docs/original-baseline/supplements/original-emoji-*.txt
                                                  154 个表情资源名与映射（原版随包资源）
      3. docs/original-baseline/screens/**        原版截图（含第三方界面与内容）
      4. .mumu-capture/apk/target.apk             原版 APK 副本（172MB）
      5. app/src/** 其它"按原版截图/资源复刻"的图标（需逐个核对来源）
      ```
- [x] I2 ✅ **已完成**：仓库根 `LICENSING-NOTES.md` —— 逐项登记"逐字复制自第三方 APK"的资产、明确不受影响的资产、**检索方法**（rg 命令）、标记格式约定、发布前动作清单`n      已核实：原版 APK **未被 git 跟踪**（`.gitignore:31` 的 `.mumu-capture/` + 全局 `*.apk`）；仓库中无任何被跟踪的 .apk
      各自的使用边界、发布前需要做什么"（避免这条只存在于 review-log 里而被忘掉）
- [ ] I3 若确定要公开：为图标做"视觉等价但非直接复制"的重绘（并保留 `ASSET_ORIGIN` 注释以便溯源）

### 已在代码里打的标记格式（供 I1/I2 检索）
```
ASSET_ORIGIN:        COPIED_FROM_THIRD_PARTY_APK
PUBLICATION_BLOCKER: LICENSE_REVIEW_REQUIRED
```

---

## J. ⚠️ Round 258 重大发现：**主路径「消息」整段是 mock**

- [ ] J1 **WO#8（修订版）待批准**：`docs/m5/WO8-PLAN-message-list-real-backend.md`
      —— 「消息」列表接真实后端 + 修 `App.tsx` 的 chat 路由 id 取法 bug（与 M3 修过的 feed 同类）
      证据：26 屏幕中 **11 个纯 mock**（含 MessageScreen / GroupChatScreen / FeedListScreen / MapScreen）；
      设备实测 `#/message` 渲染 23 行全 mock；点群聊项 → `#/group?id=g1` 且 **0 网络请求**；
      对照 `#/chat/<真实UUID>` → API **200**（证明 ChatScreen 本身是好的）
- [ ] J2 WO#9（顺延）：群聊接真实后端（**后端无 group 会话**，需先定语义与种子）→ 之后才做 AT 面板/@所有人
- [ ] J3 前端**是否也以网页形式部署**到服务器（nginx 当前 `location / { return 404; }`）—— 待裁定
- [ ] J4 建议把 **"入口可达性 entry reachability"** 写成 Gate 方法论的常规断言类别
      （WO#7 的 Gate 用"直接设 hash"进页面，恰好跳过"用户怎么走到那里" → 正是本次缺陷躲过所有 Gate 的原因）
- [ ] J5 逐项登记其余 mock 区块为 `MOCK_NOT_WIRED`（先登记，不假装它们是真实的）