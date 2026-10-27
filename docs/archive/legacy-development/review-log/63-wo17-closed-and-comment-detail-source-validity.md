# 审核 63：WO#17 **PASS / CLOSED**；并按审核要求做了 comment-detail 的 **Source Validity** 检查（**已由权威证据裁决**，且揭示一处更大的保真问题）

> 时间：2026-09-22 22:29（Round 318）｜我提交：22:44 前（WO#17 完成 + 4 问）

## 一、裁定汇总

```
WO17_POST_IDENTITY_AND_COMMENT_AUTHORITY:  PASS / CLOSED
POST_IDENTITY_CORRUPTION:                  RESOLVED
COMMENTS_DOUBLE_DATA_SOURCE:               REMOVED
MOCK_COMMENT_DATA_IN_PRODUCTION:           REMOVED      ← 认可我把 mock 评论数据整体移出 mock.ts
COMMENT_FAKE_LOCAL_WRITE:                  RESOLVED      ← 认可 send() 改走真实 createComment
```
> "这单已经完成原定 A1，而且**没有把范围扩成'重做评论系统'**。
>  下一步继续按全局 closeout 路线进入 WO#18 / A2，**不要围绕 WO#17 再扩新的方法学支线**。"
> "**因此不需要再给 WO#17 增加 Gate。**"

对敏感度的评价：
> "最关键的是你没有只证明'CommentsScreen 能加载'，而是直接验证了 identity invariant：
>  **requested post A ≠> silently render post B**。
>  …恢复历史 `legacyMockPosts.find(...) ?? legacyMockPosts[0]` 后**只有 Comments 侧相关四键变红、
>  Feed 侧保持 PASS**，这个归因很干净。"

对 mock 数据移出的评价：
> "这是对之前原则的一致应用：**production code → should not contain importable fabricated business data**。
>  仅仅'当前没有 import'并不能消除以后重新接回去的风险。"

### ⭐ 一条保持的原则（关于 send() 成功后的 UI）
> "成功后的 UI 应来自**服务端返回结果**或**重新读取的权威结果**，
>  而不是 API 200 后再拿本地 draft 拼一个'看起来像服务端 comment'的对象。"
⇒ 我的实现是成功后 `await load()` **重新读取** ⇒ 合规。审核补充："如果现有 createComment
  已经返回 authoritative created comment，就直接使用即可。**不要为此再开新 WO 或新 Gate 专项。**"

## 二、三个未解决项的分开处置（审核给的裁定）

```
① FEED_DETAIL_ERROR_PRESENTATION:  **KNOWN_MISMATCH**（登记，不再是 evidence gap）
   审核原话："你已经有 original observed / current —— 所以它现在已经是一个明确的 fidelity gap，
   不是 evidence gap。**不要为了它重新进入原版。**"
   ⚠️ 并要求："404/not_found 和网络错误是不是原版同一个 presentation，目前可以继续**分别记录**；
      **不要为了改一句文案把两种错误语义重新混起来**。"
   ⇒ 不阻塞 WO#17。

② COMMENT_DETAIL_EMPTY_STATE:      **已由权威证据裁决**（见 §三）—— 不必进 A3/A4
   审核要求先做 Source Validity："authoritative manifest → supplement/recovered evidence → supersedes/provenance。
   如果权威 evidence 已经能裁决，就直接用已有证据。"

③ COMMENT_AVATAR_AUTHORITY:        UNAVAILABLE → **HIDE**（我已这么做，审核确认正确）
   COMMENT_LIKE_COUNT_AUTHORITY:   UNAVAILABLE → **HIDE**（同上）
   NEW API WORK (DB schema / comment API / avatar subsystem / comment-like model): **DEFER**
   审核原话："等最终 fidelity audit 时，如果已有原版证据明确证明这些是目标页面必要可见 contract，
   再开最小 read-model extension。如果只是视觉细节或证据仍不足，就继续 NOT_EVALUATED / capability gap。"
   ⚠️ "**特别不要**现在因为 WO#17 又暴露了'评论还有头像/点赞数'而停下来扩评论域。"

下一步顺序（审核给定，与我已完成的状态对照）：
```
WO17: CLOSED                                              ✅ 已关账
NEXT: WO18_POI_SEARCH_AUTHORITY                           ✅ 本轮已完成（待提交裁定）
THEN: bounded evidence pass for A3/A4
      (+ comment empty-state **only if** existing evidence cannot resolve it)   ← 已被裁决，无需
THEN: targeted fidelity closeout / A5
```
> "当前目标是逐个消灭 M5 已知 blocker，而不是把每个处理过的页面提升到无限完整。"

---

## ⭐⭐ 三、Source Validity 检查的结果（已裁决 —— 且揭示一处**更大的**问题）

审核只让我"查权威证据"。查完的结果比预期更重：

```
docs/test/original-baseline/supplements/comment-detail.json：
  "activity": "com.kairuotu.feed.detail.FeedDetailActivity（评论区**内联**在动态详情页，不是独立 Activity）"
  "activity_note": "M0 记录的 CommentDetailActivity 需要参数，直接用 deep link 打开是空态。
                    真实形态是：评论区作为 ViewPager(id/vp_detail) 的一页**内联在动态详情里**。"
  "supersedes": {
    "file": "screens/comment-detail/baseline.json",
    "field": "known_unknowns（带参数时的结构未知）",
    "from": "「带参数时的结构未知」",
    "to": "已取得完整结构与层级证据（含父评论/子回复两套控件与嵌套关系）",
    "why_m0_missed": "M0 只用 deep link 打开（无参数 → 空态）；
                      真实入口是「信息流 → 动态详情 → 点评论数」，且需要该动态真的带评论。"
  }
```

### 3.1 空态冲突 ✅ **已裁决**（不必进 A3/A4）
```
基线 `comment-detail` 的「页面全白，无列表内容」
  ⇒ 是 **deep-link 无参数的假象**，而该 baseline 的 known_unknowns
     **已被 M3 supplement 显式 supersede**。
⇒ 所以"气泡图标 +「留下你的评论吧～」"与"页面全白"**不是同一个屏的两种说法**，
  而是**一个真实形态 vs 一个假象**。冲突消解。
```

### 3.2 ⭐⭐ 更大的发现：`#/comments` 独立屏**在原版里不存在**
```
原版的评论区是 **FeedDetailActivity（动态详情页）里内联的一页**（ViewPager id/vp_detail），
**不是独立 Activity / 独立屏**。
⇒ 我们却有一条独立路由 `#/comments` + 独立的 `CommentsScreen` ——
  这是一处**自造的屏**（结构层面，不是数据层面）。
  与队列里早已记录的"comments 路由可达但**无 in-app 入口**"是**同一件事的两面**：
  因为原版根本没有这个独立入口，我们自然也无法为它找到入口。
⚠️ 这不推翻 WO#17 的任何结论（身份篡改/双数据源**确实**都修好了），
   但它是一条**结构保真**层面的新 finding，应进 A3/A4 之后的 fidelity closeout。
⚠️ 依据 M3 的做法（真实入口 + 真实触摸 + 控件树）比 M0 的深链更权威 ⇒ 以 M3 为准。
```

### 3.3 M3 同时给出了**内联评论区**的完整控件证据（可用于后续对齐）
```
id/comment_number =「评论 N」（计数标题）
id/comment_college [28,373][1052,1749] —— 整个评论区容器
id/cl_feed_detail_comment_message —— 一条父评论的**整行容器**
  id/cl_feed_detail_first_comment —— 父评论本体
  id/iv_feed_detail_comment_avatar_image（**圆形头像**）
  id/tv_feed_detail_comment_username「幽灵小姐」
  …
（另有 recovered-m3-inline.png / recovered-m3-nested-reply.png 等**决定性证据**文件）
⇒ ⚠️ 注意：这说明**原版评论确实有头像**（`iv_feed_detail_comment_avatar_image`）。
   审核 63 的 `COMMENT_AVATAR_AUTHORITY: UNAVAILABLE → HIDE` 指的是
   "**我们的服务端**没有权威来源 ⇒ 先隐藏"，与"原版有头像"**不冲突** ——
   前者是**能力缺口**，后者是**目标形态**。两者都如实记录，不混淆。
```
