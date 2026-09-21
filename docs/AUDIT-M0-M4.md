# 全局收口审计（M0–M4）

> 时间：2026-09-21 16:10（Asia/Shanghai）
> 性质：**只汇总已有证据**，不新增结论、不扩张范围。
> 目的：给后续 M5（逐页收敛到 1:1）一个完整视角，避免建立在不完整认知上。

## 一、各阶段 Gate key 总表

| 阶段 | key | 结果 | 备注 |
|---|---|---|---|
| M0 | Nginx `/health` 网关证据 | PASS | 公开可达 `http://8.148.156.146/health` |
| M1 | `BACKEND_RESULT` | PASS | 垂直切片：经 Nginx 写 → 读回 → 直查 PG |
| M1 | `SEED_RESULT` | PASS | seed 幂等 + canonical + 收敛性 |
| M2 | `AUTH_RESULT`（历史） | PASS | 见 `docs/m2/`；M2 历史可复现性已收口 |
| M2 | `BACKUP_DRILL_RESULT` | PASS | **仅 DB**；从 M4 起不代表完整业务数据恢复 |
| M2 | `TLS_SERVER_RESULT` | PASS | SAN/链/错误 CA/地址不匹配/TLS 版本/日志不泄漏 token |
| M3 | `M3_FINAL_GATE_RESULT` | PASS | 三层全 PASS（当前 HEAD 重跑） |
| M3 | `M3_PRECONDITION_RESULT` | PASS | 审计前置（M0 基线完整性 + 工作区清洁） |
| M3 | `M3_SLICE0B/1/2/3/4_GATE_RESULT` | PASS | 六个 slice key 全 PASS |
| M3 | `AUTH_OTP_RESULT` | PASS | phone+OTP、HMAC、dev sink 不进日志、密码登录已退休 |
| M3 | `COMMENTS_RESULT` | PASS | 20 条：计数含回复、层级、replyTo |
| M3 | `LIKES_RESULT` | PASS | 26 条：幂等、跨用户隔离 |
| M3 | `PUBLISH_RESULT` | PASS | 26 条：作者只来自会话、四种注入全拒 |
| M3 | `DEVICE_PUBLISH_RESULT` | PASS | 设备端闭环（无 session 夹具） |
| M3 | `PLACES_RESULT` | PASS | 含同名歧义 closeout（0→NULL / 1→bind / >1→NULL） |
| M3 | `SLICE4_POIDETAIL_CONFORMANCE` | PASS | 与可采信只读证据一致 + 反向断言 |
| M3 | `CLEANUP_RESULT` | PASS | 定向清理；canonical 未变 |
| M4 | `M4_FINAL_GATE_RESULT` | PASS | 三层全 PASS（当前 HEAD） |
| M4 | `M4_STORAGE_GATE_RESULT` | PASS | 五 key 全 PASS |
| M4 | `MEDIA_SCHEMA_RESULT` | PASS | 29 条（DB 级 cross-scope 防线 / 授权复用 / 幂等键） |
| M4 | `MEDIA_UPLOAD_RESULT` | PASS | 26 条（内容嗅探 / 路径穿越 / 幂等 / 磁盘与体积） |
| M4 | `MEDIA_DELIVERY_RESULT` | PASS | 22 条（命名空间隔离 / X-Accel / 撤回后不可读） |
| M4 | `M4_BACKUP_RESTORE` | PASS | 含 `DATABASE_RESTORE` / `MEDIA_STORE_RESTORE` / `CROSS_REFERENCE_INTEGRITY` |
| M4 | `MEDIA_ORPHAN_CLEANUP` | PASS | dry-run 不删 + 阈值保护 + 不碰被引用文件 |
| M4 | `SLICE_A_DEVICE_RESULT` | PASS | 6/6（blob 加载、凭据不进 URL、登出取不到、blob revoke） |
| M4 | `MESSAGING_API_RESULT` | PASS | 13 条（成员/非成员/未登录/撤回一致性） |
| M4 | `MENTIONS_RESULT` | PASS | 13 条（mention 成员/非成员/自己/去重） |

## 二、两维覆盖率（沿用审核记录 13 的口径）

```
BASELINE_PAGE_COVERAGE:  22 / 22 observed      （原版页面"看到过"）
CONFORMANCE_EVIDENCE:
  admissible:   poi-detail、登录页、schools/校区、map、message、feed-detail、
                发布页结构、点赞展示规则、message-board
  inadmissible: at-panel、media-preview、群聊页、comment-detail 的层级部分
  blocked:      点赞切换、发布后反馈、评论写入因果、原版 @ 提及关系（BLOCKED_BY_POLICY）；
                验证码页视觉（BLOCKED_BY_ETHICS）
```

> `22/22 observed` **不等于** `22/22 strict 1:1 verified`。

## 三、已知偏差与未评估项清单（M5 的输入）

| 项 | 状态 | 原因 |
|---|---|---|
| `OTP_UI_VISUAL_CONFORMANCE` | NOT_EVALUATED | 验证码页无原版证据；取证会给真实号码真发短信（BLOCKED_BY_ETHICS） |
| `AT_PANEL_VISUAL_CONFORMANCE` | NOT_EVALUATED | 证据依赖第三方写操作（INADMISSIBLE） |
| `MEDIA_PREVIEW_VISUAL` | NOT_EVALUATED | 同上 |
| `MEDIA_UPLOAD_AND_SEND_TRANSITION` | BLOCKED_BY_POLICY | 必须发图片才能观察 |
| 点赞切换 / 已点赞态 | BLOCKED_BY_POLICY | 必须点赞才能观察 |
| 发布后的反馈/跳转/动画 | BLOCKED_BY_POLICY | 必须发布才能观察 |
| 原版 `@` 提及模型 | NOT_EVALUATED | at-panel 证据 INADMISSIBLE，不反向推断 |
| 手机号定位 | DEVIATION | demo 不申请定位权限，用校区坐标作参照（`DISTANCE_FUNCTIONAL: PASS` 但 `REAL_DEVICE_GEOLOCATION_CONFORMANCE: DEVIATION`） |
| 图片压缩/重编码 | 未做 | 服务器 396MB + 无 native 图像库；上传只做结构校验与体积上限 |
| `@所有人` | 未实现 | 明确不做（避免与"提到某人"在数据上无法区分） |
| 语音消息 | 未实现 | 原版有语音；M4 只做 text/image/voice 三种 kind 中的前两者落地 |
| per-user 配额 | 未做 | V1 不限制；记为已知限制（单账号可占满盘） |
| `board_notes` | 建模完成、未做前端 | 模型结论 SUPPORTED（用户对用户私密留言） |

## 四、这份审计的用途

M5 若按"逐页与原版比对"推进，需要的正是第三节这张表：
**哪些页可以声称一致、哪些必须标 NOT_EVALUATED、哪些是策略阻断**。
把这三种状态混在一起，会重演"22/22 observed 被误读成 22/22 verified"的老问题。

---

## 附：M5 deviation 登记 —— 底部 tab 数量（2026-09-21）

### 偏差

| 项 | 原版（可复核 dump） | 我们的实现 | 结论 |
|---|---|---|---|
| tab 项数 | **3** | **3** | ✅ **一致**（本节的"4 项"结论已于 2026-09-22 **撤回**，见下方更正） |
| 具体项 | `<当前账号昵称>` / `校园` / `地图` | `<当前账号昵称>` / `校园` / `地图` | ✅ 一致 |

> ### ⚠️ 2026-09-22 更正：本节原结论 **"原版 4 个 tab（含校园广场）"** 已撤回
>
> **本节原先自己写着**"raw_evidence → observation"，却违反了该链条最基本的要求：
> **没有读 bounds**。实际把带 bounds 的原始 dump 逐节点读出来后（同一份
> `raw-dumps/board-observation-1.xml`，本节自己引用的证据）：
>
> ```
> text='校园广场'     bounds=[28,130][116,157]     ← y=130..157  → **顶部标题区**
> text='自定义名称6'  bounds=[100,249][1829,1868]  ← 底部
> text='校园'         bounds=[360,414][1829,1868]  ← 底部
> text='地图'         bounds=[572,626][1829,1868]  ← 底部
> ```
>
> **底部（y≥1750）恰好 3 项**，没有第 4 项。「校园广场」是**顶部标题**，
> 被本节当成"底部第一个 tab"数了进去 —— 这正是本项目反复记录的
> "**只数节点、不看 bounds**"错误（与本文件其它地方点名的同类错误同源）。
>
> 另外本节称 `message-board-dump.xml`"同样可见 4 项"也不成立：
> 那是**留言板**页，其底部（y≥1750）的 text 节点是
> `留言仅双方可见`（输入框占位）与 `留言`（按钮），与底部 tab 无关。
>
> **结论**：`TAB_ITEM_COUNT_CONFORMANCE = 一致（3 vs 3）`；
> `缺失「校园广场」tab` 这条**不存在**，不是 1:1 缺口。
> 旧结论（"三项"）**无需被 supersede** —— 反倒是"四项"这个 supersede 本身是误判。
>
> **纪律**：本节的教训值得单独记 ——
> **"引用了 raw_evidence" ≠ "读了 raw_evidence"**。
> 判定几何/结构类结论时，**必须把 bounds 读出来**，不能只数节点名。


### 证据链（按审核记录 21 要求的 `raw_evidence → observation → conclusion → impact`）

> ⚠️ **本节原始版本违反了它自己声称遵循的链条 —— 记在此处作为反面教材。**
> 它写了 raw_evidence、observation、conclusion、impact 四段，
> 但 **observation 段没有读 bounds**，因此把顶部标题「校园广场」当成了底部第 4 个 tab。
> **"引用了 raw_evidence" ≠ "读了 raw_evidence"。**

- **raw_evidence**：`docs/original-baseline/raw-dumps/board-observation-1.xml`
  （拉起原版后 uiautomator dump，纯只读；已入库可复核）
- **observation（2026-09-22 重读，含 bounds）**：
  ```
  y≥1750（底部导航区）的 text 节点恰好 3 个：
      text='自定义名称6'  bounds=[100,249][1829,1868]
      text='校园'         bounds=[360,414][1829,1868]
      text='地图'         bounds=[572,626][1829,1868]
  「校园广场」的实际位置：
      text='校园广场'     bounds=[28,130][116,157]   ← y=130..157，**顶部标题区**
  ```
- **conclusion**：
  - 原版底部 tab = **3 项**（`<当前账号昵称>` / 校园 / 地图）→ **与我方一致，无缺口**
  - 第二项是**当前账号昵称**派生（本例昵称「自定义名称6」）
  - 「校园广场」是**页面标题**（该页即"校园广场"页 / feed 页），不是 tab
  - **原"4 项"结论撤回**；原"三项"结论**是正确的那一个**，无需被 supersede
- **implementation impact**：**无**。`app/src/components/TabBar.tsx` 的 3 项是正确的，
  **不需要**补「校园广场」tab。
- **附带的真实发现（有价值，另立）**：原版该页**标题就是「校园广场」**，
  可用于核对我们的 feed 页标题文字是否一致（属 (A) 类呈现比对，见 §7.4 第 1 项）。

### 处置（2026-09-22 更正后）

- ❌ **不实现**补 tab（前提已被证伪）
- ✅ 撤回本节原结论，并在本文件 §7.3/§7.4、`TabBar.tsx` 注释中保持一致
  （不得再出现"原版四个 tab"的说法）
- ✅ 把本节作为**方法论反面教材**保留：几何/结构结论**必须读 bounds**
- ⏳ 把"原版该页标题=「校园广场」"纳入 (A) 类呈现比对清单

---

## 附二：校园广场页的呈现模型（只读观察，2026-09-21）

### raw_evidence

`docs/original-baseline/raw-dumps/board-observation-1.xml`（拉起原版后直接 dump，纯只读，已入库）

### observation（从 dump 读出的控件结构）

```
com.kairuotu.campus:id/collageView                 ← 拼贴容器
com.kairuotu.campus:id/view_image_container        ← 图片卡片
com.kairuotu.campus:id/view_image_bg
com.kairuotu.campus:id/view_image_stroke
com.kairuotu.campus:id/view_user_tag               ← 图片上的用户标签
com.kairuotu.campus:id/iv_user_tag_avatar
com.kairuotu.campus:id/ll_user_tag_capsule
com.kairuotu.campus:id/ll_user_tag_name_row
com.kairuotu.campus:id/tv_user_tag_name            ← 标签里的用户名
```

可见文字里的「他只是经过 / yiyiyi / 一颗石榴 / Yuty / 破霜」**出现在
`tv_user_tag_name` 这一族节点上**，即它们是**贴在图片上的作者标签**，
而不是列表条目里的标题/正文。

### conclusion（谨慎表述）

- 「校园广场」页的呈现模型是 **拼贴 / 照片墙（collage）**，每张图带**作者标签**；
- **不是**我们所实现的**列表式 feed**；
- 因此 tab deviation 的性质比"少一个 tab"更深：
  **该 tab 指向的呈现模型本身就不同**（collage vs list）。

**强度与边界（重要）**：
- 以上是**控件结构级**观察，属可复核范围；
- **交互模型尚未确证**（例如点击单张图会进哪里、标签是否可点、是否分页/瀑布流）——
  这些需要新的只读观察（导航 + dump），**本轮不做，也不推断**；
- 我**不声称**"原版校园广场 = 我们 feed 的拼贴版"这一等价关系：
  它需要比对两边的**内容来源**（是否同一批 posts）才能成立。

### implementation impact

- 该 deviation 的描述从"缺一个 tab"**修正为**"缺一个 tab，且该 tab 的呈现模型
  （collage/照片墙带作者标签）与我们现有列表式 feed 不同"。
- 实现该 tab 前需要先只读观察其**交互模型与内容来源**，
  否则会做出一个"看起来有 4 个 tab、但第一个 tab 语义不对"的实现 ——
  那属于**用存在性掩盖语义差异**，正是本项目一直在防的。
---

## 附三：board 页差异清单的**收敛结果**（2026-09-21，替代附二里的 4 条）

附二登记的 C1–C4 四条差异，经**只读观察复核**后收敛为：**2 条撤销 / 1 条策略阻断 / 1 条成立**。
以本节为准（附二保留作为"当时的初判"，便于追溯我错在哪）。

| 原编号 | 初判（附二） | 复核后 | 依据（可复核产物） |
|---|---|---|---|
| C1 | 缺返回按钮（原版有返回+关闭两个） | **撤销** —— `ivClose` 的 bounds [42,91][84,133] **完全落在** `iv_back` [28,77][98,147] 内、且 `ivClose` `clickable=false`，很可能是"一个可点击容器 + 内部图标"，**不是两个按钮** | `raw-dumps/board-ivback-{before,after}.xml` |
| C2 | 缺留言总数 | **撤销** —— `tvTotalComment` 的可见文本就是标题「留言」 | 同上 |
| C3 | 缺下拉刷新 | **BLOCKED_BY_POLICY** —— 该断言需**非空留言板**才能评估；空态下刷新本就可能被禁用；而造非空必须**发留言＝写操作＝禁止** | `raw-dumps/board-refresh-{before,mid,after}.xml`（三份均为空态） |
| C4 | 表情是图片而非文字 emoji | **成立（DEVIATION）**，实现方式待审核裁定（复刻图像 vs 先做 image-based structure） | `raw-dumps/message-board-dump.xml`（`emotion_image`）+ `raw-dumps/emoji-row-crop.png` + 像素主色测量 |

### 这张表本身就是一条教训的量化

四条初判里：**两条错在"照 `resource-id` 的名字写结论"**（`ivClose` 被当成"关闭按钮"、
`tvTotalComment` 被当成"总数"）、一条**合规做不了**、只有一条真的成立。
如果按初判直接开工，会做出**两个原版并不存在的控件**，同时漏掉真正成立的 C4。

审核那句原则因此被写进纪律：**不要把 `resource-id` 的名字当成行为 contract。**

### 仍待审核裁定的两项

1. C4 的实现方式：**复刻 6 个图标图像** vs **先完成 image-based structure**
2. `force-stop` 替代规则是否够严（我已经默认改为**不主动干预原版 App**，
   改为"先把自己 Activity 拉回前台，否则 abort"，force-stop 降级为显式开关）
---

## 附四：**撤销**附里的"底部 tab 4 vs 3"登记（2026-09-21 20:55）

本节为**权威**，附里的原登记（"tab 项数 4 vs 3 → DEVIATION，缺第一项「校园广场」"）
**已作废**，但**保留原样**以便追溯我错在哪。

### 一、错在哪

原登记的依据是：

> `board-observation-1.xml` 与 `message-board-dump.xml` 中**可见 4 个 tab label**：
> 「校园广场」「自定义名称6」「校园」「地图」

**我只数了文字个数，没有检查它们的 bounds。** 补查 bounds 后：

```
校园广场      x=[28,116]    y=[130,157]     → **顶部区**
自定义名称6   x=[100,249]   y=[1829,1868]   → 底部导航区
校园         x=[360,414]   y=[1829,1868]   → 底部导航区
地图         x=[572,626]   y=[1829,1868]   → 底部导航区
```

**「校园广场」在 y≈130 的顶部**，与三个底部 tab（y≈1829）**不在同一区域** ——
它是**顶部栏目/页面标题**（视觉读图 `01-trident.png` 印证：顶部大字 "Campus"，
其下「校园广场」**带下拉箭头**，像栏目选择器）。

### 二、更正后的结论：tab 区**逐项一致**（该 deviation 撤销）

| 项 | 原版 | 我们 | 判定 |
|---|---|---|---|
| 底部文字 tab 数 | **3**（自定义名称6/校园/地图） | 3（我/校园/地图） | ✅ 一致 |
| 底部发布按钮 | 有（右侧圆形 `+`） | 有（`tabbar__fab` → `publish`） | ✅ 一致 |
| 校园广场呈现模型 | 两列瀑布流拼贴 + 每图带作者标签 | `campus.css` `column-count: 2` 瀑布流 | ✅ 一致 |
| 顶部「校园广场 ▼」切换 | 有（点后出现「搜索其他学校」） | 有（`CampusScreen.tsx` 的 `switcher`，注释即指原版行为） | ✅ 一致 |

**我们两侧证据**：`app/src/components/TabBar.tsx`（`navigate('me'/'campus'/'map')` + `tabbar__fab`）、
`app/src/screens/campus.css`（`column-count: 2`）、`app/src/screens/CampusScreen.tsx`（switcher 注释）。

### 三、教训（已并入纪律）

这是**同一错误类型的第四次**：

| # | 错 | 性质 |
|---|---|---|
| 1 | `ivClose` 当成"关闭按钮" | 照 **id 名字**推断 |
| 2 | `tvTotalComment` 当成"总数" | 照 **id 名字**推断 |
| 3 | `emotion_image` 当成"位图素材"（未证明） | 照 **id 名字**推断 |
| **4** | **4 个文字当成 4 个底部 tab** | **只数节点、不看坐标** |

**共同点：用"名字/数量"代替"结构"。** 第 4 次的新变体是：
**"数量"也是一种"名字级"的浅层特征。**

→ 纪律：**凡涉及"有几个 / 在哪一类"的结论，必须看 bounds / 层级，不能只数名字。**

### 四、为什么这条更正重要（不只是账本洁癖）

若不更正，后续会去"**补一个校园广场 tab**" ——
而我们的底部栏、发布按钮、瀑布流、顶部切换**本来就与原版一致**。
**那等于往一个正确的实现里加东西**，正是上面 1–3 次错误造成的同类后果
（例如我曾按一条不可复算的记录把表情从 6 改错成 7）。

---

## 附五：第三节清单的**现状更正**（2026-09-21 22:22）

第三节写于 M0–M4 收口时，其中若干条**已被后续工作改变**。
按"状态文字必须与事实同步"的纪律（旧结论若被继续引用，每次读取都在传播过期信息），
在此逐条更正。**原表保留以便追溯。**

### 5.1 已改变的条目

| 项 | 三节原状态 | **现状态** | 依据 |
|---|---|---|---|
| `board_notes` | 建模完成、未做前端 | ✅ **已实现（前端 + 服务端）** | `app/src/screens/BoardScreen.tsx`（`getBoardNotes`/`postBoardNote`）+ `server/src/index.ts:1694`「M5 Slice 1：留言板」；M5 WO#1 已 CLOSED |
| `MEDIA_UPLOAD_AND_SEND_TRANSITION` | BLOCKED_BY_POLICY | ⚠️ **部分解除**：产品链路已用**自动化驱动真实系统 picker** 验证通过（`NATIVE_FILE_PICKER_PRODUCT_PATH` / `SYSTEM_PICKER_SELECTION` / `WEBVIEW_FILE_DELIVERY` 均 PASS） | `docs/m5/G3-NATIVE-PICKER-E2E-RESULT.md`；**但** `ANDROID_INPUTDISPATCHER_ENTRY_TOUCH: NOT_EVALUATED`（用 CDP 注入触摸，非物理输入） |
| 底部 tab 数量（附里的登记） | DEVIATION（原版 4 / 我们 3） | ✅ **RETRACTED** | `docs/m5/TAB-DEVIATION-WITHDRAWN.md`、本文件附四（误数：把顶部栏目当成底部 tab） |
| 消息发送者呈现 | 未登记 | ✅ **已登记并修复** | `CHAT_MESSAGE_SENDER_PRESENTATION: FIXED/VERIFIED`（审核记录 27/29） |

### 5.2 仍未改变的条目（现状核实，逐条给依据）

| 项 | 状态 | 核实到的现状 |
|---|---|---|
| `OTP_UI_VISUAL_CONFORMANCE` | **NOT_EVALUATED** | 未变：取证会给真实号码发短信（BLOCKED_BY_ETHICS） |
| `AT_PANEL_VISUAL_CONFORMANCE` | **NOT_EVALUATED** | 未变：证据依赖第三方写操作（INADMISSIBLE） |
| `MEDIA_PREVIEW_VISUAL` | **NOT_EVALUATED** | 未变：同上 |
| 点赞切换 / 已点赞态 | **BLOCKED_BY_POLICY** | 未变 |
| 发布后的反馈 / 跳转 / 动画 | **BLOCKED_BY_POLICY** | 未变 |
| 原版 `@` 提及模型 | **NOT_EVALUATED** | 未变 |
| 手机号定位 | **DEVIATION** | 未变（`REAL_DEVICE_GEOLOCATION_CONFORMANCE: DEVIATION`） |
| 图片压缩 / 重编码 | 未做 | 未变（服务器 396MB、无 native 图像库） |
| `@所有人` | 未实现 | 未变（明确不做） |
| **语音消息** | **未实现** | **未变，但现状已精确化** ↓ |
| per-user 配额 | 未做 | 未变 |

### 5.3 语音消息这一条的**现状精确化**（本次核实）

**我们这边**（代码里**已诚实标注为占位**，不是"假装实现了"）：

```
app/src/screens/PublishScreen.tsx:33   注释「语音：录音波形（占位，未接真实录音）」
app/src/screens/PublishScreen.tsx:294  界面文案「（录音功能尚未接入真实麦克风）」
app/src/screens/PublishScreen.tsx:320  aria-label="按住说话" 的按钮（disabled）
app/src/screens/MeScreen.tsx:122-129   me__voiceRow /「我的第一条语音」（静态展示卡，非真实数据）
app/src/api/client.ts:240              kind: 'text' | 'image' | 'voice'（类型上已预留）
server/src/index.ts:1538               只校验 kind 枚举，**无语音内容处理**
```

**原版这边**（静态证据，来自 APK 资源名，只读）：

```
im_chat_voice_layout
im_chat_voice_ic
im_chat_subitem_voice_left_layout      ← 语音气泡的左右两套（与文字一致的方向体系）
im_chat_subitem_voice_right_layout
im_chat_voice_to_text_bg               ← **语音转文字**（原版有此功能；**我们没有**）
im_chat_voice_to_text_bg_night
```

→ **结论**：语音是**真实的 1:1 缺口**，且原版的功能面**比"能发语音"更宽**（含**语音转文字**）。
我方现状是"类型预留 + 界面占位 + 明确标注未实现"，**没有谎报**。

**实现影响**：这是**功能级缺口**，不是接线级 ——
需要录音、上传、播放、以及"语音转文字"四件事，**远大于一个工作单**。
建议：登记为正式 gap 项，**先不定实现**；若要推进，应按功能分单（录音 → 播放 → 转文字）。

---

## 附六：**「手机号定位 / 定位」这条登记已过期，且方向是"低报"**（2026-09-21 22:30）

### 6.1 原登记（第三节与附五均沿用）

```
手机号定位 | DEVIATION | demo 不申请定位权限，用校区坐标作参照
（DISTANCE_FUNCTIONAL: PASS 但 REAL_DEVICE_GEOLOCATION_CONFORMANCE: DEVIATION）
```

### 6.2 核实结果：**"不申请定位权限"这一句现在是假的**

仓库里有**完整、已接入**的真实定位实现 —— `app/src/native/geo.ts`（172 行）：

```
@capacitor/geolocation  → APK 走系统定位（GPS/融合/基站），首次使用弹系统授权框
navigator.geolocation   → 浏览器预览等价行为
hasLocationPermission()      只查已授权，不弹窗（进地图时静默判断）
ensureLocationPermission()   申请权限；**显式处理 Android 12+ 只给"大致位置"的情形**
                            （current.location 或 current.coarseLocation 任一 granted 即算授权）
getCurrentFix()              单次定位：先高精度(10s) → 失败退回粗定位(15s)，两段兜底
watchFix()                   持续跟踪，返回停止函数
distanceMeters()             Haversine 球面距离
formatDistance() / formatAccuracy()
GeoStatus 状态机             'idle' | 'asking' | 'ok' | 'denied' | 'unavailable' | 'timeout'
```

**且确实在用**（不是死代码）—— `app/src/screens/MapScreen.tsx` 导入并调用了
`ensureLocationPermission` / `hasLocationPermission` / `getCurrentFix` / `watchFix` /
`distanceMeters` / `formatDistance` / `formatAccuracy`，维护 `GeoStatus` 状态，
并渲染「当前位置距校园 {formatDistance(...)}」；`geoStatus === 'denied'` 时打开提示。
原生地图组件（`AmapMap` / `TencentMap` / `RealMap`）都以 `here?: GeoFix` 接收定位结果。

### 6.3 更正后的口径（区分"我们做了什么"与"与原版是否一致"）

```
REAL_DEVICE_GEOLOCATION_CONFORMANCE: **需重新评估**
  原登记所述原因（"demo 不申请定位权限，用校区坐标作参照"）→ **事实不成立，作废**
  事实: 真实定位**已实现并接入**（权限申请 / 单次+持续 / 距离 / 精度 / 状态机）

  仍未评估的部分（与上面是两件事，不得混为一谈）:
    · 原版的**距离呈现形态**（文案、单位、位置、是否显示精度）是否与我们一致
      → 需要原版只读证据（已入库 `docs/original-baseline/screens/original-sweep/02-map.png`；
        也可做一次只读观察）
    · 原版在**拒绝授权**时的表现（提示样式/降级行为）
```

### 6.4 ⚠️ 这条过期的**方向值得单独记**（比上一条更有价值）

前面发现的过期登记（`board_notes` 未做前端、tab 4 vs 3）都是**高报**：
把"已经做了"写成"还没做"。**这一条是相反的：把"已经做了"写成"有一个偏差"，
即低报我们的符合度。**

```
高报（说我们差）  → 后果: 浪费时间重做已完成的事（board_notes）
低报（说我们有偏差，其实没有）→ 后果: **符合度被低估**，
                              且可能据此去做一个"修复"，而那个"修复"才是真正的偏差
```

→ **纪律补充**：审计表里的每一项都要按**当前代码**核实，
**两个方向都会出错**；不要假设过期信息一定是"保守/高报"。

### 6.5 处置

- 第三节与附五的那两行**以本附六为准**
- 该条的后续（若要做）另立：**MAP_DISTANCE_PRESENTATION_CONFORMANCE**（只读对比，不涉写操作）

---

## 附七：第三节清单的**结构性重排**（2026-09-21 22:30）—— 它把两个正交维度混在了一起

### 7.1 发现：第三节自身犯了它在第四章警告过的错

第三节的标题是「已知偏差与未评估项清单」，只有"状态 / 原因"两列。
但逐项按**当前代码**核实后发现：这一列里混着**两个互不相干的维度** ——

- **实现维度**：这件事**我方有没有做**？
- **证据维度**：这件事**有没有原版证据**可供比对？

而第四节恰好写着：

> 把这三种状态混在一起，会重演"22/22 observed 被误读成 22/22 verified"的老问题。

**第三节就是那个混在一起的表。**

### 7.2 正确的结构（2×2）

|                       | **我方已实现** | **我方未实现** |
|---|---|---|
| **有原版证据** | ✅ 可比对（看差异） | ⚠️ **真实实现缺口** |
| **无原版证据** | ❓ **证据缺口**（不是实现缺口） | ❓❓ 两边都缺 |

**两类问题的处置完全不同**：
- **实现缺口** → 要写代码（但需先有证据定"该做成什么样"）
- **证据缺口** → 要**取证**（写代码不解决问题）

### 7.3 逐项归类（每一项都按**当前代码**核实过）

#### (A) 有原版证据 + 我方已实现 → ✅ 可比对

| 项 | 备注 |
|---|---|
| 留言板（board_notes） | WO#1 CLOSED |
| 消息发送者呈现 | WO#3 FIXED/VERIFIED |
| 表情行几何 | FIXED |
| 地图/距离 | 真实定位已实现（见附六），**呈现形态待与原版比对** |

#### (B) 有原版证据 + 我方**未**实现 → ⚠️ **真实实现缺口**

| 项 | 核实事实 | 备注 |
|---|---|---|
| **语音消息** | ✅ **已完成（M5 WO#5）**：录/传/发/气泡播放 + 持久化时长 + 生命周期 3 组断言 | 已从本格**移出**（审核记录 35/37/38） |
| **per-user 配额** | **确认未做**（无 quota 相关代码） | ⚠ **前提证据不足**：原版是否有配额、配额语义为何，**尚未取证** → 严格说本项同样应移入 (D)，见下方 §7.5 |
| **@所有人** | **确认不做**（`index.ts:1500` 有明确注释："不做 @所有人 —— 若将来要做，必须单独明确语义，绝不能伪造成某个 user id"） | 这是**决定**，不是缺口 → **已正式移出 (B)**，单列在 §7.6「设计决定」 |

> ⚠️ **本格的一次自我纠错（2026-09-22，见 §7.5）**：
> 原表把"**图片压缩/重编码**"放在 (B)，但 (B) 的定义是"**有**原版证据 + 我方未实现"，
> 而它自己的备注就写着"是否'原版会压缩'**仍需证据**"—— **自相矛盾**。
> 经只读取证（`docs/m5/EVIDENCE-image-compression-scan.txt`）后确认：
> **该前提证据用现有方法取不到** → 已移入 **(D)**。


#### (C) **无**原版证据 + 我方**已实现** → ❓ **证据缺口**（不是实现缺口）

| 项 | 我方实现事实 | 缺的是 |
|---|---|---|
| `OTP_UI_VISUAL_CONFORMANCE` | `LoginScreen` 已有完整验证码流程（`requestLoginCode`/`verifyLoginCode`）；其自身注释写明"**验证码页本身没有取得原版证据**" | 原版验证码页视觉（取证会给真实号码发短信 → `BLOCKED_BY_ETHICS`） |
| `AT_PANEL_VISUAL_CONFORMANCE` | `GroupChatScreen.tsx:52` 已有 `grp__atpanel` @面板 | 原版 at-panel 视觉（原证据 `INADMISSIBLE`） |
| `MEDIA_PREVIEW_VISUAL` | `MediaPreviewScreen.tsx` 已实现（2548 B） | 原版媒体预览视觉（原证据 `INADMISSIBLE`） |
| 点赞切换 / 已点赞态 | **已实现**：`client.ts:615 likePost` / `:623 unlikePost` | 原版已点赞态（要观察必须点赞 = 写操作 → `BLOCKED_BY_POLICY`） |
| 发布后的反馈/跳转/动画 | 已有发布流程与页面 | 原版发布后反馈（写操作 → `BLOCKED_BY_POLICY`） |
| 原版 `@` 提及模型 | 有 @ 面板与提及输入 | 原版提及的**数据模型**（证据 `INADMISSIBLE`） |

#### (D) 两边都缺

| 项 | 我方状态 | 缺的证据 | 现有方法能否取到 |
|---|---|---|---|
| **图片压缩/重编码**（自 (B) 移入，见 §7.5） | 确认未做（服务端无 `sharp`/`jimp`/`resize`/`compress`） | "原版**上传前**是否压缩、压缩到何种程度（尺寸/质量阈值）" | ❌ **取不到**（见 §7.5 的取证尝试与强度分析） |
| **per-user 配额**（自 (B) 移入，见 §7.5） | 确认未做（无 quota 相关代码） | "原版是否有配额、配额语义（按数量/体积/时间窗）、越界时的界面表现" | ❓ 未尝试；但**配额越界的界面表现**很可能需要写操作才能观察到（连续上传直到越界）→ 预判 `BLOCKED_BY_POLICY` |

> 说明：(D) 的处置顺序是「**先取证 → 再决定是否实现**」。若证据确实取不到，
> 正确做法是记为 `ORIGINAL_CONFORMANCE: KNOWN LIMITATION`（原版等价语义在当前范围内不可获得或无证据），
> **而不是**按常识猜一个行为去实现 —— 那属于"凭惯例发明"，本项目已多次明确禁止。

### 7.5 ⚠️ 一次自我纠错：把两项从 (B) 移入 (D)（2026-09-22）

**发现**：原表把「图片压缩/重编码」和「per-user 配额」放在 (B)「**有**原版证据 + 我方未实现」，
但两项的备注都写着"仍需证据 / 已知限制" —— 与 (B) 的定义**自相矛盾**。
(B) 的前提是"证据已在手、只差实现"；这两项**证据并不在手**。

**取证尝试（图片压缩，只读、可复现）**：
脚本 `tools/tmp/scan-apk-compression.mjs`，扫描原版 APK 的 5 个 dex（合计 44.4MB）中
"上传前压缩"相关的类名/方法名特征。原版 APK sha256 已核验与基线一致
（`3373B6B2…D6C294`），故证据可采信。结果见 `docs/m5/EVIDENCE-image-compression-scan.txt`：

```
第三方压缩库（Luban / zibin.luban / id.zelory:compressor / BitmapCompress / ImageResizer / resizeImage）:
    **全部未命中**
降采样/缩放 API:  inSampleSize(×4)、calculateInSampleSize(×2)、createScaledBitmap(×4)  → 命中
```

**为什么"命中"仍然不能下结论**（这是关键，必须写清）：
`inSampleSize` / `calculateInSampleSize` / `createScaledBitmap` 是"**显示时降采样防 OOM**"的
标准写法 —— 任何会展示图片的 Android App 都会有。它们证明的是"**存在缩放能力**"，
**不是**"上传路径调用了压缩"。同理，"第三方压缩库未命中"只说明**没有这些明显命名的库**，
不能推出"原版不压缩"（自研代码、RN bundle 内实现、别名混淆都能躲过字符串扫描）。

**另一条线索（也不足以定论）**：原版是 **React Native 应用**
（`libhermes` / `libreactnativejni` / `libyoga` / `librrc_*`），JS 代码被打包进
`assets/rn/*.7z` 与 `assets/main_segment.bin`（Hermes 字节码），
要判读需解包 + 反汇编 —— 成本高且结论仍非决定性。所以**本轮不继续投入**。

**结论**：`IMAGE_UPLOAD_COMPRESSION_CONFORMANCE`
= **`EVIDENCE_NOT_OBTAINABLE_BY_CURRENT_METHODS`**（不是"原版不压缩"，也不是"原版压缩"）。
按声明强度纪律：**不得**用这个扫描结果去支持任何一种断言。

### 7.6 设计决定（**不是待办**，单列以免每次读表都以为它是缺口）

| 项 | 决定 | 依据 |
|---|---|---|
| **@所有人** | **不做** | `index.ts:1500` 明确注释：不做 @所有人；若将来要做必须单独明确语义，绝不能伪造成某个 user id（那会让"提到全体"与"提到某人"在数据上无法区分） |
| **语音转文字** | **不做**（`NOT_IMPLEMENTED`，不冒充） | 依赖对方 ASR 服务；原版等价服务/语义在当前范围内不可获得或无证据。**不得**用假文本冒充 |
| **Phase 2 录音浮层/上滑取消** | **暂不做** | "上滑取消"**无行为证据**，不凭惯例实现（审核记录 35 裁决）；且核心用户路径已存在 |


### 7.4 这张重排表的**直接用途**（2026-09-22 更新）

```
⚠ 重要更新：**(B) 格现已为空**。
   · 语音消息 → 已完成（M5 WO#5，审核记录 38）
   · @所有人 → 移入 §7.6「设计决定」（本来就不是缺口）
   · 图片压缩 / per-user 配额 → 移入 (D)（前提证据不在手，见 §7.5）
   → 结论：**当前不存在"证据已在手且我方未实现"的缺口**。
     也就是说，"直接写代码补功能"这条路的存量清单**已经做完**。

因此接下来的工作只剩三类（优先级按"能产出可验证成果"排序）：
 1. **(A) 可比对项**：证据在手、双方都实现了 → 任务是**逐项比对找偏差**
    （当前明确挂着的：**地图/距离的呈现形态**；其余 A 类项已 CLOSED/FIXED）
 2. **(C) 证据缺口**：写代码不解决，需要新的只读证据来源
    → 其中"点赞态/发布反馈"因取证必须写操作，**永久 BLOCKED_BY_POLICY**（合规终态）
 3. **(D) 证据取不到**：正确处置是记为 KNOWN LIMITATION，**不得按常识猜一个行为去实现**

```

### 7.5 处置

- 第三节以本附七的 2×2 结构为准（原表保留以便追溯）
- **不再把"证据缺口"写成"未评估/偏差"** —— 它们是两类不同的待办
- 后续按 (B) 推进（语音 → 图片压缩 → 配额），每项**先报计划**
- (C) 里的 `BLOCKED_BY_POLICY` 项**不再反复尝试**（合规终态）
