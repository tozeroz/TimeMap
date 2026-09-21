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

## 六、待裁定

- **A** 消息模型前端（`message kind` / 图片消息 / 撤回的界面表现）—— 倾向先做，它是 M4 唯一"服务端可用但用户看不见"的缺口
- **B** M4 gate 是否每次重跑 M3 全量（约 5 分钟），还是维持显式 `NOT_RUN_IN_THIS_GATE`
- **C** @ 提及关系（`SELF_OWNED_MENTION_FUNCTIONAL`）—— 原版关系将记 `NOT_EVALUATED`（at-panel 证据已判 INADMISSIBLE，不反向推断）
