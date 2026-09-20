# M3 工作单：垂直切片迁移（逐页恢复真实行为语义 + 反推/验证数据模型）

> 前置：M2 **PASS / CLOSED**（审核记录 06）
> 方向指引（审核记录 06 第 8 节）：**不要把 M3 定义成"把剩余页面接 API"**，
> 而是逐页恢复真实行为语义，并据此验证/修订 M2 的 Data Model V0.1。
> 本文件提交审核通过后才开始执行。

## 一、M3 的两条并行产出（审核要求）

```
A. UI/API integration evidence
     每个切片：真实 API + UI + 原版行为同时验证通过

B. Data Model V0.1 validation / revision evidence
     由真实入口观察**反推** schema，而不是反过来让 schema 驱动 UI
```

即：M3 的验收不只是"页面接完了"，还要给出数据模型的**证伪/修订结果**。

## 二、必须在 M3 给出明确结论的待证假设（不允许悬空）

| # | 待证假设 | 必须产出的结论 |
|---|---|---|
| 1 | `comments.parent_id`（评论嵌套） | `SUPPORTED` 或 `NOT_SUPPORTED`；后者须用 migration **删除该列** |
| 2 | `schools` 是否应独立成表（当前只是 `users.school_name` 文本） | `SUPPORTED→建表` 或 `NOT_SUPPORTED→保持文本`，并给出观察依据 |
| 3 | `message` / `group` / `board_note` 三者的真实关系 | 两两关系结论（是否共用 thread？群聊是否 thread 的一种？留言是否独立？），不一致就用 migration 修订 |
| 4 | `login-sns` 的真实登录语义 | 观察原版登录页到底用什么身份（手机号/SNS/校园卡？），据此决定 M3 的登录 UI 与 `users` 字段 |

原则（审核记录 06）：**Observed fact ≠ forward-compatible guess**。

## 三、切片顺序（审核记录 01 推荐 + M3 补充）

```
Slice 0  登录入口：login-sns / login-select 真实行为观察 → App 登录 UI 接入
         （M2 已铺好会话通路 api/session.ts，M3 只动 UI + 会话层）

Slice 1  帖子列表 → 帖子详情 → 评论列表
         （campus 广场 / feed-detail / comment-detail 由 mock 切到真实 API）

Slice 2  点赞 → 点赞状态 → 点赞计数
         （需要真实写入 + 计数一致性；这一步才真正用上 likes 表）

Slice 3  发帖 → 图片上传 → 列表刷新
         （图片上传属 M4 的一部分，M3 只做"无图发帖 + 列表刷新"的完整闭环；
           图片走 M4 的媒体管线，不在本单内）

Slice 4  三个 evidence-blocked 页面从**真实入口**恢复证据：
         poi-detail / media-preview / at-panel
         （M0 时它们经 deep link 落到 TridentActivity，标为 not_reproducible）
```

每个切片单独提交审核：**一次只做一个切片**，做完就交审核 + Gate，不攒着。

## 四、M3 对前端的约束

- 组件结构尽量不变（审核记录 01 第 3 条）；**但后端领域模型不迁就 mock**。
- 禁止产出"服务 mock 形状"的 API（反例：`/posts/list2`、`/posts/detailData`、`/userPagePosts`）。
- mock 数据不删除，而是逐页替换数据来源；替换完的页面在 offline 时仍可降级显示。
- 每个切片必须同时验证：真实 API 生效 **且** 与原版行为一致（截图对比遵守 `evidence_mask`）。

## 五、M3 Gate（分组）

1. **[PERSISTENT]** 永久不变量（Node/PG/私钥/基线/网络/编码）
2. **[M2 REGRESSION]** M2 的 AUTH_CONTRACT / AUTHOR_TRUST / CONSTRAINTS / SEED / BACKUP / TLS 仍 PASS
3. **[SLICE_n]** 每个切片：真实 API 生效 + 设备真实触摸路径 + 原版行为对照
4. **[MODEL_VALIDATION]** 第二节四个待证假设各自给出 `SUPPORTED` / `NOT_SUPPORTED` 结论，
   且结论有观察证据（截图 / baseline 更新 / 接口行为），若 NOT_SUPPORTED 则附 migration 修订
5. **[EVIDENCE_RECOVERY]** 三个 evidence-blocked 页面从真实入口恢复证据；
   恢复后 `manifest.json` / `SHA256SUMS` 相应更新，报告口径随之变化
   （**注意：口径一旦变化必须显式写出新数字，不允许继续沿用旧口径掩盖差异**）
6. **[VISUAL]** 与原版截图对比（遵守 `evidence_mask`），差异逐条登记
7. **[SCOPE]** 改动落在允许清单内
8. **[RESOURCE]** 按需重采样（新的写入路径上线后 20 并发）

## 六、明确不做

- 不做图片上传管线（M4）；不做评论/点赞的**写入**接口之外的社交功能（M4）
- 不做私信、群组、公告的页面接入（按切片顺序排在后面，且依赖第四节的关系结论）
- 不做 HTTPS 正式化/域名（M6）
- 不重构前端路由与组件树（保持"组件结构尽量不变"）

## 七、Scope 允许清单（M3）

```
app/src/screens/**        # 逐页替换数据来源（本次才动这些）
app/src/api/**            # 新增切片所需接口客户端
app/src/data/**           # mock 降级为 offline fallback
server/src/**             # 切片所需 API + 必要的 migration 修订
scripts/m3/**  scripts/gates/m3/**
docs/**  PLAN.md  ops/**  tools/**
```

## 八、报告口径

起始口径（M3 开始前）：

```
total original screens: 22
observed baseline:      19
evidence-blocked:        3   (poi-detail / media-preview / at-panel)
out-of-scope:            0
```

Slice 4 完成并把三个页面从真实入口恢复证据后，口径应变成 `observed 22 / evidence-blocked 0`
—— 那时**必须显式改口径**并说明变化原因，而不是悄悄换数字。
