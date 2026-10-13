# WO#9A 计划：Group Conversation Vertical Slice（群聊垂直切片）

> 时间：2026-09-22 02:45｜Round 258｜依据：审核记录 44（"WO#9 拆 Group 基础与 AT"）
> 状态：**待审核批准**（先报计划，不动产品代码）

## 一、⭐ 前提核查结论：**后端 schema 已经支持群聊**（比预想小得多）

`scripts/m5/probe-group-support.sh`（只读）的实测结果：

```
message_threads:
  message_threads_kind_allowed : CHECK (kind IN ('direct','group'))   ← **group 已被允许**
  title   nullable=**YES**（无 title NOT NULL 约束，与实测 title=NULL 一致）
  id / kind / created_at  nullable=NO
thread_members:
  UNIQUE (thread_id, user_id)
  FK thread_id → message_threads(id) ON DELETE CASCADE
  **没有成员数上限、没有角色列（owner/admin）**
  列：id / thread_id / user_id / joined_at
现有数据：threads direct=2（**group=0**），thread_members=3 行
```

→ **不需要改 schema**。WO#9A = **造种子 + 前端接真实 API + Gate**。
（若将来需要"群主/管理员/群公告"等角色与元数据，那才需要迁移；本单明确不做，见 §五。）

### 1.1 ⚠️ 我自己的一个脚本 bug（如实记录）

第一版 `probe-group-support.sh` 里写了
`column_name || ' ' || data_type || coalesce(' NOT NULL','')` ——
**`coalesce(' NOT NULL','')` 永远返回 `' NOT NULL'`**，于是那份"列定义"会
**无条件**打印 NOT NULL（我据此差点误判 `title` 不可空）。
已改为读 `information_schema.is_nullable`，并在脚本里写明这个坑。

## 二、原版证据（只读 dump，已入册，可复现）

来源：`docs/test/original-baseline/screens/original-chat/20260921-205407-04-chat-open.xml`
（该会话 `GroupForEvidence(1)` **本身就是群聊** —— 见同目录 INDEX.md）
提取工具：`scripts/m5/dump-extract-nodes.mjs`（Node 实现，**避免 PowerShell `$matches` 被覆盖的坑**）

```
toolbar y=[0,154]
  topLayout y=[42,154]
    leftIcon    y=[42,154] x=[0,126]     clickable      ← 返回
    chatAvatar  y=[63,133] x=[137,207]   clickable      ← 群头像（80×70 设备 px ≈ 46×40 CSS px）
    title       y=[77,120] x=[221,954]   'GroupForEvidence(1)'  ← **群名（不含成员数）**
    rightIcon   y=[42,154] x=[954,1080]  clickable      ← 右侧入口（群设置/更多）
listContainer y=[154,1786]
  msgList RecyclerView（可点）
    headerToast  y=[168,197] x=[513,566] '10:24'   ← 时间分隔，**水平居中**
    消息① userAvatarView y=[225,291] x=[989,1052]（右）+ chatContentView '@' x=[905,975]
    消息② userAvatarView y=[323,389] x=[989,1052]（右）+ chatImageCardView y=[323,790] x=[625,975]
composer y=[1786,1920]：inputTextView（'发消息…'）+ emojiBtn + plusBtn
```

### 2.1 ⚠️ 必须如实标注的**证据空白**

```
该群里**只有自己发的消息**（INDEX.md 〇节已说明：这 2 条是此前一次越界写操作造出来的，
且都由同一账号发出）。因此：
  · 群聊里 **"别人发的消息"如何渲染（是否左侧 + 头像 + 昵称）** —— **无证据**
  · 群聊里 **是否显示发送者昵称**（群聊常见，但这里看不到）—— **无证据**
  · 群名右侧是否有成员数 —— 实测**没有**（title 文案就是纯群名）
→ 本单对"对方消息"的排布只能**沿用已有强证据的规则**（direct 会话里对方靠左，
  见 docs/pending/m5/CHAT-SENDER-PRESENTATION-CONFIRMED.md），并明确标注这是**跨场景沿用**，
  而不是"群聊场景下直接观察到的"。
```

## 三、范围（严格限定）

```
做:
  1. **种子**：造 1 个真实群会话（kind='group'、title、≥3 名成员、若干消息）
     —— 只用我们自己的库与账号（自建后端，允许写）
  2. **读**：GroupChatScreen 改为接真实 API
       · 群名/成员数来自 GET /api/threads（或新增的会话详情）
       · 消息来自 GET /api/threads/:id/messages（**已有**）
       · 按 dump 的证据呈现：左侧返回 / 群头像（可点）/ 群名 / 右侧入口
         + 时间分隔居中 + 消息气泡（自己靠右，对方靠左 = 跨场景沿用并标注）
  3. **写**：在群里发消息（文本 / 图片 / 语音）—— 复用既有 postThread*Message（**已有**）
  4. **成员资格**：非成员访问群会话必须 404（沿用既有成员判定），Gate 要断言
  5. **ENTRY REACHABILITY**：从「消息」列表的真实入口进入群聊（**不设 hash**）
不做（明确排除）:
  · ❌ AT 面板 / @所有人 → **WO#9B**
  · ❌ 群管理（建群/邀请/踢人/退群/改群名/群公告）—— 原版有，但**无 UI 证据**，
       且涉及角色模型（thread_members 无角色列）→ 属**另一个 vertical slice**，本单不碰
  · ❌ 群主/管理员角色（需要迁移加列）
  · ❌ 群头像的真实来源（原版 chatAvatar 可点；我方先用首字占位，
       与 MessageScreen 保持一致 —— 后端暂无头像字段）
```

## 四、Gate（须可失败；沿用审核 43/44 的 REQUIRED 口径）

```
改前（当前状态，应 FAIL）:
  · "从「消息」列表点群会话 → 到达真实群聊并加载真实消息" → **FAIL**
    （现状：点群行进的是纯 mock 的 GroupChatScreen，**0 次 /api 请求**）
  · "种子群会话出现在 /api/threads" → **FAIL**（当前 group=0）

改后:
  GROUP_THREAD_IN_API            /api/threads 里存在 kind='group' 的会话，且 memberCount ≥ 3
  MESSAGE_LIST_SHOWS_GROUP       「消息」列表出现该群行（data-thread-kind='group'）
  ENTRY_REACHES_GROUP            从**真实入口**点群行 → 落在群聊路由且 id 为**同一 UUID**
  GROUP_MESSAGES_FROM_API        群聊页真的发出 GET /api/threads/<uuid>/messages 且 200
  GROUP_MESSAGE_IDENTITY         列表里每条消息的 sender 与 API 返回的 senderId 一致
                                 （**不得**用本地 mock 的 from='peer' 代替）
  GROUP_SEND_TEXT                在群里发文本 → exactly one POST → 201 → DB delta=+1
                                 → kind=text → sender=当前用户 → message_media 无行
  GROUP_SEND_PERSISTENCE         reload 后仍在
  GROUP_MEMBERSHIP_DENIED        非成员访问该群 → **404**（0 条消息泄漏）
  UI_HEADER_CONFORMANCE          返回/群头像/群名/右侧入口 四件事都存在且群名文本 = title
  COMPOSER_REGRESSION            text/image/voice 三条发送路径不受影响
  SERVER_REGRESSION              M5 gate 全绿
SENSITIVITY（受控突变）:
  · 把群消息数据源临时换回 mock → GROUP_MESSAGES_FROM_API 必须 FAIL；恢复 → PASS
  身份 oracle：/api/auth/me + DB，不用 CSS/class 自证
```

## 五、需要审核裁定的问题

```
1. **是否批准 WO#9A**（范围见 §三）？
2. §2.1 的证据空白：群聊里"对方消息"的排布**无直接证据**。
   · 我打算**沿用** direct 会话的强证据（对方靠左 + 头像）并明确标注"跨场景沿用"，而不是凭惯例臆造。
   · 这个处理可以吗？还是你希望先把"能否取到群聊对方消息的渲染证据"单列为一个取证项？
3. 群聊页是否显示**发送者昵称**（群聊常见）—— 我**没有证据**，因此**暂不实现**。
   同意吗？
4. 种子群的**内容量**：造几条消息、几名成员合适？
   我倾向：3 名成员（含自己）+ 3 条消息（含 1 条文本、1 条图片），
   足以覆盖"自己/对方""文本/图片"的组合，又不过度膨胀基线。
5. 群管理（建群/邀请/踢人/退群/群公告）确认**不在本单**、另立后续单 —— 同意吗？
```
