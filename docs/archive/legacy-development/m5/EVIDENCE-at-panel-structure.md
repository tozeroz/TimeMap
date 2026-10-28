# 原版 AT 面板（@ 提及）**结构证据** —— 可采信（静态 APK，零设备交互）

> 时间：2026-09-22 02:00
> 起因：AUDIT §7.6 把「@所有人」列为「**设计决定：不做**」，理由是"**我方缺证据**"。
> 本轮静态取证发现：**原版明确有 @所有人**（`at_all` 项），因此那条"决定"的依据**已不复成立**。
> 方法：`aapt2 dump resources` + `aapt2 dump xmltree`（APK sha256 已核验与基线一致）
> 可复现：`scripts/m5/probe-at-panel-structure.sh`

## 一、为什么这次证据**可采信**（与既往被标 INADMISSIBLE 的那次不同）

```
既往: AT_PANEL_VISUAL_CONFORMANCE = NOT_EVALUATED
      reason = CONFORMANCE_EVIDENCE_INADMISSIBLE(third-party write)
      —— 那次证据是在一次**越界写操作**期间取得的（见 docs/archive/legacy-development/POLICY-VIOLATION-2026-09-21.md）

本次: **纯静态 APK 分析** ——
      · 不触碰原版 App、不触碰任何服务器
      · APK 文件 sha256 = 3373B6B2…D6C294（与基线一致，可核对）
      · 结论可由任何人用同一条 aapt2 命令复现
      → 不涉及"写操作"，故**不落入 INADMISSIBLE**
```

⚠️ **声明强度**：本证据是"**原版声明了这些控件与文案**"，
**不是**"渲染出来就是那样"（渲染态需 VISUAL 证据，本文件不声称）。

## 二、面板骨架（`layout/activity_group_at_panel` → 混淆路径 `res/XZ.xml`）

```
ConstraintLayout  id=0x7f0a0625  width/height=match  clickable=true
                   background=@android:…（系统半透明）        ← 全屏遮罩层
└ ConstraintLayout id=0x7f0a01f4  width=match height=wrap
                    background=@0x7f0800be  clickable=true
                    **constraintBottom_toBottomOf=parent**     ← 底部锚定（bottom sheet）
    ├ ImageButton  id=0x7f0a0119  size=@0x7f070432 × @0x7f07042a
    │              contentDescription=@0x7f130102 = **"关闭"**   clickable
    ├ TextView     id=0x7f0a0786  **textSize=16sp, textStyle=bold, gravity=center**
    │              text=@0x7f130077 = **"选择提醒的人"**
    ├ TextView     id=0x7f0a076d  **visibility=GONE**  text=@0x7f130075 = "暂无群成员"
    │              margin=40dp                                  ← 空态
    └ RecyclerView id=0x7f0a05ec  **layout_height = 500dp（固定）**  paddingBottom=@0x7f0703df
```

**读出的结构事实**：
- 这是一个**底部弹层**（bottom sheet），不是全屏页
- 标题 **16sp / bold / 居中**，文案固定为「**选择提醒的人**」
- 关闭按钮的 accessible name 是「关闭」
- 列表高度**固定 500dp**（不随内容伸缩）
- 空态文案「暂无群成员」，加载失败文案「加载失败」

## 三、⭐ 「所有人」项（`layout/item_at_panel_at_all` → `res/KW.xml`）

```
ConstraintLayout  height = **88dp**   paddingStart/End = @0x7f0703df
  ├ ImageView id=0x7f0a038d  size = @0x7f070423（56dp）× 56dp   src=@0x7f08029f
  │           contentDescription = @0x7f130074 = **"所有人"**
  └ TextView  id=0x7f0a0772  textSize=16sp  layout_width=0dp（占满剩余）
              text = @0x7f130074 = **"所有人"**   marginStart=@0x7f0703d0（12dp）
```

**结论**：
```
AT_ALL_EXISTENCE:            **CONFIRMED**（原版有"所有人"项，独立布局 + 独立字符串）
AT_ALL_LABEL:                "所有人"（string/at_all）
AT_ALL_ITEM_GEOMETRY:        行高 88dp；前置图标 56dp×56dp；标签 16sp；图文间距 12dp
AT_PANEL_TITLE:              "选择提醒的人"（16sp bold 居中）
AT_PANEL_KIND:               底部弹层（bottom-anchored），列表固定 500dp
AT_PANEL_SECTIONS:           存在 item_at_panel_section_header（分组标题）
AT_PANEL_EMPTY / FAILED:     "暂无群成员" / "加载失败"
```

## 四、**这推翻了 AUDIT §7.6 的一条"设计决定"**

AUDIT 原文把 `@所有人` 放在「§7.6 设计决定（不是待办）」，理由引用我方代码注释：

> `index.ts:1500`："不做 @所有人 —— 若将来要做，必须单独明确语义，
>  绝不能伪造成某个 user id（那会让"提到全体"与"提到某人"在数据上无法区分）"

**复核后的正确理解**：
- 那条注释里的**技术担忧仍然成立且正确**（不能把"全体"伪造成某个 user id）
- 但把它据此列为「**设计决定：不做**」**是错的** —— 它的真实理由只是"**当时没有证据**"
- **现在证据有了**（原版确有 `at_all` 项）→ 它应当回到 **(B) 类真实实现缺口**

## 五、缺口的两半：UI 有证据，服务端表示法**仍需我方设计决定**

```
✅ UI 侧：证据充分（本文件）——
   面板标题 / 底弹层形态 / "所有人"项行高 88dp、图标 56dp、标签 16sp、
   分组标题存在 / 空态与失败态文案 —— 都可实现

❓ 服务端侧：**原版如何表示"提到全体"未知** ——
   要取得它需要观察网络请求或服务端数据，**在当前只读范围内不可得**。
   → 因此这属于**我方的设计决定**，不是"复刻"：
     例如在消息上增加 `mentions_all boolean`（而不是伪造一个 user id）
   → 必须如实标注：
     `AT_ALL_SERVICE_REPRESENTATION: OUR_DESIGN_CHOICE / ORIGINAL_UNKNOWN`
     不得声称"与原版一致"
```

## 六、媒体预览（同批静态取证，作为 `MEDIA_PREVIEW_VISUAL` 的结构补充）

```
layout/activity_image_preview            id/im_image_preview_root
layout/activity_single_image_preview     id/photo_view
layout/chat_image_preview_bottom_bar     id/chat_media_preview_message_uuid
```
→ 存在"会话内图片预览 + 底部栏"的独立布局（**结构证据**已具备）；
渲染态视觉仍为 `NOT_EVALUATED`（需 VISUAL 证据）。

**分层表述（建议）**：
```
AT_PANEL_STRUCTURAL_CONFORMANCE:        EVIDENCE_SECURED（本文件）
AT_PANEL_VISUAL_CONFORMANCE:            NOT_EVALUATED（仍需渲染态证据）
MEDIA_PREVIEW_STRUCTURAL_CONFORMANCE:   EVIDENCE_SECURED（布局存在）
MEDIA_PREVIEW_VISUAL:                   NOT_EVALUATED
```

## 七、待审核裁定

```
1. 认可把「@所有人」从「设计决定：不做」改回 **(B) 类实现缺口**吗？
   （依据：原先的不做理由是"缺证据"，而证据现已取得）
2. §五 的"服务端表示法属我方设计决定"这一表述是否认可？
3. 是否要立 WO#8（AT 面板 + @所有人）？还是先做 WO#7（文字发送）？
4. "结构证据"这一分层（STRUCTURAL vs VISUAL）是否值得正式命名并写入计划？
```
