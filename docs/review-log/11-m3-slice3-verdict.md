# 审核记录 11：Slice 3 验收（CLOSED）与 Slice 4 批准（含前置条件）

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 13:24（Asia/Shanghai）
> 提交物：`docs/m3/SLICE3-REPORT.md` + Gate 全量输出 + 证据

## 正式状态

```
M3 Slice 3
STATUS: CLOSED
RESULT: PASS

M3 Slice 4
STATUS: GO

PRECONDITION:
- audit Preflight evidence provenance for at-panel/media-preview
- any evidence obtained through third-party writes:
    preserve
    label
    exclude from admissible conformance evidence
    do not reproduce
```

## 一、Slice 4 的两条重要原则（审核明确）

### 1. 页面可以 PASS，而某些 transition 是 BLOCKED

> 一个重要原则：页面可以 PASS，而某些 transition BLOCKED
> 不要形成：有一个动作不能测试 → 整个页面 NOT_EVALUATED。
> 正确层次是：
> ```
> Page
> ├── observed/read-only aspects → PASS / FAIL
> └── prohibited causal transitions → BLOCKED_BY_POLICY
> ```
> 例如：
> ```
> MEDIA_PREVIEW_PAGE: ACCEPTED
> MEDIA_PREVIEW_VISUAL: PASS
> MEDIA_PREVIEW_OPEN_EXISTING_MEDIA: PASS
> MEDIA_UPLOAD_AND_SEND_TRANSITION: BLOCKED_BY_POLICY
> ```
> 这样信息损失最小。

**这条纠正了我原来的做法**：Slice 0B 里我把"验证码页没有原版证据"整体记成
`OTP_UI_VISUAL_CONFORMANCE: NOT_EVALUATED`。按此原则，正确的层次是：
页面级（PASS/ACCEPTED）+ 逐项 transition 级（可观察的 PASS / 禁止的 BLOCKED）。
**不是把整页判成"未评估"。**

### 2. Slice 4 不得再改 baseline 口径

> Preflight 已经导致 19/3 → 22/0，所以 Slice 4 不再改变 baseline coverage 数字。
> 这一轮应该验证的是：我们自己的三个页面是否和已经恢复出来的 admissible baseline evidence 一致。
> 也就是说不要在 Slice 4 完成后再写一次 coverage changed to 22/0，
> 应该写：baseline coverage remains 22/0；integration coverage increased。
> 把"原版证据覆盖率"和"我们自己的实现覆盖率"分开。

**两个不同的覆盖率必须分开报**：

| 指标 | 含义 | 谁改变它 |
|---|---|---|
| baseline coverage | 原版 22 页里我们**有证据**的页数 | Evidence Preflight 已把它变成 22/0 |
| integration coverage | 我们自己的实现里**已经和证据对齐**的页数 | Slice 4 及后续切片增加它 |

## 二、Slice 4 的前置条件（必须先完成）

对 `at-panel` 与 `media-preview` 做**证据来源审计（provenance）**；
凡是通过**第三方写操作**取得的证据，必须：

1. **preserve** —— 保留（不删，审计线索）
2. **label** —— 标注（已部分做了：`POLICY_VIOLATION` 字段）
3. **exclude from admissible conformance evidence** ——
   **从"可采信的一致性证据"里排除**：不得用它来断言"我们实现得和原版一致"
4. **do not reproduce** —— 不再复现（不得再做一次写操作去"验证"）

> 关键区别（我此前没分清）：
> - 之前做的是"给证据打上违规标签，但结论保留"
> - 审核现在要求更进一步：**违规取得的证据不能当作一致性（conformance）依据** ——
>   它可以作为"设计线索"，但不能作为"我们做对了"的证明。
>   这一层区分很重要，否则等于用违规手段的产物来给自己背书。
