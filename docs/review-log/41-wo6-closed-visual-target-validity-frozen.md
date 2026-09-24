# 审核记录 41：**WO#6 PASS / CLOSED**；新增冻结纪律 `VISUAL_TARGET_VALIDITY GATE`

> 审核方：ChatGPT web；时间：2026-09-22 01:50（Asia/Shanghai）
> 本轮提交：WO#6 实施结果 + 两处修正落实 + FAB 挂起 + 前台 App 误拍事故

## 一、正式裁定

```
WO6_TABBAR_VERTICAL_LAYOUT: PASS
TAB_ITEM_ORIENTATION:       PASS
TAB_LABELS_PRESERVED:       PASS
TAB_NAVIGATION_REGRESSION:  PASS
FAB_GEOMETRY_UNCHANGED:     PASS
TABBAR_HEIGHT_UNCHANGED:    PASS
M5_SERVER_REGRESSION:       PASS
**WO6_FINAL_CLOSE: CLOSED**
```

审核特别指出本单 PASS **有实际证明力**的两个原因（值得作为后续 Gate 的标准）：
> "一是同一 Gate 在改动前真实 FAIL、改动后 PASS；
>  二是断言直接测 **rendered geometry**，而不是检查 `flex-direction: column` 这类实现细节。
>  也就是说，即使未来 CSS 重构，只要用户看到的排布仍正确，Gate 仍然成立。"

→ **可推广的原则**：Gate 要断**可观察结果**（渲染后的几何/行为），不要断**实现细节**。

`INACTIVE_EXACT_SIZE/STYLING: NOT_EVALUATED` 与 `FAB_VISIBLE_DIAMETER: NOT_MEASURED_RELIABLY`
**都不影响 WO#6 关闭**。

## 二、⭐ 新冻结纪律：`VISUAL_TARGET_VALIDITY GATE`

审核认为这不是普通操作提醒，而是**视觉证据 provenance 的前置条件**，建议**独立命名**。

### 2.1 这次的危险形态（必须记住）

```
CDP target    = 我方 WebView        ← 测量对象看起来完全正确
screen pixels = 原版 App            ← 但像素来自**另一个进程**
```
> "两者居然可以同时成立。所以以后任何截图如果没有目标身份验证，都存在：
>  **'测量方法完全正确，但测的是错误对象'** —— 这种比坐标算错更根本的问题。"

### 2.2 冻结语义（与 DEVICE_HEALTH **分开**）

```
Before capture:
    target foreground package/activity == expected
    if CDP is used:
        CDP target URL/route == expected

Capture

After capture:
    foreground package/activity still == expected
```

失败时的判定（**不是产品 FAIL**）：
```
VISUAL_TARGET_VALIDITY: FAIL
  → screenshot evidence **INVALID**
  → **no product verdict**
```

### 2.3 为什么必须与 `DEVICE_HEALTH` 分开

> "二者证明的东西不同：
>   DEVICE_HEALTH        → 设备能正常响应输入/刷新画面
>   VISUAL_TARGET_VALIDITY → 当前画面确实属于我要验证的对象
>  这次就是一个非常好的反例：**设备健康问题与目标身份问题不能互相替代**。"

（本轮的实证：设备健康探针当时报 `B 屏幕未重绘`，那是 DEVICE 层的信号；
而真正的问题是**前台是另一个 App**，属 VISUAL_TARGET 层。我当时把前者当成了后者。）

### 2.4 处置方式也被认可

> "你现在采用：目标不在前台 → `am start` 拉回自己的 App；**绝不默认 force-stop 原版**
>  —— 也符合我们之前冻结的第三方进程干预纪律。"

## 三、测量纪律体系现状（两条互补）

```
测量清单（5 条）                → 防 "**量错东西**"（definition/unit/frame/semantic box/method）
VISUAL_TARGET_VALIDITY GATE     → 防 "**量对方法但量错对象**"
```
审核要求：**两条同时长期保留**。

## 四、下一步优先级：**群聊 composer 只读取证 > AT_PANEL / MEDIA_PREVIEW**

审核给的顺序与理由：

1. **先处理群聊 composer，但先作为 `evidence acquisition`，不直接开实现 WO**
   —— 理由：高频用户界面 + 已有新的 admissible 只读线索 + 容易继续纯只读取证 +
     若发现差异，实现语义通常也明确
2. `AT_PANEL_VISUAL` / `MEDIA_PREVIEW_VISUAL` 当前最大障碍**不是"代码没写"**，
   而是"原有证据 inadmissible，需要先找到新的只读可达路径" → 收益不确定性更高，排后

**建议的下一轮顺序**（照此执行）：
```
① 把本次误拍的原版群聊 composer 原始截图 + 前台 Activity + 时间 + 入口条件
   **正式登记为 candidate raw evidence**（注意：只是"候选线索"）
② 再通过**合规的只读路径**重新进入群聊，专门采一套 composer 截图 + UI dump
   （**必须**通过 VISUAL_TARGET_VALIDITY）
③ 做 original ↔ current 的 claim-level comparison
④ **只有**发现"证据明确且修法明确"的 deviation，才报 WO#7
⑤ composer 收束后，再尝试 AT_PANEL / MEDIA_PREVIEW 的新只读证据来源
```

⚠️ 审核明确的边界：
> "这次'误拍'虽然是真实原版观察，但因为它最初**不是按 composer finding 设计采集的**，
>  我不建议**单靠半张偶然截图就驱动产品改动**。把它作为发现线索，
>  再补一次目标明确、VISUAL_TARGET_VALIDITY 通过的正式采集，会干净很多。"

## 五、账本更新（审核给定）

```
WO#1  board_notes:          CLOSED
WO#2  chat image:           CLOSED
WO#3  sender presentation:  CLOSED
WO#5  voice core:           CLOSED
WO#6  tab vertical layout:  CLOSED
WO#4  emoji exact mapping:  DEFERRED / evidence-limited
NEXT: group-chat composer read-only conformance **acquisition**
```
