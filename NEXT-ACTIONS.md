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

- [x] J1 ✅ **WO#8 已实施并提交关账**（审核 44 批准 → 设备 Gate 7 项全 PASS）`n      产物：`docs/m5/WO8-PREFIX-FAIL-EVIDENCE.md`（改前 FAIL + 铁证）、`docs/m5/UI-DATA-SOURCE-INVENTORY.md`（26 屏数据源清单）`n      回归：WO#7 Gate PASS / WO#6 Gate PASS / M5 server gate PASS（REAL_EXIT=0）
      —— 「消息」列表接真实后端 + 修 `App.tsx` 的 chat 路由 id 取法 bug（与 M3 修过的 feed 同类）
      证据：26 屏幕中 **11 个纯 mock**（含 MessageScreen / GroupChatScreen / FeedListScreen / MapScreen）；
      设备实测 `#/message` 渲染 23 行全 mock；点群聊项 → `#/group?id=g1` 且 **0 网络请求**；
      对照 `#/chat/<真实UUID>` → API **200**（证明 ChatScreen 本身是好的）
- [x] J2 ✅ **已由 WO#9A 完成并 CLOSED**（群聊接真实后端 + 授权矩阵）；本条为历史登记：`n      当初判断"后端无 group 会话、需先定语义与种子"是对的，前提核查后确认 **schema 早已支持 group**（无需迁移）
- [x] J3 ✅ **已裁定（审核 44）：不要求**`n      `PUBLIC_WEB_FRONTEND_DEPLOYMENT: NOT REQUIRED FOR CURRENT ANDROID 1:1 SCOPE``n      理由：最终产品对象是 Android 1:1 复现；Capacitor 前端打进 APK + APK 指向线上 Node/PG 后端`n      已经是合法的"独立前后端"——"前后端独立"≠"前端必须同时作为网站托管"。`n      额外公开 Web 版会新增一整套非目标 surface（浏览器 TLS 信任 / CORS / OTP dev sink 暴露面 /`n      浏览器与 WebView 权限差异 / URL routing / 静态部署 + 安全审计）→ 明确记为 scope expansion，不做。`n      当前"上线"要求 = 已部署后端 + 指向该后端的 release APK + 真机端到端验证。
- [x] J4 ✅ **已完成（审核 44 正式冻结为一等类别）**：已写入 PLAN.md`n      命名 `ENTRY REACHABILITY / USER-PATH REACHABILITY`，与 FUNCTIONAL/PERSISTENCE/CONFORMANCE/REGRESSION 并列`n      含定义、测试方式边界（直接设 hash 只能证明 destination functionality）、两个标准实例、4 条自查问句
      （WO#7 的 Gate 用"直接设 hash"进页面，恰好跳过"用户怎么走到那里" → 正是本次缺陷躲过所有 Gate 的原因）
- [x] J5 ✅ **已完成**：`docs/m5/UI-DATA-SOURCE-INVENTORY.md`（26 屏逐屏登记 + 可复现盘点命令 + 维护规则）`n      纯 api 5 ／ 分区或混合 4 ／ **纯 mock 10** ／ 静态 7；P1 顺序 GroupChat→FeedList→UserProfile→Map`n      ⚠️ 特别标注 ProfileEditScreen：**写路径却纯 mock**（假成功），与本次修的"mock id 漏进真实 API"同类
---

## K. Round 258 后续（WO#9/10 登记）

- [x] K1 ✅ **WO#9A 已实施并提交关账**（审核 45 批准 + 收紧）`n      设备 Gate 8 项全 PASS + 身份 3/3；授权矩阵 12 项全 PASS（含非成员**零 mutation**）`n      改前 FAIL 已取得（5 项）；回归：WO#8/WO#7/WO#6/M5 server 全 PASS
      前提核查结论：**后端 schema 已支持 group**（`kind CHECK IN ('direct','group')`、成员表无上限无角色、
      `title` 可空）→ 无需迁移，主要是**造种子 + 前端接真实 API + Gate**
- [x] K2 ✅ **已完成**：WO#9B 两层全部实施（层 A 面板 14 条断言 + 层 B 语义 25 条断言全 PASS）；见 K2.14/K2.15
      （AT 面板的结构证据已就绪：`docs/m5/EVIDENCE-at-panel-structure.md`；
       `mentions_all` 数据模型设计已就绪）——**不与 WO#9A 混成一个 Gate**
- [x] K3 ✅ **已由 WO#10 完成**（假推荐区与分享面板已清理；邀请卡字段见 D-003 登记）
      「更多同学」+ 好友申请（后端无推荐/好友申请能力）。需要先补 profile 字段与推荐接口
- [x] K4 ✅ **已由 WO#11（FeedList）与 WO#12（UserProfile）承接**
      FeedListScreen（P2）→ UserProfileScreen（P3）→ MapScreen（P4）
      ⚠️ 其中 **ProfileEditScreen 是"写路径"却纯 mock**（假成功），建议提前
### K2 进展（Round 260）
- [x] K2.0 ✅ 按审核 47 落实**命名细化**：IDENTITY_CONTINUITY → `THREAD_IDENTITY_SET_CONTINUITY`（集合级）
      + `THREAD_SECTION_ORDER_CONTINUITY`（分区内有序列）；实测两条 PASS，exit 0（commit 4f7caaf）
- [x] K2.1 ✅ 实现**机械前置** `API_E2E_ORIGIN_VALIDITY`（审核 47 要求）：`scripts/m5/preflight-api-origin.mjs`
      已接入 `run-device-gate.sh` 4/7 步。正常 PASS；**判别力已验证**（origin 指向 WebView 自身 →
      status 200 但 text/html → **FATAL exit 2**）。顺带把陷阱**实证**出来：
      `RELATIVE_PATH_BEHAVIOUR_INFO = {"status":200,"contentType":"text/html","isHtml":true}`
- [x] K2.2 ✅ WO#9B 计划按"两层分离"修订并提交审核（层 A UI / 层 B 语义，**状态键互不掩盖**）；
      含审核要求的 5 个冻结问题立场 + `AT_ALL_PERMISSION_MODEL: NOT_EVALUATED`
- [x] K2.3 ✅ **层 A 设备门禁 + 改前 FAIL**：`scripts/m5/gate-wo9b-at-panel-layerA.mjs`
      改前：入口可达 PASS（entryReached=true），面板相关 6 项 FAIL，4 项 NOT_EVALUATED，exit 1
      自查修掉 3 处 GATE_DEFECT：① 跨导航取值导致 "Uncaught" ② 分组断言在"面板不存在"时被误判
      ③ **命名冲突使断言永不能通过**（`entry` 被重新赋值）
- [x] K2.4 ✅ **层 B 服务器门禁 + 改前 FAIL**：`scripts/m5/gate-wo9b-mentions-all-layerB.sh`
      改前核心缺陷被精确刻画：API **静默忽略** mentionsAll（收下字段→201→写出无提及语义的消息，
      direct 上也不拒绝）；非成员路径（404 + 零 mutation）既有行为正确
      自查修掉：① 把"非成员越权"与"direct 不该被接受"合成一条断言（定位会误导）→ 拆成两条
      ② 在 bash 里误用 C 风格 `/* */` 注释 → 改 `#`
- [x] K2.5 ✅ **已完成**：审核 49 批准 → 迁移 011（applied=11/11）+ 接口/读模型 + 层 A 面板
### K2 进展（Round 260 续）
- [x] K2.5b ✅ **已完成**：审核 49 确认两个 blocker 已冻结并批准实施 → 已实施
      迁移 `011_mentions_all.sql` + `GET /api/threads/:id` 返回 `members[]` + 层 A 面板 + 选中状态
- [x] K2.6 ✅ 审核 48 要求的**有界静态 trace**：`scripts/m5/probe-at-trigger-static-trace.mjs`
      结果 `AT_TRIGGER_STATIC_TRACE: FOUND`（含**专用触发符号 openAtPanel ×1 @classes3.dex**，
      不是泛化 startActivity）；但字符串池读不到方法体 → 保持 `AT_PANEL_TRIGGER: OUR_DESIGN_CHOICE /
      ORIGINAL_NOT_EVALUATED`，并按指示**已停止深挖**
- [x] K2.7 ✅ 措辞按审核 48 强制修正（**计划与门禁脚本都已改**）：
      删掉"全体在两人会话里语义不可能" → `MENTIONS_ALL_DIRECT_POLICY: REJECT /
      PROVENANCE: OUR_DESIGN_CHOICE / ORIGINAL_BEHAVIOR: NOT_EVALUATED`；
      并补 `AT_ALL_PERMISSION_POLICY`（group member→allowed / non-member→404）与
      `SERVICE_INVARIANT`（同一事务内 5 条，任一失败 → 零消息 + 零 mention 变更）
- [x] K2.8 ✅ 门禁键名全部对齐审核 48 给定的最终清单（层 A 12 键 / 层 B 9 键 / 发送状态 2 键），
      并把改前 FAIL 证据用**最终键名**重采
- [x] K2.9 ✅ 自查出并修掉 3 处"断言不可靠"：① 恒 FAIL 的同义反复 ② 占位探针+错 IP
      ③ **MIXED 断言因 `cannot_mention_self` 而"因为错误原因通过"**（诊断脚本已入库）
### K2 进展（Round 260 收尾）
- [x] K2.10 ✅ **审核 49：WO9B APPROVED TO IMPLEMENT**（两个 blocker 均被接受）
- [x] K2.11 ✅ **层 B 已完成**：迁移 `011_mentions_all`（applied=11/11）+ 接口语义 + 读模型
      → `MENTIONS_ALL_SEMANTICS: PASS`（**25 条断言**，含两条**自然对照变量**敏感度验证）
- [x] K2.12 ✅ **校验顺序按审核 49 冻结清单重排**（这是一处**真实代码缺陷**）：
      我原把"互斥检查"放在事务前 → **非成员**同时带双字段会拿到 400（冲突）而不是 404，
      违反冻结顺序。已改为：事务前**只做类型检查**；语义检查（kind 策略 + 互斥）全部进事务、
      **排在成员判定之后**。并新增 Gate `5b)`：非成员 + 双字段 → 必须 **404**（实测 PASS）
- [x] K2.13 ✅ **Blocker ① 后端契约已完成并核验**：`GET /api/threads/:id` 返回
      `members: [{id, displayName}]` → `MEMBER_SOURCE_CONTRACT: PASS`（15 条断言）
      含审核 49 点名边界：只含最小身份字段（**无 phone**）、`memberCount == members.length`、
      成员集合 == DB `thread_members`、非成员 404、**顺序不作为 conformance**
- [x] K2.14 ✅ **层 A UI 已完成**：AT 面板 + 「@所有人」选中链路（见 K2.15）
      · 底部弹层（全屏遮罩可点关闭 + 底部锚定）/ 关闭控件 / 标题「选择提醒的人」16sp bold 居中
      · 「所有人」项（行高 88dp、图标 56dp、标签 16sp、图文间距 12dp）
      · 成员平铺（**不渲染** section header）+ 空态/失败态（**受控 stub**，标 CLIENT_CODEPATH）
      · 入口位置 = 我方设计选择（`AT_PANEL_TRIGGER: ORIGINAL_BEHAVIOR NOT_EVALUATED`）
      · 选中状态：**composer chip/state**（**不得**写进 message body）+ 成功清除／失败保留／可取消
      · 然后重采层 A 的改前 FAIL 与改后 PASS
### K2 收尾（Round 260 结束状态）
- [x] K2.15 ✅ **层 A 设备 Gate 14 条断言全 PASS**（entry/kind/title/close/所有人项/几何/
      **AT_MEMBER_SOURCE_AUTHORITY**/选中可见/与 payload 一致/**未写进 body**/可取消/成功清除/失败保留/面板关闭）
- [x] K2.16 ✅ 审核 51 已裁定 **WO9B: PASS / CLOSED**；空态/失败态 stub 已补（WO#9B closeout，设备 Gate 14→17 条全 PASS）
- [x] K2.17 ✅ 已由 WO#10 / WO#11 / WO#12 分单承接
      其中 **ProfileEditScreen 是纯 mock 的"写路径"**（假成功），建议提前
- [x] K2.18 ✅ 新增 3 个工具：`check-gate-syntax.sh`（机械语法检查）、
      `cleanup-all-gate-residue.sh`（集中清理残留）、`verify-thread-members-contract.sh`（blocker ① 契约核验）
### WO#10 完成（Round 261）
- [x] WO10.1 ✅ 字段级 inventory（实测）：users 无 avatar/college/grade/major/mbti/zodiac；
      无 profile/好友/推荐表；无 suggest/recommend/friend 接口；
      学校链 users.school_campus_id→campuses→schools **两表存在但数据为空、三人该列全 NULL**
- [x] WO10.2 ✅ 修正一处**文档失真**：MessageScreen 注释表在 WO#8 后未同步（仍写"邀请卡
      学校/学院/年级/头像 = mock"，实际那几项已移除/改占位）
- [x] WO10.3 ✅ 改前 FAIL 证据（PREFERRED）：9 行 mock 推荐 / 5 个假分享目标 /
      **点「发送」fetchCountDelta=0 却显示"已申请"** / 命中 7 个 mock 专有昵称
- [x] WO10.4 ✅ 产品改动：移除 9 个 mock 行 + 中性空态「暂无可显示的推荐」；
      整块删除好友申请弹窗与「添加」按钮；**分享入口本身不再渲染**（审核 51 更严格一步）；
      **MessageScreen 不再 import 任何 mock 数据**（本项目第一个零 mock 页面）
- [x] WO10.5 ✅ 9 条断言全 PASS（含审核 51 新增 NO_FAKE_FRIEND_REQUEST_STATE / NO_INERT_SHARE_ENTRY）
- [x] WO10.6 ✅ mock 身份**集中为测试 fixture**（审核 51 建议）：
      scripts/m5/fixtures/known-message-screen-mocks.json（含撞名警示；仅测试用）
- [x] WO10.7 ✅ **受控敏感度自检**（REQUIRED）：selftest-wo10-gate.mjs
      三个突变（注入 mock 昵称 / 注入"已申请" / 注入假分享目标）全被捕获，恢复即改判
- [x] WO10.8 ✅ 🚨 **发现并修复一个重大工具缺陷**：`tsc --noEmit` 对 solution-style 配置
      **检查 0 个文件却报 0 错误**（假 PASS）→ 新增 scripts/m5/check-types.sh
      （报告实际检查文件数，0 文件判 FAIL）；敏感度已验
- [ ] WO10.9 等审核裁定 **WO10 是否 CLOSED**（审核 51 已批准其范围与实施；关账措辞待确认）
- [x] WO10.10 ✅ **已承接**：FeedList 由 WO#11 完成；UserProfile 由 WO#12 进行；Map 待后续
      照 WO#10 方法先做字段级 inventory 再报计划
### WO#11 进展（Round 261）
- [x] WO11.1 ✅ 字段级 inventory：`GET /api/posts` **已存在**（与 WO#10 性质不同 → 本单是**接线**单）
      单条字段 id/author/authorId/body/place/createdAt/likeCount/commentCount/likedByMe/images[]
- [x] WO11.2 ✅ 发现库里 **20/24 条是 M1 E2E 测试残留**；且 **CampusScreen 已接真实 API 并正在显示这些残留**
      → **脏数据泄漏是当前活缺陷**，不是未来风险（我修正了原计划里过度保守的描述）
- [x] WO11.3 ✅ 发现 `campusInfo.members='12,486'` / `posts='38,920'` 是**编造的统计数字**（假权威）
      真实库 users=3 / posts=24，差几个数量级 → 处置：不显示 + 反向断言
- [x] WO11.4 ✅ 发现「刷新」是**假刷新**：`fetchDelta = 0`（零请求）却渲染 12 条编造动态
- [x] WO11.5 ✅ **入口溯源**：FeedListScreen **只能经 demo 脚手架到达**
      （Me → 三横线 → Drawer →「更多功能」[带 demo 徽章] → #/more → 校园圈 → #/feedlist）
      → `FEED_ENTRY_PROVENANCE: DEMO_SCAFFOLD` ／ `ORIGINAL_FEED_ENTRY: NOT_EVALUATED`
- [x] WO11.6 ✅ 改前 FAIL 证据（PREFERRED），含**门禁顺序修正**
      （内容类断言必须读"刷新后"快照，否则因停在错误态而**空过**）
- [x] WO11.7 ✅ 审核 52 已裁定 **WO11: APPROVED TO IMPLEMENT**，并授权删除 20 条测试残留
      name+region 处置／`/api/posts` 匿名可读口径
- [x] WO11.8 ✅ **已完成**：只读接线 + 数据清理（七步流程，deleted_count=20，规范数据完好）
### 忠实度审计与 KNOWN_DEVIATION 登记（Round 261 收尾）
- [x] AUDIT.1 ✅ **发现流程缺陷**：Gate 长期未做"对照原版基线逐条核对 title/interactions/navigation"，
      导致 feed-list 的 3 处偏差从未被捕获（基线文件一直在仓库里，screens/ 下 24 个屏）
- [x] AUDIT.2 ✅ 逐屏核对：feed-list（3 处偏差）／message（顶部三项**一致**，推荐区+分享面板为**有意后撤**）
      ／group（与 xml dump 一致；⭐基线 known_unknowns 明列"@面板入口位置未知"**独立佐证** WO#9B 的 NOT_EVALUATED）
      ／at-panel（baseline 为空；**补齐**此前未记录的"搜索框有无"→ dump 中无 EditText/无"搜索"）
- [x] AUDIT.3 ✅ 产出 `docs/m5/FIDELITY-GAP-AUDIT-closed-screens-vs-baseline.md`
- [x] AUDIT.4 ✅ 产出 `docs/m5/KNOWN-DEVIATIONS.md`：D-001~D-003（有意后撤，含恢复条件）
      + L-001~L-003（原版本身未观察到的范围限制）；并写明"**已完成 ≠ 与原版一致**"的禁止说法
- [x] AUDIT.5 ✅ PLAN.md 新增纪律：① Gate 必须含"基线逐条核对"层 ② 基线缺失须显式记录
      ③ 后撤须登记 KNOWN_DEVIATION ④ **把现象写成缺陷前先查是否已有解释**（我同一轮两次急着定性）
- [x] AUDIT.6 ✅ **已完成**：feed-list 的 3 处偏差已在 WO#11 修完（标题「校园圈」/ 左上关闭 / 刷新真请求），设备 Gate 13 条全 PASS
- [x] AUDIT.7 ✅ 持续纪律：WO#12 的 Gate 已含基线层（ORIGINAL_USER_PROFILE_CONFORMANCE: NOT_EVALUATED）
### WO#11 完成（Round 262）
- [x] WO11.7 ✅ 审核 52 裁定：**WO11: APPROVED TO IMPLEMENT**（且指出"五项其实上轮已裁定"，我不必再等）
- [x] WO11.8 ✅ **数据清理完成**（按授权七步流程）：deleted_count=20、规范数据完好、门禁残留清零
- [x] WO11.9 ✅ **层 1 实施完成**：FeedListScreen 接入 GET /api/posts、三态、真实刷新、
      移除 mock 与假权威数字、标题「校园圈」、左上关闭语义、学校切换 HIDE/DEFER、右侧按钮 UNCHANGED
      → 设备 Gate **13 条断言全 PASS**
- [x] WO11.10 ✅ 给 PostCard 加 `data-feed-id`（稳定业务身份测试钩子，替代"按位置选对象"）
- [x] WO11.11 ✅ 服务端回归连查并修复**三个真实问题** → REAL_EXIT=0：
      ① 认证清理从未自动运行（装 systemd timer，每 6h）
      ② 语音 C1 假 FAIL（8s 持锁 vs 5s 超时仅 1.3s 余量 → 改 20s；产品本身是对的）
      ③ 断言语义与清理节奏不一致（加真不变量 M5_AUTH_NO_UNBOUNDED_ACCUMULATION：30h 界 + 先收敛再断言 0）
- [x] WO11.12 ✅ 更新**冻结 manifest**：6 条 feed claim 由 DEVIATION_PENDING_FIX → **MATCH**（附设备实测证据），
      新增 FEED_NO_TEST_RESIDUE；现状 31 条 claim（MATCH 15 / NOT_EVALUATED 10 / DEVIATION_DELIBERATE 3 / UNCHANGED 3）
- [x] WO11.13 ✅ 审核 53 裁定"记录并观察 + 下次失败自动抓现场"；抓现场/互斥锁/脆弱同步三项已实施（详见下节）；**具体那一次仍未定位**（见 WO11.13-f）
      已排除限流/sink/服务不可用；时间线显示失败发生在服务进程重启（05:23:45）**之前**。
      **未复现、未定位根因、不声称已修**。若再现需抓现场（建议：失败时快照 journalctl + pg_stat_activity）
- [x] WO11.14 ✅ **已由 WO#12 承接**：UserProfileScreen 的字段级 inventory 与改前 FAIL 已完成（见 WO12.1/WO12.2）
- [ ] AUDIT.7 后续每个 WO 的 Gate 都要按纪律加"基线逐条核对"层（manifest 已就位）
### WO#12 进展（Round 262 收尾）
- [x] WO12.1 ✅ 字段级 inventory + **高严重度发现**：`UserProfileScreen.tsx:14` 的
      `const user = users[id] ?? users.u1` —— 传入的 id 形如 `u:<uuid>`（client.ts 的 toFeedPost 产出），
      **永不匹配** mock 字典 → 必然回落 u1。设备实测：点真实作者「Lemy」→ 资料页显示「**蒸柿煮捞呆**」
- [x] WO12.2 ✅ 改前 FAIL 证据（PREFERRED）：确认**三处缺陷**
      ① **假身份**（IDENTITY_FROM_ROUTE FAIL）② **死路私信**（→ #/chat?id=t1 → invalid、无 composer）
      ③ ⭐ **假成功关注**（fetchDelta=**0** 却显示"已关注"，与 WO#10 好友申请同类）
      另：AVATAR_PLACEHOLDER FAIL（仍用 mock SVG）
- [x] WO12.3 ✅ 前置未知已实测核实：**无** GET /api/users/:id（23 条路由核对）；
      /api/threads **只返 peerName 无 peerId**；该屏**无原版基线** → 记 NOT_EVALUATED
- [x] WO12.4 ✅ 审核 53 已裁定（4 项全部给出答案）；实施见下
      是否允许给 threads 加 peerId／无基线按 NOT_EVALUATED 处理
- [x] WO12.5 ✅ **实施完成**：12 条设备 Gate 全 PASS（详见下方「WO#12 完成（Round 263）」节）
- [x] WO12.6 ✅ 已消除：头像断言改用"**头像元素**是首字占位"判据，不再有偶然 PASS
      （mock u1 恰好没有 mbti 字段）→ 实现后需用**有该字段的 mock 对象**再验一次才算真过
### WO#12 完成（Round 263）
- [x] WO12.4 ✅ 审核 53 裁定：**WO12: APPROVED TO IMPLEMENT**（插队，不拆 P0 小单）；
      并冻结 identity 安全原则：unknown/malformed id → 明确不可用态，**NEVER 回落另一个用户**
- [x] WO12.5 ✅ **实施完成**：
      · 服务端三处只读扩展：`GET /api/users/:id`（只 {id,displayName}，404）／
        `GET /api/posts?authorId=`（服务端过滤；非法 → 400 `bad_author_id`）／
        `GET /api/threads` 增加 `peerId`（仅 direct，**机械验证** == 另一成员 id）
      · 客户端 UserProfileScreen 重写：解析 `u:<uuid>` → canonical UUID、**不回落**、
        昵称走权威来源、TA 的动态走服务端过滤、头像首字占位、无来源字段一律不渲染、
        「关注」移除、「私信」按 peerId 匹配真实会话（无则显示静态不可用）、三态明确
      · 另修 App.tsx 的 `route.query.id ?? 'u1'`（又一处 mock id 回落）
      → 设备 Gate **12 条断言全 PASS**；敏感度两条（均：突变→被抓→恢复→PASS）
- [x] WO12.6 ✅ 断言的偶然 PASS 已消除：头像改用"**头像元素**是首字占位"判据（不再用"整页 imgCount==0"）
- [x] WO12.7 ✅ 审核 54 已裁定：**WO#12: PASS / CLOSED**；敏感度②的键名分工（由 INVALID_PROFILE_ID_NO_FALLBACK 捕获）**已被接受**
      「抓它的是 INVALID_PROFILE_ID_NO_FALLBACK 而非审核点名的 NO_MOCK_IDENTITY」这一分工差异是否接受
      （两条断言测不同表面：前者测坏输入用例、后者测有效资料页）
- [x] WO12.8 ✅ **已由 WO#13 承接**：ProfileEditScreen 的字段级 inventory 与"假写成功"确认已完成（见 WO13.1）

### 未定位故障的排查进展（Round 263）
- [x] WO11.13-a ✅ 审核 53 裁定：接受"记录并观察 + **下次失败自动抓现场**"（不要求盲跑 10 次）
- [x] WO11.13-b ✅ **抓现场已实现**：`scripts/m5/capture-login-failure-forensics.sh`
      （7 类现场：服务启动时间/重启次数、后端日志 300 行、pg_stat_activity+wait_event+advisory 锁、
       OTP sink、health/ready、fd/ulimit/线程/磁盘/内存）已接进两条 verify 脚本的登录失败分支，
      并**逐项打印当次实际值**（token 长度 / user id / sink 目录）以区分不同失败类型
- [x] WO11.13-c ✅ **找到一条真实机制**：M5 服务器侧 Gate **自己会重启后端**
      （`verify-tmp-selfheal.sh` 的 `systemctl restart "$SVC"` + 清空 uploads/.tmp）
      → Gate 重启窗口内在飞的请求会失败，症状正是"间歇性登录失败、单独跑则 PASS"
      ⚠️ 我先前没搜到是因为只搜了字面量 `campus-backend`，而脚本用**变量** `"$SVC"`
      → 教训已入注释：**搜"谁会做 X"必须同时搜变量/间接引用**
- [x] WO11.13-d ✅ **Gate 互斥锁**：`scripts/m5/gate-lock.sh`（锁在服务器，带陈旧判定与原因打印），
      已接入 run-device-gate.sh 与 run-gate-server.sh；实测拒绝/抢占/释放/超时四条路径
- [x] WO11.13-e ✅ **修脆弱同步**：重启后由固定等 5 秒（实测就绪需 4s，**余量仅 1 秒**）
      改为**轮询 /api/ready 直至 200**（≤30s），并把副作用声明写入输出；
      失败行用 `ABORT` 前缀（gate 只放行 `^(SELF_HEAL|ABORT)`，否则诊断信息会被过滤掉）
- [x] WO11.13-f ✅ **机制已确认**（重启后约 176s 才 ready；门禁只等 5s）—— 见 WO11.13-f 节；具体那一次未逐帧重放
      （顺序上那次重启发生在失败之后 9 秒）→ 保持"未定位、不声称已修"，等抓现场复现


### WO#13 计划（Round 263 收尾）
- [x] WO13.1 ✅ 字段级 inventory 完成 → `docs/m5/WO13-PLAN-profile-edit-field-inventory.md`
      **审核 53 担心的"假写成功"确认成立**，且是**从「我的」页一步可达**（MeScreen 5 个入口）
- [x] WO13.2 ✅ 前置事实核实（不靠猜）：服务端**无**改资料写接口；MeScreen 5 个入口**有基线支持**
      （trident-me/baseline.json:38/:42）；**页面内容层无基线** → ORIGINAL_PROFILE_EDIT_BASELINE: UNAVAILABLE
- [x] WO13.3 ✅ 附带发现：App.tsx 的 **5 个孤儿路由**（无人导航到）里 **App.tsx:177 仍有编造数字 12,486**
      —— WO#11 从动态列表页删掉了它，但它在此处**活了下来**（mock.ts:502/503/587 也有）
- [x] WO13.4 ✅ 附带发现：ProfileEditScreen.tsx:14-18 的注释"**结构按原版实测**"**无落盘基线支撑** →
      须改标或补证据（已列入待裁定）
- [x] WO13.5 ✅ 审核 54 已裁定 5 项（选 (a) 新增 PATCH /api/users/me，只做 displayName）
      ② 简介/性别/标签是否加列 ③ App.tsx 的 5 个孤儿路由如何处置 ④ 那处无据结构主张如何处理
      ⑤ 严重度：是否插队（与 WO#12 同级）
- [x] WO13.6 ✅ **实施完成**：设备 Gate 15/15 PASS；改前对照 7 FAIL
- [x] WO13.7 ✅ 方法教训已入注释（坏 glob 会给出"假零命中"，而零命中极易被误读成"不存在"）
      **不会递归**（PowerShell 不把 `**` 当递归通配）→ 我据此误判"ProfileEditScreen 是死代码"。
      **必须用 `Get-ChildItem -Recurse | Select-String`**；"零命中"极易被误读成"不存在"。


### WO#13 完成（Round 263）
- [x] WO13.5 ✅ 审核 54 裁定：**WO13_PROFILE_EDIT_AUTHORITATIVE_WRITE: APPROVED**（HIGH/PREEMPTIVE）
      · 选 (a)：新增 `PATCH /api/users/me`，**只做 displayName**
      · 措辞更正：这是**第一个 profile-update 写能力**（项目已有发帖/评论/点赞），不是"第一个写能力"
- [x] WO13.6 ✅ **实施完成** → 设备 Gate **15/15 PASS**；seed 已精确恢复（anmoss/Lemy/Azur冰弦）
      · 服务端 PATCH：401／严格拒绝 6 个未知字段且点名／空・超长 400／**4xx 零写入**／
        ⭐**四方一致**（PATCH 响应==DB==/api/auth/me==/api/users/:id）
      · 客户端：保存链 draft→PATCH→DB→**权威响应**→UI commit；失败**保留输入**且无成功表象；
        头像首字占位、移除 inert「更换头像」、简介/性别/标签/学校一律不渲染
      · MeScreen：五个入口修正（「编辑资料」→本页 MATCH；其余四项**不再误路由**，渲染为不可点行+待核对）
      · 删除 App.tsx 的 5 个 fabricated orphan route（**12,486 随之消失**）
      · 降级了 ProfileEditScreen 里那处"结构按原版实测"的无据注释
- [x] WO13.7 ✅ 方法教训已入注释：坏 glob（`Select-String -Path 'dir\**\*.tsx'` 不递归）
      会给出"零命中"，而零命中极易被误读成"不存在"
- [x] WO13.8 ✅ 审核 54 的推广：**零命中只有在搜索范围被证明完整后才有证据价值**
- [x] WO13.9 ✅ 审核 55 已裁定：① **驳回**我"资源是根因层"的断言 —— **DO NOT** 提高
      max_connections 或加 swap 当作"修复"（在 396MB 机器上反而可能加剧内存压力）；
      改为**单独立案**做 cold-start / resource pressure 调查（见 WO14.0）。
      已确认的只是**机制**：重启后 readiness 可能约 176s 为 false，在其之前放行流量就会失败。
      ② MeScreen 的 mock 身份 → 单开下一单 **WO14**，且**优先于 Map**

### ⭐ WO11.13-f 结案方向：机制已确认（Round 263）
- [x] WO11.13-f ✅ **机制已确认**（不再称"未定位"）：
      后端重启后约 **176 秒**才 ready（实测时间戳：Started 06:49:54 → ready 06:52:50），
      期间连续 `[migrate] retryable: database unreachable`；资源侧：free 仅 8MB、swap 183MB、
      loadavg 3.27（2 vCPU）、**PG max_connections 仅 15**。
      → M5 gate 的 verify-tmp-selfheal.sh 会**重启后端**，而它原来只 `sleep 5` → 完全错过该窗口 →
        后续要登录的段偶发失败，**单独跑同一脚本却 PASS**。时间线与 05:19:37 那次吻合。
      → 修正：就绪轮询 30s→**240s**；`deploy-server.ps1` 由等 `/api/health`（liveness）改为等
        `/api/ready`（readiness，原来会在"还没就绪"时就报成功并继续）。
      ⚠️ 边界：**机制**已确认；**具体那一次**未逐帧重放。


### ⭐ 本轮新增教训（已入注释）
- [x] WO13.10 ✅ **设备级 E2E 抓到服务端脚本永远测不出的缺陷**：CORS `allow-methods` 缺 **PATCH**。
      PATCH 触发预检(OPTIONS) → 预检失败 → fetch 报 "Failed to fetch" → 设备上保存 100% 失败，
      而 `verify-wo13-patch-me.sh`（curl，**不带 CORS 语义、不发预检**）全 PASS。
      → 已修 + 在服务端脚本里**新增预检断言**。教训：**每新增一个 HTTP 方法都要同步检查 allow-methods**。

### ⭐ 本轮额外修好的三个"静默失效"问题（Round 263 续）
- [x] WO13.11 ✅ **APK 里「取消点赞」一直坏**（用户可见）：
      服务端注册了 DELETE `/api/posts/:id/like`、客户端**确实在用**，
      但 CORS `allow-methods` **缺 DELETE** → DELETE 不是 CORS 简单方法、**必触发预检** →
      预检失败 → fetch 报 "Failed to fetch"。
      （点赞是 POST 且无 body 时客户端不带 content-type → 简单请求 → 所以**点赞正常、只有取消坏**，
        这解释了长期没人发现。）
      设备实测对照：修复前 DELETE → "Failed to fetch"；修复后
        POST → 200 {"liked":true,...} ／ DELETE → 200 {"liked":false,...}
      已修（allow-methods 加 DELETE）+ 新增机械门禁 `check-cors-methods.sh`
      （从**部署产物**提取已注册方法，断言 ⊆ allow-methods）→ 现在 **CORS_METHODS_COVERAGE: PASS**
- [x] WO13.12 ✅ **我把 `tools/deploy-server.ps1` 弄坏了并修好**（三层原因）：
      ① 写入**无 BOM** → PS 5.1 按 ANSI 误读中文注释 → 解析失败
      ② 含发往 Linux 的 bash here-string，**CRLF** 让 bash 收到 `pipefail\r` → invalid option name
      ③ 替换链在空串上操作 → `WriteAllText` **只写出 BOM、文件被截断成 3 字节**；
         而 `ParseFile` 对空脚本报 **0 错误**（"空脚本"合法！）
      → 定位手段：`AST.EndBlock.Statements.Count == 0` 是唯一能识破"空脚本"的办法
      → 验证：真机跑 .ps1，**mtime 变化**才算部署成功（而不是"看起来成功"）
- [x] WO13.13 ✅ **`.gitattributes` 固定 LF**：`.ps1 text` + `autocrlf=true` 会在下次 checkout
      把上面三个文件变回 CRLF、**静默再次弄坏部署**。已为
      `deploy-server.ps1` / `deploy-nginx-tls.ps1` / `push-ops.ps1` 显式加 `eol=lf`。
      验证：`git check-attr` 显示 eol: lf；且 `autocrlf=true` 下重新 checkout 后 CR=0、BOM 仍在。
- [x] WO13.14 ✅ 新增 `check-ps1-integrity.sh`：体积下限、**顶层语句 > 0**、解析错误数，
      以及**条件化**的 BOM/换行要求（含非 ASCII 才要 BOM；含 bash 正文才要 LF）。
      ⚠️ 记录一个自省：第一版写成"无 BOM 一律 FAIL、含 CRLF 一律 FAIL"→ **18 个文件绝大多数被误判**
      （它们解析正常、运行正常）。**会误报的门禁比没有门禁更糟 —— 它会训练人忽略红色。**
      另有 CR 检测 bug：`grep -c $'\r'` 在 0 匹配时退出码为 1，`|| echo 0` 追加出 "0\n0" →
      整列恒 yes。已改字节级 `tr -cd '\r' | wc -c`。
- [x] WO13.15 ✅ 本轮方法教训（已入注释）：
      · **每新增一个 HTTP 方法，都要同步检查 CORS 的 allow-methods**
      · **服务端脚本 PASS ≠ 客户端可用**（curl 不带 CORS 语义、不发预检）—— 真机验证的不可替代性
      · **搜"谁会做 X"要同时搜变量/间接引用**（我漏掉 `systemctl restart "$SVC"`）
      · **零命中只有在搜索范围被证明完整后才有证据价值**（坏 glob 会给出假零命中）

      ② MeScreen 自身仍显示 mock 的 me.name/me.avatar 是否单开一单

### ⭐ WO14 计划立项（审核 55 指定，**优先于 Map**）
- [x] WO14.1 ✅ inventory 已完成（含逐字段表与 reload/relogin 语义）→
      `docs/m5/WO14-PLAN-me-authoritative-self-identity.md`；详见下方「WO14 进展」节
      已知起点：`app/src/screens/MeScreen.tsx` 用 `me.name` / `me.avatar`（mock）
- [x] WO14.2 ✅ Gate 清单已写进计划（含审核 55 指定的 5 条 + ME_NO_FALLBACK_ON_UNAVAILABLE）
      `ME_IDENTITY_FROM_SESSION` ／ `ME_DISPLAY_NAME_CONSISTENCY` ／
      `PROFILE_EDIT_TO_ME_CONTINUITY`（**关键**：改完昵称回「我的」必须显示新值）／
      `ME_AVATAR_PLACEHOLDER` ／ `NO_MOCK_SELF_IDENTITY`
- [x] WO14.3 ✅ 计划已冻结：头像首字 placeholder、**不加列**
- [x] WO14.4 ✅ 理由已记录；实测比预判更直接：**同屏两个身份**
      WO#13 已让它通往真实 ProfileEdit → 若不同步，会产生**新的跨页面 identity inconsistency**


### ⭐ Cross-cutting（审核 55 指定，独立跟踪）
- [x] X1 ✅ 已完成（见下方 X1/X2/X3 节）：按审核 55 的修正后不变量实现并按客户端实际调用验证
      我提议的是"每个已注册方法都必须在 allow-methods 里" —— 审核 55 判为**过强**：
      将来可能有"server route exists but intentionally not callable from WebView/browser"，
      强迫入表会**无意扩大暴露面**。
      **正确的不变量**：**每一个被 WebView/browser 客户端实际调用的 method**
      都必须通过**真实 CORS preflight contract**。
      实现要点：先建 `frontend API operations → method → path → 是否需要预检`，
      再对每种实际浏览器 method 发真实 OPTIONS
      （`Origin: <app origin>` + `Access-Control-Request-Method` + `Access-Control-Request-Headers:
        authorization,content-type`），验证：2xx/204 ／ allow-origin 合法 ／
      **allow-methods 含所请求方法** ／ **allow-headers 含所请求的非简单头**。
      → 以后新增 PUT/PATCH/DELETE/带自定义头的 POST，只要客户端真会调用就自动进 Gate。
      现有 `check-cors-methods.sh` 是**近似版**（registered ⊆ allow-methods），需按上述改写。
- [x] X2 ✅ 已完成（见下节）：拆出 DESTRUCTIVE_SELF_HEAL_GATE，常规回归不再重启后端
      常规 M5 regression **不应该每次都重启正在服务的 backend**、制造接近 3 分钟的不可用窗口。
      → 拆为 **`DESTRUCTIVE_SELF_HEAL_GATE`**，要求显式 maintenance / exclusive execution；
        普通 server regression 尽量**不** restart 服务。
- [x] X3 ✅ 已完成（见下节）：清洁冷启动实测 11~20s，且窗口内无资源耗尽
      DO NOW（记录事实，不先改配置）：
        · 启动期间的**精确 DB 连接错误 / SQLSTATE**
        · 失败时刻 `pg_stat_activity` 状态与计数
        · 应用连接池 max 与**所有** gate/test 的并发 DB 客户端
        · `MemAvailable`、swap-in/out、OOM / journal 信号
      ⚠️ 判据纪律：`free` 小 ≠ 内存不可用（要看 MemAvailable）；swap 已用 ≠ 证明当次 DB unreachable 由 swap 导致；
        `max_connections=15` 且 used=10 很紧，但**要有实际 SQLSTATE/connection error 才能说是连接耗尽**。

### ⭐ 状态表述更正（审核 55，Long-standing 间歇故障）
- [x] 把原先的 `ROOT_CAUSE UNKNOWN` 改为更精确的两条：
      `PREMATURE_POST_RESTART_TRAFFIC_MECHANISM: CONFIRMED`
      `HISTORICAL_05:19:37_EVENT: CONSISTENT WITH THIS MECHANISM BUT NOT FORENSICALLY PROVEN`
      （审核 55：已找到足以指导工程修复的机制，**旧事件没必要为"100% 归因"继续考古**）

### ⭐ 本轮最值得保留的方法论（审核 55）
- [x] **`SERVER_API_PASS ≠ BROWSER_CLIENT_REACHABLE`**：
      服务端 API 验证通过只证明**协议端点自身**工作；只要真实客户端还隔着
      **CORS、WebView origin、构建产物与运行状态**，就**不能替代客户端 E2E**。


### ⭐ Cross-cutting X1/X2/X3 —— **本项目轮已全部完成**
- [x] X1 ✅ **`CORS_CLIENT_METHOD_COVERAGE` Gate 已按审核 55 的修正后不变量实现**：
      `scripts/m5/check-cors-contract.sh` 从**客户端源码**提取客户端真正使用的 method，
      对每个发**真实预检**（Origin + ACRM + ACRH），校验 2xx/204 ／ allow-origin 回显 ／
      allow-methods 含该方法 ／ allow-headers 含所请求的非简单头。
      实测 4 个 method（DELETE/GET/PATCH/POST）全部 PASS；反向信息报"多列了哪些客户端不用的方法"。
      ⭐ 并且**新增 `selftest-cors-contract.sh`**：三种受控破坏（客户端声明 PUT ／
      要求未允许的头 ／ 非白名单 origin）**全部被检出**，复原后回到 PASS →
      `SELFTEST_CORS_CONTRACT: PASS`。
      ⚠️ 该自测**特意写严**（③ 不只要"红了"，还要求**原因指向 origin**），当场揪出我门禁的两个真 bug：
        ① 判定逐项覆盖 → 根因指错（origin 不被允许却报"缺 content-type"）→ 已改为**累积所有未通过项**
        ② `case` 的 pattern 匹配的是**case 主语**而非循环变量 `$m` → `OPTIONS)` 永不命中 → 已改直接判断 `$m`
- [x] X2 ✅ **破坏性自愈/重启测试已从常规回归拆出**：
      · `gate-server.sh` 第 3 节默认记 `SKIPPED_DESTRUCTIVE`（**且不置 FAILED**），
        并把它**移出 PERSISTENT 的"必须 PASS"列表**；汇总新增独立 `DESTRUCTIVE` 行
      · 新增 `scripts/m5/run-destructive-gate.sh`（**唯一入口**，强制持有 Gate 互斥锁，拿不到即拒绝）
      · 实测：常规回归 `M5_TMP_SELFHEAL SKIPPED_DESTRUCTIVE`、PERSISTENT/STAGE/REGRESSION PASS、
        REAL_EXIT=0，且**后端启动时间未变**（07:24:13 → 07:24:13）⇒ **常规回归不再重启服务**
      · 实测：显式 `M5_ALLOW_DESTRUCTIVE=1` 时后端**真的重启**（07:24:13 → 07:43:08）且
        `DESTRUCTIVE PASS` ／ `M5_TMP_SELFHEAL PASS` ⇒ `SELFTEST_DESTRUCTIVE_GATE: PASS`
      ⭐ 自测**双向都测**（默认不重启 + 显式则真跑）—— 只测一个方向的话"把整节删掉"也能骗过测试。
- [x] X3 ✅ **冷启动/资源压力事实调查完成**（只记录、**未改任何参数**）→ `docs/m5/X3-COLD-START-FACTS.md`
      ⭐ 核心结果：**清洁冷启动是 11~20 秒**（实测 3 次：14s/11s/20s），**不是** 176s；
      且清洁窗口内**无资源耗尽**（MemAvailable 216~225MB、swap 增量 **0 页**、
      campus 连接数最大 **2**、等待中的锁 **0**、无 OOM、loadavg ≤1.54）
      → **直接证实审核 55 对我"资源是根因层"那条断言的驳回是对的**。
      已采集审核 55 要求的全部事实：应用池 `PG_POOL_MAX=5`、`max_connections=15`+`reserved=3`、
      4 类并发 DB 客户端、MemAvailable/swap-in-out/OOM/journal 信号。
      代码侧按 DO NOW 补了**精确 SQLSTATE**：`db.ts` 启动探针原来 `catch { return false }`
      **把错误完全吞掉** → 现在记录 `code=<SQLSTATE> errno= syscall= address=:port message=`。
      ⚠️ 【已由 X3.1 更新】176s 那次与**并发争用**相关现已 **PROVEN**（受控复现 180s ≈ 176s）
- [x] X3.1 ✅ **已完成并证明**（详见本文件末尾「X3.1 结论」节）：
      受控只变"并发 DB 客户端数" → READY_AT **13s / 18s / 180s**（N=0/8/20），
      几乎精确复现历史那次的 176s ⇒ 争用假设 **PROVEN**（不再是 CONSISTENT）
      并发现关键是**连接 churn**（三档 conn_before 都是 2）而非常驻连接数

### WO14 进展（Round 264）
- [x] WO14.1 ✅ **inventory 完成**（审核 55 要求"先 inventory，不要直接改"）→
      `docs/m5/WO14-PLAN-me-authoritative-self-identity.md`
      ⭐ 发现比审核 55 预判的**更直接**：不是"跨页面不一致"，而是**同一块屏幕上同时显示两个身份**——
        中心大字 `me.name` = **mock「自定义名称6」**，
        下方登录行 `session.user.displayName` = **权威「Lemy」**（设备实测，四个 Gate 全 FAIL）
      ⭐ 且根因是**两处互相独立**的缺陷：
        ① 中心名字/头像走 mock（`MeScreen.tsx:74/:73`，`mock.ts` 的 me）
        ② **登录行读陈旧缓存**：`getSession()` 有模块级 cache，而 MeScreen 只在挂载时读一次；
           WO#13 的 PATCH 成功后**没有任何代码把新 displayName 写回 session 缓存**
           ⇒ **即使把中心名字接上权威来源**，只要不修缓存同步，登录行仍会滞后
- [x] WO14.2 ✅ **已实施完成**（审核 56 确认计划早已批准；我多等了一轮，如实记录）：8 PASS + 1 NOT_EVALUATED，`DEVICE_GATE_EXIT=0`
      ／ 手机号在「我的」页继续显示是否成立 ／ `ORIGINAL_ME_SELF_IDENTITY` 记 NOT_EVALUATED）
- [x] WO14.3 ✅ 已产出改前证据（PREFERRED）：`scripts/m5/diagnose-wo14-me-identity.mjs`
      实测 4 条 FAIL（ME_DISPLAY_NAME_CONSISTENCY ／ PROFILE_EDIT_TO_ME_CONTINUITY ／
      NO_MOCK_SELF_IDENTITY ／ ME_AVATAR_PLACEHOLDER），并证明 `PATCH` 未同步会话缓存
- [ ] X3.2 待观察：若再出现慢启动，`[migrate] ...: code=<SQLSTATE> ...` 会给出可归因证据


### ⭐ X3.1 结论（Round 264 追加）
**争用假设已由受控实验证明**，不再是"只一致"：
```
N(并发 DB 客户端)  READY_AT  loadavg(before→after)  'database unreachable' 次数
0                 13s       0.41 → 1.05            0
8                 18s       1.45 → 3.93            0
20                **180s**  5.08 → **24.97**       1
```
→ `COLD_START_TIME_SCALES_WITH_CONCURRENT_DB_CLIENTS: PROVEN`
→ `HISTORICAL_176S_EPISODE_EXPLAINED_BY_CONTENTION: STRONGLY SUPPORTED`（180s ≈ 记录的 176s）

**关键洞察（反直觉）**：三档 `conn_before` **都是 2** —— 变的是**连接 churn**（worker 用
`psql -c` 每次建连即退）与 **CPU 排队**，不是稳态连接数。
⭐ 这**反向印证审核 55 的裁定**：问题不在 `max_connections=15`，
所以**提高它不会解决**（清洁启动时连接数只有 2）。

**完整修复链条（三条已落实）**：Gate 互斥锁（阻止并发致因）→ 破坏性测试拆出常规回归
（不再重启在服务的后端）→ 就绪轮询 240s（等待语义正确）。
详见 `docs/m5/X3-COLD-START-FACTS.md` §五/§六。

### ⭐ 本轮（Round 264）流程改进：把"检查"变成"流程的一步"
- [x] ✅ **本地静态检查接进常规服务器流程**：`deploy-and-run-server-gate.sh` 新增**第 1.5 步**，
      在**部署之前**跑 `check-all-local.sh` —— 理由：若本地就不健康（类型错/语法错/PS1 被截断），
      那么"服务器侧门禁 PASS"是在验证一份**本身有问题**的产物；顺序上应先证本地再证服务器。
      端到端实测：`CHECK_ALL_LOCAL: PASS` → `SERVER_ARTIFACT_PROVENANCE: PASS` →
      `CORS_CLIENT_METHOD_COVERAGE: PASS` → `REAL_EXIT=0`（PERSISTENT/STAGE/REGRESSION PASS，
      `M5_TMP_SELFHEAL SKIPPED_DESTRUCTIVE`）
      → 本会话已被"忘了跑某个检查"坑过两次（solution 配置的 tsc **空过**、
        `deploy-server.ps1` 被截断成 3 字节无人发现），故不依赖记忆而依赖流程。
- [x] ✅ **全设备回归确认本轮改动未破坏任何东西**：本轮改了 `server/src/db.ts`（SQLSTATE 记录）、
      CORS allow-methods（PATCH/DELETE）、gate 第 3 节（跳过语义）→
      **8 条设备 Gate 全部 `DEVICE_GATE_EXIT=0`**：
      WO#13 profile-edit ／ WO#12 他人主页 ／ WO#11 feed ／ WO#10 message ／ WO#8 ／
      WO#9A 群聊 ／ WO#9B 层A ／ WO#7 文字发送
- [x] ✅ 收尾核对：门禁残留 **0**；基线精确（`users=3 threads=3 members=5 messages=5 media=3`）；
      WO14 诊断脚本改过的昵称**已自行恢复**（seed 无污染）
- [x] ⚠️ 再次踩到（已记录，避免再用）：**在 PowerShell 里内联含 `||` 的 SQL** 会破解析 →
      一律改用已有脚本（本项目早有此纪律，本轮又犯一次）

### WO14 改前 FAIL 证据（Round 264 追加）
- [x] ✅ **门禁已写好并拿到改前 FAIL**（`scripts/m5/gate-wo14-me-identity.mjs`，`DEVICE_GATE_EXIT=1`）：
      `ME_IDENTITY_FROM_SESSION` ／ `ME_DISPLAY_NAME_CONSISTENCY` ／
      `PROFILE_EDIT_TO_ME_CONTINUITY` ／ `ME_AVATAR_PLACEHOLDER` ／ `NO_MOCK_SELF_IDENTITY` **全 FAIL**；
      `ME_NO_FALLBACK_ON_UNAVAILABLE` 记 **NOT_EVALUATED**（清 session 会破坏同轮其它断言，故不假装验过）
      ⭐ 连续性那条最能说明"两处缺陷独立"：**保存本身成功**（savedOk=true），
        但回「我的」**两处都没跟随** —— 中心名因走 mock、登录行因读陈旧会话缓存
      seed 已精确恢复（`displayName:"Lemy"`）
- [x] ✅ **修掉我自己门禁里一个会把 5 条 FAIL 洗成绿的判定 bug**：
      第一版 `every(PASS) ? PASS : some(NOT_EVALUATED) ? PASS_WITH_NOT_EVALUATED : FAIL`
      → 只要存在任一 NOT_EVALUATED 就**遮蔽 FAIL**，实测首跑输出 `PASS_WITH_NOT_EVALUATED` 且 **exit 0**（假绿）。
      已改为**先 FAIL → 再 NOT_EVALUATED → 最后全 PASS**，并新增 `WO14_GATE_REASON` 列出失败项。
      （同类缺陷本轮还修过：CORS 门禁的"逐项覆盖导致最后一项赢"、"把跳过当 PASS"）
- [x] WO14.2 ✅ **已实施完成**（审核 56 确认计划早已批准；我多等了一轮，如实记录）：8 PASS + 1 NOT_EVALUATED，`DEVICE_GATE_EXIT=0`

### ⭐ WO#14 实施完成（Round 264）—— 同屏两个身份已消除
- [x] ✅ **实施**（commit da3547d）：身份改由权威 `GET /api/auth/me`，**中心大字与登录行共用同一个值**
      （结构上不可能再"同屏两个身份"）；头像改首字占位；读不到 → 明确不可用态、**不回落 mock**
- [x] ✅ **第二处独立缺陷也修了**：`session.ts` 新增窄函数 `updateSessionUser()`
      （审核 55/56 批准的形状，非全局状态/事件总线），只在 PATCH **成功分支**调用，
      且传**服务端返回值**而非用户输入
- [x] ✅ **顺查出第三个消费方**（审核 56 未列）：`TabBar.tsx:45` 底栏标签也读会话缓存 + 1s 轮询
      → 新增 `PROFILE_EDIT_TO_TABBAR_CONTINUITY`；实测改名后底栏跟随
- [x] ✅ **Gate 结果**：改前 5 FAIL（3806e55）→ 改后 **8 PASS + 1 NOT_EVALUATED**、`DEVICE_GATE_EXIT=0`
      `ARTIFACT_PROVENANCE: PASS`（web → cap asset → 已装 APK 三者一致）
- [x] ✅ **敏感度（REQUIRED，归因干净）**：两次受控突变各自只让**对应那一格**变红
      （① 失败回落 mock → `ME_FAILURE_NO_STALE_IDENTITY` FAIL，其余 8 格全 PASS；
        ② 失败写缓存 → `PROFILE_EDIT_FAILURE_DOES_NOT_MUTATE_SESSION_CACHE` FAIL，其余 8 格全 PASS）；
      撤销后回到全 PASS、`DEVICE_GATE_EXIT=0`
- [x] ✅ **回归**：8 条设备 Gate 全部 `DEVICE_GATE_EXIT=0`；种子精确恢复（DB=/api/auth/me 均为 Lemy）
- [x] ⚠️ **两个过程性缺陷（值钱的是这两个）**：
      ① **溯源门禁挡住了一次假证据**：我漏跑 `npx cap sync android` → APK 里是 **06:46** 的旧 bundle，
         `ARTIFACT_PROVENANCE` 当场判 FAIL 并声明"不得引用由该 APK 得出的设备结论"。
         没有它，我可能拿**旧 APK** 跑 WO#14 门禁并把旧代码的 PASS 当新代码的证据。
      ② **门禁自身的"恢复"不完整**：恢复步骤**绕过 UI**，于是服务端回到 Lemy 而**设备缓存仍留测试昵称**，
         `TabBar` 读缓存 ⇒ 残留会误导后续轮次。已修（恢复时同步写回缓存）。
         **教训：「恢复了服务端」≠「恢复了整个系统」** —— 绕过 UI 的写操作要自己复原 UI 侧派生状态。

- [ ] WO14.6 ⬅ 待裁定：`ME_NO_FALLBACK_ON_UNAVAILABLE` 仍记 NOT_EVALUATED
      （清 session 会破坏同轮其它断言）→ 是否单开一轮专项验证"未登录时不回落 mock"？

### ⭐ WO14.5 开工种子：MapScreen inventory 的**第一手事实**（Round 264 结尾，未深入）
- [x] ✅ WO14.5 inventory 已完成（结论见 WO15 计划及其两份更正）；WO#15 实施已获批准并在进行中
      **已有事实（本轮到这一步为止）**：
      · 它 `import { mapMarkers } from '../data/mock'`（第 10 行）→ 标记可能全是 mock
      · mock 的 `mapMarkers` 每条形如
        `{ id, place:'阳光操场', color:'#f5453b', userId:'u1', postId:'p1', x:430, y:1030, lat, lng }`
        —— 即**同时**带"屏幕像素坐标(x,y)"与"经纬度(lat,lng)"两套定位，共 6 条
      · ⭐ **服务端可能已有权威来源**：迁移 `003_data_model_v01.sql` 里有 **`places` 表**，
        且 `004_m3_model_revisions.sql` 里有 **`schools` / `campuses`** 表
        → 所以第一件事是查：`places` 里到底有没有数据？标记能否由 `posts`+`places` 推出？
          （若能，则与 WO#12/WO#14 同一命题：**把 mock 换成权威**）
      · ⚠️ mock 的 `schools` 里带 `members: '12,486'` —— **编造的成员数**，
        与我在 WO#13 删掉的那个"12,486 位同学已加入"**同一类**（值得同源处理）
      · 另有三个原生地图实现 `native/{AmapMap,RealMap,TencentMap}.tsx` + `native/mapApi.ts`
        + `native/mapTiles.ts`，与 `CAMPUS_CENTER` 常量 → inventory 必须覆盖"哪个实现真正在用"
      **按纪律**：**先 inventory，不要直接改**（与 WO#14 同）；并**先取证再断言**。

### ⭐⭐ WO14.5 inventory **第一批硬事实**（Round 264 结束，含一个意外发现）
**探针**：`scripts/m5/probe-map-authority.sh`（只读）
```
places : 24 行  列 = id, name, address, latitude, longitude, created_at
schools: **0 行**（空壳）      campuses: **0 行**（空壳）
posts  : 有 place_id；**4 条 post 关联了 place**
```
**⭐ 意外发现：`places` 的 24 行里 23 行是测试残留**：
```
唯一真实行：北京交通大学 | 西直门外上园村3号 | 39.9519,116.3373
其余 23 行：同名地点<10位随机数> | 同名A的地址（31.1,121.1）／同名B的地址（39.9,116.3）
            ← 明显的"同名地点"测试造数（上海/北京的假坐标）
```
**⇒ 两个结论**
1. **地图标记的"权威来源"实质上只有 1 条真实地点**，而 mock 有 **6 条**标记
   （阳光操场／教育超市／图书馆／逸夫教学楼／思源楼／学苑公寓）→ 两边**对不上**。
   故 WO14.5 的正确处置**不是**简单"把 mock 换权威"，而要先判断：
   这 6 个地点是**原版真实存在**的（需基线证据）还是我们自己编的（则应删/标 NOT_EVALUATED）。
2. ⭐ **`check-server-baseline.sh` 不覆盖 `places` 表** → 这 23 行残留**长期不可见**。
   同类风险：`schools`/`campuses`/`groups`/`announcements`/`comments`/`likes` 等也未被基线口径覆盖。
   ⇒ 待办：**扩大基线口径**（或至少给"已知会有造数的表"加残留检查）。
   ⚠️ 清理那 23 行前必须先查 `posts.place_id` 是否引用它们（有外键），**不能直接删**。
- [x] WO14.5a ✅ **已完成**：见 WO15 计划更正 —— 结构化基线已找到，结论已按证据更正（详见下节）
- [x] WO14.5b ✅ **已完成**：清理 22 行 places 残留 + 基线新增覆盖度审计（21 表：覆盖 9/未覆盖 11）+ 门禁 runner 自动清残留
- [x] WO14.5c ✅ **已完成**：默认 provider=**tencent**（与基线的"腾讯地图 SDK"一致）；降级链 tencent→amap→raster→OfflineMap
- [ ] WO14.5d ⚠️ mock 的 `schools` 带 `members: '12,486'`（编造成员数），
      而 `schools` 表**为空** ⇒ 无权威来源，按纪律处理（与 WO#13 删掉的同一类）

### ⭐⭐ Round 265：WO14.5 与 WO15 计划的**两次自我更正**（含一个系统性发现）
- [x] ✅ WO14.5b 完成：`places` 有 **22 行测试残留**而 `check-server-baseline.sh` **根本不查该表**
      → 已安全清理（dry-run 默认／删前断言零引用／删后自证）
      → 并把基线脚本升级为**覆盖度审计**（**21 张表：覆盖 9 ／ 未覆盖 11**，且声明"未覆盖 ≠ 干净"）
      → 还找到残留**根因**：一次 8 条回归全扫 → `messages` 5→8（每个 Gate 只管造不管收）
        已在**唯一入口** `run-device-gate.sh` 加第 8/9 步 best-effort 清理
        对照：修复前 5→**8**（需手清）／修复后跑 WO#9B → 仍 **5**、残留 **0**
- [x] ✅ WO14.5c 完成：默认 provider=**tencent**（与基线"腾讯地图 SDK"一致）
- [x] ✅ WO14.5a 完成但**结论被我自己更正**（见下）
- [x] ⭐⭐ **WO15 计划两次更正**（`docs/m5/WO15-PLAN-CORRECTION-{baseline-found,2-poi-detail-not-blocked}.md`）
      ① **我犯的第一类错**：只做**窄搜索**（搜 6 个地名串）就断言"基线稀少"，
         而 `docs/original-baseline/` 下有**结构化基线**（trident-map / poi-search / supplies）
      ② **我犯的第二类错**：读了 `screens/poi-detail/baseline.json` 就下 `BLOCKED`，
         **没查有没有 supersedes** —— 而 `supplements/poi-detail.json` 明写
         `states.normal.status: not_reproducible → **observed**`
- [x] ⭐⭐ **新增机械工具** `scripts/m5/baseline-inventory.mjs`：
      基线全貌清单（**24 屏 + 10 补采**）＋ `--grep` **带分母**的全文检索（`--grep 阳光操场` → **0/32**）
      ＋ **supersedes 追踪**。它当场揪出一个**系统性证据时效问题**：
- [x] ✅ **X4 已自查完成并三次更正**（`docs/m5/X4-SELF-AUDIT-superseded-baseline-impact.md` 更正版）：
      ⭐ 最终真相：**权威索引 `docs/original-baseline/manifest.json` 是正确的**
      （`expected_screen_count=22`，与 `docs/m3/EVIDENCE-PROVENANCE-AUDIT.md:98` 的
      「22 observed / 0 evidence-blocked」一致）；只有 **3 份屏内旧快照**未回写
      （`at-panel`/`media-preview`/`poi-detail`），其取代关系**已记在 supplements 的 supersedes 里**。
      ⇒ 我先前"6 屏被取代 ⇒ 既有结论可能过期"的警报**夸大了**，根因是
        **我的工具读错了来源**（读了屏内快照而不是权威索引）。
      ⇒ 已就地更正 `FIDELITY-GAP-AUDIT` 的 at-panel 小节（结论不受影响，仅前提句按权威索引读）
      ⇒ 工具已改为「**权威索引优先 + 快照不一致即 MISMATCH**」
- [x] ✅ **沉淀纪律**：`Source validity（来源权威性）` —— 与本项目已有的 Target/Fixture/Origin/
      Artifact/Observation validity 同族：**同一事实可能有多个副本且副本会过期**；
      引用前必须确认"读的是不是权威那份"；**否定性结论**（没有/未知/BLOCKED）门槛更高：
      必须先证明 ①搜索范围完整 ②来源权威 ③无更新记录取代
- [x] ✅ 本轮同一类错误共犯 **3 次**（窄搜索 → 读错来源 → 又窄搜索），三个都如实记录在案
- [x] ✅ X4' 已由审核 57 裁定：**认可"不全量重审"**，A 已实现、B 已做 ⇒ `X4: CLOSED`
      （我原提议"单开一单逐条复核"**已自行撤回**）**6 个屏幕的 `baseline.json` 状态已被补采取代**：
      `at-panel` / `comment-detail` / `login-select` / `login-sns` / `media-preview` / `poi-detail`
      （例如 media-preview 与 at-panel 也是 not_reproducible → **observed**）
      ⇒ 凡此前**只读 baseline.json** 得出的 `BLOCKED`/`NOT_EVALUATED` 判定**都可能已过期**。
      请裁定：**单开一单逐条复核历史结论**，还是只在**新**结论上强制？
- [x] ✅ X5 已由审核 57 **批准**并**已完成**：`baseline-inventory.mjs --check` 已接入 `check-all-local.sh` ④b
- [x] ✅ 记录**证据缺口**（不在本单修）：`feed-list`/`feed-detail` 的 observed 是 **error** 态、
      `announce`/`chat`/`comment-detail`/`group` 的 observed 是 **empty** 态
      ⇒ 这几屏的"正常态"基线**未采集**，引用时不得当作"原版正常态已知"
- [x] ✅ 明确 **BLOCKED 的两种含义必须分开**：
      `BLOCKED_BY_POLICY`（策略禁止，不得执行）vs「入口当时不可达」（**可能后来已被恢复**）
- [x] ✅ 如实记录：`supplements/poi-detail.json` 自标 `EVIDENCE_OBTAINED_BY_POLICY_VIOLATION`
      （`docs/POLICY-VIOLATION-2026-09-21.md`，**已登记／用户裁定 A／2026-09-21 20:47 结案**）
      → 其**结构性结论仍有效**，但引用时必须带上该标注。我本轮**未对原版做任何写操作**，
        且**未重新采集基线**（所有原版结论来自既有文件）
- [x] ✅ 原 6 项已由审核 57 覆盖：**WO15: APPROVED TO IMPLEMENT**（含方案 A 坐标字段，已实现）
      方案 A、B 或其它／mock 6 条保留加注释／颜色 NOT_EVALUATED／是否先补原版 Map 只读基线采集
- [ ] ⬅ 待裁定：**WO14.5d 是否单开 WO#16**（校园/校区选择与原版形态对齐；顶部应为校区列表、`N条校园圈` 而非 `N位同学`）／**视觉通道是否接入**（vision 两次返回空，我未核对过基线截图像素）
      **视觉通道是否接入**（`vision` 工具两次返回空，故我**没有**核对过基线截图像素）

### ⭐ Round 265 收尾：审核 57 裁定 + WO#15 增量①（服务端坐标）已落地
- [x] ✅ 审核 57 裁定：`X4_FULL_HISTORICAL_RECONCILIATION: **NOT REQUIRED**`（我的警报已撤回）／
      `X4A_SOURCE_VALIDITY_PREFLIGHT: APPROVED / REQUIRED` ／
      `X5_BASELINE_INVENTORY_REGULAR_CHECK: APPROVED` ／ `X4: CLOSED` ／
      **`WO15: APPROVED TO IMPLEMENT`**（无需重报计划）
- [x] ✅ **X5 完成**：`baseline-inventory.mjs --check` 成为常规完整性 Gate，并**接入 `check-all-local.sh` ④b**
      关键口径（审核 57 明确要求）：**只抓 `UNEXPLAINED_BASELINE_MISMATCH`**，
      而**不**把"旧快照 ≠ 权威索引"一律当 FAIL（那是 M0→M3 的合法历史）。
      实测：`BASELINE_SOURCE_VALIDITY: PASS` ／ `BASELINE_UNEXPLAINED_MISMATCHES: 0`
      （另有 3 处 `EXPLAINED_MISMATCH`，来自 supersedes 声明）
      ⭐ 敏感度**两个方向都验**（只测一边会漏掉"把所有 mismatch 当 FAIL"的错口径）：
        `scripts/m5/selftest-baseline-inventory.sh` → 基线 PASS ／ 受控拿掉 at-panel.json → FAIL ／ 还原 → PASS
        ⇒ `SELFTEST_BASELINE_INVENTORY: PASS`
- [x] ✅ **Source validity 纪律已沉淀**（审核 57 批准加入 validity 家族，与 Target/Fixture/Origin/
      Artifact/Observation 并列）；并记录审核 57 的**概念区分**：
      「屏幕状态 / 具体证据来源 / 证据可采信性**不是同一个字段**」——
      `POI_DETAIL_CURRENT_BASELINE_STATUS: OBSERVED`（依权威 manifest）＋
      `HISTORICAL_M0_DEEPLINK_RESULT: NOT_REPRODUCIBLE`（对那一种取法仍成立）＋
      `RECOVERY_PROVENANCE: contains policy-violation provenance`（引用时必须带上）
- [x] ✅ 遵守审核 57 的"**不要改写旧快照**"：本提交**未**修改任何 baseline.json / manifest.json / supplement
- [x] ✅ **WO#15 增量①（服务端）完成**（commit 64c4cfd）：
      `GET /api/posts` 与 `/api/posts/:id` 均 `left join places` → 新增 **`placeLat`/`placeLng`**（可空）
      ⭐ 两个刻意细节：① 用 left join（`posts` 无坐标列；且无地点的帖子**不被过滤**，坐标给 null）
        ② **显式 `Number()` 转换**（pg 常把数值以字符串返回，地图 SDK 需要 number；
           **TS 编译期看不出来**，不转换则标记可能静默跑到 0,0）；无地点 → **null，绝不伪造 0,0**
      实测（`WO15_PLACE_COORDS: PASS`）：4 条 post 全部 `float` 类型；
         `达美乐比萨(广州萝岗万达广场)` 23.1776,113.4404 ／ `北京交通大学` 39.9519,116.3373
       详情端点 PASS ／ 与 DB places 逐字一致 ／ 0,0 零行 ／ null 零行
       ⚠️ §4 **如实说明**：无地点的 post 数为 **0** ⇒「null 坐标」这条**无样本可验**，
          脚本打印"无样本可验，不假装验过"，**不**把它算成 PASS
      回归：WO#11 feed ／ WO#13 profile-edit ／ WO#7 text-send **全部 DEVICE_GATE_EXIT=0**
- [x] WO15.2 ✅ **已完成**（commit d968a19）：MapScreen 标记改由 `GET /api/posts` 派生（`markersFromPosts`），只保留**同时有经纬度**的帖子；三态 loading/ready/unavailable；**无 mock 回落**
      （**只保留带坐标的帖子**；无地点/读不到 → **不出标记、不回落 mock**）；
      mock 的 6 条从渲染路径移除（**保留在 mock.ts 并加注释说明"未采用"**，理由：保留
      "曾观察到的原版图钉（阳光操场）"这条线索，避免以后又被误当真实数据）
- [x] WO15.3 ✅ **已完成**（`gate-wo15-map-markers.mjs`，`DEVICE_GATE_EXIT=0`）：4 键全 PASS；敏感度**受控突变证明能红**（注入编造地名 → 3 键 FAIL、fallback 仍 PASS；撤销后回全 PASS）
      `MARKER_COUNT_MATCHES_POSTS_WITH_PLACE`（**不硬编码 6**）／ `NO_FABRICATED_PLACE_DATA` ／
      `MAP_NO_FALLBACK_ON_UNAVAILABLE`；并加敏感度（标记源改回 mock → 前两条必须 FAIL）
- [x] WO15.4 ✅ **本轮用机械像素分析取得部分证据**（见下「Round 266」节）：图钉配色**族**已测出、mock 调色板**无支撑**；语义仍 NOT_EVALUATED
      图钉**配色规则** ／ 气泡卡片内容与出现条件 ／ 缩放级别 ／ 头像标记与照片标记的分工
      ⚠️ 其中"标记的内容形态"**已有三处独立证据**（照片卡片+彩色图钉+地点名），
        且发现一个**交互细节**：地图上点的是**照片缩略图**、**不是地名文字**（原版 poi-detail 补充）

### ⭐⭐ Round 265 完成：**WO#15 全量落地**（服务端坐标 + 前端权威标记 + 门禁 + 敏感度）
- [x] ✅ **WO15 服务端增量**（64c4cfd）：`GET /api/posts` 与 `/api/posts/:id` 加 `placeLat`/`placeLng`
      （left join places；**显式 Number()** 防 pg 返回字符串；无地点给 null，**不伪造 0,0**）
      实测 `WO15_PLACE_COORDS: PASS`；回归 3 条全 `EXIT=0`
- [x] ✅ **WO15 前端增量**（d968a19）：`markersFromPosts()` 派生标记；`OfflineMap` 与三条原生地图
      全部改用传入 `markers`；新增可见徽标 `[data-marker-phase]`（让"没数据/读不到"**能被看见**）；
      mock 的 6 条加注释说明**未采用**（保留"阳光操场"这条原版线索，防以后又被当真）
- [x] ✅ **WO15 门禁**（`gate-wo15-map-markers.mjs`，`EXIT=0`）：
      `MAP_MARKERS_FROM_AUTHORITY` ／ `MARKER_COUNT_MATCHES_POSTS_WITH_PLACE` ／
      `NO_FABRICATED_PLACE_DATA` ／ `MAP_NO_FALLBACK_ON_UNAVAILABLE` **四键全 PASS**；
      ⭐ **两条渲染路径各自验证**（在线腾讯用 provider 无关徽标计数；离线自绘单独验 `.map__marker` DOM）
      ⭐ 期望条数（4）来自**服务端实况**，**不硬编码 6**
- [x] ✅ **敏感度**：注入 1 条编造地名 → `NO_FABRICATED_PLACE_DATA`／`COUNT`／`AUTHORITY` **三键 FAIL**、
      `fallback` 仍 PASS（归因清晰）；撤销后 `git diff --exit-code` **证实与原提交字节一致**，
      设备重装后回到**四键全 PASS**
- [x] ✅ **修掉一次间歇性门禁失败的根因**（d8ab0a5）：地图页全屏弹窗「授权地理位置」
      残留到下一个 Gate → WO#14 偶发 FAIL。已在**共用入口** `run-device-gate.sh` 加第 8/10 步
      best-effort 关弹窗（与"DB 残留清理"同一理由：10+ 个 Gate 各造状态各不管收）
- [x] ✅ ⭐⭐ **自测当场抓到我的修复其实无效**：第一版用 CSS 几何启发式找按钮 → 弹窗明明在，
      却输出「没有需要关闭的阻断式弹窗」→ `SELFTEST_DISMISS_MODALS: FAIL`。
      改为**按已知容器选择器**（`.map__modal-wrap` 等）后：**弹窗出现过 → 被关掉 → 断言消失 = PASS**。
      **教训：新加的"修复"本身也必须被证明会生效**（与"新断言必须证明能红"同一纪律）；
      且**"猜几何形状"不如"按已知选择器"** —— 前者会随样式微调**静默失效**。
- [x] ✅ **全设备回归 10 条全 `DEVICE_GATE_EXIT=0`**（WO#15 ／ 14 ／ 13 ／ 12 ／ 11 ／ 10 ／ 8 ／ 9A ／ 9B ／ 7）
- [x] WO15.5 ✅ 已用**机械像素分析**部分推进（见下节）；剩余语义项属「测量给不出」的部分，如实保留 NOT_EVALUATED
      （依基线原话「具体缩放级别与标记规则未记录」）→ 若接入可用图像通道，
      可用 `recovered-m3-map-pins.png` 等把"图钉配色/气泡卡片"升格为视觉直接证据
- [x] WO15.6 ✅ **已完成**：全 app 排查"首次进入自动弹出的覆盖层" ⇒ **只有地图页那一个**（已修），并加了 `data-blocking-modal` 通用登记位（自测证明该选择器真的命中）
      检查其它页是否也有"首次进入弹窗"会跨 Gate 残留（如 onboarding / upgrade-alert）

### ⭐⭐ Round 266：视觉证据通道的**替代方案** + UI 数据源盘点**机械重建**
- [x] ✅ **机械像素分析通道**（替代不可用的 vision）：新增
      `scripts/m5/analyze-baseline-pixels.py`（色相直方图 + 连通域，输出含方法学阈值）
      + `scripts/m5/selftest-pixel-analyzer.py`（**已知答案的合成图**上验证工具测对了）
      实测 `SELFTEST_PIXEL_ANALYZER: PASS`（含**反向样本**：低饱和灰块不被计入；
      含**绿色灵敏度**：否则"基线无绿色"可能是**工具盲区**而非事实）
      → `docs/m5/WO15-VISUAL-EVIDENCE-mechanical-pixel-analysis.md`
      ⭐ 结论：基线 `recovered-m3-map-pins.png` 里
        **红/橙族 ≈20000px ／ 蓝/青/紫族 ≈3300px ／ 黄族 605px ／ 绿色族 = 0px**；
        三个红族色块聚集(x≈868–974)；**两个蓝块 28×28 与 63×48 垂直相接、水平仅差 4px**
        ⇒ 与「蓝色定位点 + 方向扇形」**不矛盾**（但**哪个是点/扇形：NOT_EVALUATED**）
        ⇒ `MOCK_PIN_PALETTE_SUPPORTED_BY_BASELINE: **NO**`（mock 的绿 #2f9e44 无对应物）
      ⚠️ **我撤回过一个归因**：我原想说"`normal.png` 没有标记"，但查了**混淆变量**后
        发现它地图区的量化色只有 **10 种（79.85% 同一灰）** ⇒ **地图很可能没加载**，
        而 map-pins 有 **145 种**。⇒ 两图加载状态不同，**不能**据此推断标记有无。
- [x] ✅ **WO15.6**：全 app（35 个 tsx + 10 个枚举模式）排查自动覆盖层 ⇒ **只有地图页那一个**；
      并加 `data-blocking-modal` 通用登记位（**自测证明**该选择器真的被命中）
- [x] ✅ **UI 数据源盘点改成机械生成 + 漂移检查**（`ui-data-source-inventory.mjs`）
      · 起因：原 `UI-DATA-SOURCE-INVENTORY.md` 写在 WO#8 之后，而 WO#11–15 已把其中**多屏**
        从 mock 改成权威 ⇒ 它会把**已接完权威的屏**报成"纯 mock"，从而**选错下一单**
      · 修正两处**误报**：① 区分 **type-only** 导入（MapScreen/FeedListScreen/UserProfileScreen
        的 mock 导入只是**类型**）② **只认行首 import**（注释里也写着 import，
        见 `MessageScreen:8`、`FeedListScreen:25`）
      · 结果：`api-only` 7 → 9 → **11**；`mock+api` 6 → 4 → **2**；`mock-only` **5**
      · 已接入常规检查 **④c**（`--check` 双向自测：改一行即 FAIL 并精确报差异、还原即 PASS）
- [ ] ⬅ ⭐ **新发现 1（建议立单）**：`CommentsScreen` 与 `FeedDetailScreen` 对**同一数据一真一假**
      + `CommentsScreen` 有 `posts.find(...) ?? **posts[0]**` 的**静默兜底**
      （与 WO#12 修掉的 `?? 'u1'`、WO#13 的"假成功"**同型**）
      + 该屏**无任何 `navigate('comments')` 调用**（路由可达但无入口）
      → 详见 `docs/m5/UI-DATA-SOURCE-INVENTORY-REFRESHED.md` §3.1
- [ ] ⬅ ⭐ **新发现 2**：`BoardScreen.tsx:149` 仍渲染 **mock 自称身份** `me.avatar`
      （mock.ts 的 `me = { name:'自定义名称6', avatar: avatar('我','#6b7cff') }`）
      ⇒ 与 **WO#14 在 MeScreen 修掉的是同一个编造身份**，**第二次出现在另一屏**
      ⇒ 说明"修一个屏"不足以覆盖它，需要**按类排查**
- [ ] ⬅ **新发现 3（待裁定）**：`scanner` / `media-preview` / `comments` 三屏
      **在 App.tsx 挂着但全仓无任何 navigate 入口**（**路由可达、无入口**）。
      ⚠️ 与 WO#13 删掉的"编造孤儿路由"形态相同，但**这次不同**：这三条**都有原版基线屏**
      ⇒ **不能直接删**，需先判明"原版里它们由什么入口进入"。本轮**只记录不删不改**。
- [ ] ⬅ **新发现 4**：`PoiSearchScreen` 仍渲染 mock `pois`（含**无出处的 `posts:1284`**），
      而 `PoiDetailScreen` **已走权威** `/api/places/:id`；服务端**有**详情接口、**没有**列表接口
      ⇒ 修复需**新增 API 能力**（与 WO#15 同性质）→ `docs/m5/FINDING-poi-search-screen-still-mock.md`
- [ ] ⬅ 待裁定：以上四个发现是否立单、以及优先级（我建议先做「新发现 2 BoardScreen 的 mock 自称身份」——
      它最小、且与已批准的 WO#14 同类、修法已被冻结（首字占位））
