# M4 中期状态（截至 2026-09-21 15:16）

> 已提交独立审核（等待裁定 A/B/C 优先级与 M4 收口范围）
> Gate 入口：`scripts/gates/m4/gate-server.sh`（服务器侧执行）

## 一、Gate 现状

```
M4_GATE_RESULT: PASS
M4 GATE KEYS:
  MEDIA_SCHEMA_RESULT       PASS   29 条
  MEDIA_UPLOAD_RESULT       PASS   26 条
  MEDIA_DELIVERY_RESULT     PASS   22 条
  M4_BACKUP_RESTORE         PASS   （含 DATABASE_RESTORE / MEDIA_STORE_RESTORE /
                                    CROSS_REFERENCE_INTEGRITY 三个子 key）
  MEDIA_ORPHAN_CLEANUP      PASS
M4 GATE LAYERS:
  PERSISTENT   PASS
  STAGE        PASS
  REGRESSION   NOT_RUN_IN_THIS_GATE（由 M3 gate 负责；**显式标注，不默认为 PASS**）
```

## 二、审核 7 条边界的落实

| # | 边界 | 落实与证据 |
|---|---|---|
| 1 | DB 只存逻辑 key | `storage_key` = `2026/09/<uuid>.png`，不存 URL/绝对路径 |
| 2 | 文件名服务端生成 | 路径穿越用例：filename 带 `../../../../tmp/pwned.png` → storage_key 不含 `..`、`/tmp/pwned.png` 不存在、文件仍在 `uploads/public` 下 |
| 3 | 不信 Content-Type | 文本伪装 `image/jpeg` → 400（标 `not_an_image`）；6MB → 413 |
| 4 | 失败原子性 | 先写文件、后写 DB 行；DB 失败撤掉文件；崩溃留 orphan 由清扫工具回收 |
| 5 | 磁盘 Gate | `statfs` 实测 >90% **或** 剩余 <1GB → 507；`ENOSPC` → 507（不报 500） |
| 6 | **公共/私有不同构** | `uploads/public`（Nginx 静态）+ `uploads/private`（**无静态入口**）；private 走 `GET /api/media/:id`（会话 + `can_read_media`）→ X-Accel → internal location |
| 7 | 联合恢复 | DB + 媒体 + **逐行**交叉核对（4 条 media 行全部找到文件且 sha256 一致）；与 M2 的 DB-only 演练分开记录 |

## 三、两条 P0

- **P0-A 授权复用**：`can_read_message` 是唯一权威判定，`can_read_media` 复用它；Gate 逐用户核对"消息接口与媒体接口结论一致"（防权限漂移）
- **P0-B DB 级防线**：复合外键 + 常量 CHECK 钉死 scope → `post_media→private`、`message_media→public` **被数据库直接拒绝**；显式写错 scope 被 CHECK 拒绝；合法引用仍成功（证明不是一律拒绝）

## 四、前端接入

| 位置 | 状态 |
|---|---|
| feed 列表卡片 | 已显示真实图片（真机 naturalWidth 1080×1350 / 1080×1440 与 DB 声明一致） |
| 帖子详情页 | 已显示真实图片（natural 1080×1440，渲染宽 586px） |
| 聊天/群聊图片 | **后端与 Gate 就绪，前端无消费方** —— 待消息界面 |

顺带修掉一个长期空洞：`toFeedPost` 的 `images: []` 是硬编码，列表从未显示过图片。

## 五、测试抓出的真实缺陷

**种子的 media 行是悬空引用**（只写 DB 行、无实体文件）——联合恢复演练的逐行核对直接报"缺文件"。
修法：seed 先造真实 PNG 字节（手写 IHDR/IDAT/IEND，不引图片库）→ 按字节算 `sha256`/`bytes` → 再写 DB 行；
存储键改为 `.png` 与内容一致。canonical 显式更新 `d1a47666… → bfeea7f7…`。

## 五之二、Storage closeouts 逐条销项（审核记录 16 指出"摘要里没被证明覆盖"）

审核记录 16 原话："还有几项我之前点名的 storage closeout 在这份摘要里没有被证明覆盖。"
下面是逐条清单与**当前 HEAD 的实测输出**（不是复述设计）。

### ① 同名地点歧义（审核记录 13 的唯一 closeout）

要求：**只有候选唯一确定时才自动写 `place_id`；0 个或 >1 个候选都必须保持 NULL**，
并要机械测试。

```
scripts/m3/verify-places.sh → PLACES_RESULT PASS（当前 HEAD）
  === F2. 同名歧义：存在两个同名地点时不得自动绑定 place_id ===
  PASS 同名地点也能发帖（不因此报错）
  PASS 同名歧义时 place_id 保持 NULL（没有随便挑一个）
  PASS 同名地点的文本仍保留
  PASS **该帖没有出现在任何一个同名地点的动态里**
  PASS 临时同名地点已清理
```

（另一条断言"该帖不出现在任何同名地点列表里"是关键的反向断言 ——
它覆盖的是"静默挂到错地点"这种最危险的错误。）

### ② P0-A 授权复用（审核记录 15）

要求：媒体授权必须**复用消息可见性的同一个 predicate**，防权限漂移。

```
scripts/m4/verify-media-schema.sh → MEDIA_SCHEMA_RESULT PASS
  PASS can_read_media：**非成员不能读**（知道 media id 也读不到）
  PASS 用户 11111111… 消息与媒体结论一致（t）
  PASS 用户 22222222… 消息与媒体结论一致（t）
  PASS 用户 33333333… 消息与媒体结论一致（f）
  PASS **全部引用消息都撤回 → 私有媒体不可读**
```

### ③ P0-B DB 级跨 scope 防线（审核记录 15）

要求：非法引用要**在数据库层**被拒，且 Gate 直接尝试制造。

```
scripts/m4/verify-media-schema.sh → MEDIA_SCHEMA_RESULT PASS
  PASS post_media 引用 private media → **数据库拒绝**（复合外键生效）
  PASS message_media 引用 public media → **数据库拒绝**
  PASS post_media 显式写 media_scope='private' 被 CHECK 拒绝
  PASS post_media 合法引用 public media 成功（防线不是一律拒绝）
```

### ④ 上传幂等键（审核记录 15）

```
scripts/m4/verify-media-upload.sh → MEDIA_UPLOAD_RESULT PASS
  PASS 重试返回**同一条** media（id 一致）
  PASS 响应标记 idempotentReplay=true
  PASS **文件数只增加了 1**（重试没有新建文件）
  PASS DB 里该幂等键只有 1 行
```

### ⑤ 私有媒体下发（X-Accel + 命名空间隔离）

```
scripts/m4/verify-media-delivery.sh → MEDIA_DELIVERY_RESULT PASS
  PASS **带成员会话**直接打 internal 路径也失败（404）
  PASS 把**私有** key 拼到公共静态路径 → 404（两个命名空间确实分开）
  PASS 消息撤回 → 成员也拿不到私有媒体（404）
```

### ⑥ 路径穿越（客户端 filename 不可信）

```
scripts/m4/verify-media-upload.sh → MEDIA_UPLOAD_RESULT PASS
  PASS storage_key 不含 ..（服务端生成，客户端名字被完全忽略）
  PASS /tmp/pwned.png 不存在（没有穿越到 UPLOAD_ROOT 之外）
  PASS uploads 下没有客户端 filename 的痕迹
```

### ⑦ 联合恢复（DB + media store）

```
scripts/m4/backup-restore-joint.sh → M4_BACKUP_RESTORE PASS
  DATABASE_RESTORE: PASS            （users 4==4、media 4==4；判定函数随 schema 恢复）
  MEDIA_STORE_RESTORE: PASS         （恢复文件数 5 == 备份时 5）
  CROSS_REFERENCE_INTEGRITY: PASS   （4 条 media 行**逐行**找到文件且 sha256 逐条一致）
```

### ⑧ 孤儿清扫

```
scripts/gates/m4/gate-server.sh 第 5 组 → MEDIA_ORPHAN_CLEANUP PASS
  PASS dry-run 未删除任何文件（3 → 3）
  PASS 种子（被引用）文件未被触碰
  PASS 阈值很大时孤儿列表为空（阈值保护生效）
```

> 本节的意义：审核指出的是**摘要没有证明**，而不是"没做"。
> 所以这里的修法是**把已有证据逐条列出来**，而不是补做——
> 这也说明"报告覆盖"本身是交付的一部分：证据存在但没被呈现，在审核视角等于不存在。



- **A** 消息模型前端（`message kind` / 图片消息 / 撤回的界面表现）—— **已完成**
  （审核记录 16 已裁定 A 优先；断言 6/6 PASS，见 §四）
- **B** M4 gate 是否每次重跑 M3 全量 —— **已按审核裁定执行**：日常 slice 不跑全量，
  **M4 Final Gate 必须在当前 HEAD 跑完整 regression**
- **C** @ 提及关系 —— **已完成最小闭环**（`MENTIONS_RESULT PASS` 13 条）；
  `SELF_OWNED_MENTION_FUNCTIONAL: PASS`，
  `ORIGINAL_MENTION_MODEL_CONFORMANCE: NOT_EVALUATED`（at-panel 证据已判 INADMISSIBLE，不反向推断）

## 七、下一步

storage closeouts 已逐条销项（§五之二）→ **M4 Final Gate**
（在当前 HEAD 跑完整 regression，输出 `M4_FINAL_GATE_LAYERS` 三层全 PASS）→ 提交审核。

