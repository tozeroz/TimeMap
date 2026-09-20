# 审核记录 07：M3 设计审核（有条件批准）

> 提交物：`docs/m3/SPEC.md`（M3 工作单）
> 审核方：ChatGPT web（远程独立审核）
> 提交时间：2026-09-21 05:55（Asia/Shanghai）
> **结论：M3 DESIGN — CONDITIONAL APPROVAL**（1 个 P0 + 4 个 P1，无需重写工作单）

## 开工前必须补的 5 点（原文明列）

1. **显式记录 comment/like 从 M4 → M3 的 scope reallocation**（P0）；
2. Slice 0 保持第一，但先**观察** login semantics，再实现 UI；
3. 三个 blocked 页面提前做 **Evidence Preflight**，不要等 Slice 4 才第一次观察；
4. `comments.parent_id` 保持二元 schema 判定；「有层级但 UI 平铺」仍为 `SUPPORTED`；
5. 区分 **per-slice fast Gate** 与 **M3 final full regression Gate**。

## 五点的详细要求（已并入 `docs/m3/SPEC.md`）

### P0 · 范围迁移必须显式记录
上一版冻结边界写过「评论/点赞接口属于 M4」，M3 把他们提前了。提前本身合理
（否则无法真正验证 comments/likes 模型，也完不成这轮行为恢复），但必须写进 PLAN：

```
Milestone scope reallocation
Moved M4 → M3:
- text comment read/integration
- like write/state/count
Remains M4:
- media upload/storage/delivery
- media-specific behavior
- 其他仍属于媒体链路的能力
```
原因：为了让 M3 的 Data Model V0.1 validation 有**真实行为证据**，而不是只验证空 schema。
这样 M2 的历史边界仍然正确，M3/M4 当前边界也不互相矛盾。

### Slice 0 拆成 0A / 0B
```
Slice 0A — Observe & freeze login semantics
Slice 0B — Implement login UI/session integration
```
原因不是"登录页重要"，而是后续写操作都依赖它（Slice 2 点赞、Slice 3 发帖、后续评论写入）。
**Slice 0A 的铁律：必须先观察，再设计字段。**
如果原版其实是手机号验证码 / 学号 / 第三方身份，**不能**因为 M2 有 handle+password 就把原版 UI 倒推成用户名密码
—— M2 的 auth 机制是实现基础，**不是**原版 login semantics 的证据。

M3 最终必须有一条**完全不注入 session fixture** 的设备路径：
```
启动 App → login-select/login-sns → 登录 → /api/auth/me 正确 → 发帖/点赞 → DB ownership 正确
```

### Evidence Preflight（新增，前置）
不是"实现三个页面"，只做：真实入口进入 → 记录 route → 记录前置状态 → 截图/行为 → 交互路径 →
对数据模型可能产生的事实。优先级与影响：
- `poi-detail`：可能直接影响 `places` / 位置字段 / 地点详情关系 → 提前恢复
- `at-panel`：可能影响发布行为、用户选择、@ 语义 → **必须在 Slice 3 定稿前**恢复
- `media-preview`：对 M4 媒体模型影响最大 → 行为证据 M3 就拿到，为 M4 提供 frozen baseline

原 Slice 4 改名：`recovered-page integration / conformance`（证据应已更早恢复）。

**口径变更时机**：三个页面成功取得真实证据的那一轮，**当场**改成
`total 22 / observed 22 / evidence-blocked 0`，不要等 Slice 4 实现完。

### comments.parent_id：二元判定 + 独立展示维度
`SUPPORTED` 判定的是**数据关系是否真实存在**，不是 UI 是否用树形展示。
```
MODEL:        SUPPORTED | NOT_SUPPORTED
PRESENTATION: EXPANDED | FLAT | PARTIALLY_OBSERVED
```
反例（不能叫 SUPPORTED）：页面上出现"回复"二字，但没有证据说明回复关系被保存或指向某条 comment
—— 那只是线索，不是模型证据。
若最终无法判断：**不得创造 `MAYBE_SUPPORTED` 这种永久灰状态**；
执行状态可以是 `BLOCKED / INSUFFICIENT_EVIDENCE`，但那是
`MODEL_VALIDATION Gate HOLD`，**不能作为通过 M3 的 schema 结论**。

### offline fallback 收紧（防双真源复活）
- 尚未迁移页面：mock source 可以继续存在
- 已迁移页面：在线时 **API = authoritative source**；离线最多允许 **last successful API snapshot/cache**
- **禁止**：API 失败 → 塞一份 synthetic mock → UI 看起来仍像在线成功
- 写操作继续遵守 M1 原则：`POST/LIKE/COMMENT 失败 ≠ 本地假成功`；**M3 不引入 offline mutation queue**

### 两层 Gate（不要把重型验收当开发循环 smoke test）
```
每个 Slice Gate（快）：
  Persistent fast invariants + 相关 M2 regression + Slice-specific behavior
  + Model evidence + Scope + 必要 visual
  （若该 Slice 改 schema：+ migration + relevant constraints + seed convergence）

M3 Final Gate（全）：
  全部 M2 regression + 完整 constraints + 完整 seed + 完整 backup/restore
  + TLS + resource + all slice replay + visual + scope
```

### 四个模型假设要绑定解决时间点（不要攒到最后）
```
Slice 0 / 登录观察            → login-sns identity semantics
Evidence Preflight place 观察  → schools / places 相关判断
Slice 1                       → comments.parent_id
消息/群/留言真实入口观察        → message / group / board_note relation
```
一旦证据足够就**立即**给 SUPPORTED / NOT_SUPPORTED 并立即 migration，不积攒。

### Slice 3 的成功条件升级（不能只是重复 M1）
M1 已证明"发文字帖 → server → reload"，所以 Slice 3 必须证明更多：
```
真实登录 UI → 获得真实 session → PublishScreen → POST 不含 author/authorId
→ backend 从 session 解析 author_id → feed refresh → UI 显示正确 author snapshot
→ DB ownership 正确
且**不得注入 session fixture**
```

## 建议后的 M3 顺序（已冻结进 SPEC）

```
Evidence Preflight（poi-detail / at-panel / media-preview）  ‖  Slice 0A
        ↓
Slice 0  Login semantics → real login UI/session
        ↓
Slice 1  Post detail → comments → resolve comments.parent_id
        ↓
Slice 2  Likes state/count
        ↓
Slice 3  Authenticated text publish → no fixture
        ↓
Slice 4  Recovered-page integration / conformance
        ↓
M3 Final Gate
```
Evidence Preflight 与 Slice 0A 可以并行取证，不必做成大型新 milestone。

---

## 审核原文（完整）
结论：有条件批准 M3

总体方向是对的，而且比“把页面逐个接 API”强很多。M3 现在真正承担的是：

Behavior recovery + UI/API integration + Data Model validation

这个定义我接受。

开工前需要修正 1 个 P0 + 4 个 P1，不需要重写工作单。

P0：先处理 M3/M4 的范围迁移

上一版冻结边界明确写过：

评论 / 点赞接口属于 M4。

现在 M3 Slice 1/2 已经包含：

纯文本
comments
likes

我认为把纯文本评论和点赞提前到 M3 是合理的，因为否则你没法真正验证 comments / likes 模型，也无法完成这轮行为恢复。

但必须在 PLAN 中显式记录：

纯文本
Milestone scope reallocation

Moved M4 → M3:
- text comment read/integration
- like write/state/count

Remains M4:
- media upload/storage/delivery
- media-specific behavior
- 其他仍属于媒体链路的能力

并说明原因：

为了让 M3 的 Data Model V0.1 validation 有真实行为证据，而不是只验证空 schema。

这样 M2 当时的历史边界仍然是正确的，M3/M4 当前边界也不会互相矛盾。

1. Slice 0 登录应该放最前吗？

应该。保持 Slice 0 第一。

但我建议拆成两个逻辑步骤：

纯文本
Slice 0A — Observe & freeze login semantics
Slice 0B — Implement login UI/session integration

原因不是“登录页比较重要”，而是后续真正的写操作都依赖它：

纯文本
Slice 2 like
Slice 3 post
后续 comment write（如果本阶段实现）

如果不先完成登录 UI，后面的设备 E2E 还会继续靠：

injected session fixture

那 M3 就无法证明：

纯文本
真实 UI 登录
→ server session
→ authenticated action

所以 M3 最终必须有一条完全不注入 session 的设备路径。

例如：

纯文本
启动 App
→ login-select/login-sns
→ 登录
→ /api/auth/me 正确
→ 发帖/点赞
→ DB ownership 正确

这才是 M2 auth backend 到 M3 UI 的真正闭环。

但 Slice 0A 有一条重要规则

必须先观察，再设计字段。

如果原版实际是：

手机号验证码；
学号；
QQ/微信等第三方身份；
其他身份体系；

不要因为 M2 现在有一个 handle/password 测试认证，就把原版 UI 倒推成用户名密码。

即：

M2 auth mechanism 是实现基础，不是原版 login semantics 的证据。

2. 三个 evidence-blocked 页面不应该全部拖到 Slice 4

这里我建议修改。

既然现在已经有真实入口：

纯文本
poi-search
publish
...

那么证据恢复应该尽早做。

尤其因为这些页面可能影响 schema 判断。

我建议在正式实现切片前增加一个很小的：

纯文本
M3 Evidence Preflight

它不是“实现三个页面”，只做：

纯文本
真实入口进入
→ 记录 route
→ 记录前置状态
→ 截图/行为
→ 交互路径
→ 对数据模型可能产生的事实

优先级：

poi-detail：提前恢复

它可能直接影响：

纯文本
places
位置字段
地点详情关系

所以不要等到 M3 快结束才发现 places 模型理解错了。

at-panel：提前恢复

它很可能影响：

纯文本
发布行为
用户选择
@ mention 语义

因此至少必须在 Slice 3 发帖最终定稿之前恢复。

media-preview

它对 M4 的媒体模型影响最大。

页面集成可以继续留到后面，但行为证据最好 M3 就拿到，为 M4 提供 frozen baseline。

因此我会把原 Slice 4 改一下定义

不要再叫：

“三个页面 evidence recovery”

而改成：

recovered-page integration / conformance

因为 evidence 应该已经更早恢复。

而且非常重要：

一旦三个页面成功取得真实证据，observed 19 → 22 就应该当场改变口径。

不要等到 Slice 4 实现完才改。

即：

纯文本
证据恢复成功的那一轮开始：
total 22
observed 22
evidence-blocked 0

页面是否已经接完 API，是另一件事。

3. comments.parent_id 不需要增加第三种 schema 结论

你的例子：

原版确实存在回复层级，但 UI 没有展开层级

我的判定是：

SUPPORTED

因为你验证的是：

parent_id 这个数据关系是否真实存在。

不是：

UI 是否用树形视觉展示。

建议把结论拆成两个维度：

纯文本
MODEL:
SUPPORTED | NOT_SUPPORTED

PRESENTATION:
EXPANDED | FLAT | PARTIALLY_OBSERVED

例如：

纯文本
MODEL: SUPPORTED
Evidence: reply B explicitly targets comment A

PRESENTATION: FLAT
Evidence: UI renders both comments in one linear list

这时 parent_id 完全有理由留下。

什么情况不能叫 SUPPORTED？

只有类似：

页面上出现了“回复”两个字，但没有证据说明回复关系被保存或指向某一 comment。

这种只是线索，不是模型证据。

如果最终仍然无法判断：

纯文本
SUPPORTED / NOT_SUPPORTED

那么不要创造：

纯文本
MAYBE_SUPPORTED

这种永久灰状态。

应该是：

MODEL_VALIDATION Gate HOLD

也就是说第三种状态可以存在于执行状态：

纯文本
BLOCKED / INSUFFICIENT_EVIDENCE

但不能作为通过 M3 的 schema 结论。

4. offline fallback 必须再收紧一次定义

你现在写：

mock 不删除，逐页替换数据来源 + offline 降级

这里非常容易重新出现双真源。

M3 建议冻结：

尚未迁移页面
纯文本
mock source

可以继续存在。

已迁移页面

正常在线状态：

纯文本
API = authoritative source

离线降级最多允许：

纯文本
last successful API snapshot/cache

不能：

纯文本
API失败
→ 塞一份 synthetic mock
→ UI 看起来仍然像在线成功

尤其写操作继续遵守 M1 原则：

纯文本
POST/LIKE/COMMENT 失败
≠
本地假成功

不要在 M3 引入 offline mutation queue。

5. 不建议每个 Slice 都完整重跑整个 M2 重型 Gate

你的总体 M3 Gate：

纯文本
PERSISTENT
M2 REGRESSION
AUTH
SEED
BACKUP
TLS
RESOURCE
...

作为 M3 final gate 很好。

但如果每一个 Slice 都：

纯文本
pg_dump
fresh restore
全 seed convergence
完整 resource sampling

会开始变得昂贵，也更容易积累测试噪声。

建议分两层：

每个 Slice Gate
纯文本
Persistent fast invariants
相关 M2 regression
Slice-specific behavior
Model evidence
Scope
必要 visual

如果该 Slice 改 schema：

纯文本
+ migration
+ relevant constraints
+ seed convergence
M3 Final Gate

再完整跑：

纯文本
全部 M2 regression
完整 constraints
完整 seed
完整 backup/restore
TLS
resource
all slice replay
visual
scope

这样仍然保持“每切片审核”，但不把 heavyweight acceptance test 当成开发循环 smoke test。

6. 四个模型假设最好绑定到明确的解决时间点

不要等 M3 最后统一判断。

建议冻结：

纯文本
Slice 0
→ login-sns identity semantics

Evidence Preflight / place相关观察
→ schools / places 相关判断

Slice 1
→ comments.parent_id

消息/群/留言真实入口观察
→ message / group / board_note relation

每个一旦证据足够就立即：

纯文本
SUPPORTED / NOT_SUPPORTED

并立即 migration，不要积攒到最后一起改 schema。

7. Slice 3 仍有价值，但它现在应该证明比 M1 更多的东西

M1 已经证明过：

纯文本
发文字帖 → server → reload

所以 M3 Slice 3 不应只是重复 M1。

它的成功条件应该升级成：

纯文本
真实登录 UI
→ 获得真实 session
→ PublishScreen
→ POST 不含 author/authorId
→ backend 从 session 解析 author_id
→ feed refresh
→ UI 显示正确 author snapshot
→ DB ownership 正确

并且：

不得注入 session fixture。

这样 Slice 3 才真正有新的工程价值。

建议后的 M3 顺序

我建议最终冻结成：

纯文本
Evidence Preflight
    ├─ poi-detail
    ├─ at-panel
    └─ media-preview
        ↓
Slice 0
Login semantics → real login UI/session
        ↓
Slice 1
Post detail → comments
→ resolve comments.parent_id
        ↓
Slice 2
Likes state/count
        ↓
Slice 3
Authenticated text publish
→ no fixture
        ↓
Slice 4
Recovered-page integration/conformance
        ↓
M3 Final Gate

其中 Evidence Preflight 和 Slice 0A 可以并行取证；不用把它做成大型新 milestone。

最终判定

M3 DESIGN — CONDITIONAL APPROVAL

开工前修改以下 5 点即可：

显式记录 comment/like 从 M4 → M3 的 scope reallocation；
保留 Slice 0 第一，但先观察 login semantics，再实现 UI；
三个 blocked 页面提前做 Evidence Preflight，不要等 Slice 4 才第一次观察；
comments.parent_id 保持二元 schema 判定；“有层级但 UI 平铺”仍为 SUPPORTED；
区分 per-slice fast Gate 与 M3 final full regression Gate。

这五点补完后，我认为可以直接开始 M3 Evidence Preflight + Slice 0。


