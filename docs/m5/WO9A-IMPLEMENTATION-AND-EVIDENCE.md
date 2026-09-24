# WO#9A 群聊垂直切片 —— 实施与验证记录

> 时间：2026-09-22 03:08｜Round 258｜依据：审核记录 45（WO9A APPROVED + 两处收紧）

## 一、前提核查：schema 早已支持群（**无需迁移**）

`scripts/m5/probe-group-support.sh` 实测：
```
message_threads_kind_allowed : CHECK (kind IN ('direct','group'))
title                        : nullable=YES（无 title NOT NULL 约束）
thread_members               : UNIQUE(thread_id,user_id)、FK cascade、
                               **无成员数上限、无角色列**
```
→ 本单 = 造种子 + 前端接真实 API + Gate。

## 二、种子（按审核 45 的收紧口径）

```
群 members = **2 人**（anmoss + Lemy）
非成员     = Azur冰弦（第三个现有用户）
  ↑ 为什么刻意只用 2 人：若把 3 人全放进群，就**没有第三方账号**可验
    GROUP_MEMBERSHIP_DENIED，而那恰是本切片最重要的 Gate。
  ↑ 且"合法群必须 ≥3 人"**没有证据** → Gate 断言 memberCount == **种子声明数**（2），不是 >=3。

3 条消息：Lemy 文本 / anmoss 文本 / anmoss **图片**
  ↑ 覆盖两个 sender 方向 + 一个媒体读取样本（审核 45 建议的构成）

图片是 **private 媒体**：先写实体文件、再按文件算 sha256/bytes（防悬空引用 —— M4 的教训）

实测（跑 seed 前后）：
  threads   2 → 3      members 3 → 5
  messages  2 → 5      media   2 → 3      message_media 0 → 1
  实体文件：/srv/campus/uploads/private/2026/09/seed-group-anmoss-1.png **9398B 确认落盘**
  SEED_HASH bfeea7f7de4c0217be37b7fbeb7aaaec90ff24ee93725be0579a0f6e088baf4d
```

## 三、实现（遵守审核 45"**不要复制三套发送逻辑**"）

```
· **复用同一个 ChatScreen**，只加 variant='group' 换头部 ——
  消息渲染 / composer / 媒体鉴权全部共用，因此 WO#2 / WO#5 / WO#7 的 Gate 继续对群聊生效。
· 群名来自服务端：新增 GET /api/threads/:id（成员-only，404 语义与 messages 接口完全一致）。
  **刻意不**把 title 从路由 query 传进来 —— 否则群名就成了客户端提供的不可信输入。
· 修正 GET /api/threads 的 peerName：**只对 kind='direct' 计算**
  （群聊里返回 peerName 只是"某个别的成员"，是误导性字段，将来会被误用）。
· 头部按 dump 证据复刻：返回 / 群头像 46×40 CSS px / 群名（**无成员数**）/ 右侧入口。
  ⚠️ 群头像与右侧入口渲染为**不可交互** —— 原版它们是 clickable 节点，
     但**目的地无证据**（右侧很可能就是本单已排除的群管理）。
     按审核 45"不要编假行为"处理：
       GROUP_AVATAR_DESTINATION: NOT_EVALUATED
       GROUP_RIGHT_ACTION:      NOT_EVALUATED / OUT_OF_SCOPE
· 删除纯 mock 的 GroupChatScreen.tsx 与 group.css
  （群聊路由改走共享 ChatScreen 后即成死代码；保留只会诱发"两套行为"）。
```

## 四、验证结果

### 4.1 设备 Gate（`scripts/m5/gate-wo9a-group-slice.mjs`）—— 8 项全 PASS

```
ENTRY_MESSAGE_LIST          真实入口（顶栏「消息」图标进入，**不设 hash**）
GROUP_THREAD_IN_API         memberCount == 种子声明数（2）
MESSAGE_LIST_SHOWS_GROUP    「消息」列表出现群行（data-thread-kind='group'）
ENTRY_REACHES_GROUP         点群行 → 落群聊路由，且 id 为**同一 UUID**
GROUP_MESSAGES_FROM_API     页面真的发出 GET /api/threads/<uuid>（元数据）与 /messages → 200
                            并真的发出 GET /api/media/<private-media> → 200（群内图片加载）
GROUP_MESSAGE_IDENTITY      **checked=3 ok=3**（页面归属与 API senderId 全部一致）
   GROUP_OWN_MESSAGE_RIGHT:  CONFIRMED（原版群聊 dump 直接观察到）
   GROUP_PEER_MESSAGE_LEFT:  CROSS_CONTEXT_REUSE / NOT_DIRECTLY_OBSERVED（如实标注）
UI_HEADER_STRUCTURE / UI_HEADER_TITLE_MATCHES_API / GROUP_BACK_NAVIGATION  PASS
GROUP_AVATAR_DESTINATION / GROUP_RIGHT_ACTION  NOT_EVALUATED
WO9A_DEVICE_GATE: PASS（exit 0）
```

### 4.2 授权矩阵（`scripts/m5/verify-group-authorization-matrix.sh`）—— 12 项全 PASS

审核 45 称此为**本切片最重要的 Gate**（"非成员读取 404 只证明 confidentiality 的一半；
**写也必须拒绝且零 mutation**"）：
```
成员A(anmoss) / 成员B(Lemy): 列表可见 / 读 200 / 写 201
                             读到的消息数 == DB 群消息数（3）
非成员C(Azur冰弦):          列表**看不到** / 读 **404** / 写 **404**
                             **零 mutation**（DB 里 0 条 WO9A-NONMEMBER-*）
DB delta = +2（两个成员的写入都落库，非成员 0 条）
群内图片：成员 200 / 非成员 404
GROUP_AUTHORIZATION_MATRIX: PASS
```

### 4.3 回归

```
WO#8 消息入口 Gate     PASS（修正两处断言精度后，见 §五 ⑥）
WO#7 文字发送 Gate     PASS
WO#6 tab 竖排 Gate     PASS
M5 server gate         PASS（REAL_EXIT=0，PERSISTENT/STAGE/REGRESSION 全绿）
```

### 4.4 改前 FAIL（PREFERRED 证据，实施前采集）

```
GROUP_THREAD_IN_API / MESSAGE_LIST_SHOWS_GROUP / ENTRY_REACHES_GROUP /
GROUP_MESSAGES_FROM_API / UI_HEADER_CONFORMANCE  全 **FAIL**（当时 group=0、群聊页纯 mock）
```

## 五、⚠️ 本轮我自己的 6 处 bug（全部已修并写进注释）

| # | bug | 为什么危险 |
|---|---|---|
| ① | PowerShell `$matches` 被**后续每次** `-match` 覆盖 | 提取 dump 文本时印出的是坐标数字（'513'/'63'），而我差点把它当文本证据用 → 已改 Node 提取（`dump-extract-nodes.mjs`） |
| ② | `coalesce(' NOT NULL','')` **永远**返回 `' NOT NULL'` | 探针的"列定义"会**无条件**显示 NOT NULL，我据此差点误判 `title` 不可空 → 已改读 `information_schema.is_nullable` |
| ③ | 授权矩阵所有角色**共用一个临时文件** | 打印"成员A 读到的消息"时该文件已被非成员的 404 覆盖 → 打出 0 条，让我一度以为接口坏了（接口完全正常）→ 已改每角色独立文件 + **加断言**（不达标即 FAIL） |
| ④ | 断言取身份**猜错 localStorage key**（`campus.session`） | meId=null → 误判 FAIL；而 DOM 对齐其实完全正确 → 已用真实 key `campus.demo.session.v1` |
| ⑤ | 在 WebView 里用**相对路径** fetch | 打到 Capacitor 本地服务器，**返回 HTML 且状态码 200** → `json()` 得 `{}`，看着像"服务端没返回 id"。**这是本项目第二次踩同一个坑**（第一次是 WO#5 的语音 E2E）→ 已改**绝对 origin** |
| ⑥ | 门禁脚本里在**模板字符串内部写了反引号** | 模板提前闭合 → 整个脚本 SyntaxError（"missing ) after argument list"）→ 已修，并做了反引号**成对审计** |

### 5.1 另外一处**不是产品回归**的门禁 FAIL（值得单独记）

WO#8 的 Gate 在加入群会话后有 2 条 FAIL，查证后**都是断言没指明"测的是哪一行"**：

```
① IDENTITY_CONTINUITY：原为**全局有序**比较。
   但我方列表**按类型分组呈现**（群在前、单聊在后，与原版列表呈现一致），
   而 /api/threads 按"最后消息时间"排序 —— 两者全局顺序**本就不应相等**。
   → 改为**按类型分别比较有序子集**（仍不许增/减/换序），
     完全保留审核 44 要的 exact identity continuity，只是不要求跨类型全局顺序。
② 点击断言：原取"第一个 data-thread-id 行"，有群后第一行是群 → 落到 #/group，
   而该断言本意是验 **direct** 聊天路径。
   → 改为**显式点 [data-thread-kind="direct"]**；（群路径由 gate-wo9a 负责）。
```

> **教训（与既有纪律同源）**：断言必须**精确指明它验的是哪一个对象**。
> 否则一个合理的呈现变化（分组）会让断言因**无关原因**失败 ——
> 那与"假 PASS"一样会消耗对 Gate 的信任。修正是让断言**更精确**，不是放松契约。

## 六、仍未做 / 明确排除（审核 45 同意）

```
❌ AT 面板 / @所有人            → WO#9B（AT 结构证据与 mentions_all 设计已就绪）
❌ 群管理（建群/邀请/踢人/退群/改群名/群公告）→ 后续独立单（thread_members 无角色模型）
❌ 群主/管理员角色              → 需要迁移加列
❌ 群聊页显示发送者昵称          → 无证据（"群聊通常显示昵称"不能替代证据）
❌ 群头像真实来源                → 后端暂无头像字段；当前用首字占位
❌ 时间分隔符的插入规则          → "存在且居中"有证据，但"什么间隔插入"无证据
                                  → **不把自己的分组算法写成原版 conformance**
```

## 七、可复现

```bash
bash scripts/m5/run-seed-on-server.sh                       # 造群种子（服务器）
bash scripts/m5/run-device-gate.sh scripts/m5/gate-wo9a-group-slice.mjs   # 设备 Gate
bash /tmp/verify-group-authorization-matrix.sh              # 授权矩阵（服务器）
node scripts/m5/dump-extract-nodes.mjs                      # 提取只读 dump 的控件结构
```
