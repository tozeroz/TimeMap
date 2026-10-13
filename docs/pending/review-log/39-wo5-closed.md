# 审核记录 39：**WO#5 Phase 1 正式 PASS / CLOSED**

> 审核方：ChatGPT web；时间：2026-09-22 01:09（Asia/Shanghai）
> 本轮提交：`docs/pending/review-log/38-wo5-lifecycle-closeout.md`（3 条 audio 生命周期）

## 一、正式裁定

```
WO5_PHASE1: **PASS / CLOSED**

VOICE_RECORD_AND_UPLOAD:      PASS
VOICE_MESSAGE_CREATE:         PASS
VOICE_DURATION_PERSISTENCE:   PASS
VOICE_BUBBLE_PLAYBACK:        PASS
VOICE_RELOAD_PERSISTENCE:     PASS
VOICE_SENDER_ALIGNMENT:       PASS

VOICE_MEDIA_LIFECYCLE:        PASS
  unattached expired voice → DB + file deleted
  unattached in-flight voice → retained
  referenced expired voice → DB + file + reference retained
  backup window upload → 503 + zero mutation
  barrier release → upload recovers

VOICE_PERMISSION_DENIED_CODEPATH:    PASS
VOICE_PERMISSION_DENIED_SYSTEM_E2E:  NOT_EVALUATED
ANDROID_PERMISSION_UI_VISIBLE:       NOT_OBSERVED

VOICE_TO_TEXT:                NOT_IMPLEMENTED / OUT_OF_SCOPE
PHASE2_RECORDING_OVERLAY:     NOT IMPLEMENTED
```

> 审核原话："A/B 两组把 created_at 都推到 TTL 之外、只改变'是否有引用'，这个测试设计尤其好。
> 它真正证明了：**保留不是因为'还没过期'，而是因为'引用优先于 TTL'**。C1/C5 同样是很好的控制变量对。
> 因此 WO#5 Phase 1 不再留 HOLD。"

## 二、两项落实：均认可

```
显式 MIME allowlist 作为权威判据:  认可
  IMAGE_MIMES = jpeg/png/webp ；AUDIO_MIMES = audio/webm
  MIME prefix 只负责生成可读错误信息 —— 比 startsWith("audio/") 更稳
  收益：将来 DB 新增 audio/foo，**不会自动获得 kind=voice 权限**
  → 审核称其为 "正确的 capability expansion discipline"

ASR 术语修订:                      认可
  保持"原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充"
  对历史 review-log 的修改也认可，**条件**是保留说明"这是后续术语规范化，
  不是假装当时原文就是这样" —— 我已按此在 review-log/36 §十二 写明。
```

## 三、里程碑状态（审核给定）

```
WO#1 board_notes:            CLOSED
WO#2 chat image:             CLOSED
WO#3 sender direction:       CLOSED
WO#5 Phase 1 voice core:     CLOSED
WO#4 emoji exact rendering:  known structural deviation,
                             implementation deferred pending mapping evidence
M5 overall:                  IN PROGRESS
```

## 四、下一项选择：审核的建议与**我的实际情况不一致**（须回报）

审核说："同意优先选你现在 2×2 里的 (B) 有可靠原版证据 + 我方未实现 …… 你可以自己从
`docs/test/AUDIT-M0-M4.md` 挑下一个 B 项，仍然先报 WO 计划再动产品代码。"

⚠️ **但我在同一时段（commit `5e7da54`）刚把 (B) 格清空了**，理由是：
```
· 语音消息 → 已完成（WO#5）
· @所有人 → 移入「设计决定」（本来就不是缺口）
· 图片压缩 / per-user 配额 → 移入 (D)：**前提证据不在手**（不是"证据在手只差实现"）
  （图片压缩的只读取证见 docs/pending/m5/EVIDENCE-image-compression-scan.txt：无第三方压缩库命中，
    降采样 API 命中但那是"显示时防 OOM"的通用写法，**不能证明上传前压缩**）
```
→ 因此 **`docs/test/AUDIT-M0-M4.md` 里当前没有 (B) 项可挑**。
审核的建议基于上一版 AUDIT（其读到的是 `2f97e98` 之前的表），**需要回报这次结构变化**。

审核给的 (B) 筛选三条件仍然有效，我将照此在剩余类别里找**等价价值**的工作：
```
① original evidence strong / reproducible
② current absence definitely observable
③ implementation semantics sufficiently known
优先：用户高频可达 + 用户可见影响大 + 不依赖第三方写操作 + 实现依赖少
```

## 五、E1/E2（auth hygiene）：审核给了**明确反对意见**，我采纳

审核反对"先做总行数上界 Gate"，理由（我认为正确）：
```
sessions=122 可能是"120 条早已过期的垃圾"，也可能是"122 条仍合法的活跃 session" ——
这两个语义完全不同。**总行数不是正确的 invariant。**
login_challenges=100 的关键也不是 100，而是其中多少 expired / consumed / pending / 最近创建。
```

**要求的正确顺序**：
```
1. 先做 AUTH_HYGIENE_AUDIT（查状态分布）
     sessions:           active / expired / revoked / age distribution
     login_challenges:   pending-valid / expired / consumed / age distribution
2. 按 schema 已有语义定义"**确定已经死亡的数据**"：
     expired session older than retention grace      → cleanup eligible
     revoked session older than retention grace      → cleanup eligible
     expired challenge older than retention grace    → cleanup eligible
     consumed challenge older than retention grace   → cleanup eligible
   ⚠ active session / still-valid challenge **绝不按总数删除**
3. cleanup 实现方式：**不要塞进 media cleanup**（避免把媒体生命周期与认证生命周期
   绑成一个破坏半径很大的工具）→ 独立 `cleanup-auth`（或 maintenance CLI 的独立 subcommand）。
   沿用既有纪律：dry-run 默认 / 显式 --apply / 分类计数 / DB 错误时 fail closed。
   报告字段：expiredSessions / revokedSessions / expiredChallenges / consumedChallenges /
             activeSessions / pendingChallenges
4. Gate 写法：**不要写 `sessions < 50`**。更好的不变量是
     `STALE_EXPIRED_SESSIONS = 0`、`STALE_CONSUMED_CHALLENGES = 0`
   或允许明确 retention window：`expired_at < now - 24h → 必须不存在`。
   总行数**只做次级 trend/warning**（INFO active_sessions=… / WARN total unusually high），
   不作为产品 PASS/FAIL 依据。
```

→ 我据此把 NEXT-ACTIONS 的 E1/E2 **改写**（见该文件）。

## 六、我下一步的动作（不需要审核再裁定）

1. 回报 §四 的 AUDIT 结构变化（(B) 已空）并说明我改挑什么
2. 按 §五 重写 E1/E2
3. 继续在 (A)/(C)/(D) 里按审核的三条件找**等价价值**的工作
   —— 当前已锁定一个具体候选：**「校园广场」页的布局模型存在 AUDIT 内部矛盾**
     （`A-D-LIST` 说"拼贴照片墙 collage"，`review-log 28` 说"两列瀑布流一致"），
     属于"证据在手但结论矛盾"，**必须先用原始证据判清**。
