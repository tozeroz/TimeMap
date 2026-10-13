
---

## 八、新的取证能力：**从原版 APK 的资源表提取资源名**（可用于 C4）

### 事实

观察者（`659cfcd8`）在中断前产出了一种**此前本项目从未使用过的证据来源**：

```
docs/test/original-baseline/screens/original-chat/arsc-chat-resource-names.txt   （352 行）
```

其头部自述：

> `# Original app resource names related to chat message direction`
> `# (raw product; **regeneration recipe is in ./INDEX.md section 4**)`
> 并说明：开头那些 `!!` `""` `&&` 等是**提取产物**（`resources.arsc` 的字符串池按
> "可打印 ASCII 连续段"扫描时可能从字节中间起算），**真名是最后一个非标识符字符之后的部分**。

**即：这是从原版 APK 的 `resources.arsc` 提取资源名的结果，且重跑配方已文档化。**

### 对本项目的意义（两条）

1. **它给出了"应用自身声明"级别的证据**——不同于渲染观测（截图/bounds），
   资源名表达的是**应用的设计意图**。它在气泡偏差上直接给出了
   `im_chat_left_*` / `im_chat_right_*` 成对布局（见 `CHAT-SENDER-PRESENTATION-CONFIRMED.md` §六）。
   本次还额外看到 **`stickerBoundLeft` / `stickerBoundRight`** 另一组左右成对命名。

2. **⚠️ 它也可以用于 C4 —— 但本文件不能直接用**
   本文件是**针对"聊天方向"的定向提取**（头部明写），因此：
   ```
   文件里没有 emoji/emotion 相关条目 ≠ 原版没有表情资源
   —— 因为这次提取的范围根本不覆盖那些资源。
   ```
   **不得**把"这里没有 emoji 资源名"当成"C4 的图片假设不成立"的证据 —— 那是**取样偏差**。

### 因此 C4 多了一条可走的取证路径（此前没有）

```
C4_EMOJI_RENDERING_KIND: UNRESOLVED（保持）
新增可选路径: 按 INDEX.md §四 的配方**重跑一次提取**，但范围改为表情相关
             （搜 emoji / emotion / face / emotion_image / 表情 相关资源名）
预期判读方式（先写明，避免事后凑结论）:
  · 若存在一组 emoji/表情 **图片资源**（drawable 名下有成套表情）→ 支持"图片素材"
  · 若完全没有任何表情资源、且该 UI 由字体渲染 → 支持"字体字形"
  · 若资源名不足以判定（例如只有 `emotion_image` 这类通用名）→ **仍为 UNRESOLVED**
⚠ 且即便提取到资源名，它**仍不能单独定论**：
   资源名存在只说明"声明了该资源"，不说明"运行时用它渲染"
   → 它是**强线索**，需与渲染观测交叉；单凭它仍不足以把 C4 从 UNRESOLVED 变为结论。
```

### 处置

- **C4 维持 UNRESOLVED + FREEZE**（不因本条改动状态）
- 把"APK 资源名提取"登记为**可复用的取证能力**（配方在
  `docs/test/original-baseline/screens/original-chat/INDEX.md` §四）
- 若后续要做 C4 的定向提取，**先按本节写好的判读方式执行**，不要事后凑标准
