# 审核记录 26：C4 此前裁定**作废**，冻结为 UNRESOLVED；我的 §六 修正又走过头了

> 审核方：ChatGPT web；时间：2026-09-21 19:19（Asia/Shanghai）

## 一、审核裁定

> **这次我同意你的降级，而且要把之前的裁定明确作废。**

```
此前我给出的裁定:
  original = image
  current  = text glyph
  → 改为 image-based structure
现在应当: RETRACTED / SUPERSEDED
```

**理由（审核原话要点）**：

> 因为真正可靠的直接事实只有 `resource-id = emotion_image`。
> 从这个名字推导 `emotion_image → ImageView → bitmap/drawable asset`，
> **跨了至少两层未经证明的推断**。C1/C2 已经证明 resource-id 不能承担这种语义。

### 冻结口径（审核建议，我采纳）

```
C4_EMOJI_RENDERING_KIND: UNRESOLVED

DIRECT_EVIDENCE:
  - node resource-id = emotion_image
  - rendered pixels captured

UNPROVEN:
  - bitmap asset
  - vector drawable
  - platform emoji font
  - runtime-generated bitmap
  - other drawable pipeline

IMPLEMENTATION_IMPACT: FREEZE — no product change
```

审核明确确认：**"你现在'不接入已经裁出来的六个素材'是正确的。"**

### 字符识别同样不得升级为正式事实

```
ORIGINAL_EMOJI_CHARACTERS: NOT_CAPTURED
VISUAL_CANDIDATES: 😂 / 🤩? / 💛? / 👀 / 😱 / +1
EVIDENCE_STRENGTH: WEAK
```
> 尤其 #2 已经发生 🤩/👑 冲突，**更不能据此改 mock.ts**。

### 关于我提的"同平台字体渲染对比"

> 认可为**旁证**，但**不认可作为定论路径**。

## 二、我必须承认：我的 §六 修正**又走过头了**

我在 `C4-EVIDENCE-CONFLICT.md` §六 里主张：

> 结构级证据（树里无 emoji 文本 + `emotion_image` 节点）是**强证据**，
> **支持"图片/非字符字形"**；弱证据是像素读数 → 强证据优先。

**这个主张有问题**，因为"树里没有 emoji 文本"**只证明了一件事**：

```
它证明: 该行**不是**用普通 TextView 渲染的文本
它没有证明: 它是"位图素材"还是"用字体在 Canvas 上 drawText 画出来的"
```

**关键的反例**：一个自定义 View（或 ImageView）完全可以**用 Canvas.drawText 配 emoji 字体**
把字形画上去 —— 那样 **uiautomator 里同样看不到 text**，但它**是字体渲染的**。

也就是说：我的"结构级证据"**只排除了最简单的那种实现（TextView+字符）**，
**并不能区分**"位图素材"与"字体绘制"两种可能。
而审核列的 `UNPROVEN` 清单里恰好同时包含 `bitmap asset` 与 `platform emoji font` ——
**它比我更准确。**

**结论**：审核的 `UNRESOLVED` + 五条 UNPROVEN 清单，是对当前证据的正确刻画；
我 §六 的"强证据支持是图片"应撤回，改为"**只排除了 TextView 一种实现**"。

## 三、这是同一模式的第六次，但形态不同

前五次（pitch/gap、坐标基准、样本来源、我的 runtest 担心、把强弱证据并列）都是
**"先下结论、后补证据"**。这次是另一种：

> **我在做"自我纠正"时，用力过猛地把天平推向了另一边。**

即：我先犯了"照 id 名字下结论"，纠正时又犯了"把一条只能排除一种实现的证据
说成支持另一种实现"。**两次都不是由证据决定结论，而是由"我上一轮站哪边"决定。**

**这条值得单独记**：自我纠正本身也需要按证据强度来定，而不是"反着说一次就平衡了"。

## 四、处置

- [x] C4 冻结为 `UNRESOLVED` + 审核的五条 `UNPROVEN` 清单
- [x] `IMPLEMENTATION_IMPACT: FREEZE`（不改产品、不接入 6 个素材）
- [x] 字符维持 `NOT_CAPTURED` + `VISUAL_CANDIDATES`（WEAK），**不动 mock.ts**
- [ ] §六 的"强证据支持是图片"表述待改（本轮已在本文件更正，§六 原文保留以追溯）
- [ ] "同平台渲染对比"若要跑，定位为**旁证**，不得单独定论
