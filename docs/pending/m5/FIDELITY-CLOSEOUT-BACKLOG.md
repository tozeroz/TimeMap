# M5 最终关账待办（fidelity closeout backlog）

> 本文件汇集**"已确认、尚未修"的保真缺口**与**已裁决的结论**，供最终 fidelity audit 逐个销项。
> 建立于 Round 318（审核 63 要求登记 `FEED_DETAIL_ERROR_PRESENTATION: KNOWN_MISMATCH`）。
> ⚠️ 与 `KNOWN-DEVIATIONS.md` 的分工：
> · `KNOWN-DEVIATIONS.md` = **我们主动后撤/未做**的（有意为之，有批准记录）
> · 本文件 = **已知不一致 / 已知结构错误**（是缺陷，等待修）

---

## 一、结构保真缺陷（**已知、待裁定修法**）

### F-001 ⭐⭐ `#/comments` 独立屏在原版里**不存在**（评论是内联的）

```
状态：  ⭐⭐ **CONFIRMED FIDELITY BLOCKER**（审核 64 选 (a)；**不是** evidence gap）
       审核 64 认定 Source Validity **已足够强**，不需要再回 A3/A4 做原版观察：
         ORIGINAL_COMMENT_TOPOLOGY = **inline within FeedDetail**（CONFIRMED）
         CURRENT                   = separate CommentsScreen / #/comments
       ⚠️⚠️ **两条必须记住的纠正（否则会把修法做小）**：
         ① "**请不要把修复理解成：'删掉 #/comments 就完成了。'**
            真正的产品[目标]是让 comments 作为用户页面的**结构**[内联]。"
         ② "如果 #/comments 只是 Gate/调试为了方便直接打开页面，可以把**测试方式迁到
            FeedDetail 的真实 comment surface**；**不要为了测试方便永久保留一个
            原版不存在的产品页面。**"
       ✅ 并**销掉**长期遗留项"comments 路由可达但没有入口"：
          "**没有入口并不是'入口还没找到'，而是因为原版根本不是独立 comments screen。**"
       ⇒ 立项 **WO#19 FeedDetail inline comments topology**
         ⚠️ **只**解决"评论区在哪儿"；**不**趁机扩评论字段（头像/点赞仍走 §三 G-001/G-002）
发现：  Round 318，做审核 63 要求的 Source Validity 检查时发现
依据：  docs/test/original-baseline/supplements/comment-detail.json （**权威**）
        "activity": "com.kairuotu.feed.detail.FeedDetailActivity
                     （评论区**内联**在动态详情页，不是独立 Activity）"
        "activity_note": "M0 记录的 CommentDetailActivity 需要参数，直接用 deep link 打开是空态。
                          真实形态是：评论区作为 ViewPager(id/vp_detail) 的一页**内联在动态详情里**。"
        "supersedes": { file: screens/comment-detail/baseline.json,
                        field: known_unknowns（带参数时的结构未知）,
                        why_m0_missed: "M0 只用 deep link 打开（无参数 → 空态）" }
        ⚠️ M3 的证据强度：**真实入口 + 真实触摸 + uiautomator 控件树（含 bounds + DOM 层级）**
           ⇒ 比 M0 的 deep-link 观察**更权威**。
现状：  我们有独立路由 `#/comments` + 独立 `CommentsScreen` —— **结构层面自造的屏**。
关联：  队列里长期记着的"comments 路由可达但**无 in-app 入口**"是**同一件事的另一面**
        —— 原版没有这个独立入口，我们自然也为它找不到入口。
⚠️ 不推翻 WO#17：身份篡改与双数据源**确实**都修好了（那是**数据层**问题，这是**结构层**问题）。
参考修法：把评论区改为**内联在 `#/feed`（FeedDetailScreen）里的一页**，
        并移除独立 `#/comments` 路由（或其保留为内部跳转）。⚠️ 需裁定后动。
```

### F-002 `FEED_DETAIL_ERROR_PRESENTATION: KNOWN_MISMATCH`

```
状态：  KNOWN_MISMATCH（审核 63 明确裁定为**fidelity gap，不是 evidence gap**）
发现：  Round 317（WO#17 期间）
依据：  docs/test/original-baseline/screens/feed-detail/baseline.json
        error 态（status=observed, evidence=normal.png）=
        「中央：网络错误图标 + **「网络不给力，点击刷新试试」+ 刷新按钮**」
现状：  我们显示「网络错误」/「这条动态不存在（可能已被删除）」+ 刷新
审核裁定（63）：
  · "**不要为了它重新进入原版**"（证据已足够，不必再观察）
  · ⚠️ "404/not_found 和网络错误是不是原版同一个 presentation，目前可以继续**分别记录**；
       **不要为了改一句文案把两种错误语义重新混起来**。"
⇒ 即：**文本与呈现要对齐**，但**不要**因此把"内容不存在"与"网络失败"两种语义合并。
```

---

## 二、已裁决的结论（**不再是未决项**，留档以免重复研究）

### F-003 ⭐⭐ 校园认证页（`VerifyScreen`）**形态与字段都是我们编的**，且按钮错跳

```
状态：  KNOWN_MISMATCH（待裁定修法；**不是** evidence gap —— 原版已观察到）
发现：  Round 318 的 A3 有界只读观察（docs/pending/m5/A3A4-BOUNDED-OBSERVATION.md）
依据：  原版 `com.kairuotu.campus` → 抽屉「校园认证」→
        落到 `com.xingin.xhsreactnative.ui.XhsReactActivity`，**实测**（uiautomator dump + bounds）：
          标题「**填写认证信息**」
          「就读学校」= 北京交通大学 ／「所在学院」（空）／「就读专业」（空）／「当前年级」（空）
          按钮「**下一步**」
现状（我们的 DrawerPages.tsx:40-60 VerifyScreen）：
          标题「校园认证」（= 抽屉条目名，不是页面标题）
          「未认证」+ desc「完成学生认证后可解锁校园广场发帖、同校推荐等能力。」
          按钮「去认证」→ **navigate('board')（跳到留言板）**
          Rows「认证方式 = 学生证 / 校园卡」「认证状态 = 待认证」
差异（按审核 62 的口径分开）：
          entry reachability:      ✅ 正确（原版抽屉里确实有「校园认证」）
          destination correctness: ❌ 错（原版是**表单页**，我们是状态卡 + 错跳）
          content correctness:     ❌ 差异大（标题/主体形态/字段/按钮文案**全部不同**；
                                      原版**没有**「未认证」「认证方式/状态」这些文字）
⇒ 这**比"错跳"严重**：不只是按钮去向错，整个页面形态与字段都是我们编的。
⚠️ 不能做的事：**不要点原版的「下一步」** —— 那大概率提交认证信息 = **写操作**
   ⇒ 该按钮的后续流程记 `BLOCKED_BY_POLICY`（只读约束）。
修法（待裁定）：把 `VerifyScreen` 改为**表单形态**（与原文对齐：标题「填写认证信息」+
  就读学校/所在学院/就读专业/当前年级 + 「下一步」），并去掉我们编的状态卡与文案。
  按钮去向需先确认（原版「下一步」的去向未观察，因不能点）。
```

### F-004 ⭐ 认证页字段的**交互类型**：原版「所在学院」是 **picker**，我们用纯文本行

```
状态：  KNOWN_MISMATCH（**控件类型**；待最终 audit 决定是否必修）
发现：  Round 319 的极窄只读观察（docs/pending/m5/VERIFY-FIELD-INTERACTION-OBSERVATION.md）
依据：  原版 `com.kairuotu.campus` 认证页实测：
          点「所在学院」→ 弹出【取消 / 确认 + 学院列表 +「没有我的学院？」】
          （列表含北交大真实学院：在职专业学位中心 / 软件学院 / 语言与传播学院 /
            网络空间安全学院 / 威海国际学院·威海校区 …）
          mInputShown=false（无键盘）、同窗口（不换页）⇒ 是 **picker**，不是输入框、不是新页面
现状：  我们 `DrawerPages.tsx` 的 `VerifyScreen` 用 `Rows`（label + value 文本行）
        ⇒ **控件类型不同**（文本行 vs 列表选择器）
⚠️ 已排除"点空了"这一解释（标签中心落在可点击行内；与「所在学院」点击方式一致）
⚠️ 为什么**不**现在修：审核 66 明确"**不要因此重开 WO#20**"，且 WO#20 的冻结目标是
   "**可见表单保真**"（`WO20_VISIBLE_FORM_FIDELITY: PASS / CLOSED`），
   而"字段交互类型"本就单列为 `VERIFY_FIELD_INTERACTION_TYPE: NOT_EVALUATED`。
⇒ 由最终 audit 决定是否必修（它属**交互方式**，按审核口径会影响体验）。
```

### F-005 认证页「就读专业」点击**无可见反应**（交互模型未判定）

```
状态：  NOT_EVALUATED（**不是** known mismatch —— 我们尚不知道原版是什么）
依据：  实测点「就读专业」→ 页面文本与点击前**逐字相同**（无 picker/键盘/新页面）
       ⚠️ 合理假设：**专业列表依赖已选学院**（未选学院则无反应）
       ⚠️ 验证该假设**必须先选择一个学院** ⇒ 超出只读观察边界（审核协议明确"不选择任何值"）
       ⇒ 因此**不给结论**，只记 NOT_EVALUATED + 假设
连带：  `VERIFY_FIELD_YEAR_INTERACTION`（当前年级）同样 NOT_EVALUATED
       —— 审核的停止条件是"若足以看出三字段共享同一模型就停止"，
          而实测**不支持**该共享假设（学院=picker、专业=无反应）⇒ 如实记录并停止，
          **不**做三字段逐项考古。
```

### F-006 原版学院实体（原版有、我们无）

```
状态：  KNOWN_CAPABILITY_GAP
依据：  F-004 的观察顺带得到：原版学院列表是**北交大真实学院名**
现状：  我们只 seed 了学校（1）+ 校区（3），**没有**学院实体
⇒ **不**据此编造；若最终要求"认证页可选学院"，需先有权威实体来源 ⇒ 属能力缺口
```

### R-001 ✅ comment-detail 空态冲突 —— **已由权威证据裁决**

```
冲突：  基线 `comment-detail` 的空态（observed）=「**页面全白，无列表内容**」
        vs CommentsScreen 原注释声称「气泡图标 +「留下你的评论吧～」」
裁决：  基线那一条是 **deep-link 无参数的假象**（该 baseline 的 known_unknowns
        已被 supplements/comment-detail.json 显式 `supersedes`）
        ⇒ 两者**不是同一屏的两种说法**，而是「**真实形态 vs 假象**」。
⇒ 冲突消解，**不必**进 A3/A4 的有界观察（审核 63："如果权威 evidence 已经能裁决，就直接用已有证据"）
```

### R-002 ✅ 评论头像 / 点赞数 —— **UNAVAILABLE → HIDE**（审核 63 裁定）

```
COMMENT_AVATAR_AUTHORITY:      UNAVAILABLE → **HIDE**（已如此实现）
COMMENT_LIKE_COUNT_AUTHORITY:  UNAVAILABLE → **HIDE**（已如此实现）
NEW API WORK:                  **DEFER**
```
⚠️ **必须与目标形态区分开**（否则会误读成"原版没有头像"）：
```
原版**确实有**头像：supplements/comment-detail.json 记录
  `id/iv_feed_detail_comment_avatar_image`（圆形头像）
⇒ 「原版有头像」= **目标形态**
   「我们先隐藏」= **当前能力缺口**（服务端 ApiComment 无头像字段）
   **两者不冲突**，分别记录，不混淆。
```
审核原话："等最终 fidelity audit 时，如果已有原版证据明确证明这些是目标页面必要可见
contract，再开最小 read-model extension。如果只是视觉细节或证据仍不足，就继续
NOT_EVALUATED / capability gap。"

---

## 三、能力缺口（服务端暂无权威来源，已按纪律"不渲染"）

```
G-001 评论作者头像：ApiComment 无头像字段 ⇒ **不渲染**（WO#17 起）
G-002 评论点赞数：无服务端来源 ⇒ **不渲染数字**（WO#17 起）
G-003 地点 `category`（院系/教学楼/超市…）：无权威来源 ⇒ 接口**不返回**、UI 不渲染（WO#18 起）
      ⚠️ 原版 POI 页是否有分类位：**未观察** ⇒ `ORIGINAL_POI_CATEGORY_PRESENTATION: NOT_EVALUATED`
G-004 地点 `distance` 的"**无定位 ⇒ 不渲染**"这条分支
      ⇒ 代码上已实现（fix===null ⇒ 返回 null ⇒ 不渲染 span），
        但模拟器**有**定位 ⇒ **夹具构造不出来** ⇒ Gate 里记 NOT_EVALUATED（WO#18）
```

---

## 四、与 `M5-GLOBAL-COMPLETION-AUDIT.md` 的关系

该审计列的 A1（CommentsScreen 一真一假）/ A2（PoiSearchScreen mock）**已完成**：
```
A1 → WO#17：PASS / CLOSED（审核 63）
A2 → WO#18：已实现、门禁 7 键 + 敏感度通过、已提交裁定
```
⇒ 下一步按审核 63 给的顺序：**A3/A4 的有界只读观察** → 然后 **targeted fidelity closeout / A5**。
（A3/A4 = `DrawerPages` 的「去认证」错跳；`scanner`/`media-preview`/`comments` 三屏的**原版入口**；
  ⚠️ A4 要注意审核 62 的提醒：「存在原版 screen baseline」≠「我们知道它的**用户入口**」
  ⇒ 必须把 **destination correctness** 与 **entry reachability** 分开。
  现在 `comments` 那一条已被 F-001 解答：**它的原版入口根本不存在**（评论内联）。）
