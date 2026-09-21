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

### 1. `CHAT_MESSAGE_SENDER_PRESENTATION` — **DEVIATION**（新登记）

```
observed: 自己发的图片消息渲染在左侧 peer 气泡里
来源:     WO#2 前端实现时发现（既有渲染逻辑，非本工作单引入）
审核裁定: 审核记录 25 —— "这是真实产品问题，但不是本工作单引入的"，
          应进入 M5 后续 A/D 清单，**不把 WO#2 无限扩张**
说明:     "我的消息 / 对方消息的布局区分"属于更一般的 chat presentation semantic，
          需要先只读观察原版在这方面的表现，再决定实现（**不要凭感觉加区分**）
```

### 2. 底部 tab 数量与「校园广场」的呈现模型 — **WITHDRAWN（2026-09-21 20:54 撤销）**

```
observed: ~~原版底部是 4 项~~ → **错误**：看 bounds 才知「校园广场」在**顶部区**(y≈130)，三个 tab 在底部区(y≈1829)。原版底部 = **3 个文字 tab**（自定义名称6/校园/地图）+ 右侧圆形发布按钮，**与我们一致**
证据:     docs/original-baseline/raw-dumps/board-observation-1.xml
补充:     该 tab 指向的页面**不是列表式 feed，而是拼贴照片墙（collage）**：
          collageView + view_image_container + view_user_tag（图片上的作者标签）
性质:     不只是"少一个 tab"，而是**该 tab 的呈现模型本身就不同**
未确证:   交互模型（点单图去哪 / 标签是否可点 / 是否分页）**尚未确证**，需新的只读观察
```

### 3. 留言板表情行 — 四项

| 子项 | 状态 | 说明 |
|---|---|---|
| 项数 / 宽 / pitch / 首末边界 | **FIXED** | 6 项、70 / 112（设备 px）逐项与原版吻合；CSS 40px + gap 24px，设备实测确认 |
| 底色（C5） | **FIXED** | 原版无底色（像素采样圆内点亦纯白）；我们原有灰色圆片 → 已改为 transparent |
| 字号（C6） | **FIXED** | 16px → 24px（据实心字形墨迹外接的**直接测量**；估计值，残余不确定已标注） |
| **字符与形态（C4）** | **UNRESOLVED + FREEZE（审核记录 26 确认，此前裁定作废）** | 此前依据节点 id `emotion_image` 判为"原版是图片"。**但那是照 id 名字下判断**（本项目已因此在 C1/C2 栽过两次），且视觉读图显示边缘特征更像**字体渲染**。两份证据冲突 → 降为 UNRESOLVED，见 `docs/m5/C4-EVIDENCE-CONFLICT.md`。**决定性检验（渲染对比）待做。** |

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
成立:   C4 表情形态（图片 vs 文字）—— 待裁定实现方式
成立:   CHAT_MESSAGE_SENDER_PRESENTATION（自己消息渲染在 peer 气泡）
撤销:   底部 tab 4 vs 3（实为**误数**：把顶部栏目当成了底部 tab；我们的 3 tab + FAB 发布按钮与原版一致）
阻断:   C3 下拉刷新（BLOCKED_BY_POLICY）
撤销:   C1 顶部按钮、C2 留言总数（被只读观察推翻）
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
校园广场呈现模型    原版两列瀑布流拼贴 + 作者标签      我们 column-count:2 瀑布流   ✅ 一致
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