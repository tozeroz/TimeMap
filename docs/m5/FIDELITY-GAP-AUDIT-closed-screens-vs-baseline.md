# 忠实度缺口审计：已"关账"页面的**原版基线 vs 我们的实现**

> 时间：2026-09-22 04:53｜Round 261
> 触发原因：我在 WO#11 计划阶段才第一次读 `docs/original-baseline/screens/feed-list/baseline.json`，
> 立刻发现 **3 处从未核对过的忠实度偏差**（标题缺「校园圈」、左上应是关闭而非返回、等）。
>
> **既然基线里本来就有这些逐字记录，为什么"关账"的页面没有逐条核对过？**
> 这就是本审计要回答的问题 —— 把 24 个基线目录与我们已实现的页面逐一对照。

## 〇、这次审计暴露的**流程缺陷**（比单条偏差更重要）

```
我们此前的 Gate 大多在验证：
  · 数据来源是否真实（FROM_API / NO_MOCK_ROWS）
  · 行为语义是否正确（零 mutation / 顺序 / 持久化）
  · 交互链路是否完整（选中→发送→清除）
但**很少**做这件事：
  · 对照 `docs/original-baseline/screens/<screen>/baseline.json` 的
    **title / interactions / navigation** 逐条核对

结果：`feed-list` 的 3 处偏差一直存在、且从未被任何 Gate 捕获。
→ 新增纪律：**任何页面的 Gate 必须包含"基线逐条核对"层**（见下文 §三）。
```

## 一、24 个基线目录清单（含证据强度）

| 目录 | 产物 | 证据强度 |
|---|---|---|
| `chat` `group` `at-panel` `comment-detail` `feed-detail` `poi-detail` `poi-search` `publish` `media-preview` `login-select` `login-sns` `original-chat` | json + **xml** + png | **强**（有控件树 dump） |
| `announce` `feed-daily` `feed-list` `message` `message-board` `onboarding` `scanner` `trident-campus` `trident-map` `trident-me` `upgrade-alert` | json + png | **弱**（截图级；json 是逐字记录但无 dump） |
| `original-sweep` | 仅 png ×19 | **最弱**（线索级） |

## 二、逐屏核对结果

### 2.1 `feed-list`（WO#11 目标）

| 项 | 原版基线 | 我们的实现 | 判定 |
|---|---|---|---|
| 标题 | 「校园圈」 | **无标题**（中间只放学校名） | ❌ **偏差** |
| 左侧控件 | **左上关闭**（X） | `IconBack` + `aria-label="返回"` | ❌ **偏差**（图标与语义都不对） |
| 中间 | 「北京交通大学 ▼」 | 学校名 + chevron | ✅ 一致 |
| 导航 | 关闭 → 返回上一页 | `goBack('campus')` | ✅ 语义一致 |
| 右侧 | **基线未提及** | 「发布」+ 号 | ⚠️ `FEED_RIGHT_CONTROL: NOT_EVALUATED` |
| 刷新 | **刷新 → 重新请求** | 刷新 → **零请求** + 显示 mock | ❌ **偏差**（语义相反） |
| normal 态 | **not_reproducible** | 我们显示真实列表 | ⚠️ `ORIGINAL_NORMAL_LIST: NOT_EVALUATED` |

### 2.2 `message`（WO#8 / WO#10 目标）

核对结果（读源码逐项比对）：

| 项 | 原版基线 | 我们的实现 | 判定 |
|---|---|---|---|
| 顶部标题 | 「聊天」（`title` 字段写"聊天列表"，**基线自身不一致**，以 `interactions` 为准） | `center="聊天"` | ✅ **一致** |
| 左上 | 「左上关闭」 | `IconClose` + `aria-label="关闭"` | ✅ **一致** |
| 右上 | 「加号 → **新建会话**」 | `IconPlus` + `aria-label="新建"` | ✅ **一致** |
| 邀请卡文案 | 「分享我的校园卡 / 邀请同学一起加入 Campus! / 邀请同学」 | 前两条一致；**「邀请同学」按钮已移除**（WO#10） | ⚠️ **有意的功能后撤**（审核 51 批准）—— 登记为 KNOWN_DEVIATION |
| **更多同学列表** | **昵称 + 相同学校标签 + MBTI/星座 + 学院-专业 + 年级** | **整块移除**，仅留结构壳 + 中性空态 | ⚠️ **有意的功能后撤**（WO#10）—— 登记为 KNOWN_DEVIATION |
| 分享面板 | 「邀请同学 → 分享面板」 | **入口不再渲染** | ⚠️ **有意的功能后撤**（WO#10）—— 同上 |
| 会话列表（有会话时） | **known_unknowns**：「已存在会话时的列表样式（**本机为 0 会话**）」 | 显示真实会话列表 | ⚠️ `ORIGINAL_MESSAGE_LIST_WITH_CONVERSATIONS: NOT_EVALUATED` |

**→ 对 WO#10 的诚实结论**：顶部三项**与原版一致**（这点此前没核对过，现在核对为一致）；
但「更多同学」与分享面板**确实偏离了原版** —— 原版有完整的资料字段与分享面板。
这个偏离是**有意的、经审核 51 批准的**，但必须登记成 **KNOWN_DEVIATION（有意后撤）**，
不能只说"清理完成"，否则会掩盖与原版的实际差距。

### 2.3 `group`（WO#9A / WO#9B 目标）

⚠️ 本屏的判定**换过一次**（我第一版差点把它写成"与 WO#10 判据冲突"）：
   我读到我们群聊头部的 `rightIcon` 是 `aria-hidden` 的静态元素，一度认为那是
   "渲染了一个看起来可点、点了没反应的假入口"，即 WO#10 要消除的那类。
   **但代码注释与提交记录表明这是 WO#9A 的、经审核 45 批准的刻意决定**：

```
   （源码注释原文）原版里 chatAvatar 与 rightIcon **都是 clickable 节点**，
   但**目的地/行为没有任何证据** → 这里复刻可见结构，但不给它们编造行为：
   渲染为**不可交互**的静态元素，并记为
     GROUP_AVATAR_DESTINATION: NOT_EVALUATED
     GROUP_RIGHT_ACTION:      NOT_EVALUATED / OUT_OF_SCOPE
   宁可"看起来少一个可点反馈"，也不要造一个点了没反应或跳错地方的假入口。
```

   → 正确的是：它**不是**未报告的缺陷，而是**有记录的、已批准的决定**。
     注意与 WO#10 判据的**细微差别**：WO#10 消除的是"**可点击**但什么都不发生"的控件；
     这里渲染的是**不可点击**的静态元素（且 `aria-hidden`，不向辅助技术宣称可交互）——
     两者不同。**我第一版把两者混为一谈，属过度解读。**

| 项 | 原版基线 / dump | 我们的实现 | 判定 |
|---|---|---|---|
| 顶部结构 | dump（强证据）：`leftIcon(返回) / chatAvatar / title(群名) / rightIcon` | 同样四段结构 | ✅ 一致 |
| 顶部文案 | 基线写「顶部**昵称**」；dump 说 `title(群名)` 且"**不含成员数**" | `meta.title`（群名） | ✅ 与 **dump** 一致（基线的"昵称"措辞含糊，以 dump 为准） |
| 返回 | 「返回 → 上一页」 | 返回可用 | ✅ |
| 右侧 | clickable 节点，**行为无证据** | **不可交互**静态元素 + `aria-hidden` | ⚠️ 有意的、已批准的能力后撤（`GROUP_RIGHT_ACTION: NOT_EVALUATED`） |
| 头像 | clickable 节点，**行为无证据** | **不可交互**静态元素 | ⚠️ 同上（`GROUP_AVATAR_DESTINATION: NOT_EVALUATED`） |
| 底部 | 「输入框 + 表情 + 加号」 | 输入框 + 表情 + 选图 + **@** + 语音 + 更多 | ⚠️ 我们**多一个 @ 按钮** = WO#9B 的**我方设计入口**（`AT_PANEL_TRIGGER: OUR_DESIGN_CHOICE`）—— 已登记 |
| normal 态 | **unknown** | 显示真实消息 | ⚠️ `ORIGINAL_GROUP_NORMAL_STATE: NOT_EVALUATED` |
| **@面板入口位置** | **known_unknowns 明列"未知"** | `AT_PANEL_TRIGGER: ORIGINAL_BEHAVIOR NOT_EVALUATED` | ✅ **独立佐证**：项目自己的基线也没拿到入口 |

### 2.4 `at-panel`（WO#9B 目标）

```
baseline 内容**为空**：所有 states not_reproducible、interactions/navigation 均为 []、
blocked_reason = "deep link 无法直达；需要群聊上下文"
known_unknowns = ["面板以抽屉还是弹层出现、成员列表排序、搜索框有无"]
```

| known_unknown | 我们的处置 | 状态 |
|---|---|---|
| 抽屉还是弹层 | 从 **APK 静态布局**判定为**底部弹层**（`constraintBottom_to_BottomOf=parent`） | ✅ 已解决（换了证据来源） |
| 成员列表排序 | 明确标 `NOT_EVALUATED`，且**不把顺序写成 conformance** | ✅ 如实保留 |
| **搜索框有无** | ⚠️ 此前**未明确记录** → 本审计补上：<br>`recovered-m3-ui.xml` 全部可见文本只有「选择提醒的人」「所有人」；<br>**无 EditText、无"搜索"字样** → `AT_PANEL_SEARCH_CONTROL: NOT_OBSERVED_IN_THIS_DUMP` | ⚠️ **本审计补齐** |

## 三、新增纪律（写入 PLAN.md）

```
任何页面的 Gate 必须包含"**基线逐条核对**"层：
  ① 若 docs/original-baseline/screens/<screen>/baseline.json 存在：
       逐条核对 title / interactions / navigation，并对每条给出
         MATCH / DEVIATION(有意，含理由与批准记录) / NOT_EVALUATED
     有 xml dump 的以 dump 为准；只有 png 的标"线索级"
  ② 若 baseline.json 不存在或内容为空：
       必须**显式记录"该屏无可用基线"**，而不是跳过不提
  ③ 凡因**我方数据/能力不足**而移除或未实现的原版内容，
     必须登记为 **KNOWN_DEVIATION（有意后撤）**，
     不得只写"清理完成 / 已接线" —— 后者会掩盖与原版的差距
```

## 四、本审计产出的待办（已登记 NEXT-ACTIONS）

```
A. feed-list 的 3 处偏差 → 并入 WO#11 一起修（已获证据级基线支持）
B. message 屏：核对顶部标题与右上加号语义（基线说"加号 → 新建会话"）
C. group 屏：核对「顶部显示昵称还是群名」（基线措辞含糊）+ 右侧应为「更多」控件
D. 把 WO#10 的两处**有意的功能后撤**正式登记为 KNOWN_DEVIATION
E. 三条 NOT_EVALUATED 范围限制入库：
     ORIGINAL_NORMAL_LIST / ORIGINAL_MESSAGE_LIST_WITH_CONVERSATIONS / ORIGINAL_GROUP_NORMAL_STATE
F. 所有后续 WO 的 Gate 加"基线逐条核对"层（纪律已写入 PLAN.md）
```
