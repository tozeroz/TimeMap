# M5 的 A/D 清单（差异与缺陷汇总）

> 建立于 2026-09-21 18:47，起因：审核记录 25 要求把新发现的 deviation
> `CHAT_MESSAGE_SENDER_PRESENTATION` 登记进"M5 后续 A/D 清单"，而当时**并不存在**这个清单。
> 本文件即该清单，用来把散落在各 finding / 审核记录里的差异**汇总到一处**，
> 避免同一个差异在多个文档里各说各话、或修好一个忘另一个。

## 分类口径（沿用本项目既有）

| 标记 | 含义 |
|---|---|
| `DEVIATION` | 与原版有真实差异，**尚未修**（已确认存在） |
| `FIXED` | 差异已被修复（附证据） |
| `BLOCKED_BY_POLICY` | 需要写操作才能取证 → **禁止执行**，如实记为此状态（**不是"未做"**） |
| `WITHDRAWN` | 曾经登记过，后来被证据**推翻**（保留以便追溯我错在哪） |
| `NOT_EVALUATED` | 观察不足，尚不能判定（**不等于 PASS**） |

---

## 一、差异清单

### 0. 底部 tab 项排布方向（图标/文字相对位置） — **FIXED / CLOSED**（2026-09-22，commit `1f7c761`）

```
observed: 原版底部 tab 项是**竖排**（图标在上、文字在下）；我方是**横排**（图标在左、文字在右）
证据:     ① dump bounds（docs/original-baseline/raw-dumps/board-observation-1.xml）：
             激活态图标 y=[1746,1795]、文字 y=[1829,1868] → **y 区间不重叠**、水平中心接近（160.5 vs 174.5）
           ② 截图 trident-campus/normal.png 视觉：三个 tab **均为图标在上、文字在下**
           我方实测（CDP getBoundingClientRect）：icon y=1035、label y=1037/1039 → **y 重叠、x 分离** → 横排
实现:     app/src/components/tabbar.css 的 .tabbar__item 加 flex-direction: column + 交叉轴居中
          （**只改方向与对齐**；gap/padding/颜色/字号/字重均未动）
Gate:     scripts/m5/gate-wo6-tabbar-orientation.mjs（设备侧，**坐标单位显式冻结为 CSS px**）
          改前 **FAIL**（stackGapCss=-17.86~-19.86、alignDeltaCss=28~30.61）
          改后 **PASS**（stackGapCss=5、alignDeltaCss=0）
          + TAB_LABELS_PRESERVED / TAB_NAVIGATION_REGRESSION / FAB_GEOMETRY_UNCHANGED /
            TABBAR_HEIGHT_UNCHANGED 全 PASS；M5_SERVER_REGRESSION PASS（REAL_EXIT=0）
裁定:     docs/review-log/40（批准，附两处计划修正）、docs/review-log/41（**PASS / CLOSED**）
未做:     未激活态精确字号/尺寸 = NOT_EVALUATED（无证据，不动）
          FAB 可见直径 = NOT_MEASURED_RELIABLY / PRODUCT_CHANGE: NONE（两种像素方法自判 INVALID）
```

### 6. 会话页**文字消息发送路径缺失** — **FIXED / CLOSED**（WO#7，审核记录 43）

```
observed: 我方 ChatScreen 的 draft 只用于 input 的 value/onChange —— **draft 从未被发送**；
          全屏只有图片与语音两种发送，没有发送按钮、没有回车发送
          → **我方 demo 的会话页发不出文字消息**
原版证据: 静态布局（aapt2，APK sha256 已核验）：layout/im_input_box（res/P9.xml）**声明了 sendBtn**
          （56dp×36dp，src=ic_send_msg_btn，**默认 visibility=GONE**）
我方证据: composer 5 个子控件中**无任何 send 控件**；源码无本地发送调用；CSS 无 send 类
修法明确: 服务端 /api/threads/:id/messages 早已支持纯文本（gate 长期有 "T1 纯文本 → 201"）
⚠ 推断强度: "无文字时显示表情+加号、有文字时显示发送"这一**切换关系**由
          "sendBtn 默认 GONE + emojiBtn/plusBtn 常显"**推断**而来；
          **渲染态（输入文字后）未观察到** → 实现前必须标注该推断
实现:     client.ts 的 postThreadTextMessage + ChatScreen 的 onSendText + .chatbar__send（图标按原版矢量资源复刻）
Gate:     scripts/m5/gate-wo7-text-send.mjs（设备侧 6 项全 PASS，含 SENSITIVITY 受控突变）
          scripts/m5/verify-wo7-db-oracle.sh（DB oracle：kind=text / body 逐字一致 / sender=Lemy / message_media 无行）
裁定:     审核记录 42（批准 + Stage 0 前置）、43（**PASS / CLOSED**）
仍开放:   COMPOSER_EXACT_VISIBILITY_STATE: NOT_EVALUATED（"何时显示发送按钮"未取证，当前为我方设计选择）
          ENTER_TO_SEND: NOT_IMPLEMENTED（原版无证据）
```

### 1. `CHAT_MESSAGE_SENDER_PRESENTATION` — **FIXED / VERIFIED**（2026-09-21，commit `c9d7a7d`）

```
observed: 自己发的图片消息渲染在左侧 peer 气泡里
来源:     WO#2 前端实现时发现（既有渲染逻辑，非本工作单引入）
审核裁定: 记录 25 登记 → 记录 27/29 **ACCEPTED / CLOSED**（WO#3）
实测:     真机实际几何 —— 自己发的气泡 left=456.3/386.1（视口 618 的 73.8%/62.5%）；
          对方 left=16（2.6%）；类名与几何逐条一致；与原版截图并排一致
实现:     ChatScreen 按 senderId === getSession()?.user?.id 选 --me/--peer（meId=null 时降级 --peer）
未覆盖:   meId===null 降级分支真机不可达 → SOURCE-VERIFIED / RUNTIME: NOT_EVALUATED（**不得写成 PASS**）
证据:     docs/m5/CHAT-SENDER-PRESENTATION-CONFIRMED.md、scripts/m5/device-chat-sender-align.mjs
说明:     "我的消息 / 对方消息的布局区分"属于更一般的 chat presentation semantic，
          需要先只读观察原版在这方面的表现，再决定实现（**不要凭感觉加区分**）
```

### 2. 底部 tab 数量与「校园广场」的呈现模型 — **WITHDRAWN（2026-09-21 20:54 撤销）**

```
observed: ~~原版底部是 4 项~~ → **错误**：看 bounds 才知「校园广场」在**顶部区**(y≈130)，三个 tab 在底部区(y≈1829)。原版底部 = **3 个文字 tab**（自定义名称6/校园/地图）+ 右侧圆形发布按钮，**与我们一致**
证据:     docs/original-baseline/raw-dumps/board-observation-1.xml
补充(2026-09-22 更正): 该页的**图片排布是两列瀑布流**（不是拼贴照片墙）。
          此前据控件名 `collageView` 判为"拼贴照片墙"是**误判** ——
          读 bounds 才知：双列固定 x 区间（左≈[18,529] / 右≈[561,1052]）、
          高度各不相等（620/499/582/440/387/360）、y 交错 → **瀑布流**。
          `collageView` 只是**全屏外层容器**的类名（bounds=[0,1080][0,1920]）。
          → 与我方 column-count:2 瀑布流**一致**，本条差异**不成立**。
          证据: docs/m5/FINDING-campus-layout-waterfall.md
          ⚠ 这是本项目**第 4 次**因"把控件名当行为/布局契约"而误判
            （前三次: ivClose / tvTotalComment / emotion_image）。
⚠ 本条的**撤销范围**（写清以免被误读）:
  撤销: "原版底部有 4 个 tab、我们缺「校园广场」" —— 这是误数，不成立
  ~~**仍然成立**: 「校园广场」**页面**的呈现是**拼贴照片墙**~~ → **该补充本身也已于 2026-09-22 更正**（实为两列瀑布流，与我方一致）
              其**交互模型**（点单图去哪/标签是否可点/是否分页）仍**未确证** —— 这条**不受本次更正影响**，仍是需取证项
```

### 3. 留言板表情行 — 四项

| 子项 | 状态 | 说明 |
|---|---|---|
| 项数 / 宽 / pitch / 首末边界 | **FIXED** | 6 项、70 / 112（设备 px）逐项与原版吻合；CSS 40px + gap 24px，设备实测确认 |
| 底色（C5） | **FIXED** | 原版无底色（像素采样圆内点亦纯白）；我们原有灰色圆片 → 已改为 transparent |
| 字号（C6） | **FIXED** | 16px → 24px（据实心字形墨迹外接的**直接测量**；估计值，残余不确定已标注） |
| **字符与形态（C4）** | **体系差异 CONFIRMED（审核记录 30）；具体修法 FROZEN（审核记录 32：`WO4_STATUS: DEFERRED_BY_MISSING_BINDING_EVIDENCE`）** | 已按审核记录 30 收口为**三层结论**：`C4_EMOJI_ASSET_SYSTEM: CONFIRMED`（154 个随包 webp）、`C4_BOARD_ROW_PACKAGED_DRAWABLE_BINDING: STRONGLY_SUPPORTED / DIRECT_BINDING NOT CAPTURED`、`C4_EXACT_6_ASSETS: NOT_CAPTURED`（停止投入）。'
  （历史：曾据 id 名判"是图片" → 又因像素读数降为 UNRESOLVED → 本轮用 aapt2 资源表 + 运行时 ImageView 确证。见 `docs/m5/C4-FORENSICS-RESULT.md`、`docs/m5/C4-EVIDENCE-CONFLICT.md`。） |

### 4. 留言板下拉刷新（C3） — **BLOCKED_BY_POLICY**

```
原因: 该断言需要**非空留言板**才能评估；而造非空必须**发留言＝写操作＝用户明令禁止**
      或依赖"原版账号恰好已有留言"这一我们无法控制的条件
已做的合规尝试: 空态下一次安全区下拉手势（无可观察变化，**不足以判定**）
Gate 口径: 记 BLOCKED_BY_POLICY（**不是**"未做"、**不是**"通过"、**不是**"失败"）
```

### 5. 留言板顶部按钮（C1）/ 留言总数（C2） — **WITHDRAWN**

```
C1 原判: 缺返回按钮（原版有返回+关闭两个）
  实测:   ivClose 的 bounds 完全落在 iv_back 内部、且 ivClose clickable=false
          → 很可能是"一个可点击容器 + 内部图标"，**不是两个按钮**
C2 原判: 缺留言总数
  实测:   tvTotalComment 的可见文本就是标题「留言」，不是计数
证据:   docs/original-baseline/raw-dumps/board-ivback-{before,after}.xml
教训:   **不要把 resource-id 的名字当成行为 contract**（我照名字写结论才错这两条）
```

---

## 二、汇总结论（当前）

```
已修:   表情行几何（项数/宽/pitch/边界）、底色、字号
已修:   CHAT_MESSAGE_SENDER_PRESENTATION（自己消息靠右；真机几何断言通过）
已收口: C4 表情形态 = **image-based（CONFIRMED）**；exact 6 assets 未捕获且**停止投入**
        → 结构层可解冻（审核记录 30 建议另立 WO#4），exact asset 选择继续冻结
撤销:   底部 tab 4 vs 3（误数：把顶部栏目当成底部 tab；我们的 3 tab + FAB 与原版一致）
阻断:   C3 下拉刷新（BLOCKED_BY_POLICY）
撤销:   C1 顶部按钮、C2 留言总数（被只读观察推翻）
待办:   「校园广场」**页面**的交互模型（点单图去哪 / 标签可点性 / 是否分页）——需只读观察
待办:   语音消息（真实功能级缺口；我方为"类型预留+界面占位+明确标注"，见 AUDIT 附五）
待办:   C4 **具体修法冻结**（审核记录 32 驳回 WO#4：缺 token↔drawable 映射；且"DOM 必须是图片"是把实现细节当产品 contract）
```

## 三、维护规则

1. **每修掉一项就更新本表**（把 `DEVIATION` 改成 `FIXED` 并附证据），不要只改 finding 文档
2. **撤销的项保留**（`WITHDRAWN`），并写清"我原来错在哪" —— 这个项目里错误的判断链比结论更有教学价值
3. 新增项必须带 `raw_evidence`（可复核产物），否则只能进"线索"不能进本表

---

## 四、证据分层命名规范（审核记录 25 强制要求，**永久有效**）

背景：WO#2 的端到端证据实际上分成**两层**，历史上曾被笼统写成"真机 PASS"，
让读者以为"用户从真实入口选图"这条路径已验证过。审核明确要求**永久分列**：

```
FILE_INPUT_POST_SELECTION_E2E    WebView 已获得 File 对象之后的完整产品链路
                                 （DOM.setFileInputFiles → input change → 上传 → 发消息
                                   → 重拉列表 → blob 渲染 → 重载后仍在）
                                 状态: PASS

NATIVE_FILE_PICKER_INTERACTION   真实点击选图入口 → 系统 picker 真的出现
                                 → 在 picker 里选了一张图 → WebView 真的收到 File
                                 状态: 见最新执行结果（可自动化性已由
                                       docs/m5/G3-PICKER-AUTOMATABLE-PROVEN.md 证明）
```

### 规则

1. **任何报告、Gate 输出、账本条目都不得把这两层合并**成"真实用户完整选图 E2E"之类的说法
2. 引用其中一层时必须**点名是哪一层**（例如"`FILE_INPUT_POST_SELECTION_E2E` PASS"）
3. 若某次验证只覆盖了第二层的一部分（例如 picker 出现但未成功选图），
   **必须写明覆盖到哪一步**，而不是给一个笼统的 PASS/FAIL
4. 这条规则的**目的**是防止"看起来完整的证据集"——
   本项目已多次吃过"措辞不精确 → 后来者误判"的亏

### 同类措辞不精确的历史案例（都是本人犯的，保留以便对照）

| 案例 | 不精确的写法 | 精确的写法 |
|---|---|---|
| 表情行几何 | "间距 112px"（那是 pitch） | `EMOJI_ITEM_PITCH: 112px` + `EMOJI_INTER_ITEM_GAP: 42px` |
| WO#2 收口 | "真机 PASS"（含混两层） | 分列两个 key（本规范） |
| board_notes 收口 | "Slice 1 收口"（把功能闭环与页面一致性混在一起） | `FUNCTIONAL: CLOSED` / `CONFORMANCE: OPEN` |

**共同点**：不精确的措辞把"已验证的范围"说得比实际更大。

### 1b. `CHAT_MESSAGE_SENDER_PRESENTATION` 的**当前状态与所需证据**（2026-09-21 20:51 更新）

```
状态:      DEVIATION（前提已确认成立 —— comparison.md 记载原版确有单聊/群聊页面可比对）
代码刻画:  docs/m5/CHAT-BUBBLE-DEVIATION-ANALYSIS.md
           → senderId 与 .bubble--me 都已存在，只是渲染硬编码 --peer（属**接线级**修法，非缺功能）
证据状态:  docs/m5/ORIGINAL-CHAT-EVIDENCE-STATUS.md

⚠ 已排除的一条"伪证据":
   11-chat.png（原版单聊截图，已入库）**该页没有消息气泡** → 不能用来判断左右区分。
   若仅因"截图已入库"就下结论，很可能错误地得出"原版不区分"，
   进而把本来正确的实现改错 —— 这是 C1/C2/C4 三次同型错误的形态。

所需证据:  一次**只读**观察 —— 原版里一条**已有消息**的会话页的
           · 截图（线索级）+ **控件树 dump**（证据级：气泡 bounds 左边界差异才是较强依据）
前提:      原版账号已登录（是）；且若**所有**会话都为空 →
           该项应记 **BLOCKED_BY_POLICY**（造消息 = 写操作 = 禁止）
在飞:      子代理 659cfcd8（2026-09-21 20:50 起）
裁定规则:  原版区分左右 → 偏差成立，做接线级修复
           原版不区分   → **撤销该偏差**
           控件树不足以判定 → 保持 UNRESOLVED，**不得强行判"是/否"**
```
---

## 五、tab 区结论（2026-09-21 20:54 定稿，撤销该偏差）

```
底部文字 tab 数     原版 3（自定义名称6/校园/地图）   我们 3（我/校园/地图）        ✅ 一致
底部发布按钮        原版有（圆形 +）                 我们有 tabbar__fab→publish   ✅ 一致
校园广场呈现模型    原版**两列瀑布流**（双列 + 高度不等 + y 交错，见 FINDING-campus-layout-waterfall.md）+ 作者标签      我们 column-count:2 瀑布流   ✅ 一致
顶部「校园广场 ▼」  原版有（点后出现「搜索其他学校」）  我们有 switcher（注释即指原版）✅ 一致
```

**证据**（两侧都看）：
- 原版：`raw-dumps/board-observation-1.xml` 的 **bounds**（校园广场 y=130–157；三 tab y=1829–1868）
  + `screens/original-sweep/01-trident.png` 的视觉读图
- 我们：`TabBar.tsx`（navigate('me'/'campus'/'map') + `tabbar__fab`→'publish'）、
  `campus.css`（`column-count: 2`）、`CampusScreen.tsx`（switcher 注释指出原版行为）

**教训（第四次同型错误的变体）**：我此前**只数了 dump 里的文字个数**就断定"原版 4 个底部 tab"，
**没有看 bounds**。→ 已并入纪律：
**凡涉及"有几个 / 在哪一类"的结论，必须看 bounds / 层级，不能只数名字。**

---

## 五之二、⚠️ 第 220 行（顶部「校园广场 ▼」）于 2026-09-22 **收窄**（审核记录 60 要求）

**原文保留（不改写历史）**：
```
顶部「校园广场 ▼」  原版有（点后出现「搜索其他学校」）  我们有 switcher（注释即指原版）✅ 一致
```

**为什么必须收窄**：那条"✅ 一致"把**三件不同的事**压成了一句，而它们的结论**并不相同**：
```
Campus switcher presence / rough structure:   **PARTIAL**
    入口确实都在（原版有「校园广场 ▼」，我们有 switcher）；
    但"粗糙结构"之外的东西当时并未逐项核对

subtitle text:                                **MISMATCH**
    current  = 「北京交通大学」（原先取自 mock 的 campusInfo.name）
    original = 「校园广场 ▼」
    ⚠️ 依据：docs/original-baseline/screens/trident-campus/baseline.json
      interactions[1] = 「顶部：大标题 Campus + **副标题「校园广场 ▼」** + 右上消息气泡」
      ⇒ 原版该位置是**固定标签**，不是当前学校名。（已于 WO#16 层 A 修正为「校园广场」）

mock school / member data:                    **MISMATCH / unsupported**
    改前我们渲染 mock 的 8 个学校 + `region` + `members`（如 '12,486'）——**全部无出处**
    （其中 '12,486' 正是 WO#11 从动态列表页判定为编造并移除的数字）
    已在 WO#16 层 A 移除、层 B 改为渲染权威实体
```

**审核 60 的原话（为什么不能只删掉整条）**：
> "不是简单删掉整个结论，而应改成类似…除非 A-D-LIST 当时还有独立证据证明
>  下拉内部内容完全一致，否则**不能继续保留一个笼统的"✅ 一致"**。"

**另记一处必须区分的边界**（Round 267 查出、审核 60 采纳）：
`supplements/schools.json` 里「校区列表」那条证据采自**地图页**的同类控件；
而**校园广场页**顶部是「校园广场 ▼」（固定标签）。**两页形态不同，不能互相套用**
（审核 61 第 6 条亦重申："CampusScreen 保持「校园广场 ▼」，**不要套用 Map picker**"）。

---


## 六、✅ 已修复并真机验证（2026-09-21 21:09，commit `c9d7a7d`）

```
CHAT_MESSAGE_SENDER_PRESENTATION: **FIXED / VERIFIED**
```

### 实现（只改接线，CSS 未动）

- `ChatScreen.tsx`：按 `senderId === getSession()?.user?.id` 选 `--me` / `--peer`
  - `meId` 为 `null` 时 `mine` 恒 false → **降级 `--peer`**（不把所有人当成我）
- **CSS 未改动**：`.chat__row--me` 早已在 `chat.css:15`（实测 computed `flex-direction: row-reverse`）
  → **未加重复规则**（若加了会有两条同名规则互相覆盖）

### 真机断言（**实际几何**，非类名）

| 项 | 实测 | 判据 |
|---|---|---|
| 自己发的气泡 left | **456.3 / 386.1**（视口 618 → **73.8% / 62.5%**） | > 40% ✅ |
| 对方气泡 left | **16**（**2.6%**） | 左侧 ✅ |

### 该核验器比规格要求更好的两点（值得记）

1. **避免了循环论证**：发送者身份取自**服务端 `/api/auth/me` 与消息列表**，
   **不用刚加的类名自证** —— 若用类名判定"是不是我发的"，再拿类名断言几何，那是自证。
   规格里我没写到这一层，它的做法更严谨。
2. **逐条校验「类名靠右 == 几何靠右」**，专门捕获"类名加了但 CSS 没生效"。

### 其余核验

- 与原版 `…-scroll-newer.png` **并排比对一致**（原版自体气泡亦靠右）
- `M5_SERVER_GATE_RESULT` **仍 PASS**
- 测试消息按 id 精确删除；`cleanup.mjs` dry-run 的 orphans / unattached 均为空

### 如实记录的未覆盖项

> 疑似"未登录"分支在**真机不可达**（未登录时会话页直接进错误态），
> 故降级路径（`meId === null` → `--peer`）**仅由源码保证**，未被真机执行到。
→ 该分支的实现正确性有源码依据，**但无运行时证据**；若将来要补，需能构造"已进会话页但会话失效"的状态。
---

## 七、C4 结案（形态）：原版表情 = **随包 webp 图片**（审核记录 29 批准取证）

```
C4_EMOJI_RENDERING_KIND:  **DRAWABLE**（形态确证）
  运行时: rvEmojiList(RecyclerView) → fl_emoji_root(LinearLayout,clickable) ×6
                                   → emotion_image(**android.widget.ImageView**) ×6
  资源侧: array/xhs_theme_xhs_emoji_res_v2 = 156 项 @drawable 引用（去重 154 名）
          每项映射到 APK 内**真实存在的 webp**（文件名被混淆：dp.webp / sD.webp / tm.webp …）
          全部 154 个已解出（1141KB，合法 RIFF/WEBP）
  → 排除: 字体字形 / 运行时生成 / 网络下发

ORIGINAL_EMOJI_CHARACTERS: 仍为 **NOT_CAPTURED**
  （曾试像素差匹配 6 格，**指标不具判别力**（鸡蛋在 6 格全排第一），故不采用其输出）
  新产物: docs/original-baseline/supplements/original-emoji-table.txt（154 拼音名/中文名/引用）
          docs/original-baseline/supplements/original-emoji-path-map.tsv（名称→文件，可复现）

IMPORTANT_FORM_FACT: 表情名形如 **[微笑C]** → **协议层是文本码、渲染层是图片**
  → 对 1:1 复现有直接影响：需要"文本码 ↔ 图片"映射与替换渲染，而不是把 emoji 当普通文字

IMPLEMENTATION_IMPACT: 仍建议 **冻结**
  形态差异成立（我方用文字字形），但"该画哪套图"取决于是否引入图片表情体系；
  且我方现有实现与"文本码+图片"双层形态不同，属较大变更，宜**另立工作单**