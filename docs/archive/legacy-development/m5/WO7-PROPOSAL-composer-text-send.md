# 原版会话页 composer 只读取证 + **我方文字消息发送路径缺失**（WO#7 提案）

> 时间：2026-09-22 01:54｜依据：审核记录 41 给的下一步顺序（群聊 composer 只读取证优先）
> 方法：**全部只读**，且**没有对原版做任何新的设备操作**（见 §七"为什么没用设备采集"）

## 一、证据登记（candidate raw evidence）

### 1.1 权威证据：原版 APK 的 composer 声明布局（**静态、零设备交互**）

| 项 | 值 |
|---|---|
| 来源 | `.mumu-capture/apk/target.apk` |
| sha256 | `3373B6B2FBC997919398543DBBC59546172376BEEDEE87312154EBA095D6C294`（**已核验与基线一致**） |
| 布局资源 | `layout/im_input_box` → 混淆路径 **`res/P9.xml`** |
| 取得方式 | `aapt2 dump resources` 定位 → `aapt2 dump xmltree --file res/P9.xml` |
| 可复现 | 是（脚本化见 §八） |

**声明结构（逐节点，来自 xmltree + 资源 ID 解析）**：

```
merge
└ LinearLayout(orientation=vertical)
  └ com.xingin.ui.roudview.RoundConstraintLayout   id=msgLayout
      ├ ImageView            id=voiceIv       21dp×21dp  **visibility=GONE**  src=im_chat_voice_ic
      ├ RichEditTextPro      id=inputTextView  hint="发消息…"  maxLength=300  textSize=16sp
      ├ TextView             id=chat_voice_bar **GONE**  text="按住说话"
      ├ ImageView            id=emojiBtn      28dp×28dp  src=im_select_emoji
      ├ Guideline            id=line
      ├ ImageView            id=plusBtn       32dp×32dp  src=red_view_ic_plus_with_circle
      ├ View                 id=plusRedDot    8dp  **GONE**
      ├ ImageView            id=sendBtn       56dp×36dp  **GONE**  src=ic_send_msg_btn
      ├ ViewStub             id=quoteViewStub layout=im_chat_page_quote_layout
      └ FrameLayout          id=topInputContainer **GONE**
  └ com.kairuotu.chat.input.ChatPageBottomOperateView  id=panel
```

**约束关系（关键，来自 constraint 属性）**：
- `inputTextView` 有 `layout_constraintStart_toEndOf=voiceIv` 与 **`layout_goneMarginStart=0dp`**
  → **当 voiceIv 隐藏时输入框贴父容器左缘；当 voiceIv 显示时输入框排在它右边**
  → 这是一个**两态切换**的写法，不是"常驻按钮"
- `voiceIv` 与 `chat_voice_bar` 默认都是 `visibility=2`（GONE）
- `sendBtn` 默认 `visibility=2`（GONE），尺寸 56dp×36dp
- `plusRedDot`（8dp）默认 GONE —— "+"上的小红点

### 1.2 已入册的渲染证据（渲染态，来自只读 dump）

`docs/test/original-baseline/screens/original-chat/20260921-205407-04-chat-open.xml`
（2026-09-21 20:54 采集，只读；同一目录 INDEX.md 已说明其消息内容的来历）

该帧**实际渲染**出来的 composer：

| 节点 | resource-id | bounds（设备 px） |
|---|---|---|
| 容器 | `inputBox` | x=[0,1080] y=[1786,1920]（高 **134**） |
| 内层 | `msgLayout` | x=[21,1059] y=[1786,1906] |
| 输入框 | `inputTextView` | x=[63,885] y=[1811,1881] |
| 表情 | `emojiBtn` | x=[899,948] y=[1822,1871]（**50×50**） |
| 加号 | `plusBtn` | x=[968,1024] y=[1818,1874]（**56×56**） |

→ **渲染时只有 3 个可见控件**（输入框 / 表情 / 加号）；
`voiceIv`、`chat_voice_bar`、`sendBtn` 都因默认 GONE 而未出现。
**声明结构 ≠ 渲染结果** —— 两者都要留，且不能互相替代。

### 1.3 误拍截图登记（审核 41 要求的 ①）

| 项 | 值 |
|---|---|
| 文件 | `tools/tmp/wo6-tabbar.png` / `wo6-tabbar2.png`（65.9 / 65.3 KB，2026-09-22 01:43–01:44） |
| 当时前台 Activity | `com.kairuotu.campus/...chat.conversation.GroupChatActivity` |
| 入口条件 | 之前只读观察留下的会话页（**非本次有意采集**） |
| 可见文本样本 | `GroupForEvidence(1)` / `10:24` / `@` / `发消息…` |
| `VISUAL_TARGET_VALIDITY` | 当时**未做该检查**（该纪律是事后才冻结的），故本帧**只能作线索** |
| 处置 | **登记为 candidate raw evidence，不单独驱动任何产品改动**（照审核 41 明确要求） |

## 二、claim-level 对比：原版 vs 我方（同量纲 = 设备 px）

我方用 `scripts/m5/measure-composer.mjs` 实测（CDP + `getBoundingClientRect` × dpr 1.75）：

| 维度 | 原版（声明结构） | 原版（渲染态，dump） | 我方（实测） |
|---|---|---|---|
| composer 高 | —— | **134** | **96** |
| 可见控件数 | 9 个声明（含 4 个 GONE） | **3** | **5** |
| 顺序 | `voiceIv,input,chat_voice_bar,emojiBtn,plusBtn,sendBtn,…` | `[输入框][表情][加号]` | `[表情][输入框][选图][麦克风][加号]` |
| **发送按钮** | **`sendBtn` 56×36dp（有，默认 GONE）** | 未渲染（无文字输入） | **完全没有** |
| 语音入口 | `voiceIv` 21dp（GONE）+ `chat_voice_bar`"按住说话"（GONE） | 未渲染 | **常驻"按住说话"按钮** |
| 表情按钮 | 28dp | 50×50 | 22 CSS px |
| 加号按钮 | 32dp | 56×56 | 22 CSS px |
| "+"红点 | `plusRedDot` 8dp（GONE） | 未渲染 | 无 |
| 引用/回复条 | `quoteViewStub` | 未渲染 | 无 |

## 三、⭐ **已确证的真实功能缺口（不是几何差异，是功能缺失）**

```
我方 ChatScreen：
  draft 只用于 input 的 value / onChange —— **draft 从未被发送**
  全屏只有两种发送：postThreadImageMessage（图片）、postThreadVoiceMessage（语音）
  client.ts 的 postThreadMessage（kind 默认 'text'）**存在但从未被 UI 调用**
→ **我方 demo 的会话页发不出文字消息**：输入框可以打字，但没有发送按钮、没有回车发送。
```

**证明强度（逐条核对审核给的三条件）**：

| 条件 | 证据 |
|---|---|
| ① 原版证据强且可复现 | 原版**声明了 `sendBtn`**（56×36dp，`ic_send_msg_btn`）——静态布局，可复现；原版渲染 dump 亦显示输入框可输入 |
| ② 缺失可确证 | 我方实测：composer 5 个子控件里**没有任何 send 控件**；源码 `draft` 无发送调用；CSS 无 send 类 |
| ③ 修法语义明确 | 服务端 `/api/threads/:id/messages` 已支持纯文本（回归断言 `T1 纯文本 → 201` 长期在 gate 里）；客户端只需接上 |

**这是最高频用户路径上的缺口**（在会话页打字发送），比任何几何微调都重要。

## 四、其它偏差候选（**本轮不下结论、不驱动实现**）

| 候选 | 证据状态 | 为什么暂不报 |
|---|---|---|
| 语音入口模型：原版是 `voiceIv` **切换** + `chat_voice_bar`"按住说话"条；我方是**常驻**按住说话按钮 | 声明结构明确，但**渲染态未观察到**（该态需要触发切换才能看到） | 缺"切换后长什么样"的渲染证据 → 需 RENDERED evidence |
| composer 高度 134 vs 96 | 两侧各有 1 帧 | ⚠️ 原版 dump 是**群聊**、我方测的是**单聊**，`chat type` 是未排除的混淆因素 |
| 控件数量/顺序（我方多出"选图""麦克风"，且表情在输入框左侧） | 同上 | 同上（chat type 混淆）+ 需先定 WO#7 的修法边界 |
| 尺寸（原版 emoji 28dp / plus 32dp；我方统一 22 CSS px） | 声明 dp 已知 | 单位换算需密度确认；且属"视觉精修"，排后 |
| `plusRedDot` / `quoteViewStub`（引用回复） | 声明存在，渲染态未出现 | 无行为证据（何时出现、如何交互）→ 按纪律**不实现** |

**⚠️ 混淆因素如实登记**：原版的可复核渲染 dump 来自**群聊**；我方对照页是**单聊**。
原版账号**只有这一个会话**（群聊），要造单聊必须再写一次 → **BLOCKED_BY_POLICY**。
因此"群聊 vs 单聊是否共用同一 composer"这一点**无法用现有只读手段消除**，
所有涉及**渲染态几何**的对比都必须带上这个限定。

## 五、WO#7 提案（**待审核批准**，先不动产品代码）

**主题：会话页补齐"文字消息发送路径"（按原版 `sendBtn` 的呈现语义）**

```
范围:
  1. 输入框有内容时，composer 右侧出现**发送按钮**（原版：sendBtn 56×36dp，默认 GONE）
     —— 原版"没有文字时显示表情+加号、有文字时显示发送"这一**切换关系**由
        `sendBtn` 默认 GONE + `emojiBtn`/`plusBtn` 常显 推断，属**结构证据**，
        渲染态（输入文字后）**未观察到** → 需在实现前明确标注该推断强度
  2. 发送调用 postThreadMessage({ body, kind: 'text' })
  3. 回车发送（桌面/模拟器键盘场景）—— **可选**，原版无此证据，实现前需审核裁定
  4. 失败时明确提示（沿用既有 sendErr 机制），不得静默
Gate（须可失败）:
  · 改前：断言"存在可点的发送控件"必须 **FAIL**（当前确实不存在）
  · 改后：输入文字 → 断言出现发送控件 → 点击 → 断言服务端新增 1 条 kind='text' 消息（DB oracle）
  · 反向断言：空输入时**不得**显示发送按钮（对齐原版 sendBtn 默认 GONE）
  · 回归：既有图片/语音发送路径不受影响；M5 server gate 全绿
不做（本单明确排除）:
  · 不改语音入口模型（voiceIv 切换语义渲染证据不足）
  · 不加 plusRedDot / quoteViewStub（无行为证据）
  · 不改尺寸（单位换算与 chat type 混淆未消）
```

## 六、审计这条缺口为什么此前没被发现（复盘）

- WO#2 处理的是**图片发送**，WO#5 处理的是**语音发送** —— 两次都只测了各自的那条路径
- 而"**文字**发送"从未被任何工作单覆盖：`verify-message-media.sh` 的 T1 测的是**服务端**接受纯文本，
  属 **API 层**；**客户端 UI 有没有发送入口**不在任何 Gate 的断言范围内
- → 这是"**Gate 只覆盖了被立项的那条路径**"的典型盲区。
  教训：新增**发送类**能力时，应同时断言"**composer 上存在的每一种发送入口都能真正发出消息**"，
  而不只是断言"这条新路径能发出去"。

## 七、为什么本轮**没有**对原版做设备采集（合规判断，如实记录）

审核 41 建议"再通过合规的只读路径重新进入群聊，专门采一套 composer 截图 + UI dump"。
我**没有执行**，原因是发现了一个此前未被我证明的假设：

```
进入会话页在多数 IM 中会触发"标记已读" —— 那是一次**服务端写**。
我原先的论证是"该群 2 条消息全由本账号自己发出，标记自己发的消息为已读是空操作"，
但群名 `GroupForEvidence(1)` 里的 `(1)` **含义不明**（可能是"1 个成员"，也可能是"1 条未读"）。
若群内存在**其他真实成员**，则该写会影响到他人。
→ **无法只读地证明"不存在其他成员"**，因此按纪律**不执行**可能有写的动作。
```

**替代方案（本轮实际采用，且证据更强）**：
- **静态 APK 分析**：`aapt2` 读 composer 的**声明布局** —— 零设备交互、零写入风险，
  且对"composer 声明了哪些控件"比截图更**权威**（截图只反映某一帧的可见状态）
- 复用**已入册**的只读渲染 dump（2026-09-21 采集）
- 我方一侧用 CDP 实测

若审核认为"渲染态必须有新采集"，请**先裁定 §七 的合规问题**（或指定一个不含写副作用的入口路径）。

## 八、可复现脚本

```
# 定位布局资源与其混淆路径
aapt2 dump resources <apk> | grep -A1 'layout/im_input_box'
# 读 composer 声明结构
aapt2 dump xmltree --file res/P9.xml <apk>
# 解析其中资源 ID 的真实名字（脚本已入库）
tools/tmp/resolve-composer-ids.sh          # 待移入 scripts/m5/
# 我方 composer 实测
node scripts/m5/measure-composer.mjs
# 采集前的目标身份校验（审核 41 冻结的纪律）
scripts/m5/preflight-capture.ps1 -ExpectPackage com.campusx.demo
```
