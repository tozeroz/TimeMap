# 审核 62：WO#16 主体通过，但 **1 处计数语义必须修**（`WO16_FINAL_CLOSE: HOLD`）；并纠正我审计文档的自相矛盾

> 时间：2026-09-22 20:12（Round 317）｜我提交：20:06（WO#16 完成 + M5 全局审计 + 4 问）

## 〇、裁定汇总

```
WO16_LAYER_A:                 PASS
WO16_LAYER_B_IMPLEMENTATION:  PASS
WO16_FINAL_CLOSE:             **HOLD — 1 semantic closeout**
M5_REGRESSION/ORDER_AUDIT:    PASS
M5_COMPLETION:                **NOT READY**
```
审核开头再次强调全局控制要求：
> "WO#16 之后不要重新回到'发现一个方法问题→扩成一个专项工程'的模式。
>  下一阶段只处理 M5 **真正的产品 blocker**。你这轮的收束方向是对的，
>  反向顺序回归到这里就停，不再继续排列组合测试。"

---

## ⭐⭐ 一、`campusCircleCount` 的**覆盖完整性**语义（唯一 blocker）

### 1.1 我的漏洞（审核指出）

我的规则是"**平台里有没有任何一条非空 `school_campus_id`**" ⇒ 有就算 established。
审核举出反例：
```
4 posts ／ 1 条明确归属 校本部 ／ 3 条仍 NULL
⇒ 我的规则认为"已建立"，于是返回
     校本部 = 1
     威海校区 = 0     ← 错
     东校区  = 0     ← 错
```
> "那 3 条 NULL 完全可能属于任意 campus，因此两个 0 都**没有资格**出现。"
> "0 表示'**权威地知道**没有动态'，而不是'目前没有被归属到这里的动态'。"

⇒ **根因（审核原话）**：
> "不要让 `any attribution exists` 等价于 `attribution coverage complete`。"

### 1.2 收紧后的规则（我按此实现）

```
campusCircleCount 可以是 number
  IFF 当前被计入这个校园圈统计的 post population 已经 100% 有显式 school_campus_id

totalRelevantPosts == 0          → coverage complete ⇒ 允许 0
0 <= attributed < total          → coverage incomplete ⇒ **全部 null**
attributed == total              → coverage complete ⇒ 才允许真实 COUNT
```

### 1.3 字段改名（审核建议，我采纳）

```
attributionEstablished  →  **attributionCoverageComplete**
```
理由（审核原话）："建议把 boolean 改成更不容易误解的名字…或者至少不要让前者决定 count。"
⇒ 我改名**并**让它直接决定 count（两者都做了），另加 `coverage:{totalRelevantPosts,attributedPosts}`
   诊断字段，使"为什么是 null"可被机械核对。

⚠️ 我另外**多修了一处审核没提但同源的问题**：原实现把 `users.school_campus_id`
   也加进了覆盖计数。但统计对象是"**校园圈动态数**"（post population），
   把 user 的归属混进来会得出"覆盖完整"的错误结论 ⇒ 已改为**只看 posts**。

### 1.4 审核要求的小敏感度（已做且通过）

> "补一个非常小的 sensitivity 即可：**4 posts 中只给 1 条设置 campus → 所有 campusCircleCount 仍必须是 null**"

`scripts/m5/selftest-campus-count-coverage.sh` 四阶段实测：
```
① 基线（0/4 有归属）            → 全部 null                          ✓
② **只给 1 条设 campus**（1/4） → **仍然全部 null** ⭐（旧实现会返回 1/0/0） ✓
                                 attributionCoverageComplete=false    ✓
③ 撤销                          → DB 无残留，回到全部 null            ✓
④ 覆盖完整（4/4）               → 给出**真实** COUNT（校本部=4，其余 0）✓
                                  ← 0 此时是**有资格**的
SELFTEST_CAMPUS_COUNT_COVERAGE: PASS
```
⭐ 第 ④ 阶段是**反向证明**：它证伪了"规则退化成永远给 null"这种偷懒实现。
审核只要求 ①②，我补 ④ 是因为**只证一端不足以证明规则正确**（两端都要证）。

### 1.5 另加一条 Gate 断言（`CAMPUS_COUNT_COVERAGE_SEMANTICS`）

放在 `gate-wo16b-schools.mjs`（现 9 键）。与 DB 级 selftest 的**分工**：
```
DB 级 selftest 证："服务端**算得对**"
Gate 断言    证："接口把结论**如实传出去**、且 UI 也照做了"
⇒ 缺任一，都会出现"服务端对但界面仍显示 0"的漏网
```
实测：`DEVICE_GATE_EXIT=0`，9 键全 PASS；API 返回
`attributionCoverageComplete:false` + `coverage:{totalRelevantPosts:4,attributedPosts:0}` + `counts:[null,null,null]`。

---

## ⚠️ 二、我审计文档里那句**自相矛盾**的话（审核要求纠正）

我写的是：
> "M5 的产品层收敛已完成到'**没有已知的、可执行的假数据面**'"

审核指出这与紧接着列出的 A1/A2 **直接矛盾**（那两条本身就是已知、当前可执行的假数据面）。
正确描述：
> "主要主链路已经高度收敛，但目前仍**明确剩余至少 A1/A2 两个**已知可执行 fake-data surface。"

⇒ 已改写，并把教训写进文档：
**用"没有…"这类全称否定作结论句时，必须先回头核对同一份文档里的清单** ——
否则"清单列了 5 条、结论说没有"会同时误导读者与我自己。

### 命名纠正（审核第 2 条）

```
原文：M5_GLOBAL_AUDIT: PASS
❌ 它夸大了证明范围 —— 它证明的是"现有门禁全绿 + 正序逆序一致 + 无明显顺序依赖"，
   **没有**证明"M5 产品已经 complete"。
已改为：
   M5_GLOBAL_REGRESSION_AUDIT: PASS
   M5_COMPLETION_STATUS: BLOCKED
   M5_CLOSEOUT_PHASE: ACTIVE
```
⚠️ 审核明确："这只是命名修正，**不要因此再扩测试范围**。"（我遵守）

---

## 三、M5 的状态措辞（审核与我略有不同，我采纳审核口径）

审核：
> "不是'**M5 不能进入关账流程**'，而应该是'**M5 已经进入 closeout phase 但 FINAL CLOSE = BLOCKED**'。
>  因为你现在已经做完 global completion audit，并明确列出了最后几个 blocker。
>  接下来就是**逐个销项**，而不是继续常规功能扩张。"

---

## 四、A1/A2 优先级：**A1 第一**（与我原建议相反，我采纳审核）

审核理由（我认为比我的更对）：
> "A1 最危险，因为它不是简单'显示一些假数据'，而是：
>  **找不到目标实体时静默换成另一个真实/假实体**。
>  这和 WO#12 当时 `users[id] ?? users.u1` 是**完全同型**的问题。
>  它可能产生：**请求/点击的是 post A，页面显示的是 post B** ⇒ 属于 **identity corruption**。"

```
WO17_POST_IDENTITY_AND_COMMENT_AUTHORITY（窄目标）
  · 去掉 `?? posts[0]`
  · 目标 post 不存在 → unavailable/error（**不**静默换实体）
  · CommentsScreen 与 FeedDetail 使用**同一** authoritative post identity
  · 不再保留"一真一假"的双数据源
  ⚠️ "不要趁机重做整个评论系统"

WO18_POI_SEARCH_AUTHORITY
  · `GET /api/places` 是合理方向；最小 read model 按实际 UI 字段设计
  · `posts: 1284` 若 UI 需要"该地点动态数"⇒ 用
    COUNT(posts WHERE place_id = places.id) **真实计算**；不能可靠表达则 null/不渲染，
    **绝不能继续留 mock 数字**
```

## 五、A3/A4：**一次有界只读观察**（合并取证，不分别开四个考古单）

只回答三件事：**entry** ／ **navigation target** ／ **最低可见 contract**。
⚠️ 审核特别强调 A4：
> "**'存在原版 screen baseline' ≠ '我们已经知道它的用户入口'**。
>  仍然要把 **destination correctness** 与 **entry reachability** 分开。"

## 六、A5：默认 **(c)**，必要时少量 (b)

> "不要建设新的 vision 基础设施。你的机械像素分析已经证明，对于色相/bbox/几何/ROI/颜色族
>  这类 quantitative claim，可以直接继续用。"
```
可量化 claim           → 用现有 pixel analyzer 收敛
少量关键视觉语义       → 把那几张具体 baseline/current PNG **上传到审核会话**，
                         由远端 reviewer 直接看图核对（即选项 b 的"定点"用法）
非关键/非默认 fallback → 可保留 known limitation
⚠️ 但**不能**无限全部挂 NOT_EVALUATED 然后宣布项目完成 —— 最终目标是严格 1:1
```

## 七、认可

> "本轮没有扩方法学支线：**认可**。你做的'正序一次 + 逆序一次 + 一致→停'
>  正好符合我上一轮给的停止条件。"

## 八、进度路线（审核给定）

```
WO16 → 修 attribution partial-coverage 这一处 → **CLOSED**
WO17 → A1 post identity / comments authority
WO18 → A2 POI search authority
```
