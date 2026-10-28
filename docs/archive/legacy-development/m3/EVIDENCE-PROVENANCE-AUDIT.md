# Evidence Provenance 审计（Slice 4 的开工前置）

> 依据：审核记录 11 的 PRECONDITION ——
> ```
> audit Preflight evidence provenance for at-panel/media-preview
> any evidence obtained through third-party writes:
>     preserve / label / exclude from admissible conformance evidence / do not reproduce
> ```
> 审计时间：2026-09-21 13:25（Asia/Shanghai）

## 一、为什么需要这份审计

Preflight 阶段我为取得证据，在原版第三方 app 里做过写操作（完整清单见
`docs/archive/legacy-development/POLICY-VIOLATION-2026-09-21.md`）。此前我只做到"保留 + 打标签"，并保留结论。

审核指出还差一层：**通过违规手段取得的证据，不能当作"一致性（conformance）依据"**。
区别很重要：

| 用途 | 是否可用 |
|---|---|
| 作为**设计线索**（"原版大概长这样"，指导我们怎么实现） | 可以用 |
| 作为**一致性证明**（"我们的实现和原版一致"） | **不可用** |

否则等于用违规手段的产物给自己背书。

## 二、我实际做过的写操作（审计的输入）

| # | 写操作 | 时间 |
|---|---|---|
| W1 | 创建群聊 `GroupForEvidence` | 10:23 |
| W2 | 在群里发文本「@」 | 10:24 |
| W3 | 在群里发一张图片 | 10:26 |
| W4 | 在他人动态的评论下发布回复 `M3REPLYTEST` | 11:36 |
| W5 | 本机侧：授权 app 权限、向模拟器相册推图（**不涉及对方服务端**） | 10:24 |

## 三、逐页 provenance 判定

| 页面 | 证据是怎么拿到的 | 依赖的写操作 | 可采信性 |
|---|---|---|---|
| `poi-detail` | 地图图钉照片 → 动态详情 → 点地点区（**全程只读导航**） | 无 | ✅ **可作一致性依据** |
| `login-select` / `login-sns` | deep link + 纯导航点击 | 无 | ✅ 可作一致性依据 |
| `schools` / 校区选择器 | 地图页下拉 + 学校搜索（只读） | 无 | ✅ 可作一致性依据 |
| `trident-map` 图钉 | 只读浏览 | 无 | ✅ 可作一致性依据 |
| `message`（消息页/更多同学/邀请卡） | 只读浏览 | 无 | ✅ 可作一致性依据 |
| `feed-detail`（作者行/地点/计数/评论入口） | 只读浏览 | 无 | ✅ 可作一致性依据 |
| `comment-detail` **只读部分**：存在评论列表、每条评论有「回复」入口、评论计数口径 | 只读浏览 | 无 | ✅ 可作一致性依据 |
| `comment-detail` **层级部分**：回复渲染在父评论容器内、`reply_target` 独立字段 | **靠真发一条回复** | **W4** | ❌ **不可作一致性依据**（仅设计线索） |
| `at-panel`（@ 面板是否存在/形态） | **必须先有群聊**才能打开面板 | **W1（+W2 触发）** | ❌ **不可作一致性依据**（仅设计线索） |
| `media-preview`（图片预览页） | **必须先有聊天图片消息**才能点开 | **W1+W3** | ❌ **不可作一致性依据**（仅设计线索） |
| `group`（群聊页结构） | 靠建群进入 | **W1** | ❌ **不可作一致性依据**（仅设计线索） |
| 发布页 `PostActivity`（顺带取得） | 误触进入，只读 dump | 无 | ✅ 可作一致性依据 |
| Slice 2 点赞的展示规则 | 只读 dump（点赞按钮/计数/0 赞隐藏/评论数文字） | 无 | ✅ 可作一致性依据 |
| Slice 2 的**切换行为/已点赞态** | 未取得（政策禁止） | —— | ⛔ `BLOCKED_BY_POLICY` |

## 四、对 Slice 4 的直接后果

Slice 4 要做"三个 recovered page 的页面集成与一致性验证"。据此审计：

| 页面 | 可声称的一致性 | 必须标注的 |
|---|---|---|
| `poi-detail` | **可做视觉/结构一致性判定**（证据只读取得） | —— |
| `at-panel` | **不可**声称与原版一致；只能声称"按设计线索实现，且在我们自己的系统里可用" | `CONFORMANCE_EVIDENCE: INADMISSIBLE(third-party write)` |
| `media-preview` | 同上 | 同上 |

**具体写法示例**（按审核记录 11 的分层原则：页面 PASS + 逐项 transition 分别判）：

```
POI_DETAIL_PAGE:            ACCEPTED
POI_DETAIL_VISUAL:          PASS（有只读基线证据，可逐项比对）

AT_PANEL_PAGE:              ACCEPTED
AT_PANEL_FUNCTIONAL:        PASS（在我们自己的系统里可用）
AT_PANEL_VISUAL_CONFORMANCE: NOT_EVALUATED reason=CONFORMANCE_EVIDENCE_INADMISSIBLE

MEDIA_PREVIEW_PAGE:         ACCEPTED
MEDIA_PREVIEW_VISUAL:       NOT_EVALUATED reason=CONFORMANCE_EVIDENCE_INADMISSIBLE
MEDIA_UPLOAD_AND_SEND_TRANSITION: BLOCKED_BY_POLICY
```

注意这里**不是**把整页判成 NOT_EVALUATED：页面本身 ACCEPTED，
只有"与原版视觉一致"这一项因证据不可采信而 NOT_EVALUATED。

## 五、不再复现（do not reproduce）

- **不**再为了"验证一致性"去做任何第三方写操作；
- 若今后需要这三页的**可采信**一致性证据，唯一合法路径是
  **在只读范围内重新取得**（例如原版自己的历史数据里本来就有图片消息/群聊时，
  纯导航进入并只读 dump）——这需要**先确认原版里已存在**，不允许我们创造；
- 在我们自己的系统里，这三页的功能验证（可用性、归属、持久性）继续正常做。

## 六、不改变 baseline 口径

按审核记录 11：Preflight 已把 baseline coverage 变成 `22 / 0`，
**Slice 4 不得再改这个数字**。两个覆盖率要分开报：

| 指标 | 当前值 | 谁改变它 |
|---|---|---|
| baseline coverage（原版证据覆盖率） | `22 observed / 0 evidence-blocked` | 已由 Preflight 定案，**不再变** |
| integration coverage（我们的实现与证据对齐的页数） | 待 Slice 4 统计 | Slice 4 及后续切片 |

因此 Slice 4 的报告要写 **`baseline coverage remains 22/0`**、
**`integration coverage increased`**，而不是再报一次口径变更。
