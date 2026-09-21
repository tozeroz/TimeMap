# M3 模型验证登记表（Data Model V0.1 validation / revision）

> 依据审核记录 06/07：M3 必须产出 **Data Model V0.1 validation / revision evidence**；
> 四个待证假设必须绑定解决时点、给出 `SUPPORTED` / `NOT_SUPPORTED`，**不得悬空**。
> 本文件是**活文档**：每次取到证据就当场更新并立即 migration，不积攒。
> 状态枚举：`PENDING` / `SUPPORTED` / `NOT_SUPPORTED` / `REVISION_NEEDED`（已改）/ `BLOCKED_INSUFFICIENT_EVIDENCE`

## 一、四个待证假设

| # | 假设 | 解决时点 | 状态 | 结论与证据 |
|---|---|---|---|---|
| 1 | `login-sns` 真实身份语义 | Slice 0A | **PENDING** | 尚未观察（Preflight 未做登录） |
| 2 | `places` / `schools` 建模 | Evidence Preflight | **部分完成**（见下） | `places` SUPPORTED；`schools` **SUPPORTED 但需要修订**（校区子实体） |
| 3 | `comments.parent_id` | Slice 1 | **PENDING** | 尚未观察评论层级 |
| 4 | `message` / `group` / `board_note` 关系 | 消息/群/留言观察 | **部分完成** | group 与 chat 已观察（同构、共用会话模型）；`board_note` 待观察 |

## 二、Evidence Preflight 已产出的模型结论

### 2.1 `places` —— SUPPORTED（无需改）

| 断言 | 证据 | 影响 |
|---|---|---|
| 地点需要经纬度 | poi-detail 显示「距我4公里」 | M2 已有 `places.latitude/longitude`，够用 |
| 地址需要容纳长中文地址 | 「联和街道科丰路89号开创大道2707号万达广场负一层商场B1006铺」 | `places.address` 保持无长度上限 |
| 地点与动态是一对多 | poi-detail 主体 = 该地点的动态图片 + 作者标签 | `posts.place_id → places(id)` 方向正确；`posts_place_idx` 已有 |

证据：`supplements/poi-detail.json`、`screens/poi-detail/recovered-m3.png`

### 2.2 `schools` —— SUPPORTED，**但 M2 的建模不完整（REVISION_NEEDED）**

观察（`screens/poi-search/recovered-m3-school-search.png` + `...campus-picker.png`）：

```
校园页/地图页的下拉不是"学校列表"，而是**当前学校的校区列表**：
    北京交通大学
      校本部 / 威海校区 / 东校区
      搜索其他学校 →

「搜索其他学校」页（React Native 页面 XhsReactActivity）每行是：
    上海交通大学 (闵行校区)      6小时前更新   2502条校园圈
    北京交通大学 (校本部)                        4条校园圈
```

**结论**：
1. **学校是真实实体** → `schools` 应独立成表（有搜索、有「更多学校」列表）。原 M2 只在 `users.school_name` 放文本，**不足**。
2. **校区是学校下的子实体** → 「校本部 / 威海校区 / 东校区」是同一学校的不同校区。
3. **"校园圈"的粒度是「学校 × 校区」**，不是学校 —— 列表展示形式是 `学校名 (校区名)`，右侧是该圈的动态数。
4. 圈子还有**「最后更新时间」**（部分行显示「X小时前更新」）。

**修订方向**（M3 内落地，不等到 M4）：
```sql
schools (id, name, region, created_at)
campuses (id, school_id FK, name, created_at)   -- 「校本部」「威海校区」…
users.school_campus_id → campuses(id)            -- 取代单一 school_name 文本
posts.school_campus_id → campuses(id)            -- 动态归属到某个"校园圈"
```
`users.school_name` **不删**（保留为快照/兼容），与 M2 对 `posts.author_name` 的处理一致。

证据：`supplements/schools.json`

### 2.3 `groups` —— SUPPORTED，但需要一条约束（REVISION_NEEDED）

| 断言 | 证据 | 影响 |
|---|---|---|
| 群名有长度上限 24 字 | 创建群聊对话框右下角「0/24」 | `groups.name` 需要 `CHECK(length(name) <= 24)` |
| 群标题展示为「群名(N)」 | 群聊标题 =「GroupForEvidence(1)」 | 这是**展示层**拼接，不要把 `(N)` 存进 `name` |

### 2.4 `message_threads` / `messages` —— 关系澄清（部分结论）

| 断言 | 证据 | 影响 |
|---|---|---|
| 单聊与群聊**共用同一套会话模型** | `GroupChatActivity` 与单聊页控件结构一致（`inputTextView` / `emojiBtn` / `plusBtn` / `msgList` / `chatAvatar`） | M2 的 `message_threads.kind IN ('direct','group')` 方向正确 |
| 消息行结构 = 头像 + 内容 + 时间分隔 | `id/userAvatarView` + `id/chatContentView` + `id/headerToast`（「刚刚」） | `messages` 字段够用 |
| **消息需要"提及"关系** | @ 面板标题「选择提醒的人」+ 首项「所有人」 | `messages` 目前只有 body，**缺少提及关系** → M4 实现群聊写入时必须补（见 2.6） |
| **消息需要类型与媒体引用** | 图片消息是 `id/chatImageCardView`，点开进 `ChatMediaPreviewActivity` | `messages` 只有 text，**缺少 kind + media 引用** → M4 补 |

### 2.5 `board_notes` 与三者的关系 —— PENDING

Preflight 未打开留言板（`message-board`）。按审核要求，这一条要在「消息/群/留言真实入口观察」时给出结论。

### 2.6 登记为"后续阶段必须补"的模型缺口（本阶段不改）

| 缺口 | 何时补 | 原因 |
|---|---|---|
| `messages.kind`（text/image/…）+ 媒体引用 | M4（媒体） | M3 不实现聊天写入 |
| 消息提及关系（`@某人` / `@所有人`） | M4（群聊写入） | 同上 |
| `schools` / `campuses` 表 | **M3**（本阶段） | 已取到证据，且影响"校园圈"归属，越早改越省 |

## 三、本阶段立即执行的 migration

| 版本 | 内容 | 触发证据 |
|---|---|---|
| `004_m3_model_revisions` | 新建 `schools` / `campuses`；`groups.name` 加 24 字 CHECK | 2.2 / 2.3 |

原则（审核记录 06）：**Observed fact ≠ forward-compatible guess** ——
上表 2.6 的三项明确标注为"后续阶段补"，不在本阶段凭空加表。
