# Conformance finding 范本：留言板表情行（按审核记录 21 的 Gate 原则写成）

> 时间：2026-09-21 17:48（Asia/Shanghai）
> 依据：审核记录 21 要求"每个 conformance finding 具有
> `raw_evidence → extraction/observation → conclusion → implementation impact` 这条链"。
> 本文件既**记录该 finding 的结论**，也**作为这条链的书写范本**（后续 finding 照此格式）。

## 一、raw_evidence（可复核的一手产物）

| 产物 | 路径 | 获取方式（纯只读） |
|---|---|---|
| 留言板控件树 | `docs/original-baseline/raw-dumps/message-board-dump.xml` | `am start -a VIEW -d campusx://messageBoard com.kairuotu.campus` → `uiautomator dump` → `adb pull` |
| 校园广场控件树 | `docs/original-baseline/raw-dumps/board-observation-1.xml` | 拉起原版后直接 dump（用于 tab 项数） |

两份都在仓库内，可被任何人重新读取与复算。
**注意**：旧记录引用的截图（`screens/message-board/normal.png`）**不是**本 finding 的 raw_evidence ——
它无法复算数量、也不含字符，这一点是上一轮错误结论的根源。

## 二、extraction / observation（从产物中读出什么）

- 在 `message-board-dump.xml` 中检索 `fl_emoji_root`：**出现 6 次**
- 该节点所在容器 `rvEmojiList` 的 class 是 `androidx.recyclerview.widget.RecyclerView`
- 检索 `text` 与 `content-desc` 中属于 emoji 码位（U+1F300–U+1FAFF、U+2600–U+27BF）的字符：**0 个**
- `board-observation-1.xml` 中底部 tab 的 label：`校园广场` / `自定义名称6` / `校园` / `地图`（4 项）

## 三、conclusion（冻结口径 —— 注意 NOT_EVALUATED 与 PASS 是不同事实）

```
ORIGINAL_VISIBLE_EMOJI_ITEMS:    6            ← 从 dump 可复算（可见/已附着节点数）
CURRENT_VISIBLE_EMOJI_ITEMS:     6            ← 我们实现里 boardEmojis.length
VISIBLE_EMOJI_COUNT_CONFORMANCE: PASS         ← 两者相等，这一条可以判 PASS

ORIGINAL_TOTAL_EMOJI_COUNT: NOT_EVALUATED     ← RecyclerView 可能只 dump 已附着项；
                                                不能由"可见 6"推出"总共 6"
EMOJI_CHARACTERS:           NOT_CAPTURED      ← 可访问性树里没有字符
EMOJI_SPACING:              NOT_EVALUATED     ← 旧记录提到 112px，但无原始产物
```

**撤销项**：旧结论 `ORIGINAL_EMOJI_COUNT = 7`（无原始产物支撑）→ **撤销**。

## 四、implementation impact

| 事实 | 对实现的影响 | 状态 |
|---|---|---|
| 可见项数 6 | `boardEmojis` 取 6 项 | ✅ 已实现（`28f715e`，从错误的 7 回退） |
| 总数未评估 | **不得**据此声称"表情行与原版一致" | 遵守：`mock.ts` 注释已标明 |
| 字符未采集 | **不得**声称字符一致；不得为凑字符而改实现 | 遵守：注释标明 `NOT_CAPTURED` |
| tab 4 项 | 我们只有 3 项 → **deviation** | ✅ 已登记（`3a7fda4`），实现另立一单 |

## 五、本 finding 暴露并已被采纳的两条纪律

1. **只有摘要、没有原始产物的证据，不足以驱动产品改动。**
   （我上一轮正是据一条无可复核产物的摘要把实现从 6 改成 7 —— 真实的一致性回归。）
2. **审核记录 21 正式升级为 Gate 原则**：
   > 任何用于驱动 conformance 产品改动的事实，必须能追溯到可复核原始产物；
   > 只有摘要、没有原始产物的内容只能作为线索，不能单独触发实现变更。

## 六、遗留（明确列出，避免"缺省当作完成"）

- 想冻结 `ORIGINAL_TOTAL_EMOJI_COUNT`，需要能证明 `rvEmojiList` **不可横向滚动**
  或**数据集只有 6 项**的只读证据（例如滚动后再次 dump 并比较，或找到数据源 id）。
  **这属于一次新的只读观察**，尚未做。
- `EMOJI_CHARACTERS` 若要采集，需要别的证据渠道（可访问性树里没有）——
  可能只能靠截图人工辨认，而那是**弱证据**，不足以驱动实现。

---

## 七、追加观察（纯本地几何分析，零设备风险）：总数可从几何推出

审核记录 21 说：想把 `ORIGINAL_TOTAL_EMOJI_COUNT` 冻结，需要"能证明 `rvEmojiList`
不可横向滚动、或数据集确实只有 6 项"的证据。**这份证据其实已经在 dump 里**，
不需要再做手势实验（而且**手势实验本身有风险**：emoji 行紧邻「留言」按钮，
误触即构成写操作 → 违反用户的只读硬约束，所以我不做）。

### 从 `message-board-dump.xml` 复算（任何人可重做）

```
rvEmojiList 容器:  x = [0, 1080]   宽 = 1080（= 整屏宽）
fl_emoji_root ×6:  宽均为 70
  左边界: 21, 133, 245, 357, 469, 581
  相邻左边界之差: 112, 112, 112, 112, 112   ← 间距恒为 112
最后一项右边界: 581 + 70 = 651
右侧剩余空间: 1080 - 651 = 429
```

### 推论

若存在第 7 项，按恒定 112 间距它会排在 **x = 693**，
其右边界 763 < 1080 —— **完全放得下、必然被布局并附着**，因此必然出现在 dump 里。
它没有出现，且右侧还空着 429px（不是"填满后截断"）。

→ **数据集就是 6 项**（前提假设：该行按固定 112 间距左起排布、不做分页/分组；
dump 中未观察到分组或分页迹象）。

### 因此可更新结论

```
ORIGINAL_TOTAL_EMOJI_COUNT: 6   ← 由几何推出（原为 NOT_EVALUATED）
EMOJI_SPACING:              112px  ← 由 dump 实测确认（原为 NOT_EVALUATED）
```

**但要如实标注强度**：这是**几何推论**，不是"把全部项都 dump 出来了"；
假设已写在上文。若审核要求更强的证据（例如证明该 RecyclerView 的 layoutManager
是横向且 itemCount 固定），需要能读取该控件内部状态的手段，目前没有。

### 一个值得记的细节：**一条旧记录可以"一半对一半错"**

旧记录 `supplements/message-board.json` 同时说了两件事：
- "恰好 **7** 个" → **错**（实际 6）
- "间距 **112px**" → **对**（与本次实测完全一致）

所以处理旧记录时**不能整条接受、也不能整条丢弃** ——
要**逐项**核对：能用原始产物复算的留下，不能复算的降级或撤销。
这比"整体信任/整体不信任"更符合这门纪律的本意。