# M3 Slice 4 报告：recovered pages 的集成与一致性

> 依据：审核记录 11（`M3 Slice 4: GO` + PRECONDITION：先做证据来源审计）
> 完成时间：2026-09-21（Asia/Shanghai）
> Gate：`scripts/gates/m3/slice0b.ps1` 第 6.8 组 → **M3_SLICE4_GATE_RESULT: PASS**

## 一、结论（按审核记录 11 的**分层**口径，不是整页一个结论）

```
M3_PRECONDITION_RESULT: PASS
M3_SLICE0B_GATE_RESULT: PASS
M3_SLICE1_GATE_RESULT:  PASS
M3_SLICE2_GATE_RESULT:  PASS
M3_SLICE3_GATE_RESULT:  PASS
M3_SLICE4_GATE_RESULT:  PASS

  POI_DETAIL_PAGE:               ACCEPTED
  POI_DETAIL_VISUAL:             PASS（证据只读取得，可逐项比对）
  POI_DETAIL_AGGREGATION:        PASS（places + posts.place_id 聚合）
  PLACE_ID_NOT_FABRICATED:       PASS（未知地点 place_id 保持 NULL）
  AT_PANEL_VISUAL_CONFORMANCE:   NOT_EVALUATED reason=CONFORMANCE_EVIDENCE_INADMISSIBLE
  MEDIA_PREVIEW_VISUAL:          NOT_EVALUATED reason=CONFORMANCE_EVIDENCE_INADMISSIBLE
  MEDIA_UPLOAD_AND_SEND_TRANSITION: BLOCKED_BY_POLICY

  baseline coverage: remains 22/0（本切片只增加 integration coverage）
```

**口径说明（审核记录 11 明确要求）**：Preflight 已把 baseline coverage 变成 `22/0`，
Slice 4 **不得再改这个数字**；本切片增加的是 **integration coverage**
（我们自己的实现与证据对齐的页数）。两个覆盖率从此分开报。

## 二、前置条件：证据来源审计（已完成）

`docs/pending/m3/EVIDENCE-PROVENANCE-AUDIT.md` 逐页判定，结论：

| 类别 | 页面 | 可作一致性依据？ |
|---|---|---|
| 只读取得 | `poi-detail`、登录页、学校/校区、地图、消息页、动态详情、发布页结构、点赞展示规则 | ✅ 可以 |
| 依赖第三方写操作 | `at-panel`（依赖建群）、`media-preview`（依赖建群+发图）、群聊页、`comment-detail` 的**层级部分** | ❌ 只能当设计线索 |

三份受影响证据已加 `conformance_evidence=INADMISSIBLE`，
**Gate 里也有机械检查**（必须标 INADMISSIBLE + 审计文档必须存在）。

## 三、本切片做的事

### 1. 后端：让"按地点聚合动态"成为可能

- 新增 `GET /api/places/:id` → 地点本体（name/address/经纬度）+ 该地点的动态列表 + postCount
- **发帖时把地点文本对到已知地点并写 `place_id`**

为什么这步是必需的：原版 poi-detail 是**按地点聚合动态**的页面，
而聚合只能靠 `place_id`。此前只存文本 `place`，所以"该地点的动态"永远查不出来 ——
这是一个**真实缺口**，不是锦上添花。

匹配不上就保持 NULL：**不伪造地点归属**（与 `author_id` 同一原则：未知就是未知）。
未知地点的文本 `place` 仍然保留，不丢信息。

### 2. 前端：poi-detail 按证据重排

依据 `supplements/poi-detail.json`（只读取得，**可采信**）：

```
地点名（大号加粗、占满宽度）
距离「距我N公里」+ 完整地址（同一行，距离在左）
该地点的动态图片 + 作者标签叠在图片上
```

**删掉了证据里不存在的内容**（此前按想象加的）：
中部统计（几条动态 / 人来过 / 分类）、「在这里发动态」「给这里留言」两个按钮、
「最近来过」区块、「地点」中心标题。

## 四、验证

### 后端 `scripts/m3/verify-places.sh` → `PLACES_RESULT PASS`（15 条断言）

- 地点详情返回 name/address/经纬度/posts
- 边界：不存在 → 404；非法 id → 400
- **发帖带已知地点名 → `place_id` 落库**（聚合的前提）
- **该新帖出现在地点详情的动态列表里**（端到端聚合）
- 未知地点 → `place_id` 为 NULL、文本保留（不伪造归属）
- 清理测试帖子与账号

### 设备端 `scripts/m3/device-slice4-poi.mjs` → `SLICE4_POIDETAIL_CONFORMANCE PASS`（11 条）

正面断言：地点名、「距我N公里」、完整地址、该地点动态（3 条）、图片上的作者标签。
**反向断言**：证据里没有的内容一个都不许出现
（人来过 / 在这里发动态 / 给这里留言 / 最近来过 / 条动态 / 中心标题）。

反向断言是这一页的关键 —— 它防的是"又按想象往页面里加东西"。

## 五、如实记录的偏差与限制

| 项 | 说明 |
|---|---|
| 「距我N公里」的参照点 | 本 demo **不申请设备定位权限**，用校区坐标作演示参照点。原版用真实定位 —— **这是一处偏差，不算作一致** |
| 「距我0公里」 | 当前库里只有「北京交通大学」一个地点，它正好就是参照点，所以算出 0 公里。**数值是对的但退化了**；原版那条是广州的地点（距我4公里）。要让这条更接近原版内容，需要再补一条非校内的地点种子（下一轮） |
| 动态图片 | 我们没有媒体上传（M4），所以用作者头像色块占位。原版是真实照片 —— 图片内容层面**不声称一致** |
| `at-panel` / `media-preview` 的视觉一致性 | 证据不可采信 → `NOT_EVALUATED`，**不是**把整页判死；页面本身 ACCEPTED、功能正常 |

## 六、证据

| 文件 | 内容 |
|---|---|
| `docs/pending/m3/evidence/places-*.txt` | 后端 15 条断言 |
| `docs/pending/m3/evidence/gate-slice4-*.txt` | 完整 Gate（六个 key 全绿） |
| `docs/pending/m3/EVIDENCE-PROVENANCE-AUDIT.md` | 证据来源审计（本切片前置） |
| `scripts/m3/verify-places.sh`、`scripts/m3/device-slice4-poi.mjs` | 断言脚本 |
