# C4 取证结果（审核记录 29 批准的第一层 + 结构层）：**形态已确认是 Drawable（非字体字形）**

> 时间：2026-09-21 22:12｜APK sha256 校验**通过**（`3373B6B2…D6C294`，与既有证据同一版本）

## 一、决定性证据：每个表情项的**运行时视图类**是 `android.widget.ImageView`

来自我们**早已入库**的 `docs/original-baseline/raw-dumps/message-board-dump.xml`：

```
id=rvEmojiList    class=androidx.recyclerview.widget.RecyclerView   bounds=[0,1711][1080,1781]
id=fl_emoji_root  class=android.widget.LinearLayout                 bounds=[21,1711][91,1781]
id=emotion_image  class=android.widget.ImageView                    bounds=[35,1725][77,1767]
id=fl_emoji_root  class=android.widget.LinearLayout                 bounds=[133,1711][203,1781]
id=emotion_image  class=android.widget.ImageView                    bounds=[147,1725][189,1767]
…（共 6 组，逐组都是 LinearLayout 容器 + ImageView 子项）
```

**6 个表情项，逐个都是 `android.widget.ImageView`** —— 且是**框架类本身**，不是自定义子类。

### 为什么这足以定性

`android.widget.ImageView` 的内容接口是 `setImageResource` / `setImageDrawable` / `setImageBitmap`，
**它渲染的是 `Drawable`；它没有渲染任意字体字形的能力**（那需要 TextView 或自定义 View 的 `drawText`）。

→ **原版的表情不是「TextView 里的文字字符」** —— 这一点由**运行时观测**直接支持，
不是从资源名推断的。

⚠ **这也纠正了我此前的一处方法论错误**（见 §四）。

## 二、第一层：资源 inventory（审核要求的第一层）

### 2.1 APK 里**没有**按名字可识别的表情图片资源

扫描 APK 全部 **4099** 个 zip 条目，匹配 `emoji|emotion|expression|emoticon|sticker|smiley?|mood`
且位于 `res/` 或 `assets/` 的，**只有 1 个**：

```
assets/fonts/SmileySans-Oblique.otf
```
⚠ **这是中文字体「得意黑」(SmileySans)，是文本字体，不是 emoji 字体** —— 名字里的 "Smiley" 是误导。

### 2.2 但 `resources.arsc` 里存在成体系的 emoji/emotion 资源名

精确扫描（30101 条可打印串）得到：

```
emoji 相关（节选）:
  xhs_theme_xhs_emoji_file_name        ← 主题属性：emoji **文件名**
  xhs_theme_xhs_emoji_name
  xhs_theme_xhs_emoji_res_v2           ← 主题属性：emoji **资源**（v2）
  emojiCompatEnabled
  emoji_type
  emoji_recommend / emoji_very_happy / emoji_avoid
  im_personal_emoji_icon / im_select_emoji / im_more_emoji_btn_red_dot
  red_view_emoji_*  (collection / keyboard_layout / lottie_layout / tab_emoji …)
  rvEmojiList / rv_recent_emoji / rv_search_emoji
  ivEmoji / iv_emoji / iv_add_emoji / emojiBtn / emojiLine / emojiPanel / emojiTabLayout
  widgets_xhsemoji_1
  emotion_personal_emoji / emotion_preview_emoji

emotion 相关（节选，含**同族并列的 image 与 text**）:
  emotion_image        emotion_text          ← 同一族里 image 与 text 并列
  emotion_lottie_image emotion_lottie_layout emotion_lottie_name
  emotion_preview_image emotion_preview_text emotion_preview_lottie emotion_preview_pag
  emotion_author_avatar emotion_author_name emotion_author_tag emotion_author_title
  rv_emotion  red_view_emotion_item  red_view_emotion_preview
  red_view_personal_emotion_item  red_view_personal_emotion_title
  emotionViewPager
```

### 2.3 一条关于该 App 技术栈的事实

`xhs_*` 前缀（`xhs_theme_*`、`widgets_xhsemoji_1`）指向 **小红书 (Xiaohongshu / RED)** ——
说明 `com.kairuotu.campus` **构建在小红书的技术栈/主题体系之上**（或复用其组件库）。
这不是 C4 的结论，但对理解该 App 的资源体系有价值，故登记。

### 2.4 为什么"没有按名字可识别的表情图片"**不能**证明字体渲染

审核已预先写明这一点，本次实测与之相符。可解释该"缺失"的可能：
名称混淆 / atlas-sprite 打包 / 放在 `assets` 的自定义目录 / **网络下载**（`emoji_file_name` 提示了这条）/
**运行时生成位图**。

→ 因此**第一层单独不足以定论** —— 但 §一 的运行时视图类是另一类证据。

## 三、第二层的尝试与结果（审核说"更重要"的那层）

### 3.1 尝试：从布局文件反查 `emotion_image`

**结果：0 个布局文件含 `emotion_image`。**
原因（已查明）：AXML 布局里 `android:id="@+id/xxx"` 编译为**整数资源 ID**，
**资源名字符串只存在于 `resources.arsc`**，布局文件里没有名字。
→ 靠"在 layouts 里搜名字"这条路**结构上走不通**（不是我们做错了，是该方法的固有限制）。

### 3.2 因此绑定链的正确追法（可行，但需要 arsc 解析）

```
需要: 1) 从 arsc 解析出 `emotion_image` 的资源 ID 整数（0xPPTTEEEE）
      2) 在各 AXML 布局的字节流里搜该 4 字节小端值 → 定位到使用它的布局
      3) 读该布局的视图类名（类名在 AXML 字符串池里，可读）
      4) 再从 DEX 追 ViewHolder/adapter 的 bind 调用
```
**本次未做**（需要写一个 arsc 解析器；且审核明确"若无法越过资源存在性到实际绑定来源就停止扩张"）。
→ **如实记为未完成**，不是"已完成"。

## 四、⚠️ 我必须记的一处方法论错误（比结论更重要）

**决定性证据一直是 `class="android.widget.ImageView"`，它就在我们已入库的 dump 里。**
而我历次分析这个 dump 时：

- 提取过 `resource-id`（得到 `emotion_image`）✓
- 提取过 `bounds`（算出 6 项几何、pitch 112）✓
- **从没提取过 `class`** ✗

**这直接导致 C4 长期停在"UNRESOLVED"，并且我一度把结论建立在前者的基础上**（照 id 名字推断），
又在自我纠正时过度否定。**而真正的答案（视图类）就在同一条节点记录里，紧挨着我读过的那两个属性。**

→ **纪律（新）**：**读取控件树节点时，`class` 是与 `resource-id`、`bounds` 同等的一等属性，必须一并提取。**
   只取 id 会退化成"照名字猜"，只取 bounds 会退化成"只看几何" —— 两者都漏掉了"这是什么控件"这一层。

## 五、修正后的 C4 口径（请审核裁定是否可解冻）

```
C4_EMOJI_RENDERING_KIND: **形态已确认 = Drawable-based（非 TextView 文字字形）**
  FORMED_EVIDENCE（强，运行时观测）:
    6 个表情项的视图类均为 android.widget.ImageView（框架类本身）
    → 渲染对象是 Drawable；ImageView 不具备渲染任意字体字形的能力
  SUPPORTING（结构）: arsc 中存在 emotion_image / emotion_lottie_image / emoji* 资源族，
                     以及 xhs_theme_xhs_emoji_res_v2 / _file_name 主题属性
  UNPROVEN（仍未定）: 该 Drawable 的来源是
    (a) 随包资源 / (b) 运行时由 emoji 字体生成的位图 / (c) 网络下载的文件
    —— 三者都与"ImageView + Drawable"相容
  NOT_CLAIMED: 不复刻具体图标（来源未知）；不宣称"我方直接用文字 emoji 是错的"以外的形态结论

IMPLICATION_FOR_US:
  我方用**文字字形**渲染表情 → 与"ImageView + Drawable"**形态不符** → 该偏差**成立**（此前 DISPUTED）
  但**具体该画什么**（用哪套图标）仍无依据 → 产品改动仍应**冻结**，直到有意愿处理该形态差异
```

## 六、据审核的停止条件

审核写明："如果仍无法越过'资源存在性'到'实际绑定来源'，就停止扩张调查。"
本次：
- **越过了一半**：从"资源存在性"推进到"**运行时控件类 = ImageView**"（这是绑定结果的直接观测，
  比资源名强得多 —— 它证明渲染对象是 Drawable）
- **未越过**：Drawable 的**来源类别**（随包/运行时生成/网络）

→ 我建议：**C4 由 `UNRESOLVED / FROZEN` 更新为 `FORM_CONFIRMED / ASSET_SOURCE_UNKNOWN`，
产品改动继续冻结**；是否要再投入一个 arsc 解析器去追布局与 bind 调用，**请审核裁定**。

---

## 附：可点性核验 —— 排除"反应展示"替代解读，确认是**表情选择器**

我提出过一个必须核实的替代解读：**若这些表情不可点，它们可能是"情绪反应展示"而非表情输入行。**
查同一条 dump 的可点性属性后，**该解读被排除**：

```
rvEmojiList    class=RecyclerView   clickable=false  focusable=true   [0,1711][1080,1781]
fl_emoji_root  class=LinearLayout   **clickable=true**  focusable=true   [21,1711][91,1781]   ← ×6
emotion_image  class=ImageView      clickable=false  focusable=false   [35,1725][77,1767]   ← ×6
```

**结构解读**：

```
横向 RecyclerView（y=1711–1781，紧贴输入区上方）
  └ 6 个**可点**的 LinearLayout 容器（fl_emoji_root，承担触摸目标/涟漪）
      └ 各含 1 个**不可点**的 ImageView（emotion_image，仅作视觉）
```

**即：标准的"表情选择器"项结构**（可点容器 + 内部图标）。
**反应展示不需要"容器可点"**，故该替代解读不成立。

**旁证**：同页可点节点列表里，`fl_emoji_root` ×6 与 `tvSendComment`（"留言"，可点）并列出现 ——
进一步印证这一行属于**输入型控件**，而非只读展示。

---

## 结论（最终）：C4 的**形态**已有完整结构链支撑

```
rvEmojiList(RecyclerView)
  → fl_emoji_root(LinearLayout, clickable=true) ×6
    → emotion_image(**android.widget.ImageView**) ×6

→ 表情项 = 可点容器 + ImageView(Drawable) 图标
→ 原版**不是**用 TextView 渲染文字字符（ImageView 无渲染字体字形的能力）
```

**证据等级**：**运行时控件树观测**（非资源名推断）。这是本项目对 C4 拿到的最强一类证据。
