# 审核提交 38：WO#5 关账三条件已完成（audio/webm 生命周期 A/B/C）

> 提交时间：2026-09-22 01:02｜审核方：ChatGPT web｜commit `bf63fef`（已 push）
> 回应：审核记录 37 —— `WO5_PHASE1_IMPLEMENTATION: ACCEPTED` / `FINAL_CLOSE: HOLD`（只差 3 条）

## 一、你要求的 3 条 audio-specific 生命周期断言：全部 PASS（用**真机产出的真 WebM**）

脚本 `scripts/m5/verify-voice-lifecycle.sh`（20 条断言，全绿）。

### A 未引用的语音 media

```
A1 超 TTL 的未引用语音**是**候选                              PASS
A2 在途的未引用语音**不是**候选（TTL 保护生效）                PASS
A3 超 TTL 的**行已删**                                        PASS
A4 超 TTL 的**文件已删**                                      PASS
A5 在途的**行保留**                                           PASS
A6 在途的**文件保留**                                         PASS
```

### B 被引用的语音 media

```
B1 被引用的行**保留**（引用优先于 TTL）                        PASS
B2 被引用的**文件保留**                                       PASS
B3 引用关系完好                                               PASS
B4 读模型仍能取到该语音媒体                                     PASS
B5 读模型仍返回 durationMs                                     PASS
```

> **⚠ 一个刻意的测试设计，请重点看**：B 组的 media 我**刻意把 `created_at` 设为 72 小时前（已过期）**。
> 这样它同时证明了两件事：清理工具**确实**会扫到它、且**因为被引用而放行** ——
> 而不是靠"新建时间侥幸躲过 TTL"。而且 **A/B 两组构成天然控制变量对**：
> 媒体完全相同，只差"是否有 message_media 引用"，结果一个是删、一个是留。

### C 备份排他屏障生效时

```
C1 屏障窗口内真实上传返回 **503**（不是 500/201）              PASS   ← 真实会话 + 真实 multipart
C2 响应体指明是备份屏障（backup_in_progress）                  PASS
C3 窗口内 **DB 零变更**（media 仍 2）                          PASS
C4 窗口内 **盘上零变更**（webm 文件仍 0）                       PASS
C5 屏障释放后同类上传**恢复成功**（201）                        PASS
```

> 窗口内那次上传**耗时 5187ms** —— 说明它**真的阻塞在锁上直到 lock_timeout**，
> 而不是立刻被拒（符合 M4 的屏障语义：可恢复的"稍后重试"，不是"出错了"）。
> C1/C5 也是控制变量对：只差"屏障是否持有"，503 vs 201。

### 顺带补上一条**你们自己记过的弱证据**

`scripts/m4/verify-backup-barrier.sh` 的文件头当年自记：

> "**不证明**：HTTP API 层在窗口内返回 503 —— 需要真实会话 + multipart 上传；本脚本不覆盖；
>  该路径的正确性目前只由'共享锁接入 + isBarrierTimeout→503'的代码审查支撑，属**弱证据**，
>  应在后续 slice 补端到端断言。"

→ 本轮 C 组用**真实会话 + 真实 audio/webm multipart** 走 HTTP，把这条从**弱证据**升为**端到端证据**。

## 二、fixture 的来源与纪律

`scripts/m5/fixtures/voice-sample.webm`（8403 字节，**真机 MediaRecorder 产出**）：
- 自查：EBML 魔数 `1a45dfa3` + DocType=`webm` 均通过
- 采集方式：`tools/tmp/capture-voice-fixture.mjs` 用 CDP 在 WebView 里录 2.5s，
  把 blob 以 base64 交回 Node 落盘 → **完全不碰服务器与 DB**，零残留、不需登录态

**为什么不手工拼一个**：我此前正是手工拼了"最小 WebM"（长度 vint 写错：`0x88` 应为 `0x84`），
服务端判它"不认识的文件类型"，导致断言**因错误的原因通过**。真机文件才能真正覆盖
容器探测 / 时长校验 / GC / 屏障这些真实分支。

脚本内含你命名的 **FIXTURE VALIDITY GATE**：音频 fixture 必须**先能正常上传成功**
（拿到 id 且服务端判定 mime=audio/webm），否则 **FATAL 退出**，不允许后续断言继续跑。

## 三、你要求的另两项也已落实

### 术语修正（已去掉"不可复刻"）

统一改为冻结口径："**原版等价 ASR 服务/语义在当前范围内不可获得或无证据，因此不实现、不冒充**"。
覆盖 `WO5-PLAN`、`gate-server.sh`、`comparison.md`、`review-log 33/34/36`。

⚠ 透明记录（已写入 review-log/36 §十二）：`33`/`34` 是**当时提交内容的记录**，
其措辞已按本条统一过 —— 记下来以免后人以为那些日志一开始就这么写。

⚠ **我本次的一个自省**：批量替换时**误伤了 `comparison.md` 的一个章节标题**（原为
`## 五、明确未复刻的部分`，被替换成一句长论断），已改回。
已把教训写进 PLAN："**术语替换必须逐处看上下文，不能整文件盲替**"。

### kind↔mime 不再依赖 mime 前缀（你 §6 的提醒）

现在**同时**用两道判断：
- **显式批准集（权威判据）**：`IMAGE_MIMES=['image/jpeg','image/png','image/webp']`、
  `AUDIO_MIMES=['audio/webm']`（与 DB `media_mime_allowed` 对齐）
- mime 前缀：只用于给出**可读**的错误信息（`expectedPrefix`）

错误响应新增 `approved` 字段。行为与今天**完全等价**（当前只有一个音频 MIME），
但将来扩展音频格式时**必须显式登记**，不会因"挂在 audio/ 前缀下"就悄悄获得 voice 资格。
这条扩展纪律已写进契约注释。
回归验证：gate 25 键全 PASS，`A4.4/A4.5（media_kind_mismatch）` 与生命周期 20/20 均无回归。

## 四、Gate 现状（25 个键，全部 PASS，REAL_EXIT=0）

```
PERSISTENT PASS / STAGE PASS / REGRESSION PASS

M5_MEDIA_MESSAGE_API                PASS      M5_VOICE_MEDIA_MIME_WHITELIST      PASS
M5_MEDIAID_STRICT_REJECT            PASS      M5_VOICE_MIME_DURATION_CONSISTENT  PASS
M5_UNATTACHED_TTL_GC                PASS      M5_VOICE_NEGATIVE_ASSERTIONS       PASS
M5_TMP_SELFHEAL                     PASS      M5_VOICE_A4_1 .. A4_5              PASS
M5_BOARD_NOTES                      PASS      M5_VOICE_LIFECYCLE                 PASS
M5_BASELINE_SEED_INTEGRITY          PASS      M5_VOICE_LC_A_TTL_DELETE           PASS
M5_BASELINE_STORAGE_CONSISTENT      PASS      M5_VOICE_LC_A_INFLIGHT_KEEP        PASS
                                              M5_VOICE_LC_B_REF_KEEP             PASS
                                              M5_VOICE_LC_C_503                  PASS
                                              M5_VOICE_LC_C_ZERO_DB              PASS
                                              M5_VOICE_LC_C_RECOVER              PASS
```

### 本轮又修掉 2 个工具缺陷（都属于"证据被吞掉/结论失真"类）

1. **多字节截断 → grep 把整段输出当二进制并吞掉整行**
   C2 那条断言其实 PASS，但因消息里用 `head -c 160` 截断中文响应体（切在多字节字符中间），
   产生非法 UTF-8，gate 的 `grep` 报 `binary file matches` 且**不显示该行** ——
   等于"断言跑了却看不到证据"。修法：脚本改 python3 做**字符安全**截断；管道加 `grep -a`。
2. **gate 运行器的模式表漏键**：`run-gate.sh` 的 grep 表漏了 `M5_VOICE_LC_*`，
   导致"键是 PASS 但看不到"。已改为覆盖全部语音键。

### 方法纪律已冻结进 PLAN.md（按你 §5 的命名与流程）

- **FIXTURE VALIDITY GATE**：`fixture 合法 + 能走成功路径 → 才允许执行依赖它的负向测试`
- **SENSITIVITY TEST**：`PASS baseline → controlled mutation → FAIL + exit≠0 → restore → PASS/0`
  并写明核心要求：**先证明测试能失败，再引用它的通过**
  （B2 的例子：我先写的"重启 3 次看日志"在**未修复**版本上同样 PASS → 无判别力；
   改用"探针计数 close() 之后的 pool 查询"才具备判别力：未修复=1 次→FAIL，修复后=0 次→PASS）
- 附带：优选**天然控制变量对**（A/B 组、C1/C5 组）

## 五、另发现一个数据卫生项（已记入 NEXT-ACTIONS，非本单 blocker）

gate 的 info 行显示 `sessions=122`、`login_challenges=100`（测试反复登录所致）。
已记 E1/E2：查明是否有过期清理、是否应纳入 cleanup CLI；
并建议给 info 行加**期望上界提示** —— 否则"残留累积"永远只是被打印、不会被发现
（符合本项目"只打印不判定 = 假信号"的既有原则）。

## 六、请裁定

1. **是否可写 `WO5_PHASE1: PASS / CLOSED`？**（3 条 lifecycle 已全绿）
2. §三 的两项落实（术语统一 + 显式批准集）是否认可？
3. 按你 §7 的建议，关账后回 `docs/test/AUDIT-M0-M4.md` 选下一项。
   我自己从 2×2 结构里挑的候选是 **(B) 有证据但未实现 = 真实实现缺口**那一格 ——
   **是否同意优先做 (B) 类**？还是你希望先做别的？
4. E1/E2（sessions/login_challenges 累积）你建议纳入 cleanup CLI 还是先只加判定上界？

## 七、证据

`scripts/m5/verify-voice-lifecycle.sh`、`scripts/m5/fixtures/voice-sample.webm`、
`scripts/gates/m5/gate-server.sh`（第 5 节 + 7 键）、`PLAN.md`（两条 Gate 方法论）、
`server/src/index.ts`（批准集 + 契约注释）；commits `3751178`、`bf63fef`
