# 审核记录 42：**WO#7 批准**（附 Stage 0 前置）；合规拒绝被接受；新增两条纪律

> 审核方：ChatGPT web；时间：2026-09-22 02:02（Asia/Shanghai）
> 本轮提交：composer 只读取证 + WO#7 提案 + 合规问题（拒绝重新进入原版群聊）

## 一、⭐ 合规裁定：我的拒绝被**正式接受**

```
ORIGINAL_CHAT_DYNAMIC_REENTRY: **BLOCKED_BY_POLICY**
reason:
  side-effect-free entry is not established;
  opening the conversation may mutate read state.
```

审核原话：
> "你的停止判断是对的。进入会话页可能触发 read-state / 已读回执之类的服务器 mutation，
>  而你目前无法证明 `进入 GroupForEvidence → zero server-side mutation`。
>  '消息都是自己发的''GroupForEvidence(1) 也许只有一个成员'都不足以把这个风险降成事实。
>  **我不授权把'标记自己发出的消息已读'视为例外**，因为我们连是否只有自己一个真实成员都不知道。"

**当前唯一被认可的无写路径**：
```
APK 静态布局 + 静态代码/binding 追踪 + 既有 admissible raw evidence
```
审核另提到一个将来可选但"重得多"的方案：完全离线的可丢弃 emulator snapshot
（采集后直接丢弃、绝不在该状态重新联网）—— 明确说 **WO#7 没必要为此做**。

## 二、WO#7：批准，但必须先做 Stage 0

```
WO7_TEXT_MESSAGE_SEND_PATH: **APPROVED**
```

批准理由（缺口明确）：
```
CURRENT:  用户可以输入 draft，但没有任何 UI 路径调用 postThreadMessage(text)
SERVER:   纯文本 message API 已长期验证可用
ORIGINAL: composer 中声明有 sendBtn
```

### 2.1 Stage 0（开产品代码**之前**的前置）

> "我不会直接批准你现在推断的：有文字 → sendBtn 出现 / emojiBtn + plusBtn → ?
>  因为 **sendBtn GONE 只证明默认声明状态，不证明它由什么条件切换**。
>  既然 APK 已经在手，直接追 R.id.sendBtn / R.id.inputTextView / R.id.emojiBtn / R.id.plusBtn，
>  看 adapter/controller/TextWatcher 中：谁给 sendBtn 设置 click listener；哪些条件 VISIBLE/GONE；
>  draft 变化时是否切换；emoji/plus 是否同时隐藏。这仍是纯本地只读取证。"

**两种结局**：
```
若追到（如 text non-empty → sendBtn VISIBLE → plus/emoji GONE）
   → 升级为**正式 conformance contract**，再完全照做
若混淆导致追不到
   → TEXT_SEND_FUNCTIONALITY: IMPLEMENT
     COMPOSER_EXACT_VISIBILITY_STATE: **NOT_EVALUATED**
   → **不要为了填状态机而猜**
```

### 2.2 ✅ Stage 0 实际结果（本次已完成，纯本地只读）

脚本 `scripts/m5/probe-wo7-stage0-binding.mjs`（扫 5 个 dex 的**字符串池**）：
```
classes.dex  : ImInputBoxBinding ×1（邻近字符串含 "binding"）、ImInputBox ×1
classes3.dex : sendBtn ×5、inputTextView ×1、emojiBtn ×1、plusBtn ×2、
               voiceIv ×1、chat_voice_bar ×1、plusRedDot ×1、quoteViewStub ×1、
               ImInputBoxBinding ×1、ImInputBox ×1、im_input_box ×1
classes4.dex : plusBtn ×2
classes2/5   : 未命中
```

**结论（按声明强度写）**：
```
SEND_BTN_BINDING_EXISTS:            **STRONGLY_SUPPORTED**
  判据：dex 里同时出现 ImInputBoxBinding 类名与 sendBtn/inputTextView 等字段名
        → 原版用的是 **ViewBinding**（类名由 layout 名生成），
          并非"名字恰好出现"（邻近字符串还含 binding）
COMPOSER_EXACT_VISIBILITY_STATE:    **NOT_EVALUATED**
  原因：字符串池里**没有**方法体；"什么条件切 VISIBLE/GONE" 需要反汇编才能读。
  按审核 42：**不猜**。
```

⚠️ 本脚本的方法边界（已写进脚本注释）：命中/未命中都只覆盖**字符串池**这一层；
未命中**不等于**不存在绑定（可能被混淆或内联）。

### 2.3 回车发送：**不要做**

```
ENTER_TO_SEND:        NOT_IMPLEMENTED
ORIGINAL_BEHAVIOR:    NOT_EVALUATED
```
> "没有原版证据，而且移动端聊天输入框的 Enter 很可能对应：换行 / IME action / 或发送；目前未知。
>  不要扩功能面。"

### 2.4 WO#7 Gate（审核给定的断言清单）

```
TEXT_SEND_ENTRY:        非空 draft **存在可达发送入口**
TEXT_SEND_FUNCTIONAL:   点击发送 → exactly one POST → DB messages delta = +1
                        → kind = text → body = 输入的原文
                        → sender = current session user → **no message_media row**
TEXT_SEND_PERSISTENCE:  reload 后消息仍存在
TEXT_SEND_FAILURE:      服务端失败 → 明确错误 → DB delta = 0 → no ghost bubble
                        → **draft 不因失败而静默丢失**
COMPOSER_REGRESSION:    image send still works；voice send still works
SERVER_REGRESSION:      M5 gate PASS
```
**身份 oracle**：继续用 `/api/auth/me` + DB，**不要用 CSS/class 自证**。

⚠️ 关于"空输入不得显示发送按钮"：
> "在 Stage 0 之前，**不要先写成最终原版契约**。目前它只是从 layout default 推出来的。"
→ 若 Stage 0 确认了按钮切换规则，才把 `EMPTY_DRAFT → sendBtn GONE` /
  `NONEMPTY_DRAFT → sendBtn VISIBLE` 加入 conformance Gate。

## 三、⭐ 一条重要的**证据分层原则扩展**（值得长期保留）

> "不一定非得有新的 runtime 渲染截图；**直接的静态 binding/code evidence 也可以替代 runtime evidence**。
>  **只有 resource/layout declaration 不够。**"

**即三档强度**：
```
1. resource / layout **declaration**        → 最弱（只能证明"声明了"）
2. 静态 **binding / code evidence**          → 可替代 runtime evidence（本次 SEND_BTN_BINDING_EXISTS 属此档）
3. runtime **rendered / behavioral** evidence → 最强
```
→ 这解释了我本轮为什么"static 取证"能推进：不是因为我只做了 1，而是因为做到了 2。

**其它 composer 候选（审核确认本轮不动）**：
```
composer 高度（134 vs 96）：群聊 vs 单聊存在未排除 confounder → 不改
voiceIv 切换模型：只有布局 GONE + constraint，不足证明交互状态机 → 等 binding trace / runtime evidence
emoji/plus 精确尺寸与顺序：声明值可记录，但不必据此立即改当前产品
plusRedDot / quoteViewStub：**存在性不等于需要当前状态显示**，更不能驱动实现
→ 继续留在 evidence backlog
```

## 四、⭐ 新增高层 Gate：`COMPOSER_CAPABILITY_COVERAGE`

> "你总结得很准确：WO#2 验证图片发送；WO#5 验证语音发送；服务端 Gate 验证 text API；
>  但**从来没人问'用户在 App 里能不能发文字'**。
>  建议以后增加一个更高层的 `COMPOSER_CAPABILITY_COVERAGE` ——
>  不是每次都把所有功能完整重跑，而是**机械列出当前产品声明支持的消息类型**：
>      text  → reachable user path
>      image → reachable user path
>      voice → reachable user path
>  如果 API 支持某个核心 capability、UI 也声称是聊天 composer，却没有用户入口，
>  就应暴露为 **coverage gap**。
>  这是'垂直 slice 都绿，但横向产品能力缺了一块'的典型情况。"

**这条要实现的**（下一步工程项）：在 gate 里加一个机械检查 ——
对 `message kind` 枚举（text/image/voice）× "是否存在可达的 UI 发送入口" 做覆盖矩阵。

## 五、最终裁定

```
ORIGINAL_CHAT_DYNAMIC_REENTRY:  BLOCKED_BY_POLICY（我的拒绝被接受）
WO7_TEXT_MESSAGE_SEND_PATH:     APPROVED
  前置：Stage 0 静态 binding trace（**本次已完成** → SEND_BTN_BINDING_EXISTS: STRONGLY_SUPPORTED；
        COMPOSER_EXACT_VISIBILITY_STATE: NOT_EVALUATED）
ENTER_TO_SEND:                  DO NOT IMPLEMENT
其它 composer 候选:              NO PRODUCT CHANGE（等 runtime 或直接静态行为证据）
```
