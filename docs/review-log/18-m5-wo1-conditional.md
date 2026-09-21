# 审核记录 18：M5 工作单 #1 有条件批准 + M4 CLOSE 的五条前置

> 审核方：ChatGPT web（远程独立审核）；时间：2026-09-21 16:15（Asia/Shanghai）

## 一、M4 CLOSED 仍待销项：五条 storage closeout 必须逐条列明

审核原话（要点）：

> M4 的正式 CLOSED 仍以前一轮我点名的 storage closeout 是否已经在最终证据中明确覆盖为准。
> 你这里写"五个 key 全 PASS"，但没有再次列出：
> ① backup consistency barrier
> ② file→row 双向恢复
> ③ restore 后私有权限
> ④ cleanup 在 DB down 时 fail-closed
> ⑤ pixel/decode bounds
> 这五个具体断言。如果它们已经实际进入最终 Gate，只需在 M4 Final Report 中明确销项即可；
> 如果没有，先补完再正式切换阶段。

**这是"报告覆盖"问题的第二次出现**（第一次是 review 16）。
审核要的不是"五个 key 都 PASS"，而是**这五条具体断言**是否被证明。

**我的初步自查（需下一轮逐条核实，不能凭印象回答）**：

| # | 断言 | 我记忆中的状态 | 待核实 |
|---|---|---|---|
| ① | backup consistency barrier | 有 `manifest.json` 记录两侧计数与 sha256，但**是否有"两侧不一致就必须拒绝"的屏障**？不确定 | ✅ 必查 |
| ② | file→row **双向**恢复 | 正向有（4 条 media 行逐行找到文件）；**反向（文件都有对应行）我记的是"⚠ 发现 orphan 只提示不影响判定"** —— 即双向并未都作为 PASS 断言 | ✅ 必查 |
| ③ | restore 后私有权限 | 恢复演练**没有**再验证 private 媒体的授权（未登录/非成员仍 404） | ✅ 必查 |
| ④ | cleanup 在 DB down 时 fail-closed | cleanup CLI 无 `DATABASE_URL` 时拒绝执行（退出码 2）✅ 有；但**"DB down"（连不上库）是否也 fail-closed** 未验证 | ✅ 必查 |
| ⑤ | pixel/decode bounds | `imageProbe` 有尺寸上限 20000 与结构校验；但**"像素总量上限"（如 width×height 上限）**未确认，且这是"结构校验不是完整解码" | ✅ 必查 |

> 结论：**不能声称这五条已覆盖**。按审核口径，先补完再正式切换阶段。

## 二、`docs/AUDIT-M0-M4.md` 被接受为 M5 的 Verified Baseline

> 你新增的 docs/AUDIT-M0-M4.md 非常适合作为 M5 Current Verified Baseline。
> M5 后续不应该再凭印象找差异，而应围绕这张账逐项销项。

**这改变了 M5 的工作方式**：以审计表为账本逐项销项，而不是凭印象找差异。

## 三、board_notes 批准为 M5 第一单（最优先）

> 它同时满足三个条件：已有可采信原版证据、现有系统确实缺实现、实现成本较低。
> 相比 voice，它能真正提高 original-conformant coverage，而不只是新增一个"我们自己的功能"。

对 API 的额外要求（我已按此实现，需再确认）：

- **"另一方用户"是唯一的客户端参数**：`GET/POST /api/board-notes/:otherUserId`
- **当前用户永远来自 session**；**不允许客户端提交 `from_user_id`** ← 需在 Gate 里加一条机械断言
- 第三方**不能通过构造一对用户 ID** 读到两人的留言 ← 我的实现只查"我 vs 对方"，但需**显式断言**"构造两个都不是我的 ID 也读不到"
- self-target 继续由 DB/API 双层拒绝 ✅ 已有

允许的结论：

```
BOARD_NOTES_FUNCTIONAL: PASS
BOARD_NOTES_CONFORMANCE: PASS
```

> 但视觉证据弱的部分继续拆开，**不要因为文案、结构一致就宣布 pixel-level 1:1**。

## 四、Voice 不作为第二单

> 如果 M5 的目标真的是"1:1 收敛"，voice 的收益反而比较低：
> 实现成本高 + 原版因果/交互证据不足 + 最终仍只能 NOT_EVALUATED。
> 它还会同时引入麦克风权限、录制生命周期、音频格式嗅探、播放器、后台/中断行为、
> private-media 扩展、大小和时长限制。
>
> 我的顺序是：先做所有仍存在的 A 类和可缩小的 D 类；这些基本耗尽后，
> 再决定 voice 是否值得做。Voice 可以留在 M5 backlog，但现在不要承诺它就是 Work Order #2。

## 五、候选 3 的措辞必须更精确

> 服务器不做图片压缩/重编码可以明确冻结为 architecture choice，我认可。
> 但**不要**把"服务端不重编码"扩大写成"**图片压缩问题已经不存在**"。
> 如果原版客户端确实进行了用户可感知的压缩，而当前 App 完全不做，
> 那么"整体上传行为与原版不同"（原文在此截断）……

**要点**：可以冻结"服务端不重编码"这个架构选择，
但不能因此宣称"压缩问题不存在"—— 因为**原版客户端可能做了用户可感知的压缩**，
而我们的 App 没做，那"整体上传行为与原版不同"这件事仍然成立，应记为偏差。

## 六、下一步（按裁定）

1. **先逐条核实并销项 M4 的那五条 closeout**（不能凭印象）
2. 补 board_notes 的两条机械断言：客户端不能提交 `from_user_id`；
   构造"两个都不是我的 ID"也读不到
3. board_notes 前端 + 真机验证
4. 然后才是 M5 的其他 A/D 类项；voice 留 backlog
