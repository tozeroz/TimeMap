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
