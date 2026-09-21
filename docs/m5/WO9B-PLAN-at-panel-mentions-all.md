# WO#9B 计划（修订版）：AT 面板 / @所有人 —— **两层分离**

> 时间：2026-09-22 03:19｜Round 260
> 修订依据：**审核记录 47**（要求把两层明确分开、并要求不得把"谁有权限 @所有人"偷偷定义成 conformance）
> 状态：**待审核批准**（先报计划，不动产品代码）

## 〇、⚠️ 本单**必须分成两层**（审核 47 明确要求）

```
A. AT_PANEL / mention selection UI      —— 面板呈现与"选谁"的交互
B. mentions_all persistence / semantics —— 数据模型、接口语义、权限、持久化

为什么要分开（审核 47 原话的意思）：
  原版"有一个 AT 面板"**只**证明 UI 存在；
  它**不**证明"所有成员都能 @所有人"，也不证明服务端怎么表示"全体"。
  把两层混在一个 Gate 里，最危险的后果是：
  **UI 层通过了，就顺带把"权限模型"也算作 conformance PASS** —— 而那根本没有证据。
→ 因此：**A 与 B 各自有独立的 Gate 与独立的状态键**，任一层的未知都不被另一层的 PASS 掩盖。
```

## 一、前提（已就绪，无需重新取证）

```
WO#9A 已 CLOSED：真实群会话端到端（群在 /api/threads、成员能读能写、
                 非成员列表不可见 + 读 404 + 写 404 + 零 mutation）
→ AT 不再是在 mock 页面上做假功能（这正是上一轮把它顺延的原因）
```

## 二、原版证据（静态 APK，可采信）

来源：`aapt2 dump resources` + `xmltree`（APK sha256 `3373B6B2…D6C294` 已核验）
可复现：`scripts/m5/probe-at-panel-structure.sh`；整理见 `docs/m5/EVIDENCE-at-panel-structure.md`

### 2.1 面板骨架（`layout/activity_group_at_panel` → `res/XZ.xml`）

```
ConstraintLayout  id=0x7f0a0625  width/height=match  clickable=true
                   background=@android:…（系统半透明）        ← 全屏遮罩（点外部关闭）
└ ConstraintLayout id=0x7f0a01f4  width=match height=wrap
                    background=@0x7f0800be  clickable=true
                    **constraintBottom_toBottomOf=parent**     ← **底部弹层**
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

### 2.3 其它

```
layout/item_at_panel_member           → 普通成员行
layout/item_at_panel_section_header   → **分组标题**（说明列表是**分组**的）
string/at_panel_empty                 = "暂无群成员"
string/at_panel_loading_failed        = "加载失败"
```

## 三、⭐ 审核 47 要求**先冻结的 5 个问题**（逐一给出立场与依据）

| # | 问题 | 本单立场 | 依据/状态 |
|---|---|---|---|
| 1 | `mentions_all` 是**独立 boolean**，还是 mention records 的一种特殊形式？ | **独立 boolean**（我方设计决定） | 既有 `message_mentions` 有 `UNIQUE(message_id, mentioned_user_id)` 且**外键指向 users(id)** —— 要表达"全体"只能塞一个**假的 user 行**，而那正是 AUDIT 里被明确否决的做法（"绝不能伪造成某个 user id"）。→ 因此用独立 boolean，与逐人提及**并存但不混同** |
| 2 | 非 group thread 是否**必须拒绝** `mentions_all`？ | **必须拒绝 → 4xx** | "全体"在两人会话里**语义不可能**（对方就一个人，与"提及某人"无法区分）。拒绝而非忽略：忽略会让调用方以为成功了 |
| 3 | ⚠️ **普通成员是否都能 @所有人，还是原版有 role restriction？** | **`AT_ALL_PERMISSION_MODEL: NOT_EVALUATED`** | **无证据**：`thread_members` 没有角色列，原版是否限制 @all 资格**从未被观察到**（要观察需要触发原版的 @all，而那是写操作 → `BLOCKED_BY_POLICY`）。<br>**→ 本单不定义"所有成员都能 @all"的规则**；实现上采用"当前**是该群成员**即可用"（这是与我方既有成员模型一致的**最小**选择），并**明确标注为我方设计选择，不是 conformance** |
| 4 | API 接收 `mentions_all` 后，**读模型如何返回**？ | 与既有 `mentions` 并列返回 `mentionsAll: boolean` | 读模型已有 `mentions` 字段（实测发消息响应含 `"mentions":[]`）；新增一个同级的布尔字段，语义清晰且不破坏既有消费者 |
| 5 | reload 后**是否仍保留**？ | **必须保留** | 它是**消息的持久属性**（存在 `messages` 列上），不是会话内临时状态；Gate 有 `MENTIONS_ALL_PERSISTENCE` |

> **审核 47 特别强调的那条**（第 3 问）原文意思：
> "不要因为原版存在 AT panel 就推断所有成员都具备 @all 权限"
> —— 已据此把它单列为 `NOT_EVALUATED`，并在实现里**只做最小选择 + 标注**。

## 四、明确**未取证**（不实现、不猜）

```
· **面板的触发方式**（点某处？输入 @ 自动开？）—— 无证据
    → AT_PANEL_TRIGGER: NOT_EVALUATED
    → 本单只做"我方提供可达入口"（位置是设计选择），**不声称**与原版触发一致
· **分组规则**（按学院？首字母？在线状态？）—— 无证据
    → AT_PANEL_GROUPING_RULE: NOT_EVALUATED
    → 结构上**不发明**分组依据；本单**只呈现「所有人」项 + 成员平铺**（不渲染 section header）
· **@所有人 的权限模型** —— 见 §三 第 3 问 → AT_ALL_PERMISSION_MODEL: NOT_EVALUATED
· **@某人 后的消息渲染**（是否高亮/可点）—— 无证据 → 不做
· 搜索 / 多选上限 / 置顶 —— 无证据 → 不做
```

## 五、范围（两层分列）

### 层 A：AT_PANEL / mention selection UI

```
A1. 在群聊页（ChatScreen variant='group'）加入口 → 打开 AT 面板
      · 入口位置 = 我方设计选择（AT_PANEL_TRIGGER: NOT_EVALUATED）
A2. 面板按 dump 复刻：
      · **底部弹层**（全屏遮罩可点关闭 + 底部锚定容器）
      · 关闭按钮（accessible name「关闭」）
      · 标题「选择提醒的人」（16sp bold 居中）
      · 空态「暂无群成员」、失败态「加载失败」
      · 列表高度固定 500dp（CSS px 同值）
A3. 「所有人」项（行高 88dp→CSS px、图标 56dp、标签 16sp、图文间距 12dp）
A4. 成员平铺（**不渲染** section header —— 分组规则无证据）
A5. 选中「所有人」→ 作为"全体提及"标记随消息发出
```

### 层 B：mentions_all persistence / semantics

```
B1. 新迁移 `011_mentions_all.sql`：messages 增加
      **mentions_all boolean NOT NULL DEFAULT false**
B2. POST /api/threads/:id/messages 接受 `mentionsAll`（默认 false）：
      · kind='group' 且调用者是成员 → 允许
      · **kind='direct' → 4xx**（拒绝，不是忽略）
      · 非成员 → 404（沿用既有语义）+ **零 mutation**
B3. 读模型返回 `mentionsAll`
B4. 两条机械约束（Gate 验证）：
      ① mentions_all=true 时 **message_mentions 必须 0 行**
      ② direct 上 attempts → 4xx 且 **DB delta = 0**
```

**不做（明确排除）**：群管理（建群/邀请/踢人/退群/改群名/群公告）、群主/管理员角色、
@某人 的消息渲染、面板内搜索/多选上限/置顶。

## 六、Gate（**两层各自的键，互不掩盖**）

```
改前（当前状态，应 FAIL）:
  · "群聊页存在 AT 面板入口" → **FAIL**（当前没有）
  · "能发出 mentions_all=true 的消息" → **FAIL**（DB 无该列）

层 A（UI）:
  AT_PANEL_ENTRY_REACHABLE     从**真实入口**（群聊页 → 入口 → 面板）可达（不设 hash）
  AT_PANEL_KIND                是**底部弹层**（按 dump 的 constraintBottom_to_BottomOf=parent）
  AT_PANEL_TITLE               标题逐字 == "选择提醒的人"
  AT_PANEL_CLOSE_CONTROL       存在 accessible name 为「关闭」的控件
  AT_ALL_ITEM_PRESENT          面板中存在「所有人」项
  AT_ALL_ITEM_GEOMETRY         行高/图标尺寸/字号与声明值一致（设备实测，**单位冻结为 CSS px**）
  AT_PANEL_EMPTY_STATE         空群显示"暂无群成员"（**client code-path PASS**：网络 stub 验证，
                               **不声称**真实服务器 E2E —— 当前种子群非空，不为此再造空账号）
  AT_PANEL_NO_INVENTED_GROUPING  **反向断言**：不得渲染无依据的 section header

层 B（语义）:
  MENTIONS_ALL_DB              DB oracle：发出后 mentions_all=true
  MENTIONS_ALL_NO_MENTION_ROWS  且 message_mentions 行数 == **0**（约束①）
  MENTIONS_ALL_NO_FAKE_ID      **反向断言**：不得出现"伪造的 user id"占位（AUDIT 既有纪律）
  MENTIONS_ALL_DIRECT_REJECT   direct 上 mentionsAll=true → **4xx** 且 **DB delta = 0**（约束②）
  MENTIONS_ALL_NONMEMBER       非成员在群里带 mentionsAll → **404** 且**零 mutation**
  MENTIONS_ALL_PERSISTENCE     reload 后仍带该标记
  MENTIONS_ALL_READ_MODEL      读模型返回该字段，且与 DB 一致

回归:
  COMPOSER_REGRESSION          text/image/voice 三条发送路径不受影响
  GROUP_REGRESSION             WO#9A 的 8 项设备 Gate + 12 项授权矩阵重跑全 PASS
  SERVER_REGRESSION            M5 gate 全绿 —— **并按新纪律：先部署当前 gate + sha256 校验 + 看账本行**

SENSITIVITY（受控突变）:
  · 把 mentions_all 强制置回 false → MENTIONS_ALL_DB 必须 FAIL；恢复 → PASS
  · 去掉 direct 的 4xx 拒绝分支 → MENTIONS_ALL_DIRECT_REJECT 必须 FAIL；恢复 → PASS

身份 oracle：/api/auth/me + DB（**绝不猜 localStorage key、绝不用 CSS/class 自证**）
Origin 前置：关键 API 调用**必须用绝对 origin**；**捕获到 text/html 直接 FATAL**
             （相对路径在 Capacitor WebView 会打到本地服务器并返回 HTML 200 —— 本项目已踩两次）
```

## 七、需要审核裁定

```
1. 是否批准 WO#9B（修订版：两层分离，见 §〇/§五）？
2. §三 的 5 个冻结问题立场是否认可？**尤其第 3 问**：
   我把它标为 AT_ALL_PERMISSION_MODEL: NOT_EVALUATED，实现上只做"是群成员即可用"的**最小选择**
   并明确标为我方设计选择 —— 这样处理可以吗？还是你要求连"入口对谁可见"也按未取证处理？
3. §四 的两处未取证处理（触发方式 → 可达入口 + NOT_EVALUATED；分组规则 → 不渲染 section header）
   是否认可？
4. 迁移编号：将新增 `011_mentions_all.sql`（既有 001–010 已校验和锁定，只追加）。确认吗？
```
