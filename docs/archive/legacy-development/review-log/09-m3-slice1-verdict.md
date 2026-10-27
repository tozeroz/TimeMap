# 审核记录 09：Slice 1 验收反馈（节选要点）

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 12:25（Asia/Shanghai）
> 提交物：`docs/archive/legacy-development/m3/SLICE1-REPORT.md` + Gate 输出 + `docs/archive/legacy-development/POLICY-VIOLATION-2026-09-21.md`

## 一、BLOCKED_BY_POLICY 的分类被确认，要求永久保留

审核原话（要点）：

```
BLOCKED_BY_ETHICS   = 行为本身不应执行，因为可能伤害/打扰第三方
BLOCKED_BY_POLICY   = 用户/项目治理规则明确禁止该行为

而且它们都应该满足：blocked 不等于 failed，也不等于偷偷推断成 pass。
这套分类建议永久保留。
```

（已按此登记在 `PLAN.md` §10 与 `docs/archive/legacy-development/POLICY-VIOLATION-2026-09-21.md`。）

## 二、必须修正：Gate 结果 key 不得跨 slice 共享（GATE_DEFECT / naming）

审核原话（要点）：

```
你提交里写：完整 Gate → M3_SLICE0B_GATE_RESULT: PASS
但这是 Slice 1。

如果实际 evidence 文件也是这个名称，那应该修成：M3_SLICE1_GATE_RESULT

不要让不同 slice 共享一个最终结果 key，否则未来自动汇总会产生歧义。
这是 GATE_DEFECT / naming defect，不是产品问题，但正式关闭前应修。
```

**已修**：Gate 改为 per-slice 记账（`$script:SliceFail`），末尾分别输出
`M3_SLICE0B_GATE_RESULT` 与 `M3_SLICE1_GATE_RESULT`；退出码仍为"任一组失败即非 0"。

## 三、上一轮 M2 可复现性不得默认销项

审核原话（要点）：

```
上一轮我要求：当前产品不恢复 password auth，
但历史 M2 password-auth acceptance 仍应通过 archive / fixed commit 等方式保持可复现。
你这次提交没有提到这一项。所以我不会据此说它已经解决。
如果你已经落实，只需要在项目记录里销项；如果没有，它继续作为 M3 的 audit closeout backlog。
```

**已销项**（见 `docs/archive/legacy-development/m3/CLOSEOUT-SLICE0B.md` 顶部）：`scripts/m2/verify-auth.sh` 已恢复
（commit `5f7c9c6`）、M2 Gate 认证组改回调用它、复现步骤成文；
且当前产品确无 password 功能（Gate 3.2 组机械断言 410 / 无列 / 无会话 / 无 token）。
**这一项的教训**：落实了但没写进提交 → 审核无法确认。以后 CLOSEOUT 项必须在提交里显式点名。

## 四、Slice 2 可以进入，但取证策略必须改变

审核原话（要点）：

```
同意进入 Slice 2（点赞）。但有一个非常明确的前置政策：
不得为了观察"点赞/取消点赞"而在原版第三方系统上点 Like。因为那同样是写操作。
所以 Slice 2 应分成：原版：只读观察 —— 尽可能取得：
  点赞按钮外观；已点赞 / 未点赞已有状态；点赞计数显示格式；是否展示点赞用户；
```

（这与我在 `docs/archive/legacy-development/POLICY-VIOLATION-2026-09-21.md` 第 7 节的预登记一致。
Slice 2 报告里必须写明：**切换行为**与**已点赞态的“点之后”样式**只能来自自建系统，
原版侧只有只读观察到的那几项。）
