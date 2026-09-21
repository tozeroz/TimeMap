# WO#9B 计划：AT 面板 / @所有人（在真实群会话之上）

> 时间：2026-09-22 03:14｜Round 258｜依据：审核记录 44（"WO#9 拆 Group 基础与 AT"）、46（WO#9A CLOSED）
> 状态：**待审核批准**（先报计划，不动产品代码）

## 一、为什么现在可以做（前提已就绪）

```
WO#9A 已 CLOSED：真实群会话端到端打通（群在 /api/threads、成员能读能写、
                 非成员列表不可见 + 读 404 + 写 404 + 零 mutation）
→ 在**真实群会话**上实现 @所有人 才有意义（此前在纯 mock 群聊上做就是假实现，故顺延到此）
```

## 二、原版证据（只读、可采信，**已就绪**，无需重新取证）

来源：`aapt2 dump resources` + `xmltree`（APK sha256 `3373B6B2…D6C294` 已核验）
可复现：`scripts/m5/probe-at-panel-structure.sh`；整理见 `docs/m5/EVIDENCE-at-panel-structure.md`

### 2.1 面板骨架（`layout/activity_group_at_panel` → `res/XZ.xml`）

```
ConstraintLayout  id=0x7f0a0625  width/height=match  clickable=true
                   background=@android:…（系统半透明）        ← 全屏遮罩（点外部关闭）
└ ConstraintLayout id=0x7f0a01f4  width=match height=wrap
                    background=@0x7f0800be  clickable=true
                    **constraintBottom_toBottomOf=parent**     ← **底部弹层**（bottom sheet）
    ├ ImageButton  id=0x7f0a0119  contentDescription=@0x7f130102 = **"关闭"**  clickable
    ├ TextView     id=0x7f0a0786  **16sp / bold / gravity=center**
    │              text=@0x7f130077 = **"选择提醒的人"**
    ├ TextView     id=0x7f0a076d  **visibility=GONE**  text=@0x7f130075 = "暂无群成员"  margin=40dp
    └ RecyclerView id=0x7f0a05ec  **layout_height = 500dp（固定）**  paddingBottom=@0x7f0703df
```

### 2.2 「所有人」项（`layout/item_at_panel_at_all` → `res/KW.xml`）

```
ConstraintLayout  height = **88dp**   paddingStart/End = @0x7f0703df
  ├ ImageView id=0x7f0a038d  56dp × 56dp  src=@0x7f08029f
  │           contentDescription = @0x7f130074 = **"所有人"**
  └ TextView  id=0x7f0a0772  16sp  text = @0x7f130074 = **"所有人"**  marginStart=12dp（@0x7f0703d0）
```

### 2.3 其它成员项与分组标题

```
layout/item_at_panel_member           → 普通成员行
layout/item_at_panel_section_header   → **分组标题**（说明列表是**分组**的）
string/at_panel_empty                 = "暂无群成员"
string/at_panel_loading_failed        = "加载失败"
```

### 2.4 ⚠️ 明确**未取证**的部分（不实现、不猜）

```
· **面板的触发方式**：原版是"点某处打开"还是"输入 @ 自动打开"？—— **无证据**
    → AT_PANEL_TRIGGER: NOT_EVALUATED
    → 本单只做"我方提供可达入口"（具体位置标为设计选择），**不声称**与原版触发一致
· **分组的规则**（按什么分组：学院？首字母？在线状态？）—— **无证据**
    → AT_PANEL_GROUPING_RULE: NOT_EVALUATED
    → 结构上保留"分组标题"这一形态，但**不发明**分组依据；
      若无法在没有依据的情况下填内容，则**只呈现"所有人"项 + 成员平铺**，并在报告中说明
· **搜索/多选上限/置顶**等面板内交互 —— 无证据 → 不做
· **@某人后的消息渲染**（是否高亮、是否可点）—— 无证据 → 不做
```

## 三、⚠️ 数据模型：**我方设计决定**，不是"复刻"

AUDIT 里我方代码注释的担忧仍然正确：
> "绝不能伪造成某个 user id（那会让'提到全体'与'提到某人'在数据上无法区分）"

而**原版服务端如何表示"提到全体"未知**（需观察网络请求/服务端数据，只读范围内不可得）。

```
拟采用（**我方设计决定**，需审核批准）：
  messages 增加 **mentions_all boolean NOT NULL DEFAULT false**
  · @所有人 → mentions_all = true，且**不写任何 message_mentions 行**
  · 逐人提及仍走既有 message_mentions（两者**并存但不混同**）

约束（Gate 会机械验证）：
  ① mentions_all = true 时，该消息的 message_mentions 必须为 **0 行**
  ② **非群聊（direct）不允许 mentions_all = true** → 4xx
     （"全体"在两人会话里没有意义；且这是一种"语义不可能"的输入，应当拒绝而不是忽略）
必须标注：
  AT_ALL_SERVICE_REPRESENTATION: OUR_DESIGN_CHOICE / ORIGINAL_UNKNOWN
```

## 四、范围

```
做:
  1. 后端：messages.mentions_all 列（新迁移 011）+ 发消息接口接受并校验它 + 读模型返回它
  2. 前端：在**群聊页**（ChatScreen variant='group'）加 AT 面板：
       · 底部弹层（按 dump 的形态：全屏遮罩 + 底部锚定 + 关闭按钮 + 标题"选择提醒的人"）
       · 「所有人」项（行高 88dp→CSS px、图标 56dp、标签 16sp、图文间距 12dp）
       · 空态"暂无群成员"、失败态"加载失败"
       · 成员平铺（分组规则无证据 → 见 §2.4）
  3. 选中「所有人」→ 作为显式"全体提及"随消息发出（mentions_all=true）
  4. 面板的**可达入口**：我方设计选择（例如群聊 composer 的 "+" 面板内或输入 @ 触发），
     标注 AT_PANEL_TRIGGER: NOT_EVALUATED
不做（明确排除）:
  · ❌ 面板的分组算法（无依据）
  · ❌ @某人 的消息高亮/可点（无证据）
  · ❌ 群管理（建群/邀请/踢人/退群/改群名/群公告）—— 另立独立单
  · ❌ 群主/管理员角色（需迁移加列）
```

## 五、Gate（须可失败，沿用 REQUIRED 口径）

```
改前（当前状态，应 FAIL）:
  · "群聊页存在 AT 面板入口" → **FAIL**（当前没有）
  · "能发出 mentions_all=true 的消息" → **FAIL**（DB 无该列）

改后:
  AT_PANEL_ENTRY_REACHABLE     从**真实入口**（群聊页 → 入口 → 面板）可达（不设 hash）
  AT_PANEL_TITLE               标题逐字 == "选择提醒的人"
  AT_PANEL_KIND                是**底部弹层**（不是全屏页/居中弹窗）—— 按 dump 的 constraintBottom
  AT_ALL_ITEM_PRESENT          面板中存在「所有人」项
  AT_ALL_ITEM_GEOMETRY         行高/图标尺寸/字号与声明值一致（设备实测，单位冻结 CSS px）
  AT_PANEL_EMPTY_STATE         空群时显示"暂无群成员"（**client code-path PASS**，用 stub 验证，不声称真实服务器 E2E）
  MENTIONS_ALL_DB              DB oracle：发出后 mentions_all=true，且 message_mentions 行数 = **0**
  MENTIONS_ALL_NO_FAKE_ID      **反向断言**：不得出现"伪造的 user id"占位（既有纪律）
  MENTIONS_ALL_DIRECT_REJECT   direct 会话上 mentions_all=true → **4xx**，且 **DB delta = 0**
  MENTIONS_ALL_NONMEMBER       **非成员**在群里发 mentions_all=true → **404** + **零 mutation**
  MENTIONS_ALL_PERSISTENCE     reload 后仍带该标记
  COMPOSER_REGRESSION          text/image/voice 三条发送路径不受影响
  GROUP_REGRESSION             WO#9A 的 8 项设备 Gate + 12 项授权矩阵重跑全 PASS
  SERVER_REGRESSION            M5 gate 全绿（**并按新纪律重新部署 gate 脚本 + 校验哈希**）
SENSITIVITY:
  · 把 mentions_all 强制置回 false 的突变构建 → MENTIONS_ALL_DB 必须 FAIL；恢复 → PASS
身份 oracle：/api/auth/me + DB（**绝不用 CSS/class 自证**；且**必须用绝对 origin** —— 本项目已踩两次）
```

## 六、需要审核裁定

```
1. **是否批准 WO#9B**（范围见 §四）？
2. §三 的数据模型（mentions_all + 两条约束）是否认可？
3. §2.4 的两处"无证据"处理方式是否认可：
   · 触发方式 → 做"可达入口"并标 NOT_EVALUATED
   · 分组规则 → 不发明依据；若无依据可填，则**只呈现"所有人"项 + 成员平铺**并在报告中说明
4. "AT 面板触发方式"是否值得单列为一个**取证项**（例如未来若能做静态 binding trace，
   或许能追到它在哪个控件的 onClick 上）？还是就保持 NOT_EVALUATED？
```
