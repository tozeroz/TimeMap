# M5 最终 completion audit（Round 319）

> 依据：审核 65 给定的 **7 个问题**；审核 66 的收尾顺序（"补 scanner 入口 → 一次极窄认证字段观察 →
> 然后直接进入最终 completion audit；**不再开启新的 Gate/方法学专项**"）。
> 本文件**只回答那 7 个问题**，不展开新专项。

---

## 〇、⚠️ 一处**必须前置声明的冲突**（按用户要求 4 第 6 条）

审核 66 反复表述"目标已变更"：
> "现在按你**最新冻结的目标**：**体验/行为等价优先，纯视觉不阻塞**"
> "因为你现在把最终目标改成了**体验完全一致**…"

⚠️ 而**我收到的目标文本**（本轮 goal 原文）仍然是：
```
"…继续用 MuMu 模拟器对照原版 com.kairuotu.campus 复现功能，**最终严格 1:1 复现**；…"
```
**没有**"体验/行为等价优先、纯视觉不阻塞"这一句。

⇒ 按用户要求 4 第 6 条（审核不是权威本身；冲突必须用**可区分的证据**复核/上报）：
   此冲突我**无法自行裁决**（"用户是否对审核私下说过目标变更"这件事，我这里没有可区分证据）。
⇒ 处置：**如实上报**；在澄清之前 **不**把视觉类 `NOT_EVALUATED` 当作"不阻塞"，仍按原口径记。
⇒ 本审计因此给出**两套口径下的结论**：
   · 口径 A（目标文本原文：严格 1:1）→ 见 §八
   · 口径 B（审核转述：体验等价优先、纯视觉不阻塞）→ 见 §八

---

## ① 还有没有**可执行** mock / fake-success surface？

**答：清理后已无。** 本轮把最后一处也去掉了，并**结构性**地消除了整类风险。

### 1.1 本轮删掉的（有证据）

| 位置 | 问题 | 处置 | 证据 |
|---|---|---|---|
| `ScannerScreen` | **fake-success + 假取景**：`setTimeout(()=>setDone(true),5200)` **无条件**报「识别成功」，另有「正在识别…」「查看扫描结果」、假取景框/扫描线、mock 轮播提示 | 全删，改为一句话「扫码功能尚未实现」 | 门禁 6 键全 PASS；**等 4.5s 后复查仍无「识别成功」**；敏感度 4 键全红 |
| `UpgradeDialog` | ① `upgradeInfo`（版本 2.11.0／48.6 MB／3 条亮点）**全部编造** ②「立即更新」`navigate('campus')` **假装在更新** ③ 按钮文案「稍后再说」与基线 observed 的「取消」不符 | 删编造数据、文案改回「取消」、「立即更新」只给明确说明 | 基线 `upgrade-alert`（observed）逐字对照 |
| `MediaPreviewScreen` | ① `import { posts }` ② `post?.images ?? posts.flatMap(...)` **跨实体兜底**（取不到就显示**所有动态**的图片） | 改为只取 `getPost(postId)` 的权威 images；缺失/失败/无图三态明确 | 门禁 5 键全 PASS（**含正向**：post 0002 只显示自己的图、计数器 1/1）；敏感度 4 键全红 |

### 1.2 ⭐ 结构性消除：`mock.ts` **整体退出现代代码**

```
实测（清理到本轮时）：mock.ts 的导出里
  以「值」方式被**生产**使用的只剩 boardEmojis（BoardScreen）；其余全是 type-only
⇒ 那一大批**编造业务数据**已无生产使用者，但仍留在生产模块里。
   而本项目已多次确立、并被审核 60/63/66 批准的纪律是：
     "**注释挡不住重新 import**"（WO#16 起）
     "production code → **should not contain importable fabricated business data**"（审核 63 原话）

处置：
  ① 类型（**不是数据**）→ `app/src/data/types.ts`（逐字搬移）
  ② boardEmojis（**UI chrome**）→ `app/src/data/uiConstants.ts`（并如实标注证据强度）
  ③ mock.ts 整个文件 → `scripts/m5/fixtures/legacy-mock-data.ts.txt`，并删除
  ④ 6 个文件的引用改指向 types / uiConstants

复核：**生产代码里已无任何代码级 mock 引用**（grep；只剩注释提历史）。
```

### 1.3 仍未清的残留（如实列出，不粉饰）

```
· `boardEmojis`（6 个表情）是**唯一**仍来自"观察/推断"的 UI 常量：
    项数 6 **有据**（可复算产物 raw-dumps/message-board-dump.xml 里 emotion_image 出现 6 次）
    **具体字符未验证** ⇒ `ORIGINAL_EMOJI_CHARACTERS: NOT_EVALUATED`（**不**声称字符一致）
  ⇒ 它不是"可执行 mock surface"（不驱动业务数据），但**是**一处未验证的一致性问题。
· `gate-wo10-message-screen-mock.mjs` 这个**门禁名字**仍含 "mock"（历史名），
  它守的是"消息屏不再读 mock" ⇒ 名字过期但功能正确。**未改名**（改名会打断历史引用）。
```

---

## ② 还有没有**错误 identity fallback**？

**答：本轮又查出 2 处（都修了）；`MediaPreviewScreen` 的跨实体兜底也在其中。**

```
① `store.ts` 的 `addMyPost()`：`author: me`
   `me` = mock 里的**编造用户**（id 'u_me'、name '自定义名称6'）
   ⚠️ 而「自定义名称6」正是我 Round 318 从**原版 app** 观察到的**原版账号昵称**！
   后果：用户**发布**后（发布是核心路径 PublishScreen:151），**本地那份**帖子作者写成**另一个身份**；
        随后同步成功的**服务端**版本用真实作者 ⇒ **同一帖两种作者**。
   修法：取**会话身份**（与 `toFeedPost` 一致：`u:<userId>` + displayName + avatarFor）；
        未登录时**不编造**真实姓名，给如实标注状态的占位（'未登录'）。

② `store.ts` 的 `isMyPost()`：`fromServer.author.name === me.name`
   两个错：① 名字不是身份（同名误判／改名漏判）② `me.name` 根本不是"我"
   修法：改为**按 id** 比（`u:<userId>`），并用会话身份。
   ⚠️ 该函数当前**无调用者**（死代码）—— 仍修好，因为它是"随时会被接上"的接口。

③ `MediaPreviewScreen` 的跨实体兜底（见 §1.1）：请求 A 却显示**所有人**的图片。
   ⚠️ 与 WO#17 修掉的 `?? posts[0]` 是**同一类**。
```

**⭐ 我自己这轮的失误（必须记）**：上一轮的"全仓 mock 扫描"**漏掉了 `store.ts`** ——
我的正则只匹配 `'../data/mock'`，而 `store.ts` 用的是 `'./mock'`。
⇒ 差点把一处**在用的生产假身份**当成"已清理干净"。
**教训：`grep 没命中` ≠ `不存在` —— 正则的覆盖面本身就是一类假设。**
（这次是**整体清理**把它逼出来的：删掉 mock.ts 后 tsc 立刻报错。）

**复核**：改为按 id 的判据后，`isMyPost` 与 `addMyPost` 都用**会话身份**；
其余 `??` 用法经复查均为良性（`likedProp ?? post.liked`、文件输入、计时器）。

---

## ③ 还有没有**已确认但未修**的结构 blocker？

**答：没有"结构性"blocker 未修；但有 2 项**已确认、按审核要求**刻意不在本轮修**：

```
· F-002 `FEED_DETAIL_ERROR_PRESENTATION: KNOWN_MISMATCH`
    审核 63 的裁定是"**不要再观察**，把 404 与网络错误的语义保持分离"
    ⇒ 保留为**已知偏差**，等最终 audit 判定（见 §七-⑦）
· F-004 认证页「所在学院」是 **picker**，我们用纯文本行（控件类型不符）
    审核 66 明确"**不要因此重开 WO#20**" ⇒ 本轮**只登记**（F-004），未改代码
· F-005「就读专业」交互模型 `NOT_EVALUATED`（验证需选值 ⇒ 超只读边界）
· F-006 原版**学院实体**（原版有、我们无）⇒ 能力缺口，**不**据此编造
```

**已修掉的结构 blocker（本轮+近期）**：
```
F-001 `#/comments` 独立屏（原版不存在）→ WO#19 已修（评论内联在 FeedDetail）
F-003 校园认证页形态/字段全编 + 错跳 → WO#20 已修（表单形态 + 不假装成功）
scanner 假成功/假取景 → 本轮已修
media-preview mock + 跨实体兜底 → 本轮已修
mock.ts 可 import 的编造数据 → 本轮已结构性消除
```

---

## ④ 剩余 deviation 是否都已登记并批准？

**答：是**（除 §〇 的口径冲突与 §③ 的三项待裁定）。

```
登记位置：docs/m5/FIDELITY-CLOSEOUT-BACKLOG.md（F-001..F-006 / R-001..R-002）
          + NEXT-ACTIONS.md（唯一待办权威来源）
已批准/已关闭：F-001（审核 64 选项 a）／F-003（审核 65→66 PASS）
               R-001（权威证据裁决）／R-002（审核 63：UNAVAILABLE→HIDE）
待最终 audit 裁定：F-002 / F-004 / F-005 / F-006
仍开放的发布前置（非 M5 完成度，属发布动作）：I1（IP 清查）/ I3（图标重绘）
其他待裁定项：WO10.9（WO10 关账措辞）/ WO14.6（ME_NO_FALLBACK_ON_UNAVAILABLE）
```
⚠️ **一项纪律的持续适用**（队列明确记录）："后续每做一单都要照此补一屏的 claim 到 manifest"
⇒ 本轮新增的门禁是否需要补 claim，见 §⑦。

---

## ⑤ 核心页面是否通过全设备 regression？

**答：通过了。20 个设备门禁、两轮（正序 + 逆序）逐门禁一致且全绿** —— 即该脚本自己给出的
`M5_GLOBAL_REGRESSION_AUDIT: PASS（两轮逐门禁结论一致且全绿 ⇒ 按审核 61/62 停止局部收敛）`。

```
本轮实测（Round 319，commit 9eeb88d 之后构建的 APK）：
  第 1 轮（正序，20 个门禁）：**全部 DEVICE_GATE_EXIT=0**
  第 2 轮（逆序，同 20 个）：**全部 DEVICE_GATE_EXIT=0**
  两轮比对：**20/20 逐门禁一致**（无任何"顺序敏感"项）
  服务器侧：gate-place-not-campus.mjs → PLACE_NOT_CAMPUS_GATE: PASS
  本地检查：check-all-local.sh → CHECK_ALL_LOCAL: PASS（含 BASELINE_MANIFEST_CONSISTENCY: PASS）
```

### ⭐ 5.1 过程中一次**我自己的误报**，以及它暴露的两个真实缺陷（如实记录）

第一次跑审计时，**第 1 轮有 16 个门禁报 EXIT=1**（而第 2 轮全绿）。我**没有**把它当噪声放过。
查证过程与结论：
```
① 先排除"冷启动"：我人为制造冷态（force-stop 本 app + forward --remove-all 清 CDP 转发），
   再单独跑当时第一个失败的门禁 ⇒ **PASS（EXIT=0）** ⇒ 冷启动**不是**原因。
② 复现测试：把同一脚本、同一顺序**原样重跑** ⇒ **第 1 轮 20/20 全绿**，失败**不复现**。
③ 归因：那批失败是**我自己造成的污染** —— 我在启动这次审计前 **kill 掉了上一个仍在运行的
   审计 job**，被 kill 的 wrapper 的**子门禁进程**仍在占用设备／门禁锁，
   于是新 run 的前段门禁撞锁失败，等僵尸进程退出后才恢复正常（这解释了"跑在后面的通过"）。
   ⚠️ 这**不是**代码回归：同一 commit、同一脚本、同一顺序，现在两轮全绿。
```
**它暴露的两个真实缺陷（都已修）**：
```
缺陷 1（可诊断性）：审计脚本的 run_one() 只 grep `DEVICE_GATE_EXIT=`，
   **把门禁的完整输出丢掉了** ⇒ 失败时**没有原因可查**（我只能靠推断）。
   ⇒ 已修：失败时把完整输出留档到 tools/tmp/audit-failures/<gate>.round<N>.log。
缺陷 2（静默少测）：门禁列表原先是**硬编码**的 15 个，
   ⇒ 本轮新增的 5 个门禁（wo17 / wo18 / wo20 / scanner / media-preview）**根本没被审计跑到**，
      而列表面上看还是"绿的"。
   ⇒ 已修：改为**自动发现** `scripts/m5/gate-*.mjs`（排除服务器侧那两个），
      且发现为空时**明确报错**而不是静默继续。
      ⇒ 门禁数因此从 15 → **20**。
```
⚠️ 教训（与项目既有教训同型）：**"审计是绿的"只有在"审计确实覆盖了全部门禁"时才成立**；
   而"覆盖"这件事本身需要被机械保证，不能靠人记着更新列表。

### 5.2 ⚠️ 与本审计主文档的一致性说明
`docs/m5/M5-GLOBAL-COMPLETION-AUDIT.md` 的机器结论行由**该脚本**输出，本轮实测为：
```
M5_GLOBAL_REGRESSION_AUDIT: PASS
M5_COMPLETION_STATUS: BLOCKED（产品完成度 = 受阻；剩余项见该文件 §三 A 类）
M5_CLOSEOUT_PHASE: ACTIVE
```
⇒ 即"**回归干净**"与"**产品未达完成**"是两件事，本文件 §八 在此之上补充**口径冲突**的处置。

---

## ⑥ server / artifact / database baseline 是否一致？

**答：一致**（本轮实测）。

### 6.1 数据库基线（只读查询，逐项对齐记录值）
```
users=3 message_threads=3 thread_members=5 messages=5 media=3 message_media=1
board_notes=1 places=2 schools=1 campuses=3 posts=4
posts_with_campus=0 users_with_campus=0
migrations_applied=12
```
（与既有记录**逐字一致**；`posts_with_campus=0` 也一致 —— 所以 `campusCircleCount`
  必须是 **null 而非 0**，这正是审核 62 纠正过的那条。）

### 6.2 账号与内容（用于确认身份口径）
```
+8613800000001 anmoss ／ +8613800000002 Lemy ／ +8613800000003 Azur冰弦
posts: 4 条，全部 place_id 非空（3 条在 校本部 place、1 条在 达美乐比萨），campus 均为 null
```
⚠️ 顺带印证 §② 的修复方向：**我们的会话用户是这三个之一**，
   而 mock `me` 的名字是「自定义名称6」—— **不在其中** ⇒ 原来的 `author: me` 必然错。

### 6.3 服务与产物
```
systemd: campus-backend **active** ／ nginx **active** ／ postgresql **active**
/api/health: {"status":"ok","service":"campus-api","stage":"M3","schema_state":"ready"}
```
**产物一致性（本地构建 vs 线上部署，逐字节）**：
```
本地 server/dist/index.mjs  = f819a9db56b47e487ee25fb003a1331469d81c823910a82a0373c7573fb3cb7e
远端 /srv/campus/server/dist/index.mjs = f819a9db56b47e487ee25fb003a1331469d81c823910a82a0373c7573fb3cb7e
⇒ ✅ **完全一致**
```
⚠️ **过程中的一次自己的失误**：我第一次比对时误取了 `server/dist/admin.mjs`（另一个入口文件）
    与远端 `index.mjs` 比，得出"不一致"的错误结论；改比**同一个文件**后一致。
    ⇒ 与 §②/§5.1 的教训同类：**要比"同一个东西"**，不能只比"同名的东西"。

---

## ⑦ 关键 1:1 claim 是否已经有足够证据？

**答：核心行为类 claim 有证据（门禁+敏感度）；视觉/语义类仍有 NOT_EVALUATED。**

```
✅ 有证据（门禁 + 敏感度三阶段可复算）：
   · 身份权威（WO#17：不存在的 id 不泄漏实体正文；评论内联 + 回复**嵌套**）
   · 评论计数来自权威 API；0 评论 → 空态
   · POI 搜索走服务端、不把"地点"当"校园数据"
   · 校园认证页形态/字段/按钮文案（WO#20）
   · 图片预览只显示**该动态自己**的图片、缺失不泄漏
   · 扫码入口存在且**不假装能扫**
   · 消息/发帖/评论等**写操作失败不本地假成功**（历史门禁）

⚠️ 仍 NOT_EVALUATED（**不**声称一致）：
   · 原版**视觉**细节（像素/色值/间距）—— 除已量化的那批
   · 原版扫码页的**目标页/流程**（打开相机会涉相机权限 + 可能业务写入 ⇒ 只读约束下未做）
   · 原版 media-preview 的**呈现**（真实入口是聊天图片；造数据=写操作 ⇒ BLOCKED_BY_POLICY）
   · 认证页字段**控件类型**的完整口径（F-004 已知一个是 picker；F-005/F-006 未知）
   · `boardEmojis` 的**具体字符**
   · 「下一步」之后的真实认证流程（BLOCKED_BY_POLICY）
```

---

## 八、结论（**口径已由审核 67 冻结** —— 本节已按权威答案改写）

我在 §〇 上报的口径冲突，**已由审核 67 给出权威答案**（用户已明确修改目标）：

```
PROJECT TARGET:        **EXPERIENCE / BEHAVIOR EQUIVALENCE**
PURE VISUAL 1:1:       **NOT REQUIRED**（图标/颜色/装饰/像素级布局后期会重新设计）
⇒ 旧文档的"最终严格 1:1 复现"已被后来的用户决策 **SUPERSEDED**
```

因此 §〇 里那两套口径（A/B）**作废**，改为**单一口径**。裁定结果：

```
M5_GLOBAL_REGRESSION_AUDIT:            PASS
M5_ARTIFACT / DB / SERVER CONSISTENCY: PASS
M5_MOCK_AND_FAKE_SUCCESS_ERADICATION:  PASS
M5_EXPERIENCE_COMPLETION_STATUS:       **HOLD**
```
> HOLD 的原因**不是视觉**，而是"仍存在**明确的功能/交互能力缺口**"（审核 67 原话）。

```
BLOCKER：F-004 认证页「所在学院」应为 picker（"表单交互方式"属 BLOCKING）
BLOCKER：F-006 原版有学院实体、我们没有（数据侧）
待 Owner 做 scope 裁定：SCANNER CORE FUNCTIONALITY ／ CAMPUS VERIFICATION NEXT FLOW ／ UPGRADE FUNCTIONALITY
NON-BLOCKING：F-002（体验等价的文案差异）／ boardEmojis 字符（视觉 backlog）／ 纯视觉项
```

⭐ 审核 67 指出的、我认为**最重要**的一点：
> "**『没有 mock / 没有假成功』≠『体验已经等价』。**
>  不要把所有『把假功能换成 unavailable 提示』的页面都**自动视为完成**。"

⇒ 所以本审计"§① 已无可执行 mock surface = 完成"的推论**不成立**；
   那些页面现在**诚实**了，但**体验**不等于原版。已按审核口径逐项重分类（见审核 67 文档 §四）。

⚠️ 我据此**不**自行宣布 M5 完成；后续动作见 `docs/review-log/67-…md` §五。
