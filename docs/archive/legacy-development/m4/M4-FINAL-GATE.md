# M4 Final Gate 汇总（当前 HEAD）

> 时间：2026-09-21 16:08（Asia/Shanghai）
> 依据：审核记录 16 —— "M4 Final Gate 必须在当前 HEAD 执行完整 regression"，
> 且"由 M3 gate 负责"只能理解成**复用 M3 脚本**，不能理解成"以前过了就不用重跑"。

## 一、结论

```
M4_FINAL_GATE_LAYERS:
  PERSISTENT: PASS
  STAGE:      PASS
  REGRESSION: PASS
M4_FINAL_GATE_RESULT: PASS
```

三层的证据来源（都是**当前 HEAD 实测**，不是沿用旧结论）：

| 层 | 证据 | 结果 |
|---|---|---|
| PERSISTENT | M4 存储 gate 的 `M4_BACKUP_RESTORE` + `MEDIA_ORPHAN_CLEANUP` | PASS |
| STAGE | M4 五 key + M3 六个 slice key | 全 PASS |
| REGRESSION | `M3_FINAL_GATE_RESULT`（完整 regression，含 PERSISTENT/STAGE/REGRESSION 三层） | PASS |

## 二、M4 阶段交付范围（对照审核冻结的三条主线）

### A. Media lifecycle

```
upload → validate → store → authorize → deliver → delete/recover
```

| 能力 | key | 说明 |
|---|---|---|
| schema | `MEDIA_SCHEMA_RESULT` PASS | 迁移 006/007：media 带 scope；**DB 级跨 scope 防线**（复合外键 + 常量 CHECK）；`can_read_message` 为唯一权威判定、`can_read_media` 复用它；上传幂等键 |
| 上传 | `MEDIA_UPLOAD_RESULT` PASS | 按字节嗅探类型与尺寸；路径穿越无效；幂等重试不新建文件；磁盘 Gate 与 ENOSPC → 507 |
| 下发 | `MEDIA_DELIVERY_RESULT` PASS | public 走 Nginx 静态；private 无静态入口、经 `can_read_media` + X-Accel；命名空间隔离；撤回后不可读 |
| 前端消费 | `SLICE_A_DEVICE_RESULT` PASS（6/6） | 会话页接真实 API；私有图用 **blob 方式**加载（`<img>` 无法带 Bearer）；凭据不进 URL；登出后取不到；blob 卸载后 revoke |
| 备份恢复 | `M4_BACKUP_RESTORE` PASS | `DATABASE_RESTORE` / `MEDIA_STORE_RESTORE` / `CROSS_REFERENCE_INTEGRITY` 三个子 key；**逐行**交叉核对且 sha256 一致 |
| 回收 | `MEDIA_ORPHAN_CLEANUP` PASS | dry-run 默认不删；被引用文件不被触碰；阈值保护生效 |

### B. Messaging model completion

- `message kind`（text/image/voice）+ 媒体引用（`message_media`）+ 公开/私有媒体边界
- 撤回语义：行保留（界面显示「消息已撤回」）、`media` 被服务端清空、
  且 `/api/media/:id` 同步 404 —— **两个接口结论一致，不漂移**
- `MESSAGING_API_RESULT` PASS（13 条）

### C. Mention relation

- `message_mentions(message_id, mentioned_user_id)`（迁移 008），**不做 @所有人**
- 写入校验：被提及者必须是会话成员（复用 `is_thread_member`）、不能提到自己；
  不满足 → 400 且事务回滚，消息与 mention 都不写
- `MENTIONS_RESULT` PASS（13 条）
- `SELF_OWNED_MENTION_FUNCTIONAL: PASS`
- `ORIGINAL_MENTION_MODEL_CONFORMANCE: NOT_EVALUATED`
  `reason=original evidence inadmissible`（at-panel 证据已被 provenance 审计排除，不反向推断）

## 三、语义边界（防止过度声明）

- 本 PASS 的含义是：**M4 冻结范围内**的媒体生命周期、消息模型补全、
  @ 提及最小闭环，以及允许范围内的 conformance 已完成。
- **不表示**"整个 App 已 1:1"；也不表示原版内部就是我们的数据模型
  （原版侧多处证据已判 `INADMISSIBLE` 或 `BLOCKED_BY_POLICY`）。
- 旧口径保持：`pg_dump restore PASS` 从 M4 起只代表数据库恢复，
  完整业务数据恢复由 `M4_BACKUP_RESTORE`（含媒体与交叉核对）代表。

## 四、本轮为收口修掉的问题（都属"我自己的东西"，而且都不会报错）

1. **我的修复只活在 `/tmp`**：M4 gate 每次重新 scp 仓库版本 → 覆盖补丁 →
   同一症状再现。已把 `sudo -u postgres` 建库写进仓库文件。
2. **gate 第 5 组被全局 `FAILED` 连坐**：某一步没过被误报成"这一步也没过"，
   掩盖真实状态。改用本组自己的标志。
3. **`CROSS_REFERENCE_INTEGRITY` 抓到我自己的 fixture 不一致**：
   Slice A 的 fixture 换过磁盘文件但 DB sha256 没同步 → 检查按设计抓到了真实不一致。
   清理后逐行比对 `REMAIN_MISMATCH=0`。

---

## 七、五条 storage closeout 逐条销项（回应审核记录 18）

审核要求：这五条**具体断言**必须明确覆盖，而不是只写"五个 key 都 PASS"。
以下是每条的断言内容、执行位置与测量结果 —— **断言都在代码里，不在文档里**。

| # | 断言 | 执行位置 | 结果 |
|---|---|---|---|
| ① | **backup consistency barrier**：备份**归档之前**核对两侧一致（每条 media 行都要有文件且 sha256 一致 = 无悬空引用；每个文件都要有 DB 行 = 无未登记文件），不一致则这份备份判定为不可信 | `backup-restore-joint.sh` A2 段 | `CLOSEOUT_1_BARRIER: PASS` |
| ② | **file→row 双向恢复**：正向（DB 行 → 文件）与**反向（文件 → DB 行）都参与判定**（旧版反向只 echo 提示，不判定） | `backup-restore-joint.sh` D 段 | `CLOSEOUT_2_BIDIRECTIONAL: PASS` |
| ③ | **restore 后私有权限**：恢复后**用恢复库的真实数据**验证授权行为 —— 会话成员可读、**非成员不可读**、撤回后成员也读不到（旧版只检查函数是否存在） | `backup-restore-joint.sh` B 段 | `CLOSEOUT_3_POST_RESTORE_AUTH: PASS` |
| ④ | **cleanup 在 DB down 时 fail-closed**：连接被拒时必须以非 0 退出，**且盘上文件数不变**（后者才是实质）；对照：库可用时 dry-run 也不删 | `verify-cleanup-failclosed.sh` | `CLOSEOUT_4_CLEANUP_FAILCLOSED: PASS` |
| ⑤ | **pixel/decode bounds**：单边上限 + **像素总量上限**（`MAX_PIXELS = 40_000_000`），四类格式统一走 `checkDimensions`；强度边界明确写为"结构校验，不是完整解码" | `imageProbe.ts` + `probe-unit-test.mjs` | `CLOSEOUT_5_PIXEL_DECODE_BOUNDS: PASS`（`IMAGE_PROBE_UNIT` 12/12） |

### 这五条不是"补文档"，它们找出并修掉了一个真实泄漏

① 的屏障上线后立刻报出：`未登记文件：盘上有但 DB 无行 → public/2026/09/9c08755d-…png`。
追查根因：`verify-media-upload.sh` 的清理**只删已知的两个 id**，
但该脚本还会因**路径穿越用例**用合法图片 + 恶意 filename 成功上传一次 ——
那次产生的行与文件都不在清理列表里，于是**行删了、文件留在盘上**。

修法：清理改为**按 owner_user_id**（删该测试用户的全部 media 及其盘上文件）+ 兜底核对。
复验：重跑后五条 closeout 与五个 key 全 PASS，**且没有再产生新的孤儿** ——
证明修的是根因，不是"把垃圾扫掉后碰巧通过"。

如果继续让反向核对只"提示不判定"，这个泄漏会一直累积，
直到某次恢复演练把垃圾一起打包过去。

## 八、M4 Final Gate（当前 HEAD 实测）

```
M3_FINAL_GATE_RESULT: PASS        （完整 regression，三层全 PASS，证据 m4-final-regression-20260921-163857.txt）
M4_STORAGE_GATE_RESULT: PASS      （五 key + 五 CLOSEOUT 全 PASS，证据 m4-gate-20260921-163807.txt 附近）
M4_FINAL_GATE_LAYERS:
  PERSISTENT: PASS
  STAGE:      PASS
  REGRESSION: PASS
M4_FINAL_GATE_RESULT: PASS
```

**执行顺序说明**：先重新部署服务器（`imageProbe.ts` 的像素上限进入运行产物），
再跑 M3 完整 regression —— 保证**被验证的代码与正在运行的代码是同一版本**，
而不是"改了代码、验的是旧产物"。