# 审核 60：WO#15 **PASS/CLOSED** + WO#16 **APPROVED WITH SCOPE CORRECTION**

> 时间：2026-09-22 14:19（Round 267）｜提交时间：2026-09-22 12:16
> 提交内容：① WO#15 最后一条 Gate（MAP_MARKER_CARD_DATA_AUTHORITY）+ 能红的证明
> ② WO#16 计划（含一处"两页口径冲突"的裁定请求）
> ⚠️ 中间遭遇**本地断电**（服务端未受影响）；恢复后重新激活审核通道并取得本裁定。

## 一、裁定汇总（原文要点）

```
WO15_MAP_MARKER_AUTHORITY:           PASS / CLOSED
WO16_SCHOOL_CAMPUS_PICKER:           APPROVED WITH SCOPE CORRECTION
  COUNT_POLICY:                      A
  BASELINE-DERIVED SCHOOL/CAMPUS SEEDING: APPROVED
  SEARCH_CONTENT_SCALE_DIFFERENCE:   ACCEPTABLE / DOCUMENTED
  API_SHAPE:                         /api/schools + /api/schools/:id/campuses
```

### 1.1 WO#15 正式关账
```
MAP_MARKERS_FROM_AUTHORITY:                PASS
MARKER_COUNT_MATCHES_POSTS_WITH_VALID_COORDS: PASS
OFFLINE_RENDERS_NO_GEO_MARKERS:            PASS
NO_FABRICATED_PLACE_DATA:                  PASS
MAP_NO_FALLBACK_ON_UNAVAILABLE:            PASS
MAP_MARKER_CARD_DATA_AUTHORITY:            PASS
WO15:                                      PASS / CLOSED

之前保留的 fidelity 状态继续成立，不影响本 WO 关闭：
  ORIGINAL_MARKER_CARDINALITY / ORIGINAL_PIN_COLOR_SEMANTICS /
  ORIGINAL_FULL_MARKER_PRESENTATION_CONFORMANCE /
  OFFLINE_MAP_PROJECTION_CONFORMANCE —— 均 NOT_EVALUATED
```
⭐ 审核对本次敏感度的评价（值得记）：
> "你这次 sensitivity 很好，因为它不是'把文本改空'，而是真正重现：
>  real marker → wrong mock post lookup …
>  这正证明 Gate 对**数据源身份错误**有判别力，而不是只对空值有判别力。"

### 1.2 ⭐ 问 0：两页口径冲突 —— **我查得对，审核更正了自己**
> "我之前说'原版顶部是当前学校的校区列表'，**准确对象是 MapScreen，不应泛化到 CampusScreen**。"

冻结为：
```
MapScreen:   顶部 = 当前学校（校区），例「北京交通大学（校本部）▼」
             点击 → 当前学校的校区列表 + 搜索其他学校
CampusScreen: 副标题 = 「校园广场 ▼」 —— **不是当前学校名**
⇒ CampusScreen.tsx 当前显示 mock 学校名「北京交通大学」是偏差，**应修**。
```
`A-D-LIST.md:220` 那条笼统的"✅ 一致"应**收窄**（不是整条删掉）：
```
Campus switcher presence/rough structure:  PARTIAL
subtitle text:                            MISMATCH
    current  = 北京交通大学
    original = 校园广场 ▼
mock school/member data:                  MISMATCH / unsupported
```
> "除非 A-D-LIST 当时还有独立证据证明下拉内部内容完全一致，
>  否则不能继续保留一个笼统的'✅ 一致'。"

### 1.3 ⭐⭐ 对本单层次划分的**关键修正**（我原计划里有错）
> "有一个进一步的边界：FeedList 的 HIDE/DEFER 裁定**不能机械复制**成
>  'CampusScreen 整块顶部控件消失'。CampusScreen 已有基线证明「校园广场 ▼」本身存在。
>  因此层 A 应做的是：
>    · 保留 baseline-supported「校园广场 ▼」presentation
>    · 移除/禁止 mock 8-school menu 与 mock members
>    而不是把整个标题/入口删掉。"

⇒ 我原计划把层 A 写成"照 FeedList 那样 HIDE/DEFER 切换器"是**过度**的；已按此修正。

### 1.4 §四计数：选 **A**（我倾向的那项）
```
不要给现有 4 条 post 强行补 campus attribution。
冻结：
  posts.school_campus_id:  keep NULL where unknown
  campus feed count:       COUNT(posts WHERE school_campus_id = campus.id)
  if attribution unavailable:  count = unavailable/null —— **NOT 0 / NOT inferred / NOT fabricated**
⭐ 尤其重要：
  place = 北京交通大学  只能说明一个地理 POI，**不能推出** school_campus = 校本部
  ⇒ 不要把 3 条"北京交通大学 POI"的帖子算到校本部
UI：**推荐计数字段不渲染**，而不是显示"0条校园圈"；
    若为解释原因需要状态，必须标为 **OUR_DESIGN_CHOICE**，不得说成原版 presentation
未来真实 attribution 有数据后：COUNT(posts.id) GROUP BY school_campus_id —— 不需要冗余列
```

### 1.5 Q1：允许用基线观察到的三个校区做种子
```
批准：北京交通大学 ├─ 校本部 ├─ 威海校区 └─ 东校区
理由不是"为了把 UI 填满"，而是这些实体本身有明确原版观察证据。
但必须区分：
  seed entity existence:        SUPPORTED BY BASELINE
  current selected campus:      DO NOT INFER
  user campus membership:       DO NOT INFER
  post campus attribution:      DO NOT INFER
  campus post counts:           DO NOT COPY FROM ORIGINAL AS OUR LIVE COUNT
⇒ 可以种 schools / campuses；**不能**顺手种
  user.school_campus_id / post.school_campus_id / count
建议 seed metadata 明确写 **baseline-derived fixture**，以后不会被误认为从生产系统同步而来。
```

### 1.6 Q2：学校搜索页只有一个学校 —— 可以接受
```
SCHOOL_SEARCH_CONTENT_SCALE: DIFFERS_BY_DATA（赞成这个分类）
不要为了视觉丰富度加入 上海交通大学 / 浙江师范大学 / 上海视觉艺术学院 与 2502/329/15 等计数
  —— 那些是原版某次真实数据快照，不是我们 demo 必须复制的数据集。
真正要对齐的是**结构与语义**：学校名 (校区名) / 计数位置与语义 / 搜索入口 / 选择行为。
count 不可计算时：row structure: implementable ／ count semantics: known ／ count value: unavailable
不要为了"长得一样"填假数字。
```

### 1.7 API：两层
```
GET /api/schools                    → [{ id, name }]
GET /api/schools/:id/campuses       → [{ id, name, campusCircleCount: number | null }]
⚠️ campusCircleCount = null 的语义必须明确：
   「当前无法由 authoritative attribution 计算」—— **不是"0条"**
不要在本单增加 address、成员数之类没用到的字段。
```
理由是 domain 本身是 `School 1 → N Campus`，两层比 `/api/campuses?schoolId=` 更明确表达层级，
且不会把"全局 campus 搜索"与"某学校的 campuses"混成一个接口。

### 1.8 WO#16 的收束范围（审核给定）
```
Layer A
  · CampusScreen 不再显示 mock school name / 8-school dataset / member counts
  · subtitle 对齐为「校园广场 ▼」
  · 保留已有基线支持的入口形态
  · FeedList 与 CampusScreen 均不得用 mock school data
Layer B
  · seed 北京交通大学 + 3 个 observed campuses
  · GET /api/schools ／ GET /api/schools/:id/campuses
  · MapScreen 的学校/校区选择采用 authoritative entities
  · school search page 使用 authoritative entities
  · count unavailable 时不伪造
```

### 1.9 ⭐ 本单必须留的 Gate
```
PLACE_DOES_NOT_IMPLY_CAMPUS
Sensitivity：故意写 "post.place == 北京交通大学 → 自动归属校本部" ⇒ Gate **必须 FAIL**
理由（审核原话）：
  "因为这正是当前最容易为了'让数字出来'而重新引入的**数据伪造路径**。"
```

## 二、审核自身的提醒（我照做）

> "ChatGPT 可能会出错。请核查重要信息。"

⇒ 本轮我据以行动的关键事实**都已用仓库内证据交叉核对**：
```
· CampusScreen 副标题应为「校园广场 ▼」
    依据：docs/test/original-baseline/screens/trident-campus/baseline.json 的
          interactions[1]「顶部：大标题 Campus + 副标题「校园广场 ▼」+ 右上消息气泡」
    ✅ 已核对（我 Round 267 自己查出来的，不是转述）
· place 推不出 campus
    依据：posts.place_id → places.name = "北京交通大学"（学校名，非校区名）；
          migration 004 注释明确「未知就表示未知，不伪造归属」
    ✅ 已核对
· A-D-LIST.md:220 需收窄
    依据：该行原文是笼统的"✅ 一致"，而其中「subtitle text」实际是 MISMATCH
    ✅ 已核对（原文见 docs/pending/m5/A-D-LIST.md:220）
```
