# 审核记录 32：WO#4 **不予批准**（DEFERRED）——"原版实现细节"不是"跨平台产品 contract"

> 审核方：ChatGPT web；时间：2026-09-21 22:28（Asia/Shanghai）
> 本轮提交：WO#4 计划（`docs/archive/legacy-development/review-log/31-wo4-plan-submitted.md`）

## 一、裁定

```
WO4_STATUS: DEFERRED_BY_MISSING_BINDING_EVIDENCE
PRODUCT_CHANGE: FROZEN until mapping evidence exists
（同时**批准**已完成的过期注释/账本/finding 修正——那部分不受影响）
```

**A / B / C 三种图，审核一个都不选**，并新增 **D**：

> **D：暂不改产品，等待低成本的 token↔drawable binding 证据。**
> 如果以后能从 adapter、数据表、运行时 drawable id 或静态引用链里得到六项映射，再谈实现。

## 二、⭐ 核心论点（本条最有价值，必须完整保留）

> "**原版运行时使用 ImageView**" 并不等价于
> "**Web 复刻版必须把 DOM 改成 `<img>`**"。
>
> 如果没有正确的六个"**视觉资产 ↔ 文本 token**"映射，
> A/B/C 三种方案都会为了满足"结构像图片"这个**内部指标**而**制造新的产品偏差**。

> 对于 Web 实现，真正要复刻的是
> **用户看到的图案、几何、点击后插入的 token、以及 token↔图案映射**，
> 而**不是 Android 的 View 类型**。
> `<img>`、CSS `background-image`、`canvas` 等都可能复现同一外观。
>
> **把"DOM 必须是图片元素"写成 conformance Gate，
> 是把原版实现细节误当成跨平台产品 contract。**

## 三、⭐ 审核指出的、我漏掉的**更严重风险**

> 目前六格的确切 token↔drawable 映射仍不知道。
> 例如第二格如果真实是 🤩，而我们仍让它插入 👑，
> **即使换成 `<img>`，反而会制造"看起来一个东西、发送另一个东西"的更严重语义错误。**

**我漏掉的这一点值得单独记**：

```
现状:   我们渲染的图案 = 我们插入的 token = 同一个 emoji 字符
        → 视觉与语义**自洽**（虽然形态与原版体系不同）
若按我的 WO#4 改: 图案来自原版素材、token 仍是我们 mock 里的字符
        → **视觉与语义可能不一致**（看起来 🤩、发出去 👑）
        → 这比"形态不同"**更严重**：它会误导用户
```

→ 即：**我的方案会把一个"体系差异"换成一个"语义错误"**。
   而"体系差异"在用户看来只是风格不同，"语义错误"则是**发错东西**。

## 四、为什么这不是把 C4 降回 UNRESOLVED

审核明确：

> 这不是重新把整个 C4 降回 UNRESOLVED。
> **C4 的体系差异已经 CONFIRMED；被冻结的是"具体修法"。**

```
CONFIRMED:
  · original uses ImageView-based emoji presentation
  · packaged WebP emoji corpus exists
  · current implementation uses platform text emoji
  · horizontal geometry already verified
MISSING:
  · the six visible items' drawable identities
  · each drawable's corresponding inserted/sent token
PRODUCT_CHANGE:
  · FROZEN until mapping evidence exists
```

## 五、对三种方案的逐条否决理由（保留，避免以后重提）

| 方案 | 审核的否决理由 |
|---|---|
| **A 占位 SVG** | "最不适合上线产品。它只能证明'我们会用图片'，却使页面**肉眼上离原版更远**，是典型的 **implementation-to-the-test**。" |
| **B 截图裁片** | "确实来自原版真实视觉，证据比 A 强，但现在最大问题**不是分辨率，而是不知道这张图该对应哪个 token**。如果图片和发送文本对应错，它会制造**语义错误**。" |
| **C 字体渲染成 PNG** | "更不应采用。它本质上仍使用系统 emoji 字体，只是提前 rasterize 成 PNG；**既没有逼近原版 asset system，也徒增转换层**。" |

## 六、🆕 新增纪律（本轮最重要的一条）

```
不要把原版的**实现细节**当成跨平台产品的 **conformance contract**。

conformance 必须定义在**用户可观察的 contract** 上：
  · 用户看到的图案
  · 几何
  · 点击后插入/发送的 token
  · token ↔ 图案的映射
而**不是**原版的内部实现细节（Android View 类型 / DOM 标签名 / 具体渲染技术）。

同一外观可由 <img>、CSS background-image、canvas 等任意方式实现 ——
**Gate 若写成"DOM 必须是 <img>"，它约束的是我们的实现选择，不是与原版的一致性。**
```

**与既有纪律的关系**：

| 纪律 | 防的是什么 |
|---|---|
| Gate 原则（可复核原始产物） | 防"无据" |
| 证据分级（截图=线索级/dump=证据级） | 防"弱据当强据" |
| 名字≠行为 / 搜不到≠不存在 | 防"把检索能力当事实" |
| 方法无效须标记 | 防"测量坏了仍当结果用" |
| **本条：实现细节≠产品 contract** | **防"为了一致性而复制实现，反而制造用户可见的偏差"** |

## 七、下一步（审核未变的方向）

继续 `docs/test/AUDIT-M0-M4.md` 里的其他 A/D 项，**先报计划再动代码**。
优先"**明确已证实的产品 deviation**"。
若将来出现**低成本**的 token↔drawable binding 证据（adapter / 数据表 / 运行时 drawable id / 静态引用链），
再重新打开 WO#4。
