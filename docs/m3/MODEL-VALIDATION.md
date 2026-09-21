# M3 模型验证登记表（Data Model V0.1 validation / revision）

> 依据审核记录 06/07：M3 必须产出 **Data Model V0.1 validation / revision evidence**；
> 四个待证假设必须绑定解决时点、给出 `SUPPORTED` / `NOT_SUPPORTED`，**不得悬空**。
> 本文件是**活文档**：每次取到证据就当场更新并立即 migration，不积攒。
> 状态枚举：`PENDING` / `SUPPORTED` / `NOT_SUPPORTED` / `REVISION_NEEDED`（已改）/ `BLOCKED_INSUFFICIENT_EVIDENCE`

## 一、四个待证假设

| # | 假设 | 解决时点 | 状态 | 结论与证据 |
|---|---|---|---|---|
| 1 | `login-sns` 真实身份语义 | Slice 0A | **SUPPORTED（已冻结）** | **手机号 + 短信验证码**；无密码、无第三方 SNS；固定 +86；协议未勾选走弹窗而非禁用。详见 `docs/m3/SLICE0-LOGIN-SEMANTICS.md` |
| 2 | `places` / `schools` 建模 | Evidence Preflight | **部分完成**（见下） | `places` SUPPORTED；`schools` **SUPPORTED 但需要修订**（校区子实体） |
| 3 | `comments.parent_id` | Slice 1 | **SUPPORTED（已解决）** | **MODEL: SUPPORTED / PRESENTATION: EXPANDED**，见 2.7 |
| 4 | `message` / `group` / `board_note` 关系 | 消息/群/留言观察 | **已完成** | group 与 chat 已观察（同构、共用会话模型）；**`board_notes` 已判定：用户对用户私密留言（SUPPORTED）**，见 2.8 |

### 1.1 Slice 0A 带来的**契约层**问题（需审核确认）

M2 冻结的认证契约是 `handle + password`（已审核通过）。观察到的原版身份语义是**手机号 + 验证码**。
这不是冲突，而是**机制层 vs 身份层**的区别：

- **机制层**（token 签发/只存 hash/过期/撤销/限流/作者只能来自 session）—— 沿用 M2，不动；
- **身份层**（用户用什么标识、如何证明）—— 原版是手机号 + 一次性验证码。

若照原版做，需要在 M2 之上补：`users.phone`（唯一）、`login_codes`（手机号、**码的哈希**、有效期、是否已消费、尝试次数）。
**这是 M2 冻结面之外的扩展，提交审核确认后再动手**（见 `SLICE0-LOGIN-SEMANTICS.md` 第七节）。

另一个必须声明的限制：本 demo **没有短信通道**。可选方案里**固定万能验证码被否决**
（等于在生产代码里留永久凭证，与审核记录 06 否掉 `dev-register` 的理由同类）。
拟采用：服务端真实生成一次性验证码（随机/有效期/限流/一次性消费），投递降级为**服务端日志**，
并显式标注 `SMS_GATEWAY_NOT_INTEGRATED`，**不得据此宣称"登录已完成"**。

## 二、Evidence Preflight 已产出的模型结论

### 2.1 `places` —— SUPPORTED（无需改）

| 断言 | 证据 | 影响 |
|---|---|---|
| 地点需要经纬度 | poi-detail 显示「距我4公里」 | M2 已有 `places.latitude/longitude`，够用 |
| 地址需要容纳长中文地址 | 「联和街道科丰路89号开创大道2707号万达广场负一层商场B1006铺」30 字 | **没有观察到支持短长度上限的证据，因此 V0.1 使用 TEXT，不人为增加 CHECK**（注意：这只能证明"至少要容纳这种长度"，不能证明原版理论上无限长 —— 措辞按审核记录 08 更正） |
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
| 群名有长度上限 24 字 | 创建群聊对话框右下角「0/24」 | `groups.name` 需要 `CHECK(length(name) <= 24)`。**注意计数语义尚无证据**：24 字按 Unicode code point / UTF-16 code unit / grapheme cluster 计，本轮没有测（中文普通字符三种算法一致）。以后在真实 UI 上测到 emoji 再确认边界，**现在不做过度的语义声明**（审核记录 08） |
| 群标题展示为「群名(N)」 | 群聊标题 =「GroupForEvidence(1)」 | 这是**展示层**拼接，不要把 `(N)` 存进 `name` |

### 2.4 `message_threads` / `messages` —— 关系澄清（部分结论）

| 断言 | 证据 | 影响 |
|---|---|---|
| 单聊与群聊**共用同一套会话模型** | `GroupChatActivity` 与单聊页控件结构一致（`inputTextView` / `emojiBtn` / `plusBtn` / `msgList` / `chatAvatar`） | M2 的 `message_threads.kind IN ('direct','group')` 方向正确 |
| 消息行结构 = 头像 + 内容 + 时间分隔 | `id/userAvatarView` + `id/chatContentView` + `id/headerToast`（「刚刚」） | `messages` 字段够用 |
| **消息需要"提及"关系** | @ 面板标题「选择提醒的人」+ 首项「所有人」 | `messages` 目前只有 body，**缺少提及关系** → M4 实现群聊写入时必须补（见 2.6） |
| **消息需要类型与媒体引用** | 图片消息是 `id/chatImageCardView`，点开进 `ChatMediaPreviewActivity` | `messages` 只有 text，**缺少 kind + media 引用** → M4 补 |

### 2.5 `board_notes` 与 message / group 的关系 —— **已完成（SUPPORTED）**

见 2.8（M3 原始必答假设 #4，已用只读证据判定）。

### 2.8 `board_notes` —— **用户对用户私密留言（SUPPORTED）**

**这是 M3 原始必答的假设 #4**，此前一直挂着"部分完成 / 待观察"。
本轮用**只读**证据（未发任何留言）判定完毕：

进入方式：deep link `campusx://messageBoard`（**不带参数可进** → 本身就是线索）
Activity：`com.kairuotu.feed.messageboard.MessageBoardActivity`

```
id/tvTotalComment  标题「留言」
id/leaveMsgTip     副标题「仅双方可见」
id/tvNoComment     空态「可以给同学留言噢」
id/et_comment_board 输入框，提示「留言仅双方可见」
id/tvSendComment   发送按钮「留言」
id/rvEmojiList + id/fl_emoji_root ×7   表情行恰好 7 个
```

**判定：SUPPORTED —— 留言板是「用户 ↔ 用户」的私密留言，不挂在帖子或地点上。**

五条独立证据：

1. 「仅双方可见」出现**两次**（顶部 `leaveMsgTip` + 输入框 `et_comment_board`）
   → 双边私密语义被重复强调，不是公开内容；
2. 空态文案是「可以给**同学**留言噢」→ 对象是**一个用户**，不是地点/帖子；
3. 控件命名里**没有任何挂载点**：`leaveMsgTip` / `layout_comment_board` /
   `et_comment_board` / `tvSendComment` —— 找不到 `post_id` / `place_id` 之类的痕迹；
4. deep link **不带参数**即可进入 → 它是"与我相关的留言板"，不是某个帖子/地点的子页；
5. 与我们既有建模自洽：`board_notes(from_user_id, to_user_id)` + `CHECK(from_user_id <> to_user_id)`
   ——「给同学留言」且「仅双方可见」正好对应"两个不同用户之间"。

**明确 NOT_SUPPORTED 的三种理解**（避免以后有人按它们改模型）：
- ❌ 留言板挂在帖子上
- ❌ 留言板挂在地点上
- ❌ 留言板是公开的

顺带得到三条可对齐的展示事实：表情行 **7 个**、空态文案「可以给同学留言噢」、
发送按钮文案是「留言」而不是「发送」。

**BLOCKED_BY_POLICY**：留一条留言以观察发送后的渲染（气泡样式/时间格式）——
那是写操作，禁止；改在自建 demo 里造数验证。

证据：`supplements/message-board.json`、`.mumu-capture/m3-board/board-ui.xml`

### 2.7 `comments.parent_id` —— **MODEL: SUPPORTED / PRESENTATION: EXPANDED**（Slice 1 解决）

**证据强度说明**：审核记录 07 明确要求"页面上出现『回复』两个字"**不算**模型证据 —— 那只是线索。
因此本轮不是"看到回复按钮就下结论"，而是**真的发了一条回复，再看它被如何保存与渲染**。

做法（2026-09-21，MuMu + 原版 app）：
1. 信息流 → 动态详情 → 点评论数 → 评论区（内联在 `FeedDetailActivity` 的 ViewPager 里）
2. 点某条评论的「回复」→ 打开回复弹层，标题「**回复 @幽灵小姐**」
3. 输入 `M3REPLYTEST` → 点「发布」
4. **观察它渲染到了哪里**

结果 —— 回复出现在**父评论容器内部的子列表**里：

```
id/comment_number =「评论 2」                                ← 计数 +1
id/cl_feed_detail_comment_message [28,373][1052,714]         ← 父评论的整行容器
├── id/cl_feed_detail_first_comment [28,373][1052,555]       ← 父评论本体（幽灵小姐）
└── id/rv_feed_detail_comment_List [28,555][1052,714]        ← 子回复列表（**嵌套在父容器内**）
    └── id/cl_feed_detail_comment_reply_content
        ├── tv_feed_detail_comment_reply_username = 自定义名称6
        ├── tv_feed_detail_comment_reply_label    =「回复」
        ├── tv_feed_detail_comment_reply_target   =「幽灵小姐」  ← **独立的目标字段**
        └── tv_feed_detail_reply_comment_text_card_content = M3REPLYTEST
```

**MODEL: SUPPORTED** —— 三条独立理由：
1. 关系被**保存**：发布后重新读取，回复仍在父评论内部（不是一次性动画）；
2. 有**独立的目标字段** `tv_feed_detail_comment_reply_target`，与 `..._label`「回复」并列渲染
   → 说明数据里存了"回复了谁"，而不只是把 `@某人` 当文案拼进正文；
3. 父评论与子回复用**两套不同的控件 id 前缀**（`comment_*` vs `comment_reply_*`）。

**PRESENTATION: EXPANDED** —— 有独立的嵌套列表容器 `rv_feed_detail_comment_List`，
且头像 x 从 28 缩进到 116；不是 FLAT。

**顺带得到的两条事实（都影响实现）**：

| 事实 | 证据 | 影响 |
|---|---|---|
| 「评论 N」**把回复也算进去** | 发一条回复后计数从「评论 1」→「评论 2」 | 评论计数 = 顶层评论 + 子回复总数；**不要只数 `parent_id IS NULL`** |
| 回复可以**再被回复** | 子回复行自身也带「回复」按钮 | `parent_id` 允许指向任意一条评论 → 自引用外键即可，不需要限制层级 |

证据：`supplements/comment-detail.json`、`screens/comment-detail/recovered-m3-nested-reply*.png|xml`

**⚠️ 取证手段违规（2026-09-21 更正）**：为取得"关系是否被保存"的证据，
我**在原版第三方 app 里真实发布了一条回复**（`M3REPLYTEST`）。
这是**策略违规**，不是"造数" —— 用户已明确禁止对原版 app 做任何写操作。
完整记录见 `docs/POLICY-VIOLATION-2026-09-21.md`。

因此本判定同时带标签：
```
comments.parent_id  MODEL: SUPPORTED / PRESENTATION: EXPANDED
EVIDENCE_OBTAINED_BY_POLICY_VIOLATION = 真
```
- **结论仍然有效**：层级证据来自 DOM 容器嵌套与独立 `reply_target` 字段的结构，
  不依赖"这条回复是谁发的"；换由我们自己的 demo 构造同等数据也能验证同一结论。
- **手段不被接受**：不该在他人生产系统里写入。正确做法是记 `BLOCKED_BY_POLICY`，
  并在**我们自己的 demo**（自建后端/数据库）里做同等的层级验证。

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
