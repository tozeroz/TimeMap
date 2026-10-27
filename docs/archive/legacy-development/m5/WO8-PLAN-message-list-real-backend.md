# WO#8 计划（修订版）：「消息」入口接真实后端 —— 主路径 mock 化缺陷

> 时间：2026-09-22 02:27｜Round 258
> 起因：准备 WO#8（AT 面板/@所有人）时先核实"我方 AT 面板现状"，**顺带发现了一个更根本的问题**

## 一、⚠️ 发现：**主路径「消息」整段是 mock，且真实会话从 UI 走不进去**

### 1.1 源码审计：26 个屏幕里 11 个**完全不接后端**

| 引用情况 | 数量 | 屏幕 |
|---|---|---|
| **纯 mock（无 api）** | **11** | CommentScreen、FeedListScreen、**GroupChatScreen**、MapScreen、MediaPreviewScreen、**MessageScreen**、PoiSearchScreen、ProfileEditScreen、ScannerScreen、UpgradeDialog、UserProfileScreen |
| mock + api 混用 | 3 | BoardScreen、CampusScreen、MeScreen |
| 只用 api | 5 | ChatScreen、FeedDetailScreen、LoginScreen、PoiDetailScreen、PublishScreen |

**高频核心路径在纯 mock 里**：`MessageScreen`（消息列表，聊天入口）、`GroupChatScreen`（群聊）、`FeedListScreen`（动态列表）、`MapScreen`（地图）。

### 1.2 设备实测（只读；`scripts/m5/probe-message-path.mjs`）

```
STEP 1  #/message 渲染 23 行，内容**全为 mock**：
          「计算机学院 2023 级 | 期末周自习安排已更新… | 128 人」   ← mock 群 g1
          「Azur冰弦 | 相同学校 | 明天下午一起去图书馆吗？ | 12:31 | 2」← mock 会话 t1

STEP 2  点第 1 行 → `#/group?id=g1`，渲染 mock 群聊（消息 09:12 / 09:14 / 09:15 / 10:02）
        **STEP2_NETWORK = []   → 零网络请求**        ← 铁证：群聊完全不接后端

STEP 3  对照：`#/chat/<真实 UUID>` 正常 → `GET /api/threads/…/messages` **200**
        → 证明 **ChatScreen（真实聊天页）本身是好的**，问题在"**从列表进入**"这条路径
```

### 1.3 根因（源码级，两处）

```
① app/src/data/mock.ts
     threads: [{ id: 't1', … }, { id: 't2', … }]      ← 简单字符串 id
     groups:  [{ id: 'g1', … }]                        ← 同上
   app/src/screens/MessageScreen.tsx:107
     navigate('chat', { id: t.id })                    ← 把 **mock id** 当真实 id 传下去
   app/src/screens/MessageScreen.tsx:91
     navigate('group', { id: g.id })                   ← 同上

② app/src/App.tsx:75
     {root === 'chat' && <ChatScreen id={param ?? 't1'} />}
                                            ^^^^^^^^^^
     ⚠️ 两个问题叠在一起：
        (a) 只读 **param（路径段）**，而 MessageScreen 传的是 **query**
            → 取不到 → 落到默认值
        (b) 默认值是 **mock id 't1'** —— 不是 UUID，服务端必然拒绝
     📌 而 App.tsx:64-71 的注释显示：**M3 已经为 `feed` 修过完全相同的 (a) 类 bug**
        （"之前只读路径段 param，而应用自己的跳转用的是 query"）
        → 同一个 bug 在 `chat` 上仍然存在
     📌 同类可疑项（默认值用了 mock id 或"看似真实但硬编码"的值）：
        `user` → `route.query.id ?? 'u1'`（mock）
        `board` → `param ?? '22222222-2222-4222-8222-222222222222'`（硬编码 uuid）
```

### 1.4 后端现状（决定修法范围）

```
已有 API（客户端函数也都已存在）:
  getThreads()          → GET /api/threads          返回 id / kind / title / memberCount / lastMessage
  getThreadMessages(id) → GET /api/threads/:id/messages
  postThread*Message()  → POST /api/threads/:id/messages

真实 DB 里的会话（只有 2 个，**都是 direct**）:
  ffffffff-0001-4001-8001-000000000001 | direct | 2 人
  66666666-cccc-4ccc-8ccc-000000000003 | direct | 1 人
  → **数据库里没有任何 group 会话**
```

### 1.5 这是与 WO#7 **同一类**的盲区（第二次）

```
WO#7：文字发送 —— 服务端 API 支持、UI 无入口   → "垂直 slice 绿，横向路径断"
本次：消息列表 —— 真实会话 API 存在、列表是 mock → **同一个盲区，范围更大**
共同教训：**每个"能力"都必须有"从 UI 真实可达"的断言**，
         而现有 Gate 都在用**直接设 hash** 的方式进页面（WO#7 的 Gate 就是这么做的）
         → 恰好跳过了"用户怎么走到那里"这一段。
```

## 二、WO#8 范围（**修订**：先修入口，群聊另立）

### 2.1 本单做（**入口优先**，价值最高）

```
WO#8-A  「消息」列表接入真实后端
  1. MessageScreen 改为调用 **getThreads()**，渲染真实会话
     （字段映射：title / memberCount / lastMessage{body,kind,createdAt}）
  2. 加载中 / 失败 / 空列表 三种状态都要有明确呈现（不得静默显示假数据）
  3. 会话项点击 → `navigate('chat', { id: <真实 UUID> })`
  4. **修正 App.tsx 的 chat 路由取 id 方式**：与 feed 一致（先 query.id，再路径段），
     并**删掉 mock 默认值 't1'**：取不到 id 时显示"未指定"而不是假装成功
     （沿用 M3 为 feed 定下的原则：不拿 mock 默认值假装成功）
  5. 同类可疑默认值一并按同一原则处理（`user` 的 'u1'；`board` 的硬编码 uuid 需评估）

WO#8-B  「消息」页的 mock 区块
  入口页除会话列表外还有 mock 区块（"分享我的校园卡 / 邀请同学 / 更多同学"等）。
  **本单只处理"会话/群"列表这一段**；其余区块**逐项列出**并标注
  `STATUS: MOCK_NOT_WIRED`（不假装它们是真的，也不在本单扩大范围）
```

### 2.2 本单**不做**（另立 WO#9，并说明理由）

```
❌ 群聊接真实后端（GroupChatScreen → 真实 API）
   原因：**后端没有 group 会话**，需要先定 group 的语义与种子
        （thread.kind='group'、成员、群公告字段…），属**新能力**而非接线
❌ AT 面板 / @所有人
   原因：它属于**群聊页**；在 mock 群聊上实现 = 假实现
       → 正确顺序：WO#9 把群聊接真实后端 → 再在其上实现 @所有人（那时 AT 面板才有意义）
   （原 WO#8 计划文档 WO8-PLAN-at-panel-mentions-all.md 保留，
     其中 AT 面板的结构证据与 mentions_all 数据模型设计**仍然有效**，只是顺延）
```

## 三、WO#8 Gate（须可失败；沿用审核 43 的 REQUIRED 口径）

```
改前（当前状态）:
  · 断言"消息列表里的会话项 id 是合法 UUID" → 必须 **FAIL**（当前是 't1'/'g1'）
  · 断言"从 #/message 点第 1 个会话后发生 ≥1 次 /api/threads 请求" → 必须 **FAIL**（当前 0 次）

改后:
  MESSAGE_LIST_FROM_API         列表项数 == GET /api/threads 的 items 数（同一份数据的两个视角）
  MESSAGE_LIST_NO_MOCK_ID       列表里每个会话项对应的 route id 都是合法 UUID
  MESSAGE_LIST_CLICK_REACHES_CHAT
                                点会话项 → 落在 #/chat/<uuid> → 且 **真的发出**
                                GET /api/threads/<uuid>/messages 且状态 200
                                （这是本单的核心断言：**用户路径端到端可达**）
  MESSAGE_LIST_EMPTY_STATE      空列表时显示明确空态文案（不得显示 mock 假数据）
  MESSAGE_LIST_ERROR_STATE      后端不可用时显示明确错误（不得静默）
  CHAT_ROUTE_ID_RESOLUTION      query.id 与路径段两种形式都能取到；都取不到时显示"未指定"
                                （**反向断言**：不得回退到 mock id 't1'）
  MOCK_NOT_SILENT               `#/message` 里凡仍是 mock 的区块，有可见标注或已在文档登记
  COMPOSER_REGRESSION           text/image/voice 三条发送路径不受影响（WO#7 的 Gate 重跑）
  SERVER_REGRESSION             M5 gate 全绿

SENSITIVITY（受控突变）:
  · 把列表数据源临时换回 mock → MESSAGE_LIST_NO_MOCK_ID 必须 FAIL
  · 恢复 → PASS
  身份 oracle 仍用 /api/auth/me + DB，不用 CSS/class 自证
```

## 四、待审核裁定

```
1. **是否批准 WO#8（修订版：消息列表接真实后端 + 修 chat 路由 id 取法 bug）**？
2. 把"群聊 + AT 面板/@所有人"顺延为 WO#9（理由：后端无 group 会话，属新能力）——
   这个拆法同意吗？
3. 前端**是否也要以网页形式部署**到服务器？（上一版计划 §一 提的澄清；nginx 当前
   `location / { return 404; }`，即**没有**静态站点）
4. 我在 WO#7 的 Gate 里用"直接设 hash"进入会话页，**跳过了"用户怎么走到那里"** ——
   这被证明正是本次缺陷躲过所有 Gate 的原因。建议把
   **"入口可达性"（entry reachability）** 作为与"功能正确性"并列的常规断言类别，
   写进 Gate 方法论。同意吗？
```
