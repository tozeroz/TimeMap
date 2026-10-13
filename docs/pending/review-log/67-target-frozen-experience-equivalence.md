# 审核 67：**目标口径正式冻结** + 最终 audit 裁定

> 时间：2026-09-23 03:48（Round 319）｜我提交：03:33（最终 completion audit + 6 问）

## 〇、⭐⭐ 最重要：我在最终 audit 里上报的**口径冲突已获权威回答**

我在审计 §〇 如实上报的冲突是：审核 66 称"目标已改为体验/行为等价优先"，
而我收到的目标文本仍是"最终严格 1:1 复现"。**现在有了明确答案**：

> "先把最重要的口径彻底钉死：**不存在冲突了。用户已经明确修改过目标。**
>  当前权威目标是：**不再要求所有 UI 设计严格 1:1；要求用户体验与行为尽可能完全一致。
>  图标、颜色、装饰、像素级布局等视觉设计后期会重新设计。**
>  因此旧文档里的『最终严格 1:1 复现』已经被后来的用户决策 **SUPERSEDED**。
>  **本地 agent 后续不要再拿旧目标作为当前验收依据。**"

⇒ **处置**（我据此修正自己的文档与判据）：
```
· `docs/pending/m5/M5-FINAL-COMPLETION-AUDIT-R319.md` §八 的"两套口径"已作废 ⇒ 改为**单一口径**：
    PROJECT TARGET: EXPERIENCE / BEHAVIOR EQUIVALENCE
    PURE VISUAL 1:1: **NOT REQUIRED**
· 按用户要求 4 第 6 条：我此前的"上报冲突而不擅自放松标准"是**对的**做法 ——
  我没有自行假设"视觉不阻塞"，而是等到了**权威依据**（用户决策）才改判据。
```

## 一、总裁定

```
M5_GLOBAL_REGRESSION_AUDIT:            PASS
M5_ARTIFACT / DB / SERVER CONSISTENCY: PASS
M5_MOCK_AND_FAKE_SUCCESS_ERADICATION:  PASS
M5_EXPERIENCE_COMPLETION_STATUS:       **HOLD**
```
> "这不是因为视觉细节，而是因为仍存在**明确的功能/交互能力缺口**。"

## 二、⭐ 新的验收口径（正式冻结）

**BLOCKING（体验/行为等价）**：
```
· 页面/功能是否存在
· 用户从哪里进入
· 点击之后发生什么
· **表单交互方式**
· 是否真的能完成功能
· 数据含义
· 写入真实性
· success / error / empty / loading 行为
· entity identity continuity
· 页面是**内联还是独立页**等信息架构
```
**NON-BLOCKING VISUAL BACKLOG**：
```
· 图标具体造型 ／ 精确颜色 ／ 精确字号 ／ margin / padding ／ 圆角阴影
· 像素级位置 ／ 原版视觉资产
⇒ **视觉类 NOT_EVALUATED 不再阻塞 M5**
```

## 三、逐项裁定

```
PRODUCTION_IMPORTABLE_MOCK_BUSINESS_DATA: **REMOVED**（批准）
  > "尤其这次删除 mock.ts 后 TypeScript 直接把 store.ts 的残余假身份依赖暴露出来，
  >   证明这个结构调整确实有实际价值，而不是洁癖式重构。"
  > "比保留一个巨大的、随时可以重新 import 的 mock.ts 更安全。"

ORIGINAL_EMOJI_COUNT: OBSERVED = 6
ORIGINAL_EMOJI_CHARACTERS: NOT_EVALUATED ⇒ **VISUAL_DESIGN_BACKLOG / NON-BLOCKING**
  > "不要为了这 6 个字符再进入原版取证。"
  > ⚠️ "只有以后发现『不同 emoji 对应不同业务动作/语义』，才重新升级为行为问题。"

audit 自动发现 Gate + 失败留完整日志: **认可**
  > "这是现有审计脚本的必要修复，不属于新的方法学专项。"
  > "hardcoded 15 gates → actually 20 gates exist 属于典型的『**绿是因为根本没测**』。
  >   自动发现是正确修复。"  ⚠️ "到这里停止，不再为 audit harness 增加新体系。"

F-002 FeedDetail 错误态: **NON-BLOCKING EXPERIENCE-EQUIVALENT VARIATION**
  > "不要求文案逐字相同。"（只要"网络失败→明确错误态+可刷新"、"404→明确说不存在"，
  >   行为语义已等价甚至更准确）

F-004 「所在学院」原版 picker、当前文本 Row: **EXPERIENCE_FIDELITY BLOCKER**
  > "这是**交互方式**，不是视觉。……用户操作能力不同。"（"表单交互方式"在 BLOCKING 列表内）

F-005 「就读专业」行为未知: **NOT_EVALUATED** ⇒ "不需要继续考古"
  > "它目前不是一个『已确认 mismatch』，而是未知。"

F-006 原版有学院实体、我们没有: **EXPERIENCE CAPABILITY BLOCKER**
  > "修复范围**必须非常小**。……可以像学校/校区一样 seed a small baseline-supported set
  >  of colleges → picker can actually select。不需要新增几十个学院。"

⇒ **F-004 + F-006 合成一个非常小的最终 closeout item，不要再重开完整 WO#20。**
```

## 四、⭐⭐ 审核指出的**比 F-004 更大的问题**（我认为这条最重要）

> "**『没有 mock / 没有假成功』≠『体验已经等价』。**"
> "不要把所有『把假功能换成 unavailable 提示』的页面都**自动视为完成**。"

```
SCANNER_TRUTHFULNESS:        PASS（不再假成功）
SCANNER_EXPERIENCE_PARITY:   **FAIL / NOT IMPLEMENTED**  ← 在"体验完全一致"下仍是 gap

VERIFY_FAKE_SUCCESS:         RESOLVED
VERIFY_CORE_FLOW_PARITY:     **NOT IMPLEMENTED / BLOCKED_BY_POLICY**

UPGRADE_TRUTHFULNESS:        PASS
UPGRADE_FEATURE_PARITY:      **NOT IMPLEMENTED**（若原版"立即更新"确能触发真实升级）
```
⇒ 需要的不是更多 Gate，而是一次**很小的"功能缺口重分类"**：
```
把当前所有用户可见的"尚未实现/无法继续/功能未接入"surface 列出来，每项只问：
  ① 原版**是否真的有**这个功能？
  ② 当前**是否真的能完成**？
  ③ 若不能：是项目明确 OUT_OF_SCOPE？还是 EXPERIENCE BLOCKER？
已知三项：1. Scanner core functionality ／ 2. Campus verification next-step flow ／ 3. Upgrade action
⚠️ "这一步是**产品 scope 裁定**，不是工程验证。"
```

## 五、⭐ 审核给出的下一步（我据此执行）

> "**现在先不要继续 coding。** 下一步应该是**向 Owner 提交一个非常短的 Scope Decision**：
>  请 Owner 对以下功能选择 **A. 必须实现体验等价 ／ B. 明确排除当前项目 scope**：
>    · Scanner 实际扫码
>    · 校园认证『下一步』后的流程
>    · App 自更新
>  与此同时，**唯一可以直接确认要修的**：**F-004 + F-006** → 学院 picker + 最小权威/基线支持学院数据。
>  这应该是一个**小 closeout**，不是重新打开整个认证系统。"

### 我的处置（含与用户硬规则的对齐）
```
用户硬规则（要求 3 第 1 条）："只要 NEXT-ACTIONS.md 里还有未被阻塞的 [ ]，就不得以『汇报』结束回合"。
⇒ 所以我不因"等 Owner 裁定"而停下：
   ① **立即实施 F-004 + F-006**（审核明确"唯一可以直接确认要修的"、范围"必须非常小"）
   ② 同时把 **Scope Decision** 作为本回合报告的一部分交给 Owner（它是产品 scope 裁定，只有 Owner 能定）
   ③ 那三项（scanner / 认证下一步 / 自更新）在 Owner 裁定前**不擅自标为完成或排除**，
      按审核口径记为 `EXPERIENCE_GAP_PENDING_OWNER_SCOPE`
```

## 六、最终状态（审核原话）

```
PROJECT TARGET:                      EXPERIENCE / BEHAVIOR EQUIVALENCE
PURE VISUAL 1:1:                     NOT REQUIRED

F-002: NON-BLOCKING ／ F-004: **BLOCKER** ／ F-005: NOT_EVALUATED ／ F-006: **BLOCKER**
BOARD_EMOJI_EXACT_CHARS:             VISUAL BACKLOG / NON-BLOCKING
M5_GLOBAL_REGRESSION:                PASS
M5_MOCK/FAKE-SUCCESS CLEANUP:        PASS
M5_EXPERIENCE_COMPLETION:            **HOLD**

> "现在项目已经非常接近完成。真正剩下的不是继续『找 bug』，
>  而是由 Owner 明确哪些原版功能必须纳入最终 scope，然后只补那些体验能力缺口。"
```
