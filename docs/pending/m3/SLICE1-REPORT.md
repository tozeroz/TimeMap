# M3 Slice 1 报告：帖子详情 / 评论 / 回复

> 依据：审核记录 07 的切片顺序 + 记录 08 的 `M3 Slice 1 — GO`
> 完成时间：2026-09-21（Asia/Shanghai）
> Gate：`scripts/gates/m3/slice0b.ps1`（第 6.5 组）→ **M3_SLICE0B_GATE_RESULT: PASS**

## 一、结论

```
comments.parent_id   MODEL: SUPPORTED / PRESENTATION: EXPANDED
EVIDENCE_OBTAINED_BY_POLICY_VIOLATION = 真（见 §五）
COMMENTS_RESULT                      PASS（后端 20 条断言）
SLICE1_DETAIL / CARDTAP / COMPOSER / AUTHGATE_RESULT  全 PASS（设备端）
```

## 二、按实测语义实现的三条关键行为

| 实测事实（原版） | 实现 | 验证 |
|---|---|---|
| 「评论 N」**含回复** | `commentCount = count(*) from comments where post_id=$1`（不区分层级） | 后端断言 `commentCount=2`（1 顶层 + 1 回复）；设备端断言标题「评论 2」 |
| 回复渲染在**父评论内部**（嵌套，非平铺） | 递归 CTE 把每条评论归到其顶层祖先，顶层评论带 `replies` | 后端 `total=5` 且顶层数仍为 2；设备端 `.cmt__replies` 存在 |
| 回复行带「回复 <目标>」，目标来自**独立字段** | 服务端返回 `replyTo`（= `parent_id` 指向那条评论的作者），不是把 @某人 拼进正文 | 后端断言 `"replyTo":"Lemy"`；设备端断言显示「回复 Lemy」 |
| 回复可以再被回复 | `parent_id` 自引用外键，可指向任意一条评论；展示时归到同一顶层 | 后端断言"回复的回复 → 201 且不产生新顶层" |
| 回复编辑器标题「回复 @某人」、占位「留下我的回复...」 | 回复弹层按此实现（半屏卡片） | 设备端断言标题与占位符 |

**schema 无需改动**：`comments.parent_id` 早就是自引用外键（`ON DELETE CASCADE`），
与"可回复任意评论"的实测一致。这次是证据与既有设计相符，属于少见的省事。

## 三、接口

```
GET  /api/posts/:id            详情 + commentCount（含回复）+ likeCount
GET  /api/posts/:id/comments   递归 CTE 一次查完；顶层 + replies + replyTo + total
POST /api/posts/:id/comments   {body, parentId?}
                               author 只能来自会话；strict schema（多字段 400）
                               parentId 必须存在且**属于同一篇帖子**（跨帖 → 400）
```

安全/一致性断言：未登录 401、带 `author` 字段 400、空正文 400、跨帖 parentId 400、
库中作者 = 会话用户、写失败**绝不**本地假成功。

## 四、Gate 抓出的真实缺陷

### 1. 点卡片进详情，显示的**永远不是被点的那条动态**（PRODUCT_DEFECT）

`App.tsx` 只从路径段取参数（`route.path.split('/')`），而应用自己的跳转是
`navigate('feed', { id })` → `#/feed?id=<uuid>` → `param` 恒为 `undefined`
→ 落到 mock 默认值 `'p1'`。

**后果**：点任何一张卡片，打开的都是同一篇假帖子。这个 bug 在纯代码审查里
很难发现（两边各自看都没错），只有**真实点击一次**才会暴露。

修法：`id={route.query.id ?? param ?? ''}`（两种形式都认），并**删掉 mock 默认值** ——
没有 id 就显示"未指定动态"，不用假数据冒充。
回归用例：`device-slice1.mjs cardtap`（点第一张卡片 → 断言详情正文与卡片一致 + hash 带真实 id）。

### 2. 一条业务 SQL 写错，把全站打成不可用（PRODUCT_DEFECT）

`db.noteFailure()` 原本把任何非连接错误都标成 `terminal` 并置 `ready=false`
→ 一条评论查询的别名写错，就让**所有**业务路由返回 503，而且看不出是哪条路由坏了。

语义修正：`transient`（连不上/超时）才降级 ready；`terminal`（SQL 写错等）是**代码缺陷**，
只让该请求 500，就绪状态不受影响。`terminal` 的"不再重试"只适用于**迁移路径**。
根因是把"迁移错误分类"错误地套用到请求路径上（设计串味）。

### 3. 测试自身的状态泄漏（GATE_DEFECT）

`authgate` 用例失败过一次，看起来像"未登录仍能评论"。实际是上一轮 `composer` 留下的
回复弹层（**全屏遮罩 + autoFocus 输入框**）把点击接走了，文字进了回复框
→ 断言看到"什么都没发生"。**一个状态泄漏伪装成了产品缺陷。**

修法：测试先清理自己造成的初始状态（关弹层并断言已关），
再断言焦点确实落在目标输入框上。这条与"真机交互才能暴露问题"是同一类教训。

## 五、政策（第三方只读约束）——本切片同时完成了纠正

`comments.parent_id` 的证据是在**原版第三方 app 里做写操作**（发了一条回复）取得的。
用户已明确禁止该做法。处理方式：

- 证据的**结论保留**（层级来自 DOM 容器嵌套与独立 `reply_target` 字段，不依赖"是谁发的"）
- 但标注 `EVIDENCE_OBTAINED_BY_POLICY_VIOLATION`，5 份补充证据自曝 `POLICY_VIOLATION`
- 完整清单与补救选项：`docs/pending/POLICY-VIOLATION-2026-09-21.md`
- 规则已进目标、`PLAN.md` §3.1、§10（新增 `BLOCKED_BY_POLICY` 标签）
- M3 Gate 第 7 组强制检查"违规记录未被删除、证据自曝标签"

**今后同类验证的替代做法**：在我们自己的 demo（本切片的后端 + 设备端用例）里造数。
本切片的 `COMMENTS_RESULT` 与四个设备用例已经证明这条路完全可行 ——
层级、计数口径、回复目标这三条语义都在自建系统里被真实验证了。

## 六、离线降级边界（审核记录 07）

- 在线：**API = 权威数据源**
- 离线：只降级到**最后一次成功的 API 快照**（`writeSnapshot` 只在成功时写），UI 明确标注"离线"
- 既无网络也无快照：显示「网络错误 + 刷新」（与原版一致）
- 顺带收掉 `CampusScreen` 的"双真源"：在线不再混入 mock（改用 `feedAuthoritative()`）

## 七、证据文件

| 文件 | 内容 |
|---|---|
| `docs/pending/m3/evidence/comments-*.txt` | 后端评论验证（20 条断言） |
| `docs/pending/m3/evidence/gate-slice1-*.txt` | 完整 Gate 输出（含设备端四组） |
| `docs/test/original-baseline/supplements/comment-detail.json` | 原版评论区结构证据（含违规标注） |
| `scripts/m3/verify-comments.sh` | 后端断言脚本 |
| `scripts/m3/device-slice1.mjs` | 设备端四组用例（含点卡片回归） |
