# 审核 64：WO#18 **PASS / CLOSED**；F-001 升级为 **CONFIRMED FIDELITY BLOCKER**（并纠正"删掉路由就算修完"的理解）

> 时间：2026-09-22 23:06（Round 318）｜我提交：22:39（WO#18 完成 + Source Validity + 3 问）

## 一、裁定汇总

```
WO18_POI_SEARCH_AUTHORITY:       PASS / CLOSED
COMMENTS_TOPOLOGY_FINDING:       CONFIRMED FIDELITY BLOCKER
POI_LEGACY_TYPE_REMOVAL:         APPROVED
```

### 1.1 WO#18 关账
> "A2 的目标已经完成：PoiSearchScreen 不再读取 mock POI；GET /api/places 提供权威地点；
>  搜索在服务端完成；postCount 来自真实 posts.place_id，没有再使用假数字；距离不再使用 mock 常量；
>  legacy POI 数据退出生产代码；sensitivity 确实能把旧 mock 数据源接回去时打红。"
> "`POI_DISTANCE_ABSENT_WITHOUT_FIX: NOT_EVALUATED` **不阻塞**本 WO。
>  这个 WO 的 blocker 是'地点列表仍是假的'，不是要求现在把地理测距的所有边界状态全部证明完。"

⚠️ **一条只做记录的要求**（我已在实现中遵守）：
> "`postCount` 目前如果 UI 没展示，**就不要因为 API 已经有这个字段而顺手把它加进界面**。
>  它是权威数据，但**不是自动产生的新 UI contract**。"
⇒ 我确实**没有**把 postCount 接进任何 UI（只在 API 里存在）。

### 1.2 ⭐ F-001：**选 (a)**，且给出**关键纠正**
> "你这次 Source Validity **已经足够强**，不需要再放回 A3/A4 做原版观察。"
> 证据链：`M0 direct deep link → 无参数空态 → 较弱/错误观察入口` vs
> `M3 recovery → 真实入口 → FeedDetailActivity → ViewPager 内联评论区 → 完整控件树 → explicit supersedes`

```
ORIGINAL_COMMENT_TOPOLOGY:  CONFIRMED = **inline within FeedDetail**
CURRENT:                    separate CommentsScreen / #/comments
```

⭐⭐ **必须记住的纠正（否则会把修法做小）**：
> "但是**请不要把修复理解成：'删掉 #/comments 就完成了。'** 真正的产品[目标]是让 comments
>  作为用户页面的结构[内联]。
>  如果 #/comments 只是 Gate/调试为了方便直接打开页面，可以把**测试方式迁到 FeedDetail 的真实
>  comment surface**；**不要为了测试方便永久保留一个原版不存在的产品页面。**"

⭐⭐ 并且**销掉一条长期遗留项**：
> "所以 A4 里原来的：'comments 路由可达但没有入口' **现在可以销掉，不需要再观察**。
>  它已经被更强的结论取代：**没有入口并不是'入口还没找到'，而是因为原版根本不是独立 comments screen**。
>  这点非常重要。"

### 1.3 不重开 WO#17
> "这一结构发现**不会改变** `WO17: PASS / CLOSED`。WO#17 证明的是：
>  不再发生 post A → post B 的身份替换；comment 数据已经权威化；fake local comment write 已消除。
>  这些修复**仍然完全有效**。**WO#19 只是把已经正确的数据/身份逻辑放回正确的信息架构位置。**"

### 1.4 评论头像/点赞：**仍不要趁 WO#19 扩 API**
```
original comment avatar:      **OBSERVED**（不再是"原版有没有"的未知问题）
TARGET_PRESENTATION:          avatar exists
CURRENT_AUTHORITY:            unavailable
CURRENT IMPLEMENTATION:       hidden
⇒ 这是一条明确的 fidelity / capability gap
```
> "我仍然**不建议**现在为了 WO#19 同时扩 comment avatar/like 数据模型。
>  WO#19 先解决：**评论区在哪儿**。不要顺便扩成'评论所有字段都 1:1'。否则又会回到局部过度收敛。
>  头像/点赞进入最终 A5/fidelity backlog，届时决定它们是否构成最终 1:1 blocker。"

### 1.5 删除死的 `Poi` 类型：认可
> "完全一致于之前几单的依赖治理原则：legacy fake dataset removed + its fake-data-only shape
>  no longer has consumers → **remove both**。如果未来需要权威 POI 类型，应从 `ApiPlace`
>  或真实 domain model 定义，而不是**复活 legacy Poi**。" ⇒ **不用回退**。

---

## 二、审核给出的全局队列（⚠️ 其中 A3/scanner 我**本轮已经做完**）

```
WO18: CLOSED                                    ✅
NEXT: WO19 FeedDetail inline comments topology  ⬅ 下一步
THEN: A3/A4 bounded observation
      - Drawer「去认证」        ⚠️ **Round 318 已完成**（→ F-003）
      - scanner entry           ⚠️ **Round 318 已完成**（原版抽屉「扫一扫」；我们缺该入口）
      - media-preview entry     ⬅ 仍未做
      # comments 从这一观察单中移除   ✅ 已按审核 64 销掉
THEN: A5 targeted fidelity closeout
```
⚠️ 审核写这份队列时**还没看到**我本轮的 A3/A4 结果（我提交 WO#18 时 A3/A4 尚未开始）。
⇒ 需在下次提交里明确告知：**A3 与 scanner 已做完**，并把 media-preview 留作唯一剩余观察项。

> "这里有一个值得坚持的全局原则：**这次不要重新研究 comment-detail 页面**。
>  证据已经足够，下一步是**修已确认的结构偏差**，而不是继续取证。"

---

## 三、我据此采取的动作（本轮）

```
1. 把 F-001 的状态从"待裁定修法"升级为 **CONFIRMED FIDELITY BLOCKER**，
   并把审核的两条纠正**逐字**写进 backlog：
     · 修法**不是**删掉 #/comments，而是让 comments 成为 FeedDetail 的**内联结构**
     · Gate/调试通路应迁到 **FeedDetail 的真实 comment surface**，
       不为了测试方便永久保留一个原版不存在的产品页面
2. 销掉队列里的"comments 路由可达但无入口"（已被更强结论取代）
3. 立项 **WO#19**：FeedDetail inline comments topology
   ⚠️ 只解决"评论区在哪儿"，**不**扩评论字段（头像/点赞仍走 backlog）
4. A3/scanner 的观察结果已落盘（docs/archive/legacy-development/m5/A3A4-BOUNDED-OBSERVATION.md），
   其中 F-003 是**新发现的保真缺陷**（原版认证页是表单「填写认证信息」+「下一步」）
```
