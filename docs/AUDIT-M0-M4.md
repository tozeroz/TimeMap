# 全局收口审计（M0–M4）

> 时间：2026-09-21 16:10（Asia/Shanghai）
> 性质：**只汇总已有证据**，不新增结论、不扩张范围。
> 目的：给后续 M5（逐页收敛到 1:1）一个完整视角，避免建立在不完整认知上。

## 一、各阶段 Gate key 总表

| 阶段 | key | 结果 | 备注 |
|---|---|---|---|
| M0 | Nginx `/health` 网关证据 | PASS | 公开可达 `http://8.148.156.146/health` |
| M1 | `BACKEND_RESULT` | PASS | 垂直切片：经 Nginx 写 → 读回 → 直查 PG |
| M1 | `SEED_RESULT` | PASS | seed 幂等 + canonical + 收敛性 |
| M2 | `AUTH_RESULT`（历史） | PASS | 见 `docs/m2/`；M2 历史可复现性已收口 |
| M2 | `BACKUP_DRILL_RESULT` | PASS | **仅 DB**；从 M4 起不代表完整业务数据恢复 |
| M2 | `TLS_SERVER_RESULT` | PASS | SAN/链/错误 CA/地址不匹配/TLS 版本/日志不泄漏 token |
| M3 | `M3_FINAL_GATE_RESULT` | PASS | 三层全 PASS（当前 HEAD 重跑） |
| M3 | `M3_PRECONDITION_RESULT` | PASS | 审计前置（M0 基线完整性 + 工作区清洁） |
| M3 | `M3_SLICE0B/1/2/3/4_GATE_RESULT` | PASS | 六个 slice key 全 PASS |
| M3 | `AUTH_OTP_RESULT` | PASS | phone+OTP、HMAC、dev sink 不进日志、密码登录已退休 |
| M3 | `COMMENTS_RESULT` | PASS | 20 条：计数含回复、层级、replyTo |
| M3 | `LIKES_RESULT` | PASS | 26 条：幂等、跨用户隔离 |
| M3 | `PUBLISH_RESULT` | PASS | 26 条：作者只来自会话、四种注入全拒 |
| M3 | `DEVICE_PUBLISH_RESULT` | PASS | 设备端闭环（无 session 夹具） |
| M3 | `PLACES_RESULT` | PASS | 含同名歧义 closeout（0→NULL / 1→bind / >1→NULL） |
| M3 | `SLICE4_POIDETAIL_CONFORMANCE` | PASS | 与可采信只读证据一致 + 反向断言 |
| M3 | `CLEANUP_RESULT` | PASS | 定向清理；canonical 未变 |
| M4 | `M4_FINAL_GATE_RESULT` | PASS | 三层全 PASS（当前 HEAD） |
| M4 | `M4_STORAGE_GATE_RESULT` | PASS | 五 key 全 PASS |
| M4 | `MEDIA_SCHEMA_RESULT` | PASS | 29 条（DB 级 cross-scope 防线 / 授权复用 / 幂等键） |
| M4 | `MEDIA_UPLOAD_RESULT` | PASS | 26 条（内容嗅探 / 路径穿越 / 幂等 / 磁盘与体积） |
| M4 | `MEDIA_DELIVERY_RESULT` | PASS | 22 条（命名空间隔离 / X-Accel / 撤回后不可读） |
| M4 | `M4_BACKUP_RESTORE` | PASS | 含 `DATABASE_RESTORE` / `MEDIA_STORE_RESTORE` / `CROSS_REFERENCE_INTEGRITY` |
| M4 | `MEDIA_ORPHAN_CLEANUP` | PASS | dry-run 不删 + 阈值保护 + 不碰被引用文件 |
| M4 | `SLICE_A_DEVICE_RESULT` | PASS | 6/6（blob 加载、凭据不进 URL、登出取不到、blob revoke） |
| M4 | `MESSAGING_API_RESULT` | PASS | 13 条（成员/非成员/未登录/撤回一致性） |
| M4 | `MENTIONS_RESULT` | PASS | 13 条（mention 成员/非成员/自己/去重） |

## 二、两维覆盖率（沿用审核记录 13 的口径）

```
BASELINE_PAGE_COVERAGE:  22 / 22 observed      （原版页面"看到过"）
CONFORMANCE_EVIDENCE:
  admissible:   poi-detail、登录页、schools/校区、map、message、feed-detail、
                发布页结构、点赞展示规则、message-board
  inadmissible: at-panel、media-preview、群聊页、comment-detail 的层级部分
  blocked:      点赞切换、发布后反馈、评论写入因果、原版 @ 提及关系（BLOCKED_BY_POLICY）；
                验证码页视觉（BLOCKED_BY_ETHICS）
```

> `22/22 observed` **不等于** `22/22 strict 1:1 verified`。

## 三、已知偏差与未评估项清单（M5 的输入）

| 项 | 状态 | 原因 |
|---|---|---|
| `OTP_UI_VISUAL_CONFORMANCE` | NOT_EVALUATED | 验证码页无原版证据；取证会给真实号码真发短信（BLOCKED_BY_ETHICS） |
| `AT_PANEL_VISUAL_CONFORMANCE` | NOT_EVALUATED | 证据依赖第三方写操作（INADMISSIBLE） |
| `MEDIA_PREVIEW_VISUAL` | NOT_EVALUATED | 同上 |
| `MEDIA_UPLOAD_AND_SEND_TRANSITION` | BLOCKED_BY_POLICY | 必须发图片才能观察 |
| 点赞切换 / 已点赞态 | BLOCKED_BY_POLICY | 必须点赞才能观察 |
| 发布后的反馈/跳转/动画 | BLOCKED_BY_POLICY | 必须发布才能观察 |
| 原版 `@` 提及模型 | NOT_EVALUATED | at-panel 证据 INADMISSIBLE，不反向推断 |
| 手机号定位 | DEVIATION | demo 不申请定位权限，用校区坐标作参照（`DISTANCE_FUNCTIONAL: PASS` 但 `REAL_DEVICE_GEOLOCATION_CONFORMANCE: DEVIATION`） |
| 图片压缩/重编码 | 未做 | 服务器 396MB + 无 native 图像库；上传只做结构校验与体积上限 |
| `@所有人` | 未实现 | 明确不做（避免与"提到某人"在数据上无法区分） |
| 语音消息 | 未实现 | 原版有语音；M4 只做 text/image/voice 三种 kind 中的前两者落地 |
| per-user 配额 | 未做 | V1 不限制；记为已知限制（单账号可占满盘） |
| `board_notes` | 建模完成、未做前端 | 模型结论 SUPPORTED（用户对用户私密留言） |

## 四、这份审计的用途

M5 若按"逐页与原版比对"推进，需要的正是第三节这张表：
**哪些页可以声称一致、哪些必须标 NOT_EVALUATED、哪些是策略阻断**。
把这三种状态混在一起，会重演"22/22 observed 被误读成 22/22 verified"的老问题。

---

## 附：M5 deviation 登记 —— 底部 tab 数量（2026-09-21）

### 偏差

| 项 | 原版（可复核 dump） | 我们的实现 | 结论 |
|---|---|---|---|
| tab 项数 | **4** | **3** | **DEVIATION** |
| 具体项 | `校园广场` / `<当前账号昵称>` / `校园` / `地图` | `<当前账号昵称>` / `校园` / `地图` | 缺第一项「校园广场」 |

### 证据链（按审核记录 21 要求的 `raw_evidence → observation → conclusion → impact`）

- **raw_evidence**：`docs/original-baseline/raw-dumps/board-observation-1.xml`
  （拉起原版后 uiautomator dump，纯只读；已入库可复核）
  另有 `message-board-dump.xml` 同样可见 4 项
- **observation**：dump 中底部 tab 的 label 依次为
  「校园广场」「自定义名称6」「校园」「地图」共 4 项
- **conclusion**：
  - 原版底部 tab = **4 项**
  - 第二项是**当前账号昵称**派生（本例昵称为「自定义名称6」）
  - **旧结论"三项 / <昵称>、校园、地图"被 supersede** ——
    该旧结论同样只有摘要、当年没有可复核产物
- **implementation impact**：`app/src/components/TabBar.tsx` 目前只有 3 项
  （昵称 / 校园 / 地图），**缺「校园广场」**。这是一个真实的 1:1 缺口。

### 处置

- **本轮只登记，不实现**：补一个 tab 涉及路由、页面归属、与既有
  「校园」tab 的关系（原版「校园广场」与「校园」是两个不同 tab，我们只有一个）
  —— 需要先只读观察「校园广场」页的内容与入口，才能确定它对应我们哪个页面
  （很可能是我们的 feed 页，但不能凭猜）。
- 实现应另立一单，并按 Gate 原则给出 `raw_evidence → … → impact` 链。
- 本轮同时更新 `TabBar.tsx` 的注释：把"原版三个 tab"更正为
  "原版四个 tab（含校园广场），我们目前 3 个，已登记 deviation"，
  避免注释继续传播被 supersede 的旧结论。
---

## 附二：校园广场页的呈现模型（只读观察，2026-09-21）

### raw_evidence

`docs/original-baseline/raw-dumps/board-observation-1.xml`（拉起原版后直接 dump，纯只读，已入库）

### observation（从 dump 读出的控件结构）

```
com.kairuotu.campus:id/collageView                 ← 拼贴容器
com.kairuotu.campus:id/view_image_container        ← 图片卡片
com.kairuotu.campus:id/view_image_bg
com.kairuotu.campus:id/view_image_stroke
com.kairuotu.campus:id/view_user_tag               ← 图片上的用户标签
com.kairuotu.campus:id/iv_user_tag_avatar
com.kairuotu.campus:id/ll_user_tag_capsule
com.kairuotu.campus:id/ll_user_tag_name_row
com.kairuotu.campus:id/tv_user_tag_name            ← 标签里的用户名
```

可见文字里的「他只是经过 / yiyiyi / 一颗石榴 / Yuty / 破霜」**出现在
`tv_user_tag_name` 这一族节点上**，即它们是**贴在图片上的作者标签**，
而不是列表条目里的标题/正文。

### conclusion（谨慎表述）

- 「校园广场」页的呈现模型是 **拼贴 / 照片墙（collage）**，每张图带**作者标签**；
- **不是**我们所实现的**列表式 feed**；
- 因此 tab deviation 的性质比"少一个 tab"更深：
  **该 tab 指向的呈现模型本身就不同**（collage vs list）。

**强度与边界（重要）**：
- 以上是**控件结构级**观察，属可复核范围；
- **交互模型尚未确证**（例如点击单张图会进哪里、标签是否可点、是否分页/瀑布流）——
  这些需要新的只读观察（导航 + dump），**本轮不做，也不推断**；
- 我**不声称**"原版校园广场 = 我们 feed 的拼贴版"这一等价关系：
  它需要比对两边的**内容来源**（是否同一批 posts）才能成立。

### implementation impact

- 该 deviation 的描述从"缺一个 tab"**修正为**"缺一个 tab，且该 tab 的呈现模型
  （collage/照片墙带作者标签）与我们现有列表式 feed 不同"。
- 实现该 tab 前需要先只读观察其**交互模型与内容来源**，
  否则会做出一个"看起来有 4 个 tab、但第一个 tab 语义不对"的实现 ——
  那属于**用存在性掩盖语义差异**，正是本项目一直在防的。
---

## 附三：board 页差异清单的**收敛结果**（2026-09-21，替代附二里的 4 条）

附二登记的 C1–C4 四条差异，经**只读观察复核**后收敛为：**2 条撤销 / 1 条策略阻断 / 1 条成立**。
以本节为准（附二保留作为"当时的初判"，便于追溯我错在哪）。

| 原编号 | 初判（附二） | 复核后 | 依据（可复核产物） |
|---|---|---|---|
| C1 | 缺返回按钮（原版有返回+关闭两个） | **撤销** —— `ivClose` 的 bounds [42,91][84,133] **完全落在** `iv_back` [28,77][98,147] 内、且 `ivClose` `clickable=false`，很可能是"一个可点击容器 + 内部图标"，**不是两个按钮** | `raw-dumps/board-ivback-{before,after}.xml` |
| C2 | 缺留言总数 | **撤销** —— `tvTotalComment` 的可见文本就是标题「留言」 | 同上 |
| C3 | 缺下拉刷新 | **BLOCKED_BY_POLICY** —— 该断言需**非空留言板**才能评估；空态下刷新本就可能被禁用；而造非空必须**发留言＝写操作＝禁止** | `raw-dumps/board-refresh-{before,mid,after}.xml`（三份均为空态） |
| C4 | 表情是图片而非文字 emoji | **成立（DEVIATION）**，实现方式待审核裁定（复刻图像 vs 先做 image-based structure） | `raw-dumps/message-board-dump.xml`（`emotion_image`）+ `raw-dumps/emoji-row-crop.png` + 像素主色测量 |

### 这张表本身就是一条教训的量化

四条初判里：**两条错在"照 `resource-id` 的名字写结论"**（`ivClose` 被当成"关闭按钮"、
`tvTotalComment` 被当成"总数"）、一条**合规做不了**、只有一条真的成立。
如果按初判直接开工，会做出**两个原版并不存在的控件**，同时漏掉真正成立的 C4。

审核那句原则因此被写进纪律：**不要把 `resource-id` 的名字当成行为 contract。**

### 仍待审核裁定的两项

1. C4 的实现方式：**复刻 6 个图标图像** vs **先完成 image-based structure**
2. `force-stop` 替代规则是否够严（我已经默认改为**不主动干预原版 App**，
   改为"先把自己 Activity 拉回前台，否则 abort"，force-stop 降级为显式开关）