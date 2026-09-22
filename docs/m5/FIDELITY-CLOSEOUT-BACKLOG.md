# M5 最终关账待办（fidelity closeout backlog）

> 本文件汇集**"已确认、尚未修"的保真缺口**与**已裁决的结论**，供最终 fidelity audit 逐个销项。
> 建立于 Round 318（审核 63 要求登记 `FEED_DETAIL_ERROR_PRESENTATION: KNOWN_MISMATCH`）。
> ⚠️ 与 `KNOWN-DEVIATIONS.md` 的分工：
> · `KNOWN-DEVIATIONS.md` = **我们主动后撤/未做**的（有意为之，有批准记录）
> · 本文件 = **已知不一致 / 已知结构错误**（是缺陷，等待修）

---

## 一、结构保真缺陷（**已知、待裁定修法**）

### F-001 ⭐⭐ `#/comments` 独立屏在原版里**不存在**（评论是内联的）

```
状态：  KNOWN_STRUCTURAL_MISMATCH（待裁定修法；**不是** evidence gap）
发现：  Round 318，做审核 63 要求的 Source Validity 检查时发现
依据：  docs/original-baseline/supplements/comment-detail.json （**权威**）
        "activity": "com.kairuotu.feed.detail.FeedDetailActivity
                     （评论区**内联**在动态详情页，不是独立 Activity）"
        "activity_note": "M0 记录的 CommentDetailActivity 需要参数，直接用 deep link 打开是空态。
                          真实形态是：评论区作为 ViewPager(id/vp_detail) 的一页**内联在动态详情里**。"
        "supersedes": { file: screens/comment-detail/baseline.json,
                        field: known_unknowns（带参数时的结构未知）,
                        why_m0_missed: "M0 只用 deep link 打开（无参数 → 空态）" }
        ⚠️ M3 的证据强度：**真实入口 + 真实触摸 + uiautomator 控件树（含 bounds + DOM 层级）**
           ⇒ 比 M0 的 deep-link 观察**更权威**。
现状：  我们有独立路由 `#/comments` + 独立 `CommentsScreen` —— **结构层面自造的屏**。
关联：  队列里长期记着的"comments 路由可达但**无 in-app 入口**"是**同一件事的另一面**
        —— 原版没有这个独立入口，我们自然也为它找不到入口。
⚠️ 不推翻 WO#17：身份篡改与双数据源**确实**都修好了（那是**数据层**问题，这是**结构层**问题）。
参考修法：把评论区改为**内联在 `#/feed`（FeedDetailScreen）里的一页**，
        并移除独立 `#/comments` 路由（或其保留为内部跳转）。⚠️ 需裁定后动。
```

### F-002 `FEED_DETAIL_ERROR_PRESENTATION: KNOWN_MISMATCH`

```
状态：  KNOWN_MISMATCH（审核 63 明确裁定为**fidelity gap，不是 evidence gap**）
发现：  Round 317（WO#17 期间）
依据：  docs/original-baseline/screens/feed-detail/baseline.json
        error 态（status=observed, evidence=normal.png）=
        「中央：网络错误图标 + **「网络不给力，点击刷新试试」+ 刷新按钮**」
现状：  我们显示「网络错误」/「这条动态不存在（可能已被删除）」+ 刷新
审核裁定（63）：
  · "**不要为了它重新进入原版**"（证据已足够，不必再观察）
  · ⚠️ "404/not_found 和网络错误是不是原版同一个 presentation，目前可以继续**分别记录**；
       **不要为了改一句文案把两种错误语义重新混起来**。"
⇒ 即：**文本与呈现要对齐**，但**不要**因此把"内容不存在"与"网络失败"两种语义合并。
```

---

## 二、已裁决的结论（**不再是未决项**，留档以免重复研究）

### R-001 ✅ comment-detail 空态冲突 —— **已由权威证据裁决**

```
冲突：  基线 `comment-detail` 的空态（observed）=「**页面全白，无列表内容**」
        vs CommentsScreen 原注释声称「气泡图标 +「留下你的评论吧～」」
裁决：  基线那一条是 **deep-link 无参数的假象**（该 baseline 的 known_unknowns
        已被 supplements/comment-detail.json 显式 `supersedes`）
        ⇒ 两者**不是同一屏的两种说法**，而是「**真实形态 vs 假象**」。
⇒ 冲突消解，**不必**进 A3/A4 的有界观察（审核 63："如果权威 evidence 已经能裁决，就直接用已有证据"）
```

### R-002 ✅ 评论头像 / 点赞数 —— **UNAVAILABLE → HIDE**（审核 63 裁定）

```
COMMENT_AVATAR_AUTHORITY:      UNAVAILABLE → **HIDE**（已如此实现）
COMMENT_LIKE_COUNT_AUTHORITY:  UNAVAILABLE → **HIDE**（已如此实现）
NEW API WORK:                  **DEFER**
```
⚠️ **必须与目标形态区分开**（否则会误读成"原版没有头像"）：
```
原版**确实有**头像：supplements/comment-detail.json 记录
  `id/iv_feed_detail_comment_avatar_image`（圆形头像）
⇒ 「原版有头像」= **目标形态**
   「我们先隐藏」= **当前能力缺口**（服务端 ApiComment 无头像字段）
   **两者不冲突**，分别记录，不混淆。
```
审核原话："等最终 fidelity audit 时，如果已有原版证据明确证明这些是目标页面必要可见
contract，再开最小 read-model extension。如果只是视觉细节或证据仍不足，就继续
NOT_EVALUATED / capability gap。"

---

## 三、能力缺口（服务端暂无权威来源，已按纪律"不渲染"）

```
G-001 评论作者头像：ApiComment 无头像字段 ⇒ **不渲染**（WO#17 起）
G-002 评论点赞数：无服务端来源 ⇒ **不渲染数字**（WO#17 起）
G-003 地点 `category`（院系/教学楼/超市…）：无权威来源 ⇒ 接口**不返回**、UI 不渲染（WO#18 起）
      ⚠️ 原版 POI 页是否有分类位：**未观察** ⇒ `ORIGINAL_POI_CATEGORY_PRESENTATION: NOT_EVALUATED`
G-004 地点 `distance` 的"**无定位 ⇒ 不渲染**"这条分支
      ⇒ 代码上已实现（fix===null ⇒ 返回 null ⇒ 不渲染 span），
        但模拟器**有**定位 ⇒ **夹具构造不出来** ⇒ Gate 里记 NOT_EVALUATED（WO#18）
```

---

## 四、与 `M5-GLOBAL-COMPLETION-AUDIT.md` 的关系

该审计列的 A1（CommentsScreen 一真一假）/ A2（PoiSearchScreen mock）**已完成**：
```
A1 → WO#17：PASS / CLOSED（审核 63）
A2 → WO#18：已实现、门禁 7 键 + 敏感度通过、已提交裁定
```
⇒ 下一步按审核 63 给的顺序：**A3/A4 的有界只读观察** → 然后 **targeted fidelity closeout / A5**。
（A3/A4 = `DrawerPages` 的「去认证」错跳；`scanner`/`media-preview`/`comments` 三屏的**原版入口**；
  ⚠️ A4 要注意审核 62 的提醒：「存在原版 screen baseline」≠「我们知道它的**用户入口**」
  ⇒ 必须把 **destination correctness** 与 **entry reachability** 分开。
  现在 `comments` 那一条已被 F-001 解答：**它的原版入口根本不存在**（评论内联）。）
