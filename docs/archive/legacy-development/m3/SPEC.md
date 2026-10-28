# M3 工作单：垂直切片迁移（行为恢复 + UI/API 集成 + 数据模型验证）

> 前置：M2 **PASS / CLOSED**（审核记录 06）
> 设计审核：**记录 07 —— M3 DESIGN CONDITIONAL APPROVAL**（1 个 P0 + 4 个 P1，5 点已并入本文件）
> 方向（审核记录 06 第 8 节）：M3 不是"把剩余页面接 API"，而是
> **Behavior recovery + UI/API integration + Data Model validation**。

## 〇、范围迁移（P0，必须显式记录）

上一版冻结边界写过「评论 / 点赞接口属于 M4」。M3 把他们提前，必须作为一次
**milestone scope reallocation** 明确登记（已同步 `PLAN.md` 第四节）：

```
Moved M4 → M3:
- text comment read/integration
- like write/state/count

Remains M4:
- media upload / storage / delivery
- media-specific behavior
- 其他仍属于媒体链路的能力
```

原因：**为了让 M3 的 Data Model V0.1 validation 有真实行为证据，而不是只验证空 schema。**
这样 M2 的历史边界仍然正确，M3/M4 的当前边界也不会互相矛盾。

## 一、M3 的两条并行产出

```
A. UI/API integration evidence
     每个切片：真实 API + UI + 原版行为同时验证通过

B. Data Model V0.1 validation / revision evidence
     由真实入口观察**反推** schema，而不是让 schema 驱动 UI
```

## 二、四个待证假设：必须绑定解决时间点，不得积攒

| 假设 | 解决时点 | 结论枚举 |
|---|---|---|
| `login-sns` 真实身份语义 | Slice 0A（登录观察） | 观察到的身份体系（手机号/学号/第三方/…） |
| `places` / `schools` 相关判断 | Evidence Preflight（poi-detail 等） | `SUPPORTED→建表` 或 `NOT_SUPPORTED→保持文本` |
| `comments.parent_id` | Slice 1 | `MODEL: SUPPORTED / NOT_SUPPORTED` + `PRESENTATION: EXPANDED / FLAT / PARTIALLY_OBSERVED` |
| `message` / `group` / `board_note` 关系 | 消息/群/留言真实入口观察 | 两两关系结论，不一致立即 migration 修订 |

一旦证据足够就**立即**给结论并立即 migration。

**`comments.parent_id` 的判定规则（审核明确）**：
- `SUPPORTED` 判定的是**数据关系是否真实存在**，不是 UI 是否树形展示。
  「有层级但 UI 平铺」= `MODEL: SUPPORTED` + `PRESENTATION: FLAT`，`parent_id` 有理由留下。
- 不能叫 SUPPORTED 的情形：页面上出现"回复"二字，但没有证据说明回复关系被保存或指向某条 comment
  —— 那只是线索，不是模型证据。
- 若最终无法判断：**不得创造 `MAYBE_SUPPORTED` 这种永久灰状态**。
  执行状态可以是 `BLOCKED / INSUFFICIENT_EVIDENCE`，但那属于 `MODEL_VALIDATION Gate HOLD`，
  **不能作为通过 M3 的 schema 结论**。

## 三、执行顺序（记录 07 冻结）

```
Evidence Preflight（poi-detail / at-panel / media-preview）   ‖   Slice 0A（可并行取证）
        ↓
Slice 0   Login semantics（0A 观察 → 0B 实现）→ real login UI/session
        ↓
Slice 1   Post detail → comments → resolve comments.parent_id
        ↓
Slice 2   Likes state/count
        ↓
Slice 3   Authenticated text publish → **no fixture**
        ↓
Slice 4   Recovered-page integration / conformance
        ↓
M3 Final Gate
```

### Evidence Preflight（前置，不是"实现三个页面"）

只做：真实入口进入 → 记录 route → 记录前置状态 → 截图/行为 → 交互路径 →
**对数据模型可能产生的事实**。

| 页面 | 为什么提前 | 最晚时点 |
|---|---|---|
| `poi-detail` | 可能直接影响 `places` / 位置字段 / 地点详情关系 | 尽早（避免 places 模型理解错了才发现） |
| `at-panel` | 可能影响发布行为、用户选择、@ 语义 | **Slice 3 定稿之前**必须恢复 |
| `media-preview` | 对 M4 媒体模型影响最大 | M3 内拿到行为证据，为 M4 提供 frozen baseline |

**口径变更时机**：三个页面成功取得真实证据的那一轮，**当场**把报告口径改成
`total 22 / observed 22 / evidence-blocked 0`，不要等 Slice 4 实现完。
（页面是否已接 API 是另一件事。）

### Slice 0 拆成两步

```
Slice 0A — Observe & freeze login semantics
Slice 0B — Implement login UI/session integration
```

**Slice 0A 的铁律：必须先观察，再设计字段。**
如果原版实际是手机号验证码 / 学号 / QQ/微信第三方 / 其他身份体系，
**不得**因为 M2 现在有 handle+password 就把原版 UI 倒推成用户名密码
—— M2 的 auth 机制是实现基础，**不是**原版 login semantics 的证据。

M3 结束时必须有一条**完全不注入 session fixture** 的设备路径：

```
启动 App → login-select/login-sns → 登录 → /api/auth/me 正确
        → 发帖/点赞 → DB ownership 正确
```

### Slice 3 的成功条件（不能只是重复 M1）

M1 已证明"发文字帖 → server → reload"。Slice 3 必须证明更多：

```
真实登录 UI → 获得真实 session → PublishScreen
→ POST 不含 author/authorId → backend 从 session 解析 author_id
→ feed refresh → UI 显示正确 author snapshot → DB ownership 正确
且**不得注入 session fixture**
```

## 四、offline fallback（收紧，防双真源复活）

| 情形 | 允许 |
|---|---|
| 尚未迁移页面 | mock source 可以继续存在 |
| 已迁移页面·在线 | **API = authoritative source** |
| 已迁移页面·离线 | 最多允许 **last successful API snapshot/cache** |

**禁止**：API 失败 → 塞一份 synthetic mock → UI 看起来仍像在线成功。
**写操作**继续遵守 M1 原则：`POST / LIKE / COMMENT 失败 ≠ 本地假成功`。
**M3 不引入 offline mutation queue。**

## 五、M3 Gate：两层

### 每个 Slice 的快 Gate

```
Persistent fast invariants
+ 相关 M2 regression（只跑与该切片相关的组）
+ Slice-specific behavior
+ Model evidence（该切片负责的假设结论）
+ Scope
+ 必要 visual
（若该 Slice 改 schema：+ migration + relevant constraints + seed convergence）
```

### M3 Final Gate（全量，重型）

```
全部 M2 regression（AUTH / AUTHOR_TRUST / CONSTRAINTS / SEED / BACKUP / TLS）
+ 完整 constraints
+ 完整 seed convergence
+ 完整 backup / restore
+ TLS
+ resource
+ all slice replay
+ visual
+ scope
+ EVIDENCE_RECOVERY（三个页面 + 口径已更新为 22/22/0）
+ MODEL_VALIDATION（四个假设全部有 SUPPORTED/NOT_SUPPORTED，无 HOLD）
```

分两层的原因：把 pg_dump + fresh restore + 全 seed + 完整 resource sampling
放在每个切片里会让开发循环变得昂贵且噪声累积（记录 07 第 5 条）。

## 六、M3 对前端的约束

- 组件结构尽量不变；**但后端领域模型不迁就 mock**。
- 禁止产出"服务 mock 形状"的 API（反例：`/posts/list2`、`/posts/detailData`、`/userPagePosts`）。
- 每个切片必须同时验证：真实 API 生效 **且** 与原版行为一致（截图对比遵守 `evidence_mask`）。

## 七、明确不做

- 不做图片上传/媒体管线（M4）；不做私信、群组、公告的页面接入（依赖第二节的关系结论）
- 不做 HTTPS 正式化 / 域名 / 公共 CA（M6）
- 不重构前端路由与组件树
- 不引入 offline mutation queue

## 八、Scope 允许清单（M3）

```
app/src/screens/**
app/src/api/**
app/src/data/**
server/src/**
scripts/m3/**   scripts/gates/m3/**
docs/**  PLAN.md  ops/**  tools/**
```

## 九、报告口径

起始口径：

```
total original screens: 22
observed baseline:      19
evidence-blocked:        3   (poi-detail / media-preview / at-panel)
out-of-scope:            0
```

Evidence Preflight 取得三个页面的真实证据后，**当轮即改**为：

```
total original screens: 22
observed baseline:      22
evidence-blocked:        0
out-of-scope:            0
```

并说明变更原因；**不允许悄悄换数字**。
