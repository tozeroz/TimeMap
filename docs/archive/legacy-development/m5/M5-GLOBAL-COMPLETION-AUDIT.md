# M5 GLOBAL COMPLETION AUDIT

> 时间：2026-09-22｜Round 268｜依据：审核 61 第 9/10 条
> > "完成 WO#16 后，应回到一次 **M5 全局 completion audit**，而不是继续无限局部加固。
> >  我建议最多做：正常完整回归顺序 + 反向顺序完整回归一次。如果两轮 verdict 一致，就停止。"
> > "下一次审核我优先看的不再是'还能给 WO#16 增加什么 Gate'，
> >  而是'WO#16 完成后，整个 M5 距离最终关账究竟还剩哪些**真正的产品 blocker**'。"

---

## 一、回归结果（两轮：正常顺序 + 反向顺序）

执行：`bash scripts/m5/m5-global-completion-audit.sh`（脚本本身也是本审计的交付物，
以后可一键复现；它**不在下游用 head/N 截断输出** —— 那会给门禁发 SIGPIPE 并泄漏门禁锁，我踩过）。

```
第 1 轮（正常顺序）：15 个设备门禁 **全部 DEVICE_GATE_EXIT=0**
   wo6 tabbar ／ wo7 text-send ／ wo8 message-list ／ wo9a group ／ wo9b at-panel ／
   wo10 message-screen-mock ／ wo11 feed-list ／ wo12 user-profile ／ wo13 profile-edit ／
   wo14 me-identity ／ wo15 map-markers ／ wo16 board-avatar ／ wo16a campus-mock ／
   wo16b schools ／ composer-coverage
   服务器侧：gate-place-not-campus → PLACE_NOT_CAMPUS_GATE: PASS
   本地：BASELINE_MANIFEST_CONSISTENCY: PASS ／ CHECK_ALL_LOCAL: PASS

第 2 轮（**反向顺序**）：同样 15 个门禁 **全部 DEVICE_GATE_EXIT=0**

两轮逐门禁比对：**15/15 一致且全绿 ⇒ 无一条"顺序敏感"**
M5_GLOBAL_AUDIT: **PASS**（按审核 61：一致即停，可停止局部收敛）
```

⭐ **一个值得记的结果**：先前那条 flaky 断言（`MAP_GEO_PERMISSION_MODAL`）在**反向顺序下也稳定** ——
说明我把"需要特定前置的部分"与"可确定性验证的部分"分开（改用 app 自带的 `#/map?ask=1`）
确实解决了顺序依赖，而**不是**把它藏起来了。
（当时它是"正向回归里只有它红、单独跑又过"，反向顺序正是能暴露这类问题的手段。）

⚠️ **本轮审计的边界（不夸大）**：
```
· 它证明的是"**在当前夹具/当前数据/这两轮顺序下**结论一致且全绿"。
  它**不**证明"任何顺序都安全"（我们只跑了两个顺序，不是全部排列）。
· 按审核 61 的指示，**不**展开"16 个 Gate × 所有断言 × 顺序组合"的专项工程。
```


---

## 二、M5 做过什么（一句话回顾）

```
M5 的主题**不是加功能**，而是"逐屏消灭 mock / 假成功 / 错误数据源 + 1:1 证据收敛"。
截至本审计：WO#7–WO#16 全部完成/关账，16 个门禁文件、12 个迁移、25 个屏幕。
```

已关账的工作单：WO#7（真实消息发送）／WO#8（消息列表接后端）／WO#9A（群聊切片）／
WO#9B（@面板）／WO#10（MessageScreen 假数据清理）／WO#11（FeedList 权威数据）／
WO#12（UserProfile 身份修复）／WO#13（ProfileEdit 真写入）／WO#14（MeScreen 自身份统一）／
**WO#15（MapScreen 标记权威化 —— 审核 60 PASS/CLOSED）**／**WO#16（学校/校区 —— 层 A 审核 61 PASS，层 B 本轮完成）**。

---

## 三、⭐ **真正的产品 blocker**（本审计的核心，按"是否阻塞 1:1 关账"分类）

### A. 会阻塞"1:1 复现"主张的（需要做，且**修法明确**）

```
A1. CommentsScreen 与 FeedDetailScreen 对**同一数据一真一假**
    · 现象：FeedDetailScreen 用 getComments() 取**真实**评论；
      CommentsScreen 读 mock 的 comments/posts，且有 `posts.find(...) ?? **posts[0]**` 的**静默兜底**
      ⇒ 同一条动态的评论，从详情页看是真的，直接进 #/comments 看是假的
    · 修法明确（同 WO#12/#15 已反复使用的模式）：接 getComments，去掉静默兜底，三态 + 无回落
    · ⚠️ 该屏**没有 in-app 入口**（路由可达）⇒ 优先级低于 A2，但仍是**假数据面**
    · 状态：**未做**（待裁定是否立单；我建议立单，理由：它是"可执行的假数据面"）

A2. PoiSearchScreen 仍渲染 mock 的 `pois`（含**无出处的** `posts: 1284`）
    · 而 PoiDetailScreen **已走权威** `/api/places/:id`
    · 修法需**新增 API 能力**：`GET /api/places`（列表/搜索）——与 WO#15 的坐标字段同性质
    · 证据：DB 的 `address` 与基线实例**逐字一致**，而 mock 多了「北京市海淀区」前缀
      ⇒ 与 WO#15 同向：**权威行比 mock 更接近原版**
    · 状态：**未做**（需裁定立单 + 批准新增 API）

A3. DrawerPages.tsx:48 —— 「校园认证」页里文案为「**去认证**」的按钮 `navigate('board')`（跳到**留言板**）
    · 与 WO#13 修掉的"5 个 Me 条目全跳 profile-edit"同型（错跳）
    · ⚠️ 需要先判明"原版里那个位置到底是什么入口" —— **不能凭空发明一个认证流程**
    · 状态：**未做**（待只读观察或裁定）

A4. scanner / media-preview / comments 三屏**路由可达但无任何 in-app 入口**
    · ⚠️ 与 WO#13 删掉的"编造孤儿路由"形态相同，但**这次不同**：三者**都有原版基线屏**
      ⇒ **不能直接删**，需判明"原版里它们由什么入口进入"
    · 状态：**未做**（待只读观察）

A5. 视觉/语义类 NOT_EVALUATED（**当前证据拿不到，不是没做**）
    · `ORIGINAL_MAP_MARKER_CARDINALITY` ／ `ORIGINAL_PIN_COLOR_SEMANTICS` ／
      `ORIGINAL_FULL_MARKER_PRESENTATION_CONFORMANCE` ／ `OFFLINE_MAP_PROJECTION_CONFORMANCE`
    · 唯一瓶颈是**视觉通道**：我是纯文本模型，`vision` 工具在本会话两次返回空
      ⇒ 我**从未核对过任何基线截图**；机械像素分析（WO#15 引入）只能给"存在某色相色块"这类**测量**，
        给不出语义（"红色代表什么"）
    · 另有 `ORIGINAL_EMPTY_CIRCLE_PRESENTATION`（原版对 0 条校园圈显示什么，未观察）
    · 状态：**受通道阻塞** ⇒ 若接入可用视觉通道，可一次性收敛多项
```

### B. 已知偏差（**有意为之，有批准记录**，不阻塞关账）

```
D-001 「更多同学」推荐区整块内容      —— 后撤，理由=/api 无该数据
D-002 邀请分享面板（入口 + 面板）      —— 后撤
D-003 邀请卡的学校/学院/年级          —— 后撤（/api/auth/me 无这些字段）
D-004 校园广场页「校园广场 ▼」面板**内容** —— TEMPORARY；层 B 已把面板改为渲染权威实体
      ⚠️ 其中**计数**仍为 null（归属未建模）⇒ 该部分仍未"恢复"到原版形态
L-004~L-007 Me 页四个条目的**目的地**未知（原版本身未观察到）
L-008 资料编辑页自身的页面结构无基线
```
⇒ 这些都是**登记过的**，且 `KNOWN-DEVIATIONS.md` 里各有批准记录与恢复条件。

### C. 工程质量缺口（**不阻塞产品**，但按纪律应记录）

```
C1. 敏感度覆盖：16 个门禁里，**有"可重复"敏感度脚本的仍是少数**
    （详见 docs/archive/legacy-development/m5/SENSITIVITY-COVERAGE-AUDIT.md）
    ⚠️ 审核 61 明确："**不要**现在启动'13 个 Gate × 所有断言 × 顺序组合'的专项工程"，
       只在"flaky / 顺序相关 / 明显共享可变状态"时才查
    ⇒ 本审计**不启动**该专项工程（遵循审核要求）

C2. manifest 的 claim 覆盖：7 屏已冻结（含 trident-map）；余下约 17 个基线屏未冻结
    ⇒ 按 AUDIT.7 的纪律，"后续每做一单就补一屏"，**不做专项补全**

C3. `check-server-baseline.sh` 已在本轮补上 schools/campuses/归属列
    （此前它不覆盖那几张表 ⇒ 一次实验残留没被报出来）
```

### D. 非 M5 的发布前置（**不属于 M5 关账范围**，但如实列出）

```
I1 发布前 IP 清查：逐一核对"逐字复制自第三方 APK"的资产
I3 若确定要公开：为图标做"视觉等价但非直接复制"的重绘（保留 ASSET_ORIGIN 注释）
WO10.9 等裁定 WO10 是否 CLOSED（关账措辞）
X3.2 观察项：若再出现慢启动，`[migrate] ...: code=<SQLSTATE> ...` 会给出可归因证据
```

---

## 四、诚实结论

> ⚠️ 本节措辞已于 2026-09-22 按**审核 62 第 2 条**纠正（原句自相矛盾，见下方"自查"）。

```
主要主链路**已经高度收敛**：
  · 12 个迁移、16 个门禁（本轮正常顺序 15 个设备门禁全 EXIT=0）、25 个屏幕
  · mock 在可执行/可呈现的 surface 上已全部被清除或登记为 TEMPORARY deviation

但**目前仍明确剩余至少两个**已知、当前可执行的 fake-data surface：
  A1 CommentsScreen —— 含 `posts.find(...) ?? posts[0]` 静默兜底
       ⚠️ 它不只是"显示假数据"，而是**身份篡改**：请求 post A、页面显示 post B
       （与 WO#12 的 `users[id] ?? users.u1` 完全同型）
  A2 PoiSearchScreen —— mock POI + 无出处的 `posts: 1284`

⇒ **M5 尚不可关账**。剩余的是 A 类**真工作**，
   而**不是**"再多加几个 Gate"（这正是审核 61 提醒我不要再做的方向）。
```

### ⚠️ 自查：本审计初稿有一句**自相矛盾**的话（审核 62 纠正）

初稿我写的是"**M5 的产品层收敛已完成到'没有已知的、可执行的假数据面'**" ——
这与**紧接着的下一行**（"唯一的'仍是假'的两处（A1、A2）修法明确但尚未做"）**直接矛盾**：
A1/A2 本身就是已知、当前可执行的假数据面。

⇒ 已按审核 62 给出的口径改写为"主要主链路高度收敛，但**仍剩余至少 A1/A2**"。

**教训（值得记进纪律）**：写结论句时用了"**没有…**"这类**全称否定**，
必须先回头核对同一份文档里的清单 ——
否则"清单列了 5 条、结论说没有"会**同时误导读者与我自己**，
而且这种矛盾在复核时很容易被"我自己的结论"掩盖（因为读的人会信任结论句）。

### ⚠️ 另一处命名纠正（审核 62 第 2 条）

本审计脚本的输出原为 `M5_GLOBAL_AUDIT: PASS`。审核指出这个名字**夸大了它证明的东西**：
```
它证明的：现有 16 个门禁全绿 ／ 正序逆序一致 ／ 当前 regression 没有明显顺序依赖
它**没有**证明：M5 产品已经 complete
```
⇒ 已按审核建议改名（脚本与文档同步）：
```
M5_GLOBAL_REGRESSION_AUDIT: PASS      （回归/顺序审计通过）
M5_COMPLETION_STATUS: BLOCKED          （产品完成度：受阻，未完成）
M5_CLOSEOUT_PHASE: ACTIVE              （审核 62 第 3 条：已进入关账执行阶段，但不可关账）
```
⚠️ 这只是命名修正，**不因此扩大测试范围**（审核 62 明确要求）。

---

## 五、建议的收尾顺序（审核 62 已给定优先级）

```
WO16  → 修 attribution **部分覆盖**这一处语义（覆盖不完整 ⇒ 全部 null）→ **PASS / CLOSED**
WO17  → A1：`WO17_POST_IDENTITY_AND_COMMENT_AUTHORITY`
         · 去掉 `?? posts[0]`
         · 目标 post 不存在 ⇒ unavailable/error（**不**静默换一个实体）
         · CommentsScreen 与 FeedDetail 使用**同一** authoritative post identity
         · 不再保留"一真一假"的双数据源
         ⚠️ 审核明确："不要趁机重做整个评论系统"
         ⚠️ 优先级高于 A2 —— 因为它是 **identity corruption**，比"显示假数据"危险
WO18  → A2：`WO18_POI_SEARCH_AUTHORITY`（`GET /api/places`；最小 read model 按实际 UI 字段设计）
         · `posts: 1284` 若 UI 确实需要"该地点动态数"⇒ 用
           `COUNT(posts WHERE place_id = places.id)` **真实计算**；不能可靠表达则 null/不渲染
A3/A4 → **一次有界的只读观察**（合并取证，不分别开四个考古单）
         只回答：entry ／ navigation target ／ 最低可见 contract
         ⚠️ 审核特别强调 A4：「**存在原版 screen baseline**」≠「我们已经知道它的用户入口」
            ⇒ 必须把 **destination correctness** 与 **entry reachability** 分开
A5    → 默认方案 **(c)**（审核 62 第 6 条）：
         · 可**机械测量**的 claim（色相/bbox/几何/ROI/颜色族）⇒ 用现有像素分析器收敛
         · **少量关键视觉语义**（头像 marker 长什么样／bubble 内有什么…）
           ⇒ 把那几张具体的 baseline/current PNG **上传到审核会话**，由远端 reviewer 直接看图核对
         · 非关键/非默认 fallback ⇒ 可保留 known limitation
         ⚠️ **不**建设新的 vision 基础设施（那会掉回"局部过度收敛"）
         ⚠️ 但 A5 **不能**无限全部挂 NOT_EVALUATED 然后宣布完成 ——
            因为最终目标是严格 1:1（审核 62 原话）
```

---

## ⭐⭐ M5 正式关账（审核 69，2026-09-23 14:00）

```
M5_GLOBAL_REGRESSION_AUDIT: PASS
M5_EXPERIENCE_COMPLETION:   PASS / CLOSED
  27 device gates × (forward + reverse) = 54/54 clean ／ no order-sensitive result
  server gate: PASS ／ CHECK_ALL_LOCAL: PASS
最终冻结：M0 CLOSED ／ M1 CLOSED ／ M2 CLOSED ／ M3 CLOSED ／ M4 CLOSED ／ **M5 PASS / CLOSED**
```

详见 docs/archive/legacy-development/review-log/69-m5-formally-closed.md。

⚠️ 审核 69 的明确指令：**停止**从 Gate/自测/原版观察里主动寻找新的 M5 工作；
除非发现**真实回归**或**新的明确产品需求**，否则不要因为"还能再验证一点什么"重开 M5。
