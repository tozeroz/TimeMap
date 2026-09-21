# WO#11 计划：FeedListScreen（动态列表）接线 —— **字段级 inventory 先行**

> 时间：2026-09-22 04:39｜Round 261｜依据：审核记录 50/51 的方法（先 inventory、字段级判断）
> 状态：**待审核批准**

## 〇、与 WO#10 的**性质区别**（先说清楚，避免套错方法）

```
WO#10（MessageScreen 推荐区/分享面板）：后端**没有能力**
   → 处置是"**移除假能力**"（删 mock 行、删假 CTA、隐藏假入口）

WO#11（FeedListScreen）：后端**已经有能力**
   → 处置是"**接线**"（把页面接到 GET /api/posts），**不是**删除
   → 但必须叠加一个**数据清理**步骤（见 §1.3，这是本单的关键风险）
```

## 一、✅ 字段级 inventory（**逐条实测**）

### 1.1 现状：整页 mock

```
app/src/screens/FeedListScreen.tsx
  行 4  : import { campusInfo, posts } from '../data/mock'   ← **整页读 mock**
  行 18 : const [failed, setFailed] = useState(true)          ← 失败态起点（需核对语义）
  行 92 : {posts.map((p) => ...)}                             ← 渲染 mock 动态
  行 96 : 已加载全部 · {campusInfo.posts} 条动态               ← mock 计数
```
这是本项目"**打开 App 第一眼就看到假数据**"最严重的一处。

### 1.2 后端能力（实测：**已存在**，与 WO#10 的情形根本不同）

```
路由清单（server/src/index.ts 实测）：
  GET    /api/posts
  GET    /api/posts/:id
  GET    /api/posts/:id/comments
  POST   /api/posts
  POST   /api/posts/:id/comments
  POST   /api/posts/:id/like
  DELETE /api/posts/:id/like

GET /api/posts 实测响应（登录后 HTTP 200, application/json）：
  顶层键: ['items']      items 数: 24
  单条字段: id / author / authorId / body / place / createdAt /
            likeCount / commentCount / likedByMe / images[]
  样例: {"id":"7ac5fec3-…","author":"anmoss","authorId":"11111111-…",
         "body":"TLS 日志泄漏检查（可忽略）","place":"北京交通大学",
         "createdAt":"2026-09-21T09:31:12.629Z","likeCount":0,"commentCount":0,
         "likedByMe":false,"images":[]}

⚠️ 匿名访问 /api/posts 也返回 **HTTP 200 + 数据**（不需要登录）—— 见 §四 待裁定项。
```

### 1.3 ⚠️⚠️ 本单的**两个关键风险**（都已实测）

#### 风险 A：库里 20/24 条是测试残留

```
posts 表实测 24 行，其中：
  · 4 条  像样的种子内容（"而我不再觉得，孤独是一种遗憾。"等）
  · **20 条测试残留**：形如
        "M1-E2E-<epoch> 这是一条垂直切片验证帖"      （10 条）
        "TLS 日志泄漏检查（可忽略）"                  （10 条）
  关联表：comments=2 / likes=2 / post_media=2

→ 如果**直接接线**，FeedList 会把 20 条测试垃圾**渲染成用户可见内容**。
  那就从"显示假数据"变成"显示脏数据" —— 并没有更好，反而更难解释。
→ 因此本单**必须**包含数据清理，并在 Gate 里加反向断言：
  可见 feed 里不得出现测试残留形态的内容。
```

#### 风险 B：`campusInfo` 里有**凭空编造却看起来极具权威性的数字**

```
app/src/data/mock.ts:499-504
  export const campusInfo = {
    name:   '北京交通大学',
    region: '北京市·海淀区',
    members: '12,486',      ← ❌ **编号的会员数**
    posts:   '38,920',      ← ❌ **编造的动态数**
  }

真实库：users = **3**、posts = **24** —— 与上面的数字差几个数量级。
→ 这两个数字**不是"未接线"，而是"假权威"**：它们看起来像平台级统计，
  且会被渲染在页面顶部，读者会合理地理解为"这个学校有 12486 人在用"。
  这正是 WO#10 冻结判据要清掉的那一类内容。
→ 处置：**不显示这两个数字**（不造来源）。name/region 另见 §四.4。
```

#### 风险 C：刷新用 mock **冒充成功**

```
app/src/screens/FeedListScreen.tsx:17-20
  const [failed, setFailed] = useState(true)     ← 默认进入"网络错误"态
  文件头注释（行 12-15）如实说明：原版这一页强依赖后端，
  无网络/无登录时进入就是「网络不给力，点击刷新试试」页（这是模拟器实测的真实界面）；
  "demo 是纯本地的，所以点「刷新」后展示本地 mock 内容，把这个状态闭环掉。"

→ 即：**点「刷新」→ 展示 mock → 看起来"刷新成功"**。
  这与 WO#10 删掉的好友申请"假成功"（点发送 → 显示"已申请"，零请求）**结构相同**。
  区别在于：这次我们**确实有**后端（GET /api/posts 已存在），
  所以正确做法是**刷新真的去取数据**，而不是拿 mock 顶上。
→ 初始"失败态"本身保留（它如实复刻了原版在网络异常时的界面），
  但"刷新"必须变成真实请求，且请求失败时**停在失败态**（不得用 mock 冒充成功）。
```

### 1.4 逐字段判定

| field | mock 现状 | 真实来源存在？ | 处置 |
|---|---|---|---|
| 正文 | mock | ✅ `body` | **接线** |
| 作者名 | mock | ✅ `author`（服务端已 join display_name） | **接线** |
| 作者 id | mock | ✅ `authorId` | **接线** |
| 地点 | mock | ✅ `place`（text） | **接线** |
| 时间 | mock | ✅ `createdAt`（ISO） | **接线** |
| 点赞数 | mock | ✅ `likeCount` | **接线** |
| 评论数 | mock | ✅ `commentCount` | **接线** |
| 我是否赞过 | mock | ✅ `likedByMe` | **接线**（需带 token） |
| 图片 | mock | ✅ `images[]`（但**当前所有样例都是空数组**） | 接线渲染骨架；**无图时不得显示假图** |
| 作者头像 | mock | ❌ **无 avatar 列** | **首字占位**（与 MessageScreen/群聊一致） |
| 作者学院 / 年级 | mock | ❌ 无列 | **不渲染**（不造列） |
| 「已加载全部 · N 条动态」的 N | mock | ✅ 可用 `items.length`（或真实总数） | **接线** |
| 顶部 `campusInfo.members` = '12,486' | mock | ❌ **无来源（且真实值差几个数量级）** | **不显示**（假权威） |
| 顶部 `campusInfo.posts` = '38,920' | mock | ❌ **无来源（同上）** | **不显示**（假权威） |
| 顶部 `campusInfo.name` / `.region` | mock | ⚠️ `schools(id,name,region)` 表**存在但为空**；`users.school_campus_id` **全为 NULL** | 见 §四.4 |
| 刷新按钮的行为 | mock（冒充成功） | ✅ 有真实接口 | **改成真实请求**；失败则停在失败态 |

## 一之二、⚠️ **入口溯源**：FeedListScreen 只能经 **demo 脚手架**到达

实测（`scripts/m5/diagnose-feedlist-entry.mjs` + `diagnose-feedlist-path.mjs`）：

```
FeedListScreen 的路由是 #/feedlist，其**唯一**入径是：
  MeScreen（个人页 #/me）
    → 左上角「三横线」→ Drawer
      → Drawer 末尾「更多功能」       ← ⚠️ **demo 脚手架**
        → #/more → 「校园圈」（to: 'feedlist'）
          → #/feedlist

证据（app/src/components/Drawer.tsx）：
  行 19 注释：「末尾额外保留一个「更多功能」入口，用于访问 demo 的其余页面（**非原版内容，单独标注**）」
  行 46-54：该按钮类名 `drawer__item--demo`，内部渲染 `<span className="drawer__badge">demo</span>`

→ 即：**这个页面的可达性来自一处自述为"非原版"的脚手架**。
  按 ENTRY REACHABILITY 纪律（审核记录 44），这条链**不构成忠实可达性**：
  它能证明"页面本身能打开"，但**不能**证明"原版用户能从真实入口走到它"。

冻结论断：
  FEED_ENTRY_PROVENANCE: DEMO_SCAFFOLD
  ORIGINAL_FEED_ENTRY:   NOT_EVALUATED（原版这一页的真实入口尚未取证）

⚠️ 这**不**否定本单的价值：FeedListScreen 的内容本身对应原版实测界面
  （文件头注释记录了"无网络/无登录时进入就是「网络错误」页"这一模拟器实测结果），
  而它当前整页是 mock —— 接线本身仍然是必要的。
  但**入口的忠实性**属于另一件事，应另立工作单（需要先取证原版入口），
  且本单的 Gate **不得**把"demo 脚手架可达"写成"用户可达"。
```

## 一之三、⭐ **已冻结的原版基线**（`docs/original-baseline/screens/feed-list/`）

项目里**已有**该页的原版基线，含 `baseline.json` + `normal.png`。
`baseline.json` 全文（**证据级**，非线索级）：

```json
{
  "screen_id": "feed-list",
  "title": "校园圈",
  "target_route": "campusx://feed/list",
  "activity": "com.kairuotu.feed.list.FeedActivity",
  "entry": { "preconditions": ["app_launched"], "steps": ["deep link campusx://feed/list"] },
  "states": {
    "loading": { "status": "not_reproducible", "evidence": [] },
    "empty":   { "status": "not_reproducible", "evidence": [] },
    "normal":  { "status": "not_reproducible", "evidence": [] },
    "error":   { "status": "observed", "evidence": ["normal.png"] }
  },
  "interactions": [
    "顶部「校园圈」+「北京交通大学 ▼」+ 左上关闭",
    "中央：网络错误图标 + 「网络不给力，点击刷新试试」+ 刷新按钮"
  ],
  "navigation": ["关闭 → 返回上一页", "刷新 → 重新请求"],
  "persistence": ["无"],
  "known_unknowns": ["有后端且已登录时的正常列表长什么样（本机无法进入）"]
}
```

### 它带来的三条结论

**① 证实了我们的 3 处忠实度偏差**（原为线索级，现升为**证据级**）
| 项 | 原版基线 | 我们的实现 | 判定 |
|---|---|---|---|
| 标题 | **「校园圈」** | 无标题（中间只放学校名） | ❌ 缺标题 |
| 中间 | 「北京交通大学 **▼**」（学校 + 下拉） | 有学校名 + chevron | ✅ 基本一致 |
| 左侧 | **左上关闭**（X，语义=关闭） | `IconBack` + `aria-label="返回"` | ❌ 图标与语义都不对 |
| 右侧 | **未提及**（基线只列"左上关闭"） | 「发布」+ 号按钮 | ⚠️ 需再取证（基线未覆盖右侧） |
| 导航 | **关闭 → 返回上一页** | `goBack('campus')` | ✅ 语义一致 |

**② 基线本身也**没有**建立真实 UI 入口**
```
"entry.steps": ["deep link campusx://feed/list"]
```
它也是用**深链**进入的 —— 与我在设备侧发现的 `DEMO_SCAFFOLD` 是**同一类缺口**：
两者都只证明了"页面能打开"，都**不能**证明"原版用户从哪个控件走到它"。
→ 我此前的 `ORIGINAL_FEED_ENTRY: NOT_EVALUATED` 得到**独立佐证**：连项目自己的基线都没拿到入口。

**③ ⚠️ 最重要的范围限制：原版的"正常列表"从未被观察到**
```
states.loading / empty / normal: 全部 not_reproducible
known_unknowns: "有后端且已登录时的正常列表长什么样（本机无法进入）"
"error": observed（normal.png 实为错误态截图）
```
→ 即：**原版 feed 的正常列表形态（条目布局、有无图片、计数位置、下拉加载等）没有任何基线可比对**。
   因此本单接线后，"显示真实数据"这一结果**不能声称与原版一致** ——
   它只能声称"数据来源是真实的"。
   凡是"列表条目长什么样"的忠实度断言，必须标 `ORIGINAL_NORMAL_LIST: NOT_EVALUATED`。

**④ 另有一条**支持**我原定断言的证据**
```
"navigation": ["刷新 → 重新请求"]
```
→ 原版语义明确：**刷新就是重新请求**。
   这直接支持 `FEED_REFRESH_IS_REAL`（而当前实现是"刷新→零请求→显示 mock"，与原版语义相反）。

### ⚠️ 一条自我更正（我差点报一个不存在的缺陷）
我最初用 PowerShell `Get-Content` 读这份 json，看到的是乱码 `"title": "鏍″洯鍦?`，
一度以为是"仓库里的证据文件编码损坏"。用 `read` 工具读同一文件 → **完好 UTF-8**。
→ 那是 **PowerShell 控制台的编码问题，不是仓库缺陷**。
   教训（与既有纪律同源）：**读证据必须用可靠通道**；
   从不可靠通道得到"异常"时，先怀疑通道，再怀疑对象。

## 二、方案（分层，与 WO#8 会话列表同法）

```
层 1（本单做）：**接线 + 三态**
  · 列表来自 GET /api/posts（**绝对 origin**，按已冻结纪律）
  · 三态必须明确可辨：加载中 / 失败（可重试） / 空（明确空态，不含无来源业务断言）
  · 空输入/失败**不得**回退到 mock（与 WO#9B 层 A 的"旧数据不得冒充成功"同一纪律）
  · 头像改首字占位；无来源字段（学院/年级）不渲染
  · 分页/下拉刷新：**只有当接口确实支持**才做；否则不发明（见 §四）

层 2（本单做）：**数据清理**
  · 清除 posts 表里的 M1 E2E 残留（"M1-E2E-*" 与 "TLS 日志泄漏检查*"）
  · 连带清理其 comments / likes / post_media
  · 清理前**先打印将删内容**（可审计），清理后打印基线
  · ⚠️ 这是一次**不可逆的数据操作** → 先备份该表快照（pg_dump 单表）

层 3（**不做**，另立工作单）：
  · 发帖 / 评论 / 点赞的**写路径**（接口存在，但属于独立的一单：
    UI 入口、乐观更新、失败回滚、权限与审计都需要单独设计）
  · 本单只做**只读列表**
```

## 三、Gate（须可失败；PREFERRED + REQUIRED 双证据）

```
改前（当前状态，应 FAIL）：
  FEED_FROM_API                  FAIL（当前整页 mock）
  FEED_NO_MOCK_ROWS              FAIL（当前渲染 mock 动态）
  FEED_THREE_STATE_EXPLICIT      FAIL（无真实加载/失败/空三态）

改后（层 1）：
  FEED_FROM_API                  列表项 id 集合 == GET /api/posts 的 items[].id 集合（**集合级**）
  FEED_SECTION_ORDER_CONTINUITY  UI 顺序与 API 顺序一致（沿用 WO#8 的命名先例）
  FEED_NO_MOCK_ROWS              不渲染任何 mock 动态（fixture 反向断言）
  FEED_THREE_STATE_EXPLICIT      加载/失败/空三态可辨（失败态与空态**不得混同**）
  FEED_FAILURE_NO_STALE_MASQUERADE 先成功加载 → 请求失败 → **不得**继续展示旧的列表冒充成功
                                 （沿用 WO#9B 层 A 已冻结的同名纪律）
  FEED_AVATAR_PLACEHOLDER        头像为首字占位（非 mock 生成的 SVG）
  FEED_NO_SOURCELESS_FIELDS      不渲染学院/年级等无来源字段
  **FEED_REFRESH_IS_REAL**       「刷新」触发**真实请求**（不是用 mock 冒充成功）：
                                 用 fetch 计数证明点击刷新时**确实发出了请求**；
                                 且请求失败时**停在失败态**（不得展示 mock 内容）
                                 ⭐ 原版基线 `navigation: ["刷新 → 重新请求"]` **直接支持**这条
  FEED_NO_FAKE_AUTHORITATIVE_NUMBERS
                                 DOM 里**不得出现** "12,486" / "38,920" 这类编造的统计数字

改后（层 1b：原版基线支持的**忠实度**断言 —— 证据级）
  FEED_TITLE_IS_CAMPUS_CIRCLE    标题逐字 == **「校园圈」**（基线 `title`）
  FEED_LEFT_CONTROL_IS_CLOSE     左上控件是**关闭**语义（基线 `interactions`："左上关闭"）
                                 当前实现是 `IconBack` + `aria-label="返回"` → **改前即 FAIL**
  FEED_CLOSE_RETURNS_PREVIOUS    点关闭 → 返回上一页（基线 `navigation`）
  FEED_RIGHT_CONTROL: NOT_EVALUATED
                                 ⚠️ 基线**未提及**右侧控件；我们先不动，标 NOT_EVALUATED
                                 （不去猜"应该有/不应该有"，也不据此删掉现有按钮）
  ORIGINAL_NORMAL_LIST: NOT_EVALUATED
                                 ⚠️ **重要范围限制**：基线里 loading/empty/**normal 全部
                                 not_reproducible**，`known_unknowns` 明写"正常列表长什么样
                                 （本机无法进入）"→ **原版正常列表形态无基线**。
                                 故本单**不得**声称"列表条目形态与原版一致"，
                                 只能声称"数据来源是真实的"。
改后（层 2，数据清理）：
  FEED_NO_TEST_RESIDUE           可见 feed 里**不得**出现 "M1-E2E-" / "TLS 日志泄漏检查" 形态
                                 （这是**反向断言**：防止将来测试数据再次泄漏到用户界面）
反向（防悄悄回退）：
  NO_LEGACY_MOCK_IDS_IN_FEED     DOM 里不出现 fixture 里的 legacy mock id / 昵称
回归：
  MESSAGE_SCREEN_REGRESSION（WO#10）／THREAD_LIST（WO#8）／GROUP（WO#9A）／
  COMPOSER（WO#7）／SERVER_REGRESSION（先部署 + sha256 + 账本）
前置（新版 runner 自动执行）：VISUAL_TARGET_VALIDITY / ARTIFACT_PROVENANCE / API_E2E_ORIGIN_VALIDITY
敏感度：
  · 临时把 mock 列表渲染回来 → FEED_NO_MOCK_ROWS 必须 FAIL；恢复 → PASS
  · 临时往库里插一条 "M1-E2E-probe" → FEED_NO_TEST_RESIDUE 必须 FAIL；删除 → PASS
  · 临时把 '12,486' 渲染回页面 → FEED_NO_FAKE_AUTHORITATIVE_NUMBERS 必须 FAIL；恢复 → PASS
  · 把「刷新」的 onClick 临时改回"只翻转本地 state、不发请求" →
    FEED_REFRESH_IS_REAL 必须 FAIL（fetch 计数为 0）；恢复 → PASS
类型：scripts/m5/check-types.sh 必须 PASS（**用真实叶子配置**，不是 tsc --noEmit）
```

## 四、需要审核裁定

```
1. **匿名访问 /api/posts 返回 200 + 动态数据** —— 这是既有行为（不是本单引入）。
   问题：feed 是否应当公开？
     · 若是（校园广场语义）→ 记录为 OUR_DESIGN_CHOICE 并保持
     · 若否 → 属于安全项，应另立单（改权限口径会影响已通过的 Gate）
   我不在本单里擅自改它。请指示。

2. **数据清理的授权**：删除 20 条测试残留需要你确认 ——
   它们是我自己在 M1 阶段做的 E2E 验证帖，**不是别人或用户的数据**，
   但删除是**不可逆**的。我会先 `pg_dump` 备份该表再删。可以吗？

3. **分页**：`GET /api/posts` 当前有没有 limit/游标？（我会在实现前确认形状。）
   如果没有，本单**不做**分页，只渲染一次返回的全部（与接口能力一致）。
   「已加载全部」这句文案是否要保留？（它与"一次性加载"的语义相符，但**原版行为未取证**）

4. **顶部校园信息条（`campusInfo.name` / `.region`）**：
   实测 `schools(id, name, region)` 表**存在但为空**，`users.school_campus_id` **全为 NULL**。
   因此"北京交通大学 / 北京市·海淀区"当前**无权威来源**。
   三个可选处置（我倾向第 1 个）：
     ① **不显示**该条（与 §1.3 风险 B 一致：没有来源就不显示）
     ② 保留但标注为 OUR_DESIGN_CHOICE 的静态文案（会看起来像业务数据，不推荐）
     ③ 先补 schools/campuses 的种子数据再接线（属于**新决策**：学校数据从哪来，
        不应由本单临时决定）
   请指示选哪个。

5. **`FEED_NO_FAKE_AUTHORITATIVE_NUMBERS`** 这条反向断言是否要加？
   我计划加，用来专门防止"编号的会员数/动态数"这类**假权威数字**再次出现
   （它们比"未接线的空字段"危险得多 —— 读者会当成平台真实统计）。
```

## 五、明确不做

```
❌ 不做发帖/评论/点赞（写路径另立单）
❌ 不给 users 加 avatar/college/grade（同 WO#10 硬边界）
❌ 不声称原版 feed 的行为（只读范围内只有 UI 存在性证据）
❌ 不在本单改 /api/posts 的权限口径（见 §四.1）
```
