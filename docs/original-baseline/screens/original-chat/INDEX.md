# 原版聊天页只读观察产物（`docs/original-baseline/screens/original-chat/`）

> 采集时间：2026-09-21 20:52–20:57（本地时区 +08:00）
> 设备：MuMu 模拟器 `127.0.0.1:16384`，`BVL_AN00`，1080x1920
> 观察对象：原版第三方 app `com.kairuotu.campus`（**全程只读**）

## 〇、⚠️ 先说清数据来源：本次观察到的消息**全部是人工伪造的**

本次能观察到的唯一非空会话是群聊 `GroupForEvidence(1)`，其 2 条消息**不是真实用户的聊天记录**，
而是**此前一次越界写操作造出来的**。出处（可核对原文）：

| 出处 | 原文要点 |
|---|---|
| `docs/POLICY-VIOLATION-2026-09-21.md:27-29` | 10:23 创建群聊 `GroupForEvidence`；10:24 在该群发送文本「@」；10:26 通过相册发送 1 张图片 |
| `docs/original-baseline/supplements/at-panel.json:79` | "为取得群聊上下文，本次创建了 1 个群（名称 GroupForEvidence）并在群内发送 1 条文本「@」与 1 张图片。M0 环境为「未登录 + 无群聊」。" |
| `docs/original-baseline/supplements/environment-m3.json:28` | "创建 1 个群聊，名称：GroupForEvidence" |

因此有两条重要推论：

1. **这 2 条消息两边都必然是"自己发的"** —— 因为是同一个人在同一次操作里发的。
   这一点与 §三 结论 2（头像比对判定为本人）互为印证。
2. **原版至今没有任何"天然存在"的非空会话** —— 真正的"对方发的"消息
   **从未出现在可观察范围内**；要造一条出来就必须再写一次，**本任务按纪律拒绝**。

> 对照：更早的 commit `6f6dab1`（"气泡偏差判定：DEVIATION 成立"）已经基于同一批
> bounds 得出过"原版自己发的靠右、我们硬编码 --peer 靠左"的结论，并**自行标注**了
> "证据源于违规创建的那条消息"。本次是该结论的**独立复采**，不是新发现。

## 一、这次要回答的问题

原版的聊天会话页里，**"我发的消息"与"对方发的消息"在左右位置上是否有区分**。

这个问题会直接决定我们自己的实现要不要做左右分栏，
所以下面严格区分"**直接观察到的**"和"**只是间接推断的**"。

## 二、产物清单（每个文件名 = `<时间戳>-<步骤>.png/.xml`）

| 文件前缀 | 对应页面 | Activity | 能支持什么 / 不能支持什么 |
|---|---|---|---|
| `20260921-205223-01-launch` | 原版首页（三叉戟） | `com.kairuotu.trident.TridentActivity` | 支持：首页底部 tab 文案。**仅作导航起点记录** |
| `20260921-205307-02-tab6` | 个人主页（底部 tab「自定义名称6」） | 同上 | 支持：右上角存在无文字的聊天入口图标；**本人头像**。不能支持：聊天排布 |
| `20260921-205332-03-msg-entry` | 消息（会话）列表 | `...chat.messagepage.view.MessageActivity` | 支持：**该账号只有 1 个会话**，名 `GroupForEvidence(1)`，预览 `[图片]`。不能支持：气泡排布 |
| `20260921-205407-04-chat-open` | **群聊会话页（核心证据）** | `...chat.conversation.GroupChatActivity` | 支持：**本人消息的 bounds**（见 §三）。不能支持：对方消息排布 |
| `20260921-205451-05-scroll-older` | 同上，向下拖（找更早消息） | 同上 | 支持：**拖不动 —— xml 与 04 逐字节相同** |
| `20260921-205519-06-scroll-newer` | 同上，向上拖（找更新消息） | 同上 | 支持：同上 |
| `arsc-chat-resource-names.txt` | ——（资源表，非页面） | —— | 支持：原版资源表里**存在左右成对的消息布局名**（间接证据）。不能支持：实际渲染效果 |

**"拖不动"的判据（可复算）**：三份 dump 的 SHA256 完全相同 ——
`A9175D2BF1FB42F8…`（`04`/`05`/`06` 三者一致）。
→ 该 RecyclerView 内容装满视野且无新项，**这个群聊总共只有 2 条消息**。

## 三、核心结论与证据强度（⚠ 请按强度使用）

### 结论 1（**直接观察 / 强**）：本人消息靠右 —— 成立

`20260921-205407-04-chat-open.xml` 里，两条消息的头像与内容容器 bounds：

```
消息1  头像 userAvatarView        [ 989, 225][1052, 291]
       内容 chatContentRoot       [ 905, 225][ 975, 295]   ← 紧贴头像左侧
       内容 TextView chatContentView = "@"
消息2  头像 userAvatarView        [ 989, 323][1052, 389]
       内容 chatImageCardView     [ 625, 323][ 975, 790]   ← 图片气泡
```

屏幕宽 1080。头像 `x1=989`（右边缘），内容右边界 `x2=975`。
**两条消息都锚定在右侧**，头像在右侧、内容在其左 —— 右侧就是"自己发的"位。

### 结论 2（**头像比对 / 中强**）：右侧那两条确实是"我发的"

拿 `02-tab6`（个人主页的本人头像）与 `04-chat-open`（气泡旁头像）做视觉比对，
判定为**同一张头像**（发型/粉色眼睛/红色领口一致）。

⚠ 强度说明：这是**基于截图的视觉比对**，属"线索级"，低于控件树；
且头像在气泡里只有 63x66 px，比较模糊。**没有 dump 级证据**证明"右侧=本人"
（该 app 的头像节点 `content-desc` 为空，拿不到账号标识）。

### 结论 3（**资源表 / 间接**）：原版"有"左右区分的实现 —— 倾向成立，但非直接观察

`arsc-chat-resource-names.txt` 里同时存在：

```
im_chat_subitem_text_left_style_layout      文字消息：LEFT 样式布局
im_chat_subitem_voice_left_layout           语音消息：LEFT 布局
im_chat_subitem_voice_right_layout          语音消息：RIGHT 布局   ← 显式左右成对
im_chat_left_common_item_layout             左侧通用消息项布局
im_chat_left_content_layout                 左侧内容布局
im_chat_right_text_item_bg                  右侧文字气泡背景
im_chat_right_text_item_bg_night            同上（夜间）
chat_base_self_revoked_message              自己撤回的消息
chat_base_other_revoked_message             对方撤回的消息
```

"left 布局"单独存在，只有在**需要与右侧区分**时才有意义；
`voice` 更是直接给出了 `left`/`right` 一对。

⚠ **但这属于"看到了设计痕迹"，不等于"看到了渲染结果"**：
1. 本次**没有采到任何一条"对方发的"消息**，左侧气泡的 bounds **从未出现在控件树里**；
2. 该 app 的 apk 资源文件名被混淆（`res/--.xml` 之类的乱名），
   因此**无法确认** `GroupChatActivity` 实际 inflate 的是上述哪一个布局，
   还是"单一布局 + 运行时改 gravity"。
   （参考：实际 dump 里的 id 是 `chatContentRoot` / `userAvatarView` /
   `chatTextRootContainer` 这一类**不带 left/right 后缀**的名字。）
   这些 id 名与上面那批 left/right 名字存在于**同一个 resources.arsc** 中，
   但"同包"不等于"被这一页使用"。

### 汇总口径

| 断言 | 强度 | 依据 |
|---|---|---|
| 自己发的消息靠右 | **强（直接观察）** | 控件树 bounds + 头像位置 |
| 右侧那两条是自己发的 | **强** | 来源记录（§〇：10:24/10:26 由本账号发出）+ 头像视觉比对 |
| 对方发的消息靠左 | **间接** | 资源命名成对；**未直接观察到** |
| "原版是否有左右区分" | **倾向：有** | 结论 1 直接成立 + 结论 3 间接支持 |

→ 若必须有"对方靠左"的**直接证据**，就需要一个含对方消息的会话。
**造消息属于写操作，已按纪律拒绝**（见 §五）。

## 四、复现方法

```powershell
$adb = 'G:\Program Files\Netease\MuMu\nx_main\adb.exe'
$S   = '127.0.0.1:16384'

# 0) 前置：设备健康探针（本次已通过）
& 'G:\demo map\scripts\m5\device-health-probe.ps1'

# 1) 打开原版 -> 底部 tab「自定义名称6」(约 175,1848) -> 右上角聊天图标 (约 1017,105)
& $adb -s $S shell am start -n com.kairuotu.campus/.MainActivity
& $adb -s $S shell input tap 175 1848
& $adb -s $S shell input tap 1017 105      # -> MessageActivity（会话列表）
& $adb -s $S shell input tap 500 210       # -> GroupChatActivity（唯一会话）

# 2) 采集单个页面的 png + xml（capture）
& $adb -s $S shell screencap -p /sdcard/dsh-orig-chat/x.png
& $adb -s $S pull /sdcard/dsh-orig-chat/x.png .
& $adb -s $S shell uiautomator dump /sdcard/dsh-orig-chat/x.xml
& $adb -s $S pull /sdcard/dsh-orig-chat/x.xml .
```

资源名清单（`arsc-chat-resource-names.txt`）的复现：

```powershell
# 拉 base.apk（只读）-> 读其中的 resources.arsc -> 抽可打印 ASCII 串 -> 按正则筛
$apk = (& $adb -s $S shell pm path com.kairuotu.campus) -replace '^package:',''
& $adb -s $S pull $apk orig.apk        # 约 180 MB，用完即删（见 §六）
```

⚠ 上面 `pm path` 得到的 `base.apk` sha256 =
`3373B6B2FBC997919398543DBBC59546172376BEEDEE87312154EBA095D6C294`，
与 txt 文件头部记录一致，可用于确认复现的是同一版本。

## 五、本次**没有**做的写操作（遵守只读纪律）

未发消息 / 未发图 / 未发语音 / 未点赞 / 未评论 / 未回复 / 未建群 / 未改资料。
**特别地：没有为了让会话"有对方消息"而创造任何内容** —— 那属于写操作。
本次观察用到的唯一"非纯读"动作是**打开已有会话**（会改服务端已读状态），
该项在任务书中被明确列为允许的"纯导航点击"。

另外两件**刻意没做**的事：

- **没有"补救"删除那个违规群 `GroupForEvidence`** —— 删除本身也是一次写操作。
  按 `docs/POLICY-VIOLATION-2026-09-21.md` 的裁定（用户裁定 A：不补救），维持现状。
- **没有 force-stop 原版 app**（本项目纪律）；它一度让出前台，本次未做任何干预。

## 六、设备侧临时文件

device 侧只用到 `/sdcard/dsh-orig-chat/`（本目录的 png/xml 中转站），
任务结束时已由清理脚本整体删除；本地拉的 180 MB `orig.apk` 亦已删除。
**原版 app 自身的数据目录（`/data/data/com.kairuotu.campus`）全程未触碰、未清除。**
