# 审核记录 30：C4 **正式收口**（三层结论）；结构层解冻；并新增一条证据方法论纪律

> 审核方：ChatGPT web；时间：2026-09-21 22:23（Asia/Shanghai）
> 本轮提交：C4 定向取证结果（`aapt2` 资源表 + 154 个随包 webp + 一次失败的身份匹配尝试）

## 一、C4 的正式裁定（**不再整体 UNRESOLVED**）

审核的核心意见：**不要把两个强度不同的 claim 压成一句 DRAWABLE**，
否则会再次跨过最后一小段尚未直接观察的 binding。因此按三层分别冻结：

```
C4_EMOJI_RENDERING_KIND:                      CONFIRMED — ImageView / image-based
C4_EMOJI_ASSET_SYSTEM:                        CONFIRMED — packaged drawable/WebP emoji corpus exists
C4_BOARD_ROW_PACKAGED_DRAWABLE_BINDING:       STRONGLY_SUPPORTED
                                              DIRECT_BINDING NOT CAPTURED
C4_EXACT_6_ASSETS:                            NOT_CAPTURED
                                              STOP INVESTIGATION unless decisive low-cost evidence appears
PRODUCT IMPACT:                               UNFREEZE structure-level fix
                                              KEEP exact-asset selection frozen
```

审核列出的**三条彼此独立的强证据**：

```
A. runtime dump            emotion_image = android.widget.ImageView ×6
B. APK resource table      xhs_theme_xhs_emoji_res_v2 → 156 drawable refs / 154 unique resources
C. APK payload             这些 drawable 全部落到实际存在的 RIFF/WEBP 文件
```

**仍缺的那一跳（因此不能写成最强版本）**：

```
message-board adapter → emotion_image → xhs_theme_xhs_emoji_res_v2[index]
```

> 所以最严谨的总账是"**原版是 image-based（确证）**"+"**留言板那 6 格绑定的是这 154 个中的哪几个（未捕获）**"，
> 而不是"那 6 格确定绑定到某六张具体 webp"。

## 二、⚠️ 对我措辞的一处**收紧**（审核要求）

我写了"**排除**运行时生成位图 / 网络下发"。审核指出这**过强**：

> 字体直接渲染**可以**排除（因为运行节点确实是 ImageView，不是文字控件）。
> 但理论上：`字体 → runtime bitmap → ImageView`、`网络 image → ImageView`，单靠 ImageView 仍可能存在。
> 现在 APK 中又发现了完整、专门命名的 emoji drawable table 和 154 个 WebP，
> 因此这些替代解释已经变得**非常不经济**，但严格说是**被强烈削弱，不是逻辑上完全排除**。

→ **更正措辞**：由"排除"改为"**被强烈削弱（但未在逻辑上完全排除）**"。

**审核说明这"不影响 C4 产品判断，只影响证据措辞"** —— 但按本项目纪律，措辞就是证据的一部分。

## 三、⚠️ 另一处**收紧**：`[微笑C]` 不能直接推出线上协议

我写"表情名形如 `[微笑C]` → 协议层用文本码"。
审核认为：

> "中文名 `[微笑C]` 就证明线上消息协议一定发送这个文本码"仍**稍微过强**。
> 资源词表能证明**系统存在"文本标识 ↔ drawable"的映射模型**；
> 真正消息 persistence / wire format 最好以后从自有实现设计或更多原版只读证据确认。

→ **更正**：把"协议层用文本码"降级为"**资源体系里存在文本标识 ↔ drawable 的映射模型**；
   线上 wire format **未确认**"。

## 四、✅ 产品影响：结构层**解冻**（审核修改了它此前的"完全冻结"意见）

> 这次我会**修改此前"完全冻结 C4"的意见**。
> 现在已经有足够证据驱动**结构层**改动：当前文字 glyph → image-based emoji rendering。
> 因为这个差异**已经不依赖"那六张究竟是哪六张"**。

**建议的工作单（审核给的形状）**：

```
WO#4 Emoji Rendering Structure —— 只解决:
  · 文字 emoji → image element
  · 6 项
  · **现有已经验证正确的横向几何保持不变**
  · 点击选择行为保持不变
  · 协议层仍使用文本 emoji code / token
  · **但暂时不要选择六张具体原版 WebP 来替换**

最终状态:
  EMOJI_RENDERING_STRUCTURE:  PASS
  EXACT_ASSET_CONFORMANCE:    NOT_EVALUATED
```

> 这比"什么都不改直到知道六张图是谁"更合理，**因为现在已经明确知道当前 text-glyph abstraction 是错的**。

## 五、✅ 那 6 个具体表情：**停止投入**，并**标记该方法无效**

审核明确支持停止，并特别肯定了**我没有在指标坏掉的情况下挑 top-1 当答案**：

> 非常重要的是你没有："虽然指标明显坏了，但先挑 top-1 当答案。"
> 这应该直接把该方法标为：
> ```
> INVALID IDENTIFICATION METHOD
> DO NOT USE FOR CONFORMANCE CLAIM
> ```

**保留**：
```
EXACT_BOARD_EMOJI_ASSETS: NOT_CAPTURED
视觉候选 😂 / 🤩? / 💛? / 👀 / 😱 / +1 仅作 candidate/hypothesis，不进入产品改动
```

**重新打开的条件（只在这类低成本决定性路径出现时）**：
```
· 静态代码直接追到 adapter 的 resource-index binding
· runtime 能只读获取 ImageView 当前 drawable / resource id
· 某个 layout / data binding XML 直接暴露资源引用
```

## 六、✅ 新增纪律（审核冻结）：**"按物理文件名没搜到" ≠ 资源不存在**

审核把本轮的取证过程提炼成一条方法论：

```
你之前: 按 filename 搜索 → 没看到 emoji asset → 得到"似乎不存在"
这次:   resource table → semantic resource name → compiled path mapping
        → 混淆后的 dp.webp / tm.webp / … → 才发现真实资源
```

**冻结**：

> 在编译/混淆产物中，**"按物理文件名没搜到"不能作为资源不存在的证据**；
> 应优先沿**资源表、索引或引用关系**查找。

**它与已有纪律形成两侧约束（这是本轮最有价值的一句）**：

```
名字存在     ≠ 行为成立        （resource-id 名字不能证明行为）
物理名字搜不到 ≠ 资源不存在      （本轮新增）
→ 真正可信的是**引用关系**和**可复核产物链**
```

## 七、下一步优先级（审核给定）

1. 把 C4 finding 按上述**三层结论正式收口**
2. **另立一个很小的 image-based rendering structure WO**（WO#4），
   但**暂不绑定猜测性的六张原版资产**
3. 然后继续 `docs/AUDIT-M0-M4.md` 里的其他 A/D 项，
   **仍然执行"先报计划，再动代码"**
4. **优先级提示**：审计表里若还有"**明确已证实的产品 deviation**"，
   其优先级**高于**继续研究 exact emoji asset identity

---

⚠ 审核原文末尾自带提示："ChatGPT 可能会出错。请核查重要信息。"
→ 本记录中的**事实性主张**（154/156 项、文件路径、ImageView、webp 头）均以我们自己的原始产物为准；
审核意见作为**裁定与方向**采纳。
