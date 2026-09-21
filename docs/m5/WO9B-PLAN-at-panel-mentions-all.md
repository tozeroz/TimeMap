# WO#9B 计划（第 3 版）：AT 面板 / @所有人 —— 两层分离 + 2 个 blocker 已冻结

> 时间：2026-09-22 03:28｜Round 260
> 修订依据：**审核记录 48**（`WO9B: CONDITIONALLY APPROVED`，要求冻结 2 个 blocker）
> 状态：**待审核确认 blocker 已解决**

## 〇、两层分离（审核 47/48 已冻结）

```
Layer A = AT_PANEL_PRESENTATION / SELECTION UI
Layer B = MENTIONS_ALL_PERSISTENCE / MESSAGE SEMANTICS
两者**独立状态键**。即使得到 AT_PANEL_STRUCTURE: PASS，也**不能**顺带推成
AT_ALL_PERMISSION_MODEL: PASS；反之层 B 持久化正确也**不**证明原版 UI 触发方式一致。
```

## 一、原版证据（静态、可采信）—— 不变，见 `docs/m5/EVIDENCE-at-panel-structure.md`

面板=底部弹层；标题「选择提醒的人」(16sp bold 居中)；关闭按钮 accessible name「关闭」；
列表固定 500dp；「所有人」项 行高 88dp / 图标 56dp / 标签 16sp / 图文间距 12dp；
空态「暂无群成员」；失败态「加载失败」；存在 `item_at_panel_member` 与 `item_at_panel_section_header`。

---

## 二、✅ BLOCKER ①（已冻结）：AT 面板成员的 **authoritative source**

### 2.1 问题

审核 48：
> "WO#9A 已经证明 membership 存在于数据库，但 **UI 不能从 seed、已有消息 sender、
>  mock 或本地数组反推成员**。在开工前必须冻结一个 API contract。"

### 2.2 冻结的契约（**扩展现有接口，不新开路由**）

```
GET /api/threads/:id      （现有接口，M5 WO#9A 已建立）
  新增字段：
    members: [ { id: string, displayName: string } ]
  语义：
    · 仅返回**当前会话的成员**，顺序稳定（按 displayName 排序，与既有 peerName 的取值口径一致）
    · 权限：**成员 → 200；非成员 → 404**（沿用既有"不存在与无权查看一律 404"的刻意不区分）
    · 与既有字段（id/kind/title/memberCount/peerName）**并存**，不改变它们的语义
```

**为什么选扩展而不是新开 `GET /api/threads/:id/members`**：
AT 面板打开时**同时**需要群名与成员列表；分成两个请求会让"面板显示的群名"与"成员所属的群"
出现**两次取数、两个时刻**的可能不一致。一个接口一次取，天然自洽。
（若将来成员列表需要分页，再单独开路由。）

### 2.3 Gate（**新增，blocker ①**）

```
AT_MEMBER_SOURCE_AUTHORITY
  面板里每个成员行的 id 与**同一次** GET /api/threads/:id 返回的 members[].id 做**集合级**比对：
    no missing / no extra / **no mock identity**
  且 displayName 逐项一致（同一 id 配对）
  ⚠️ 反向断言：面板里**不得**出现任何不在 API 返回里的 id（含 mock id 'u1'/'u5' 这类）
```

---

## 三、✅ BLOCKER ②（已冻结）：点击「所有人」后的**可见选中状态**

### 3.1 问题

审核 48：
> "你现在定义了 AT_ALL_ITEM_PRESENT 和后端 mentionsAll=true，
>  但中间缺：**用户点完以后怎么知道自己真的选中了？**
>  这正是之前 ENTRY REACHABILITY 类问题的另一种形式。"

### 3.2 冻结的流程（`PROVENANCE: OUR_DESIGN_CHOICE`）

```
1. 用户在 AT 面板点「所有人」
2. **面板关闭**
3. composer 上出现**明确的** @所有人 可见标记（chip/token/文本三者之一，我方选择具体形态）
4. 内部状态 mentionsAll = true
5. 发送 → 成功 → **清掉该可见标记与内部状态**
6. 发送**失败** → draft 保留 **且 @所有人 选中状态保留**
   （否则用户重试时语义**悄悄丢失** —— 只留草稿不留 @，发出去就是一条普通消息）
7. 用户可**取消**：删除/关闭该可见标记 → mentionsAll = false
```
```
AT_ALL_SELECTION_PRESENTATION: OUR_DESIGN_CHOICE
ORIGINAL_PRESENTATION:         NOT_EVALUATED
```

### 3.3 Gate（**新增，blocker ②**）

```
AT_ALL_SELECTION_VISIBLE                点击后 composer 上存在可见的 @所有人 标记（不设 hash 进页面）
AT_ALL_SELECTION_STATE_MATCHES_PAYLOAD  该标记与"将要发出的 mentionsAll"一致
                                        （发出去的那条消息在 DB 里 mentions_all 必须为 true）
AT_ALL_SELECTION_CLEARED_AFTER_SUCCESS  发送成功后标记消失，且内部状态复位
AT_ALL_SELECTION_PRESERVED_AFTER_FAILURE 发送失败后 draft **与** 选中状态**都保留**；
                                        随后重试成功时 DB 里 mentions_all 仍为 true（语义没丢）
```

---

## 四、✅ 措辞修正（审核 48 强制要求）

### 4.1 direct 的措辞必须改

审核 48：
> "请把'全体在两人会话里语义不可能'改掉。
>  因为 direct chat 中 @所有人 **并非逻辑上不可能**；只是你当前产品选择不提供这个语义。"

**冻结为**：
```
MENTIONS_ALL_DIRECT_POLICY:
    REJECT
PROVENANCE:
    OUR_DESIGN_CHOICE
ORIGINAL_BEHAVIOR:
    NOT_EVALUATED
```
（即：**不再**声称它在语义上不可能；只声称**我方选择拒绝**。）

### 4.2 权限策略（审核 48 认可的最小规则 + 出处）

```
AT_ALL_PERMISSION_POLICY:
    group member  → allowed
    non-member    → inaccessible / 404
PROVENANCE:
    OUR_DESIGN_CHOICE
ORIGINAL_AT_ALL_PERMISSION_MODEL:
    NOT_EVALUATED
```
审核 48 的补充理由（保留）：
> "你现在没有 owner/admin role、没有原版 @all 权限限制证据、无副作用手段验证原版权限。
>  所以工程上需要一个明确 policy 才能完成产品闭环。'任一 group member 可使用'是合理的最小规则。"
> "**不需要因为权限模型未知就把入口对所有成员隐藏**，否则真实群聊里的功能会永远无法完成。"

---

## 五、✅ 服务端不变量（审核 48 要求显式写明：这是 **service transactional invariant**，不是 DB CHECK）

```
SERVICE_INVARIANT（在**同一个** message-create 事务内，任一失败 → 零消息 + 零 mention 变更）:
  1. group membership checked           （非成员 → 404，零 mutation）
  2. direct rejected                     （→ 4xx，零 mutation）
  3. mentionsAll 与逐人 mentions **互斥**（mentionsAll=true 且 mentions 非空 → 4xx；
                                          且落库后 message_mentions 必须 0 行）
  4. 所有检查在**同一事务内**、且在写入之前/之中完成
  5. 任何失败 → **zero message + zero mention mutation**
```
审核 48 原话：
> "当前都属于 service transactional invariant，不是普通 DB CHECK invariant。……
>  如果未来出现**第二条数据库写路径**，再重新决定是否需要 trigger。"

---

## 六、⚠️ 未取证项（**不实现、不猜**）

```
AT_PANEL_TRIGGER:
    OUR_DESIGN_CHOICE / ORIGINAL_NOT_EVALUATED
  —— 本轮已按要求做完一次**有界静态 trace**（审核 48 指定的 probe）：
       scripts/m5/probe-at-trigger-static-trace.mjs（预算：字符串池+布局名两层，最多 6 组关键词，不反汇编）
     结果：**AT_TRIGGER_STATIC_TRACE: FOUND**
       · 面板类符号 AtPanel / AtPanelActivity / GroupAtPanel（多处）
       · **专用触发符号 `openAtPanel` ×1 @classes3.dex**（目的明确的操作名，
         不是泛化的 startActivity）
       · 资源 id 名同在字符串池：activity_group_at_panel / item_at_panel_at_all / item_at_panel_member
       · 成员模型符号：AtPanelMember / AtMember / sectionHeader
     **但限制必须写清**：字符串池**读不到方法体** → 无法证明"**哪个控件**调用 openAtPanel"。
     → 因此**不**把它升级为 conformance；按审核 48 的指示**到此为止、不继续深挖**。

AT_PANEL_GROUPING_RULE: NOT_EVALUATED
    → **不渲染任何 section header**；`item_at_panel_section_header` 的存在只证明
      "原版**有能力**显示 section header"，**不**证明"当前这个群一定分组、按什么规则分组"。
    → 反向 Gate：AT_PANEL_NO_INVENTED_GROUPING

@某人 后的消息渲染（高亮/可点）：无证据 → 不做
面板内搜索 / 多选上限 / 置顶：无证据 → 不做
```

---

## 七、最终 Gate 清单（审核 48 给定）

### Layer A
```
AT_PANEL_ENTRY_REACHABLE             从真实入口可达（不设 hash）
AT_PANEL_KIND                        是**底部弹层**（按 dump 的 constraintBottom_to_BottomOf=parent）
AT_PANEL_TITLE                       标题逐字 == "选择提醒的人"
AT_PANEL_CLOSE_CONTROL               accessible name「关闭」的控件存在
AT_ALL_ITEM_PRESENT                  面板中存在「所有人」项
AT_ALL_ITEM_GEOMETRY                 行高/图标/字号与声明值一致（设备实测，**单位冻结 CSS px**）
AT_MEMBER_SOURCE_AUTHORITY           ★blocker① 面板成员 id 集合 == API members[].id 集合（不漏不多不假）
AT_PANEL_EMPTY_STATE_CODEPATH        空态「暂无群成员」（**CLIENT_CODEPATH PASS via controlled stub**）
AT_PANEL_FAILURE_STATE_CODEPATH      失败态「加载失败」（同上，**不得**写成真实服务器故障 E2E）
AT_PANEL_NO_INVENTED_GROUPING        反向断言：不得渲染无依据的 section header
AT_ALL_SELECTION_VISIBLE             ★blocker② 点击后可见标记存在
AT_ALL_SELECTION_STATE_MATCHES_PAYLOAD ★blocker② 标记与实际发出的 mentionsAll 一致
```

### Layer B
```
MENTIONS_ALL_DB                      DB oracle：mentions_all = true
MENTIONS_ALL_NO_MENTION_ROWS         且 message_mentions = 0 行
MENTIONS_ALL_NO_FAKE_ID              反向断言：无伪造 user id
MENTIONS_ALL_DIRECT_REJECT           direct → 4xx 且 DB delta = 0
MENTIONS_ALL_NONMEMBER               非成员 → 404 且零 mutation
MENTIONS_ALL_READ_MODEL              读模型返回且与 DB 一致
MENTIONS_ALL_PERSISTENCE             重读后仍保留
NORMAL_GROUP_MESSAGE_MENTIONS_ALL_FALSE  普通群消息必须是 false（**不得默认 true**）
MIXED_ALL_AND_INDIVIDUAL_REJECT      mentionsAll=true 且逐人 mentions 非空 → 4xx 且零 mutation
```

### 发送状态
```
MENTIONS_ALL_SUCCESS_CLEARS_SELECTION
MENTIONS_ALL_FAILURE_PRESERVES_SELECTION   （draft 与选中状态都保留）
```

### 回归 + 敏感度
```
COMPOSER_REGRESSION / GROUP_REGRESSION（WO#9A 8 项设备 + 12 项授权矩阵重跑）
SERVER_REGRESSION（先部署当前 gate + sha256 校验 + 看账本行）
SENSITIVITY: ① mentions_all 强制置 false → MENTIONS_ALL_DB 必须 FAIL
             ② 去掉 direct 4xx 分支 → MENTIONS_ALL_DIRECT_REJECT 必须 FAIL
             ③ 面板成员换成 mock 列表 → AT_MEMBER_SOURCE_AUTHORITY 必须 FAIL
             恢复 → PASS
```

---

## 八、需要审核确认

```
1. BLOCKER ① 的契约（扩展 GET /api/threads/:id 返回 members[]，member 200 / non-member 404，
   不新开路由）可以吗？
2. BLOCKER ② 的流程（面板关闭 → composer 可见标记 → 成功清掉 / 失败保留 draft+选中 / 可取消）
   与本轮新增的 4 条 Gate 可以吗？
3. §四 的措辞修正（MENTIONS_ALL_DIRECT_POLICY: REJECT / PROVENANCE: OUR_DESIGN_CHOICE /
   ORIGINAL_BEHAVIOR: NOT_EVALUATED）是否已符合你冻结过的口径？
4. §五 的 SERVICE_INVARIANT 表述是否完整？
5. 静态 trace 结果 FOUND（含 `openAtPanel` 专用符号）—— 按你"追到就停"的指示我**已停止**，
   并保持 AT_PANEL_TRIGGER: OUR_DESIGN_CHOICE / ORIGINAL_NOT_EVALUATED。这样处理对吗？
```
